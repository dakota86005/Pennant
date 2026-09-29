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
    /// through the same two served requests. The inverse is registered while the undo manager runs the step, as it asks.
    func registerDeskUndo(undo: Components.Schemas.DeskUpdate, redo: Components.Schemas.DeskUpdate, undoManager: UndoManager?, actionName: String) {
        guard let undoManager else { return }
        undoManager.registerUndo(withTarget: self) { model in
            MainActor.assumeIsolated {
                model.registerDeskUndo(undo: redo, redo: undo, undoManager: undoManager, actionName: actionName)
                Task { await model.sendDesk(undo) }
            }
        }
        undoManager.setActionName(actionName)
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

    func registerFollowUndo(undo: FollowingStore.Request, redo: FollowingStore.Request, undoManager: UndoManager?, actionName: String) {
        guard let undoManager else { return }
        undoManager.registerUndo(withTarget: self) { model in
            MainActor.assumeIsolated {
                model.registerFollowUndo(undo: redo, redo: undo, undoManager: undoManager, actionName: actionName)
                Task { await model.sendFollow(undo) }
            }
        }
        undoManager.setActionName(actionName)
    }
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
