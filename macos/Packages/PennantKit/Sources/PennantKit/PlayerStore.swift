import Foundation
import Observation
import OpenAPIRuntime
import PennantAPI

/// The player windows' store (N11; SWIFTUI_REBUILD.md section 9): each player's dossier (`GET /api/v2/player/:id`), the
/// GM's notes on him (`/api/v2/player/:id/notes`) and comparisons (`GET /api/v2/compare`). Every section, sentence and
/// figure is the server's; the store keeps the last good answer while a new one is asked (drawn as updating), drops an
/// answer to an older question, and never shows one player's dossier for another key (another save, club or import).
@Observable @MainActor
public final class PlayerStore {
    /// Each player's dossier as last served, with the key it was read for.
    public private(set) var dossiers: [Int: Components.Schemas.PlayerDossierView] = [:]
    public private(set) var problems: [Int: RequestProblem] = [:]
    public private(set) var loading: Set<Int> = []
    private var keys: [Int: AppModel.StoreKey] = [:]
    private var asked: [Int: AppModel.StoreKey] = [:]

    /// Each player's notes as last served.
    public private(set) var notes: [Int: Components.Schemas.PlayerNotesView] = [:]
    public private(set) var noteProblems: [Int: RequestProblem] = [:]
    /// The served words of the last note change ("Note saved for …"), shown a moment.
    public private(set) var noteDone: [Int: String] = [:]

    /// The GM's note as typed and not kept yet, by player (review H2, N11). It lives here, keyed by player, not in a
    /// window: a section switch, a closed window or a quit flushes it (`AppModel.flushPlayerNote`, `lastNoteSaves`), and
    /// a keystroke never cancels a save under way.
    public private(set) var drafts: [Int: String] = [:]
    /// The note last kept, as he typed it (the server keeps an all-blank note as none), by player.
    private var keptTyped: [Int: String] = [:]
    /// The players whose first note, typed here, is what followed them: emptying it again is the served undo.
    private var followedByNote: Set<Int> = []
    /// The wait after the last key, by player; a new key starts it again.
    private var waits: [Int: Task<Void, Never>] = [:]
    /// The save under way, by player: one at a time, the latest draft next. The save clears its own entry as its last
    /// step, so whoever waited on it finds none when it resumes.
    private var saving: [Int: (token: UUID, task: Task<Void, Never>)] = [:]
    /// How long after the last key the note is saved.
    public var noteDelay: Duration = .milliseconds(600)

    /// Each comparison as last served, by the players' ids in the order asked.
    public private(set) var comparisons: [[Int]: Components.Schemas.PlayerCompareView] = [:]
    public private(set) var compareProblems: [[Int]: RequestProblem] = [:]
    private var compareKeys: [[Int]: AppModel.StoreKey] = [:]
    private var compareAsked: [[Int]: AppModel.StoreKey] = [:]

    private let log: @MainActor (String) -> Void

    public init(log: @escaping @MainActor (String) -> Void = { _ in }) {
        self.log = log
    }

    // MARK: The dossier

    /// Whether the shown dossier of a player was read for this key.
    public func isCurrent(_ id: Int, for key: AppModel.StoreKey?) -> Bool {
        guard let key, dossiers[id] != nil else { return false }
        return keys[id] == key
    }

    /// Reads a player's dossier for the key, once per key; the last good one stays while it is read again.
    public func load(_ id: Int, client: Client?, key: AppModel.StoreKey?) async {
        guard let client, let key else { return }
        if keys[id] == key, dossiers[id] != nil { return }
        asked[id] = key
        loading.insert(id)
        defer { if asked[id] == key { loading.remove(id) } }
        var served: Components.Schemas.PlayerDossierView?
        var problem: RequestProblem?
        do {
            switch try await client.getPlayerDossier(path: .init(id: id), query: .init(org: FrontOfficeStore.org(key))) {
            case .ok(let answer): served = try answer.body.json
            case .notFound(let refused): problem = .served(try refused.body.json.error)
            case .undocumented(let code, let payload):
                problem = await .undocumented(code, body: payload.body, operation: "getPlayerDossier", fromV2: true)
            }
        } catch {
            if Task.isCancelled || RequestProblem.isCancellation(error) { return }
            problem = .from(error)
        }
        guard asked[id] == key, !Task.isCancelled else { return }
        if let served {
            dossiers[id] = served
            keys[id] = key
        }
        problems[id] = problem
        if let detail = problem?.detail { log("could not read a player's dossier: \(detail)") }
    }

