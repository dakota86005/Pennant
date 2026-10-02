import CoreTransferable
import Foundation
import UniformTypeIdentifiers

/// A department's identity (`frontOffice`, `majorLeague`, …). Open: the registry (Stage B) names the departments;
/// a route saved by a newer build still decodes.
public struct DeptID: RawRepresentable, Codable, Hashable, Sendable, ExpressibleByStringLiteral {
    public let rawValue: String
    public init(rawValue: String) { self.rawValue = rawValue }
    public init(stringLiteral value: String) { rawValue = value }

    public init(from decoder: any Decoder) throws {
        rawValue = try decoder.singleValueContainer().decode(String.self)
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
}

/// Where a main window is: a department and one of its views (SWIFTUI_REBUILD.md section 6). Saved per window
/// (`@SceneStorage`), so it is `Codable`.
public struct AppRoute: Codable, Hashable, Sendable {
    public var department: DeptID
    /// The view's id inside its department (`report`, `positionPlayers`, …).
    public var view: String
    /// What the view opens on, when it opens on one thing (N10): a player's id on Farm & Development ▸ Decision, an
    /// affiliate's team id on Affiliates (the served target's `key`). Nil for the view itself; a route saved by an
    /// earlier build has none and decodes as nil, so a window's history is kept.
    public var subject: String?

    public init(department: DeptID, view: String, subject: String? = nil) {
        self.department = department
        self.view = view
        self.subject = subject
    }

    /// The view itself, without what it opens on: the sidebar's row for it.
    public var withoutSubject: AppRoute { AppRoute(department: department, view: view) }
}

extension UTType {
    /// A player, dragged between Pennant's windows.
    public static let pennantPlayer = UTType(exportedAs: "com.dakotawise.pennant.player")
    /// A club, dragged between Pennant's windows.
    public static let pennantClub = UTType(exportedAs: "com.dakotawise.pennant.club")
    /// A comparison, dragged between Pennant's windows.
    public static let pennantComparison = UTType(exportedAs: "com.dakotawise.pennant.comparison")
}

/// A player, by the save's player id: the value a player window opens with (`WindowGroup(for: PlayerRef.self)`)
/// and what a drag carries.
public struct PlayerRef: Codable, Hashable, Sendable, Transferable {
    public var id: Int

    public init(id: Int) { self.id = id }

    public static var transferRepresentation: some TransferRepresentation {
        CodableRepresentation(contentType: .pennantPlayer)
    }
}

/// A club, by its organization (team) id.
public struct ClubRef: Codable, Hashable, Sendable, Transferable {
    public var id: Int

    public init(id: Int) { self.id = id }

    public static var transferRepresentation: some TransferRepresentation {
        CodableRepresentation(contentType: .pennantClub)
    }
}

/// Players side by side, or us against another club: what a compare window opens with.
public struct ComparisonRef: Codable, Hashable, Sendable, Transferable {
    public var players: [PlayerRef]
    public var clubs: [ClubRef]

    public init(players: [PlayerRef] = [], clubs: [ClubRef] = []) {
        self.players = players
        self.clubs = clubs
    }

    public static var transferRepresentation: some TransferRepresentation {
        CodableRepresentation(contentType: .pennantComparison)
    }
}
