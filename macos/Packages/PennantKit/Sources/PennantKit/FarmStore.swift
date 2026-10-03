import Foundation
import Observation
import OpenAPIRuntime
import PennantAPI

/// Farm & Development's views (N10; SWIFTUI_REBUILD.md section 3.5): Organization, Affiliates, Assignments, Prospects
/// and Development tracking (`GET /api/v2/views/:org/farm/…`), each player's Decision and scouting history. Every word,
/// order and sort key is the server's; the store keeps the last good payload of each while a newer one is asked, reads
/// each once per store key, and drops an answer to an older question.
///
/// Opening any of the farm's views reads the five lists together (`loadAll`), so moving between them is a read from
/// memory: the server builds them together after each import, so asking once costs no more than asking for one.
@Observable @MainActor
public final class FarmStore {
    /// The farm's list views, by the id the registry uses.
    public enum ListView: String, CaseIterable, Sendable {
        case organization, affiliates, assignments, prospects, development
    }

    public private(set) var organization: Components.Schemas.FarmOrganizationView?
    public private(set) var affiliates: Components.Schemas.FarmAffiliatesView?
    public private(set) var assignments: Components.Schemas.FarmAssignmentsView?
    public private(set) var prospects: Components.Schemas.FarmProspectsView?
    public private(set) var development: Components.Schemas.FarmDevelopmentView?
    /// Each player's Decision and scouting history as last served, by player id.
    public private(set) var decisions: [Int: Components.Schemas.FarmDecisionView] = [:]
    public private(set) var details: [Int: Components.Schemas.FarmDevelopmentDetail] = [:]
    /// Why a read failed, by what was asked (`organization`, `decision:412`); absent when it did not.
    public private(set) var problems: [String: RequestProblem] = [:]
    /// What is being read now, by the same names.
    public private(set) var loading: Set<String> = []

    /// The key each payload was read for, and last asked for.
    private var loadedKeys: [String: AppModel.StoreKey] = [:]
    private var askedKeys: [String: AppModel.StoreKey] = [:]
    private let log: @MainActor (String) -> Void

    public init(log: @escaping @MainActor (String) -> Void = { _ in }) {
        self.log = log
    }

    /// Whether what is shown under `name` was read for this key (else it is shown as updating).
    public func isCurrent(_ name: String, for key: AppModel.StoreKey?) -> Bool {
        guard let key else { return false }
        return loadedKeys[name] == key
    }

    /// Whether what is shown under `name` was read for an earlier key and a newer one is asked (drawn as updating); never
    /// while no key is known (a preview, before the server is ready).
    public func isStale(_ name: String, for key: AppModel.StoreKey?) -> Bool {
        guard let key else { return false }
        return loadedKeys[name] != key
    }

    /// Reads the five list views for the key, together, each once per key.
    public func loadAll(client: Client?, key: AppModel.StoreKey?) async {
        await withTaskGroup(of: Void.self) { group in
            for view in ListView.allCases {
                group.addTask { await self.load(view, client: client, key: key) }
            }
        }
    }

    /// Reads one list view for the key, once per key; the last good one stays while it is read again.
    public func load(_ view: ListView, client: Client?, key: AppModel.StoreKey?) async {
        let org = key.map(FrontOfficeStore.org) ?? "automatic"
        switch view {
        case .organization:
            await read(view.rawValue, client: client, key: key, operation: "getFarmOrganization") { client in
                switch try await client.getFarmOrganization(path: .init(org: org)) {
                case .ok(let answer): return .success(try answer.body.json)
                case .notFound(let refused): return .failure(.served(try refused.body.json.error))
                case .undocumented(let code, let payload):
                    return .failure(await .undocumented(code, body: payload.body, operation: "getFarmOrganization", fromV2: true))
                }
            } keep: { self.organization = $0 }
        case .affiliates:
            await read(view.rawValue, client: client, key: key, operation: "getFarmAffiliates") { client in
                switch try await client.getFarmAffiliates(path: .init(org: org)) {
                case .ok(let answer): return .success(try answer.body.json)
                case .notFound(let refused): return .failure(.served(try refused.body.json.error))
                case .undocumented(let code, let payload):
                    return .failure(await .undocumented(code, body: payload.body, operation: "getFarmAffiliates", fromV2: true))
                }
            } keep: { self.affiliates = $0 }
        case .assignments:
            await read(view.rawValue, client: client, key: key, operation: "getFarmAssignments") { client in
                switch try await client.getFarmAssignments(path: .init(org: org)) {
                case .ok(let answer): return .success(try answer.body.json)
                case .notFound(let refused): return .failure(.served(try refused.body.json.error))
                case .undocumented(let code, let payload):
                    return .failure(await .undocumented(code, body: payload.body, operation: "getFarmAssignments", fromV2: true))
                }
            } keep: { self.assignments = $0 }
        case .prospects:
            await read(view.rawValue, client: client, key: key, operation: "getFarmProspects") { client in
                switch try await client.getFarmProspects(path: .init(org: org)) {
                case .ok(let answer): return .success(try answer.body.json)
                case .notFound(let refused): return .failure(.served(try refused.body.json.error))
                case .undocumented(let code, let payload):
                    return .failure(await .undocumented(code, body: payload.body, operation: "getFarmProspects", fromV2: true))
                }
            } keep: { self.prospects = $0 }
        case .development:
            await read(view.rawValue, client: client, key: key, operation: "getFarmDevelopment") { client in
                switch try await client.getFarmDevelopment(path: .init(org: org)) {
                case .ok(let answer): return .success(try answer.body.json)
                case .notFound(let refused): return .failure(.served(try refused.body.json.error))
                case .undocumented(let code, let payload):
                    return .failure(await .undocumented(code, body: payload.body, operation: "getFarmDevelopment", fromV2: true))
                }
            } keep: { self.development = $0 }
        }
    }