    // MARK: Notes

    /// Reads the GM's note and the staff's notes on a player.
    public func loadNotes(_ id: Int, client: Client?) async {
        guard let client else { return }
        do {
            switch try await client.getPlayerNotes(path: .init(id: id)) {
            case .ok(let answer):
                notes[id] = try answer.body.json
                noteProblems[id] = nil
                // Read again with nothing typed or saving: the served note is the one shown (changed elsewhere, perhaps)
                if drafts[id] == nil, saving[id] == nil { keptTyped[id] = nil }
            case .notFound(let refused): noteProblems[id] = .served(try refused.body.json.error)
            case .undocumented(let code, let payload):
                noteProblems[id] = await .undocumented(code, body: payload.body, operation: "getPlayerNotes", fromV2: true)
            }
        } catch {
            if Task.isCancelled || RequestProblem.isCancellation(error) { return }
            let problem = RequestProblem.from(error)
            noteProblems[id] = problem
            if let detail = problem.detail { log("could not read a player's notes: \(detail)") }
        }
    }

    // MARK: The note being typed

    /// The note the editor shows: what he typed and hasn't had kept yet, else what was kept.
    public func noteText(_ id: Int) -> String {
        drafts[id] ?? keptTyped[id] ?? notes[id]?.note ?? ""
    }

    /// Whether his note was read (the editor waits for it), or he has typed since.
    public func noteReady(_ id: Int) -> Bool {
        notes[id] != nil || drafts[id] != nil
    }

    /// The GM typed: kept as the draft, and `save` called a moment after the last key, in the store's own task (the
    /// next key restarts the wait; it never cancels a save under way).
    public func type(_ id: Int, _ text: String, save: @escaping @MainActor (Int) async -> Void) {
        drafts[id] = text
        waits[id]?.cancel()
        let delay = noteDelay
        waits[id] = Task { @MainActor in
            try? await Task.sleep(for: delay)
            guard !Task.isCancelled else { return }
            await save(id)
        }
    }

    /// Stops the wait after the last key (a flush saves now instead).
    private func stopWaiting(_ id: Int) {
        waits[id]?.cancel()
        waits[id] = nil
    }

    /// The draft to save now, or nil when there is none or it is what was kept (the draft then dropped).
    private func draftToSave(_ id: Int) -> String? {
        guard let draft = drafts[id] else { return nil }
        if draft == (keptTyped[id] ?? notes[id]?.note ?? "") {
            drafts[id] = nil
            return nil
        }
        return draft
    }

    /// A draft the server kept: the draft is dropped unless he typed on since.
    private func kept(_ id: Int, _ typed: String) {
        keptTyped[id] = typed
        if drafts[id] == typed { drafts[id] = nil }
    }

    /// Every draft not kept yet, with whether emptying it is the first note's undo, and every wait stopped (the quit).
    private func takeUnsaved() -> [Unsaved] {
        for id in Array(waits.keys) { stopWaiting(id) }
        var unsaved: [Unsaved] = []
        for (id, text) in drafts where text != (keptTyped[id] ?? notes[id]?.note ?? "") {
            let blank = text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            unsaved.append(Unsaved(id: id, text: text, undoesFirstNote: followedByNote.contains(id) && blank))
        }
        return unsaved
    }

    private struct Unsaved: Sendable {
        let id: Int
        let text: String
        let undoesFirstNote: Bool
    }

