import Foundation
import Testing
@testable import PennantKit

/// The handshake, the ready and failure lines, and the exit codes, as `server/sidecar.ts` defines them.
@Suite("The sidecar protocol")
struct SidecarProtocolTests {
    @Test("a token is 64 lowercase hex characters, fresh each time, and long enough for the server")
    func token() {
        let tokens = (0..<20).map { _ in SidecarProtocol.makeToken() }
        #expect(Set(tokens).count == tokens.count)
        for token in tokens {
            #expect(token.count == 64)
            #expect(token.count >= SidecarProtocol.minimumTokenLength)
            #expect(token.allSatisfy { "0123456789abcdef".contains($0) })
        }
    }

    @Test("the handshake is one JSON line with the token and the keys, and a newline")
    func handshake() throws {
        let token = String(repeating: "a", count: 64)
        let data = try SidecarProtocol.handshakeLine(token: token, keys: ["anthropic": "sk-ant-1/2"])
        let line = try #require(String(data: data, encoding: .utf8))
        #expect(line.hasSuffix("\n"))
        #expect(line.dropLast().contains("\n") == false)
        let object = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(object["token"] as? String == token)
        #expect((object["keys"] as? [String: String]) == ["anthropic": "sk-ant-1/2"])
        #expect(line == #"{"keys":{"anthropic":"sk-ant-1/2"},"token":"\#(token)"}"# + "\n")
    }

    @Test("with no keys the handshake still carries an empty key set")
    func handshakeWithoutKeys() throws {
        let data = try SidecarProtocol.handshakeLine(token: "t", keys: [:])
        #expect(String(data: data, encoding: .utf8) == "{\"keys\":{},\"token\":\"t\"}\n")
    }

    @Test("a later keys line carries only the keys")
    func keysLine() throws {
        let data = try SidecarProtocol.keysLine(keys: ["openai": "sk-1"])
        #expect(String(data: data, encoding: .utf8) == "{\"keys\":{\"openai\":\"sk-1\"}}\n")
    }

    @Test("the ready line gives the port, the pid and the version")
    func ready() {
        let line = #"PENNANT_READY {"port":53117,"pid":4242,"version":"0.1.0"}"#
        #expect(SidecarProtocol.parse(line: line) == .ready(SidecarReady(port: 53117, pid: 4242, version: "0.1.0")))
    }

    @Test("the failure line gives the reason and the server's sentence")
    func failed() {
        let line = #"PENNANT_FAILED {"reason":"locked","message":"Another copy of Pennant is using this data folder."}"#
        guard case .failed(let failure) = SidecarProtocol.parse(line: line) else {
            Issue.record("not read as a failure")
            return
        }
        #expect(failure.reason == "locked")
        #expect(failure.isLocked)
        #expect(failure.message == "Another copy of Pennant is using this data folder.")
    }

    @Test("anything else is the server's log, including a ready line that does not parse")
    func logLines() {
        for line in [
            "[server] listening on 127.0.0.1",
            "PENNANT_READY not json",
            "PENNANT_READY {\"pid\":1}",
            "PENNANT_FAILED {}",
            "  PENNANT_READY {\"port\":1}",
            "",
        ] {
            #expect(SidecarProtocol.parse(line: line) == .log(line))
        }
    }

    @Test("exit codes: 0 stopped, 1 could not start, 2 no handshake, 3 locked; a signal is a kill")
    func exitCodes() {
        #expect(SidecarExit(ProcessExit(status: 0)) == .stoppedCleanly)
        #expect(SidecarExit(ProcessExit(status: 1)) == .couldNotStart)
        #expect(SidecarExit(ProcessExit(status: 2)) == .noHandshake)
        #expect(SidecarExit(ProcessExit(status: 3)) == .locked)
        #expect(SidecarExit(ProcessExit(status: 7)) == .exited(7))
        #expect(SidecarExit(ProcessExit(status: 9, bySignal: true)) == .killed(signal: 9))
        #expect(SidecarExit(ProcessExit(status: 3, bySignal: true)) == .killed(signal: 3))
    }

