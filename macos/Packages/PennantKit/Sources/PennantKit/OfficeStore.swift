import Foundation
import Observation
import OpenAPIRuntime
import PennantAPI

/// Finance's and Medical's views (N12; SWIFTUI_REBUILD.md section 9; D-071): Payroll & Budget, Contracts, Free Agents,
/// the Horizon Board and the Injury Report (`GET /api/v2/views/:org/{finance,medical}/…`), built by the server after every
/// import, and the one thing the GM sets there: the budget he expects next season. Every word, order, tone and sort key is
/// the server's; the store reads each view once per store key, keeps the last good payload while a newer one is asked,
/// drops an answer to an older question, and drops everything at once on another save or club.
///
/// Opening any of these views reads the five together (`loadAll`): the server builds them together after each import, so
/// asking once costs no more than asking for one, and moving between them is a read from memory.
@Observable @MainActor
public final class OfficeStore {
    /// The views, by the id the registry uses.
    public enum View: String, CaseIterable, Sendable {
        case payrollBudget, contracts, freeAgents, horizonBoard, injuryReport
    }

    public private(set) var payroll: Components.Schemas.FinancePayrollView?
    public private(set) var contracts: Components.Schemas.FinanceContractsView?
    public private(set) var freeAgents: Components.Schemas.FinanceFreeAgentsView?
    public private(set) var horizon: Components.Schemas.FinanceHorizonView?
    public private(set) var injuries: Components.Schemas.MedicalInjuryReportView?
    /// Why a read failed, by view (`contracts`); absent when it did not.
    public private(set) var problems: [String: RequestProblem] = [:]
    /// What is being read now, by the same names.
    public private(set) var loading: Set<String> = []
    /// Why the budget the GM entered was refused, or couldn't be sent; nil when it wasn't.
    public private(set) var budgetProblem: RequestProblem?
    /// A budget being sent.
    public private(set) var savingBudget = false
    /// What the last budget change did, in the server's words ("Next season's budget set to $210M; was $200M").
    public private(set) var budgetDone: Components.Schemas.Cell?

    private var loadedKeys: [String: AppModel.StoreKey] = [:]
    private var askedKeys: [String: AppModel.StoreKey] = [:]
    private var followedKey: AppModel.StoreKey?
    /// Each read's turn, so an answer to an older read (a read again after the budget changed) is never kept.
    private var turns: [String: Int] = [:]
    private let log: @MainActor (String) -> Void

    public init(log: @escaping @MainActor (String) -> Void = { _ in }) {
        self.log = log
    }

    /// Follows the app's key: on another save or club, everything held is dropped at once, so another club's view is
    /// never drawn, not even as updating. A new import of the same club keeps what is shown, drawn as updating.
    public func follow(_ key: AppModel.StoreKey?) {
        guard let key else { return }
        defer { followedKey = key }
        guard let last = followedKey, last.saveId != key.saveId || last.club != key.club else { return }
        payroll = nil
        contracts = nil
        freeAgents = nil
        horizon = nil
        injuries = nil
        problems = [:]
        loadedKeys = [:]
        budgetProblem = nil
        budgetDone = nil
    }

    /// Whether a view is drawn as updating: it is being read again, or what is shown was read for an earlier key.
    public func updating(_ view: View, for key: AppModel.StoreKey?) -> Bool {
        guard let key else { return loading.contains(view.rawValue) }
        return loading.contains(view.rawValue) || loadedKeys[view.rawValue] != key
    }

    /// Reads the five views for the key, together, each once per key.
    public func loadAll(client: Client?, key: AppModel.StoreKey?) async {
        // Five reads side by side, each named (no async closure kept or called in a loop: PR #57)
        async let payroll: Void = load(.payrollBudget, client: client, key: key)
        async let contracts: Void = load(.contracts, client: client, key: key)
        async let freeAgents: Void = load(.freeAgents, client: client, key: key)
        async let horizon: Void = load(.horizonBoard, client: client, key: key)
        async let injuries: Void = load(.injuryReport, client: client, key: key)
        _ = await (payroll, contracts, freeAgents, horizon, injuries)
    }

