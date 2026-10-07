import Foundation
import HTTPTypes
import OpenAPIRuntime
import PennantAPI
@testable import PennantKit
import Testing

/// Major League Ops' clubhouse tools in the Mac app (N9): read as served, once per key and ask, a choice sent back
/// exactly as served, the server's sentence when it refuses, and never another club's (as Major League Ops' views).
@Suite("The clubhouse tools' store")
@MainActor
struct ClubhouseStoreTests {
    private func key(_ stamp: String = "rstamp", club: Int = 1, save: String? = nil) -> AppModel.StoreKey {
        AppModel.StoreKey(importStamp: "", club: ClubRef(id: club), restores: 0, reportStamp: stamp, saveId: save)
    }

    private func client(_ transport: any ClientTransport) -> Client {
        PennantClient.make(port: 5178, token: String(repeating: "t", count: 64), transport: transport)
    }

    private let views: [String: (contentType: String, body: Data)] = {
        var answers: [String: (contentType: String, body: Data)] = [:]
        for (path, fixture) in [
            ("/api/v2/views/1/majorLeague/lineup", "getMajorLeagueLineup"),
            ("/api/v2/views/1/majorLeague/pitchingAvailability", "getMajorLeaguePitchingAvailability"),
            ("/api/v2/views/1/majorLeague/scheduleGamePlans", "getMajorLeagueSchedule"),
            ("/api/v2/views/1/majorLeague/scheduleGamePlans/plan", "getMajorLeagueGamePlan"),
            ("/api/v2/views/1/majorLeague/depthChart", "getMajorLeagueDepthChart"),
            ("/api/v2/views/1/majorLeague/fortyManOptions", "getMajorLeagueFortyMan"),
            ("/api/v2/views/1/majorLeague/rosters", "getMajorLeagueRosters"),
            ("/api/v2/views/1/majorLeague/seasonTrends", "getMajorLeagueSeasonTrends"),
        ] {
            answers[path] = try? RoutedTransport.json(fixture)
        }
        return answers
    }()

    @Test("reads each tool once per key, and again when the key moves")
    func oncePerKey() async throws {
        let transport = RoutedTransport(views)
        let store = ClubhouseStore()
        let c = client(transport)
        for _ in 0..<2 {
            await store.loadLineup(nil, client: c, key: key())
            await store.loadPitching(client: c, key: key())
            await store.loadSchedule(client: c, key: key())
            await store.loadPlan(61, client: c, key: key())
            await store.loadDepth(client: c, key: key())
            await store.loadFortyMan(client: c, key: key())
            await store.loadRoster(nil, client: c, key: key())
            await store.loadTrends(client: c, key: key())
        }
        #expect(transport.paths.count == 8)
        #expect(store.lineup(nil) != nil && store.pitching != nil && store.schedule != nil && store.plans[61] != nil)
        #expect(store.depth != nil && store.fortyMan != nil && store.roster(nil) != nil && store.trends != nil)
        #expect(store.isCurrent("pitching", for: key()))
        await store.loadPitching(client: c, key: key("moved"))
        #expect(transport.paths.count == 9)
        #expect(!store.isCurrent("depth", for: key("moved")))
        #expect(store.updating("depth", for: key("moved")))
    }

    @Test("asks for a card exactly as the served choice gives it, and keeps each card by its ask")
    func lineupAsServed() async throws {
        let transport = RoutedTransport(views)
        let store = ClubhouseStore()
        await store.loadLineup(nil, client: client(transport), key: key())
        let served = try #require(store.lineup(nil))
        let choice = try #require(served.choices.flatMap(\.choices).first { !$0.selected })
        let query = ClubhouseStore.LineupQuery(choice.query)
        await store.loadLineup(query, client: client(transport), key: key())
        let asked = try #require(transport.paths.last)
        for part in ["vs=\(choice.query.vs)", "style=\(choice.query.style)", "dh=\(choice.query.dh)", "sort=\(choice.query.sort)"] {
            #expect(asked.contains(part))
        }
        #expect(store.lineup(query) != nil)
        #expect(store.lineup(nil) != nil)
    }

    @Test("asks for a game's plan and a club's roster by the served id")
    func plansAndRosters() async throws {
        let transport = RoutedTransport(views)
        let store = ClubhouseStore()
        await store.loadPlan(61, client: client(transport), key: key())
        #expect(transport.paths.last?.hasSuffix("plan?game=61") == true)
        await store.loadRoster(9, client: client(transport), key: key())
        #expect(transport.paths.last?.hasSuffix("rosters?team=9") == true)
        #expect(store.roster(9) != nil)
    }

    @Test("a refusal is the server's sentence, and what was shown stays")
    func refusal() async throws {
        let transport = RoutedTransport(views)
        let store = ClubhouseStore()
        await store.loadFortyMan(client: client(transport), key: key())
        transport.answer("/api/v2/views/1/majorLeague/fortyManOptions", with: ("application/json", Data(#"{"error":"Nothing is imported yet, so there is no report to read."}"#.utf8)), status: 404)
        await store.loadFortyMan(client: client(transport), key: key("moved"))
        #expect(store.fortyMan != nil)
        #expect(store.problems["fortyMan"] == .served("Nothing is imported yet, so there is no report to read."))
    }

    @Test("never another club's: another save or club drops everything held at once")
    func neverAnotherClubs() async throws {
        let transport = RoutedTransport(views)
        let store = ClubhouseStore()
        await store.loadSchedule(client: client(transport), key: key(save: "a"))
        await store.loadTrends(client: client(transport), key: key(save: "a"))
        #expect(store.schedule != nil && store.trends != nil)
        store.follow(key(club: 2, save: "a"))
        #expect(store.schedule == nil && store.trends == nil)
        #expect(!store.isCurrent("schedule", for: key(club: 2, save: "a")))
    }

    @Test("a request called off is a non-event, and a failed one logs no error's description (N11 review, H1)")
    func cancelledAndFailedReads() async throws {
        var lines: [String] = []
        let store = ClubhouseStore { lines.append($0) }
        await store.loadDepth(client: client(Refusing(URLError(.cancelled))), key: key())
        #expect(store.problems["depth"] == nil)
        #expect(lines.isEmpty)
        await store.loadDepth(client: client(Refusing(URLError(.cannotConnectToHost))), key: key("again"))
        #expect(store.problems["depth"] != nil)
        let line = try #require(lines.first)
        #expect(lines.count == 1)
        #expect(line.contains("getMajorLeagueDepthChart"))
        #expect(line.contains("NSURLErrorDomain -1004"))
        // Never the error's own description (an OpenAPIRuntime `ClientError` describes the request's input)
        #expect(!line.contains("operationInput") && !line.contains("Could not connect"))
    }
}

/// A transport that throws the same error for every request.
private struct Refusing: ClientTransport {
    let error: URLError
    init(_ error: URLError) { self.error = error }
    func send(_: HTTPRequest, body _: HTTPBody?, baseURL _: URL, operationID _: String) async throws -> (HTTPResponse, HTTPBody?) {
        throw error
    }
}
