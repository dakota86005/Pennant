import Foundation
import OpenAPIRuntime
import PennantAPI
import Testing
@testable import PennantKit

/// N6, Stage B2's pieces in PennantKit: the notices the GM dismissed, the rating history's answers, the import that
/// lands in place, and the pretend home a development build finds saves in.
@Suite("Finding the save and the rating history (N6, Stage B2)")
@MainActor
struct StageB2Tests {
    // MARK: The notices the GM dismissed

    private func played(kind: String = "otherSave", id: String = "b", at: String = "2040-07-01T12:00:00.000Z") throws -> Components.Schemas.SavePlayedElsewhere {
        let json = """
        {"kind":"\(kind)","text":"You've played B since this save.","hint":"Pennant stays on this save until you switch.","actionText":"Switch to B",\
        "save":{"name":"B","lgPath":"/saves/B.lg","csvDir":"/saves/B.lg/import_export/csv","csvCount":3,"id":"\(id)","lastPlayedAt":"\(at)"},"chosenLastPlayedAt":null}
        """
        return try JSONDecoder().decode(Components.Schemas.SavePlayedElsewhere.self, from: Data(json.utf8))
    }

    @Test("a dismissed notice stays hidden for that save until its key changes, and is remembered across launches")
    func dismissed() throws {
        let folder = try scratchFolder("notices")
        let memory = NoticeMemory(folder: folder)
        let notice = try played()
        let key = NoticeMemory.key(notice)
        #expect(!memory.isDismissed(key, save: "save-a"))
        memory.dismiss(key, save: "save-a")
        #expect(memory.isDismissed(key, save: "save-a"))
        // Another save's notices, and the same save played again, show
        #expect(!memory.isDismissed(key, save: "save-z"))
        #expect(!memory.isDismissed(NoticeMemory.key(try played(at: "2040-07-02T09:00:00.000Z")), save: "save-a"))
        #expect(!memory.isDismissed(NoticeMemory.key(try played(kind: "newerOotp")), save: "save-a"))
        // The next launch reads what was dismissed
        #expect(NoticeMemory(folder: folder).isDismissed(key, save: "save-a"))
        // With no save chosen nothing is remembered
        memory.dismiss(key, save: nil)
        #expect(!memory.isDismissed(key, save: nil))
    }

    @Test("a notice is remembered under the served save's id, else its export folder; nothing with no save chosen")
    func savesKey() throws {
        var status = try fixtureStatus()
        status.configured = true
        status.saveId = "abc"
        #expect(NoticeMemory.save(status) == "abc")
        status.saveId = nil
        status.csvDir = "/saves/A.lg/import_export/csv"
        #expect(NoticeMemory.save(status) == "/saves/A.lg/import_export/csv")
        status.configured = false
        #expect(NoticeMemory.save(status) == nil)
    }

    // MARK: An import that lands in place

    private func client(_ transport: any ClientTransport) -> Client {
        PennantClient.make(port: 5178, token: String(repeating: "t", count: 64), transport: transport)
    }

    private func summary(importStamp: String) throws -> (contentType: String, body: Data) {
        var object = try #require(try JSONSerialization.jsonObject(with: fixtureData("responses/getFrontOffice.json")) as? [String: Any])
        object["importStamp"] = importStamp
        return ("application/json", try JSONSerialization.data(withJSONObject: object))
    }

    @Test("a report from a new import replacing a live one counts as an import landed in place; the same import does not")
    func importLands() async throws {
        let store = FrontOfficeStore()
        let first = RoutedTransport(["/api/v2/front-office/1": try summary(importStamp: "A")])
        await store.loadSummary(client: client(first), key: AppModel.StoreKey(importStamp: "A", club: ClubRef(id: 1), restores: 0))
        #expect(store.importLandings == 0)
        let second = RoutedTransport(["/api/v2/front-office/1": try summary(importStamp: "B")])
        await store.loadSummary(client: client(second), key: AppModel.StoreKey(importStamp: "B", club: ClubRef(id: 1), restores: 0))
        #expect(store.importLandings == 1)
        // Reloaded for another reason (a restore), the same import: nothing landed
        await store.loadSummary(client: client(second), key: AppModel.StoreKey(importStamp: "B", club: ClubRef(id: 1), restores: 1))
        #expect(store.importLandings == 1)
    }