    /// Reads one view for the key, once per key (`force` reads it again: the budget changed).
    public func load(_ view: View, client: Client?, key: AppModel.StoreKey?, force: Bool = false) async {
        let org = key.map(FrontOfficeStore.org) ?? "automatic"
        switch view {
        case .payrollBudget:
            await read(view, client: client, key: key, force: force) { client in
                switch try await client.getFinancePayroll(path: .init(org: org)) {
                case .ok(let answer): return .success(try answer.body.json)
                case .notFound(let refused): return .failure(.served(try refused.body.json.error))
                case .undocumented(let code, let payload):
                    return .failure(await .undocumented(code, body: payload.body, operation: "getFinancePayroll", fromV2: true))
                }
            } keep: { self.payroll = $0 }
        case .contracts:
            await read(view, client: client, key: key, force: force) { client in
                switch try await client.getFinanceContracts(path: .init(org: org)) {
                case .ok(let answer): return .success(try answer.body.json)
                case .notFound(let refused): return .failure(.served(try refused.body.json.error))
                case .undocumented(let code, let payload):
                    return .failure(await .undocumented(code, body: payload.body, operation: "getFinanceContracts", fromV2: true))
                }
            } keep: { self.contracts = $0 }
        case .freeAgents:
            await read(view, client: client, key: key, force: force) { client in
                switch try await client.getFinanceFreeAgents(path: .init(org: org)) {
                case .ok(let answer): return .success(try answer.body.json)
                case .notFound(let refused): return .failure(.served(try refused.body.json.error))
                case .undocumented(let code, let payload):
                    return .failure(await .undocumented(code, body: payload.body, operation: "getFinanceFreeAgents", fromV2: true))
                }
            } keep: { self.freeAgents = $0 }
        case .horizonBoard:
            await read(view, client: client, key: key, force: force) { client in
                switch try await client.getFinanceHorizon(path: .init(org: org)) {
                case .ok(let answer): return .success(try answer.body.json)
                case .notFound(let refused): return .failure(.served(try refused.body.json.error))
                case .undocumented(let code, let payload):
                    return .failure(await .undocumented(code, body: payload.body, operation: "getFinanceHorizon", fromV2: true))
                }
            } keep: { self.horizon = $0 }
        case .injuryReport:
            await read(view, client: client, key: key, force: force) { client in
                switch try await client.getMedicalInjuryReport(path: .init(org: org)) {
                case .ok(let answer): return .success(try answer.body.json)
                case .notFound(let refused): return .failure(.served(try refused.body.json.error))
                case .undocumented(let code, let payload):
                    return .failure(await .undocumented(code, body: payload.body, operation: "getMedicalInjuryReport", fromV2: true))
                }
            } keep: { self.injuries = $0 }
        }
    }

    /// Sets the budget the GM expects next season (in dollars; nil or zero clears it), then reads Payroll and the
    /// Horizon Board again, which read against it. Answers what it did and the request that puts it back, or nil when it
    /// was refused or couldn't be sent (`budgetProblem` says why). A Pennant setting: nothing is written to OOTP.
    @discardableResult
    public func setBudget(_ amount: Double?, client: Client?, key: AppModel.StoreKey?) async -> Components.Schemas.FinanceBudgetChange? {
        guard let client, let key else {
            budgetProblem = .notRunning
            return nil
        }
        savingBudget = true
        defer { savingBudget = false }
        let org = FrontOfficeStore.org(key)
        var problem: RequestProblem?
        var change: Components.Schemas.FinanceBudgetChange?
        do {
            switch try await client.setFinanceBudget(path: .init(org: org), body: .json(.init(amount: max(amount ?? 0, 0)))) {
            case .ok(let answer): change = try answer.body.json
            case .badRequest(let refused): problem = .served(try refused.body.json.error)
            case .notFound(let refused): problem = .served(try refused.body.json.error)
            case .undocumented(let code, let payload):
                problem = await .undocumented(code, body: payload.body, operation: "setFinanceBudget", fromV2: true)
            }
        } catch {
            // A request called off is a non-event; its detail is `RequestProblem.logLine`, never the error's description
            if RequestProblem.isCancellation(error) { return nil }
            problem = .from(error)
            log("could not set next season's budget: \(RequestProblem.logLine(error))")
        }
        budgetProblem = problem
        guard problem == nil, let change else { return nil }
        budgetDone = change.done
        await load(.payrollBudget, client: client, key: key, force: true)
        await load(.horizonBoard, client: client, key: key, force: true)
        return change
    }

