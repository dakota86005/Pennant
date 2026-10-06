import Foundation
import Observation
import OpenAPIRuntime
import PennantAPI

/// Philosophy & Staff (N12 Track C; SWIFTUI_REBUILD.md section 9; D-073): the Organizational Philosophy editor
/// (`/api/v2/views/:org/philosophy/organizationalPhilosophy`, read, changed and reset through the server, which checks a
/// change whole and answers with what it did and the request that undoes it) and Coaching Staff (`…/coachingStaff`).
/// The store sends exactly what the GM set and draws what is served: no identity, label or position words of its own.
@Observable @MainActor
public final class PhilosophyStore {
    public private(set) var philosophy: Components.Schemas.PhilosophyView?
    public private(set) var staff: Components.Schemas.CoachingStaffView?
    /// What the last change did, in the server's words ("Competitive window set to 70: …"); nil before one.
    public private(set) var lastSaid: Components.Schemas.Cell?
    /// Why the last change was refused or failed (the server's sentence); nil when it went through.
    public private(set) var changeProblem: RequestProblem?
    /// A change is being written.
    public private(set) var writing = false
    /// Why a read failed (`philosophy`, `staff`); absent when it did not.
    public private(set) var problems: [String: RequestProblem] = [:]
    public private(set) var loading: Set<String> = []

    private var loadedKeys: [String: AppModel.StoreKey] = [:]
    private var askedKeys: [String: AppModel.StoreKey] = [:]
    private var followedKey: AppModel.StoreKey?
    private let log: @MainActor (String) -> Void

    public init(log: @escaping @MainActor (String) -> Void = { _ in }) {
        self.log = log
    }

    /// Whether what is shown under `name` is being read again, or was read for an earlier key.
    public func updating(_ name: String, for key: AppModel.StoreKey?) -> Bool {
        loading.contains(name) || (key != nil && loadedKeys[name] != key)
    }

    /// Follows the app's key: on another save or club everything is dropped at once (another club's settings are never
    /// drawn, not even as updating).
    public func follow(_ key: AppModel.StoreKey?) {
        guard let key else { return }
        defer { followedKey = key }
        guard let last = followedKey, last.saveId != key.saveId || last.club != key.club else { return }
        philosophy = nil
        staff = nil
        lastSaid = nil
        changeProblem = nil
        problems = [:]
        loadedKeys = [:]
    }

    // MARK: Reading

    public func loadPhilosophy(client: Client?, key: AppModel.StoreKey?) async {
        guard let client, let key, begin("philosophy", key) else { return }
        defer { end("philosophy", key) }
        do {
            switch try await client.getOrganizationalPhilosophy(path: .init(org: FrontOfficeStore.org(key))) {
            case .ok(let answer):
                let view = try answer.body.json
                guard askedKeys["philosophy"] == key else { return }
                philosophy = view
                loaded("philosophy", key)
            case .notFound(let refused):
                fail("philosophy", key, .served(try refused.body.json.error))
            case .undocumented(let code, let payload):
                fail("philosophy", key, await .undocumented(code, body: payload.body, operation: "getOrganizationalPhilosophy", fromV2: true))
            }
        } catch {
            caught("philosophy", key, error)
        }
    }

    public func loadStaff(client: Client?, key: AppModel.StoreKey?) async {
        guard let client, let key, begin("staff", key) else { return }
        defer { end("staff", key) }
        do {
            switch try await client.getCoachingStaff(path: .init(org: FrontOfficeStore.org(key))) {
            case .ok(let answer):
                let view = try answer.body.json
                guard askedKeys["staff"] == key else { return }
                staff = view
                loaded("staff", key)
            case .notFound(let refused):
                fail("staff", key, .served(try refused.body.json.error))
            case .undocumented(let code, let payload):
                fail("staff", key, await .undocumented(code, body: payload.body, operation: "getCoachingStaff", fromV2: true))
            }
        } catch {
            caught("staff", key, error)
        }
    }

    private func begin(_ name: String, _ key: AppModel.StoreKey) -> Bool {
        follow(key)
        if loadedKeys[name] == key { return false }
        if askedKeys[name] == key, loading.contains(name) { return false }
        askedKeys[name] = key
        loading.insert(name)
        return true
    }

    private func end(_ name: String, _ key: AppModel.StoreKey) {
        if askedKeys[name] == key { loading.remove(name) }
    }

    private func loaded(_ name: String, _ key: AppModel.StoreKey) {
        loadedKeys[name] = key
        problems[name] = nil
    }

    private func fail(_ name: String, _ key: AppModel.StoreKey, _ problem: RequestProblem) {
        guard askedKeys[name] == key else { return }
        problems[name] = problem
    }

    private func caught(_ name: String, _ key: AppModel.StoreKey, _ error: any Error) {
        guard !RequestProblem.isCancellation(error), askedKeys[name] == key else { return }
        let problem = RequestProblem.from(error)
        problems[name] = problem
        if let detail = problem.detail { log("could not read \(name): \(detail)") }
    }

    // MARK: Changing

