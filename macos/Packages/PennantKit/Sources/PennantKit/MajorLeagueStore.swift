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

    /// The last key the store was asked for: a save or club other than its own clears everything it holds.
    private var followedKey: AppModel.StoreKey?

    /// Whether the view shown was built from what the key names (`FrontOfficeStore.isCurrent`: the same import, club
    /// and build, by the payload's own stamps) for the key's save. A payload that is not is drawn as updating, never as
    /// current (the N8 review, M1).
    public func isCurrent(_ view: View, for key: AppModel.StoreKey?) -> Bool {
        guard let key, let loaded = loadedKeys[view], loaded.saveId == key.saveId, let stamps = stamps(view) else { return false }
        return FrontOfficeStore.isCurrent(importStamp: stamps.importStamp, reportStamp: stamps.reportStamp, orgId: stamps.orgId, for: key)
    }

    /// Whether a decision was built from what the key names (its own stamps, for the store's save).
    public func isCurrent(_ decision: Components.Schemas.MlbDecisionView, for key: AppModel.StoreKey?) -> Bool {
        guard let key, decisionsKey?.saveId == key.saveId else { return false }
        return FrontOfficeStore.isCurrent(importStamp: decision.importStamp, reportStamp: decision.reportStamp, orgId: decision.orgId, for: key)
    }

    private func stamps(_ view: View) -> (importStamp: String?, reportStamp: String?, orgId: Int?)? {
        switch view {
        case .overview: overview.map { ($0.importStamp, $0.reportStamp, $0.orgId) }
        case .positionPlayers: positionPlayers.map { ($0.importStamp, $0.reportStamp, $0.orgId) }
        case .pitchingStaff: pitchingStaff.map { ($0.importStamp, $0.reportStamp, $0.orgId) }
        case .benchBackups: bench.map { ($0.importStamp, $0.reportStamp, $0.orgId) }
        }
    }

    /// Follows the app's key: on another save or club, everything held is dropped at once, so another club's view or
    /// decision is never drawn, not even as updating ("never another club's"). A new import or build of the same club
    /// keeps what is shown, drawn as updating until the new one lands.
    public func follow(_ key: AppModel.StoreKey?) {
        guard let key else { return }
        defer { followedKey = key }
        guard let last = followedKey, last.saveId != key.saveId || last.club != key.club else { return }
        overview = nil
        positionPlayers = nil
        pitchingStaff = nil
        bench = nil
        problems = [:]
        loadedKeys = [:]
        decisions = [:]
        decisionProblems = [:]
        decisionsKey = nil
    }

    // MARK: The standing views

    /// Reads a view for the key, once per key; the last good one stays while it is read again.
    public func load(_ view: View, client: Client?, key: AppModel.StoreKey?) async {
        guard let client, let key else { return }
        follow(key)
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

    /// The requests in flight, by question, with the key each was asked for: a view whose task is cancelled (its key
    /// moved, the GM went Back) never cancels the server's answer, and a second ask for the same question waits on it.
    private var inFlight: [DecisionQuery: (key: AppModel.StoreKey, task: Task<Void, Never>)] = [:]

    /// Reads one decision for the key, once per key and question (the server builds it on its first open: a moment).
    public func loadDecision(_ query: DecisionQuery, client: Client?, key: AppModel.StoreKey?) async {
        guard let client, let key else { return }
        follow(key)
        if decisionsKey != key {
            decisions = [:]
            decisionProblems = [:]
            decisionsKey = key
        }
        guard decisions[query] == nil else { return }
        if let running = inFlight[query], running.key == key {
            await running.task.value
            return
        }
        let task = Task { await self.fetchDecision(query, client: client, key: key) }
        inFlight[query] = (key, task)
        await task.value
    }

    private func fetchDecision(_ query: DecisionQuery, client: Client, key: AppModel.StoreKey) async {
        loadingDecisions.insert(query)
        defer {
            if inFlight[query]?.key == key {
                inFlight[query] = nil
                loadingDecisions.remove(query)
            }
        }
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
        guard decisionsKey == key else { return }
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

    /// Takes a preview model's key as the one its payloads were read for (the model's key is known only once it is made).
    public func previewAdopt(_ key: AppModel.StoreKey?) {
        guard let key else { return }
        for view in View.allCases where has(view) { loadedKeys[view] = key }
        decisionsKey = key
        followedKey = key
    }
    #endif
}