    /// Saves what the GM typed in his note on a player now, in a task of its own that no keystroke and no closed view
    /// cancels: after the wait, on a section switch and on a closed window. One save at a time per player, the latest
    /// draft next; a save that fails keeps the draft (said in `noteProblems`) for the next key or flush. `changed` runs
    /// after the server kept a change (Following is read again: a note may follow him, or change his line there).
    public func flush(_ id: Int, client: Client?, changed: @escaping @MainActor () async -> Void = {}) async {
        stopWaiting(id)
        while let running = saving[id] { await running.task.value }
        guard let client, let draft = draftToSave(id) else { return }
        let token = UUID()
        let save = Task { @MainActor [weak self] in
            guard let self else { return }
            defer { if saving[id]?.token == token { saving[id] = nil } }
            if followedByNote.contains(id), draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                // Emptied again: undo what the first note did (it followed him), as the server's undo says
                guard await undoFirstNote(id, client: client) != nil else { return }
                followedByNote.remove(id)
            } else {
                guard let change = await setNote(id, draft, client: client) else { return }
                if change.undoUnfollows { followedByNote.insert(id) }
            }
            kept(id, draft)
            await changed()
        }
        saving[id] = (token, save)
        await save.value
    }

    /// The notes typed and not kept yet, as one send that needs no main actor (the quit's last words, sent before the
    /// server stops); every wait is stopped. A save already under way finishes on its own.
    public func lastSaves(client: Client?) -> @Sendable () async -> Void {
        let unsaved = takeUnsaved()
        guard let client, !unsaved.isEmpty else { return {} }
        return {
            for note in unsaved {
                if note.undoesFirstNote {
                    _ = try? await client.undoFirstPlayerNote(path: .init(id: note.id))
                } else {
                    _ = try? await client.setPlayerNote(path: .init(id: note.id), body: .json(.init(note: note.text)))
                }
            }
        }
    }

    /// Saves the GM's note exactly as typed; the served change (with its undo), or nil when it was refused (said in
    /// `noteProblems`).
    @discardableResult
    public func setNote(_ id: Int, _ text: String, client: Client?) async -> Components.Schemas.PlayerNoteChange? {
        guard let client else { return nil }
        return await noteChange(id, operation: "setPlayerNote") {
            switch try await client.setPlayerNote(path: .init(id: id), body: .json(.init(note: text))) {
            case .ok(let answer): return .success(try answer.body.json)
            case .badRequest(let refused): return .failure(.served(try refused.body.json.error))
            case .notFound(let refused): return .failure(.served(try refused.body.json.error))
            case .undocumented(let code, let payload):
                return .failure(await .undocumented(code, body: payload.body, operation: "setPlayerNote", fromV2: true))
            }
        }
    }

    /// The undo of a first note: stops following the player the note followed.
    @discardableResult
    public func undoFirstNote(_ id: Int, client: Client?) async -> Components.Schemas.PlayerNoteChange? {
        guard let client else { return nil }
        return await noteChange(id, operation: "undoFirstPlayerNote") {
            switch try await client.undoFirstPlayerNote(path: .init(id: id)) {
            case .ok(let answer): return .success(try answer.body.json)
            case .badRequest(let refused): return .failure(.served(try refused.body.json.error))
            case .notFound(let refused): return .failure(.served(try refused.body.json.error))
            case .undocumented(let code, let payload):
                return .failure(await .undocumented(code, body: payload.body, operation: "undoFirstPlayerNote", fromV2: true))
            }
        }
    }

    private func noteChange(
        _ id: Int, operation: String,
        _ send: () async throws -> Result<Components.Schemas.PlayerNoteChange, RequestProblem>
    ) async -> Components.Schemas.PlayerNoteChange? {
        do {
            switch try await send() {
            case .success(let change):
                notes[id] = change.notes
                noteProblems[id] = nil
                noteDone[id] = change.done.display
                return change
            case .failure(let problem):
                noteProblems[id] = problem
                return nil
            }
        } catch {
            // A request called off is a non-event: no problem line, no log line
            if RequestProblem.isCancellation(error) { return nil }
            let problem = RequestProblem.from(error)
            noteProblems[id] = problem
            if let detail = problem.detail { log("could not \(operation): \(detail)") }
            return nil
        }
    }

    /// Removes a staff note; the served change, whose `undo` puts it back.
    @discardableResult
    public func removeStaffNote(_ id: Int, noteId: Int, client: Client?) async -> Components.Schemas.StaffNoteChange? {
        guard let client else { return nil }
        do {
            switch try await client.removeStaffNote(path: .init(id: id, noteId: noteId)) {
            case .ok(let answer):
                let change = try answer.body.json
                notes[id] = change.notes
                noteProblems[id] = nil
                return change
            case .notFound(let refused):
                noteProblems[id] = .served(try refused.body.json.error)
            case .undocumented(let code, let payload):
                noteProblems[id] = await .undocumented(code, body: payload.body, operation: "removeStaffNote", fromV2: true)
            }
        } catch {
            if !RequestProblem.isCancellation(error) { noteProblems[id] = .from(error) }
        }
        return nil
    }

    /// Puts a removed staff note back as it was filed.
    @discardableResult
    public func restoreStaffNote(_ id: Int, _ note: Components.Schemas.StaffNoteRestore, client: Client?) async -> Components.Schemas.StaffNoteChange? {
        guard let client else { return nil }
        do {
            switch try await client.restoreStaffNote(path: .init(id: id), body: .json(note)) {
            case .ok(let answer):
                let change = try answer.body.json
                notes[id] = change.notes
                noteProblems[id] = nil
                return change
            case .badRequest(let refused): noteProblems[id] = .served(try refused.body.json.error)
            case .notFound(let refused): noteProblems[id] = .served(try refused.body.json.error)
            case .undocumented(let code, let payload):
                noteProblems[id] = await .undocumented(code, body: payload.body, operation: "restoreStaffNote", fromV2: true)
            }
        } catch {
            if !RequestProblem.isCancellation(error) { noteProblems[id] = .from(error) }
        }
        return nil
    }

    // MARK: Comparison

    /// Whether the shown comparison of these players was read for this key.
    public func compareIsCurrent(_ ids: [Int], for key: AppModel.StoreKey?) -> Bool {
        guard let key, comparisons[ids] != nil else { return false }
        return compareKeys[ids] == key
    }

    /// Reads two to four players side by side for the key, once per key.
    public func loadCompare(_ ids: [Int], client: Client?, key: AppModel.StoreKey?) async {
        guard let client, let key, (2...4).contains(ids.count) else { return }
        if compareKeys[ids] == key, comparisons[ids] != nil { return }
        compareAsked[ids] = key
        var served: Components.Schemas.PlayerCompareView?
        var problem: RequestProblem?
        do {
            let query = Operations.GetPlayerCompare.Input.Query(players: ids.map(String.init).joined(separator: ","), org: FrontOfficeStore.org(key))
            switch try await client.getPlayerCompare(query: query) {
            case .ok(let answer): served = try answer.body.json
            case .badRequest(let refused): problem = .served(try refused.body.json.error)
            case .notFound(let refused): problem = .served(try refused.body.json.error)
            case .undocumented(let code, let payload):
                problem = await .undocumented(code, body: payload.body, operation: "getPlayerCompare", fromV2: true)
            }
        } catch {
            if Task.isCancelled || RequestProblem.isCancellation(error) { return }
            problem = .from(error)
        }
        guard compareAsked[ids] == key, !Task.isCancelled else { return }
        if let served {
            comparisons[ids] = served
            compareKeys[ids] = key
        }
        compareProblems[ids] = problem
        if let detail = problem?.detail { log("could not read a comparison: \(detail)") }
    }

    #if DEBUG
    /// A store holding served payloads, for `#Preview`s and snapshots.
    public static func preview(
        dossiers: [Components.Schemas.PlayerDossierView] = [],
        notes: [Components.Schemas.PlayerNotesView] = [],
        comparisons: [Components.Schemas.PlayerCompareView] = [],
        key: AppModel.StoreKey? = nil
    ) -> PlayerStore {
        let store = PlayerStore()
        for d in dossiers {
            store.dossiers[d.playerId] = d
            if let key { store.keys[d.playerId] = key }
        }
        for n in notes { store.notes[n.playerId] = n }
        for c in comparisons {
            let ids = c.players.map(\.playerId)
            store.comparisons[ids] = c
            if let key { store.compareKeys[ids] = key }
        }
        return store
    }
    #endif
}

