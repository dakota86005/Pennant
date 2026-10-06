import Observation
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

// Opening a player anywhere (N11; SWIFTUI_REBUILD.md section 3.1): his own window (`WindowGroup(for: PlayerRef.self)`),
// opened or brought forward, from a name, a table row, the palette, Following or a desk item; and Compare, which keeps
// two to four players side by side. Nothing here decides anything about a player: it opens what the server serves.

/// The player a served target names (a `player` target with its id), or nil.
public func playerRef(opening target: Components.Schemas.Target?) -> PlayerRef? {
    guard let target, target.kind.value1 == .player, let id = target.playerId else { return nil }
    return PlayerRef(id: id)
}

/// The player a served claim links to (a desk item's headline names its player, D-066), or nil.
public func linkedPlayer(_ claim: Components.Schemas.Claim?) -> PlayerRef? {
    claim?.links.lazy.compactMap { playerRef(opening: $0) }.first
}

// MARK: The OSA mark

/// The mark beside grades that are OSA's view filling in for our scouts (D-067): the served mark ("OSA") on a fixed,
/// checked fill, its served sentence as the help tag and as what VoiceOver reads. Drawn wherever a grade is shown; a
/// player our scouts rate carries none.
public struct RatingFillMark: View {
    let cell: Components.Schemas.Cell

    public init(_ cell: Components.Schemas.Cell) {
        self.cell = cell
    }

    public var body: some View {
        Text(verbatim: cell.display)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(.primary)
            .padding(.horizontal, 5).padding(.vertical, 1)
            .background(Color.readableChipFill, in: .capsule)
            .overlay(Capsule().strokeBorder(Color.primary.opacity(0.35), lineWidth: 0.5))
            .help(detail: cell.hint)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: cell.hint ?? cell.display))
            .accessibilityAddTraits(.isStaticText)
            .accessibilityIdentifier("ratings.fill")
    }
}

// MARK: Compare

/// Where "Compare" sends players: the Compare window the GM used last, while it is open and has room for them, else a
/// new one. A window registers itself when it comes forward and takes the players handed to it (`take`). How many a
/// comparison holds is served (`phrases.compare.most`, review L5); the app has no number of its own.
@Observable @MainActor
public final class CompareRouter {
    public static let shared = CompareRouter()

    /// The most recent Compare window's token and what it shows (its scene value: opening that value brings it forward).
    public private(set) var active: (token: UUID, value: ComparisonRef)?
    /// Players handed to a window, by its token, until it takes them.
    public private(set) var handed: [UUID: [PlayerRef]] = [:]

    /// The most a comparison holds, as the catalog serves it; nil until it is read (the server then refuses more, in a
    /// sentence).
    public var most: Int?

    public init() {}

    /// A Compare window came forward (or changed what it shows).
    public func register(_ token: UUID, value: ComparisonRef) {
        active = (token, value)
    }

    /// A Compare window closed.
    public func forget(_ token: UUID) {
        if active?.token == token { active = nil }
        handed[token] = nil
    }

    /// The players handed to this window, taken once.
    public func take(_ token: UUID) -> [PlayerRef] {
        defer { handed[token] = nil }
        return handed[token] ?? []
    }

    /// Players added to a comparison, the ones already there kept, up to `most` (when served), in the order given.
    public nonisolated static func adding(_ players: [PlayerRef], to value: ComparisonRef, most: Int?) -> ComparisonRef {
        var next = value
        for p in players where !next.players.contains(p) && most.map({ next.players.count < $0 }) ?? true {
            next.players.append(p)
        }
        return next
    }

    /// Compares these players: hands them to the Compare window used last and brings it forward; opens a new one when
    /// none is open, or when the last one has no room for them (never dropping a player the GM chose).
    public func compare(_ players: [PlayerRef], open: (ComparisonRef) -> Void) {
        guard !players.isEmpty else { return }
        if let active {
            let holding = active.value.players + (handed[active.token] ?? [])
            let fresh = players.filter { !holding.contains($0) }
            if let most, holding.count + fresh.count > most, !fresh.isEmpty {
                open(Self.adding(players, to: ComparisonRef(), most: most))
                return
            }
            handed[active.token, default: []].append(contentsOf: fresh)
            open(active.value)
        } else {
            open(Self.adding(players, to: ComparisonRef(), most: most))
        }
    }
}

/// "Compare" for a player (or the selected players), in a context menu or the Player menu.
public struct CompareMenuItem: View {
    let players: [PlayerRef]
    @Environment(\.openWindow) private var openWindow

    public init(_ players: [PlayerRef]) {
        self.players = players
    }

    public var body: some View {
        Button("Compare", systemImage: "rectangle.split.2x1") {
            CompareRouter.shared.compare(players) { openWindow(value: $0) }
        }
        .disabled(players.isEmpty)
    }
}

/// "Open Player" for a player.
public struct OpenPlayerMenuItem: View {
    let player: PlayerRef
    @Environment(\.openWindow) private var openWindow

    public init(_ player: PlayerRef) {
        self.player = player
    }

    public var body: some View {
        Button("Open Player", systemImage: "person.text.rectangle") { openWindow(value: player) }
    }
}
