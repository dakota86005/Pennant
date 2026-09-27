import Foundation
import HTTPTypes
import OpenAPIRuntime
import PennantAPI
@testable import PennantKit
import Testing

/// The Front Office's store (SWIFTUI_REBUILD.md section 6): it loads on the store key, keeps its last good payload,
/// never takes a payload from another import as current, and says what the server said when it refuses.
@Suite("The Front Office store")
@MainActor
struct FrontOfficeStoreTests {
    private let club = ClubRef(id: 1)
    private func key(_ stamp: String = "", restores: Int = 0, club: ClubRef? = ClubRef(id: 1)) -> AppModel.StoreKey {
        AppModel.StoreKey(importStamp: stamp, club: club, restores: restores)
    }

    private func client(_ transport: any ClientTransport) -> Client {
        PennantClient.make(port: 5178, token: String(repeating: "t", count: 64), transport: transport)
    }

    private static let trailKey = "1.majorLeague:need:mlb:role_below_standard:catcher"

    private func transport(statuses: [String: Int] = [:], extra: [String: (contentType: String, body: Data)] = [:]) throws -> RoutedTransport {
        let answers: [String: (contentType: String, body: Data)] = try [
            "/api/v2/front-office/1": RoutedTransport.json("getFrontOffice"),
            "/api/v2/front-office/automatic": RoutedTransport.json("getFrontOffice"),
            "/api/v2/departments/1/majorLeague": RoutedTransport.json("getDepartmentReport-majorLeague"),
            "/api/v2/departments/1/farm": RoutedTransport.json("getDepartmentReport-farm"),
        ].merging(extra) { $1 }
        return RoutedTransport(answers, statuses: statuses)
    }

    @Test("loads the desk and the cards once per key, and again when the key moves")
    func summaryPerKey() async throws {
        let transport = try transport()
        let store = FrontOfficeStore()
        let client = client(transport)
        await store.loadSummary(client: client, key: key())
        await store.loadSummary(client: client, key: key())
        #expect(transport.paths == ["/api/v2/front-office/1"])
        let summary = try #require(store.summary)
        #expect(summary.orgId == 1)
        #expect(summary.departments.count == 8)
        #expect(store.summaryIsCurrent(for: key()))
        await store.loadSummary(client: client, key: key(restores: 1))
        #expect(transport.paths.count == 2)
    }

    @Test("asks for the served club by id, or for automatic when the app has no club yet")
    func orgPath() async throws {
        let transport = try transport()
        await FrontOfficeStore().loadSummary(client: client(transport), key: key(club: nil))
        #expect(transport.paths == ["/api/v2/front-office/automatic"])
        #expect(FrontOfficeStore.org(key()) == "1")
    }

    @Test("keeps a payload from another import but never takes it as current")
    func otherImport() async throws {
        let store = FrontOfficeStore()
        await store.loadSummary(client: client(try transport()), key: key("2040-07-02T12:00:00.000Z"))
        // The fixture was served before any import was on record (no stamp): not the import the key names
        #expect(store.summary != nil)
        #expect(!store.summaryIsCurrent(for: key("2040-07-02T12:00:00.000Z")))
        #expect(FrontOfficeStore.isCurrent(importStamp: "2040-07-02T12:00:00.000Z", reportStamp: "r1", orgId: 1, for: key("2040-07-02T12:00:00.000Z")))
        #expect(!FrontOfficeStore.isCurrent(importStamp: "2040-07-01T12:00:00.000Z", reportStamp: "r1", orgId: 1, for: key("2040-07-02T12:00:00.000Z")))
        #expect(!FrontOfficeStore.isCurrent(importStamp: nil, reportStamp: nil, orgId: nil, for: nil))
    }

    @Test("a payload for another club, or from an earlier build of the server, is not current (review S-10, S-3)")
    func otherClubOrBuild() async throws {
        let store = FrontOfficeStore()
        await store.loadSummary(client: client(try transport()), key: key())
        let served = try #require(store.summary?.reportStamp)
        #expect(store.summaryIsCurrent(for: key()))
        #expect(!store.summaryIsCurrent(for: key(club: ClubRef(id: 2))))
        #expect(store.summaryIsCurrent(for: AppModel.StoreKey(importStamp: "", club: club, restores: 0, reportStamp: served)))
        #expect(!store.summaryIsCurrent(for: AppModel.StoreKey(importStamp: "", club: club, restores: 0, reportStamp: "r-newer")))
    }

    @Test("reloads when the server's build moves, and not when the key only catches up with what it already has")
    func followsTheBuild() async throws {
        let transport = try transport()
        let store = FrontOfficeStore()
        let client = client(transport)
        await store.loadSummary(client: client, key: key())
        let served = try #require(store.summary?.reportStamp)
        // The event names the build the store already has: no second request
        await store.loadSummary(client: client, key: AppModel.StoreKey(importStamp: "", club: club, restores: 0, reportStamp: served))
        #expect(transport.paths.count == 1)
        // A newer build: asked again
        await store.loadSummary(client: client, key: AppModel.StoreKey(importStamp: "", club: club, restores: 0, reportStamp: "r-newer"))
        #expect(transport.paths.count == 2)
    }

