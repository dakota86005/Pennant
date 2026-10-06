import Foundation
import Observation
import OpenAPIRuntime
import PennantAPI

/// Major League Ops' clubhouse tools (N9; SWIFTUI_REBUILD.md section 9; D-069): Lineup, Pitching Availability, Schedule
/// & Game Plans, Depth Chart, 40-Man & Options, Rosters and Season Trends (`GET /api/v2/views/:org/majorLeague/<tool>`),
/// built by the server after every import, and what the GM asks of them: a card asked another way, a game's plan, one
/// of the organization's clubs' roster. Every word, order, tone and sort key is the server's; the store reads each once
/// per store key, keeps the last good payload while a newer one is asked, drops an answer to an older question, and
/// drops everything at once on another save or club (never another club's, as Major League Ops' own views).
@Observable @MainActor
public final class ClubhouseStore {
    /// What a lineup card is asked for, sent back exactly as a served choice gives it.
    public struct LineupQuery: Hashable, Sendable {
        public var vs: String
        public var style: String
        public var dh: String
        public var sort: String

        public init(vs: String, style: String, dh: String, sort: String) {
            self.vs = vs
            self.style = style
            self.dh = dh
            self.sort = sort
        }

        /// A served choice's ask.
        public init(_ served: Components.Schemas.MlbLineupQuery) {
            self.init(vs: served.vs, style: served.style, dh: served.dh, sort: served.sort)
        }

        var name: String { "lineup:\(vs).\(style).\(dh).\(sort)" }
    }

    /// The card the view opens on (the server's own ask), and every card asked since, by name.
    public private(set) var lineups: [String: Components.Schemas.MlbLineupView] = [:]
    public private(set) var pitching: Components.Schemas.MlbPitchingAvailabilityView?
    public private(set) var schedule: Components.Schemas.MlbScheduleView?
    /// Each game's plan as last served, by game id.
    public private(set) var plans: [Int: Components.Schemas.MlbGamePlanView] = [:]
    public private(set) var depth: Components.Schemas.MlbDepthChartView?
    public private(set) var fortyMan: Components.Schemas.MlbFortyManView?
    /// The major league club's roster (`rosters:default`) and each club asked since, by name.
    public private(set) var rosters: [String: Components.Schemas.MlbRostersView] = [:]
    public private(set) var trends: Components.Schemas.MlbSeasonTrendsView?
    /// Why a read failed, by what was asked (`pitching`, `plan:61`); absent when it did not.
    public private(set) var problems: [String: RequestProblem] = [:]
    /// What is being read now, by the same names.
    public private(set) var loading: Set<String> = []

    private var loadedKeys: [String: AppModel.StoreKey] = [:]
    private var askedKeys: [String: AppModel.StoreKey] = [:]
    private var followedKey: AppModel.StoreKey?
    private let log: @MainActor (String) -> Void

    public init(log: @escaping @MainActor (String) -> Void = { _ in }) {
        self.log = log
    }

    /// The names a tool's payloads are kept under.
    public static let lineupDefault = "lineup:default"
    public static func lineupName(_ query: LineupQuery?) -> String { query?.name ?? lineupDefault }
    public static func rosterName(_ team: Int?) -> String { team.map { "rosters:\($0)" } ?? "rosters:default" }
    public static func planName(_ game: Int) -> String { "plan:\(game)" }

    /// The card for an ask (the view's own card for none).
    public func lineup(_ query: LineupQuery?) -> Components.Schemas.MlbLineupView? { lineups[Self.lineupName(query)] }
    /// A club's roster (the major league club's for none).
    public func roster(_ team: Int?) -> Components.Schemas.MlbRostersView? { rosters[Self.rosterName(team)] }

    /// Follows the app's key: on another save or club, everything held is dropped at once, so another club's tool is
    /// never drawn, not even as updating. A new import or build of the same club keeps what is shown, drawn as updating.
    public func follow(_ key: AppModel.StoreKey?) {
        guard let key else { return }
        defer { followedKey = key }
        guard let last = followedKey, last.saveId != key.saveId || last.club != key.club else { return }
        lineups = [:]
        pitching = nil
        schedule = nil
        plans = [:]
        depth = nil
        fortyMan = nil
        rosters = [:]
        trends = nil
        problems = [:]
        loadedKeys = [:]
    }

    /// Whether what is shown under `name` was built from what the key names (its own stamps, for the key's save):
    /// otherwise it is drawn as updating.
    public func isCurrent(_ name: String, for key: AppModel.StoreKey?) -> Bool {
        guard let key, let loaded = loadedKeys[name], loaded.saveId == key.saveId, let head = head(name) else { return false }
        return FrontOfficeStore.isCurrent(importStamp: head.importStamp, reportStamp: head.reportStamp, orgId: head.orgId, for: key)
    }

