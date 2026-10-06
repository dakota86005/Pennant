import Foundation
import Observation
import OpenAPIRuntime
import PennantAPI

/// Trades (N12 Track C; SWIFTUI_REBUILD.md section 9; D-073): the Trade Desk (`GET /api/v2/views/:org/trades/tradeDesk`),
/// the deal on the builder weighed by the server (`…/analysis?sent=&received=`), and the optional AI desk (`POST …/ask`).
/// Every word, figure and order is the server's: the store holds which players the GM put on each side, asks the server
/// to weigh that deal, and keeps the last good answer while a newer one is asked (an answer to an older deal is
/// dropped). The conversation with the AI desk belongs to the deal on the builder and is cleared when the deal changes,
/// as the React page does. Nothing here decides anything about a player or a deal.
@Observable @MainActor
public final class TradesStore {
    /// The players on each side of the builder, by id, in the order the GM put them there.
    public struct Deal: Hashable, Sendable {
        public var sent: [Int]
        public var received: [Int]

        public init(sent: [Int] = [], received: [Int] = []) {
            self.sent = sent
            self.received = received
        }

        public var isEmpty: Bool { sent.isEmpty && received.isEmpty }
        /// Both sides have somebody: the AI desk can be asked.
        public var isComplete: Bool { !sent.isEmpty && !received.isEmpty }
        public func contains(_ player: Int) -> Bool { sent.contains(player) || received.contains(player) }

        /// The served deal (an offer's, a target's) as the builder holds it.
        public init(_ served: Components.Schemas.TradeDeal) {
            self.init(sent: served.sent, received: served.received)
        }

        var name: String { "\(sent.map(String.init).joined(separator: ","))>\(received.map(String.init).joined(separator: ","))" }
    }

    /// A side of the builder.
    public enum Side: String, Sendable, CaseIterable {
        case sent, received
    }

    /// One turn of the conversation with the AI desk: the GM's question, or the desk's answer as served.
    public struct Turn: Identifiable, Hashable, Sendable {
        public let id: Int
        public let question: String?
        public let answer: Components.Schemas.TradeAnswer?
    }

    public private(set) var desk: Components.Schemas.TradeDeskView?
    /// The deal on the builder.
    public private(set) var deal = Deal()
    /// Each deal weighed, by its players (the builder's current one, and the ones before it this session).
    public private(set) var analyses: [Deal: Components.Schemas.TradeAnalysisView] = [:]
    /// The conversation about the deal on the builder.
    public private(set) var turns: [Turn] = []
    /// The AI desk is answering.
    public private(set) var asking = false
    /// Why the AI desk didn't answer (the server's sentence: AI is off, a provider failed); nil when it did.
    public private(set) var askProblem: RequestProblem?
    /// Why a read failed (`desk`, `analysis`); absent when it did not.
    public private(set) var problems: [String: RequestProblem] = [:]
    public private(set) var loading: Set<String> = []

    private var loadedDeskKey: AppModel.StoreKey?
    private var askedDeskKey: AppModel.StoreKey?
    private var analysisKeys: [Deal: AppModel.StoreKey] = [:]
    private var askedDeal: Deal?
    private var followedKey: AppModel.StoreKey?
    private var turnCount = 0
    private let log: @MainActor (String) -> Void

    public init(log: @escaping @MainActor (String) -> Void = { _ in }) {
        self.log = log
    }

    /// The deal on the builder as last weighed (its analysis, current or being weighed again), else nil.
    public var analysis: Components.Schemas.TradeAnalysisView? { analyses[deal] }

    /// Whether the deal on the builder is being weighed, or what is shown was weighed for an earlier key.
    public func weighing(for key: AppModel.StoreKey?) -> Bool {
        loading.contains("analysis") || (key != nil && analysisKeys[deal] != key)
    }

    /// Whether the desk is being read again, or was read for an earlier key.
    public func deskUpdating(for key: AppModel.StoreKey?) -> Bool {
        loading.contains("desk") || (key != nil && loadedDeskKey != key)
    }

