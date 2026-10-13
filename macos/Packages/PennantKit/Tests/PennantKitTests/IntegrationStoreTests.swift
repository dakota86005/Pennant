import Foundation
import HTTPTypes
import OpenAPIRuntime
import PennantAPI
import PennantGlance
@testable import PennantKit
import Testing

/// Pennant outside its windows (N14, Stage A; BEHAVIOR_CASES.md "Pennant for Mac", the N14 rows): the glance is read once
/// per key and desk stamp and handed on as a snapshot, Spotlight's list once per key and handed on as served, and a
/// refusal is the server's sentence with nothing handed on.
@Suite("Pennant outside its windows: the glance and Spotlight's list")
@MainActor
struct IntegrationStoreTests {
    private func transport() throws -> RoutedTransport {
        RoutedTransport([
            "/api/status": try RoutedTransport.json("getStatus"),
            "/api/settings": try RoutedTransport.json("getSettings"),
            "/api/orgs": try RoutedTransport.json("listOrgs"),
            "/api/v2/data-status": try RoutedTransport.json("getDataStatusWords"),
            "/api/v2/catalog": try RoutedTransport.json("getCatalog"),
            "/api/v2/glance/1": try RoutedTransport.json("getGlance"),
            "/api/v2/spotlight/1": try RoutedTransport.json("getSpotlightList"),
        ])
    }

    private func readyModel(_ transport: RoutedTransport) async throws -> AppModel {
        let configuration = try fakeConfiguration()
        let status = try fixtureStatus()
        let controller = ServerController(
            configuration: configuration, launcher: FakeLauncher { process, _ in process.ready() }, keySource: NoKeys(),
            probe: { _, _ in status }, timing: fastTiming
        )
        let model = AppModel(configuration: configuration, controller: controller, keptReports: KeptReports(folder: try scratchFolder("integration"))) { connection in
            PennantClient.make(port: connection.port, token: connection.token, transport: transport)
        }
        await model.start()
        #expect(await eventually { model.storeKey?.club != nil })
        return model
    }

    private func asked(_ transport: RoutedTransport, _ path: String) -> Int {
        transport.paths.filter { $0.hasSuffix(path) }.count
    }

    @Test("read once per key, the glance again when the desk's stamp moves; each handed on as served")
    func readsOncePerKey() async throws {
        let transport = try transport()
        let model = try await readyModel(transport)
        let store = model.integration
        var snapshots: [GlanceSnapshot] = []
        var lists: [Components.Schemas.SpotlightList] = []
        store.onSnapshot = { snapshots.append($0) }
        store.onSpotlight = { lists.append($0) }
        let at = Date(timeIntervalSince1970: 1_800_000_000)
        await store.load(client: model.client, key: model.storeKey, deskStamp: "a", colors: nil, now: at)
        await store.load(client: model.client, key: model.storeKey, deskStamp: "a", colors: nil, now: at)
        #expect(asked(transport, "/api/v2/glance/1") == 1)
        #expect(asked(transport, "/api/v2/spotlight/1") == 1)
        let served = try JSONDecoder().decode(Components.Schemas.Glance.self, from: fixtureData("responses/getGlance.json"))
        #expect(snapshots == [IntegrationStore.snapshot(of: served, colors: nil, at: at)])
        let list = try #require(lists.first)
        #expect(lists.count == 1)
        #expect(list.players.count == store.spotlight?.players.count)
        #expect(list.clubs.allSatisfy { $0.open.kind.value1 == .club })
        // The GM marked an item: the glance is read again, the list is not
        await store.load(client: model.client, key: model.storeKey, deskStamp: "b", colors: nil, now: at)
        #expect(asked(transport, "/api/v2/glance/1") == 2)
        #expect(asked(transport, "/api/v2/spotlight/1") == 1)
        #expect(snapshots.count == 2)
        #expect(store.problem == nil)
    }

