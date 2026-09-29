import Foundation
import HTTPTypes
import OpenAPIRuntime
import PennantAPI
@testable import PennantKit
import Testing

/// The GM's attention from the Mac app (N7, Stage B; D-058, D-059): desk statuses and follows go through the server and
/// are undone with the request it served; the wire, a club's report and search are read as served; the events read the
/// desk and Following again and hand the app the notification's served words; the club question is held from the status
/// and the settings.
@Suite("The GM's attention: desk, Following, the league")
@MainActor
struct AttentionTests {
    private func key(_ club: Int? = 1) -> AppModel.StoreKey {
        AppModel.StoreKey(importStamp: "", club: club.map(ClubRef.init(id:)), restores: 0, reportStamp: "rstamp")
    }

    private func client(_ transport: any ClientTransport) -> Client {
        PennantClient.make(port: 5178, token: String(repeating: "t", count: 64), transport: transport)
    }

    private func decode<T: Decodable>(_ type: T.Type, _ fixture: String) throws -> T {
        try JSONDecoder().decode(type, from: fixtureData("responses/\(fixture).json"))
    }

    private func update(_ status: Components.Schemas.DeskStatus.Value1Payload, key: String, until: String? = nil, note: String? = nil) -> Components.Schemas.DeskUpdate {
        .init(key: key, status: .init(value1: status, value2: status.rawValue), until: until, note: note)
    }

    private static let item = "farm:position_single_cover:organization:critical"

    // MARK: The desk

    @Test("a status change puts the served desk in place, says what was done in the server's words, and keeps severity as it was")
    func deskChange() async throws {
        let transport = RoutedTransport([
            "/api/v2/front-office/1": try RoutedTransport.json("getFrontOffice"),
            "PUT /api/v2/desk/1": try RoutedTransport.json("setDeskStatus-reviewed"),
        ])
        let store = FrontOfficeStore()
        await store.loadSummary(client: client(transport), key: key())
        let before = try #require(store.summary)
        let severities = before.desk.items.map(\.severity)
        let revision = store.attentionRevision
        let change = await store.setDeskStatus(update(.reviewed, key: Self.item), client: client(transport), key: key())
        #expect(change?.done.display == "Marked reviewed")
        #expect(store.deskDone?.text == "Marked reviewed")
        #expect(store.summary?.desk.setAside?.line.display == "1 reviewed")
        #expect(store.attentionRevision == revision + 1)
        // The departments' cards are untouched by a status (case 15)
        #expect(store.summary?.departments == before.departments)
        #expect(store.summary?.desk.items.allSatisfy { item in severities.contains(item.severity) } ?? false)
        // The request sent is the one the GM made, the status by its served word
        let sent = try #require(transport.body("PUT /api/v2/desk/1"))
        let json = try #require(try JSONSerialization.jsonObject(with: sent) as? [String: Any])
        #expect(json["status"] as? String == "reviewed")
        #expect(json["key"] as? String == Self.item)
    }

    @Test("a refused change keeps the desk as it was and says why in the server's sentence")
    func deskRefused() async throws {
        let transport = RoutedTransport([
            "/api/v2/front-office/1": try RoutedTransport.json("getFrontOffice"),
            "PUT /api/v2/desk/1": try RoutedTransport.json("setDeskStatus-deferred-to-a-day-gone"),
        ], statuses: ["PUT /api/v2/desk/1": 400])
        let store = FrontOfficeStore()
        await store.loadSummary(client: client(transport), key: key())
        let before = store.summary
        let change = await store.setDeskStatus(update(.deferred, key: Self.item, until: "2000-1-1"), client: client(transport), key: key())
        #expect(change == nil)
        #expect(store.deskProblem == .served("Choose a day after the league's day, May 6, 2040."))
        #expect(store.summary == before)
    }

    @Test("a desk from another build is not put over the summary shown: that build's summary follows the key")
    func deskFromAnotherBuild() async throws {
        let transport = RoutedTransport(["/api/v2/front-office/1": try RoutedTransport.json("getFrontOffice")])
        let store = FrontOfficeStore()
        await store.loadSummary(client: client(transport), key: key())
        var view = try #require(try decode(Components.Schemas.DeskChange.self, "setDeskStatus-reviewed").view)
        view.reportStamp = "another-build"
        let before = store.summary
        store.apply(deskView: view)
        #expect(store.summary == before)
    }

