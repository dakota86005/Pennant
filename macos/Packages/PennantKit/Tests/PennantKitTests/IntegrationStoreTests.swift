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

    @Test("Shortcuts' entities: the served list's by id in the order asked, the served search's by kind")
    func entityResolution() async throws {
        let transport = try transport()
        transport.answer("/api/v2/search", with: try RoutedTransport.json("search"))
        let model = try await readyModel(transport)
        let store = model.integration
        // Before the list is read: an id keeps only its id, and nothing is suggested
        #expect(store.entities(for: [7], kind: .player) == [.init(id: 7, name: "", line: "")])
        #expect(store.suggested(.player).isEmpty)
        await store.load(client: model.client, key: model.storeKey, deskStamp: nil, colors: nil)
        let list = try #require(store.spotlight)
        let first = try #require(list.players.first), second = try #require(list.players.dropFirst().first)
        let asked = [Int(second.id)!, Int(first.id)!]
        let names: [String] = store.entities(for: asked, kind: .player).map(\.name)
        #expect(names == [second.title, first.title])
        let clubIds: [Int] = store.suggested(.club).map(\.id)
        let servedIds: [Int] = list.clubs.compactMap { Int($0.id) }
        #expect(clubIds == servedIds)
        // The served search, players only: never a view or the "All in Player Search" line
        let found = await store.search("club", kind: .club, client: model.client)
        let served = try JSONDecoder().decode(Components.Schemas.SearchAnswer.self, from: fixtureData("responses/search.json"))
        let results: [Components.Schemas.SearchResult] = served.groups.flatMap(\.results)
        let clubTitles: [String] = results.filter { $0.kind.value1 == .club }.map(\.title)
        let foundNames: [String] = found.map(\.name)
        #expect(foundNames == clubTitles)
        let blank = await store.search("   ", kind: .player, client: model.client)
        #expect(blank.isEmpty)
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