    @Test("the launch passes the five variables, the entry point, and none of the app's secrets")
    func launchSpec() throws {
        let configuration = ServerConfiguration(
            nodeExecutable: URL(fileURLWithPath: "/Applications/Pennant.app/Contents/Helpers/pennant-server"),
            serverRoot: URL(fileURLWithPath: "/Applications/Pennant.app/Contents/Resources/server/", isDirectory: true),
            dataFolder: URL(fileURLWithPath: "/Users/gm/Library/Application Support/ootp-front-office/", isDirectory: true),
            logFolder: URL(fileURLWithPath: "/Users/gm/Library/Logs/Pennant", isDirectory: true),
            appVersion: "1.2.3"
        )
        let spec = configuration.launchSpec(inheriting: [
            "HOME": "/Users/gm", "TMPDIR": "/tmp/x", "ANTHROPIC_API_KEY": "sk-ant-secret", "OOTP_FO_BIND": "0.0.0.0",
            "PATH": "/opt/homebrew/bin:/usr/bin",
        ])
        #expect(spec.executable.path == "/Applications/Pennant.app/Contents/Helpers/pennant-server")
        #expect(spec.arguments == ["/Applications/Pennant.app/Contents/Resources/server/server.cjs"])
        let env = spec.environment
        #expect(env["OOTP_FO_DATA_DIR"] == "/Users/gm/Library/Application Support/ootp-front-office")
        #expect(env["OOTP_FO_APP_ROOT"] == "/Applications/Pennant.app/Contents/Resources/server")
        #expect(env["OOTP_FO_APP_VERSION"] == "1.2.3")
        #expect(env["OOTP_FO_BIND"] == "127.0.0.1")
        #expect(env["OOTP_FO_EMBEDDED"] == "1")
        #expect(env["HOME"] == "/Users/gm")
        #expect(env["TMPDIR"] == "/tmp/x")
        #expect(env["ANTHROPIC_API_KEY"] == nil)
        #expect(env["PATH"] == "/usr/bin:/bin:/usr/sbin:/sbin")
        #expect(env.values.contains { $0.contains("secret") } == false)
    }

    @Test("the release folders are Application Support/ootp-front-office and Logs/Pennant")
    func releaseFolders() {
        #expect(ServerConfiguration.releaseDataFolder.plainPath.hasSuffix("/Library/Application Support/ootp-front-office"))
        #expect(ServerConfiguration.releaseLogFolder.plainPath.hasSuffix("/Library/Logs/Pennant"))
    }
}

@Suite("Reading a pipe by lines")
struct LineSplitterTests {
    @Test("a line is passed on when its newline arrives, however the bytes are cut")
    func split() {
        let splitter = LineSplitter()
        #expect(splitter.append(Data("PENNANT_RE".utf8)).isEmpty)
        #expect(splitter.append(Data("ADY {\"port\":1}\n[server] a\r\n[ser".utf8)) == ["PENNANT_READY {\"port\":1}", "[server] a"])
        #expect(splitter.append(Data("ver] b\n\n".utf8)) == ["[server] b", ""])
        #expect(splitter.finish() == nil)
        _ = splitter.append(Data("no newline at the end".utf8))
        #expect(splitter.finish() == "no newline at the end")
    }

    @Test("a real child's lines arrive while it is still running")
    func liveProcess() async throws {
        // The child that is signalled is the one that waits: the shell replaces itself with `cat` (reading the stdin the
        // test holds open), so SIGTERM ends the very process the test waits for. It used to end with `sleep 30` under a
        // shell that stayed to wait for it: SIGTERM then went to the shell while a grandchild held the pipes, and how
        // the shell ended depended on which `sh` the Mac has and where it was when the signal came (the flake, N11)
        let process = try FoundationSidecarProcess(LaunchSpec(
            executable: URL(fileURLWithPath: "/bin/sh"),
            arguments: ["-c", "echo first; read line; echo \"got $line\"; exec /bin/cat >/dev/null"],
            environment: [:]
        ))
        var lines = process.outputLines.makeAsyncIterator()
        #expect(await lines.next() == "first")
        try process.send(Data("hello\n".utf8))
        #expect(await lines.next() == "got hello")
        process.terminate()
        #expect(await process.waitForExit() == ProcessExit(status: SIGTERM, bySignal: true))
    }
}