    @Test("a refusal is the server's sentence, and nothing is handed on; the next load asks again")
    func refusal() async throws {
        let transport = try transport()
        let model = try await readyModel(transport)
        let refusal = Data(#"{"error":"Pennant doesn't know that club."}"#.utf8)
        transport.answer("/api/v2/glance/1", with: ("application/json", refusal), status: 404)
        transport.answer("/api/v2/spotlight/1", with: ("application/json", refusal), status: 404)
        let store = model.integration
        var handed = 0
        store.onSnapshot = { _ in handed += 1 }
        store.onSpotlight = { _ in handed += 1 }
        await store.load(client: model.client, key: model.storeKey, deskStamp: "a", colors: nil)
        #expect(handed == 0)
        #expect(store.problem == .served("Pennant doesn't know that club."))
        #expect(store.glance == nil)
        await store.load(client: model.client, key: model.storeKey, deskStamp: "a", colors: nil)
        #expect(asked(transport, "/api/v2/glance/1") == 2)
    }

    /// The model's key, for a save.
    private func key(_ model: AppModel, save: String?, importStamp: String? = nil) throws -> AppModel.StoreKey {
        var key = try #require(model.storeKey)
        key.saveId = save
        if let importStamp { key.importStamp = importStamp }
        return key
    }

    @Test("Shortcuts' entities: the served list's by id in the order asked, the served search's by kind")
    func entityResolution() async throws {
        let transport = try transport()
        transport.answer("/api/v2/search", with: try RoutedTransport.json("search"))
        let model = try await readyModel(transport)
        let store = model.integration
        let a = try key(model, save: "saveA")
        // Before the list is read: nothing resolves, and nothing is suggested
        #expect(store.entities(for: ["saveA:7"], kind: .player).isEmpty)
        #expect(store.suggested(.player).isEmpty)
        #expect(store.settle(key: a, configured: true, owed: false) == .load)
        await store.load(client: model.client, key: a, deskStamp: nil, colors: nil)
        let list = try #require(store.spotlight)
        let first = try #require(list.players.first), second = try #require(list.players.dropFirst().first)
        let asked = [
            IntegrationStore.entityID(save: "saveA", number: Int(second.id)!),
            IntegrationStore.entityID(save: "saveA", number: Int(first.id)!),
        ]
        let names: [String] = store.entities(for: asked, kind: .player).map(\.name)
        #expect(names == [second.title, first.title])
        let clubIds: [Int] = store.suggested(.club).map(\.number)
        let servedIds: [Int] = list.clubs.compactMap { Int($0.id) }
        #expect(clubIds == servedIds)
        // The served search, players only: never a view or the "All in Player Search" line
        let found = await store.search("club", kind: .club, client: model.client)
        let served = try JSONDecoder().decode(Components.Schemas.SearchAnswer.self, from: fixtureData("responses/search.json"))
        let results: [Components.Schemas.SearchResult] = served.groups.flatMap(\.results)
        let clubTitles: [String] = results.filter { $0.kind.value1 == .club }.map(\.title)
        let foundNames: [String] = found.map(\.name)
        #expect(foundNames == clubTitles)
        // One picked from the search resolves, as given
        if let picked = found.last { #expect(store.entities(for: [picked.id], kind: .club) == [picked]) }
        let blank = await store.search("   ", kind: .player, client: model.client)
        #expect(blank.isEmpty)
    }

    @Test("an id of another save's, an unknown one, or no entity id at all resolves to nothing, never a nameless entity")
    func foreignIds() async throws {
        let transport = try transport()
        let model = try await readyModel(transport)
        let store = model.integration
        let a = try key(model, save: "saveA")
        #expect(store.settle(key: a, configured: true, owed: false) == .load)
        await store.load(client: model.client, key: a, deskStamp: nil, colors: nil)
        let player = try #require(store.spotlight?.players.first.flatMap { Int($0.id) })
        #expect(store.entities(for: [IntegrationStore.entityID(save: "saveA", number: player)], kind: .player).count == 1)
        #expect(store.entities(for: [IntegrationStore.entityID(save: "saveB", number: player)], kind: .player).isEmpty)
        #expect(store.entities(for: ["saveA:999999", "\(player)", "", "saveA:"], kind: .player).isEmpty)
        #expect(IntegrationStore.number(in: "saveA:12", save: "saveA") == 12)
        #expect(IntegrationStore.number(in: "-:12", save: nil) == 12)
        #expect(IntegrationStore.number(in: "saveA:12", save: nil) == nil)
    }

    @Test("another save or club, no save, or the club question open: the snapshot and Spotlight's entries are removed")
    func clearedOnSwitch() async throws {
        let transport = try transport()
        let model = try await readyModel(transport)
        let store = model.integration
        let glanceStore = GlanceSnapshotStore(folder: try scratchFolder("integration-clear"))
        var cleared = 0
        store.onSnapshot = { try? glanceStore.write($0) }
        store.onClear = {
            glanceStore.remove()
            cleared += 1
        }
        let a = try key(model, save: "saveA")
        #expect(store.settle(key: nil, configured: nil, owed: false) == .waiting)
        #expect(store.settle(key: a, configured: true, owed: false) == .load)
        await store.load(client: model.client, key: a, deskStamp: "d", colors: nil)
        #expect(glanceStore.read() != nil)
        #expect(cleared == 0)
        // The same save and club after an import, or its id not served for a moment: nothing removed
        #expect(store.settle(key: try key(model, save: "saveA", importStamp: "next"), configured: true, owed: false) == .load)
        #expect(store.settle(key: try key(model, save: nil), configured: true, owed: false) == .load)
        #expect(cleared == 0)
        #expect(glanceStore.read() != nil)
        // Another save: the snapshot and the entries go, and the store forgets the first save's glance and list
        let b = try key(model, save: "saveB")
        #expect(store.settle(key: b, configured: true, owed: false) == .load)
        #expect(cleared == 1)
        #expect(glanceStore.read() == nil)
        #expect(store.glance == nil)
        #expect(store.suggested(.player).isEmpty)
        await store.load(client: model.client, key: b, deskStamp: "d", colors: nil)
        #expect(glanceStore.read() != nil)
        // Another club of the same save
        var otherClub = b
        otherClub.club = ClubRef(id: 2)
        #expect(store.settle(key: otherClub, configured: true, owed: false) == .load)
        #expect(cleared == 2)
        #expect(glanceStore.read() == nil)
        await store.load(client: model.client, key: b, deskStamp: "d", colors: nil)
        // The club question open, then no save set: removed once, nothing read
        #expect(store.settle(key: b, configured: true, owed: true) == .cleared)
        #expect(store.settle(key: b, configured: false, owed: false) == .cleared)
        #expect(cleared == 3)
        #expect(glanceStore.read() == nil)
        #expect(store.spotlight == nil)
    }

    @Test("no server, no key: nothing is asked")
    func notReady() async throws {
        let store = IntegrationStore()
        var handed = 0
        store.onSnapshot = { _ in handed += 1 }
        await store.load(client: nil, key: nil, deskStamp: nil, colors: nil)
        #expect(handed == 0)
        #expect(store.problem == nil)
    }
}
