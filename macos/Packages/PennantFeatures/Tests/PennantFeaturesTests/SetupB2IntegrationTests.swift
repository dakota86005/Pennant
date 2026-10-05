import Foundation
import PennantAPI
import PennantKit
import Setup
import Shell
import Testing

/// A pretend Mac home with OOTP saves in it (the server's `PretendHome`, `tests/saveHomeFixture.ts`, in Swift): each save
/// the synthetic league's export, with the files OOTP writes on a save (`players.dat`, `flag_save_completed.dat`) dated
/// when it was "played". The server is given it as its home, so it never looks at the real one.
struct PretendHome {
    let root: URL
    var games: URL {
        root.appending(path: "Library/Application Support/Out of the Park Developments/OOTP Baseball 27/saved_games", directoryHint: .isDirectory)
    }

    /// A save played `hoursAgo`, its export the synthetic league's; `humanClubs` of them managed by the human (the
    /// export's first clubs).
    @discardableResult
    func save(_ name: String, playedHoursAgo hoursAgo: Double, humanClubs: Int = 1) throws -> Components.Schemas.SaveInfo {
        let manager = FileManager.default
        let lg = games.appending(path: "\(name).lg", directoryHint: .isDirectory)
        let csv = lg.appending(path: "import_export/csv", directoryHint: .isDirectory)
        try manager.createDirectory(at: lg.appending(path: "import_export", directoryHint: .isDirectory), withIntermediateDirectories: true)
        try manager.createDirectory(at: lg.appending(path: "settings", directoryHint: .isDirectory), withIntermediateDirectories: true)
        try manager.copyItem(at: try #require(StagedServer.export), to: csv)
        try Data("Show real player ratings,1\n".utf8).write(to: lg.appending(path: "settings/db_dump_standard_csv.cfg"))
        let played = Date.now.addingTimeInterval(-hoursAgo * 3600)
        for file in ["players.dat", "flag_save_completed.dat"] {
            let url = lg.appending(path: file)
            try Data("x".utf8).write(to: url)
            try manager.setAttributes([.modificationDate: played], ofItemAtPath: url.path(percentEncoded: false))
        }
        if humanClubs != 1 {
            // The export's teams file with the first `humanClubs` major-league clubs managed by the human (the synthetic
            // league lists each club's affiliate after it since N10: a farm club is never one the GM is asked to choose)
            let teams = csv.appending(path: "teams.csv")
            // Written again with its own time kept: a file newer than the rest by minutes reads as a new export's
            let written = try manager.attributesOfItem(atPath: teams.path(percentEncoded: false))[.modificationDate] as? Date
            var lines = try String(contentsOf: teams, encoding: .utf8).split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
            let header = lines[0].split(separator: ",", omittingEmptySubsequences: false).map(String.init)
            let column = try #require(header.firstIndex(of: "human_team"))
            let level = try #require(header.firstIndex(of: "level"))
            var managed = 0
            for index in lines.indices.dropFirst() where !lines[index].isEmpty {
                var fields = lines[index].split(separator: ",", omittingEmptySubsequences: false).map(String.init)
                let majorLeague = fields[level] == "1"
                if majorLeague { managed += 1 }
                fields[column] = majorLeague && managed <= humanClubs ? "1" : "0"
                lines[index] = fields.joined(separator: ",")
            }
            try lines.joined(separator: "\n").write(to: teams, atomically: true, encoding: .utf8)
            if let written { try manager.setAttributes([.modificationDate: written], ofItemAtPath: teams.path(percentEncoded: false)) }
        }
        return Components.Schemas.SaveInfo(name: name, lgPath: lg.path(percentEncoded: false), csvDir: csv.path(percentEncoded: false), csvCount: 1)
    }
}

/// Finding the save on the real server, as the app runs it (N6, Stage B2, D-063 and D-064): the zero-question first
/// run, nothing standing out, a save whose human manages several clubs, "played since" and its switch, and carrying a
/// rating history over and undoing it, with a refusal. Each on a scratch data folder with the synthetic league and a
/// pretend home (the server's `HOME`); never the real ones. Runs where `SetupIntegrationTests` runs.
@MainActor
@Suite("Finding the save on the real server (N6, Stage B2)", .serialized, .enabled(if: StagedServer.available))
struct SetupB2IntegrationTests {
    struct Run {
        let model: AppModel
        let home: PretendHome
        let data: URL
        let configuration: ServerConfiguration
        /// The run's scratch folder (`b2-…`), removed when the test ends.
        let folder: URL
    }

