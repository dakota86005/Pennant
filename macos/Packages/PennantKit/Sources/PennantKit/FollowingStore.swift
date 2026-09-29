import Foundation
import Observation
import OpenAPIRuntime
import PennantAPI

/// What the GM follows (`GET /api/v2/following`; D-058, SWIFTUI_REBUILD.md section 3.2's Following section): the clubs
/// and players, the served line when there are none, the division rivals suggested with why (never followed by
/// themselves), and the note that the watchlist was copied in. Follows and unfollows answer with the request that
/// undoes them (the window's Undo), and a refusal is the server's sentence, shown in place (`refusal`).
///
/// Keyed on the store key (a new import, club or save) and on the served `followStamp` (the `following-changed` event).
/// It decides nothing: whether an item is followed is only whether the served lists name it.
@Observable @MainActor
public final class FollowingStore {
    /// Following as last served.
    public private(set) var following: Components.Schemas.Following?
    /// Why the last read failed; nil when it did not.
    public private(set) var problem: RequestProblem?
    /// Why the last follow or unfollow was refused, in the server's sentence ("The save you chose isn't imported yet, so
    /// its follows can't be changed."), or the kind of failure; nil when it was not.
    public private(set) var refusal: RequestProblem?
    /// The last change in the server's words ("Following the Club 2 N"), with a moment that moves on each.
    public private(set) var done: (text: String, moment: Int)?
    private var moments = 0
    private var loadedKey: AppModel.StoreKey?
    private let log: @MainActor (String) -> Void

    public init(log: @escaping @MainActor (String) -> Void = { _ in }) {
        self.log = log
    }

    /// A follow or an unfollow, as the server takes it (`PUT` or `DELETE /api/v2/following`): what an undo sends back.
    public enum Request: Sendable, Hashable {
        case follow(Components.Schemas.FollowUpdate)
        case unfollow(kind: String, id: Int)

        /// Follows a club or a player (a note left out keeps the one there).
        public static func follow(kind: String, id: Int, note: String? = nil) -> Request {
            .follow(.init(kind: .init(value1: .init(rawValue: kind), value2: kind), id: id, note: note))
        }

        /// The request a served undo names.
        public init(served undo: Components.Schemas.FollowUndo) {
            let kind = undo.request.kind.value1?.rawValue ?? undo.request.kind.value2 ?? ""
            switch undo.action.value1 {
            case .unfollow: self = .unfollow(kind: kind, id: undo.request.id)
            case .follow, nil: self = .follow(undo.request)
            }
        }
    }

    /// Whether the served lists name this club or player.
    public func isFollowing(kind: String, id: Int) -> Bool {
        guard let following else { return false }
        return (kind == "club" ? following.clubs : following.players).contains { $0.id == id }
    }

    /// Reads Following for the key, once per key unless `stamp` names another follow stamp than the one shown (the
    /// `following-changed` event) or `force` is set. A failed read keeps what was shown and says so.
    public func load(client: Client?, key: AppModel.StoreKey?, stamp: String? = nil, force: Bool = false) async {
        guard let client, let key else { return }
        if !force, loadedKey == key, following != nil, stamp == nil || stamp == following?.followStamp { return }
        do {
            let served = try await client.getFollowing().ok.body.json
            following = served
            loadedKey = key
            problem = nil
        } catch {
            // A read cancelled (the key moved and the view asked again) is no problem to show
            if Task.isCancelled { return }
            let failed = RequestProblem.from(error)
            problem = failed
            if let detail = failed.detail { log("could not read Following: \(detail)") }
        }
    }

    /// Sends a follow or an unfollow and returns the server's answer (with the request that undoes it), or nil when it
    /// was refused or failed (`refusal` says why). The answer's view replaces what is shown.
    @discardableResult
    public func send(_ request: Request, client: Client?) async -> Components.Schemas.FollowChange? {
        guard let client else {
            refusal = .notRunning
            return nil
        }
        var answer: Components.Schemas.FollowChange?
        var failed: RequestProblem?
        do {
            switch request {
            case .follow(let update):
                switch try await client.follow(body: .json(update)) {
                case .ok(let ok): answer = try ok.body.json
                case .badRequest(let refused): failed = .served(try refused.body.json.error)
                case .notFound(let refused): failed = .served(try refused.body.json.error)
                case .undocumented(let code, let payload):
                    failed = await .undocumented(code, body: payload.body, operation: "follow", fromV2: true)
                }
            case .unfollow(let kind, let id):
                switch try await client.unfollow(query: .init(kind: kind, id: id)) {
                case .ok(let ok): answer = try ok.body.json
                case .badRequest(let refused): failed = .served(try refused.body.json.error)
                case .notFound(let refused): failed = .served(try refused.body.json.error)
                case .undocumented(let code, let payload):
                    failed = await .undocumented(code, body: payload.body, operation: "unfollow", fromV2: true)
                }
            }
        } catch {
            failed = .from(error)
        }
        refusal = failed
        if let detail = failed?.detail { log("could not change a follow: \(detail)") }
        guard let answer else { return nil }
        following = answer.view
        moments += 1
        done = (answer.done.display, moments)
        return answer
    }

    /// Clears the last refusal (the GM dismissed it).
    public func dismissRefusal() { refusal = nil }

    #if DEBUG
    /// A store holding a served payload, for `#Preview`s and snapshots.
    public static func preview(_ following: Components.Schemas.Following?, refusal: RequestProblem? = nil) -> FollowingStore {
        let store = FollowingStore()
        store.following = following
        store.refusal = refusal
        return store
    }
    #endif
}