    /// Whether a tool is drawn as updating: it is being read again, or what is shown was built for an earlier key. With no
    /// key yet (a preview, before the server is ready) only a read under way says so.
    public func updating(_ name: String, for key: AppModel.StoreKey?) -> Bool {
        guard key != nil else { return loading.contains(name) }
        return loading.contains(name) || !isCurrent(name, for: key)
    }

    private func head(_ name: String) -> (importStamp: String?, reportStamp: String, orgId: Int)? {
        if name.hasPrefix("lineup:") { return lineups[name].map { ($0.importStamp, $0.reportStamp, $0.orgId) } }
        if name.hasPrefix("rosters:") { return rosters[name].map { ($0.importStamp, $0.reportStamp, $0.orgId) } }
        if name.hasPrefix("plan:"), let game = Int(name.dropFirst(5)) { return plans[game].map { ($0.importStamp, $0.reportStamp, $0.orgId) } }
        switch name {
        case "pitching": return pitching.map { ($0.importStamp, $0.reportStamp, $0.orgId) }
        case "schedule": return schedule.map { ($0.importStamp, $0.reportStamp, $0.orgId) }
        case "depth": return depth.map { ($0.importStamp, $0.reportStamp, $0.orgId) }
        case "fortyMan": return fortyMan.map { ($0.importStamp, $0.reportStamp, $0.orgId) }
        case "trends": return trends.map { ($0.importStamp, $0.reportStamp, $0.orgId) }
        default: return nil
        }
    }

    // MARK: Reading

    /// A lineup card for an ask (the server's own for none), once per key.
    public func loadLineup(_ query: LineupQuery?, client: Client?, key: AppModel.StoreKey?) async {
        let org = key.map(FrontOfficeStore.org) ?? "automatic"
        let name = Self.lineupName(query)
        await read(name, client: client, key: key, operation: "getMajorLeagueLineup") { client in
            let input = Operations.GetMajorLeagueLineup.Input(
                path: .init(org: org),
                query: .init(vs: query?.vs, style: query?.style, dh: query?.dh, sort: query?.sort)
            )
            switch try await client.getMajorLeagueLineup(input) {
            case .ok(let answer): return .success(try answer.body.json)
            case .notFound(let refused): return .failure(.served(try refused.body.json.error))
            case .undocumented(let code, let payload):
                return .failure(await .undocumented(code, body: payload.body, operation: "getMajorLeagueLineup", fromV2: true))
            }
        } keep: { self.lineups[name] = $0 }
    }

    public func loadPitching(client: Client?, key: AppModel.StoreKey?) async {
        let org = key.map(FrontOfficeStore.org) ?? "automatic"
        await read("pitching", client: client, key: key, operation: "getMajorLeaguePitchingAvailability") { client in
            switch try await client.getMajorLeaguePitchingAvailability(path: .init(org: org)) {
            case .ok(let answer): return .success(try answer.body.json)
            case .notFound(let refused): return .failure(.served(try refused.body.json.error))
            case .undocumented(let code, let payload):
                return .failure(await .undocumented(code, body: payload.body, operation: "getMajorLeaguePitchingAvailability", fromV2: true))
            }
        } keep: { self.pitching = $0 }
    }

    public func loadSchedule(client: Client?, key: AppModel.StoreKey?) async {
        let org = key.map(FrontOfficeStore.org) ?? "automatic"
        await read("schedule", client: client, key: key, operation: "getMajorLeagueSchedule") { client in
            switch try await client.getMajorLeagueSchedule(path: .init(org: org)) {
            case .ok(let answer): return .success(try answer.body.json)
            case .notFound(let refused): return .failure(.served(try refused.body.json.error))
            case .undocumented(let code, let payload):
                return .failure(await .undocumented(code, body: payload.body, operation: "getMajorLeagueSchedule", fromV2: true))
            }
        } keep: { self.schedule = $0 }
    }

    /// One game's plan, once per key (the next games' are read ahead on the server; another is worked out on this ask).
    public func loadPlan(_ game: Int, client: Client?, key: AppModel.StoreKey?) async {
        let org = key.map(FrontOfficeStore.org) ?? "automatic"
        await read(Self.planName(game), client: client, key: key, operation: "getMajorLeagueGamePlan") { client in
            switch try await client.getMajorLeagueGamePlan(path: .init(org: org), query: .init(game: game)) {
            case .ok(let answer): return .success(try answer.body.json)
            case .notFound(let refused): return .failure(.served(try refused.body.json.error))
            case .undocumented(let code, let payload):
                return .failure(await .undocumented(code, body: payload.body, operation: "getMajorLeagueGamePlan", fromV2: true))
            }
        } keep: { self.plans[game] = $0 }
    }

    public func loadDepth(client: Client?, key: AppModel.StoreKey?) async {
        let org = key.map(FrontOfficeStore.org) ?? "automatic"
        await read("depth", client: client, key: key, operation: "getMajorLeagueDepthChart") { client in
            switch try await client.getMajorLeagueDepthChart(path: .init(org: org)) {
            case .ok(let answer): return .success(try answer.body.json)
            case .notFound(let refused): return .failure(.served(try refused.body.json.error))
            case .undocumented(let code, let payload):
                return .failure(await .undocumented(code, body: payload.body, operation: "getMajorLeagueDepthChart", fromV2: true))
            }
        } keep: { self.depth = $0 }
    }

