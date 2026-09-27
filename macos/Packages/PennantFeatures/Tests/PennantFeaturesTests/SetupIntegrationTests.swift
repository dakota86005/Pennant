import Foundation
import PennantAPI
import PennantKit
import Setup
import Shell
import Testing

/// The staged server and the synthetic league the test runs on.
enum StagedServer {
    nonisolated static let stage = PreviewFixtures.repositoryRoot.appending(path: "build/macos-server", directoryHint: .isDirectory)
    nonisolated static var league: URL? {
        ProcessInfo.processInfo.environment["PENNANT_TEST_LEAGUE"].map { URL(fileURLWithPath: $0) }
    }

    /// The same league as OOTP would export it (`export/` beside `league.db`, written by `npm run synthetic:league`).
    nonisolated static var export: URL? {
        league?.deletingLastPathComponent().appending(path: "export", directoryHint: .isDirectory)
    }

    nonisolated static var available: Bool {
        guard let league, let export else { return false }
        let manager = FileManager.default
        return manager.isExecutableFile(atPath: stage.appending(path: "Helpers/pennant-server").path)
            && manager.fileExists(atPath: stage.appending(path: "Resources/server/server.cjs").path)
            && manager.fileExists(atPath: league.path)
            && manager.fileExists(atPath: export.appending(path: "teams.csv").path)
    }
}

/// The Setup flow against the real server, as the app runs it: the staged bundle (`npm run mac:stage`), a scratch
/// data folder with the synthetic league, the app's model following the event stream, and a pretend OOTP save whose
/// export is the synthetic league's own (the import builds a whole new database from the export, so an export without
/// the league's tables would leave no clubs to pick). The folder is picked by path, the save chosen, the import followed to its end, and a club
/// saved; the server then serves that club as the configured one.
///
/// It runs when the staged server exists and `PENNANT_TEST_LEAGUE` names a synthetic `league.db` with its `export/`
/// beside it (`macos/scripts/test.sh` sets both up). Never point it at a real save.
@MainActor
@Suite("Setup on the real server", .serialized, .enabled(if: StagedServer.available))
struct SetupIntegrationTests {
    private func scratch() throws -> URL {
        let base = ProcessInfo.processInfo.environment["PENNANT_TEST_SCRATCH"].map { URL(fileURLWithPath: $0) }
            ?? FileManager.default.temporaryDirectory
        let folder = base.appending(path: "setup-\(UUID().uuidString.prefix(8))", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder
    }

    private func until(_ timeout: Duration = .seconds(60), _ condition: () async -> Bool) async -> Bool {
        let deadline = ContinuousClock.now + timeout
        while ContinuousClock.now < deadline {
            if await condition() { return true }
            try? await Task.sleep(for: .milliseconds(100))
        }
        return await condition()
    }

    @Test("pick a folder, import the save, pick a club: the server serves that club afterwards")
    func setupFlow() async throws {
        let run = try scratch()
        let data = run.appending(path: "data", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: data, withIntermediateDirectories: true)
        try FileManager.default.copyItem(at: try #require(StagedServer.league), to: data.appending(path: "league.db"))
        // A pretend OOTP save: the .lg folder with the synthetic league's export
        let save = run.appending(path: "saves/Synthetic League.lg", directoryHint: .isDirectory)
        let csv = save.appending(path: "import_export/csv", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: save.appending(path: "import_export", directoryHint: .isDirectory), withIntermediateDirectories: true)
        try FileManager.default.copyItem(at: try #require(StagedServer.export), to: csv)

        let configuration = ServerConfiguration(
            nodeExecutable: StagedServer.stage.appending(path: "Helpers/pennant-server"),
            serverRoot: StagedServer.stage.appending(path: "Resources/server", directoryHint: .isDirectory),
            dataFolder: data,
            logFolder: run.appending(path: "logs", directoryHint: .isDirectory),
            appVersion: "0.0.0-integration"
        )
        let model = AppModel(configuration: configuration, controller: ServerController(configuration: configuration, keySource: NoKeys()))
        await model.start()
        #expect(await until { model.isReady && model.settings != nil }, "not ready; see \(configuration.logFile.path)")
        #expect(model.needsSetup)

        let setup = SetupModel(client: { model.client }, onClubSaved: { await model.reloadAll() }, log: { model.logProblem($0) })
        await setup.load()
        #expect(setup.savesLoaded)

        setup.folderPath = save.path(percentEncoded: false)
        await setup.useFolder(status: model.status)
        #expect(setup.folderProblem == nil)
        #expect(setup.chosen?.name == "Synthetic League")

        // As the window does: each status the event stream brings is passed on when it changes (and the current one
        // once, as `.onChange(of:initial: true)` does), never polled, so a transition the window would miss is missed
        // here too
        var passed = model.status
        await setup.observe(passed)
        let landed = await until {
            if model.status != passed {
                passed = model.status
                await setup.observe(passed)
            }
            return setup.step != .importing || setup.importProblem != nil
        }
        #expect(landed)
        #expect(setup.importProblem == nil)
        #expect(setup.step == .pickClub)
        #expect(setup.clubs.first?.isHuman == true)
        #expect(setup.selectedClub == setup.clubs.first?.teamId)

        let other = try #require(setup.clubs.first { !$0.isHuman })
        setup.selectedClub = other.teamId
        await setup.saveClub()
        #expect(setup.step == .done)
        #expect(model.club?.ref == ClubRef(id: other.teamId))
        #expect(model.club?.source == .configured)
        // The status the event stream re-reads after the import says the save is chosen
        #expect(
            await until(.seconds(10)) { model.status?.configured == true },
            "status: configured \(String(describing: model.status?.configured)), last import \(String(describing: model.status?.lastImport?.finishedAt)), events connected \(model.eventStreamConnected)"
        )
        #expect(!model.needsSetup)

        await model.shutdown()
        #expect(!FileManager.default.fileExists(atPath: data.appending(path: "server.lock").path))
    }
}