    /// Stops the server and removes the run's scratch folder (its data folder, logs and pretend home).
    private func finish(_ run: Run) async {
        await run.model.shutdown()
        try? FileManager.default.removeItem(at: run.folder)
    }

    private func until(_ timeout: Duration = .seconds(60), _ condition: () async -> Bool) async -> Bool {
        let deadline = ContinuousClock.now + timeout
        while ContinuousClock.now < deadline {
            if await condition() { return true }
            try? await Task.sleep(for: .milliseconds(100))
        }
        return await condition()
    }

    /// A scratch folder with the synthetic league in its data folder and a pretend home; `prepare` fills the home (and
    /// may choose a save in the data folder's configuration) before the server starts.
    private func start(_ prepare: (PretendHome, URL) throws -> Void) async throws -> Run {
        let base = ProcessInfo.processInfo.environment["PENNANT_TEST_SCRATCH"].map { URL(fileURLWithPath: $0) } ?? FileManager.default.temporaryDirectory
        let run = base.appending(path: "b2-\(UUID().uuidString.prefix(8))", directoryHint: .isDirectory)
        let data = run.appending(path: "data", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: data, withIntermediateDirectories: true)
        try FileManager.default.copyItem(at: try #require(StagedServer.league), to: data.appending(path: "league.db"))
        let home = PretendHome(root: run.appending(path: "home", directoryHint: .isDirectory))
        try FileManager.default.createDirectory(at: home.games, withIntermediateDirectories: true)
        try prepare(home, data)
        let configuration = ServerConfiguration(
            nodeExecutable: StagedServer.stage.appending(path: "Helpers/pennant-server"),
            serverRoot: StagedServer.stage.appending(path: "Resources/server", directoryHint: .isDirectory),
            dataFolder: data,
            logFolder: run.appending(path: "logs", directoryHint: .isDirectory),
            appVersion: "0.0.0-integration",
            extraEnvironment: ["HOME": home.root.path(percentEncoded: false)]
        )
        let model = AppModel(configuration: configuration, controller: ServerController(configuration: configuration, keySource: NoKeys()))
        await model.start()
        #expect(await until { model.isReady && model.settings != nil }, "not ready; see \(configuration.logFile.path)")
        return Run(model: model, home: home, data: data, configuration: configuration, folder: run)
    }

    private func setup(_ run: Run) -> SetupModel {
        let model = run.model
        return SetupModel(client: { model.client }, onClubSaved: { await model.reloadAll() }, log: { model.logProblem($0) })
    }

    /// Follows the import as the window does (each status the event stream brings), until the window leaves the import.
    private func follow(_ setup: SetupModel, _ model: AppModel) async -> Bool {
        var passed = model.status
        await setup.observe(passed)
        return await until {
            if model.status != passed {
                passed = model.status
                await setup.observe(passed)
            }
            return setup.step != .importing || setup.importProblem != nil
        }
    }

    private static func choose(_ data: URL, _ save: Components.Schemas.SaveInfo) throws {
        let config = ["csvDir": save.csvDir, "saveName": save.name]
        try JSONSerialization.data(withJSONObject: config).write(to: data.appending(path: "config.json"))
    }

    @Test("one save that clearly stands out: chosen, imported and its club followed, asking nothing")
    func zeroQuestions() async throws {
        let run = try await start { home, _ in try home.save("Synthetic League", playedHoursAgo: 2) }
        #expect(run.model.needsSetup)
        let setup = setup(run)
        await setup.begin(status: run.model.status)
        #expect(setup.automatic?.outcome.value1 == .started)
        #expect(setup.club?.decided == true)
        #expect(setup.discovery == nil, "the list was read though a save stands out")
        #expect(await follow(setup, run.model))
        #expect(setup.importProblem == nil)
        #expect(setup.step == .done)
        #expect(run.model.club?.ref == ClubRef(id: 1))
        #expect(await until(.seconds(10)) { run.model.status?.configured == true })
        // The window appearing again (idempotent): no second import
        let finished = run.model.status?.lastImport?.finishedAt
        let again = self.setup(run)
        await again.begin(status: run.model.status)
        #expect(again.automatic == nil)
        // Asked to set up by itself again (a window holding a status from before the save was chosen): the server
        // answers that a save is already chosen, and nothing is imported again
        let stale = self.setup(run)
        await stale.setUpAutomatically(status: run.model.status)
        #expect(stale.automatic?.outcome.value1 == .alreadyChosen)
        #expect(stale.automatic?.save?.name == "Synthetic League")
        #expect(stale.step == .findSave)
        try? await Task.sleep(for: .milliseconds(300))
        #expect(run.model.status?.importing == false)
        #expect(run.model.status?.lastImport?.finishedAt == finished)
        await finish(run)
    }

    @Test("two saves played within two days: nothing is chosen, the reason and the saves are shown, one click chooses")
    func nothingStandsOut() async throws {
        let run = try await start { home, _ in
            try home.save("Synthetic League", playedHoursAgo: 1)
            try home.save("Research Copy", playedHoursAgo: 5)
        }
        let setup = setup(run)
        await setup.begin(status: run.model.status)
        #expect(setup.automatic?.outcome.value1 == .nothingStandsOut)
        #expect(setup.step == .findSave)
        #expect(setup.discovery?.noPick?.reason.value1 == .tooClose)
        #expect(setup.discovery?.pick == nil)
        #expect(setup.saves.map(\.name) == ["Synthetic League", "Research Copy"])
        await setup.choose(setup.saves[1], status: run.model.status)
        #expect(await follow(setup, run.model))
        #expect(setup.step == .done)
        await finish(run)
    }

    @Test("a save whose human manages two clubs: chosen by itself, then only the club is asked")
    func severalClubs() async throws {
        let run = try await start { home, _ in try home.save("Two Clubs", playedHoursAgo: 2, humanClubs: 2) }
        let setup = setup(run)
        await setup.begin(status: run.model.status)
        #expect(setup.automatic?.outcome.value1 == .started)
        #expect(setup.club?.decided == false)
        #expect(setup.club?.humanClubs == 2)
        #expect(await follow(setup, run.model))
        #expect(setup.step == .pickClub, "step \(setup.step), problem \(String(describing: setup.importProblem)), club \(String(describing: setup.club)); see \(run.configuration.logFile.path)")
        #expect(setup.clubs.filter(\.isHuman).count == 2)
        let second = try #require(setup.clubs.filter(\.isHuman).last)
        setup.selectedClub = second.teamId
        await setup.saveClub()
        #expect(run.model.club?.ref == ClubRef(id: second.teamId))
        await finish(run)
    }

    @Test("another save played since: the notice is served, never acted on; the switch is the GM's, and the report follows")
    func playedSince() async throws {
        let run = try await start { home, data in
            let chosen = try home.save("Synthetic League", playedHoursAgo: 30)
            try home.save("Played Since", playedHoursAgo: 2)
            try Self.choose(data, chosen)
        }
        #expect(await until(.seconds(20)) { run.model.savePlayedElsewhere != nil }, "no played-since notice")
        let notice = try #require(run.model.savePlayedElsewhere)
        #expect(notice.kind.value1 == .otherSave)
        #expect(notice.actionText == "Switch to Played Since")
        // Nothing switched by itself
        #expect(run.model.status?.saveName == "Synthetic League")
        // The chosen save's own export is imported at the start (automatic import); the switch waits for it, as the
        // notice's button does
        #expect(await until(.seconds(90)) { run.model.status?.importing == false })
        let setup = setup(run)
        await setup.switchTo(notice.save, status: run.model.status)
        #expect(await follow(setup, run.model))
        #expect(setup.importProblem == nil)
        #expect(setup.step == .done, "step \(setup.step), problem \(String(describing: setup.importProblem)), folder \(String(describing: setup.folderProblem)); see \(run.configuration.logFile.path)")
        #expect(await until(.seconds(10)) { run.model.status?.saveName == "Played Since" && run.model.status?.saveId != nil })
        // The Morning Report follows the new save's import
        await run.model.loadFrontOffice()
        #expect(run.model.frontOffice.summary?.importStamp == run.model.storeKey?.importStamp)
        await finish(run)
    }

    /// Runs `sqlite3` on a file (the history database, while no server holds it).
    private static func sqlite(_ file: URL, _ sql: String) throws -> String {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/sqlite3")
        process.arguments = [file.path(percentEncoded: false), sql]
        let pipe = Pipe()
        process.standardOutput = pipe
        try process.run()
        process.waitUntilExit()
        return String(decoding: pipe.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
    }

    @Test("a save that moved: its history is offered, carried over with one click, undone, and a stale answer is refused")
    func historyAdoptUndo() async throws {
        // The save is imported where it was, so its history is kept under that folder
        let first = try await start { home, data in try Self.choose(data, try home.save("Old League", playedHoursAgo: 3)) }
        #expect(await until(.seconds(90)) {
            await first.model.loadRatingHistory()
            return first.model.ratingHistory?.status.text.hasPrefix("This save has rating history from 1 import") == true
        }, "the first import kept no history")
        await first.model.shutdown()
        // An earlier import in that history (the synthetic league has one date; a carry-over copies only the dates
        // before this league's own), written while no server holds the file
        let history = first.data.appending(path: "history.db")
        let columns = try Self.sqlite(history, "SELECT group_concat(name, ',') FROM pragma_table_info('save_rating_snapshots') WHERE name NOT IN ('save_key', 'game_date')")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        _ = try Self.sqlite(history, "INSERT INTO save_rating_snapshots (save_key, game_date, \(columns)) SELECT save_key, '2040-4-1', \(columns) FROM save_rating_snapshots")
        // The save is moved (renamed) in OOTP; the next launch finds it where it is now
        let old = first.home.games.appending(path: "Old League.lg")
        let now = first.home.games.appending(path: "New Name.lg")
        try FileManager.default.moveItem(at: old, to: now)
        let model = AppModel(configuration: first.configuration, controller: ServerController(configuration: first.configuration, keySource: NoKeys()))
        await model.start()
        #expect(await until { model.isReady && model.settings != nil && model.status?.importing == false })
        let run = Run(model: model, home: first.home, data: first.data, configuration: first.configuration, folder: first.folder)
        let setup = setup(run)
        let moved = Components.Schemas.SaveInfo(name: "New Name", lgPath: now.path(percentEncoded: false), csvDir: now.appending(path: "import_export/csv").path(percentEncoded: false), csvCount: 1)
        await setup.switchTo(moved, status: model.status)
        #expect(await follow(setup, model))
        #expect(setup.step == .done)
        #expect(await until(.seconds(30)) {
            await model.loadRatingHistory()
            return model.ratingHistory?.offers.isEmpty == false
        }, "no question about the save that moved: \(String(describing: model.ratingHistory?.status.text)); see \(first.configuration.logFile.path)")
        let offer = try #require(model.ratingHistory?.offers.first)
        #expect(offer.kind.value1 == .moved)
        #expect(offer.adoptText == "Carry It Over")
        #expect(offer.freshText == "Keep Them Apart")
        // Nothing carried over without the click
        #expect(model.ratingHistory?.carriedOver.isEmpty == true)
        try await model.answerRatingHistory(offer.id, choice: .adopt)
        let carry = try #require(model.ratingHistory?.carriedOver.first)
        #expect(carry.undoQuestion.hasPrefix("Undo the carry-over from \"Old League\"?"))
        #expect(model.ratingHistory?.offers.isEmpty == true)
        try await model.answerRatingHistory(carry.id, choice: .undo)
        #expect(model.ratingHistory?.carriedOver.isEmpty == true)
        // The same undo again: refused in the server's words, never an alert or a crash
        do {
            try await model.answerRatingHistory(carry.id, choice: .undo)
            Issue.record("a stale undo was not refused")
        } catch {
            guard case .served(let sentence) = error else {
                Issue.record("expected the server's sentence, got \(error)")
                return
            }
            #expect(sentence == "There is no carry-over like that to undo.")
        }
        await finish(run)
    }
}