    /// Sends a change (or an undo's request) as the GM set it; answers with what the server did, or nil (the problem kept).
    public func change(_ update: Components.Schemas.PhilosophyUpdate, client: Client?, key: AppModel.StoreKey?) async -> Components.Schemas.PhilosophyChange? {
        guard let client, let key else { return nil }
        writing = true
        defer { writing = false }
        do {
            switch try await client.setOrganizationalPhilosophy(path: .init(org: FrontOfficeStore.org(key)), body: .json(update)) {
            case .ok(let answer):
                return took(try answer.body.json, key)
            case .badRequest(let refused):
                changeProblem = .served(try refused.body.json.error)
            case .notFound(let refused):
                changeProblem = .served(try refused.body.json.error)
            case .undocumented(let code, let payload):
                changeProblem = await .undocumented(code, body: payload.body, operation: "setOrganizationalPhilosophy", fromV2: true)
            }
        } catch {
            noteChangeFailure(error)
        }
        return nil
    }

    /// Puts every setting back to neutral; answers with what the server did (its undo puts each back), or nil.
    public func reset(client: Client?, key: AppModel.StoreKey?) async -> Components.Schemas.PhilosophyChange? {
        guard let client, let key else { return nil }
        writing = true
        defer { writing = false }
        do {
            switch try await client.resetOrganizationalPhilosophy(path: .init(org: FrontOfficeStore.org(key))) {
            case .ok(let answer):
                return took(try answer.body.json, key)
            case .notFound(let refused):
                changeProblem = .served(try refused.body.json.error)
            case .undocumented(let code, let payload):
                changeProblem = await .undocumented(code, body: payload.body, operation: "resetOrganizationalPhilosophy", fromV2: true)
            }
        } catch {
            noteChangeFailure(error)
        }
        return nil
    }

    private func took(_ change: Components.Schemas.PhilosophyChange, _ key: AppModel.StoreKey) -> Components.Schemas.PhilosophyChange {
        philosophy = change.view
        lastSaid = change.said
        changeProblem = nil
        // The settings moved the server's build: the next key reads the editor again, and this one is current until then
        loadedKeys["philosophy"] = key
        return change
    }

    private func noteChangeFailure(_ error: any Error) {
        guard !RequestProblem.isCancellation(error) else { return }
        let problem = RequestProblem.from(error)
        changeProblem = problem
        if let detail = problem.detail { log("could not change the philosophy: \(detail)") }
    }

    #if DEBUG
    /// A store holding served payloads, for `#Preview`s and snapshots (current for `key` when one is given).
    public static func preview(
        philosophy: Components.Schemas.PhilosophyView? = nil,
        staff: Components.Schemas.CoachingStaffView? = nil,
        lastSaid: Components.Schemas.Cell? = nil,
        key: AppModel.StoreKey? = nil
    ) -> PhilosophyStore {
        let store = PhilosophyStore()
        store.philosophy = philosophy
        store.staff = staff
        store.lastSaid = lastSaid
        if let key {
            store.loadedKeys["philosophy"] = key
            store.loadedKeys["staff"] = key
        }
        return store
    }
    #endif
}

/// A philosophy change as the undo manager replays it: a set of settings, or the reset to neutral.
enum PhilosophyAction: Sendable {
    case update(Components.Schemas.PhilosophyUpdate)
    case reset
}

extension AppModel {
    public func loadPhilosophy() async {
        await philosophy.loadPhilosophy(client: client, key: storeKey)
    }

    public func loadCoachingStaff() async {
        await philosophy.loadStaff(client: client, key: storeKey)
    }

    /// Sends a change to the philosophy and puts its served undo on the window's undo manager (⌘Z), named as served.
    public func changePhilosophy(_ update: Components.Schemas.PhilosophyUpdate, undoManager: UndoManager?) async {
        guard let change = await philosophy.change(update, client: client, key: storeKey) else { return }
        registerPhilosophyUndo(.update(change.undo), redo: .update(update), name: change.undoName.display, undoManager: undoManager)
    }

    /// Resets the philosophy to neutral, with its served undo on the window's undo manager.
    public func resetPhilosophy(undoManager: UndoManager?) async {
        guard let change = await philosophy.reset(client: client, key: storeKey) else { return }
        registerPhilosophyUndo(.update(change.undo), redo: .reset, name: change.undoName.display, undoManager: undoManager)
    }

    /// Registers `undo`; when it runs, `redo` is registered at once (the manager is undoing, so it lands on the redo stack),
    /// then the server is asked. Redoing registers the undo again the same way.
    private func registerPhilosophyUndo(_ undo: PhilosophyAction, redo: PhilosophyAction, name: String, undoManager: UndoManager?) {
        guard let undoManager else { return }
        let step = UndoStep()
        undoManager.registerUndo(withTarget: step) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                self.registerPhilosophyUndo(redo, redo: undo, name: name, undoManager: undoManager)
                Task { @MainActor in
                    switch undo {
                    case .update(let update): _ = await self.philosophy.change(update, client: self.client, key: self.storeKey)
                    case .reset: _ = await self.philosophy.reset(client: self.client, key: self.storeKey)
                    }
                }
            }
        }
        undoManager.setActionName(name)
        // Dropped with the desk's and Following's steps when the save or the club changes (`settleUndoScope`)
        undoSteps.removeAll { $0.manager == nil }
        undoSteps.append(UndoRegistration(manager: undoManager, step: step))
    }
}
