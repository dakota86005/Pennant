import Foundation
import HTTPTypes
import OpenAPIRuntime
import PennantAPI
@testable import PennantKit
import Testing

/// Trades and Philosophy & Staff in the Mac app (N12 Track C, D-073): read as served, once per key; the deal on the
/// builder sent exactly as the GM built it, an answer to an older deal never drawn as the current one's; the AI desk's
/// refusal in the server's words; a philosophy change sent as set and its served undo on the undo manager; and never
/// another club's.
@Suite("The Trade Desk's and the philosophy's stores")
@MainActor
struct TradesPhilosophyStoreTests {
    private func key(_ stamp: String = "rstamp", club: Int = 1, save: String? = nil) -> AppModel.StoreKey {
        AppModel.StoreKey(importStamp: "", club: ClubRef(id: club), restores: 0, reportStamp: stamp, saveId: save)
    }

    private func client(_ transport: any ClientTransport) -> Client {
        PennantClient.make(port: 5178, token: String(repeating: "t", count: 64), transport: transport)
    }

    private let views: [String: (contentType: String, body: Data)] = {
        var answers: [String: (contentType: String, body: Data)] = [:]
        for (path, fixture) in [
            ("/api/v2/views/1/trades/tradeDesk", "getTradeDesk"),
            ("/api/v2/views/1/trades/analysis", "getTradeAnalysis"),
            ("POST /api/v2/views/1/trades/ask", "askTradeDesk-ai-off"),
            ("/api/v2/views/1/philosophy/organizationalPhilosophy", "getOrganizationalPhilosophy"),
            ("PUT /api/v2/views/1/philosophy/organizationalPhilosophy", "setOrganizationalPhilosophy-one-preference"),
            ("DELETE /api/v2/views/1/philosophy/organizationalPhilosophy", "resetOrganizationalPhilosophy-reset"),
            ("/api/v2/views/1/philosophy/coachingStaff", "getCoachingStaff"),
        ] {
            answers[path] = try? RoutedTransport.json(fixture)
        }
        return answers
    }()

    @Test("reads the desk once per key, and weighs the deal the GM built, side by side, exactly as built")
    func deskAndDeal() async throws {
        let transport = RoutedTransport(views, statuses: ["POST /api/v2/views/1/trades/ask": 409])
        let store = TradesStore()
        let c = client(transport)
        await store.loadDesk(client: c, key: key())
        await store.loadDesk(client: c, key: key())
        #expect(transport.paths.count == 1)
        #expect(store.desk != nil)
        store.add(12, to: .sent)
        store.add(40, to: .received)
        store.add(7, to: .received)
        await store.loadAnalysis(client: c, key: key())
        let asked = try #require(transport.paths.last?.removingPercentEncoding)
        #expect(asked.contains("sent=12") && asked.contains("received=40,7"))
        #expect(store.analysis != nil)
        #expect(!store.weighing(for: key()))
        // A player dropped on the other side moves across: he is on one side only
        store.add(12, to: .received)
        #expect(store.deal == TradesStore.Deal(sent: [], received: [40, 7, 12]))
        // The deal changed: what was weighed is for another deal, never drawn as this one's
        #expect(store.analysis == nil)
        store.remove(12)
        store.load(TradesStore.Deal(sent: [12], received: [40, 7]))
        #expect(store.analysis != nil)
    }

    @Test("the AI desk's refusal is the server's sentence, and the conversation is the deal's")
    func aiDeskOff() async throws {
        let transport = RoutedTransport(views, statuses: ["POST /api/v2/views/1/trades/ask": 409])
        let store = TradesStore()
        store.load(TradesStore.Deal(sent: [12], received: [40]))
        let answered = await store.ask(nil, client: client(transport), key: key())
        #expect(!answered)
        #expect(store.askProblem == .served("AI is off. Add a key in Settings to ask the front office about a deal."))
        #expect(store.turns.isEmpty)
        let sent = try #require(transport.body("POST /api/v2/views/1/trades/ask"))
        let body = try JSONDecoder().decode(Components.Schemas.TradeAsk.self, from: sent)
        #expect(body.sent == [12] && body.received == [40] && body.thread.isEmpty && body.message == nil)
        // A deal with a side empty is never asked
        store.load(TradesStore.Deal(sent: [12]))
        #expect(store.askProblem == nil)
        #expect(!(await store.ask(nil, client: client(transport), key: key())))
        #expect(transport.paths.count == 1)
    }

    @Test("never another club's deal: another save or club drops the desk and the builder at once")
    func neverAnotherClubsDeal() async throws {
        let transport = RoutedTransport(views)
        let store = TradesStore()
        await store.loadDesk(client: client(transport), key: key(save: "a"))
        store.add(12, to: .sent)
        store.follow(key(club: 2, save: "a"))
        #expect(store.desk == nil && store.deal.isEmpty)
    }

