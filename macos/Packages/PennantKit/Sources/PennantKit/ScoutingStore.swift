import Foundation
import Observation
import OpenAPIRuntime
import PennantAPI

/// Scouting's views (N12 Track B; SWIFTUI_REBUILD.md section 9; D-072): the Draft Board and Player Search
/// (`GET /api/v2/views/:org/scouting/<view>`). Every word, order, tone, token and sort key is the server's. The board is
/// asked by its served filters' keys (its top 300 at first, every prospect on a filter or "Show all"), and a prospect's
/// reasons when he is chosen; a search is asked with the words typed, the served tokens chosen and the column it is
/// sorted by (the server sorts every match), its next pages appended as asked. Only the answer to the latest search is
/// kept as current. The store reads each once per store key, keeps the last good payload while a newer one is asked,
/// and drops everything at once on another save or club.
@Observable @MainActor
public final class ScoutingStore {
    /// What a search asks: the words typed, the chosen tokens' served ids, and the served column it is sorted by (nil: the
    /// server's own order) and which way (`asc`, `desc`).
    public struct SearchQuery: Hashable, Sendable {
        public var q: String
        public var tokens: [String]
        public var sort: String?
        public var dir: String

        public init(q: String = "", tokens: [String] = [], sort: String? = nil, dir: String = "desc") {
            self.q = q
            self.tokens = tokens
            self.sort = sort
            self.dir = sort == nil ? "desc" : dir
        }

        /// The served query (`view.query`), as the server read it.
        public init(_ served: Components.Schemas.ScoutingSearchQuery) {
            self.init(q: served.q, tokens: served.tokens, sort: served.sort, dir: served.dir.value1?.rawValue ?? served.dir.value2 ?? "desc")
        }

        /// The ask as the server keys it: its words trimmed and its tokens in order, so "SS" then "AAA" and "AAA" then "SS"
        /// are one question.
        public var normalized: SearchQuery {
            SearchQuery(q: q.trimmingCharacters(in: .whitespacesAndNewlines), tokens: Array(Set(tokens)).sorted(), sort: sort, dir: dir)
        }

        var name: String { "search:\(normalized.q.lowercased())|\(normalized.tokens.joined(separator: ","))|\(sort ?? ""):\(dir)" }
    }

    /// What the Draft Board asks: a position group and a school by their served keys, and whether every prospect.
    public struct BoardQuery: Hashable, Sendable {
        public var position: String
        public var school: String
        public var all: Bool

        public init(position: String = "all", school: String = "all", all: Bool = false) {
            self.position = position
            self.school = school
            self.all = all
        }

        /// The served query (`view.query`), as the server read it.
        public init(_ served: Components.Schemas.ScoutingBoardQuery) {
            self.init(position: served.position, school: served.school, all: served.all)
        }

        var name: String { "draftBoard:\(position)|\(school)|\(all ? "all" : "top")" }
    }

    /// The Draft Board as it opens (its top 300, every position and school), when read.
    public var draftBoard: Components.Schemas.ScoutingDraftBoardView? { boards[BoardQuery().name] }
    /// The Draft Board for each ask, by its name.
    public private(set) var boards: [String: Components.Schemas.ScoutingDraftBoardView] = [:]
    /// The board answered most recently (shown while a newer ask is read, drawn as updating).
    public private(set) var lastBoard: Components.Schemas.ScoutingDraftBoardView?
    /// Each chosen prospect's reasons for his read, by his player id.
    public private(set) var prospects: [Int: Components.Schemas.ScoutingProspectView] = [:]
    /// Each search's further pages, in order, by the search's name (its first page is `searches`).
    public private(set) var morePages: [String: [Components.Schemas.ScoutingPlayerSearchView]] = [:]
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
    public static func boardName(_ query: BoardQuery) -> String { query.name }
    public static func prospectName(_ playerId: Int) -> String { "prospect:\(playerId)" }
    static func pageName(_ query: SearchQuery, offset: Int) -> String { "\(query.normalized.name)@\(offset)" }

    /// The answer to a search (its first page), when it has been read.
    public func search(_ query: SearchQuery) -> Components.Schemas.ScoutingPlayerSearchView? { searches[query.name] }

    /// The board for an ask, when it has been read.
    public func board(_ query: BoardQuery) -> Components.Schemas.ScoutingDraftBoardView? { boards[query.name] }

    /// A search's results as one table: its first page's rows, then each further page's, in the served order; nil until
    /// the first page is read.
    public func searchResults(_ query: SearchQuery) -> Components.Schemas.OfficeTable? {
        guard var table = searches[query.normalized.name]?.results else { return nil }
        for page in morePages[query.normalized.name] ?? [] { table.rows += page.results.rows }
        return table
    }

    /// A search's last page read (its count and what asks for more), else its first.
    public func lastPage(_ query: SearchQuery) -> Components.Schemas.ScoutingPlayerSearchView? {
        morePages[query.normalized.name]?.last ?? searches[query.normalized.name]
    }

    public func follow(_ key: AppModel.StoreKey?) {
        guard let key else { return }
        defer { followedKey = key }
        guard let last = followedKey, last.saveId != key.saveId || last.club != key.club else { return }
        boards = [:]
        lastBoard = nil
        prospects = [:]
        morePages = [:]
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
        if name.hasPrefix("search:"), !name.contains("@") { return searches[name].map { ($0.importStamp, $0.reportStamp, $0.orgId) } }
        if name.hasPrefix("draftBoard:") { return boards[name].map { ($0.importStamp, $0.reportStamp, $0.orgId) } }
        if name.hasPrefix("prospect:"), let id = Int(name.dropFirst("prospect:".count)) {
            return prospects[id].map { ($0.importStamp, $0.reportStamp, $0.orgId) }
        }
        return nil
    }