    @Test("the desk-changed event reads the desk again only when its stamp is not the one shown")
    func deskEvent() async throws {
        let transport = RoutedTransport([
            "/api/v2/front-office/1": try RoutedTransport.json("getFrontOffice"),
            "/api/v2/desk/1": try RoutedTransport.json("getDesk"),
        ])
        let store = FrontOfficeStore()
        await store.loadSummary(client: client(transport), key: key())
        await store.reloadDesk(stamp: "dstamp", client: client(transport), key: key())
        #expect(!transport.paths.contains("/api/v2/desk/1"))
        await store.reloadDesk(stamp: "d-newer", client: client(transport), key: key())
        #expect(transport.paths.contains("/api/v2/desk/1"))
    }

    @Test("Undo sends the served undo request and Redo the GM's own again, through the window's undo manager")
    func deskUndo() async throws {
        let transport = RoutedTransport([
            "/api/status": try RoutedTransport.json("getStatus"),
            "/api/settings": try RoutedTransport.json("getSettings"),
            "/api/orgs": try RoutedTransport.json("listOrgs"),
            "/api/v2/data-status": try RoutedTransport.json("getDataStatusWords"),
            "/api/v2/catalog": try RoutedTransport.json("getCatalog"),
            "/api/v2/front-office/1": try RoutedTransport.json("getFrontOffice"),
            "PUT /api/v2/desk/1": try RoutedTransport.json("setDeskStatus-reviewed"),
        ])
        let model = try readyModel(transport)
        await model.start()
        #expect(await eventually { model.storeKey?.club != nil })
        await model.loadFrontOffice()
        let undoManager = UndoManager()
        undoManager.groupsByEvent = false
        undoManager.beginUndoGrouping()
        let change = await model.changeDesk(update(.reviewed, key: Self.item, note: "Talked it over"), undoManager: undoManager, actionName: "Mark Reviewed")
        undoManager.endUndoGrouping()
        #expect(change != nil)
        #expect(undoManager.canUndo)
        #expect(undoManager.undoActionName == "Mark Reviewed")
        undoManager.undo()
        #expect(await eventually { self.sentStatus(transport) == "open" })
        #expect(undoManager.canRedo)
        undoManager.redo()
        #expect(await eventually { self.sentStatus(transport) == "reviewed" })
        #expect(undoManager.canUndo)
        await model.shutdown()
    }

    private func sentStatus(_ transport: RoutedTransport) -> String? {
        guard let sent = transport.body("PUT /api/v2/desk/1"),
              let json = try? JSONSerialization.jsonObject(with: sent) as? [String: Any] else { return nil }
        return json["status"] as? String
    }

    private func readyModel(_ transport: RoutedTransport, status: Components.Schemas.ServerStatus? = nil) throws -> AppModel {
        let configuration = try fakeConfiguration()
        let status = try status ?? fixtureStatus()
        let controller = ServerController(
            configuration: configuration, launcher: FakeLauncher { process, _ in process.ready() }, keySource: NoKeys(),
            probe: { _, _ in status }, timing: fastTiming
        )
        return AppModel(configuration: configuration, controller: controller, keptReports: KeptReports(folder: try scratchFolder("attention"))) { connection in
            PennantClient.make(port: connection.port, token: connection.token, transport: transport)
        }
    }

    // MARK: Following

    @Test("Following is read once per key, and again when the served follow stamp moves")
    func followingLoads() async throws {
        let transport = RoutedTransport(["/api/v2/following": try RoutedTransport.json("getFollowing")])
        let store = FollowingStore()
        await store.load(client: client(transport), key: key())
        await store.load(client: client(transport), key: key())
        #expect(transport.paths.filter { $0 == "/api/v2/following" }.count == 1)
        await store.load(client: client(transport), key: key(), stamp: "f-newer")
        #expect(transport.paths.filter { $0 == "/api/v2/following" }.count == 2)
        #expect(store.following?.suggestions.map(\.why.display) == ["In your division, the East", "In your division, the East", "In your division, the East"])
        // A suggestion is never followed by itself
        #expect(!store.isFollowing(kind: "club", id: 2))
    }

