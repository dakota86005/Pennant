import Foundation
import Observation
import OpenAPIRuntime
import PennantAPI

/// Scouting's views (N12 Track B; SWIFTUI_REBUILD.md section 9; D-072): the Draft Board and Player Search
/// (`GET /api/v2/views/:org/scouting/<view>`). Every word, order, tone, token and sort key is the server's; a search is
/// asked with the words typed and the served tokens chosen, and only the answer to the latest search is kept as current.
/// The store reads each once per store key, keeps the last good payload while a newer one is asked, and drops everything
/// at once on another save or club.
@Observable @MainActor
public final class ScoutingStore {
    /// What a search asks: the words typed and the chosen tokens' served ids.
    public struct SearchQuery: Hashable, Sendable {
        public var q: String
        public var tokens: [String]

        public init(q: String = "", tokens: [String] = []) {
            self.q = q
            self.tokens = tokens
        }

        /// The served query (`view.query`), as the server read it.
        public init(_ served: Components.Schemas.ScoutingSearchQuery) {
            self.init(q: served.q, tokens: served.tokens)
        }

        /// The ask as the server keys it: its words trimmed and its tokens in order, so "SS" then "AAA" and "AAA" then "SS"
        /// are one question.
        public var normalized: SearchQuery {
            SearchQuery(q: q.trimmingCharacters(in: .whitespacesAndNewlines), tokens: Array(Set(tokens)).sorted())
        }

        var name: String { "search:\(normalized.q.lowercased())|\(normalized.tokens.joined(separator: ","))" }
    }

    public private(set) var draftBoard: Components.Schemas.ScoutingDraftBoardView?
    /// Each search answered, by its name; `latestSearch` names the one last asked.
    public private(set) var searches: [String: Components.Schemas.ScoutingPlayerSearchView] = [:]
    /// The search answered most recently (shown while a newer one is read, drawn as updating).
    public private(set) var lastSearch: Components.Schemas.ScoutingPlayerSearchView?
    public private(set) var problems: [String: RequestProblem] = [:]
    public private(set) var loading: Set<String> = []

    private var loadedKeys: [String: AppModel.StoreKey] = [:]
    private var askedKeys: [String: AppModel.StoreKey] = [:]
    private var followedKey: AppModel.StoreKey?
    private var latestName: String?
    private let log: @MainActor (String) -> Void

    /// The searches kept at most (the oldest dropped first).
    static let keptSearches = 32
    private var searchOrder: [String] = []

    public init(log: @escaping @MainActor (String) -> Void = { _ in }) {
        self.log = log
    }

    public static func searchName(_ query: SearchQuery) -> String { query.name }

    /// The answer to a search, when it has been read.
    public func search(_ query: SearchQuery) -> Components.Schemas.ScoutingPlayerSearchView? { searches[query.name] }

    public func follow(_ key: AppModel.StoreKey?) {
        guard let key else { return }
        defer { followedKey = key }
        guard let last = followedKey, last.saveId != key.saveId || last.club != key.club else { return }
        draftBoard = nil
        searches = [:]
        searchOrder = []
        lastSearch = nil
        problems = [:]
        loadedKeys = [:]
    }

    public func isCurrent(_ name: String, for key: AppModel.StoreKey?) -> Bool {
        guard let key, let loaded = loadedKeys[name], loaded.saveId == key.saveId, let head = head(name) else { return false }
        return FrontOfficeStore.isCurrent(importStamp: head.importStamp, reportStamp: head.reportStamp, orgId: head.orgId, for: key)
    }

    public func updating(_ name: String, for key: AppModel.StoreKey?) -> Bool {
        guard key != nil else { return loading.contains(name) }
        return loading.contains(name) || !isCurrent(name, for: key)
    }

    private func head(_ name: String) -> (importStamp: String?, reportStamp: String, orgId: Int)? {
        if name.hasPrefix("search:") { return searches[name].map { ($0.importStamp, $0.reportStamp, $0.orgId) } }
        return name == "draftBoard" ? draftBoard.map { ($0.importStamp, $0.reportStamp, $0.orgId) } : nil
    }

    // MARK: Reading

