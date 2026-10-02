import Foundation
import HTTPTypes
import OpenAPIRuntime
import PennantAPI
@testable import PennantKit
import Testing

/// Major League Ops' views and decisions in the Mac app (N8): read as served, once per key, the server's sentence when it
/// refuses, a decision asked with exactly the served choice and never lost to a cancelled view.
@Suite("Major League Ops' store")
@MainActor
struct MajorLeagueStoreTests {
    private func key(_ stamp: String = "rstamp") -> AppModel.StoreKey {
        AppModel.StoreKey(importStamp: "", club: ClubRef(id: 1), restores: 0, reportStamp: stamp)
    }

    private func client(_ transport: any ClientTransport) -> Client {
        PennantClient.make(port: 5178, token: String(repeating: "t", count: 64), transport: transport)
    }

    private let views: [String: (contentType: String, body: Data)] = {
        var answers: [String: (contentType: String, body: Data)] = [:]
        for (path, fixture) in [
            ("/api/v2/views/1/majorLeague/overview", "getMajorLeagueOverview"),
            ("/api/v2/views/1/majorLeague/positionPlayers", "getMajorLeaguePositionPlayers"),
            ("/api/v2/views/1/majorLeague/pitchingStaff", "getMajorLeaguePitchingStaff"),
            ("/api/v2/views/1/majorLeague/benchBackups", "getMajorLeagueBench"),
        ] {
            answers[path] = try? RoutedTransport.json(fixture)
        }
        return answers
    }()

    @Test("reads each view once per key, and again when the key moves")
    func viewsOncePerKey() async throws {
        let transport = RoutedTransport(views)
        let store = MajorLeagueStore()
        for view in MajorLeagueStore.View.allCases {
            await store.load(view, client: client(transport), key: key())
            await store.load(view, client: client(transport), key: key())
        }
        #expect(transport.paths.count == 4)
        #expect(store.overview != nil && store.positionPlayers != nil && store.pitchingStaff != nil && store.bench != nil)
        #expect(store.isCurrent(.positionPlayers, for: key()))
        await store.load(.positionPlayers, client: client(transport), key: key("moved"))
        #expect(transport.paths.count == 5)
        #expect(!store.isCurrent(.pitchingStaff, for: key("moved")))
    }

    @Test("a refusal is the server's sentence, and what was shown stays")
    func refusal() async throws {
        let transport = RoutedTransport(views)
        let store = MajorLeagueStore()
        await store.load(.benchBackups, client: client(transport), key: key())
        transport.answer("/api/v2/views/1/majorLeague/benchBackups", with: ("application/json", Data(#"{"error":"Major League Ops couldn't be read this time."}"#.utf8)), status: 404)
        await store.load(.benchBackups, client: client(transport), key: key("moved"))
        #expect(store.bench != nil)
        #expect(store.problems[.benchBackups] == .served("Major League Ops couldn't be read this time."))
    }

    @Test("never another club's: a view is current only by its own stamps, and another save or club clears everything (M1)")
    func neverAnotherClubs() async throws {
        let transport = RoutedTransport(views.merging(["/api/v2/views/1/majorLeague/decision": try RoutedTransport.json("getMajorLeagueDecision")]) { a, _ in a })
        let store = MajorLeagueStore()
        let query = MajorLeagueStore.DecisionQuery(need: "mlb:role_below_standard:catcher")
        for view in MajorLeagueStore.View.allCases { await store.load(view, client: client(transport), key: key()) }
        await store.loadDecision(query, client: client(transport), key: key())
        let decision = try #require(store.decisions[query])
        #expect(store.isCurrent(.overview, for: key()))
        #expect(store.isCurrent(decision, for: key()))
        // A new build of the same club: what is shown stays, drawn as updating (its stamps are the old build's)
        store.follow(key("rebuilt"))
        #expect(store.positionPlayers != nil)
        #expect(!store.isCurrent(.positionPlayers, for: key("rebuilt")))
        #expect(!store.isCurrent(decision, for: key("rebuilt")))
        // The payload names club 1: under a key for club 2 it is never current, even before the key moves
        let other = AppModel.StoreKey(importStamp: "", club: ClubRef(id: 2), restores: 0, reportStamp: "rstamp")
        #expect(!store.isCurrent(.overview, for: other))
        // Another club: everything is dropped at once
        store.follow(other)
        #expect(store.overview == nil && store.positionPlayers == nil && store.pitchingStaff == nil && store.bench == nil)
        #expect(store.decisions.isEmpty)
        // Another save, same club: dropped too
        for view in MajorLeagueStore.View.allCases { await store.load(view, client: client(transport), key: key()) }
        #expect(store.bench != nil)
        store.follow(AppModel.StoreKey(importStamp: "", club: ClubRef(id: 1), restores: 0, reportStamp: "rstamp", saveId: "another"))
        #expect(store.bench == nil)
    }

    @Test("asks a decision with exactly the served choice, once per question and key")
    func decisionAsServed() async throws {
        let decision = try RoutedTransport.json("getMajorLeagueDecision")
        let transport = RoutedTransport(["/api/v2/views/1/majorLeague/decision": decision])
        let store = MajorLeagueStore()
        let served = Components.Schemas.MlbDecisionQuery(need: "mlb:what_if:12", days: 14)
        let query = MajorLeagueStore.DecisionQuery(served)
        await store.loadDecision(query, client: client(transport), key: key())
        await store.loadDecision(query, client: client(transport), key: key())
        #expect(transport.paths.count == 1)
        let asked = try #require(transport.paths.first)
        #expect(asked.contains("need=mlb:what_if:12") || asked.contains("need=mlb%3Awhat_if%3A12"))
        #expect(asked.contains("days=14"))
        #expect(!asked.contains("role="))
        #expect(store.decisions[query] != nil)
    }

    @Test("a view whose task is cancelled mid-read never loses the decision: the next ask gets it, read once")
    func cancelledViewKeepsTheAnswer() async throws {
        let transport = RoutedTransport(["/api/v2/views/1/majorLeague/decision": try RoutedTransport.json("getMajorLeagueDecision")])
        transport.delay("/api/v2/views/1/majorLeague/decision", by: .milliseconds(200))
        let store = MajorLeagueStore()
        let query = MajorLeagueStore.DecisionQuery(need: "mlb:role_below_standard:catcher")
        let first = Task { await store.loadDecision(query, client: client(transport), key: key()) }
        #expect(await eventually { transport.paths.count == 1 })
        first.cancel()
        await store.loadDecision(query, client: client(transport), key: key())
        #expect(store.decisions[query] != nil)
        #expect(transport.paths.count == 1)
        #expect(!store.loadingDecisions.contains(query))
    }

    @Test("a route saved before routes had a key still decodes, and the sidebar selects its view alone")
    func routeKey() throws {
        let old = try JSONDecoder().decode(AppRoute.self, from: Data(#"{"department":"majorLeague","view":"decision"}"#.utf8))
        #expect(old.key == nil)
        let open = AppRoute(department: "majorLeague", view: "decision", key: "mlb:what_if:3")
        #expect(open.viewOnly == old)
        #expect(open != old)
        #expect(try JSONDecoder().decode(AppRoute.self, from: JSONEncoder().encode(open)) == open)
    }
}