    /// One player's Decision for the key, once per key (worked out ahead on the server for the desk's players and every
    /// assignment in question, else on this request).
    public func loadDecision(_ playerId: Int, client: Client?, key: AppModel.StoreKey?) async {
        let org = key.map(FrontOfficeStore.org) ?? "automatic"
        await read("decision:\(playerId)", client: client, key: key, operation: "getFarmDecision") { client in
            switch try await client.getFarmDecision(path: .init(org: org), query: .init(player: String(playerId))) {
            case .ok(let answer): return .success(try answer.body.json)
            case .notFound(let refused): return .failure(.served(try refused.body.json.error))
            case .undocumented(let code, let payload):
                return .failure(await .undocumented(code, body: payload.body, operation: "getFarmDecision", fromV2: true))
            }
        } keep: { self.decisions[playerId] = $0 }
    }

    /// One player's scouting history in this save, for the key.
    public func loadDetail(_ playerId: Int, client: Client?, key: AppModel.StoreKey?) async {
        let org = key.map(FrontOfficeStore.org) ?? "automatic"
        await read("detail:\(playerId)", client: client, key: key, operation: "getFarmDevelopmentDetail") { client in
            switch try await client.getFarmDevelopmentDetail(path: .init(org: org, playerId: String(playerId))) {
            case .ok(let answer): return .success(try answer.body.json)
            case .notFound(let refused): return .failure(.served(try refused.body.json.error))
            case .undocumented(let code, let payload):
                return .failure(await .undocumented(code, body: payload.body, operation: "getFarmDevelopmentDetail", fromV2: true))
            }
        } keep: { self.details[playerId] = $0 }
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
        if loadedKeys[name] == key { return }
        if askedKeys[name] == key, loading.contains(name) { return }
        askedKeys[name] = key
        loading.insert(name)
        defer { if askedKeys[name] == key { loading.remove(name) } }
        let answer: Result<Payload, RequestProblem>
        do {
            answer = try await ask(client)
        } catch {
            answer = .failure(.from(error))
        }
        guard askedKeys[name] == key, !Task.isCancelled else { return }
        switch answer {
        case .success(let payload):
            keep(payload)
            loadedKeys[name] = key
            problems[name] = nil
        case .failure(let problem):
            problems[name] = problem
            if let detail = problem.detail { log("could not read the farm's \(name): \(detail)") }
        }
    }

    #if DEBUG
    /// A store holding served payloads, for `#Preview`s and snapshots (current for `key` when one is given).
    public static func preview(
        organization: Components.Schemas.FarmOrganizationView? = nil,
        affiliates: Components.Schemas.FarmAffiliatesView? = nil,
        assignments: Components.Schemas.FarmAssignmentsView? = nil,
        prospects: Components.Schemas.FarmProspectsView? = nil,
        development: Components.Schemas.FarmDevelopmentView? = nil,
        decisions: [Components.Schemas.FarmDecisionView] = [],
        details: [Components.Schemas.FarmDevelopmentDetail] = [],
        key: AppModel.StoreKey? = nil
    ) -> FarmStore {
        let store = FarmStore()
        store.organization = organization
        store.affiliates = affiliates
        store.assignments = assignments
        store.prospects = prospects
        store.development = development
        for d in decisions { store.decisions[d.playerId] = d }
        for d in details { store.details[d.playerId] = d }
        if let key {
            for view in ListView.allCases { store.loadedKeys[view.rawValue] = key }
            for d in decisions { store.loadedKeys["decision:\(d.playerId)"] = key }
            for d in details { store.loadedKeys["detail:\(d.playerId)"] = key }
        }
        return store
    }
    #endif
}

extension AppModel {
    /// The farm's five list views for the current key (a farm view calls it in `.task(id: storeKey)`).
    public func loadFarm() async {
        await farm.loadAll(client: client, key: storeKey)
    }

    /// A player's Decision for the current key.
    public func loadFarmDecision(_ playerId: Int) async {
        await farm.loadDecision(playerId, client: client, key: storeKey)
    }

    /// A player's scouting history for the current key.
    public func loadFarmDetail(_ playerId: Int) async {
        await farm.loadDetail(playerId, client: client, key: storeKey)
    }
}
