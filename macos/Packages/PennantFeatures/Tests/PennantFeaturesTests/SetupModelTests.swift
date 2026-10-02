import Foundation
import HTTPTypes
import OpenAPIRuntime
import PennantAPI
import PennantKit
import Setup
import Shell
import Testing

/// A server the test scripts: each operation answers with a status and a JSON body, and every request is recorded.
final class StubServer: ClientTransport, @unchecked Sendable {
    struct Request: Sendable {
        var operation: String
        var body: Data?
    }

    private let lock = NSLock()
    private var answers: [String: [(Int, String)]] = [:]
    private var _requests: [Request] = []

    var requests: [Request] { lock.withLock { _requests } }

    /// Answers `operation` with these (status, JSON) pairs in turn; the last one repeats.
    func answer(_ operation: String, _ replies: (Int, String)...) {
        lock.withLock { answers[operation] = replies }
    }

    /// Answers `operation` with a captured response from `contract/fixtures/responses/`.
    func answer(_ operation: String, fixture name: String, status: Int = 200) throws {
        let json = try String(contentsOf: PreviewFixtures.responses.appending(path: "\(name).json"), encoding: .utf8)
        answer(operation, (status, json))
    }

    func bodies(of operation: String) -> [[String: Any]] {
        requests.filter { $0.operation == operation }.compactMap { request in
            request.body.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        }
    }

