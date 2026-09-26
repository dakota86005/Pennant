import Foundation
import OpenAPIRuntime
import PennantAPI
import Testing
@testable import PennantKit

/// `AppModel` over a scripted server and the captured answers: it follows the server's state, reads the status,
/// settings, clubs and data status, resolves the club, applies events, and re-reads the status when a known event
/// does not decode.
@Suite("The app model")
@MainActor
struct AppModelTests {
    private func model(events sse: String, status: Components.Schemas.ServerStatus) throws -> (AppModel, RoutedTransport) {
        let transport = RoutedTransport([
            "/api/status": try RoutedTransport.json("getStatus"),
            "/api/settings": try RoutedTransport.json("getSettings"),
            "/api/orgs": try RoutedTransport.json("listOrgs"),
            "/api/v2/data-status": try RoutedTransport.json("getDataStatusWords"),
            "/api/v2/catalog": try RoutedTransport.json("getCatalog"),
            "/api/v2/events": RoutedTransport.sse(sse),
        ])
        let configuration = try fakeConfiguration()
        let controller = ServerController(
            configuration: configuration,
            launcher: FakeLauncher { process, _ in process.ready() },
            keySource: NoKeys(),
            probe: { _, _ in status },
            timing: fastTiming
        )
        let model = AppModel(configuration: configuration, controller: controller) { connection in
            PennantClient.make(port: connection.port, token: connection.token, transport: transport)
        }
        return (model, transport)
    }

    @Test("ready: the status, the settings, the clubs, the data status and the club the save's human manages")
    func followsTheServer() async throws {
        let status = try fixtureStatus()
        let (model, transport) = try model(events: "", status: status)
        await model.start()
        #expect(await eventually { model.club != nil && model.dataStatus != nil && model.catalog != nil })
        #expect(model.serverState.connection != nil)
        #expect(model.status == status)
        #expect(model.settings?.dataDir == "/tmp/ootp-fo-test")
        #expect(model.dataFolderPath == "/tmp/ootp-fo-test")
        #expect(model.orgs.count == 4)
        #expect(model.club?.ref == ClubRef(id: 1))
        #expect(model.club?.org?.label == "Club 1 N")
        #expect(model.club?.source == .humanManaged)
        #expect(model.dataStatus?.subtitle == "May 6, 2040 · No log")
        #expect(model.catalogClub?.record.display == "15–15")
        #expect(transport.paths.contains("/api/v2/events"))
        await model.shutdown()
        #expect(model.serverState == .stopped)
        #expect(model.client == nil)
    }

    @Test("import-progress and import-finished events update the served status")
    func importProgress() async throws {
        let status = try fixtureStatus()
        let (model, transport) = try model(events: "", status: status)
        await model.start()
        #expect(await eventually { model.club != nil })

        let progress = try JSONDecoder().decode(Components.Schemas.ServerEvent.self, from: Data(
            #"{"type":"import-progress","progress":{"table":"players","fileIndex":2,"files":70,"rows":1200,"phase":"writing","words":{"phase":"Writing the league","table":"Players","display":"Writing players · 2 of 70"}}}"#.utf8
        ))
        await model.handle(.event(progress))
        #expect(model.isImporting)
        #expect(model.importProgress?.table == "players")
        #expect(model.importProgress?.words.display == "Writing players · 2 of 70")

        let finished = try JSONDecoder().decode(Components.Schemas.ServerEvent.self, from: Data(
            #"{"type":"import-finished","lastImport":{"tables":70,"rows":9000,"startedAt":"2040-07-02T10:00:00.000Z","finishedAt":"2040-07-02T10:01:00.000Z","files":[]},"error":null,"note":null}"#.utf8
        ))
        let before = transport.paths.filter { $0 == "/api/status" }.count
        await model.handle(.event(finished))
        #expect(transport.paths.filter { $0 == "/api/status" }.count == before + 1)
        #expect(model.isImporting == false)
        #expect(model.importProgress == nil)

        let pending = try JSONDecoder().decode(Components.Schemas.ServerEvent.self, from: Data(
            #"{"type":"export-pending","since":"2040-07-03T09:00:00.000Z"}"#.utf8
        ))
        await model.handle(.event(pending))
        #expect(model.exportPendingSince == "2040-07-03T09:00:00.000Z")
        await model.shutdown()
    }

