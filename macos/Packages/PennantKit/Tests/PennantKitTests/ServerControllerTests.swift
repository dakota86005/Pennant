import Foundation
import PennantAPI
import Testing
@testable import PennantKit

/// `ServerController` against scripted processes: the handshake, readiness and its check, a locked folder, crashes
/// and their restarts, the crash window, and the clean stop (SWIFTUI_REBUILD.md section 5.3).
@Suite("The server controller")
struct ServerControllerTests {
    let status: Components.Schemas.ServerStatus

    init() throws {
        status = try fixtureStatus()
    }

    private func controller(
        _ launcher: FakeLauncher,
        keys: [String: String] = [:],
        probe: StatusProbe? = nil
    ) throws -> ServerController {
        let status = status
        return ServerController(
            configuration: try fakeConfiguration(),
            launcher: launcher,
            keySource: FixedKeys(keys),
            probe: probe ?? { _, _ in status },
            timing: fastTiming
        )
    }

    @Test("it writes the handshake, waits for the ready line, confirms the status and is ready")
    func startsAndConfirms() async throws {
        let launcher = FakeLauncher { process, _ in process.ready(port: 50_001) }
        let probed = ProbeLog()
        let status = status
        let controller = try controller(launcher, keys: ["anthropic": "sk-ant-test"]) { port, token in
            probed.record(port: port, token: token)
            return status
        }
        await controller.start()
        let state = try await waitForState(controller) { $0.connection != nil }
        let connection = try #require(state.connection)
        #expect(connection.port == 50_001)
        #expect(connection.status == status)
        #expect(connection.token.count == 64)

        let process = try #require(launcher.launched.first)
        let handshake = try #require(process.sent.first)
        let object = try #require(try JSONSerialization.jsonObject(with: handshake) as? [String: Any])
        #expect(object["token"] as? String == connection.token)
        #expect(object["keys"] as? [String: String] == ["anthropic": "sk-ant-test"])
        #expect(probed.calls == [ProbeLog.Call(port: 50_001, token: connection.token)])

        // The keys never ride in the environment
        let spec = try #require(launcher.specs.first)
        #expect(spec.environment.values.contains("sk-ant-test") == false)
        #expect(spec.environment["OOTP_FO_APP_VERSION"] == "9.9.9-test")
        await controller.stop()
    }

    @Test("each launch gets a new token")
    func freshToken() async throws {
        let launcher = FakeLauncher { process, number in
            if number == 1 { process.end(status: 1) } else { process.ready() }
        }
        let controller = try controller(launcher)
        await controller.start()
        try await waitForState(controller) { $0.connection != nil }
        let tokens = launcher.launched.compactMap { $0.sent.first }.compactMap {
            (try? JSONSerialization.jsonObject(with: $0) as? [String: Any])?["token"] as? String
        }
        #expect(tokens.count == 2)
        #expect(Set(tokens).count == 2)
        await controller.stop()
    }

    @Test("a locked data folder is shown with the server's sentence and not retried")
    func locked() async throws {
        let launcher = FakeLauncher { process, _ in
            process.fail(reason: "locked", message: "Another copy of Pennant is using this data folder.", status: 3)
        }
        let controller = try controller(launcher)
        await controller.start()
        let state = try await waitForState(controller) { if case .locked = $0 { true } else { false } }
        #expect(state == .locked(message: "Another copy of Pennant is using this data folder."))
        try await Task.sleep(for: .milliseconds(100))
        #expect(launcher.launched.count == 1)
    }

    @Test("exit code 3 alone still reads as locked")
    func lockedByExitCode() async throws {
        let launcher = FakeLauncher { process, _ in process.end(status: 3) }
        let controller = try controller(launcher)
        await controller.start()
        let state = try await waitForState(controller) { if case .locked = $0 { true } else { false } }
        #expect(state == .locked(message: nil))
    }

    @Test("a refused handshake (exit code 2) is a failure, not a crash to retry")
    func handshakeRefused() async throws {
        let launcher = FakeLauncher { process, _ in
            process.fail(reason: "handshake", message: "No token arrived on stdin.", status: 2)
        }
        let controller = try controller(launcher)
        await controller.start()
        let state = try await waitForState(controller) { if case .failed = $0 { true } else { false } }
        #expect(state == .failed(ServerFailure(kind: .handshake, serverMessage: "No token arrived on stdin.")))
        #expect(launcher.launched.count == 1)
    }

