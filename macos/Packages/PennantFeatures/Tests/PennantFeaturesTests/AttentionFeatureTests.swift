import Foundation
import OpenAPIRuntime
@testable import FeatureCore
@testable import FrontOffice
import PennantAPI
import PennantDesign
import PennantKit
import Setup
@testable import Shell
import Testing

/// The Mac side of N7 (Stage B; D-058, D-059): the chips, the wire and another club's report cross from the payload as
/// served; a desk action becomes the served request and works out no date; the palette shows the server's search answer
/// in its order and opens its targets; a player opens his club's window for now; the club owed is asked from the served
/// sentence after a relaunch.
@MainActor
@Suite("N7 in the Mac app: attention and the league")
struct AttentionFeatureTests {
    let registry = DepartmentRegistry(allDepartments)

    private func since() throws -> Components.Schemas.FrontOfficeSummary {
        try #require(PreviewFixtures.decode(Components.Schemas.FrontOfficeSummary.self, "getFrontOffice-since-last-export"))
    }

    // MARK: The adapters

    @Test("the chips are the served ones in the served order, their words as served; a chip counting nothing does not open")
    func chips() throws {
        let summary = try since()
        let changes = try #require(summary.changes)
        let chips = try #require(MorningReportDesign(served: summary).chips)
        #expect(chips.map(\.id) == ["new", "resolved", "moved", "results"])
        #expect(chips.map(\.text) == [changes.new.text, changes.resolved.text, changes.moved.text, changes.results.text])
        #expect(chips.map(\.hint) == [changes.new.hint, changes.resolved.hint, changes.moved.hint, changes.results.hint])
        // "None moved" counts nothing: words, never a control that opens nothing
        #expect(chips.first { $0.id == "moved" }?.opens == false)
        #expect(chips.first { $0.id == "new" }?.opens == true)
    }

    @Test("with no earlier export there are no chips: the served sentence says why, never an empty row")
    func noChips() throws {
        let summary = try #require(PreviewFixtures.decode(Components.Schemas.FrontOfficeSummary.self, "getFrontOffice"))
        #expect(summary.changes == nil)
        #expect(MorningReportDesign(served: summary).chips == nil)
        #expect(summary.changesNote?.display.isEmpty == false)
    }

    @Test("the wire's rows cross as served: the first club, the headline as a claim, when, and followed")
    func wire() throws {
        let summary = try since()
        let top = try #require(summary.wire)
        let items = try #require(MorningReportDesign(served: summary).wire)
        #expect(items.map(\.id) == top.entries.map(\.id))
        #expect(items.map(\.text) == top.entries.map(\.headline.text))
        #expect(items.map(\.when) == top.entries.map(\.when.display))
        #expect(items.map(\.clubId) == top.entries.map { $0.clubs.first?.teamId })
        #expect(items.map(\.followed) == top.entries.map(\.followed))
        #expect(items.first?.claim == top.entries.first?.headline)
    }

    @Test("another club's report is mapped by the same adapters as ours, with no chips")
    func clubReport() throws {
        let report = try #require(PreviewFixtures.decode(Components.Schemas.ClubReport.self, "getClubReport"))
        let design = MorningReportDesign(club: report)
        #expect(design.chips == nil)
        #expect(design.kicker == report.teamSeason.map { [$0.kicker.today.display, $0.kicker.through.display] })
        #expect(design.dimensions?.count == report.clubProfile?.dimensions.count)
        #expect(design.positions?.map(\.id) == report.rosterMap?.positions.map(\.pos))
        #expect(design.ledeClaim == report.lede)
    }

    @Test("a wire chip opens the player's own club as served, never the entry's first club, and nothing when none is served (M3)")
    func wirePlayerOpensServedClub() throws {
        let wire = try #require(PreviewFixtures.decode(Components.Schemas.Wire.self, "getWire"))
        let players = wire.entries.flatMap(\.players)
        #expect(!players.isEmpty)
        for player in players {
            #expect(clubRef(opening: player.open) == player.open?.teamId.map(ClubRef.init(id:)))
        }
        var free = try #require(players.first)
        free.open = nil
        #expect(clubRef(opening: free.open) == nil)
    }