    @Test("a follow and an unfollow answer with the view and the request that undoes them; a refusal is the server's sentence")
    func followChanges() async throws {
        let transport = WireTransport(RoutedTransport([
            "PUT /api/v2/following": try RoutedTransport.json("follow-club"),
            "DELETE /api/v2/following": try RoutedTransport.json("unfollow-club"),
        ]))
        let store = FollowingStore()
        let followed = try #require(await store.send(.follow(kind: "club", id: 2), client: client(transport)))
        #expect(store.done?.text == "Following the Club 2 N")
        #expect(store.isFollowing(kind: "club", id: 2))
        #expect(FollowingStore.Request(served: followed.undo) == .unfollow(kind: "club", id: 2))
        let dropped = try #require(await store.send(.unfollow(kind: "club", id: 2), client: client(transport)))
        #expect(transport.paths.last == "/api/v2/following?kind=club&id=2")
        // The unfollow's undo puts the follow back as it was (restore), never begun again
        guard case .follow(let back) = FollowingStore.Request(served: dropped.undo) else {
            Issue.record("an unfollow's undo is a follow")
            return
        }
        #expect(back.restore == true)
        #expect(back.note == "Division rival")

        let refusing = RoutedTransport(["PUT /api/v2/following": try RoutedTransport.json("follow-not-in-this-save")], statuses: ["PUT /api/v2/following": 404])
        #expect(await store.send(.follow(kind: "club", id: 99), client: client(refusing)) == nil)
        #expect(store.refusal == .served("Pennant doesn't know that club in this save."))
    }

    // MARK: The league

    @Test("the wire is asked with the served filters, followed first unless only the followed are asked")
    func wireQuery() async throws {
        let transport = RoutedTransport(["/api/v2/wire/1": try RoutedTransport.json("getWire")])
        // The routed transport answers by the whole path; the query rides on it
        let answering = WireTransport(transport)
        let store = LeagueStore()
        await store.loadWire(.init(), client: client(answering), key: key())
        await store.loadWire(.init(), client: client(answering), key: key())
        #expect(answering.paths == ["/api/v2/wire/1?followed=first"])
        #expect(store.wire?.entries.count == 4)
        await store.loadWire(.init(club: 3, kind: "injury", followedOnly: true, season: true), client: client(answering), key: key())
        #expect(answering.paths.last == "/api/v2/wire/1?since=season&club=3&kind=injury&followed=only")
        #expect(store.wireQuery == .init(club: 3, kind: "injury", followedOnly: true, season: true))
    }