    public func loadDraftBoard(client: Client?, key: AppModel.StoreKey?) async {
        let org = key.map(FrontOfficeStore.org) ?? "automatic"
        await read("draftBoard", client: client, key: key, operation: "getScoutingDraftBoard") { client in
            switch try await client.getScoutingDraftBoard(path: .init(org: org)) {
            case .ok(let answer): return .success(try answer.body.json)
            case .notFound(let refused): return .failure(.served(try refused.body.json.error))
            case .undocumented(let code, let payload):
                return .failure(await .undocumented(code, body: payload.body, operation: "getScoutingDraftBoard", fromV2: true))
            }
        } keep: { self.draftBoard = $0 }
    }

    /// A search, once per key; the answer to an earlier search that lands after a newer one was asked is kept but never
    /// shown as the latest.
    public func loadSearch(_ query: SearchQuery, client: Client?, key: AppModel.StoreKey?) async {
        let org = key.map(FrontOfficeStore.org) ?? "automatic"
        let asked = query.normalized
        let name = asked.name
        latestName = name
        if let held = searches[name], loadedKeys[name] == key { lastSearch = held }
        await read(name, client: client, key: key, operation: "getScoutingPlayerSearch") { client in
            let input = Operations.GetScoutingPlayerSearch.Input(
                path: .init(org: org),
                query: .init(q: asked.q.isEmpty ? nil : asked.q, tokens: asked.tokens.isEmpty ? nil : asked.tokens.joined(separator: ","))
            )
            switch try await client.getScoutingPlayerSearch(input) {
            case .ok(let answer): return .success(try answer.body.json)
            case .notFound(let refused): return .failure(.served(try refused.body.json.error))
            case .undocumented(let code, let payload):
                return .failure(await .undocumented(code, body: payload.body, operation: "getScoutingPlayerSearch", fromV2: true))
            }
        } keep: { view in
            self.searches[name] = view
            self.searchOrder.removeAll { $0 == name }
            self.searchOrder.append(name)
            while self.searchOrder.count > Self.keptSearches { self.searches[self.searchOrder.removeFirst()] = nil }
            if self.latestName == name { self.lastSearch = view }
        }
    }

    private func read<Payload: Sendable>(
        _ name: String,
        client: Client?,
        key: AppModel.StoreKey?,
        operation: String,
        ask: @escaping @Sendable (Client) async throws -> Result<Payload, RequestProblem>,
        keep: (Payload) -> Void
    ) async {
        guard let client, let key else { return }
        follow(key)
        if loadedKeys[name] == key { return }
        if askedKeys[name] == key, loading.contains(name) { return }
        askedKeys[name] = key
        loading.insert(name)
        defer { if askedKeys[name] == key { loading.remove(name) } }
        let answer: Result<Payload, RequestProblem>
        do {
            answer = try await ask(client)
        } catch {
            if RequestProblem.isCancellation(error) { return }
            answer = .failure(.from(error))
        }
        guard askedKeys[name] == key, followedKey?.saveId == key.saveId, followedKey?.club == key.club, !Task.isCancelled else { return }
        switch answer {
        case .success(let payload):
            keep(payload)
            loadedKeys[name] = key
            problems[name] = nil
        case .failure(let problem):
            problems[name] = problem
            if let detail = problem.detail { log("could not read Scouting's \(name.hasPrefix("search:") ? "search" : name): \(detail)") }
        }
    }

    #if DEBUG
    public static func preview(
        draftBoard: Components.Schemas.ScoutingDraftBoardView? = nil,
        search: Components.Schemas.ScoutingPlayerSearchView? = nil
    ) -> ScoutingStore {
        let store = ScoutingStore()
        store.draftBoard = draftBoard
        if let search {
            let name = SearchQuery(search.query).name
            store.searches[name] = search
            store.searchOrder = [name]
            store.lastSearch = search
            store.latestName = name
        }
        return store
    }

    public func previewAdopt(_ key: AppModel.StoreKey?) {
        guard let key else { return }
        followedKey = key
        for name in ["draftBoard"] + Array(searches.keys) where head(name) != nil { loadedKeys[name] = key }
    }
    #endif
}