    @Test("keeps no trail that arrives after the key moved (review N-3)")
    func lateTrail() async throws {
        let gate = GatedTransport(try RoutedTransport.json("getClaimTrail"))
        let store = FrontOfficeStore()
        let gated = client(gate)
        let other = client(try transport())
        let early = Task { await store.loadTrail(Self.trailKey, client: gated, key: key()) }
        await gate.waitUntilAsked()
        await store.loadTrail("other", client: other, key: key(restores: 1))
        gate.open()
        await early.value
        #expect(store.trails[Self.trailKey] == nil)
    }

    @Test("says what the server said when it refuses, and keeps the last good payload")
    func refused() async throws {
        let refusal = ("application/json", Data(#"{"error":"Pennant doesn't know that club in this save."}"#.utf8))
        let good = try transport()
        let store = FrontOfficeStore()
        await store.loadSummary(client: client(good), key: key())
        let bad = try transport(statuses: ["/api/v2/front-office/1": 404], extra: ["/api/v2/front-office/1": refusal])
        await store.loadSummary(client: client(bad), key: key(restores: 1))
        #expect(store.summaryProblem == .served("Pennant doesn't know that club in this save."))
        #expect(store.summary != nil)
    }

    @Test("a server failure is a kind with its detail for the log, never shown as text")
    func failure() async throws {
        let failed = ("application/json", Data(#"{"error":"Pennant couldn't put this together. The details are in the server log.","detail":"boom"}"#.utf8))
        let transport = try transport(statuses: ["/api/v2/departments/1/farm": 500], extra: ["/api/v2/departments/1/farm": failed])
        var logged: [String] = []
        let store = FrontOfficeStore { logged.append($0) }
        await store.loadReport("farm", client: client(transport), key: key())
        // A /v2 route's failure is its own sentence; the raw message is not on the face
        #expect(store.reportProblems["farm"] == .served("Pennant couldn't put this together. The details are in the server log."))
        #expect(store.reports["farm"] == nil)
        #expect(logged.isEmpty)
    }

    @Test("loads each department's report once per key")
    func reports() async throws {
        let transport = try transport()
        let store = FrontOfficeStore()
        let client = client(transport)
        await store.loadReport("majorLeague", client: client, key: key())
        await store.loadReport("majorLeague", client: client, key: key())
        await store.loadReport("farm", client: client, key: key())
        #expect(transport.paths == ["/api/v2/departments/1/majorLeague", "/api/v2/departments/1/farm"])
        let report = try #require(store.reports["majorLeague"])
        #expect(report.status.value1 == .ready)
        #expect(report.changes == nil)
        #expect(report.memo == nil)
        #expect(store.reportIsCurrent("majorLeague", for: key()))
    }

    @Test("fetches an evidence trail on demand, once, and forgets the trails when the key moves")
    func trails() async throws {
        let recording = try transport()
        let store = FrontOfficeStore()
        await store.loadTrail(Self.trailKey, client: client(recording), key: key())
        // Whatever the path's encoding, the one request went to the claims route
        #expect(recording.paths.count == 1)
        #expect(recording.paths[0].hasPrefix("/api/v2/claims/"))
        let path = recording.paths[0]
        let transport = try transport(extra: [path: RoutedTransport.json("getClaimTrail")])
        await store.loadTrail(Self.trailKey, client: client(transport), key: key(restores: 1))
        await store.loadTrail(Self.trailKey, client: client(transport), key: key(restores: 1))
        #expect(transport.paths == [path])
        let trail = try #require(store.trails[Self.trailKey])
        #expect(trail.key == Self.trailKey)
        await store.loadTrail("other", client: client(transport), key: key(restores: 2))
        #expect(store.trails[Self.trailKey] == nil)
    }

    @Test("does nothing without a server or a key")
    func nothingToAsk() async {
        let store = FrontOfficeStore()
        await store.loadSummary(client: nil, key: key())
        await store.loadReport("farm", client: nil, key: nil)
        #expect(store.summary == nil)
        #expect(store.summaryProblem == nil)
    }
}

/// A transport whose one answer waits until the test opens it, so a request can be overtaken.
final class GatedTransport: ClientTransport, @unchecked Sendable {
    private let answer: (contentType: String, body: Data)
    private let lock = NSLock()
    private var asked = false
    private var opened = false

    init(_ answer: (contentType: String, body: Data)) { self.answer = answer }

    func open() { lock.withLock { opened = true } }

    func waitUntilAsked() async {
        while !lock.withLock({ asked }) { try? await Task.sleep(for: .milliseconds(5)) }
    }

    func send(_ request: HTTPRequest, body: HTTPBody?, baseURL _: URL, operationID _: String) async throws -> (HTTPResponse, HTTPBody?) {
        lock.withLock { asked = true }
        while !lock.withLock({ opened }) { try await Task.sleep(for: .milliseconds(5)) }
        var response = HTTPResponse(status: .ok)
        response.headerFields[.contentType] = answer.contentType
        return (response, HTTPBody(answer.body))
    }
}