    // MARK: The desk's actions

    @Test("a desk action is the served request: statuses by word, a deferral to a served day, a note that keeps the status and its day (sends none)")
    func deskActions() throws {
        let summary = try since()
        let item = try #require(summary.desk.setAside?.items.first)
        #expect(DeskAction.reviewed.update(for: item.attention, key: item.key).status.value1 == .reviewed)
        #expect(DeskAction.open.update(for: item.attention, key: item.key).status.value1 == .open)
        let choice = try #require(summary.desk.deferChoices.first)
        let deferred = DeskAction.deferred(until: choice.until).update(for: item.attention, key: item.key)
        #expect(deferred.status.value1 == .deferred)
        #expect(deferred.until == choice.until)
        // A status change leaves the note out, so the server keeps it
        #expect(DeskAction.handled.update(for: item.attention, key: item.key).note == nil)
        var waiting = item.attention
        waiting.status = .init(value1: .deferred, value2: "deferred")
        waiting.until = "2040-5-20"
        let note = DeskAction.note("Call him back").update(for: waiting, key: item.key)
        #expect(note.status.value1 == .deferred)
        // The note-only form: no day sent, so the server keeps the one recorded, even one the league has passed (H1)
        #expect(note.until == nil)
        #expect(note.restore == nil)
        #expect(note.note == "Call him back")
        waiting.deferralEnded = true
        waiting.until = "2000-1-1"
        #expect(DeskAction.note("Later").update(for: waiting, key: item.key).until == nil)
        #expect(DeskAction.note("").update(for: item.attention, key: item.key).note == "")
    }

    // MARK: Search and the nearest view

    @Test("the palette shows the server's answer in its order under its titles, the registry's views left out, commands kept")
    func paletteServed() throws {
        let answer = try #require(PreviewFixtures.search)
        let can = CommandAvailability(serverReady: true, configured: true, importing: false, window: (false, false))
        let index = PaletteIndex(registry: registry, catalog: nil, can: can, inspectorShown: false, search: answer)
        let served = answer.groups.flatMap { group in group.results.map { (group.title.display, $0) } }
        #expect(index.served.map(\.title) == served.map(\.1.title))
        #expect(index.served.map(\.group) == served.map(\.0))
        #expect(index.served.map(\.line) == served.map { $0.1.line.isEmpty ? nil : $0.1.line })
        #expect(!index.entries.contains { $0.id.hasPrefix("view.") })
        #expect(index.entries.contains { $0.id == "command.refreshData" })
        let club = try #require(index.served.first)
        #expect(index.action(for: club) == .served(served[0].1.open))
        // The palette never ranks the served results again, whatever was typed
        #expect(Array(([PaletteEntry]() + index.served).prefix(3)) == Array(index.served.prefix(3)))
    }

    @Test("a club opens its window; a player his organization's for now; a view opens no window")
    func nearestView() {
        #expect(clubRef(opening: .init(kind: .init(value1: .club, value2: "club"), teamId: 3)) == ClubRef(id: 3))
        #expect(clubRef(opening: .init(kind: .init(value1: .player, value2: "player"), playerId: 1000, teamId: 1)) == ClubRef(id: 1))
        #expect(clubRef(opening: .init(kind: .init(value1: .player, value2: "player"), playerId: 1000)) == nil)
        #expect(clubRef(opening: .init(kind: .init(value1: .view, value2: "view"), department: .init(value1: .league, value2: "league"), view: "wire")) == nil)
    }

    @Test("the toolbar's answer is the one for the text in the field now, never an earlier query's")
    func toolbarAnswer() throws {
        let window = MainWindowModel(registry: registry)
        let answer = try #require(PreviewFixtures.search)
        window.searchText = "club"
        window.searchAnswer = ("club", answer)
        #expect(window.currentSearch == answer)
        window.searchText = "club 2"
        #expect(window.currentSearch == nil)
    }