    @Test("a crash restarts the server after the backoff wait")
    func crashRestarts() async throws {
        let launcher = FakeLauncher { process, number in
            if number == 1 { process.end(status: 1) } else { process.ready() }
        }
        let controller = try controller(launcher)
        let updates = await controller.stateUpdates()
        let seen = StateLog()
        let watcher = Task { for await state in updates { seen.append(state) } }
        await controller.start()
        try await waitForState(controller) { $0.connection != nil }
        watcher.cancel()
        #expect(launcher.launched.count == 2)
        #expect(seen.states.contains(.restarting(attempt: 1, after: .milliseconds(10))))
        await controller.stop()
    }

    @Test("a server that crashed after running is restarted too")
    func crashAfterReady() async throws {
        let launcher = FakeLauncher { process, _ in process.ready() }
        let controller = try controller(launcher)
        await controller.start()
        try await waitForState(controller) { $0.connection != nil }
        launcher.launched[0].end(status: 0, bySignal: false)
        try await waitForState(controller) { if case .restarting = $0 { true } else { false } }
        try await waitForState(controller) { $0.connection != nil }
        #expect(launcher.launched.count == 2)
        await controller.stop()
    }

    @Test("five crashes inside the window stop the restarts, and Try Again starts afresh")
    func crashLoop() async throws {
        let launcher = FakeLauncher { process, number in
            if number <= 5 {
                process.print("[server] something went wrong")
                process.end(status: 1)
            } else {
                process.ready()
            }
        }
        let controller = try controller(launcher)
        await controller.start()
        let state = try await waitForState(controller) { if case .failed = $0 { true } else { false } }
        #expect(state == .failed(ServerFailure(kind: .crashedRepeatedly)))
        #expect(launcher.launched.count == 5)

        await controller.tryAgain()
        try await waitForState(controller) { $0.connection != nil }
        #expect(launcher.launched.count == 6)
        await controller.stop()
    }

    @Test("a start failure the server explains (exit code 1 with its sentence) is shown at once, not retried")
    func startFailureShownAtOnce() async throws {
        let launcher = FakeLauncher { process, _ in
            process.fail(reason: "start", message: "The export folder could not be read.", status: 1)
        }
        let controller = try controller(launcher)
        let seen = StateLog()
        let updates = await controller.stateUpdates()
        let watcher = Task { for await state in updates { seen.append(state) } }
        await controller.start()
        let state = try await waitForState(controller) { if case .failed = $0 { true } else { false } }
        watcher.cancel()
        #expect(state == .failed(ServerFailure(kind: .startFailed, serverMessage: "The export folder could not be read.")))
        #expect(seen.states.contains { if case .restarting = $0 { true } else { false } } == false)
        #expect(launcher.launched.count == 1)
    }

    @Test("no ready line in time is a failure, and the silent process is stopped")
    func notReady() async throws {
        let launcher = FakeLauncher { process, _ in process.print("[server] loading…") }
        let controller = try controller(launcher)
        await controller.start()
        let state = try await waitForState(controller) { if case .failed = $0 { true } else { false } }
        #expect(state == .failed(ServerFailure(kind: .notReady)))
        let process = try #require(launcher.launched.first)
        #expect(process.terminations == 1)
        #expect(launcher.launched.count == 1)
    }

    @Test("a status check that never answers is a failure, and the process is stopped")
    func statusCheckFails() async throws {
        struct Refused: Error {}
        let launcher = FakeLauncher { process, _ in process.ready() }
        let controller = try controller(launcher) { _, _ in throw Refused() }
        await controller.start()
        let state = try await waitForState(controller) { if case .failed = $0 { true } else { false } }
        guard case .failed(let failure) = state else { return }
        #expect(failure.kind == .statusCheck)
        #expect(launcher.launched.first?.terminations == 1)
    }

    @Test("stop sends SIGTERM and waits for the server to end")
    func cleanStop() async throws {
        let launcher = FakeLauncher { process, _ in process.ready() }
        let controller = try controller(launcher)
        await controller.start()
        try await waitForState(controller) { $0.connection != nil }
        await controller.stop()
        let process = try #require(launcher.launched.first)
        #expect(await controller.state == .stopped)
        #expect(process.terminations == 1)
        #expect(process.kills == 0)
        try await Task.sleep(for: .milliseconds(50))
        #expect(launcher.launched.count == 1)
    }

