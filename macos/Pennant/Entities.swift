import AppIntents
import CoreSpotlight
import PennantAPI
import PennantKit

/// A player as Shortcuts and Spotlight know him (N14, Stage A, D-075): his id, and his name and line as the search serves
/// them ("SS · Hometown Hawks · Majors"). Opening him opens his player window.
nonisolated struct PlayerEntity: AppEntity, IndexedEntity {
    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Player")
    static let defaultQuery = PlayerEntityQuery()

    let id: Int
    let name: String
    let line: String

    var displayRepresentation: DisplayRepresentation {
        // Served words, shown as served
        DisplayRepresentation(title: LocalizedStringResource(stringLiteral: name), subtitle: line.isEmpty ? nil : LocalizedStringResource(stringLiteral: line))
    }

    init(_ served: IntegrationStore.EntityLine) {
        id = served.id
        name = served.name
        line = served.line
    }
}

/// A club as Shortcuts and Spotlight know it: its team id, and its name and line as the search serves them. Opening it
/// opens the club's window.
nonisolated struct ClubEntity: AppEntity, IndexedEntity {
    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Club")
    static let defaultQuery = ClubEntityQuery()

    let id: Int
    let name: String
    let line: String

    var displayRepresentation: DisplayRepresentation {
        // Served words, shown as served
        DisplayRepresentation(title: LocalizedStringResource(stringLiteral: name), subtitle: line.isEmpty ? nil : LocalizedStringResource(stringLiteral: line))
    }

    init(_ served: IntegrationStore.EntityLine) {
        id = served.id
        name = served.name
        line = served.line
    }
}

/// Players by id (the served Spotlight list), by what was typed (the served search) and as suggestions (our club's,
/// as the served list gives them). Nothing is ranked here: each answer is in the order served.
nonisolated struct PlayerEntityQuery: EntityStringQuery {
    func entities(for identifiers: [Int]) async throws -> [PlayerEntity] {
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
    func entities(for identifiers: [Int]) async throws -> [ClubEntity] {
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
/// what was there, so a player who left the organization leaves Spotlight too. Only a release build indexes by itself; a
/// development build does when asked (`-PennantDevSpotlight YES`, the UI tests on CI's throwaway runner), so building
/// and running Pennant on a developer's Mac never fills its Spotlight with a scratch league.
@MainActor
final class SpotlightIndexer {
    private let log: (String) -> Void
    private var lastIndexed: String?
    private var work: Task<Void, Never>?

    init(log: @escaping (String) -> Void) {
        self.log = log
    }

    func index(_ list: Components.Schemas.SpotlightList) {
        let players = IntegrationStore.entityLines(list.players).map(PlayerEntity.init)
        let clubs = IntegrationStore.entityLines(list.clubs).map(ClubEntity.init)
        let stamp = "\(list.orgId)|\(list.importStamp ?? "none")|\(players.count)|\(clubs.count)"
        guard stamp != lastIndexed else { return }
        lastIndexed = stamp
        let log = log
        let previous = work
        work = Task {
            // One indexing at a time, in the order asked
            await previous?.value
            do {
                try await Self.replace(players: players, clubs: clubs)
                log("spotlight: indexed \(players.count) players and \(clubs.count) clubs as served")
            } catch {
                log("spotlight: could not index: \((error as NSError).domain) \((error as NSError).code)")
            }
        }
    }

    /// What Spotlight holds of Pennant's, replaced by the list: off the main actor, on the system's default index.
    @concurrent
    private nonisolated static func replace(players: [PlayerEntity], clubs: [ClubEntity]) async throws {
        let index = CSSearchableIndex.default()
        try await index.deleteAppEntities(ofType: PlayerEntity.self)
        try await index.deleteAppEntities(ofType: ClubEntity.self)
        try await index.indexAppEntities(players)
        try await index.indexAppEntities(clubs)
    }
}