    @Test("between keystrokes the last answer stays, said to be updating; a failure for the text now is said, never silent (L3)")
    func toolbarUpdatingAndFailure() throws {
        let window = MainWindowModel(registry: registry)
        let answer = try #require(PreviewFixtures.search)
        window.searchText = "club"
        window.searchAnswer = ("club", answer)
        #expect(window.shownSearch == answer)
        #expect(!window.searchUpdating)
        window.searchText = "club 2"
        #expect(window.shownSearch == answer)
        #expect(window.searchUpdating)
        window.searchProblem = ("club 2", .served("Pennant is still reading this export."))
        #expect(window.currentSearchProblem == .served("Pennant is still reading this export."))
        #expect(window.shownSearch == nil)
        #expect(!window.searchUpdating)
        window.searchText = ""
        #expect(window.shownSearch == nil)
    }

    @Test("a failed search lists no registry views in its place, and a result that opens nothing is drawn disabled (L3)")
    func paletteFailureAndDisabled() throws {
        let can = CommandAvailability(serverReady: true, configured: true, importing: false, window: (false, false))
        let failed = PaletteIndex(registry: registry, catalog: nil, can: can, inspectorShown: false, search: nil, searchFailed: true)
        #expect(!failed.entries.contains { $0.id.hasPrefix("view.") })
        #expect(failed.entries.contains { $0.id == "command.refreshData" })
        let offline = PaletteIndex(registry: registry, catalog: nil, can: can, inspectorShown: false)
        #expect(offline.entries.contains { $0.id.hasPrefix("view.") })
        // A target this build can't open (a view of no department); a free agent, with no club, opens his own window (N11)
        var answer = try #require(PreviewFixtures.search)
        var group = try #require(answer.groups.first)
        var result = try #require(group.results.first)
        result.open = .init(kind: .init(value1: .view, value2: "view"), view: "nowhere")
        var freeAgent = result
        freeAgent.open = .init(kind: .init(value1: .player, value2: "player"), playerId: 1000)
        #expect(PaletteIndex.opens(try #require(freeAgent.open)))
        group.results = [result] + group.results
        answer.groups = [group] + answer.groups.dropFirst()
        let index = PaletteIndex(registry: registry, catalog: nil, can: can, inspectorShown: false, search: answer)
        #expect(index.served.first?.opens == false)
        let closed = index.served.dropFirst().filter { !$0.opens }
        #expect(closed.isEmpty)
    }

    // MARK: The club owed

    @Test("the club owed after a relaunch is asked from the served sentence, and the report is held until it is answered")
    func owedClub() async throws {
        let server = StubServer()
        try server.answer("listOrgs", fixture: "listOrgs")
        try server.answer("getSettings", fixture: "getSettings")
        let client = PennantClient.make(port: 1, token: String(repeating: "t", count: 64), transport: server)
        let setup = SetupModel(client: { client }, setsUpAutomatically: false)
        #expect(!setup.holdsReport)
        await setup.askOwedClub(.init(text: "You manage 2 clubs in this save. Choose the one to follow.", humanClubs: 2, since: "2040-07-02T10:01:00.000Z"))
        #expect(setup.step == .pickClub)
        #expect(setup.holdsReport)
        #expect(setup.club?.text == "You manage 2 clubs in this save. Choose the one to follow.")
        #expect(setup.club?.decided == false)
        #expect(!setup.clubs.isEmpty)
    }

    @Test("the club card claims no club while the server says the club is owed")
    func owedCard() {
        let owed = PreviewFixtures.ready(clubOwed: .init(text: "You manage 2 clubs in this save. Choose the one to follow.", humanClubs: 2, since: "2040-07-02T10:01:00.000Z"))
        #expect(owed.clubOwed != nil)
        #expect(owed.clubCard == nil)
        #expect(PreviewFixtures.ready().clubCard != nil)
    }
}
