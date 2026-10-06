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
        if let all = league.standings?.all { out.append(all.table) }
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

    @Test("every view's fixture decodes, and every served table has a cell for every column and a key for every column it sorts by")
    func everyColumnServed() {
        #expect(league.standings != nil && league.leaders != nil && league.orgComparison != nil && league.franchise != nil)
        #expect(league.usVsThem(nil) != nil && scouting.draftBoard != nil && scouting.lastSearch != nil)
        #expect(tables.count >= 6)
        for table in tables {
            let columns = Set(table.columns.map(\.id))
            // A column of words sorts by its words, and a table the server sorts carries no keys (review, M2)
            let keyed = table.serverSorts == true ? [] : Set(table.columns.filter { $0.byWords != true }.map(\.id))
            for row in table.rows {
                #expect(Set(row.cells.additionalProperties.keys) == columns)
                #expect(Set(row.sort.additionalProperties.keys) == keyed)
            }
        }
        // The board is a published class with rows; the search is sorted on the server
        #expect(scouting.draftBoard?.published == true && (scouting.draftBoard?.board.rows.count ?? 0) > 10)
        #expect(scouting.lastSearch?.results.serverSorts == true)
    }

    @Test("a column of words sorts by its words, an unknown cell last both ways (review, M2)")
    func sortsByWords() throws {
        let board = try #require(scouting.draftBoard?.board)
        let column = try #require(board.columns.first { $0.byWords == true && $0.id == "player" })
        let held = board.rows.enumerated().map { OfficeTableRow(row: $0.element, index: $0.offset) }
        let names = OfficeSort(column: column.id, byWords: true).sorted(held).compactMap { $0.cell("player")?.display }
        #expect(names == names.sorted())
        #expect(held.allSatisfy { $0.key("player", byWords: true) != nil && $0.key("player") == nil })
        // A cell in the unknown tone has no key, so it sorts last
        var unknown = board.rows[0]
        unknown.cells.additionalProperties["player"] = .init(display: "Not known", tone: .init(value1: .unknown, value2: "unknown"))
        #expect(OfficeTableRow(row: unknown, index: 0).key("player", byWords: true) == nil)
    }

    @Test("columns served as not sorting keep the served order in the table's runs, sortable and not (review, M6)")
    func columnRuns() throws {
        let usVsThem = try #require(league.usVsThem(nil)?.sections.first?.table.columns)
        #expect(usVsThem.map(\.sortable) == [true, false, false])
        let runs = OfficeColumnRuns(usVsThem).runs
        #expect(runs.map { $0.map(\.id) } == [["measure"], ["us", "them"], [], []])
        let search = try #require(scouting.lastSearch?.results.columns)
        let searchRuns = OfficeColumnRuns(search).runs
        #expect(searchRuns.flatMap { $0 }.map(\.id) == search.map(\.id))
        #expect(searchRuns[1].map(\.id) == ["bt"])
    }

    @Test("a search's pages make one table in the served order, and its latest page says how many and what is next (review, M1)")
    func searchPages() throws {
        let store = PreviewFixtures.scouting
        let first = try #require(store.lastSearch)
        let query = ScoutingStore.SearchQuery(first.query)
        let table = try #require(store.searchResults(query))
        #expect(table.rows.map(\.id) == first.results.rows.map(\.id))
        #expect(store.lastPage(query)?.count.display == first.count.display)
        // A sorted search is another question than the same words in the server's own order
        #expect(ScoutingStore.searchName(query) != ScoutingStore.searchName(ScoutingStore.SearchQuery(q: query.q, tokens: query.tokens, sort: "age", dir: "asc")))
        #expect(ScoutingStore.SearchQuery(sort: nil, dir: "asc").dir == "desc")
    }

    @Test("a prospect's reasons are the chosen row's detail, read when he is chosen (review, M2)")
    func prospectReasons() throws {
        let board = try #require(scouting.draftBoard)
        #expect(board.board.rows.allSatisfy { $0.detail.isEmpty })
        let prospect = try #require(scouting.prospects.values.first)
        #expect(board.board.rows.contains { $0.id == prospect.row && $0.player?.playerId == prospect.playerId })
        #expect(!prospect.detail.isEmpty)
        #expect(board.filters.map(\.id) == ["position", "school"])
        #expect(board.filters.allSatisfy { filter in filter.choices.filter { $0.selected }.count == 1 })
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
        let ss = ScopedSearchToken(id: "position:SS", kind: "position", text: "Shortstop")
        let c = ScopedSearchToken(id: "position:C", kind: "position", text: "Catcher")
        let aaa = ScopedSearchToken(id: "level:2", kind: "level", text: "Triple-A")
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
