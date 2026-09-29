import Foundation
import Observation
import OpenAPIRuntime
import PennantAPI

/// Around the league (D-059; SWIFTUI_REBUILD.md section 3.4, "As built at N7"): the full wire as League Office shows it
/// (`GET /api/v2/wire/:org` with the served filters), any club's report for its window (`GET /api/v2/club/:teamId`),
/// and search (`GET /api/v2/search`). Every entry, order and sentence is the server's; the store keeps the last good
/// answer while a new one is asked, and drops an answer to an older question.
@Observable @MainActor
public final class LeagueStore {
    /// What the wire is asked for: the served filters (a club, a kind, only what the GM follows) and since when.
    public struct WireQuery: Hashable, Sendable {
        public var club: Int?
        /// A served kind (`trade`, `injury`, …); nil for every kind.
        public var kind: String?
        public var followedOnly: Bool
        /// The whole season rather than since the last export.
        public var season: Bool

        public init(club: Int? = nil, kind: String? = nil, followedOnly: Bool = false, season: Bool = false) {
            self.club = club
            self.kind = kind
            self.followedOnly = followedOnly
            self.season = season
        }
    }

    /// The wire as last served, and the question it answers.
    public private(set) var wire: Components.Schemas.Wire?
    public private(set) var wireQuery: WireQuery?
    public private(set) var wireProblem: RequestProblem?
    public private(set) var loadingWire = false
    private var wireAsked: (WireQuery, AppModel.StoreKey, String)?
    private var wireLoaded: (WireQuery, AppModel.StoreKey, String)?

    /// Each club's report as last served, by team id, with the key it was read for.
    public private(set) var clubs: [Int: Components.Schemas.ClubReport] = [:]
    public private(set) var clubProblems: [Int: RequestProblem] = [:]
    public private(set) var loadingClubs: Set<Int> = []
    private var clubKeys: [Int: AppModel.StoreKey] = [:]
    private var clubAsked: [Int: AppModel.StoreKey] = [:]

    private let log: @MainActor (String) -> Void

    public init(log: @escaping @MainActor (String) -> Void = { _ in }) {
        self.log = log
    }

    // MARK: The wire

    /// Reads the wire for the query and key, once each (and again when `stamp`, the summary's `deskStamp`, moves: a
    /// follow reorders it).
    public func loadWire(_ query: WireQuery, client: Client?, key: AppModel.StoreKey?, stamp: String = "") async {
        guard let client, let key else { return }
        if let loaded = wireLoaded, loaded == (query, key, stamp), wire != nil { return }
        wireAsked = (query, key, stamp)
        loadingWire = true
        defer { if wireAsked.map({ $0 == (query, key, stamp) }) ?? false { loadingWire = false } }
        var served: Components.Schemas.Wire?
        var problem: RequestProblem?
        do {
            let parameters = Operations.GetWire.Input.Query(
                since: query.season ? "season" : nil, club: query.club, kind: query.kind,
                followed: query.followedOnly ? "only" : "first"
            )
            switch try await client.getWire(path: .init(org: FrontOfficeStore.org(key)), query: parameters) {
            case .ok(let answer): served = try answer.body.json
            case .badRequest(let refused): problem = .served(try refused.body.json.error)
            case .notFound(let refused): problem = .served(try refused.body.json.error)
            case .undocumented(let code, let payload):
                problem = await .undocumented(code, body: payload.body, operation: "getWire", fromV2: true)
            }
        } catch {
            problem = .from(error)
        }
        guard let asked = wireAsked, asked == (query, key, stamp), !Task.isCancelled else { return }
        if let served {
            wire = served
            wireQuery = query
            wireLoaded = (query, key, stamp)
        }
        wireProblem = problem
        if let detail = problem?.detail { log("could not read the wire: \(detail)") }
    }

    // MARK: A club's report

    /// Whether the shown report of a club was read for this key.
    public func clubIsCurrent(_ id: Int, for key: AppModel.StoreKey?) -> Bool {
        guard let key, clubs[id] != nil else { return false }
        return clubKeys[id] == key
    }

    /// Reads a club's report for the key, once per key (a new import, club, save or build moves it); the last good one
    /// stays while it is read again.
    public func loadClub(_ id: Int, client: Client?, key: AppModel.StoreKey?) async {
        guard let client, let key, clubKeys[id] != key || clubs[id] == nil else { return }
        clubAsked[id] = key
        loadingClubs.insert(id)
        defer { if clubAsked[id] == key { loadingClubs.remove(id) } }
        var served: Components.Schemas.ClubReport?
        var problem: RequestProblem?
        do {
            switch try await client.getClubReport(path: .init(teamId: String(id))) {
            case .ok(let answer): served = try answer.body.json
            case .notFound(let refused): problem = .served(try refused.body.json.error)
            case .undocumented(let code, let payload):
                problem = await .undocumented(code, body: payload.body, operation: "getClubReport", fromV2: true)
            }
        } catch {
            problem = .from(error)
        }
        guard clubAsked[id] == key, !Task.isCancelled else { return }
        if let served {
            clubs[id] = served
            clubKeys[id] = key
        }
        clubProblems[id] = problem
        if let detail = problem?.detail { log("could not read a club's report: \(detail)") }
    }

    // MARK: Search

    /// Asks the server for what matches a query (`GET /api/v2/search?q=`): the served groups, in the served order. The
    /// caller debounces and cancels (a view's `.task(id: query)`); a cancelled question answers nothing.
    public func search(_ query: String, client: Client?) async -> Result<Components.Schemas.SearchAnswer, RequestProblem>? {
        guard let client else { return .failure(.notRunning) }
        do {
            let answer = try await client.search(query: .init(q: query)).ok.body.json
            return Task.isCancelled ? nil : .success(answer)
        } catch {
            if Task.isCancelled { return nil }
            let problem = RequestProblem.from(error)
            if let detail = problem.detail { log("could not search: \(detail)") }
            return .failure(problem)
        }
    }

    #if DEBUG
    /// A store holding served payloads, for `#Preview`s and snapshots.
    public static func preview(wire: Components.Schemas.Wire? = nil, clubs: [Components.Schemas.ClubReport] = [], key: AppModel.StoreKey? = nil) -> LeagueStore {
        let store = LeagueStore()
        store.wire = wire
        store.wireQuery = WireQuery()
        for club in clubs {
            store.clubs[club.teamId] = club
            if let key { store.clubKeys[club.teamId] = key }
        }
        if let key { store.wireLoaded = (WireQuery(), key, "") }
        return store
    }
    #endif
}
