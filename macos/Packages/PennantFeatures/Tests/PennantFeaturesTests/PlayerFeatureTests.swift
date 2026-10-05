@testable import FeatureCore
import Foundation
import PennantAPI
import PennantKit
@testable import Player
@testable import Shell
import Testing

/// The player window and Compare as served (N11; BEHAVIOR_CASES.md "Player card"): a player opens his own window from
/// any served target that names him; Compare keeps two to four players in the order given and never one twice; the
/// store shows a dossier only for the key it was read for; the window's fixtures decode as the contract says.
@MainActor
@Suite("Player windows and Compare")
struct PlayerFeatureTests {
    private func target(_ kind: Components.Schemas.TargetKind.Value1Payload, player: Int? = nil, team: Int? = nil) -> Components.Schemas.Target {
        .init(kind: .init(value1: kind, value2: kind.rawValue), playerId: player, teamId: team)
    }

    @Test("A served player target opens his own window; a club or a view does not")
    func opensPlayers() {
        #expect(playerRef(opening: target(.player, player: 1000, team: 1)) == PlayerRef(id: 1000))
        #expect(playerRef(opening: target(.player)) == nil)
        #expect(playerRef(opening: target(.club, team: 3)) == nil)
        #expect(playerRef(opening: nil) == nil)
        // His club is still there, as Open His Club
        #expect(clubRef(opening: target(.player, player: 1000, team: 1)) == ClubRef(id: 1))
    }

    @Test("A desk item's headline that links a player opens him (the farm's items name their player, D-066)")
    func linkedFromClaims() throws {
        let dossier = try #require(PreviewFixtures.playerFixture(Components.Schemas.PlayerDossierView.self, "dossier-rich"))
        var claim = dossier.header.freshness
        #expect(linkedPlayer(claim) == nil)
        claim.links = [target(.club, team: 2), target(.player, player: 77, team: 2)]
        #expect(linkedPlayer(claim) == PlayerRef(id: 77))
    }

    @Test("Compare keeps two to four players, in the order given, never one twice")
    func compareAdds() {
        var value = CompareRouter.adding([PlayerRef(id: 1), PlayerRef(id: 2)], to: ComparisonRef())
        #expect(value.players == [PlayerRef(id: 1), PlayerRef(id: 2)])
        value = CompareRouter.adding([PlayerRef(id: 2), PlayerRef(id: 3)], to: value)
        #expect(value.players.map(\.id) == [1, 2, 3])
        value = CompareRouter.adding([PlayerRef(id: 4), PlayerRef(id: 5)], to: value)
        #expect(value.players.map(\.id) == [1, 2, 3, 4])
        #expect(CompareRouter.most == 4)
    }

    @Test("Compare hands players to the window used last and brings it forward, else opens a new one")
    func compareRoutes() {
        let router = CompareRouter()
        var opened: [ComparisonRef] = []
        router.compare([PlayerRef(id: 9)]) { opened.append($0) }
        #expect(opened == [ComparisonRef(players: [PlayerRef(id: 9)])])
        let token = UUID()
        router.register(token, value: ComparisonRef(players: [PlayerRef(id: 9)]))
        router.compare([PlayerRef(id: 10)]) { opened.append($0) }
        // The window used last is brought forward by its own value, and takes the player handed to it once
        #expect(opened.last == ComparisonRef(players: [PlayerRef(id: 9)]))
        #expect(router.take(token) == [PlayerRef(id: 10)])
        #expect(router.take(token) == [])
        router.forget(token)
        #expect(router.active == nil)
    }

    @Test("The store shows a dossier only for the key it was read for")
    func keyed() throws {
        let dossier = try #require(PreviewFixtures.playerFixture(Components.Schemas.PlayerDossierView.self, "dossier-rich"))
        let key = AppModel.StoreKey(importStamp: "a", club: ClubRef(id: 1), restores: 0)
        let store = PlayerStore.preview(dossiers: [dossier], key: key)
        #expect(store.isCurrent(dossier.playerId, for: key))
        #expect(!store.isCurrent(dossier.playerId, for: AppModel.StoreKey(importStamp: "b", club: ClubRef(id: 1), restores: 0)))
        #expect(!store.isCurrent(dossier.playerId, for: nil))
    }

    @Test("The fuller fixtures decode, with what each section needs to draw (an unknown never a number)")
    func fixtures() throws {
        let rich = try #require(PreviewFixtures.playerFixture(Components.Schemas.PlayerDossierView.self, "dossier-rich"))
        #expect(rich.ratings.history.points.count == 3)
        #expect(!rich.history.log.isEmpty)
        for season in rich.value.cone.seasons where !season.established {
            #expect(season.expected == nil && season.outer == nil && season.inner == nil)
        }
        let filled = try #require(PreviewFixtures.playerFixture(Components.Schemas.PlayerDossierView.self, "dossier-filled"))
        #expect(filled.header.ratingsFill?.display == "OSA")
        #expect(filled.ratings.groups.flatMap(\.rows).allSatisfy { $0.cells.grade.hint == filled.header.ratingsFill?.hint })
        let compare = try #require(PreviewFixtures.playerFixture(Components.Schemas.PlayerCompareView.self, "compare-three"))
        #expect(compare.players.count == 3)
        for row in compare.sections.flatMap(\.rows) { #expect(row.cells.count == 3) }
    }
}
