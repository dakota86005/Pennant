import Foundation
import HTTPTypes
import OpenAPIRuntime
import PennantAPI
@testable import PennantKit

/// The repository root, from this file's place in it (`macos/Packages/PennantKit/Tests/PennantKitTests/`).
let repositoryRoot = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()

/// The payloads the real server sent on the synthetic save (`contract/fixtures/`, captured by
/// `tests/contract.test.ts`): read where they are, never copied.
let fixtures = repositoryRoot.appending(path: "contract/fixtures")

func fixtureData(_ name: String) throws -> Data {
    try Data(contentsOf: fixtures.appending(path: name))
}

func fixtureStatus() throws -> Components.Schemas.ServerStatus {
    try JSONDecoder().decode(Components.Schemas.ServerStatus.self, from: fixtureData("responses/getStatus.json"))
}

/// A fresh scratch folder for one test, removed by the caller when it wants.
func scratchFolder(_ label: String = "pennantkit") throws -> URL {
    let base = ProcessInfo.processInfo.environment["PENNANT_TEST_SCRATCH"].map { URL(fileURLWithPath: $0) }
        ?? FileManager.default.temporaryDirectory
    let folder = base.appending(path: "\(label)-\(UUID().uuidString.prefix(8))", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    return folder
}

struct Timeout: Error {}

/// Waits until the controller reaches a state the predicate accepts.
@discardableResult
func waitForState(
    _ controller: ServerController,
    timeout: Duration = .seconds(5),
    _ predicate: @escaping @Sendable (ServerState) -> Bool
) async throws -> ServerState {
    let updates = await controller.stateUpdates()
    return try await withThrowingTaskGroup(of: ServerState?.self) { group in
        group.addTask {
            for await state in updates where predicate(state) { return state }
            return nil
        }
        group.addTask {
            try await Task.sleep(for: timeout)
            return nil
        }
        let first = try await group.next() ?? nil
        group.cancelAll()
        guard let first else { throw Timeout() }
        return first
    }
}

/// Polls a condition (for things that are not states).
func eventually(timeout: Duration = .seconds(5), _ condition: @escaping () async -> Bool) async -> Bool {
    let deadline = ContinuousClock.now + timeout
    while ContinuousClock.now < deadline {
        if await condition() { return true }
        try? await Task.sleep(for: .milliseconds(10))
    }
    return await condition()
}

// MARK: A scripted child process

/// A child process the test drives: it prints what the test says, and ends when told or when signalled.
final class FakeProcess: SidecarProcess, @unchecked Sendable {
    let pid: Int32
    let outputLines: AsyncStream<String>
    let errorLines: AsyncStream<String>
    private let output: AsyncStream<String>.Continuation
    private let errors: AsyncStream<String>.Continuation
    private let exitState = ExitState()
    private let lock = NSLock()
    private var _sent: [Data] = []
    private var _terminations = 0
    private var _kills = 0
    /// A process that ignores SIGTERM (only SIGKILL ends it).
    let ignoresTerminate: Bool

    init(pid: Int32, ignoresTerminate: Bool = false) {
        self.pid = pid
        self.ignoresTerminate = ignoresTerminate
        (outputLines, output) = AsyncStream.makeStream(of: String.self)
        (errorLines, errors) = AsyncStream.makeStream(of: String.self)
    }

    var sent: [Data] { lock.withLock { _sent } }
    var terminations: Int { lock.withLock { _terminations } }
    var kills: Int { lock.withLock { _kills } }
    var hasExited: Bool { exitState.finished != nil }

    func send(_ data: Data) throws {
        if hasExited { throw CocoaError(.fileWriteUnknown) }
        lock.withLock { _sent.append(data) }
    }

    func waitForExit() async -> ProcessExit? { await exitState.wait() }

    func terminate() {
        lock.withLock { _terminations += 1 }
        if !ignoresTerminate { end(status: 0) }
    }

    func kill() {
        lock.withLock { _kills += 1 }
        end(status: 9, bySignal: true)
    }

    func print(_ line: String) { output.yield(line) }

    func end(status: Int32, bySignal: Bool = false) {
        guard !hasExited else { return }
        output.finish()
        errors.finish()
        exitState.finish(ProcessExit(status: status, bySignal: bySignal))
    }

    func ready(port: Int = 51234) {
        print(#"PENNANT_READY {"port":\#(port),"pid":\#(pid),"version":"test"}"#)
    }

    func fail(reason: String, message: String, status: Int32) {
        print(#"PENNANT_FAILED {"reason":"\#(reason)","message":"\#(message)"}"#)
        end(status: status)
    }
}

/// Launches `FakeProcess`es and runs a script for each: `script(process, launchNumber)` (1-based).
final class FakeLauncher: SidecarLauncher, @unchecked Sendable {
    private let lock = NSLock()
    private var _launched: [FakeProcess] = []
    private var _specs: [LaunchSpec] = []
    private let ignoresTerminate: Bool
    private let script: @Sendable (FakeProcess, Int) -> Void

    init(ignoresTerminate: Bool = false, script: @escaping @Sendable (FakeProcess, Int) -> Void) {
        self.ignoresTerminate = ignoresTerminate
        self.script = script
    }

    var launched: [FakeProcess] { lock.withLock { _launched } }
    var specs: [LaunchSpec] { lock.withLock { _specs } }

    func launch(_ spec: LaunchSpec) throws -> any SidecarProcess {
        let (process, number) = lock.withLock {
            let process = FakeProcess(pid: Int32(40_000 + _launched.count), ignoresTerminate: ignoresTerminate)
            _launched.append(process)
            _specs.append(spec)
            return (process, _launched.count)
        }
        let script = script
        Task.detached {
            // After the controller has written the handshake and started reading
            try? await Task.sleep(for: .milliseconds(5))
            script(process, number)
        }
        return process
    }
}

/// A configuration whose server files exist (empty) in a scratch folder, for the scripted launcher.
func fakeConfiguration() throws -> ServerConfiguration {
    let root = try scratchFolder("controller")
    let helpers = root.appending(path: "Contents/Helpers", directoryHint: .isDirectory)
    let server = root.appending(path: "Contents/Resources/server", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: helpers, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: server, withIntermediateDirectories: true)
    let node = helpers.appending(path: "pennant-server")
    FileManager.default.createFile(atPath: node.path, contents: Data("#!/bin/sh\n".utf8), attributes: [.posixPermissions: 0o755])
    FileManager.default.createFile(atPath: server.appending(path: "server.cjs").path, contents: Data())
    return ServerConfiguration(
        nodeExecutable: node,
        serverRoot: server,
        dataFolder: root.appending(path: "data", directoryHint: .isDirectory),
        logFolder: root.appending(path: "logs", directoryHint: .isDirectory),
        appVersion: "9.9.9-test",
        cachesFolder: root.appending(path: "caches", directoryHint: .isDirectory)
    )
}

/// Timings short enough for tests.
let fastTiming = ServerTiming(
    readyTimeout: .milliseconds(300),
    stopGrace: .milliseconds(200),
    statusAttempts: 2,
    statusRetryDelay: .milliseconds(10),
    restart: RestartPolicy(baseDelay: .milliseconds(10), maxDelay: .milliseconds(80), maxCrashes: 5, window: .seconds(120))
)

// MARK: A canned HTTP transport

/// Answers each request by its path from a table, and remembers what was asked.
final class RoutedTransport: ClientTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var _paths: [String] = []
    private let answers: [String: (contentType: String, body: Data)]
    private let statuses: [String: Int]
    private var _bodies: [String: Data] = [:]

    /// `answers` and `statuses` are keyed by path, or by `METHOD path` (`POST /api/settings`), which wins; a missing
    /// status is 200.
    init(_ answers: [String: (contentType: String, body: Data)], statuses: [String: Int] = [:]) {
        self.answers = answers
        self.statuses = statuses
    }

    /// The last body sent to a `METHOD path`.
    func body(_ key: String) -> Data? { lock.withLock { _bodies[key] } }

    var paths: [String] { lock.withLock { _paths } }

    func send(_ request: HTTPRequest, body: HTTPBody?, baseURL _: URL, operationID _: String) async throws
        -> (HTTPResponse, HTTPBody?)
    {
        let path = request.path ?? ""
        let keyed = "\(request.method.rawValue) \(path)"
        var sent: Data?
        if let body { sent = try await Data(collecting: body, upTo: 1 << 20) }
        lock.withLock {
            _paths.append(path)
            if let sent { _bodies[keyed] = sent }
        }
        guard let answer = answers[keyed] ?? answers[path] else { return (HTTPResponse(status: .notFound), nil) }
        var response = HTTPResponse(status: .init(code: statuses[keyed] ?? statuses[path] ?? 200))
        response.headerFields[.contentType] = answer.contentType
        return (response, HTTPBody(answer.body))
    }

    static func json(_ fixture: String) throws -> (contentType: String, body: Data) {
        ("application/json", try fixtureData("responses/\(fixture).json"))
    }

    static func sse(_ text: String) -> (contentType: String, body: Data) {
        ("text/event-stream; charset=utf-8", Data(text.utf8))
    }
}
