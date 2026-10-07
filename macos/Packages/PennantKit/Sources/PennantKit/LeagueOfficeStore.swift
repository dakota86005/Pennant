import Foundation
import Observation
import OpenAPIRuntime
import PennantAPI

/// League Office's views (N12 Track B; SWIFTUI_REBUILD.md section 9; D-072): Standings, Leaders, Org Comparison,
/// Franchise History and Us vs Them (`GET /api/v2/views/:org/league/<view>`), built by the server after every import, and
/// Us vs Them against another club the GM chose. Every word, order, tone and sort key is the server's. The store reads
/// each once per store key, keeps the last good payload while a newer one is asked, drops an answer to an older
/// question, and drops everything at once on another save or club (never another club's view drawn as ours).
@Observable @MainActor
public final class LeagueOfficeStore {
    public private(set) var standings: Components.Schemas.LeagueStandingsView?
    public private(set) var leaders: Components.Schemas.LeagueLeadersView?
    public private(set) var orgComparison: Components.Schemas.LeagueOrgComparisonView?
    public private(set) var franchise: Components.Schemas.LeagueFranchiseView?
    /// Us vs Them as it opens (`usVsThem:default`) and against each club asked since (`usVsThem:<team>`).
    public private(set) var usVsThem: [String: Components.Schemas.LeagueUsVsThemView] = [:]
    /// Why a read failed, by what was asked; absent when it did not.
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

    public static func usVsThemName(_ team: Int?) -> String { team.map { "usVsThem:\($0)" } ?? "usVsThem:default" }

    /// Us vs Them against a club (the one it opens on for none).
    public func usVsThem(_ team: Int?) -> Components.Schemas.LeagueUsVsThemView? { usVsThem[Self.usVsThemName(team)] }

    /// Follows the app's key: on another save or club everything held is dropped at once; a new import of the same club
    /// keeps what is shown, drawn as updating.
    public func follow(_ key: AppModel.StoreKey?) {
        guard let key else { return }
        defer { followedKey = key }
        guard let last = followedKey, last.saveId != key.saveId || last.club != key.club else { return }
        standings = nil
        leaders = nil
        orgComparison = nil
        franchise = nil
        usVsThem = [:]
        problems = [:]
        loadedKeys = [:]
    }

    /// Whether what is shown under `name` was built from what the key names; otherwise it is drawn as updating.
    public func isCurrent(_ name: String, for key: AppModel.StoreKey?) -> Bool {
        guard let key, let loaded = loadedKeys[name], loaded.saveId == key.saveId, let head = head(name) else { return false }
        return FrontOfficeStore.isCurrent(importStamp: head.importStamp, reportStamp: head.reportStamp, orgId: head.orgId, for: key)
    }

    /// Whether a view is drawn as updating: being read again, or built for an earlier key.
    public func updating(_ name: String, for key: AppModel.StoreKey?) -> Bool {
        guard key != nil else { return loading.contains(name) }
        return loading.contains(name) || !isCurrent(name, for: key)
    }

    private func head(_ name: String) -> (importStamp: String?, reportStamp: String, orgId: Int)? {
        if name.hasPrefix("usVsThem:") { return usVsThem[name].map { ($0.importStamp, $0.reportStamp, $0.orgId) } }
        switch name {
        case "standings": return standings.map { ($0.importStamp, $0.reportStamp, $0.orgId) }
        case "leaders": return leaders.map { ($0.importStamp, $0.reportStamp, $0.orgId) }
        case "orgComparison": return orgComparison.map { ($0.importStamp, $0.reportStamp, $0.orgId) }
        case "franchise": return franchise.map { ($0.importStamp, $0.reportStamp, $0.orgId) }
        default: return nil
        }
    }

    // MARK: Reading

    public func loadStandings(client: Client?, key: AppModel.StoreKey?) async {
        let org = key.map(FrontOfficeStore.org) ?? "automatic"
        await read("standings", client: client, key: key, operation: "getLeagueStandings") { client in
            switch try await client.getLeagueStandings(path: .init(org: org)) {
            case .ok(let answer): return .success(try answer.body.json)
            case .notFound(let refused): return .failure(.served(try refused.body.json.error))
            case .undocumented(let code, let payload):
                return .failure(await .undocumented(code, body: payload.body, operation: "getLeagueStandings", fromV2: true))
            }
        } keep: { self.standings = $0 }
    }