/// A development build never runs on the real data folder by accident (review S5).
@Suite("A development build's data folder")
struct DevelopmentFolderTests {
    private let bundle = Bundle(for: BundleMarker.self)
    private func defaults(_ values: [String: Any] = [:]) -> UserDefaults {
        let name = "pennant-tests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        defaults.removePersistentDomain(forName: name)
        for (key, value) in values { defaults.set(value, forKey: key) }
        return defaults
    }

    @Test("with neither a scratch folder nor the opt-in, no folder is chosen")
    func unchosen() {
        let configuration = ServerConfiguration.development(in: bundle, environment: [:], defaults: defaults())
        #expect(configuration.dataFolderChosen == false)
        #expect(configuration.logFolder.plainPath.hasPrefix(FileManager.default.temporaryDirectory.plainPath))
    }

    @Test("a scratch folder, from the environment or a launch argument, is chosen, with its log inside it")
    func scratch() {
        let fromEnvironment = ServerConfiguration.development(
            in: bundle, environment: ["PENNANT_DEV_DATA_DIR": "/tmp/pennant-dev", "OOTP_FO_DB_READONLY": "1"], defaults: defaults()
        )
        #expect(fromEnvironment.dataFolderChosen)
        #expect(fromEnvironment.dataFolder.plainPath == "/tmp/pennant-dev")
        #expect(fromEnvironment.logFolder.plainPath == "/tmp/pennant-dev/logs")
        #expect(fromEnvironment.extraEnvironment == ["OOTP_FO_DB_READONLY": "1"])
        let fromArgument = ServerConfiguration.development(
            in: bundle, environment: [:], defaults: defaults(["PennantDevDataFolder": "/tmp/pennant-arg", "PennantDevLogFolder": "/tmp/l"])
        )
        #expect(fromArgument.dataFolder.plainPath == "/tmp/pennant-arg")
        #expect(fromArgument.logFolder.plainPath == "/tmp/l")
    }

    @Test("the real folder only on purpose")
    func realOnPurpose() {
        for configuration in [
            ServerConfiguration.development(in: bundle, environment: ["PENNANT_DEV_USE_REAL_DATA": "1"], defaults: defaults()),
            ServerConfiguration.development(in: bundle, environment: [:], defaults: defaults(["PennantUseRealDataFolder": true])),
        ] {
            #expect(configuration.dataFolderChosen)
            #expect(configuration.dataFolder.plainPath == ServerConfiguration.releaseDataFolder.plainPath)
        }
        #expect(ServerConfiguration.development(in: bundle, environment: ["PENNANT_DEV_USE_REAL_DATA": "yes please"], defaults: defaults()).dataFolderChosen == false)
    }

    @Test("an unchosen folder starts no server and creates nothing in it")
    func noServer() async throws {
        var configuration = try fakeConfiguration()
        configuration.dataFolderChosen = false
        let launcher = FakeLauncher { process, _ in process.ready() }
        let controller = ServerController(configuration: configuration, launcher: launcher, keySource: NoKeys(), timing: fastTiming)
        await controller.start()
        #expect(await controller.state == .failed(ServerFailure(kind: .noDataFolderChosen)))
        #expect(launcher.launched.isEmpty)
        #expect(FileManager.default.fileExists(atPath: configuration.dataFolder.path) == false)
        await controller.tryAgain()
        #expect(launcher.launched.isEmpty)
    }
}

private final class BundleMarker {}

@Suite("Waiting for a process to end")
struct ExitStateTests {
    @Test("a waiter whose task is cancelled returns nil at once, as stop() relies on")
    func cancellation() async {
        let state = ExitState()
        let waiter = Task { await state.wait() }
        try? await Task.sleep(for: .milliseconds(20))
        let cancelled = ContinuousClock.now
        waiter.cancel()
        #expect(await waiter.value == nil)
        #expect(ContinuousClock.now - cancelled < .milliseconds(500))
        state.finish(ProcessExit(status: 0))
        #expect(await state.wait() == ProcessExit(status: 0))
    }
}