    @Test("reads the editor and the staff once per key; a change is sent as set and answers with its served undo")
    func philosophyChangeAndUndo() async throws {
        let transport = RoutedTransport(views)
        let store = PhilosophyStore()
        let c = client(transport)
        await store.loadPhilosophy(client: c, key: key())
        await store.loadPhilosophy(client: c, key: key())
        await store.loadStaff(client: c, key: key())
        #expect(transport.paths.count == 2)
        #expect(store.philosophy != nil && store.staff != nil)
        let update = Components.Schemas.PhilosophyUpdate(dimensions: [.init(id: "competitiveWindow", value: .init(value1: 70))])
        let change = await store.change(update, client: c, key: key())
        #expect(change?.said.display == "Competitive window set to 70: Maximize current wins.")
        #expect(store.lastSaid?.display == "Competitive window set to 70: Maximize current wins.")
        let sent = try #require(transport.body("PUT /api/v2/views/1/philosophy/organizationalPhilosophy"))
        let body = try JSONDecoder().decode(Components.Schemas.PhilosophyUpdate.self, from: sent)
        #expect(body.dimensions?.first?.id == "competitiveWindow" && body.dimensions?.first?.value.value1 == 70)
        // The served undo is what an undo sends
        #expect(change?.undo.dimensions?.first?.value.value1 == 50)
    }

    @Test("a refused change is the server's sentence, and the editor shown stays")
    func philosophyRefused() async throws {
        let transport = RoutedTransport(views)
        let store = PhilosophyStore()
        let c = client(transport)
        await store.loadPhilosophy(client: c, key: key())
        transport.answer("PUT /api/v2/views/1/philosophy/organizationalPhilosophy", with: try RoutedTransport.json("setOrganizationalPhilosophy-off-the-scale"), status: 400)
        let update = Components.Schemas.PhilosophyUpdate(dimensions: [.init(id: "competitiveWindow", value: .init(value1: 140))])
        #expect(await store.change(update, client: c, key: key()) == nil)
        #expect(store.changeProblem == .served("A preference is a whole number from 0 to 100."))
        #expect(store.philosophy != nil)
    }

    @Test("two quick changes are written in order: the editor shown is the last change's answer, never an older one (L4)")
    func philosophyChangesInOrder() async throws {
        let put = "PUT /api/v2/views/1/philosophy/organizationalPhilosophy"
        let transport = RoutedTransport(views)
        let store = PhilosophyStore()
        let c = client(transport)
        // The first change is slow to answer; the second, made while it is in flight, answers at once
        transport.delay(put, by: .milliseconds(400))
        let first = Components.Schemas.PhilosophyUpdate(dimensions: [.init(id: "competitiveWindow", value: .init(value1: 70))])
        let second = Components.Schemas.PhilosophyUpdate(dimensions: [.init(id: "competitiveWindow", value: .init(value1: 50))])
        async let firstAnswer = store.change(first, client: c, key: key())
        for _ in 0..<200 where !transport.paths.contains(where: { $0.hasSuffix("/organizationalPhilosophy") }) {
            try await Task.sleep(for: .milliseconds(5))
        }
        #expect(store.writing)
        transport.delay(put, by: nil)
        transport.answer(put, with: try RoutedTransport.json("resetOrganizationalPhilosophy-reset"))
        async let secondAnswer = store.change(second, client: c, key: key())
        let answers = await (firstAnswer, secondAnswer)
        #expect(answers.0?.said.display == "Competitive window set to 70: Maximize current wins.")
        #expect(answers.1?.said.display == "Every setting is back to neutral.")
        // The second was sent only after the first was answered, and its answer is the one shown
        #expect(store.lastSaid?.display == "Every setting is back to neutral.")
        #expect(!store.writing)
    }

    @Test("the desk says again whether AI is on when the keys may have changed, and only then (L3)")
    func deskReadAgainWhenKeysChange() async throws {
        let transport = RoutedTransport(views)
        let store = TradesStore()
        let c = client(transport)
        await store.loadDesk(client: c, key: key(), keysRevision: 1)
        await store.loadDesk(client: c, key: key(), keysRevision: 1)
        #expect(transport.paths.count == 1)
        await store.loadDesk(client: c, key: key(), keysRevision: 2)
        #expect(transport.paths.count == 2)
        #expect(store.desk != nil && !store.deskUpdating(for: key()))
    }

    @Test("keeps at most the server's 64 deals weighed, letting the oldest go (L8)")
    func analysesCapped() async throws {
        let transport = RoutedTransport(views)
        let store = TradesStore()
        let c = client(transport)
        for id in 1...(TradesStore.mostAnalysesKept + 6) {
            store.load(TradesStore.Deal(sent: [id], received: [1000]))
            await store.loadAnalysis(client: c, key: key())
        }
        #expect(store.analyses.count == TradesStore.mostAnalysesKept)
        #expect(store.analyses[TradesStore.Deal(sent: [1], received: [1000])] == nil)
        #expect(store.analysis != nil)
    }

    @Test("a provider that refuses the key is the server's sentence, not a failure of the desk")
    func aiDeskKeyRefused() async throws {
        let transport = RoutedTransport(views)
        transport.answer("POST /api/v2/views/1/trades/ask", with: ("application/json", Data(#"{"error":"Anthropic rejected the API key."}"#.utf8)), status: 401)
        let store = TradesStore()
        store.load(TradesStore.Deal(sent: [12], received: [40]))
        #expect(await !store.ask(nil, client: client(transport), key: key()))
        #expect(store.askProblem == .served("Anthropic rejected the API key."))
    }
}