    public func loadFortyMan(client: Client?, key: AppModel.StoreKey?) async {
        let org = key.map(FrontOfficeStore.org) ?? "automatic"
        await read("fortyMan", client: client, key: key, operation: "getMajorLeagueFortyMan") { client in
            switch try await client.getMajorLeagueFortyMan(path: .init(org: org)) {
            case .ok(let answer): return .success(try answer.body.json)
            case .notFound(let refused): return .failure(.served(try refused.body.json.error))
            case .undocumented(let code, let payload):
                return .failure(await .undocumented(code, body: payload.body, operation: "getMajorLeagueFortyMan", fromV2: true))
            }
        } keep: { self.fortyMan = $0 }
    }

    /// One of the organization's clubs' roster (the major league club's for none), once per key.
    public func loadRoster(_ team: Int?, client: Client?, key: AppModel.StoreKey?) async {
        let org = key.map(FrontOfficeStore.org) ?? "automatic"
        let name = Self.rosterName(team)
        await read(name, client: client, key: key, operation: "getMajorLeagueRosters") { client in
            switch try await client.getMajorLeagueRosters(path: .init(org: org), query: .init(team: team)) {
            case .ok(let answer): return .success(try answer.body.json)
            case .notFound(let refused): return .failure(.served(try refused.body.json.error))
            case .undocumented(let code, let payload):
                return .failure(await .undocumented(code, body: payload.body, operation: "getMajorLeagueRosters", fromV2: true))
            }
        } keep: { self.rosters[name] = $0 }
    }

    public func loadTrends(client: Client?, key: AppModel.StoreKey?) async {
        let org = key.map(FrontOfficeStore.org) ?? "automatic"
        await read("trends", client: client, key: key, operation: "getMajorLeagueSeasonTrends") { client in
            switch try await client.getMajorLeagueSeasonTrends(path: .init(org: org)) {
            case .ok(let answer): return .success(try answer.body.json)
            case .notFound(let refused): return .failure(.served(try refused.body.json.error))
            case .undocumented(let code, let payload):
                return .failure(await .undocumented(code, body: payload.body, operation: "getMajorLeagueSeasonTrends", fromV2: true))
            }
        } keep: { self.trends = $0 }
    }

    /// Asks once per name and key; keeps the answer only when it answers the question last asked under that name.
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
            // A request called off (the view's task, or the load itself) is a non-event: no problem line, no log line
            if RequestProblem.isCancellation(error) { return }
            // Its detail is `RequestProblem.logLine`: the operation, the status, the error's domain and code, never the
            // error's own description (review H1, N11)
            answer = .failure(.from(error))
        }
        // A newer question was asked meanwhile, or another save or club: this answer is not the key's
        guard askedKeys[name] == key, followedKey?.saveId == key.saveId, followedKey?.club == key.club, !Task.isCancelled else { return }
        switch answer {
        case .success(let payload):
            keep(payload)
            loadedKeys[name] = key
            problems[name] = nil
        case .failure(let problem):
            problems[name] = problem
            if let detail = problem.detail { log("could not read Major League Ops' \(name): \(detail)") }
        }
    }

    #if DEBUG
    /// A store holding served payloads, for `#Preview`s and snapshots.
    public static func preview(
        lineup: Components.Schemas.MlbLineupView? = nil,
        pitching: Components.Schemas.MlbPitchingAvailabilityView? = nil,
        schedule: Components.Schemas.MlbScheduleView? = nil,
        plans: [Components.Schemas.MlbGamePlanView] = [],
        depth: Components.Schemas.MlbDepthChartView? = nil,
        fortyMan: Components.Schemas.MlbFortyManView? = nil,
        roster: Components.Schemas.MlbRostersView? = nil,
        trends: Components.Schemas.MlbSeasonTrendsView? = nil
    ) -> ClubhouseStore {
        let store = ClubhouseStore()
        if let lineup { store.lineups[lineupDefault] = lineup }
        store.pitching = pitching
        store.schedule = schedule
        for plan in plans { store.plans[plan.query.game] = plan }
        store.depth = depth
        store.fortyMan = fortyMan
        if let roster { store.rosters[rosterName(nil)] = roster }
        store.trends = trends
        return store
    }

    /// Takes a preview model's key as the one its payloads were read for (the model's key is known only once it is made).
    public func previewAdopt(_ key: AppModel.StoreKey?) {
        guard let key else { return }
        followedKey = key
        let names = [Array(lineups.keys), Array(rosters.keys), plans.keys.map(Self.planName), ["pitching", "schedule", "depth", "fortyMan", "trends"]]
        for name in names.flatMap({ $0 }) where head(name) != nil { loadedKeys[name] = key }
    }
    #endif
}
