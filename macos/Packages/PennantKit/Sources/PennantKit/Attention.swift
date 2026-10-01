import Foundation
import PennantAPI

/// The GM's attention from the Mac app (N7, Stage B; D-058): desk statuses and follows, each through the server, each
/// undone with the request the server served (`DeskChange.undo`, `FollowChange.undo`) on the window's `UndoManager`, so
/// ⌘Z and ⇧⌘Z step through them. The app works out no status, date or follow of its own.
extension AppModel {
    // MARK: Reading

    /// Following for the current key (a view calls it in `.task(id: storeKey)`).
    public func loadFollowing() async {
        await following.load(client: client, key: storeKey)
    }

    /// The full wire for the query and the current key.
    public func loadWire(_ query: LeagueStore.WireQuery) async {
        await league.loadWire(query, client: client, key: storeKey, stamp: frontOffice.summary?.deskStamp ?? "")
    }

    /// A club's report for the current key.
    public func loadClub(_ id: Int) async {
        await league.loadClub(id, client: client, key: storeKey)
    }

    /// What matches a query, as served; nil when the question was cancelled.
    public func search(_ query: String) async -> Result<Components.Schemas.SearchAnswer, RequestProblem>? {
        await league.search(query, client: client)
    }

    /// How many items to decide are open on the desk, as served (the dock's badge); nil with no desk shown.
    public var openDeskCount: Int? { frontOffice.summary?.desk.openCount }

    // MARK: The desk

    /// Changes an item's status and registers its undo (the served request) on the window's undo manager under the
    /// action's name. Returns the server's answer, or nil when it was refused (the store says why, in the server's words).
    @discardableResult
    public func changeDesk(_ update: Components.Schemas.DeskUpdate, undoManager: UndoManager?, actionName: String) async -> Components.Schemas.DeskChange? {
        guard let change = await sendDesk(update) else { return nil }
        registerDeskUndo(undo: change.undo, redo: update, undoManager: undoManager, actionName: actionName)
        return change
    }

    private func sendDesk(_ update: Components.Schemas.DeskUpdate) async -> Components.Schemas.DeskChange? {
        let change = await frontOffice.setDeskStatus(update, client: client, key: storeKey)
        if change != nil { await frontOffice.keep(catalog: keptCatalogNow, for: storeKey) }
        return change
    }

    /// Registers one step: undoing sends `undo` and registers its own undo (the redo, `redo`), so Undo and Redo alternate
    /// through the same two served requests. The inverse is registered while the undo manager runs the step, as it asks,
    /// and taken off again when the request fails (L1): a refused undo leaves no redo behind it.
    @discardableResult
    func registerDeskUndo(undo: Components.Schemas.DeskUpdate, redo: Components.Schemas.DeskUpdate, undoManager: UndoManager?, actionName: String) -> UndoStep? {
        registerStep(undoManager: undoManager, actionName: actionName) { model, undoManager in
            let inverse = model.registerDeskUndo(undo: redo, redo: undo, undoManager: undoManager, actionName: actionName)
            return { await model.sendDesk(undo) != nil ? nil : inverse }
        }
    }

    /// Registers a step on `undoManager` under its own target (`UndoStep`), so it can be taken off alone (its request
    /// failed) or with every other step (the save or the club changed, M7). `run` registers the inverse and returns the
    /// request to send, which answers the inverse to take off when it failed.
    private func registerStep(
        undoManager: UndoManager?, actionName: String,
        run: @escaping @MainActor (AppModel, UndoManager) -> () async -> UndoStep?
    ) -> UndoStep? {
        guard let undoManager else { return nil }
        let step = UndoStep()
        undoManager.registerUndo(withTarget: step) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                let send = run(self, undoManager)
                Task { @MainActor in
                    if let failed = await send() { self.dropUndoStep(failed, from: undoManager) }
                }
            }
        }
        undoManager.setActionName(actionName)
        undoSteps.removeAll { $0.manager == nil }
        undoSteps.append(UndoRegistration(manager: undoManager, step: step))
        return step
    }

    /// Takes one step off its undo manager (its request was refused or failed).
    func dropUndoStep(_ step: UndoStep, from undoManager: UndoManager) {
        undoManager.removeAllActions(withTarget: step)
        undoSteps.removeAll { $0.step === step }
    }

    /// Takes every desk and follow step off the windows' undo managers: they belong to the save and the club they were
    /// made for, and undoing one under another would send it to the wrong desk (M7).
    func dropAllUndoSteps() {
        for registration in undoSteps { registration.manager?.removeAllActions(withTarget: registration.step) }
        undoSteps.removeAll()
    }

    /// Called whenever the status or the club is put in place: when the save or the club moved, the steps go (M7).
    func settleUndoScope() {
        let scope = UndoScope(saveId: status?.saveId, club: club?.ref.id)
        defer { undoScope = scope }
        guard let undoScope, undoScope != scope else { return }
        dropAllUndoSteps()
    }

    // MARK: Following

    /// Follows or unfollows and registers its undo (the served request) on the window's undo manager. Returns the answer,
    /// or nil when it was refused (`following.refusal` says why).
    @discardableResult
    public func changeFollow(_ request: FollowingStore.Request, undoManager: UndoManager?, actionName: String) async -> Components.Schemas.FollowChange? {
        guard let change = await sendFollow(request) else { return nil }
        registerFollowUndo(undo: FollowingStore.Request(served: change.undo), redo: request, undoManager: undoManager, actionName: actionName)
        return change
    }

    private func sendFollow(_ request: FollowingStore.Request) async -> Components.Schemas.FollowChange? {
        let change = await following.send(request, client: client)
        // Following orders the wire and the search (never a figure): the summary is composed again on the same build
        if change != nil { await frontOffice.refreshQuietly(client: client, key: storeKey) }
        return change
    }

    @discardableResult
    func registerFollowUndo(undo: FollowingStore.Request, redo: FollowingStore.Request, undoManager: UndoManager?, actionName: String) -> UndoStep? {
        registerStep(undoManager: undoManager, actionName: actionName) { model, undoManager in
            let inverse = model.registerFollowUndo(undo: redo, redo: undo, undoManager: undoManager, actionName: actionName)
            return { await model.sendFollow(undo) != nil ? nil : inverse }
        }
    }
}

/// One step's target on an undo manager (a desk status, a follow), so it can be taken off alone.
public final class UndoStep {}

/// A step and the undo manager it is on (held weakly: a closed window's manager goes with it).
struct UndoRegistration {
    weak var manager: UndoManager?
    let step: UndoStep
}

/// What the steps were made for: the chosen save and the club.
struct UndoScope: Equatable {
    var saveId: String?
    var club: Int?
}

/// The app's own preferences for what it says outside its windows (Settings ▸ General): a notification when a new
/// export is read, and the desk's count on the Dock icon. Kept in the app's own defaults, never the data folder.
public enum AppPreferences {
    public static let notifiesNewExportKey = "PennantNotifiesNewExport"
    public static let showsDockBadgeKey = "PennantShowsDockBadge"

    /// Both are on until the GM turns one off.
    public static func notifiesNewExport(_ defaults: UserDefaults = .standard) -> Bool {
        defaults.object(forKey: notifiesNewExportKey) as? Bool ?? true
    }

    public static func showsDockBadge(_ defaults: UserDefaults = .standard) -> Bool {
        defaults.object(forKey: showsDockBadgeKey) as? Bool ?? true
    }
}
