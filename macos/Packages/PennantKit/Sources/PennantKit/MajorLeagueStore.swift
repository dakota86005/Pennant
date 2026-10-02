import Foundation
import Observation
import OpenAPIRuntime
import PennantAPI

/// Major League Ops' views (N8; SWIFTUI_REBUILD.md section 9): the report's companion, Position players, Pitching
/// staff, Bench & Backups (`GET /api/v2/views/:org/majorLeague/<view>`, served from the club's build, warmed after
/// every import) and the decisions the GM opens (`…/decision?need=`, built on their first open, kept until the next
/// import). Every row, word and choice is the server's; the store keeps the last good payload while a new one is
/// asked and drops an answer to an older question.
@Observable @MainActor
public final class MajorLeagueStore {
    /// A standing view's id, as the server serves it.
    public enum View: String, CaseIterable, Sendable {
        case overview, positionPlayers, pitchingStaff, benchBackups
    }

    /// What one decision is asked for: the need and the GM's served choices, sent back exactly as served.
    public struct DecisionQuery: Hashable, Sendable {
        public var need: String
        public var role: String?
        public var context: String?
        public var days: Int?

        public init(need: String, role: String? = nil, context: String? = nil, days: Int? = nil) {
            self.need = need
            self.role = role
            self.context = context
            self.days = days
        }

        /// A served choice's request.
        public init(_ served: Components.Schemas.MlbDecisionQuery) {
            self.init(need: served.need, role: served.role, context: served.context, days: served.days)
        }
    }

    public private(set) var overview: Components.Schemas.MlbOverviewView?
    public private(set) var positionPlayers: Components.Schemas.MlbPositionPlayersView?
    public private(set) var pitchingStaff: Components.Schemas.MlbPitchingStaffView?
    public private(set) var bench: Components.Schemas.MlbBenchView?
    public private(set) var problems: [View: RequestProblem] = [:]
    public private(set) var loading: Set<View> = []
    private var loadedKeys: [View: AppModel.StoreKey] = [:]
    private var askedKeys: [View: AppModel.StoreKey] = [:]

    /// Each decision as last served, by what it was asked for, for the key in `decisionsKey`.
    public private(set) var decisions: [DecisionQuery: Components.Schemas.MlbDecisionView] = [:]
    public private(set) var decisionProblems: [DecisionQuery: RequestProblem] = [:]
    public private(set) var loadingDecisions: Set<DecisionQuery> = []
    private var decisionsKey: AppModel.StoreKey?

    private let log: @MainActor (String) -> Void

    public init(log: @escaping @MainActor (String) -> Void = { _ in }) {
        self.log = log
    }

    /// Whether the view shown was read for this key (the same import, club and build).
    public func isCurrent(_ view: View, for key: AppModel.StoreKey?) -> Bool {
        guard let key else { return false }
        return loadedKeys[view] == key
    }

    // MARK: The standing views