    @Test("a server that ignores SIGTERM is killed after the grace period")
    func killAfterGrace() async throws {
        let launcher = FakeLauncher(ignoresTerminate: true) { process, _ in process.ready() }
        let controller = try controller(launcher)
        await controller.start()
        try await waitForState(controller) { $0.connection != nil }
        let started = ContinuousClock.now
        await controller.stop()
        let process = try #require(launcher.launched.first)
        #expect(ContinuousClock.now - started >= fastTiming.stopGrace)
        #expect(process.terminations == 1)
        #expect(process.kills == 1)
        #expect(await controller.state == .stopped)
    }

    @Test("stopping during the restart wait cancels the restart")
    func stopWhileRestarting() async throws {
        let launcher = FakeLauncher { process, _ in process.end(status: 1) }
        let slow = ServerTiming(
            readyTimeout: .seconds(1), stopGrace: .milliseconds(100),
            restart: RestartPolicy(baseDelay: .milliseconds(300))
        )
        let controller = ServerController(
            configuration: try fakeConfiguration(), launcher: launcher, keySource: NoKeys(),
            probe: { _, _ in throw Timeout() }, timing: slow
        )
        await controller.start()
        try await waitForState(controller) { if case .restarting = $0 { true } else { false } }
        await controller.stop()
        try await Task.sleep(for: .milliseconds(500))
        #expect(await controller.state == .stopped)
        #expect(launcher.launched.count == 1)
    }

    @Test("a bundle without the server fails at once, naming nothing but the missing server")
    func notInstalled() async throws {
        var configuration = try fakeConfiguration()
        configuration.nodeExecutable = configuration.nodeExecutable.deletingLastPathComponent().appending(path: "missing")
        let launcher = FakeLauncher { process, _ in process.ready() }
        let controller = ServerController(configuration: configuration, launcher: launcher, keySource: NoKeys(), timing: fastTiming)
        await controller.start()
        #expect(await controller.state == .failed(ServerFailure(kind: .notInstalled)))
        #expect(launcher.launched.isEmpty)
    }

    @Test("every line the server writes is logged, and the handshake is not")
    func logging() async throws {
        let launcher = FakeLauncher { process, _ in
            process.print("[server] opening the league")
            process.ready()
        }
        let controller = try controller(launcher, keys: ["anthropic": "sk-ant-never-logged"])
        await controller.start()
        let state = try await waitForState(controller) { $0.connection != nil }
        await controller.stop()
        let text = try String(contentsOf: controller.configuration.logFile, encoding: .utf8)
        #expect(text.contains("[server] [server] opening the league"))
        #expect(text.contains("PENNANT_READY"))
        #expect(text.contains("sk-ant-never-logged") == false)
        #expect(text.contains(try #require(state.connection).token) == false)
    }
}

/// Records the status probe's calls.
final class ProbeLog: @unchecked Sendable {
    struct Call: Equatable {
        let port: Int
        let token: String
    }

    private let lock = NSLock()
    private var _calls: [Call] = []
    var calls: [Call] { lock.withLock { _calls } }
    func record(port: Int, token: String) { lock.withLock { _calls.append(Call(port: port, token: token)) } }
}

/// Records the states a controller went through.
final class StateLog: @unchecked Sendable {
    private let lock = NSLock()
    private var _states: [ServerState] = []
    var states: [ServerState] { lock.withLock { _states } }
    func append(_ state: ServerState) { lock.withLock { _states.append(state) } }
}

/// A server judged unusable is never published as ready (review S3).
@Suite("A server judged unusable")
struct UnusableServerTests {
    let status: Components.Schemas.ServerStatus

    init() throws {
        status = try fixtureStatus()
    }