    @Test("the import stamp follows the last import's finish, not every status")
    func importStamp() async throws {
        let status = try fixtureStatus()
        let (model, _) = try model(events: "", status: status)
        await model.start()
        #expect(await eventually { model.club != nil })
        #expect(model.importStamp == "")
        var imported = status
        imported.lastImport = Components.Schemas.ImportResult(
            tables: 1, rows: 2, startedAt: "2040-07-02T10:00:00.000Z", finishedAt: "2040-07-02T10:01:00.000Z", files: []
        )
        let hello = Components.Schemas.ServerEvent(value1: .init(_type: .hello, status: imported))
        await model.handle(.event(hello))
        #expect(model.importStamp == "2040-07-02T10:01:00.000Z")
        await model.shutdown()
    }

    @Test("a known event that did not decode is reported and the status is read again")
    func malformedEvent() async throws {
        let status = try fixtureStatus()
        let (model, transport) = try model(events: "", status: status)
        await model.start()
        #expect(await eventually { model.club != nil })
        let before = transport.paths.filter { $0 == "/api/status" }.count
        await model.handle(.malformed(type: "hello"))
        #expect(model.eventProblems.map(\.type) == ["hello"])
        #expect(transport.paths.filter { $0 == "/api/status" }.count == before + 1)
        await model.shutdown()
    }

    @Test("the first start on a data folder takes the backup; the next start does not")
    func backupOnce() async throws {
        let status = try fixtureStatus()
        let (model, _) = try model(events: "", status: status)
        try FileManager.default.createDirectory(at: model.configuration.dataFolder, withIntermediateDirectories: true)
        try Data("{}".utf8).write(to: model.configuration.dataFolder.appending(path: "settings.json"))
        await model.start()
        #expect(await eventually { model.backupOutcome != nil })
        guard case .backedUp(let record) = model.backupOutcome else {
            Issue.record("no backup: \(String(describing: model.backupOutcome))")
            return
        }
        #expect(record.files == ["settings.json"])
        await model.shutdown()

        let again = AppModel(configuration: model.configuration, controller: ServerController(
            configuration: model.configuration, launcher: FakeLauncher { process, _ in process.ready() },
            keySource: NoKeys(), probe: { _, _ in status }, timing: fastTiming
        ))
        await again.start()
        #expect(await eventually { again.backupOutcome == .alreadyDone(record) })
        await again.shutdown()
    }
}

@Suite("The current club")
struct CurrentClubTests {
    private func orgs() throws -> [Components.Schemas.Org] {
        try JSONDecoder().decode([Components.Schemas.Org].self, from: fixtureData("responses/listOrgs.json"))
    }

    private func served(_ json: String) throws -> Components.Schemas.CurrentOrganization {
        try JSONDecoder().decode(Components.Schemas.CurrentOrganization.self, from: Data(json.utf8))
    }

    @Test("the captured settings serve the human-managed club, and the app takes it as served")
    func capturedSettings() throws {
        let settings = try JSONDecoder().decode(
            Components.Schemas.SettingsResponse.self, from: fixtureData("responses/getSettings.json")
        )
        let club = CurrentClub.from(served: settings.organization, orgs: try orgs())
        #expect(club?.ref == ClubRef(id: 1))
        #expect(club?.source == .humanManaged)
        #expect(club?.org?.label == "Club 1 N")
    }