    func send(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String) async throws -> (HTTPResponse, HTTPBody?) {
        var data: Data?
        if let body { data = try await Data(collecting: body, upTo: 1 << 20) }
        let reply: (Int, String) = lock.withLock {
            _requests.append(Request(operation: operationID, body: data))
            guard var queue = answers[operationID], let first = queue.first else { return (404, #"{"error":"not scripted"}"#) }
            if queue.count > 1 { queue.removeFirst(); answers[operationID] = queue }
            return first
        }
        var fields = HTTPFields()
        fields[.contentType] = "application/json"
        return (HTTPResponse(status: .init(code: reply.0), headerFields: fields), HTTPBody(reply.1))
    }
}

private func status(
    importing: Bool = false,
    progress: Components.Schemas.ImportProgress? = nil,
    finishedAt: String? = nil,
    lastError: String? = nil,
    csvDirExists: Bool = true,
    interruptedSince: String? = nil,
    note: Components.Schemas.ImportNote? = nil
) throws -> Components.Schemas.ServerStatus {
    var status = try #require(PreviewFixtures.status(configured: true))
    status.importing = importing
    status.importProgress = progress
    status.lastError = lastError
    status.csvDirExists = csvDirExists
    status.importInterruptedSince = interruptedSince
    status.importNote = note
    status.lastImport = finishedAt.map {
        .init(tables: 1, rows: 3, startedAt: "2040-07-01T11:59:00.000Z", finishedAt: $0, files: [])
    }
    return status
}

/// An import note as the server writes it (`server/presentation/importWords.ts`).
private func note(_ kind: String, _ text: String, detail: String? = nil) throws -> Components.Schemas.ImportNote {
    let body: [String: Any?] = ["kind": kind, "text": text, "detail": detail]
    let data = try JSONSerialization.data(withJSONObject: body.mapValues { $0 ?? NSNull() })
    return try JSONDecoder().decode(Components.Schemas.ImportNote.self, from: data)
}

private let failedNote = "The import stopped before it finished. Import again; the details are in the server log."

private func json(_ status: Components.Schemas.ServerStatus) throws -> String {
    String(decoding: try JSONEncoder().encode(status), as: UTF8.self)
}

/// The captured discovery (`getSaveDiscovery.json`), with where the server looked filled in and, when given, a pick.
private func discoveryJSON(pick: Bool = false) throws -> String {
    let data = try Data(contentsOf: PreviewFixtures.responses.appending(path: "getSaveDiscovery.json"))
    var object = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
    object["searched"] = [["label": "OOTP 27", "path": "/tmp/saved_games", "exists": true]]
    if pick, let noPick = object["noPick"] as? [String: Any] {
        object["pick"] = ["saveId": "saveid", "claim": noPick["claim"] as Any]
        object["noPick"] = NSNull()
    }
    return String(decoding: try JSONSerialization.data(withJSONObject: object), as: UTF8.self)
}

/// What `POST /api/v2/setup/automatic` answers: `started` with the captured save and a club taken from it (or not),
/// else the captured "nothing stands out".
private func automaticJSON(started: Bool, clubDecided: Bool = true) throws -> String {
    guard started else {
        return try String(contentsOf: PreviewFixtures.responses.appending(path: "setUpAutomatically-nothing-stands-out.json"), encoding: .utf8)
    }
    let nothing = try #require(try JSONSerialization.jsonObject(with: Data(contentsOf: PreviewFixtures.responses.appending(path: "setUpAutomatically-nothing-stands-out.json"))) as? [String: Any])
    let saves = try #require(try JSONSerialization.jsonObject(with: Data(contentsOf: PreviewFixtures.responses.appending(path: "listSaves.json"))) as? [[String: Any]])
    let club: [String: Any] = clubDecided
        ? ["decided": true, "teamId": 1, "name": "Club 1 N", "humanClubs": 1, "text": "Following the Club 1 N, the club you manage in this save."]
        : ["decided": false, "teamId": NSNull(), "name": NSNull(), "humanClubs": 2, "text": "You manage 2 clubs in this save, so Pennant will ask which to follow."]
    let object: [String: Any] = [
        "outcome": "started", "text": "Using Test League, the save you've played most recently.",
        "save": saves[0], "club": club, "why": nothing["why"] as Any,
    ]
    return String(decoding: try JSONSerialization.data(withJSONObject: object), as: UTF8.self)
}

@MainActor
@Suite("The Setup window's steps")
struct SetupModelTests {
    let server = StubServer()
    let client: Client

    init() throws {
        client = PennantClient.make(port: 1, token: String(repeating: "t", count: 64), transport: server)
        try server.answer("getSaveDiscovery", (200, discoveryJSON()))
        server.answer("setSave", (200, #"{"ok":true,"importStarted":true,"why":null,"club":null}"#))
        try server.answer("listOrgs", fixture: "listOrgs")
        try server.answer("getSettings", fixture: "getSettings")
        server.answer("saveSettings", (200, try String(contentsOf: PreviewFixtures.responses.appending(path: "saveSettings-club.json"), encoding: .utf8)))
    }

    func makeModel(onSaved: @escaping @MainActor () async -> Void = {}, automatic: Bool = true) -> SetupModel {
        let client = client
        return SetupModel(client: { client }, onClubSaved: onSaved, setsUpAutomatically: automatic)
    }

    @Test("finds the saves the server found and where it looked")
    func loads() async {
        let model = makeModel()
        await model.load()
        #expect(model.savesLoaded)
        #expect(model.saves.map(\.name) == ["Test League"])
        #expect(model.locations.map(\.label) == ["OOTP 27"])
    }

    @Test("a save chosen and imported leads to the club, the human-managed club first and preselected, and saving it closes Setup")
    func happyPath() async throws {
        var saved = false
        let model = makeModel { saved = true }
        await model.load()
        let before = try status(finishedAt: "2040-07-01T10:00:00.000Z")
        server.answer("getStatus", (200, try json(status(importing: true, finishedAt: "2040-07-01T10:00:00.000Z"))))
        await model.choose(model.saves[0], status: before)
        #expect(model.step == .importing)
        let body = try #require(server.bodies(of: "setSave").first)
        #expect(body["csvDir"] as? String == model.saves[0].csvDir)
        #expect(body["saveName"] as? String == "Test League")
        // The club is taken from the save when it names one (N6, Stage B2); this one's answer took none
        #expect(body["club"] as? String == "fromSave")

        let progress = Components.Schemas.ImportProgress(
            table: "players", fileIndex: 3, files: 10, rows: 1200, phase: .init(value1: .writing),
            words: .init(phase: "Writing the league", table: "Players", display: "Writing players · 3 of 10")
        )
        await model.observe(try status(importing: true, progress: progress, finishedAt: "2040-07-01T10:00:00.000Z"))
        #expect(model.progress == progress)
        #expect(model.step == .importing)

        await model.observe(try status(finishedAt: "2040-07-01T12:00:00.000Z"))
        #expect(model.step == .pickClub)
        #expect(model.clubs.first?.isHuman == true)
        #expect(model.selectedClub == 1)

        model.selectedClub = 3
        await model.saveClub()
        #expect(server.bodies(of: "saveSettings").first?["defaultOrgId"] as? Int == 3)
        #expect(server.bodies(of: "saveSettings").first?["clubChoice"] == nil)
        #expect(saved)
        #expect(model.step == .done)
        #expect(model.clubWasAsked)
    }

    @Test("with several human clubs, the chosen one is saved by its id: Automatic would follow only the first")
    func severalHumanClubs() async throws {
        let orgs = try String(contentsOf: PreviewFixtures.responses.appending(path: "listOrgs.json"), encoding: .utf8)
        // Every club in the captured list, made human
        server.answer("listOrgs", (200, orgs.replacingOccurrences(of: "\"isHuman\": false", with: "\"isHuman\": true")))
        let model = makeModel()
        await model.loadClubs()
        #expect(model.clubs.filter(\.isHuman).count > 1)
        let second = try #require(model.clubs.filter(\.isHuman).last)
        model.selectedClub = second.teamId
        await model.saveClub()
        let body = try #require(server.bodies(of: "saveSettings").first)
        #expect(body["defaultOrgId"] as? Int == second.teamId)
        #expect(body["clubChoice"] == nil)
    }

    @Test("the club the save's human manages is saved as Automatic, so the app follows him; any other by its id")
    func humanClubIsAutomatic() async throws {
        let model = makeModel()
        await model.loadClubs()
        let human = try #require(model.clubs.first { $0.isHuman })
        model.selectedClub = human.teamId
        await model.saveClub()
        let body = try #require(server.bodies(of: "saveSettings").first)
        #expect(body["clubChoice"] as? String == "automatic")
        #expect(body["defaultOrgId"] == nil)
    }

    @Test("an import that fails shows the server's sentence, and Try Again imports again")
    func importFails() async throws {
        let model = makeModel()
        server.answer("getStatus", (200, try json(status(importing: true))))
        await model.choose(PreviewFixtures.saves[0], status: try status())
        await model.observe(try status(lastError: "players.csv could not be read", note: note("failed", failedNote, detail: "players.csv could not be read")))
        #expect(model.importProblem == .served(failedNote, detail: "players.csv could not be read"))
        #expect(model.step == .importing)

        server.answer("startImport", (200, #"{"ok":true,"lastImport":null,"lastError":null}"#))
        server.answer("getStatus", (200, try json(status(finishedAt: "2040-07-01T12:00:00.000Z"))))
        await model.retryImport(status: try status())
        #expect(model.importProblem == nil)
        #expect(model.step == .pickClub)
    }

    @Test("a save whose export folder is not there never starts importing, and says why in the server's words")
    func importDoesNotStart() async throws {
        let model = makeModel()
        try server.answer("setSave", fixture: "setSave-no-export")
        await model.choose(PreviewFixtures.saves[0], status: try status())
        #expect(model.step == .importing)
        guard case .served(let why, _) = model.importProblem else {
            Issue.record("expected the server's sentence, got \(String(describing: model.importProblem))")
            return
        }
        #expect(why.contains("no export yet"))
        #expect(server.requests.filter { $0.operation == "getStatus" }.isEmpty)
        model.restart()
        #expect(model.step == .findSave)
        #expect(model.importProblem == nil)
    }

    @Test("a save whose import did not start, with no word from the server, says it did not start (never \"finish\")")
    func notStartedWithoutWords() async throws {
        let model = makeModel()
        server.answer("setSave", (200, #"{"ok":true,"importStarted":false,"why":null}"#))
        await model.choose(PreviewFixtures.saves[0], status: try status())
        #expect(model.importProblem == .notStarted)
    }

    @Test("a refused save shows the server's sentence and stays on the first step")
    func refusedSave() async throws {
        let model = makeModel()
        try server.answer("setSave", fixture: "setSave-no-folder", status: 400)
        await model.choose(PreviewFixtures.saves[0], status: nil)
        #expect(model.step == .findSave)
        #expect(model.folderProblem == .served("csvDir is required"))
    }

    @Test("a picked folder that is an export is chosen at once")
    func folderIsExport() async throws {
        let model = makeModel()
        try server.answer("resolveFolder", fixture: "resolveFolder-export")
        server.answer("getStatus", (200, try json(status(importing: true))))
        model.folderPath = "/tmp/Test League.lg"
        await model.useFolder(status: try status())
        #expect(server.bodies(of: "resolveFolder").first?["path"] as? String == "/tmp/Test League.lg")
        #expect(model.step == .importing)
        #expect(model.chosen?.name == "Test League")
    }

    @Test("a picked folder of saves lists them; a folder the server cannot use shows its sentence")
    func folderChoicesAndRefusal() async throws {
        let model = makeModel()
        try server.answer("resolveFolder", fixture: "resolveFolder-saves")
        model.folderPath = "/tmp/saved_games"
        await model.useFolder(status: nil)
        #expect(model.folderChoices?.map(\.name) == ["Test League"])
        #expect(model.step == .findSave)

        try server.answer("resolveFolder", fixture: "resolveFolder-no-folder", status: 400)
        await model.useFolder(status: nil)
        #expect(model.folderChoices == nil)
        #expect(model.folderProblem == .served("No folder given."))
    }

    @Test("a status from before the import was seen running is not taken for its end or its failure")
    func waitsForItsOwnImport() async throws {
        let model = makeModel()
        server.answer("getStatus", (200, try json(status(importing: true, finishedAt: "2040-07-01T10:00:00.000Z"))))
        await model.choose(PreviewFixtures.saves[0], status: try status(finishedAt: "2040-07-01T10:00:00.000Z"))
        #expect(model.step == .importing)
        // The event stream's view can lag behind the request: an old status (not importing, the old stamp, an old
        // failure) that arrives after the fresh read showed the import running is the old import's
        await model.observe(try status(importing: true, finishedAt: "2040-07-01T10:00:00.000Z"))
        #expect(model.importProblem == nil)
    }

    @Test("an import that fails before the window sees it running is a served failure with Try Again, never a hang")
    func fastFailure() async throws {
        let model = makeModel()
        // The fresh read after choosing: the import already ended, the stamp unmoved, the server's sentence set
        server.answer("getStatus", (200, try json(status(
            finishedAt: "2040-07-01T10:00:00.000Z", lastError: "players.csv could not be parsed",
            note: note("failed", failedNote, detail: "players.csv could not be parsed")
        ))))
        await model.choose(PreviewFixtures.saves[0], status: try status(finishedAt: "2040-07-01T10:00:00.000Z"))
        #expect(model.step == .importing)
        #expect(model.importProblem == .served(failedNote, detail: "players.csv could not be parsed"))
    }

    @Test("an import that stopped partway is a problem, never a reason to go on to the club")
    func interrupted() async throws {
        let model = makeModel()
        server.answer("getStatus", (200, try json(status(importing: true, finishedAt: "2040-07-01T10:00:00.000Z"))))
        await model.choose(PreviewFixtures.saves[0], status: try status(finishedAt: "2040-07-01T10:00:00.000Z"))
        let stopped = "The last import stopped before it finished. Import again to finish it."
        await model.observe(try status(finishedAt: "2040-07-01T10:00:00.000Z", interruptedSince: "2040-07-01T11:00:00.000Z", note: note("interrupted", stopped)))
        #expect(model.importProblem == .served(stopped))
        #expect(model.step == .importing)
    }

    @Test("an import that ended with no new import and no sentence from the server did not finish; the club step waits")
    func endedWithoutLanding() async throws {
        let model = makeModel()
        server.answer("getStatus", (200, try json(status(importing: true, finishedAt: "2040-07-01T10:00:00.000Z"))))
        await model.choose(PreviewFixtures.saves[0], status: try status(finishedAt: "2040-07-01T10:00:00.000Z"))
        await model.observe(try status(finishedAt: "2040-07-01T10:00:00.000Z"))
        #expect(model.importProblem == .unexplained)
        #expect(model.step == .importing)
    }

    @Test("nothing is chosen while an import runs, and the server's refusal is shown if it comes")
    func importRunning() async throws {
        let model = makeModel()
        await model.choose(PreviewFixtures.saves[0], status: try status(importing: true))
        #expect(server.bodies(of: "setSave").isEmpty)
        try server.answer("setSave", fixture: "setSave-import-running", status: 409)
        await model.choose(PreviewFixtures.saves[0], status: try status())
        #expect(model.step == .findSave)
        guard case .served(let sentence) = model.folderProblem else {
            Issue.record("expected the server's sentence")
            return
        }
        #expect(sentence.contains("already running"))
    }

    @Test("a failed read of the saves or the clubs is a problem, never \"none found\" or an empty list")
    func failedReads() async throws {
        var logged: [String] = []
        let client = client
        let model = SetupModel(client: { client }, log: { logged.append($0) })
        server.answer("getSaveDiscovery", (500, "{}"))
        await model.load()
        guard case .failed = model.loadProblem else {
            Issue.record("expected a failure, got \(String(describing: model.loadProblem))")
            return
        }
        #expect(!logged.isEmpty)
        server.answer("listOrgs", (500, "{}"))
        await model.loadClubs()
        guard case .failed = model.clubProblem else {
            Issue.record("expected a failure")
            return
        }
        #expect(model.clubs.isEmpty)
        #expect(SetupModel(client: { nil }).loadProblem == nil)
        let down = SetupModel(client: { nil })
        await down.load()
        #expect(down.loadProblem == .notRunning)
    }

    // MARK: The zero-question first run (N6, Stage B2)

    @Test("a first run with a save that clearly stands out asks nothing: it follows the import, the club taken from the save, and closes")
    func zeroQuestions() async throws {
        var reloaded = false
        let model = makeModel { reloaded = true }
        server.answer("setUpAutomatically", (200, try automaticJSON(started: true)))
        server.answer("getStatus", (200, try json(status(importing: true, finishedAt: "2040-07-01T10:00:00.000Z"))))
        var first = try status(finishedAt: "2040-07-01T10:00:00.000Z")
        first.configured = false
        await model.begin(status: first)
        #expect(model.step == .importing)
        #expect(model.automatic?.text == "Using Test League, the save you've played most recently.")
        #expect(model.club?.decided == true)
        #expect(model.chosen?.name == "Test League")
        // No list was read and no save was chosen by the window: the server chose it
        #expect(server.requests.filter { $0.operation == "getSaveDiscovery" || $0.operation == "setSave" }.isEmpty)
        await model.observe(try status(finishedAt: "2040-07-01T12:00:00.000Z"))
        #expect(model.step == .done)
        // Closing shows the import it followed: the club was never asked (N6 polish: never an empty club step)
        #expect(model.clubWasAsked == false)
        #expect(reloaded)
        #expect(server.requests.filter { $0.operation == "listOrgs" || $0.operation == "saveSettings" }.isEmpty)
        // Asked again (the window reappears): nothing more
        await model.begin(status: first)
        #expect(server.requests.filter { $0.operation == "setUpAutomatically" }.count == 1)
    }

    @Test("a run that ends counts once, however fast its import landed, so the open window closes on it (N8: the flake)")
    func completionCounts() async throws {
        let model = makeModel {}
        server.answer("setUpAutomatically", (200, try automaticJSON(started: true)))
        // The import has already landed when the window first reads the status: a fifth of a second's import
        server.answer("getStatus", (200, try json(status(finishedAt: "2040-07-01T12:00:00.000Z"))))
        var first = try status(finishedAt: "2040-07-01T10:00:00.000Z")
        first.configured = false
        let opened = model.completions
        await model.begin(status: first)
        #expect(model.step == .done)
        #expect(model.completions == opened + 1)
        // The same news again changes nothing; a window opened on the finished model starts again, and is not closed
        await model.observe(try status(finishedAt: "2040-07-01T12:00:00.000Z"))
        #expect(model.completions == opened + 1)
        #expect(model.reopen())
        #expect(model.completions == opened + 1)
    }

    @Test("a first run where the save's human manages several clubs asks only the club")
    func zeroQuestionsButTheClub() async throws {
        let model = makeModel()
        server.answer("setUpAutomatically", (200, try automaticJSON(started: true, clubDecided: false)))
        server.answer("getStatus", (200, try json(status(importing: true, finishedAt: "2040-07-01T10:00:00.000Z"))))
        var first = try status(finishedAt: "2040-07-01T10:00:00.000Z")
        first.configured = false
        await model.begin(status: first)
        await model.observe(try status(finishedAt: "2040-07-01T12:00:00.000Z"))
        #expect(model.step == .pickClub)
        #expect(model.club?.text == "You manage 2 clubs in this save, so Pennant will ask which to follow.")
    }

    @Test("when nothing stands out the served reason is kept and the saves are listed; choosing one is one click")
    func nothingStandsOut() async throws {
        let model = makeModel()
        server.answer("setUpAutomatically", (200, try automaticJSON(started: false)))
        var first = try status()
        first.configured = false
        await model.begin(status: first)
        #expect(model.step == .findSave)
        #expect(model.automatic?.outcome.value1 == .nothingStandsOut)
        #expect(model.automatic?.why?.text == "None of these saves has been saved in OOTP yet")
        #expect(model.savesLoaded)
        #expect(model.discovery?.noPick?.reason.value1 == .neverPlayed)
        #expect(model.saves.map(\.name) == ["Test League"])
        server.answer("getStatus", (200, try json(status(importing: true))))
        await model.choose(model.saves[0], status: try status())
        #expect(model.step == .importing)
        #expect(server.bodies(of: "setSave").first?["club"] as? String == "fromSave")
    }

    @Test("with a save chosen, or on a development build without a pretend home, nothing is set up by itself")
    func noAutomaticSetup() async throws {
        let chosen = makeModel()
        await chosen.begin(status: try status())
        let unconfigured = makeModel(automatic: false)
        var first = try status()
        first.configured = false
        await unconfigured.begin(status: first)
        #expect(server.requests.filter { $0.operation == "setUpAutomatically" }.isEmpty)
        #expect(chosen.savesLoaded && unconfigured.savesLoaded)
    }

    @Test("the pick is marked with its served line, and only the pick")
    func pickMarked() async throws {
        server.answer("getSaveDiscovery", (200, try discoveryJSON(pick: true)))
        let model = makeModel()
        await model.load()
        let save = try #require(model.saves.first)
        #expect(model.isPick(save))
        #expect(model.pickClaim?.text == "None of these saves has been saved in OOTP yet")
        var other = save
        other.id = "another"
        #expect(!model.isPick(other))
    }

    @Test("a switch clicked in the main window chooses that save at once; with the club taken from it, it closes on landing")
    func switchToPlayedSince() async throws {
        var reloaded = false
        let model = makeModel { reloaded = true }
        server.answer("setSave", (200, #"{"ok":true,"importStarted":true,"why":null,"club":{"decided":true,"teamId":1,"name":"Club 1 N","humanClubs":1,"text":"Following the Club 1 N, the club you manage in this save."}}"#))
        server.answer("getStatus", (200, try json(status(importing: true, finishedAt: "2040-07-01T10:00:00.000Z"))))
        let other = PreviewFixtures.saves[0]
        await model.switchTo(other, status: try status(finishedAt: "2040-07-01T10:00:00.000Z"))
        #expect(model.step == .importing)
        #expect(server.bodies(of: "setSave").first?["csvDir"] as? String == other.csvDir)
        await model.observe(try status(finishedAt: "2040-07-01T12:00:00.000Z"))
        #expect(model.step == .done)
        #expect(reloaded)
    }

    // MARK: The club owed (N6 Stage B2 review, M4 and H1)

    private static let severalClubs = #"{"ok":true,"importStarted":true,"why":null,"club":{"decided":false,"teamId":null,"name":null,"humanClubs":2,"text":"You manage 2 clubs in this save, so Pennant will ask which to follow."}}"#

    @Test("a club the server can't settle holds the report from the choice until the club is saved, with no window involved")
    func clubOwedHoldsTheReport() async throws {
        let routing = AppRouting()
        let model = routing.setupModel { makeModel() }
        server.answer("setSave", (200, Self.severalClubs))
        server.answer("getStatus", (200, try json(status(importing: true, finishedAt: "2040-07-01T10:00:00.000Z"))))
        await model.load()
        #expect(!routing.awaitingClub)
        await model.choose(model.saves[0], status: try status(finishedAt: "2040-07-01T10:00:00.000Z"))
        // Held from the moment the save is chosen, while it imports, and it says why in the server's words
        #expect(model.step == .importing)
        #expect(routing.awaitingClub)
        #expect(routing.owedClubText == "You manage 2 clubs in this save, so Pennant will ask which to follow.")
        // The same model is the app's: asking again makes no other
        #expect(routing.setupModel { makeModel() } === model)
        await model.observe(try status(finishedAt: "2040-07-01T12:00:00.000Z"))
        #expect(model.step == .pickClub)
        #expect(routing.awaitingClub)
        model.selectedClub = 1
        await model.saveClub()
        #expect(!routing.awaitingClub)
    }

    @Test("closing Setup mid-import on a save with several clubs keeps the hold; opening it again comes back to the club question")
    func closedMidImport() async throws {
        let routing = AppRouting()
        let model = routing.setupModel { makeModel() }
        server.answer("setSave", (200, Self.severalClubs))
        server.answer("getStatus", (200, try json(status(importing: true, finishedAt: "2040-07-01T10:00:00.000Z"))))
        await model.load()
        await model.choose(model.saves[0], status: try status(finishedAt: "2040-07-01T10:00:00.000Z"))
        // The window closes mid-import: nothing tells the model, and the import lands meanwhile, unseen. Then the GM goes
        // back to the saves in the window and closes it again: the club is still owed
        model.restart()
        #expect(model.step == .findSave)
        #expect(routing.awaitingClub)
        // "Choose Your Club…" (or Set Up Pennant…): back to the question, from the served status
        routing.requestClubQuestion()
        #expect(routing.takeClubRequest())
        #expect(!routing.takeClubRequest())
        await model.resumeClubQuestion(status: try status(finishedAt: "2040-07-01T12:00:00.000Z"))
        #expect(model.step == .pickClub)
        #expect(model.club?.decided == false)
        #expect(routing.awaitingClub)
    }

    @Test("a choice whose club is settled lets an owed club go: the GM's kept club, or the one the save names")
    func settledChoiceReleases() async throws {
        let routing = AppRouting()
        let model = routing.setupModel { makeModel() }
        server.answer("setSave", (200, Self.severalClubs), (200, #"{"ok":true,"importStarted":true,"why":null,"club":{"decided":true,"teamId":3,"name":"Club 3 N","humanClubs":2,"text":"Keeping the Club 3 N, the club you chose."}}"#))
        server.answer("getStatus", (200, try json(status(importing: true, finishedAt: "2040-07-01T10:00:00.000Z"))))
        await model.load()
        await model.choose(model.saves[0], status: try status(finishedAt: "2040-07-01T10:00:00.000Z"))
        #expect(routing.awaitingClub)
        model.restart()
        await model.choose(model.saves[0], status: try status(finishedAt: "2040-07-01T10:00:00.000Z"))
        #expect(!routing.awaitingClub)
        #expect(model.club?.text == "Keeping the Club 3 N, the club you chose.")
    }

    @Test("the served club is preselected only when this save's human manages it: a club from another league never is")
    func preselectsOnlyAHumanClub() async throws {
        // The served club is team 2, which no human manages in this save (a club chosen in another league)
        let settings = try String(contentsOf: PreviewFixtures.responses.appending(path: "getSettings.json"), encoding: .utf8)
        server.answer("getSettings", (200, settings.replacingOccurrences(of: "\"id\": 1,", with: "\"id\": 2,")))
        let model = makeModel()
        await model.loadClubs()
        let human = try #require(model.clubs.first { $0.isHuman })
        #expect(model.clubs.contains { $0.teamId == 2 && !$0.isHuman })
        #expect(model.selectedClub == human.teamId)
    }

    @Test("a folder is not checked twice while a request is under way")
    func useFolderWhileBusy() async throws {
        let model = makeModel()
        server.answer("resolveFolder", (200, #"{"ok":true,"csvDir":"/tmp/x/import_export/csv","saveName":"X","csvCount":3}"#))
        server.answer("getStatus", (200, try json(status(importing: true))))
        model.folderPath = "/tmp/x"
        let now = try status()
        async let first: Void = model.useFolder(status: now)
        async let second: Void = model.useFolder(status: now)
        _ = await (first, second)
        #expect(server.requests.filter { $0.operation == "resolveFolder" }.count == 1)
    }
}