    @Test("a ready line that arrives after the ready timeout, while the process is being stopped, is not ready")
    func lateReadyLine() async throws {
        let launcher = FakeLauncher(ignoresTerminate: true) { process, _ in
            Task.detached {
                try? await Task.sleep(for: .milliseconds(150))
                process.ready()
            }
        }
        let status = status
        let controller = ServerController(
            configuration: try fakeConfiguration(), launcher: launcher, keySource: NoKeys(), probe: { _, _ in status },
            timing: ServerTiming(readyTimeout: .milliseconds(100), stopGrace: .milliseconds(500))
        )
        let seen = StateLog()
        let updates = await controller.stateUpdates()
        let watcher = Task { for await state in updates { seen.append(state) } }
        await controller.start()
        let final = try await waitForState(controller, timeout: .seconds(3)) { if case .failed = $0 { true } else { false } }
        watcher.cancel()
        #expect(final == .failed(ServerFailure(kind: .notReady)))
        #expect(seen.states.contains { $0.connection != nil } == false)
    }

    @Test("a status check that answers while the server is being stopped does not make it ready")
    func probeAnswersDuringStop() async throws {
        let launcher = FakeLauncher(ignoresTerminate: true) { process, _ in process.ready() }
        let status = status
        let probing = ProbeLog()
        let controller = ServerController(
            configuration: try fakeConfiguration(), launcher: launcher, keySource: NoKeys(),
            probe: { port, token in
                probing.record(port: port, token: token)
                try? await Task.sleep(for: .milliseconds(200))
                return status
            },
            timing: ServerTiming(readyTimeout: .seconds(2), stopGrace: .milliseconds(500))
        )
        let seen = StateLog()
        let updates = await controller.stateUpdates()
        let watcher = Task { for await state in updates { seen.append(state) } }
        await controller.start()
        #expect(await eventually { !probing.calls.isEmpty })
        await controller.stop()
        try await Task.sleep(for: .milliseconds(100))
        watcher.cancel()
        #expect(await controller.state == .stopped)
        #expect(seen.states.contains { $0.connection != nil } == false)
    }
}

/// Keys that take a while to read (a Keychain waiting on the system).
struct SlowKeys: KeySource {
    let delay: Duration
    let values: [String: String]
    func keys() async -> [String: String] {
        try? await Task.sleep(for: delay)
        return values
    }
}

/// The keys are read asynchronously, before anything is spawned (review S7).
@Suite("Reading the keys")
struct KeyReadingTests {
    @Test("a slow key read keeps the controller answering, spawns nothing until it is done, then hands the keys over")
    func slowKeys() async throws {
        let launcher = FakeLauncher { process, _ in process.ready() }
        let status = try fixtureStatus()
        let controller = ServerController(
            configuration: try fakeConfiguration(), launcher: launcher,
            keySource: SlowKeys(delay: .milliseconds(300), values: ["anthropic": "sk-ant-slow"]),
            probe: { _, _ in status }, timing: fastTiming
        )
        let starting = Task { await controller.start() }
        try await Task.sleep(for: .milliseconds(50))
        let asked = ContinuousClock.now
        #expect(await controller.state == .starting)
        #expect(ContinuousClock.now - asked < .milliseconds(100))
        #expect(launcher.launched.isEmpty)
        await starting.value
        try await waitForState(controller) { $0.connection != nil }
        let handshake = try #require(launcher.launched.first?.sent.first)
        #expect(String(decoding: handshake, as: UTF8.self).contains("sk-ant-slow"))
        await controller.stop()
    }

    @Test("a stop while the keys are being read cancels the launch: nothing is spawned")
    func stopWhileReadingKeys() async throws {
        let launcher = FakeLauncher { process, _ in process.ready() }
        let controller = ServerController(
            configuration: try fakeConfiguration(), launcher: launcher,
            keySource: SlowKeys(delay: .milliseconds(200), values: [:]),
            probe: { _, _ in throw Timeout() }, timing: fastTiming
        )
        let starting = Task { await controller.start() }
        try await Task.sleep(for: .milliseconds(50))
        await controller.stop()
        await starting.value
        #expect(await controller.state == .stopped)
        #expect(launcher.launched.isEmpty)
    }

    @Test("the Keychain store reads on a detached task, not on the caller's actor",
          .enabled(if: keychainTestsAllowed, "reads the login keychain: CI's throwaway runners only"))
    @MainActor
    func keychainOffMain() async {
        // An unused service: nothing is found, and nothing prompts
        let keys = await KeychainKeyStore(service: "com.dakotawise.pennant.tests.\(UUID().uuidString)").keys()
        #expect(keys.isEmpty)
    }
}
