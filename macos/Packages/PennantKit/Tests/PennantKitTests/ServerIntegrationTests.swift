import Foundation
import PennantAPI
import Testing
@testable import PennantKit

/// The real server, as the app runs it: the staged bundle layout (`npm run mac:stage` → `build/macos-server/`), the
/// pinned Node binary, a scratch data folder holding the synthetic league, and the real `ServerController`. It must
/// reach ready, answer `/api/status` through the generated client, say `hello` on the event stream, and stop cleanly
/// with its lock released.
///
/// It runs when the staged server exists and `PENNANT_TEST_LEAGUE` names a synthetic `league.db`
/// (`npm run synthetic:league -- <folder>`); `macos/scripts/test.sh` sets both up. Never point it at a real save.
/// The staged server and the synthetic league the integration test runs on.
enum StagedServer {
    static let stage = repositoryRoot.appending(path: "build/macos-server", directoryHint: .isDirectory)
    static var league: URL? {
        ProcessInfo.processInfo.environment["PENNANT_TEST_LEAGUE"].map { URL(fileURLWithPath: $0) }
    }

    static var available: Bool {
        let manager = FileManager.default
        guard let league else { return false }
        return manager.isExecutableFile(atPath: stage.appending(path: "Helpers/pennant-server").path)
            && manager.fileExists(atPath: stage.appending(path: "Resources/server/server.cjs").path)
            && manager.fileExists(atPath: league.path)
    }
}

@Suite("The real server", .serialized, .enabled(if: StagedServer.available))
struct ServerIntegrationTests {
    static let stage = StagedServer.stage
    static var league: URL? { StagedServer.league }

    private func configuration() throws -> ServerConfiguration {
        let run = try scratchFolder("integration")
        let data = run.appending(path: "data", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: data, withIntermediateDirectories: true)
        try FileManager.default.copyItem(at: try #require(Self.league), to: data.appending(path: "league.db"))
        return ServerConfiguration(
            nodeExecutable: Self.stage.appending(path: "Helpers/pennant-server"),
            serverRoot: Self.stage.appending(path: "Resources/server", directoryHint: .isDirectory),
            dataFolder: data,
            logFolder: run.appending(path: "logs", directoryHint: .isDirectory),
            appVersion: "0.0.0-integration"
        )
    }

    @Test("it starts, answers the status, says hello on the event stream, and stops with the lock released")
    func lifecycle() async throws {
        let configuration = try configuration()
        let controller = ServerController(configuration: configuration, keySource: NoKeys())
        await controller.start()
        let state = try await waitForState(controller, timeout: .seconds(60)) { state in
            switch state {
            case .ready, .failed, .locked: true
            default: false
            }
        }
        let connection = try #require(state.connection, "not ready: \(state); see \(configuration.logFile.path)")
        let lock = configuration.dataFolder.appending(path: "server.lock")
        #expect(FileManager.default.fileExists(atPath: lock.path))
        #expect(connection.status.app.version == "0.0.0-integration")
        #expect(connection.status.hasData)

        // The status through the generated client, with this launch's token
        let client = PennantClient.make(port: connection.port, token: connection.token)
        let status = try await client.getStatus().ok.body.json
        #expect(status.app.name == "Pennant")
        let orgs = try await client.listOrgs().ok.body.json
        let settings = try await client.getSettings().ok.body.json
        let club = CurrentClub.from(served: settings.organization, orgs: orgs)
        #expect(club?.ref == ClubRef(id: 1))
        #expect(club?.source == .humanManaged)
        #expect(club?.org?.isHuman == true)
        #expect(URL(fileURLWithPath: settings.dataDir).standardizedFileURL.path
            == configuration.dataFolder.standardizedFileURL.plainPath)

        // Without the token the server refuses
        let stranger = PennantClient.make(port: connection.port, token: String(repeating: "0", count: 64))
        let refused = try await stranger.getStatus()
        if case .ok = refused { Issue.record("a request with the wrong token was answered") }

        // hello, first on the event stream
        let found = HelloBox()
        let reader = Task {
            try? await EventClient(client: client).readOnce { signal in
                if case .event(let event) = signal, let hello = event.hello { found.hello = hello }
            }
        }
        #expect(await eventually(timeout: .seconds(10)) { found.hello != nil })
        reader.cancel()
        let hello = found.hello
        #expect(hello?.status.app.version == "0.0.0-integration")

        await controller.stop()
        #expect(await controller.state == .stopped)
        #expect(FileManager.default.fileExists(atPath: lock.path) == false)
        let log = try String(contentsOf: configuration.logFile, encoding: .utf8)
        #expect(log.contains("PENNANT_READY"))
        #expect(log.contains(connection.token) == false)
    }

    @Test("a second server on the same folder is refused as locked, and not retried")
    func secondServerIsLocked() async throws {
        let configuration = try configuration()
        let first = ServerController(configuration: configuration, keySource: NoKeys())
        await first.start()
        let ready = try await waitForState(first, timeout: .seconds(60)) { state in
            switch state {
            case .ready, .failed, .locked: true
            default: false
            }
        }
        try #require(ready.connection != nil, "the first server did not start: \(ready)")

        let secondLog = try scratchFolder("integration-second-log")
        var other = configuration
        other.logFolder = secondLog
        let second = ServerController(configuration: other, keySource: NoKeys())
        await second.start()
        let state = try await waitForState(second, timeout: .seconds(60)) { state in
            switch state {
            case .ready, .failed, .locked: true
            default: false
            }
        }
        guard case .locked(let message) = state else {
            Issue.record("expected locked, got \(state)")
            await second.stop()
            await first.stop()
            return
        }
        #expect(message?.contains("Another copy of Pennant") == true)
        await first.stop()
    }
}

/// Holds what the hello carried, across the reading task.
final class HelloBox: @unchecked Sendable {
    private let lock = NSLock()
    private var _hello: Components.Schemas.HelloEvent?
    var hello: Components.Schemas.HelloEvent? {
        get { lock.withLock { _hello } }
        set { lock.withLock { _hello = newValue } }
    }
}