    public func loadLeaders(client: Client?, key: AppModel.StoreKey?) async {
        let org = key.map(FrontOfficeStore.org) ?? "automatic"
        await read("leaders", client: client, key: key, operation: "getLeagueLeaders") { client in
            switch try await client.getLeagueLeaders(path: .init(org: org)) {
            case .ok(let answer): return .success(try answer.body.json)
            case .notFound(let refused): return .failure(.served(try refused.body.json.error))
            case .undocumented(let code, let payload):
                return .failure(await .undocumented(code, body: payload.body, operation: "getLeagueLeaders", fromV2: true))
            }
        } keep: { self.leaders = $0 }
    }

    public func loadOrgComparison(client: Client?, key: AppModel.StoreKey?) async {
        let org = key.map(FrontOfficeStore.org) ?? "automatic"
        await read("orgComparison", client: client, key: key, operation: "getLeagueOrgComparison") { client in
            switch try await client.getLeagueOrgComparison(path: .init(org: org)) {
            case .ok(let answer): return .success(try answer.body.json)
            case .notFound(let refused): return .failure(.served(try refused.body.json.error))
            case .undocumented(let code, let payload):
                return .failure(await .undocumented(code, body: payload.body, operation: "getLeagueOrgComparison", fromV2: true))
            }
        } keep: { self.orgComparison = $0 }
    }

    public func loadFranchise(client: Client?, key: AppModel.StoreKey?) async {
        let org = key.map(FrontOfficeStore.org) ?? "automatic"
        await read("franchise", client: client, key: key, operation: "getLeagueFranchiseHistory") { client in
            switch try await client.getLeagueFranchiseHistory(path: .init(org: org)) {
            case .ok(let answer): return .success(try answer.body.json)
            case .notFound(let refused): return .failure(.served(try refused.body.json.error))
            case .undocumented(let code, let payload):
                return .failure(await .undocumented(code, body: payload.body, operation: "getLeagueFranchiseHistory", fromV2: true))
            }
        } keep: { self.franchise = $0 }
    }

    /// Us vs Them against a club (the one it opens on for none), once per key.
    public func loadUsVsThem(_ team: Int?, client: Client?, key: AppModel.StoreKey?) async {
        let org = key.map(FrontOfficeStore.org) ?? "automatic"
        let name = Self.usVsThemName(team)
        await read(name, client: client, key: key, operation: "getLeagueUsVsThem") { client in
            switch try await client.getLeagueUsVsThem(path: .init(org: org), query: .init(team: team)) {
            case .ok(let answer): return .success(try answer.body.json)
            case .notFound(let refused): return .failure(.served(try refused.body.json.error))
            case .undocumented(let code, let payload):
                return .failure(await .undocumented(code, body: payload.body, operation: "getLeagueUsVsThem", fromV2: true))
            }
        } keep: { self.usVsThem[name] = $0 }
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
            // A request called off is a non-event: no problem line, no log line
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
            // Only `RequestProblem.logLine`'s words: the operation, the status, the error's domain and code
            if let detail = problem.detail { log("could not read League Office's \(name): \(detail)") }
        }
    }

    #if DEBUG
    /// A store holding served payloads, for `#Preview`s and snapshots.
    public static func preview(
        standings: Components.Schemas.LeagueStandingsView? = nil,
        leaders: Components.Schemas.LeagueLeadersView? = nil,
        orgComparison: Components.Schemas.LeagueOrgComparisonView? = nil,
        franchise: Components.Schemas.LeagueFranchiseView? = nil,
        usVsThem: Components.Schemas.LeagueUsVsThemView? = nil
    ) -> LeagueOfficeStore {
        let store = LeagueOfficeStore()
        store.standings = standings
        store.leaders = leaders
        store.orgComparison = orgComparison
        store.franchise = franchise
        if let usVsThem { store.usVsThem[usVsThemName(nil)] = usVsThem }
        return store
    }

    /// Takes a preview model's key as the one its payloads were read for.
    public func previewAdopt(_ key: AppModel.StoreKey?) {
        guard let key else { return }
        followedKey = key
        for name in ["standings", "leaders", "orgComparison", "franchise"] + Array(usVsThem.keys) where head(name) != nil { loadedKeys[name] = key }
    }
    #endif
}
