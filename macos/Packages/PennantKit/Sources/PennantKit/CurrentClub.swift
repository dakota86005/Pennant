import PennantAPI

/// The club the app is about, as the server resolved it (`organization` on `GET /api/settings`: the configured
/// organization, else the one the save's human manages; `server/viewingOrganization.ts`). The app does not resolve it
/// itself; it only finds the served club in the club list (`/api/orgs`) for its name and colours.
public struct CurrentClub: Sendable, Equatable {
    public enum Source: Sendable, Equatable {
        /// Chosen in Settings (`defaultOrgId`).
        case configured
        /// The club the save's human manages.
        case humanManaged
        /// A source a newer server names that this build does not know.
        case other(String)
    }

    public var ref: ClubRef
    /// The club's entry in the club list; nil when the list does not have it (a configured club from another save).
    public var org: Components.Schemas.Org?
    public var source: Source

    public init(ref: ClubRef, org: Components.Schemas.Org?, source: Source) {
        self.ref = ref
        self.org = org
        self.source = source
    }

    /// The served organization, with its club-list entry when there is one; nil when the server resolved none.
    public static func from(served: Components.Schemas.CurrentOrganization?, orgs: [Components.Schemas.Org]) -> CurrentClub? {
        guard let served else { return nil }
        let source: Source = switch served.source.value1 {
        case .configured: .configured
        case .human: .humanManaged
        case nil: .other(served.source.value2 ?? "")
        }
        return CurrentClub(ref: ClubRef(id: served.id), org: orgs.first { $0.teamId == served.id }, source: source)
    }
}

extension CurrentClub.Source {
    /// The served word for the source (`configured`, `human`), kept with a report so its club card can be drawn again.
    public var servedWord: String {
        switch self {
        case .configured: "configured"
        case .humanManaged: "human"
        case .other(let word): word
        }
    }

    /// The source a kept word names; nil for none.
    public static func from(servedWord word: String?) -> Self? {
        switch word {
        case nil: nil
        case "configured": .configured
        case "human": .humanManaged
        case let other?: .other(other)
        }
    }
}