    /// Asks once per view and key (or again when forced); keeps the answer only when it answers the last question asked.
    private func read<Payload: Sendable>(
        _ view: View,
        client: Client?,
        key: AppModel.StoreKey?,
        force: Bool,
        ask: @escaping @Sendable (Client) async throws -> Result<Payload, RequestProblem>,
        keep: (Payload) -> Void
    ) async {
        guard let client, let key else { return }
        follow(key)
        let name = view.rawValue
        if !force, loadedKeys[name] == key { return }
        if !force, askedKeys[name] == key, loading.contains(name) { return }
        askedKeys[name] = key
        let turn = (turns[name] ?? 0) + 1
        turns[name] = turn
        loading.insert(name)
        defer { if turns[name] == turn { loading.remove(name) } }
        let answer: Result<Payload, RequestProblem>
        do {
            answer = try await ask(client)
        } catch {
            // A request called off (the view's task, or the load itself) is a non-event: no problem line, no log line
            if RequestProblem.isCancellation(error) { return }
            log("could not read \(name): \(RequestProblem.logLine(error))")
            answer = .failure(.from(error))
        }
        // A newer question was asked meanwhile, or another save or club: this answer is not the key's
        guard turns[name] == turn, askedKeys[name] == key, followedKey?.saveId == key.saveId, followedKey?.club == key.club, !Task.isCancelled else { return }
        switch answer {
        case .success(let payload):
            keep(payload)
            loadedKeys[name] = key
            problems[name] = nil
        case .failure(let problem):
            problems[name] = problem
        }
    }

    #if DEBUG
    /// A store holding served payloads, for `#Preview`s and snapshots.
    public static func preview(
        payroll: Components.Schemas.FinancePayrollView? = nil,
        contracts: Components.Schemas.FinanceContractsView? = nil,
        freeAgents: Components.Schemas.FinanceFreeAgentsView? = nil,
        horizon: Components.Schemas.FinanceHorizonView? = nil,
        injuries: Components.Schemas.MedicalInjuryReportView? = nil
    ) -> OfficeStore {
        let store = OfficeStore()
        store.payroll = payroll
        store.contracts = contracts
        store.freeAgents = freeAgents
        store.horizon = horizon
        store.injuries = injuries
        return store
    }

    /// Takes a preview model's key as the one its payloads were read for.
    public func previewAdopt(_ key: AppModel.StoreKey?) {
        guard let key else { return }
        followedKey = key
        let held: [View: Bool] = [
            .payrollBudget: payroll != nil, .contracts: contracts != nil, .freeAgents: freeAgents != nil,
            .horizonBoard: horizon != nil, .injuryReport: injuries != nil,
        ]
        for (view, has) in held where has { loadedKeys[view.rawValue] = key }
    }
    #endif
}

extension AppModel {
    /// Finance's and Medical's views for the current key (a view calls it in `.task(id: storeKey)`).
    public func loadOffice() async {
        await office.loadAll(client: client, key: storeKey)
    }

    /// Sets the budget the GM expects next season (nil clears it), and registers the served request that puts back what
    /// was there on the window's undo manager (⌘Z), its redo the GM's own amount again. Answers the change, or nil when it
    /// was refused (`office.budgetProblem` says why).
    @discardableResult
    public func setNextSeasonBudget(_ amount: Double?, undoManager: UndoManager? = nil, actionName: String = "") async -> Components.Schemas.FinanceBudgetChange? {
        guard let change = await office.setBudget(amount, client: client, key: storeKey) else { return nil }
        registerBudgetUndo(undo: change.undo.amount, redo: max(amount ?? 0, 0), undoManager: undoManager, actionName: actionName)
        return change
    }

    @discardableResult
    func registerBudgetUndo(undo: Double, redo: Double, undoManager: UndoManager?, actionName: String) -> UndoStep? {
        registerStep(undoManager: undoManager, actionName: actionName) { model, undoManager in
            let inverse = model.registerBudgetUndo(undo: redo, redo: undo, undoManager: undoManager, actionName: actionName)
            return { await model.office.setBudget(undo, client: model.client, key: model.storeKey) != nil ? nil : inverse }
        }
    }
}