    /// Follows the app's key: on another save or club everything is dropped at once (another club's deal is never drawn,
    /// and its players are not this club's to send). A new import of the same club keeps the deal and asks again.
    public func follow(_ key: AppModel.StoreKey?) {
        guard let key else { return }
        defer { followedKey = key }
        guard let last = followedKey, last.saveId != key.saveId || last.club != key.club else { return }
        desk = nil
        deal = Deal()
        analyses = [:]
        analysisKeys = [:]
        turns = []
        askProblem = nil
        problems = [:]
        loadedDeskKey = nil
    }

    // MARK: The builder

    /// Puts a player on a side; one already on the other side moves across (a player is on one side only). The
    /// conversation about the old deal is cleared.
    public func add(_ player: Int, to side: Side) {
        var next = deal
        next.sent.removeAll { $0 == player }
        next.received.removeAll { $0 == player }
        switch side {
        case .sent: next.sent.append(player)
        case .received: next.received.append(player)
        }
        set(next)
    }

    /// Takes a player off the builder.
    public func remove(_ player: Int) {
        var next = deal
        next.sent.removeAll { $0 == player }
        next.received.removeAll { $0 == player }
        set(next)
    }

    /// Puts a whole deal on the builder (an offer's sides, a target alone on the side received), or clears it.
    public func load(_ next: Deal) {
        set(next)
    }

    private func set(_ next: Deal) {
        guard next != deal else { return }
        deal = next
        turns = []
        askProblem = nil
    }

    // MARK: Reading

    /// The Trade Desk for the key, once per key; the last good one stays while it is read again.
    public func loadDesk(client: Client?, key: AppModel.StoreKey?) async {
        guard let client, let key else { return }
        follow(key)
        if loadedDeskKey == key { return }
        if askedDeskKey == key, loading.contains("desk") { return }
        askedDeskKey = key
        loading.insert("desk")
        defer { if askedDeskKey == key { loading.remove("desk") } }
        let org = FrontOfficeStore.org(key)
        do {
            switch try await client.getTradeDesk(path: .init(org: org)) {
            case .ok(let answer):
                let view = try answer.body.json
                guard askedDeskKey == key else { return }
                desk = view
                loadedDeskKey = key
                problems["desk"] = nil
            case .notFound(let refused):
                guard askedDeskKey == key else { return }
                problems["desk"] = .served(try refused.body.json.error)
            case .undocumented(let code, let payload):
                guard askedDeskKey == key else { return }
                problems["desk"] = await .undocumented(code, body: payload.body, operation: "getTradeDesk", fromV2: true)
            }
        } catch {
            guard !RequestProblem.isCancellation(error), askedDeskKey == key else { return }
            let problem = RequestProblem.from(error)
            problems["desk"] = problem
            if let detail = problem.detail { log("could not read the Trade Desk: \(detail)") }
        }
    }

    /// Weighs the deal on the builder for the key (once per deal and key); an answer to a deal no longer on the builder
    /// is kept for that deal but never drawn as this one's.
    public func loadAnalysis(client: Client?, key: AppModel.StoreKey?) async {
        guard let client, let key else { return }
        follow(key)
        let asked = deal
        if analysisKeys[asked] == key { return }
        if askedDeal == asked, loading.contains("analysis") { return }
        askedDeal = asked
        loading.insert("analysis")
        defer { if askedDeal == asked { loading.remove("analysis") } }
        let org = FrontOfficeStore.org(key)
        let sent = asked.sent.isEmpty ? nil : asked.sent.map(String.init).joined(separator: ",")
        let received = asked.received.isEmpty ? nil : asked.received.map(String.init).joined(separator: ",")
        do {
            switch try await client.getTradeAnalysis(path: .init(org: org), query: .init(sent: sent, received: received)) {
            case .ok(let answer):
                let view = try answer.body.json
                analyses[asked] = view
                analysisKeys[asked] = key
                if askedDeal == asked { problems["analysis"] = nil }
            case .badRequest(let refused):
                if askedDeal == asked { problems["analysis"] = .served(try refused.body.json.error) }
            case .notFound(let refused):
                if askedDeal == asked { problems["analysis"] = .served(try refused.body.json.error) }
            case .undocumented(let code, let payload):
                if askedDeal == asked {
                    problems["analysis"] = await .undocumented(code, body: payload.body, operation: "getTradeAnalysis", fromV2: true)
                }
            }
        } catch {
            guard !RequestProblem.isCancellation(error), askedDeal == asked else { return }
            let problem = RequestProblem.from(error)
            problems["analysis"] = problem
            if let detail = problem.detail { log("could not weigh the deal: \(detail)") }
        }
    }