    @Test("a club's report is read once per key, and a refusal is kept as the server's sentence")
    func clubReport() async throws {
        let transport = RoutedTransport([
            "/api/v2/club/2": try RoutedTransport.json("getClubReport"),
            "/api/v2/club/9": ("application/json", Data(#"{"error":"Choose your club first."}"#.utf8)),
        ], statuses: ["/api/v2/club/9": 404])
        let store = LeagueStore()
        await store.loadClub(2, client: client(transport), key: key())
        await store.loadClub(2, client: client(transport), key: key())
        #expect(transport.paths == ["/api/v2/club/2"])
        #expect(store.clubs[2]?.club == "Club 2 N")
        #expect(store.clubIsCurrent(2, for: key()))
        #expect(!store.clubIsCurrent(2, for: key(3)))
        await store.loadClub(9, client: client(transport), key: key())
        #expect(store.clubProblems[9] == .served("Choose your club first."))
    }

    @Test("search answers with the served groups in the served order")
    func search() async throws {
        let transport = WireTransport(RoutedTransport(["/api/v2/search": try RoutedTransport.json("search")]))
        let answer = try #require(try await LeagueStore().search("club", client: client(transport))?.get())
        #expect(answer.groups.map(\.title.display) == ["Clubs", "Views"])
        #expect(answer.groups.first?.results.map(\.title) == ["Club 1 N", "Club 2 N", "Club 3 N", "Club 4 N"])
        #expect(transport.paths == ["/api/v2/search?q=club"])
    }

    // MARK: Events and the club question

    @Test("changes-ready hands the app the served words only for the club it shows; following-changed reads Following again")
    func events() async throws {
        let transport = RoutedTransport([
            "/api/status": try RoutedTransport.json("getStatus"),
            "/api/settings": try RoutedTransport.json("getSettings"),
            "/api/orgs": try RoutedTransport.json("listOrgs"),
            "/api/v2/data-status": try RoutedTransport.json("getDataStatusWords"),
            "/api/v2/catalog": try RoutedTransport.json("getCatalog"),
            "/api/v2/following": try RoutedTransport.json("getFollowing"),
        ])
        let model = try readyModel(transport)
        await model.start()
        #expect(await eventually { model.storeKey?.club != nil })
        var heard: [String] = []
        model.onChangesReady = { heard.append("\($0.title) · \($0.text)") }
        let ours = try JSONDecoder().decode(Components.Schemas.ServerEvent.self, from: Data(
            #"{"type":"changes-ready","orgId":1,"importStamp":"2040-07-02T10:01:00.000Z","reportStamp":"r2","title":"New export read","text":"3 new on your desk","newToDecide":3}"#.utf8
        ))
        let theirs = try JSONDecoder().decode(Components.Schemas.ServerEvent.self, from: Data(
            #"{"type":"changes-ready","orgId":2,"importStamp":"2040-07-02T10:01:00.000Z","reportStamp":"r2","title":"New export read","text":"1 new on your desk","newToDecide":1}"#.utf8
        ))
        await model.handle(.event(ours))
        await model.handle(.event(theirs))
        #expect(heard == ["New export read · 3 new on your desk"])

        let followed = try JSONDecoder().decode(Components.Schemas.ServerEvent.self, from: Data(#"{"type":"following-changed","followStamp":"f2"}"#.utf8))
        await model.handle(.event(followed))
        #expect(transport.paths.contains("/api/v2/following"))
        #expect(model.following.following?.title.display == "Following")
        await model.shutdown()
    }

    @Test("the club owed is held from the status across a relaunch, and let go when the settings say it was answered")
    func clubOwed() async throws {
        var status = try fixtureStatus()
        status.clubOwed = .init(text: "You manage 2 clubs in this save. Choose the one to follow.", humanClubs: 2, since: "2040-07-02T10:01:00.000Z")
        let transport = RoutedTransport([
            "/api/status": try RoutedTransport.json("getStatus"),
            "/api/settings": ("application/json", try settingsOwing(true)),
            "/api/orgs": try RoutedTransport.json("listOrgs"),
            "/api/v2/data-status": try RoutedTransport.json("getDataStatusWords"),
            "/api/v2/catalog": try RoutedTransport.json("getCatalog"),
        ])
        let model = try readyModel(transport, status: status)
        await model.start()
        #expect(await eventually { model.settings != nil })
        #expect(model.clubOwed?.text == "You manage 2 clubs in this save. Choose the one to follow.")
        await model.shutdown()
    }

    /// The captured settings with the club question open or answered.
    private func settingsOwing(_ owing: Bool) throws -> Data {
        var settings = try JSONSerialization.jsonObject(with: fixtureData("responses/getSettings.json")) as! [String: Any]
        settings["clubOwed"] = owing ? ["text": "You manage 2 clubs in this save. Choose the one to follow.", "humanClubs": 2, "since": "2040-07-02T10:01:00.000Z"] : NSNull()
        return try JSONSerialization.data(withJSONObject: settings)
    }
}

/// The routed transport, answered by the path without its query, remembering the whole path asked.
final class WireTransport: ClientTransport, @unchecked Sendable {
    private let inner: RoutedTransport
    private let lock = NSLock()
    private var _paths: [String] = []
    var paths: [String] { lock.withLock { _paths } }

    init(_ inner: RoutedTransport) { self.inner = inner }

    func send(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String) async throws -> (HTTPResponse, HTTPBody?) {
        lock.withLock { _paths.append(request.path ?? "") }
        var bare = request
        bare.path = request.path.map { String($0.split(separator: "?", maxSplits: 1).first ?? "") }
        return try await inner.send(bare, body: body, baseURL: baseURL, operationID: operationID)
    }
}
