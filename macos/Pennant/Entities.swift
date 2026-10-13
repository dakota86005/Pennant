import AppIntents
import CoreSpotlight
import PennantAPI
import PennantKit

/// A player as Shortcuts and Spotlight know him (N14, Stage A, D-075): his entity id (the save's served id and his own,
/// `IntegrationStore.entityID`, so one kept from another save resolves to nothing), his `PlayerRef`, and his name and
/// line as the search serves them ("SS · Hometown Hawks · Majors"). Opening him opens his player window.
nonisolated struct PlayerEntity: AppEntity, IndexedEntity {
    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Player")
    static let defaultQuery = PlayerEntityQuery()

    let id: String
    let ref: PlayerRef
    let name: String
    let line: String

    var displayRepresentation: DisplayRepresentation {
        // Served words, shown as served
        DisplayRepresentation(title: LocalizedStringResource(stringLiteral: name), subtitle: line.isEmpty ? nil : LocalizedStringResource(stringLiteral: line))
    }

    init(_ served: IntegrationStore.EntityLine) {
        id = served.id
        ref = PlayerRef(id: served.number)
        name = served.name
        line = served.line
    }
}

/// A club as Shortcuts and Spotlight know it: its entity id (the save's and its team id), its `ClubRef`, and its name and
/// line as the search serves them. Opening it opens the club's window.
nonisolated struct ClubEntity: AppEntity, IndexedEntity {
    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Club")
    static let defaultQuery = ClubEntityQuery()

    let id: String
    let ref: ClubRef
    let name: String
    let line: String

    var displayRepresentation: DisplayRepresentation {
        // Served words, shown as served
        DisplayRepresentation(title: LocalizedStringResource(stringLiteral: name), subtitle: line.isEmpty ? nil : LocalizedStringResource(stringLiteral: line))
    }

    init(_ served: IntegrationStore.EntityLine) {
        id = served.id
        ref = ClubRef(id: served.number)
        name = served.name
        line = served.line
    }
}

/// Players by id (the served Spotlight list, or the served search Shortcuts was given; another save's id, or one neither
/// holds, is no player), by what was typed (the served search) and as suggestions (our club's, as the served list gives
/// them). Nothing is ranked here: each answer is in the order served.
nonisolated struct PlayerEntityQuery: EntityStringQuery {
    func entities(for identifiers: [String]) async throws -> [PlayerEntity] {
        await IntentRouter.shared.resolve(identifiers, kind: .player).map(PlayerEntity.init)
    }

    func entities(matching string: String) async throws -> [PlayerEntity] {
        await IntentRouter.shared.search(string, kind: .player).map(PlayerEntity.init)
    }

    func suggestedEntities() async throws -> [PlayerEntity] {
        await IntentRouter.shared.suggested(.player).map(PlayerEntity.init)
    }
}

/// Clubs, as players are found.
nonisolated struct ClubEntityQuery: EntityStringQuery {
    func entities(for identifiers: [String]) async throws -> [ClubEntity] {
        await IntentRouter.shared.resolve(identifiers, kind: .club).map(ClubEntity.init)
    }

    func entities(matching string: String) async throws -> [ClubEntity] {
        await IntentRouter.shared.search(string, kind: .club).map(ClubEntity.init)
    }

    func suggestedEntities() async throws -> [ClubEntity] {
        await IntentRouter.shared.suggested(.club).map(ClubEntity.init)
    }
}

/// Puts the served list in Spotlight after each import (N14, Stage A): exactly the players and clubs served, replacing
/// what was there, so a player who left the organization leaves Spotlight too; and removes Pennant's entries when no save
/// or club is to be shown, or another one is (`clear`). Only a release build indexes by itself; a development build does
/// when asked by hand (`-PennantDevSpotlight YES`; no UI test asks), so building and running Pennant on a developer's Mac
/// never fills its Spotlight with a scratch league. One change at a time, in the order asked.
@MainActor
final class SpotlightIndexer {
    private let log: (String) -> Void
    /// The list last indexed, and the one being indexed: a list already in Spotlight, or on its way, is not indexed again.
    private var lastIndexed: String?
    private var inFlight: String?
    /// Moved by each `clear`: an indexing asked for before it records nothing when it lands after it.
    private var generation = 0
    private var work: Task<Void, Never>?

    init(log: @escaping (String) -> Void) {
        self.log = log
    }

    /// Replaces Pennant's entries with these, unless this list (`IntegrationStore.indexStamp`: the save, the club and
    /// the import) is already there or on its way. The stamp is kept only once Spotlight has taken the list (review N14A,
    /// L3), and Shortcuts is told the parameters moved (L2).
    func index(players: [IntegrationStore.EntityLine], clubs: [IntegrationStore.EntityLine], stamp: String) {
        guard stamp != lastIndexed, stamp != inFlight else { return }
        inFlight = stamp
        let players = players.map(PlayerEntity.init), clubs = clubs.map(ClubEntity.init)
        let log = log
        let previous = work
        let generation = generation
        work = Task { [weak self] in
            await previous?.value
            do {
                try await Self.replace(players: players, clubs: clubs)
                self?.indexed(stamp, generation: generation)
                PennantShortcuts.updateAppShortcutParameters()
                log("spotlight: indexed \(players.count) players and \(clubs.count) clubs as served")
            } catch {
                self?.failed(stamp)
                log("spotlight: could not index: \((error as NSError).domain) \((error as NSError).code)")
            }
        }
    }

    /// Removes Pennant's players and clubs from Spotlight (review N14A, M3).
    func clear() {
        lastIndexed = nil
        inFlight = nil
        generation += 1
        let log = log
        let previous = work
        work = Task {
            await previous?.value
            do {
                try await Self.removeAll()
                PennantShortcuts.updateAppShortcutParameters()
                log("spotlight: removed Pennant's players and clubs")
            } catch {
                log("spotlight: could not remove Pennant's entries: \((error as NSError).domain) \((error as NSError).code)")
            }
        }
    }

    private func indexed(_ stamp: String, generation: Int) {
        guard generation == self.generation else { return }
        lastIndexed = stamp
        if inFlight == stamp { inFlight = nil }
    }

    private func failed(_ stamp: String) {
        if inFlight == stamp { inFlight = nil }
    }

    /// What Spotlight holds of Pennant's, replaced by the list: off the main actor, on the system's default index.
    @concurrent
    private nonisolated static func replace(players: [PlayerEntity], clubs: [ClubEntity]) async throws {
        try await removeAll()
        let index = CSSearchableIndex.default()
        try await index.indexAppEntities(players)
        try await index.indexAppEntities(clubs)
    }

    @concurrent
    private nonisolated static func removeAll() async throws {
        let index = CSSearchableIndex.default()
        try await index.deleteAppEntities(ofType: PlayerEntity.self)
        try await index.deleteAppEntities(ofType: ClubEntity.self)
    }
}