    // MARK: The AI desk (optional)

    /// Asks the AI desk about the deal on the builder: its read with no question, else its answer to the GM's question.
    /// Returns whether it answered; the question stays the GM's to send again when it didn't.
    @discardableResult
    public func ask(_ question: String?, client: Client?, key: AppModel.StoreKey?) async -> Bool {
        guard let client, let key, deal.isComplete, !asking else { return false }
        let asked = deal
        let message = question?.trimmingCharacters(in: .whitespacesAndNewlines)
        let thread: [Components.Schemas.TradeTurn] = turns.compactMap { turn in
            if let q = turn.question { return .init(role: "user", content: q) }
            if let a = turn.answer { return .init(role: "assistant", content: a.content) }
            return nil
        }
        asking = true
        askProblem = nil
        defer { asking = false }
        let body = Components.Schemas.TradeAsk(sent: asked.sent, received: asked.received, thread: thread, message: message?.isEmpty == false ? message : nil)
        do {
            let problem: RequestProblem
            switch try await client.askTradeDesk(path: .init(org: FrontOfficeStore.org(key)), body: .json(body)) {
            case .ok(let answer):
                let served = try answer.body.json
                guard deal == asked else { return false }
                if let message, !message.isEmpty { turns.append(Turn(id: next(), question: message, answer: nil)) }
                turns.append(Turn(id: next(), question: nil, answer: served))
                return true
            case .badRequest(let refused): problem = .served(try refused.body.json.error)
            case .notFound(let refused): problem = .served(try refused.body.json.error)
            case .conflict(let refused): problem = .served(try refused.body.json.error)
            case .badGateway(let refused): problem = .served(try refused.body.json.error)
            case .undocumented(let code, let payload):
                problem = await .undocumented(code, body: payload.body, operation: "askTradeDesk", fromV2: true)
            }
            if deal == asked { askProblem = problem }
        } catch {
            guard !RequestProblem.isCancellation(error) else { return false }
            let problem = RequestProblem.from(error)
            if deal == asked { askProblem = problem }
            if let detail = problem.detail { log("the AI desk could not be asked: \(detail)") }
        }
        return false
    }

    private func next() -> Int {
        turnCount += 1
        return turnCount
    }

    #if DEBUG
    /// A store holding served payloads, for `#Preview`s and snapshots (current for `key` when one is given).
    public static func preview(
        desk: Components.Schemas.TradeDeskView? = nil,
        analysis: Components.Schemas.TradeAnalysisView? = nil,
        answers: [Components.Schemas.TradeAnswer] = [],
        askProblem: RequestProblem? = nil,
        key: AppModel.StoreKey? = nil
    ) -> TradesStore {
        let store = TradesStore()
        store.desk = desk
        if let analysis {
            let deal = Deal(analysis.deal)
            store.deal = deal
            store.analyses[deal] = analysis
            if let key { store.analysisKeys[deal] = key }
        }
        store.turns = answers.map { store.turnFor($0) }
        store.askProblem = askProblem
        if let key { store.loadedDeskKey = key }
        return store
    }

    private func turnFor(_ answer: Components.Schemas.TradeAnswer) -> Turn {
        Turn(id: next(), question: nil, answer: answer)
    }
    #endif
}

extension AppModel {
    /// The Trade Desk for the current key (the view calls it in `.task(id: storeKey)`).
    public func loadTradeDesk() async {
        await trades.loadDesk(client: client, key: storeKey)
    }

    /// Weighs the deal on the builder for the current key.
    public func weighDeal() async {
        await trades.loadAnalysis(client: client, key: storeKey)
    }

    /// Asks the AI desk about the deal on the builder.
    @discardableResult
    public func askTradeDesk(_ question: String?) async -> Bool {
        await trades.ask(question, client: client, key: storeKey)
    }
}