    // MARK: A development build's pretend home

    @Test("a development build finds saves by itself only on a pretend home, which the server gets as its home")
    func pretendHome() {
        let bundle = Bundle.main
        let none = UserDefaults(suiteName: "pennant-b2-\(UUID().uuidString)")!
        let scratch = ServerConfiguration.development(in: bundle, environment: ["PENNANT_DEV_DATA_DIR": "/tmp/pennant-dev"], defaults: none)
        #expect(scratch.findsSavesAutomatically == false)
        #expect(scratch.extraEnvironment["HOME"] == nil)
        let home = ServerConfiguration.development(
            in: bundle, environment: ["PENNANT_DEV_DATA_DIR": "/tmp/pennant-dev", "PENNANT_DEV_HOME": "/tmp/pennant-home"], defaults: none
        )
        #expect(home.findsSavesAutomatically)
        #expect(home.launchSpec(inheriting: ["HOME": "/Users/gm"]).environment["HOME"] == "/tmp/pennant-home")
        #expect(ServerConfiguration.bundled(in: bundle).findsSavesAutomatically)
    }

    // MARK: The rating history's answers

    private func model(_ transport: RoutedTransport) throws -> AppModel {
        let configuration = try fakeConfiguration()
        let status = try fixtureStatus()
        let controller = ServerController(
            configuration: configuration,
            launcher: FakeLauncher { process, _ in process.ready() },
            keySource: NoKeys(),
            probe: { _, _ in status },
            timing: fastTiming
        )
        return AppModel(configuration: configuration, controller: controller) { connection in
            PennantClient.make(port: connection.port, token: connection.token, transport: transport)
        }
    }

    private func answers(choiceStatus: Int = 200, choice: String = "answerRatingHistoryOffer-adopt") throws -> RoutedTransport {
        RoutedTransport([
            "/api/status": try RoutedTransport.json("getStatus"),
            "/api/settings": try RoutedTransport.json("getSettings"),
            "/api/orgs": try RoutedTransport.json("listOrgs"),
            "/api/v2/data-status": try RoutedTransport.json("getDataStatusWords"),
            "/api/v2/catalog": try RoutedTransport.json("getCatalog"),
            "/api/v2/rating-history": try RoutedTransport.json("getRatingHistory-offer"),
            "POST /api/v2/rating-history/choice": try RoutedTransport.json(choice),
            "/api/v2/events": RoutedTransport.sse(""),
        ], statuses: ["POST /api/v2/rating-history/choice": choiceStatus])
    }

    @Test("the rating history is read with the rest; an answer posts the GM's choice and redraws from the reply")
    func adoptThenUndo() async throws {
        let transport = try answers()
        let model = try model(transport)
        await model.start()
        #expect(await eventually { model.ratingHistory != nil })
        let offer = try #require(model.ratingHistory?.offers.first)
        try await model.answerRatingHistory(offer.id, choice: .adopt)
        let sent = try #require(transport.body("POST /api/v2/rating-history/choice"))
        let body = try #require(try JSONSerialization.jsonObject(with: sent) as? [String: String])
        #expect(body == ["offerId": offer.id, "choice": "adopt"])
        #expect(model.ratingHistory?.carriedOver.count == 1)
        #expect(model.ratingHistory?.offers.isEmpty == true)
        await model.shutdown()
    }

    @Test("a refused answer is the server's sentence, and what was shown stays")
    func refused() async throws {
        let transport = try answers(choiceStatus: 400, choice: "answerRatingHistoryOffer-nothing-to-answer")
        let model = try model(transport)
        await model.start()
        #expect(await eventually { model.ratingHistory != nil })
        let before = model.ratingHistory
        do {
            try await model.answerRatingHistory("save-other:carry:1", choice: .undo)
            Issue.record("the refusal was not thrown")
        } catch {
            #expect(error == .served("That answer is about another save's rating history."))
        }
        #expect(model.ratingHistory == before)
        await model.shutdown()
    }
}
