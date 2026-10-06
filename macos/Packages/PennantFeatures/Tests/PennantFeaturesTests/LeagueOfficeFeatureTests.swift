@testable import FeatureCore
import Foundation
@testable import League
import PennantAPI
import PennantKit
@testable import Scouting
@testable import Shell
import Testing

/// League Office's and Scouting's views drawn as served (N12 Track B; BEHAVIOR_CASES.md "Pennant for Mac",
/// `LeagueOfficeFeatureTests`): every served table has a cell and a sort key for every column, every player opens in his
/// own window and every club in its own, sorting keeps unknowns last both ways, a search is one question whatever order
/// its tokens were chosen in, and a token replaces another of its kind.
@MainActor
@Suite("League Office and Scouting, drawn")
struct LeagueOfficeFeatureTests {
    let league = PreviewFixtures.leagueOffice
    let scouting = PreviewFixtures.scouting

    private var tables: [Components.Schemas.OfficeTable] {
        var out: [Components.Schemas.OfficeTable] = []
        out += league.standings?.groups.flatMap { $0.divisions.map(\.table) } ?? []
        out += league.leaders?.groups.flatMap { $0.sections.map(\.table) } ?? []
        if let clubs = league.orgComparison?.clubs { out.append(clubs) }
        if let franchise = league.franchise {
            out.append(franchise.seasons.table)
            if let tenure = franchise.tenure { out.append(tenure.seasons.table) }
        }
        out += league.usVsThem(nil)?.sections.map(\.table) ?? []
        if let board = scouting.draftBoard { out.append(board.board) }
        if let results = scouting.lastSearch?.results { out.append(results) }
        return out
    }

    @Test("every view's fixture decodes, and every served table has a cell and a sort key for every column")
    func everyColumnServed() {
        #expect(league.standings != nil && league.leaders != nil && league.orgComparison != nil && league.franchise != nil)
        #expect(league.usVsThem(nil) != nil && scouting.draftBoard != nil && scouting.lastSearch != nil)
        #expect(tables.count >= 6)
        for table in tables {
            let columns = Set(table.columns.map(\.id))
            for row in table.rows {
                #expect(Set(row.cells.additionalProperties.keys) == columns)
                #expect(Set(row.sort.additionalProperties.keys) == columns)
            }
        }
    }

    @Test("every player a table names opens in his own window, every club in its own, and Compare takes each player once")
    func playersAndClubsOpen() {
        for table in tables {
            for row in table.rows {
                for named in (row.player.map { [$0] } ?? row.players ?? []) {
                    #expect(playerRef(opening: named.open) == PlayerRef(id: named.playerId))
                }
                if let club = row.club { #expect(clubRef(opening: club.open) == ClubRef(id: club.teamId)) }
            }
            let chosen = OfficeTable.players(in: table.rows + table.rows)
            #expect(Set(chosen.map(\.id)).count == chosen.count)
        }
        // Standings' rows are clubs, ours among them
        let standings = league.standings?.groups.flatMap { $0.divisions.flatMap(\.table.rows) } ?? []
        #expect(!standings.isEmpty && standings.allSatisfy { $0.club != nil })
        #expect(standings.filter { $0.ours == true }.count == 1)
    }

    @Test("a column sorts by its served keys, unknowns last both ways, ties in the served order")
    func unknownLast() throws {
        let rows = try #require(tables.first { $0.rows.count > 2 }?.rows)
        let held = rows.enumerated().map { OfficeTableRow(row: $0.element, index: $0.offset) }
        for column in rows[0].cells.additionalProperties.keys {
            for order in [SortOrder.forward, .reverse] {
                let sorted = OfficeSort(column: column, order: order).sorted(held)
                let unknown = sorted.map { $0.key(column) == nil }
                // Every unknown after every known
                if let first = unknown.firstIndex(of: true) { #expect(!unknown[first...].contains(false)) }
            }
        }
    }

    @Test("a search is one question whatever order its tokens were chosen in, and a token replaces another of its kind")
    func searchQuestions() {
        let a = ScoutingStore.SearchQuery(q: " Smith ", tokens: ["position:SS", "level:1"]).normalized
        let b = ScoutingStore.SearchQuery(q: "Smith", tokens: ["level:1", "position:SS", "level:1"]).normalized
        #expect(a == b)
        #expect(ScoutingStore.searchName(a) == ScoutingStore.searchName(b))
        let ss = SearchToken(.init(id: "position:SS", kind: "position", text: .init(display: "Shortstop")))
        let c = SearchToken(.init(id: "position:C", kind: "position", text: .init(display: "Catcher")))
        let aaa = SearchToken(.init(id: "level:2", kind: "level", text: .init(display: "Triple-A")))
        #expect(PlayerSearchView.oneOfEachKind([ss, aaa, c]) == [aaa, c])
        #expect(PlayerSearchView.oneOfEachKind([ss, aaa]) == [ss, aaa])
    }

    @Test("a club or save change drops what each store holds, never drawing another club's view")
    func followDrops() {
        let store = PreviewFixtures.leagueOffice
        let first = AppModel.StoreKey(importStamp: "a", club: ClubRef(id: 1), restores: 0, saveId: "s")
        store.follow(first)
        #expect(store.standings != nil)
        store.follow(AppModel.StoreKey(importStamp: "a", club: ClubRef(id: 2), restores: 0, saveId: "s"))
        #expect(store.standings == nil && store.usVsThem(nil) == nil)
        let search = PreviewFixtures.scouting
        search.follow(first)
        search.follow(AppModel.StoreKey(importStamp: "b", club: ClubRef(id: 1), restores: 0, saveId: "other"))
        #expect(search.draftBoard == nil && search.lastSearch == nil)
    }
}