    @Test("a configured club the list does not have stays the served club, never swapped for the human-managed one")
    func configuredNotInList() throws {
        let club = CurrentClub.from(served: try served(#"{"id":999,"source":"configured","humanClubs":1,"note":null}"#), orgs: try orgs())
        #expect(club?.ref == ClubRef(id: 999))
        #expect(club?.source == .configured)
        #expect(club?.org == nil)
    }

    @Test("a configured club in the list is found there")
    func configured() throws {
        let club = CurrentClub.from(served: try served(#"{"id":3,"source":"configured","humanClubs":1,"note":null}"#), orgs: try orgs())
        #expect(club?.org?.label == "Club 3 N")
    }

    @Test("no served club is no club, never a guess; a newer source is kept as it came")
    func noneOrNewer() throws {
        #expect(CurrentClub.from(served: nil, orgs: try orgs()) == nil)
        let club = CurrentClub.from(served: try served(#"{"id":2,"source":"commissioner","humanClubs":0,"note":null}"#), orgs: try orgs())
        #expect(club?.source == .other("commissioner"))
    }
}

/// Asking the server to do something: an import (Club ▸ Refresh Data, Settings ▸ Import Now) and saving the settings
/// (Setup's club, the appearance).
@Suite("The app model's requests")
@MainActor
struct AppModelRequestTests {
    private func model(_ transport: RoutedTransport) throws -> AppModel {
        let configuration = try fakeConfiguration()
        let status = try fixtureStatus()
        let controller = ServerController(
            configuration: configuration, launcher: FakeLauncher { process, _ in process.ready() }, keySource: NoKeys(),
            probe: { _, _ in status }, timing: fastTiming
        )
        return AppModel(configuration: configuration, controller: controller) { connection in
            PennantClient.make(port: connection.port, token: connection.token, transport: transport)
        }
    }

    private func answers(_ extra: [String: (contentType: String, body: Data)]) throws -> [String: (contentType: String, body: Data)] {
        try [
            "/api/status": RoutedTransport.json("getStatus"),
            "/api/settings": RoutedTransport.json("getSettings"),
            "/api/orgs": RoutedTransport.json("listOrgs"),
            "/api/v2/data-status": RoutedTransport.json("getDataStatusWords"),
            "/api/v2/catalog": RoutedTransport.json("getCatalog"),
        ].merging(extra) { $1 }
    }

    @Test("a refused import returns the server's own sentence and keeps it for the windows; without a server it is a failure, not a start")
    func importRefused() async throws {
        let transport = RoutedTransport(
            try answers(["POST /api/import": RoutedTransport.json("startImport-no-save")]),
            statuses: ["POST /api/import": 400]
        )
        let model = try model(transport)
        #expect(await model.startImport() == .notRunning)
        #expect(model.importRequestProblem == .notRunning)
        #expect(!transport.paths.contains("/api/import"))
        await model.start()
        #expect(await eventually { model.settings != nil })
        #expect(await model.startImport() == .served("No save configured"))
        #expect(model.importRequestProblem == .served("No save configured"))
        model.dismissImportRequestProblem()
        #expect(model.importRequestProblem == nil)
        await model.shutdown()
    }

    @Test("an import refused because one is running says so in the server's words")
    func importAlreadyRunning() async throws {
        let transport = RoutedTransport(
            try answers(["POST /api/import": RoutedTransport.json("startImport-import-running")]),
            statuses: ["POST /api/import": 409]
        )
        let model = try model(transport)
        await model.start()
        #expect(await eventually { model.settings != nil })
        let problem = await model.startImport()
        guard case .served(let sentence) = problem else {
            Issue.record("expected the server's sentence, got \(String(describing: problem))")
            return
        }
        #expect(sentence.contains("already running"))
        await model.shutdown()
    }

    @Test("a request that fails is a kind of problem with its detail kept for the log, never shown as text")
    func requestFailure() async throws {
        let transport = RoutedTransport(try answers([:]), statuses: ["POST /api/settings": 500])
        let model = try model(transport)
        await model.start()
        #expect(await eventually { model.settings != nil })
        do {
            try await model.saveSettings(.init(defaultOrgId: 2))
            Issue.record("expected a problem")
        } catch {
            guard case .failed(let detail) = error else {
                Issue.record("expected .failed, got \(error)")
                return
            }
            #expect(detail.contains("500"))
        }
        guard case .unreachable = RequestProblem.from(URLError(.timedOut)) else {
            Issue.record("a timeout is the server not reached")
            return
        }
        await model.shutdown()
    }

    @Test("an accepted import marks the status as importing until the events say otherwise")
    func importAccepted() async throws {
        let transport = RoutedTransport(try answers([
            "POST /api/import": ("application/json", Data(#"{"ok":true,"lastImport":null,"lastError":null}"#.utf8)),
        ]))
        let model = try model(transport)
        await model.start()
        #expect(await eventually { model.settings != nil })
        #expect(await model.startImport() == nil)
        #expect(model.isImporting)
        await model.shutdown()
    }

    @Test("saving settings sends only the fields given and reads the settings again")
    func saveSettings() async throws {
        let transport = RoutedTransport(try answers(["POST /api/settings": RoutedTransport.json("saveSettings-club")]))
        let model = try model(transport)
        await expectThrows { try await model.saveSettings(.init(defaultOrgId: 2)) }
        do { try await model.saveSettings(.init(defaultOrgId: 2)) } catch { #expect(error == .notRunning) }
        await model.start()
        #expect(await eventually { model.settings != nil })
        let before = transport.paths.filter { $0 == "/api/settings" }.count
        try await model.saveSettings(.init(defaultOrgId: 2))
        let sent = try #require(transport.body("POST /api/settings"))
        #expect(try JSONSerialization.jsonObject(with: sent) as? [String: Int] == ["defaultOrgId": 2])
        #expect(transport.paths.filter { $0 == "/api/settings" }.count == before + 2)
        await model.shutdown()
    }

    @Test("the Setup window's cue: the server up with no save chosen")
    func needsSetup() async throws {
        let model = try model(RoutedTransport(try answers([:])))
        #expect(!model.needsSetup)
        await model.start()
        #expect(await eventually { model.status != nil })
        #expect(model.needsSetup == (model.status?.configured == false))
        #expect(model.isReady)
        await model.shutdown()
        #expect(!model.needsSetup)
        #expect(!model.isReady)
    }

    private func expectThrows(_ work: () async throws -> Void) async {
        do {
            try await work()
            Issue.record("expected an error")
        } catch {}
    }
}

/// Stores reload on the import, the club and restores, once at launch (review N5).
@Suite("The stores' reload key")
@MainActor
struct StoreKeyTests {
    @Test("nil until ready with settings; then the import stamp and the served club; a restore moves it")
    func storeKey() async throws {
        let configuration = try fakeConfiguration()
        let status = try fixtureStatus()
        let transport = RoutedTransport([
            "/api/status": try RoutedTransport.json("getStatus"),
            "/api/settings": try RoutedTransport.json("getSettings"),
            "/api/orgs": try RoutedTransport.json("listOrgs"),
            "/api/v2/data-status": try RoutedTransport.json("getDataStatusWords"),
            "/api/v2/catalog": try RoutedTransport.json("getCatalog"),
        ])
        let controller = ServerController(
            configuration: configuration, launcher: FakeLauncher { process, _ in process.ready() }, keySource: NoKeys(),
            probe: { _, _ in status }, timing: fastTiming
        )
        let model = AppModel(configuration: configuration, controller: controller) { connection in
            PennantClient.make(port: connection.port, token: connection.token, transport: transport)
        }
        #expect(model.storeKey == nil)
        await model.start()
        #expect(await eventually { model.storeKey != nil })
        let first = try #require(model.storeKey)
        #expect(first == AppModel.StoreKey(importStamp: "", club: ClubRef(id: 1), restores: 0))

        _ = try await model.restoreBackup()
        #expect(await eventually { model.storeKey?.restores == 1 })
        #expect(model.storeKey != first)
        await model.shutdown()
        #expect(model.storeKey == nil)
    }
}
