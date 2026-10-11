import Foundation

extension AppModel.StoreKey {
    /// What a store's contents belong to: the save and the club. A new import or Front Office build of the same club
    /// keeps the scope; another save or club is another scope.
    public struct Scope: Hashable, Sendable {
        public var saveId: String?
        public var club: ClubRef?
    }

    public var scope: Scope { Scope(saveId: saveId, club: club) }
}

/// The key a store follows, and the keys of the same scope it followed before (review N13B, H1). A key moves forward
/// within a scope (a new import, a new Front Office build); a call made under a key the store has already moved past is
/// stale, and is never followed again, so a late call cannot turn the store back to an older key.
struct FollowedKey {
    enum Step: Equatable {
        /// The first key followed.
        case first
        /// The key already followed.
        case same
        /// A later key of the same scope.
        case newer
        /// Another save or club.
        case otherScope
        /// A key of this scope that was followed before and has been moved past: the call is stale.
        case older
    }

    private(set) var key: AppModel.StoreKey?
    private var earlier: Set<AppModel.StoreKey> = []

    mutating func follow(_ next: AppModel.StoreKey) -> Step {
        guard let key else {
            self.key = next
            return .first
        }
        if next == key { return .same }
        if next.scope != key.scope {
            earlier = []
            self.key = next
            return .otherScope
        }
        if earlier.contains(next) { return .older }
        earlier.insert(key)
        self.key = next
        return .newer
    }
}