extension AppModel {
    /// A player's dossier for the current key.
    public func loadPlayer(_ id: Int) async {
        await players.load(id, client: client, key: storeKey)
    }

    /// The GM's and the staff's notes on a player.
    public func loadPlayerNotes(_ id: Int) async {
        await players.loadNotes(id, client: client)
    }

    /// Two to four players side by side for the current key.
    public func loadCompare(_ ids: [Int]) async {
        await players.loadCompare(ids, client: client, key: storeKey)
    }

    /// The GM typed in his note on a player: saved a moment after the last key (`flushPlayerNote`).
    public func typePlayerNote(_ id: Int, _ text: String) {
        players.type(id, text) { [weak self] id in await self?.flushPlayerNote(id) }
    }

    /// Saves what the GM typed in his note on a player now (`PlayerStore.flush`); Following is read again after a change.
    public func flushPlayerNote(_ id: Int) async {
        await players.flush(id, client: client) { [weak self] in
            guard let self else { return }
            await following.load(client: client, key: storeKey, force: true)
        }
    }

    /// The notes typed and not kept yet, as one send that needs no main actor: the quit's last words (`QuitCoordinator`).
    public func lastNoteSaves() -> @Sendable () async -> Void {
        players.lastSaves(client: client)
    }

    /// Saves the GM's note as typed; Following is read again (a note may follow him, or change his line there).
    @discardableResult
    public func savePlayerNote(_ id: Int, _ text: String) async -> Components.Schemas.PlayerNoteChange? {
        let change = await players.setNote(id, text, client: client)
        if change != nil { await following.load(client: client, key: storeKey, force: true) }
        return change
    }