    // MARK: Reading

    /// The board for an ask (its served filters' keys, every prospect or the top 300), once per key.
    public func loadDraftBoard(_ query: BoardQuery = BoardQuery(), client: Client?, key: AppModel.StoreKey?) async {
        let org = key.map(FrontOfficeStore.org) ?? "automatic"
        let name = query.name
        if let held = boards[name], loadedKeys[name] == key { lastBoard = held }
        await read(name, client: client, key: key, operation: "getScoutingDraftBoard") { client in
            let input = Operations.GetScoutingDraftBoard.Input(
                path: .init(org: org),
                query: .init(
                    position: query.position == "all" ? nil : query.position,
                    school: query.school == "all" ? nil : query.school,
                    all: query.all ? "1" : nil
                )
            )
            switch try await client.getScoutingDraftBoard(input) {
            case .ok(let answer): return .success(try answer.body.json)
            case .notFound(let refused): return .failure(.served(try refused.body.json.error))
            case .undocumented(let code, let payload):
                return .failure(await .undocumented(code, body: payload.body, operation: "getScoutingDraftBoard", fromV2: true))
            }
        } keep: { view in
            self.boards[name] = view
            self.lastBoard = view
        }
    }

    /// A chosen prospect's reasons for his read, read when he is chosen (the board's rows don't carry them).
    public func loadProspect(_ playerId: Int, client: Client?, key: AppModel.StoreKey?) async {
        let org = key.map(FrontOfficeStore.org) ?? "automatic"
        await read(Self.prospectName(playerId), client: client, key: key, operation: "getScoutingDraftProspect") { client in
            switch try await client.getScoutingDraftProspect(path: .init(org: org, player: playerId)) {
            case .ok(let answer): return .success(try answer.body.json)
            case .notFound(let refused): return .failure(.served(try refused.body.json.error))
            case .undocumented(let code, let payload):
                return .failure(await .undocumented(code, body: payload.body, operation: "getScoutingDraftProspect", fromV2: true))
            }
        } keep: { self.prospects[playerId] = $0 }
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
                query: .init(
                    q: asked.q.isEmpty ? nil : asked.q,
                    tokens: asked.tokens.isEmpty ? nil : asked.tokens.joined(separator: ","),
                    sort: asked.sort,
                    dir: asked.sort == nil ? nil : asked.dir
                )
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
            self.morePages[name] = nil
            if self.latestName == name { self.lastSearch = view }
        }
    }

    /// A search's next page (the served `more`: its offset), appended to the pages read; once per key and offset.
    public func loadMore(_ query: SearchQuery, offset: Int, client: Client?, key: AppModel.StoreKey?) async {
        let org = key.map(FrontOfficeStore.org) ?? "automatic"
        let asked = query.normalized
        let name = asked.name
        // Only the page after the last one read, so the pages stay in the served order
        let shown = searches[name].map { first in first.results.rows.count + (morePages[name] ?? []).reduce(0) { $0 + $1.results.rows.count } }
        guard shown == offset else { return }
        await self.read(Self.pageName(asked, offset: offset), client: client, key: key, operation: "getScoutingPlayerSearch") { client in
            let input = Operations.GetScoutingPlayerSearch.Input(
                path: .init(org: org),
                query: .init(
                    q: asked.q.isEmpty ? nil : asked.q,
                    tokens: asked.tokens.isEmpty ? nil : asked.tokens.joined(separator: ","),
                    sort: asked.sort,
                    dir: asked.sort == nil ? nil : asked.dir,
                    offset: offset
                )
            )
            switch try await client.getScoutingPlayerSearch(input) {
            case .ok(let answer): return .success(try answer.body.json)
            case .notFound(let refused): return .failure(.served(try refused.body.json.error))
            case .undocumented(let code, let payload):
                return .failure(await .undocumented(code, body: payload.body, operation: "getScoutingPlayerSearch", fromV2: true))
            }
        } keep: { view in
            guard self.searches[name] != nil, view.query.offset == offset else { return }
            self.morePages[name, default: []].append(view)
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
            let what = name.hasPrefix("search:") ? "search" : name.hasPrefix("prospect:") ? "prospect's reasons" : name.hasPrefix("draftBoard:") ? "draft board" : name
            if let detail = problem.detail { log("could not read Scouting's \(what): \(detail)") }
        }
    }

    #if DEBUG
    public static func preview(
        draftBoard: Components.Schemas.ScoutingDraftBoardView? = nil,
        prospects: [Components.Schemas.ScoutingProspectView] = [],
        search: Components.Schemas.ScoutingPlayerSearchView? = nil
    ) -> ScoutingStore {
        let store = ScoutingStore()
        if let draftBoard {
            store.boards[BoardQuery(draftBoard.query).name] = draftBoard
            store.lastBoard = draftBoard
        }
        for prospect in prospects { store.prospects[prospect.playerId] = prospect }
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
        let names = Array(boards.keys) + Array(searches.keys) + prospects.keys.map(Self.prospectName)
        for name in names where head(name) != nil { loadedKeys[name] = key }
    }
    #endif
}