    /// Reads a view for the key, once per key; the last good one stays while it is read again.
    public func load(_ view: View, client: Client?, key: AppModel.StoreKey?) async {
        guard let client, let key else { return }
        if loadedKeys[view] == key, has(view) { return }
        askedKeys[view] = key
        loading.insert(view)
        defer { if askedKeys[view] == key { loading.remove(view) } }
        let org = FrontOfficeStore.org(key)
        var problem: RequestProblem?
        var apply: (() -> Void)?
        do {
            switch view {
            case .overview:
                switch try await client.getMajorLeagueOverview(path: .init(org: org)) {
                case .ok(let answer): let body = try answer.body.json; apply = { self.overview = body }
                case .notFound(let refused): problem = .served(try refused.body.json.error)
                case .undocumented(let code, let payload):
                    problem = await .undocumented(code, body: payload.body, operation: "getMajorLeagueOverview", fromV2: true)
                }
            case .positionPlayers:
                switch try await client.getMajorLeaguePositionPlayers(path: .init(org: org)) {
                case .ok(let answer): let body = try answer.body.json; apply = { self.positionPlayers = body }
                case .notFound(let refused): problem = .served(try refused.body.json.error)
                case .undocumented(let code, let payload):
                    problem = await .undocumented(code, body: payload.body, operation: "getMajorLeaguePositionPlayers", fromV2: true)
                }
            case .pitchingStaff:
                switch try await client.getMajorLeaguePitchingStaff(path: .init(org: org)) {
                case .ok(let answer): let body = try answer.body.json; apply = { self.pitchingStaff = body }
                case .notFound(let refused): problem = .served(try refused.body.json.error)
                case .undocumented(let code, let payload):
                    problem = await .undocumented(code, body: payload.body, operation: "getMajorLeaguePitchingStaff", fromV2: true)
                }
            case .benchBackups:
                switch try await client.getMajorLeagueBench(path: .init(org: org)) {
                case .ok(let answer): let body = try answer.body.json; apply = { self.bench = body }
                case .notFound(let refused): problem = .served(try refused.body.json.error)
                case .undocumented(let code, let payload):
                    problem = await .undocumented(code, body: payload.body, operation: "getMajorLeagueBench", fromV2: true)
                }
            }
        } catch {
            problem = .from(error)
        }
        // A newer question was asked meanwhile: this answer is not the key's
        guard askedKeys[view] == key, !Task.isCancelled else { return }
        if let apply {
            apply()
            loadedKeys[view] = key
        }
        problems[view] = problem
        if let detail = problem?.detail { log("could not read Major League Ops' \(view.rawValue): \(detail)") }
    }

    private func has(_ view: View) -> Bool {
        switch view {
        case .overview: overview != nil
        case .positionPlayers: positionPlayers != nil
        case .pitchingStaff: pitchingStaff != nil
        case .benchBackups: bench != nil
        }
    }

    // MARK: Decisions

    /// Reads one decision for the key, once per key and question (the server builds it on its first open: a moment).
    public func loadDecision(_ query: DecisionQuery, client: Client?, key: AppModel.StoreKey?) async {
        guard let client, let key else { return }
        if decisionsKey != key {
            decisions = [:]
            decisionProblems = [:]
            decisionsKey = key
        }
        guard decisions[query] == nil, !loadingDecisions.contains(query) else { return }
        loadingDecisions.insert(query)
        defer { loadingDecisions.remove(query) }
        var served: Components.Schemas.MlbDecisionView?
        var problem: RequestProblem?
        do {
            let input = Operations.GetMajorLeagueDecision.Input(
                path: .init(org: FrontOfficeStore.org(key)),
                query: .init(need: query.need, role: query.role, context: query.context, days: query.days)
            )
            switch try await client.getMajorLeagueDecision(input) {
            case .ok(let answer): served = try answer.body.json
            case .notFound(let refused): problem = .served(try refused.body.json.error)
            case .undocumented(let code, let payload):
                problem = await .undocumented(code, body: payload.body, operation: "getMajorLeagueDecision", fromV2: true)
            }
        } catch {
            problem = .from(error)
        }
        // The key moved while it was read: an earlier build's decision is never kept as the current one's
        guard decisionsKey == key, !Task.isCancelled else { return }
        if let served { decisions[query] = served }
        decisionProblems[query] = problem
        if let detail = problem?.detail { log("could not read a decision: \(detail)") }
    }

    #if DEBUG
    /// A store holding served payloads, for `#Preview`s and snapshots.
    public static func preview(
        overview: Components.Schemas.MlbOverviewView? = nil,
        positionPlayers: Components.Schemas.MlbPositionPlayersView? = nil,
        pitchingStaff: Components.Schemas.MlbPitchingStaffView? = nil,
        bench: Components.Schemas.MlbBenchView? = nil,
        decisions: [DecisionQuery: Components.Schemas.MlbDecisionView] = [:],
        key: AppModel.StoreKey? = nil
    ) -> MajorLeagueStore {
        let store = MajorLeagueStore()
        store.overview = overview
        store.positionPlayers = positionPlayers
        store.pitchingStaff = pitchingStaff
        store.bench = bench
        store.decisions = decisions
        store.decisionsKey = key
        if let key { for view in View.allCases { store.loadedKeys[view] = key } }
        return store
    }
    #endif
}