    /// Stops following the player his first note followed (the note's undo when it is emptied again).
    @discardableResult
    public func undoFirstPlayerNote(_ id: Int) async -> Components.Schemas.PlayerNoteChange? {
        let change = await players.undoFirstNote(id, client: client)
        if change != nil { await following.load(client: client, key: storeKey, force: true) }
        return change
    }

    /// Removes a staff note, registering its served undo (the note put back as filed) on the window's undo manager.
    public func removeStaffNote(_ id: Int, noteId: Int, undoManager: UndoManager?, actionName: String) async {
        guard let change = await players.removeStaffNote(id, noteId: noteId, client: client), let undo = change.undo else { return }
        registerStaffNoteUndo(id, undo, undoManager: undoManager, actionName: actionName)
    }

    private func registerStaffNoteUndo(_ id: Int, _ undo: Components.Schemas.StaffNoteRestore, undoManager: UndoManager?, actionName: String) {
        guard let undoManager else { return }
        let step = UndoStep()
        undoManager.registerUndo(withTarget: step) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                Task { @MainActor in
                    guard let restored = await self.players.restoreStaffNote(id, undo, client: self.client) else { return }
                    // Removing it again is the redo: the restored note is the newest one
                    if let note = restored.notes.staff.first {
                        undoManager.registerUndo(withTarget: step) { [weak self] _ in
                            MainActor.assumeIsolated {
                                guard let self else { return }
                                Task { @MainActor in await self.removeStaffNote(id, noteId: note.id, undoManager: undoManager, actionName: actionName) }
                            }
                        }
                    }
                }
            }
        }
        undoManager.setActionName(actionName)
        // Dropped with the desk's and Following's steps when the save or the club changes (`settleUndoScope`)
        undoSteps.removeAll { $0.manager == nil }
        undoSteps.append(UndoRegistration(manager: undoManager, step: step))
    }
}
