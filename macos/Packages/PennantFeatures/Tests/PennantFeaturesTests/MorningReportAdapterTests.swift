import Foundation
@testable import FrontOffice
import PennantAPI
import PennantDesign
import Shell
import Testing

/// The adapters from the served Morning Report to the design's shapes (N6, Stage B1; SWIFTUI_REBUILD.md section 3.4,
/// "What the Stage B adapters map"), against the payload the real server sent on the synthetic save
/// (`contract/fixtures/responses/getFrontOffice.json`): every sentence and number crosses as served, a part served as
/// null carries its served reason, and nothing is computed or judged on the way.
@Suite("The Morning Report's adapters")
struct MorningReportAdapterTests {
    private func served() throws -> Components.Schemas.FrontOfficeSummary {
        try #require(PreviewFixtures.decode(Components.Schemas.FrontOfficeSummary.self, "getFrontOffice"))
    }

    @Test("the kicker reads the season's facts, not the summary's as-of; the lede is the served claim")
    func kickerAndLede() throws {
        let summary = try served()
        let design = MorningReportDesign(served: summary)
        let season = try #require(summary.teamSeason)
        #expect(design.kicker == [season.kicker.today.display, season.kicker.through.display])
        #expect(design.kickerHint == season.kicker.through.hint)
        #expect(design.club == season.kicker.club?.display)
        #expect(design.lede == summary.lede?.text)
        #expect(design.ledeHint == summary.lede?.hint)
        #expect(design.ledeClaim == summary.lede)
    }

    @Test("the scoreboard carries the record, the place's own claim, the runs with their trend, the last five and the streak, tonight and the deadline")
    func scoreboard() throws {
        let summary = try served()
        let season = try #require(summary.teamSeason)
        let board = try #require(MorningReportDesign(served: summary).scoreboard)
        #expect(board.record == season.record)
        #expect(board.recordLine == season.place?.claim.text)
        #expect(board.placeClaim == season.place?.claim)
        #expect(board.runs == season.runs?.claim)
        #expect(board.runsLine == season.runs?.line.display)
        #expect(board.trend == season.runs?.trend)
        #expect(board.lastFive?.count == season.lastFive?.results.count)
        #expect(board.lastFive == season.lastFive?.results.map { GameResult(served: $0.value1?.rawValue ?? "") })
        #expect(board.lastFiveLine == season.lastFive?.line.display)
        #expect(board.streak == season.streak?.display)
        let tonight = try #require(board.tonight)
        let servedTonight = try #require(season.tonight)
        #expect(tonight.when == servedTonight.when.display)
        #expect(tonight.matchup == servedTonight.matchup.display)
        #expect(tonight.starters == servedTonight.starters.display)
        #expect(tonight.claim == servedTonight.claim)
        #expect(tonight.open == servedTonight.open)
        let deadline = try #require(board.deadline)
        #expect(deadline.count == season.deadline?.count.display)
        #expect(deadline.text == season.deadline?.text.display)
        #expect(deadline.claim == season.deadline?.claim)
        #expect(board.missing.map(\.text) == season.missing.map(\.line.display))
    }

    @Test("a part the export cannot give is its served line, never a blank; a tie is a tie; no record is no scoreboard")
    func missingParts() throws {
        var season = try #require(try served().teamSeason)
        season.runs = nil
        season.tonight = nil
        season.lastFive = .init(results: [.init(value1: .w), .init(value1: .t), .init(value1: .l)], line: .init(display: "Lost 1 · last three 1–1–1"))
        season.missing = [
            .init(part: .init(value1: .runs), line: .init(display: "Runs scored and allowed aren't in the export", hint: "The clubs' season totals")),
            .init(part: .init(value1: .tonight), line: .init(display: "No game is scheduled on or after today")),
        ]
        let board = try #require(MorningReportDesign.scoreboard(season))
        #expect(board.runs == nil && board.runsLine == nil && board.trend == nil && board.tonight == nil)
        #expect(board.lastFive == [.win, .tie, .loss])
        #expect(board.missing.map(\.id) == ["missing:runs", "missing:tonight"])
        #expect(board.missing.map(\.text) == ["Runs scored and allowed aren't in the export", "No game is scheduled on or after today"])
        #expect(board.missing[0].hint == "The clubs' season totals")
        // A letter this build does not draw: no dots at all, never four of five
        season.lastFive = .init(results: [.init(value1: .w), .init(value2: "X")], line: .init(display: "?"))
        #expect(MorningReportDesign.scoreboard(season)?.lastFive == nil)
        // An empty trend is no sparkline
        season.runs = .init(claim: season.record!, line: .init(display: "0 scored · 0 allowed"), scored: 0, allowed: 0, diff: 0, trend: [])
        #expect(MorningReportDesign.scoreboard(season)?.trend == nil)
        // Without a record there is no scoreboard, and the masthead draws the served missing lines instead
        season.record = nil
        #expect(MorningReportDesign.scoreboard(season) == nil)
        var summary = try served()
        summary.teamSeason = season
        let design = MorningReportDesign(served: summary)
        #expect(design.scoreboard == nil)
        #expect(design.mastheadMissing.map(\.text) == ["Runs scored and allowed aren't in the export", "No game is scheduled on or after today"])
    }

    @Test("each dimension crosses with its place, its ties, its recent place and its served words; the groups and the lines as served")
    func dimensions() throws {
        let summary = try served()
        let profile = try #require(summary.clubProfile)
        let design = MorningReportDesign(served: summary)
        let dimensions = try #require(design.dimensions)
        #expect(dimensions.map(\.id) == profile.dimensions.map(\.id))
        for (drawn, served) in zip(dimensions, profile.dimensions) {
            #expect(drawn.name == served.name && drawn.symbol == served.symbol)
            #expect(drawn.place == served.place?.rank)
            #expect(drawn.of == served.place?.of)
            #expect(drawn.tiedWith == served.place?.tiedWith)
            #expect(drawn.recentPlace == served.recent.place?.rank)
            #expect(drawn.placeText == served.placeText)
            #expect(drawn.recentText == served.recent.text)
            #expect(drawn.group.rawValue == served.group.value1?.rawValue)
            #expect(drawn.claim == served.claim)
        }
        #expect(design.placeLines[.strength] == profile.lines.strength.display)
        #expect(design.placeLines[.notPlaced] == profile.lines.notPlaced.display)
        #expect(design.placeLines.count == 5)
        #expect(design.placesNote == profile.note.display)
        #expect(design.placesUnavailable == nil)
    }

    @Test("a dimension too early or not placed keeps no place, takes the league's size from the others, and is never a weakness")
    func notPlaced() throws {
        var profile = try #require(try served().clubProfile)
        var early = profile.dimensions[0]
        early.place = nil
        early.recent = .init(place: nil, text: "Fewer than 20 games", why: "Too early")
        early.group = .init(value1: .tooEarly)
        early.placeText = "Too early"
        var missing = profile.dimensions[1]
        missing.place = nil
        missing.recent = .init(place: nil, text: "Last 15: not placed", why: "The export lacks the figure")
        missing.group = .init(value1: .notPlaced)
        missing.placeText = "Not placed"
        var newer = profile.dimensions[2]
        newer.group = .init(value2: "somethingNewer")
        profile.dimensions = [early, missing, newer]
        let drawn = MorningReportDesign.dimensions(profile)
        #expect(drawn[0].place == nil && drawn[0].recentPlace == nil && drawn[0].group == .tooEarly)
        #expect(drawn[1].place == nil && drawn[1].group == .notPlaced && drawn[1].placeText == "Not placed")
        // The size of the league is the served count on the sibling that has one (4 clubs on the synthetic save)
        #expect(drawn[0].of == 4 && drawn[1].of == 4)
        // A group this build has not heard of reads as the rest, never a weakness
        #expect(drawn[2].group == .rest)
        // Nothing placed anywhere: no size at all (the strip draws no dots)
        profile.dimensions = [early, missing]
        #expect(MorningReportDesign.dimensions(profile).map(\.of) == [0, 0])
    }

    @Test("each node crosses with its holder, its expected wins, its place, how it reads against the other clubs, who is behind, the farm and control")
    func positions() throws {
        let summary = try served()
        let map = try #require(summary.rosterMap)
        let design = MorningReportDesign(served: summary)
        let positions = try #require(design.positions)
        #expect(positions.map(\.id) == map.positions.map(\.pos))
        for (drawn, node) in zip(positions, map.positions) {
            #expect(drawn.name == node.name)
            #expect(drawn.holder == (node.holder?.short ?? node.claim.text))
            #expect(drawn.value?.likely == node.value?.likely)
            #expect(drawn.value?.text == node.value?.text)
            #expect(drawn.value?.short == node.value?.short)
            #expect(drawn.valueText == node.valueText)
            #expect(drawn.placeText == node.placeText)
            #expect(drawn.overlapText == node.overlapText.display)
            #expect(drawn.overlapHint == node.overlapText.hint)
            #expect(drawn.behind == node.behind.display)
            #expect(drawn.farmNext == (node.farmNext?.text ?? node.farmText.display))
            #expect(drawn.need == node.need)
            #expect(drawn.claim == node.claim)
            #expect(drawn.control.text == node.control.text)
            #expect(drawn.holderRule?.rawValue == node.holderRule?.value1?.rawValue)
        }
        // The synthetic save's holders are the listed men (its game log shows no starts), and the map says so
        #expect(positions.contains { $0.holderRule == .listed })
        #expect(design.rosterNotes.map(\.text) == map.notes.map(\.display))
        // The scale is the served one, in wins
        let scale = try #require(design.valueScale)
        #expect(scale.low == map.valueScale?.low && scale.high == map.valueScale?.high)
        #expect(map.valueScale?.unit.value1 == .wins)
        // Nobody at a position: the served sentence, a hatched bar (no value), a served "Not placed", control as served
        let nobody = try #require(positions.first { $0.id == "RF" })
        #expect(nobody.value == nil && nobody.valueText == "Not valued" && nobody.placeText == "Not placed")
        #expect(nobody.holder == "Nobody at right field")
        #expect(nobody.control == .unknown("Nobody there"))
        #expect(nobody.holderRule == nil)
    }

    @Test("control crosses as served: seasons through a year with the served count, a clock, or not known; a kind this build has not heard of is not known")
    func control() {
        let through = Components.Schemas.ControlTerm(kind: .init(value1: .through), text: "Through 2046 at least", hint: "Held on every branch", through: 2046, latest: nil, seasonsLeft: 7, atLeast: true, clock: nil)
        #expect(MorningReportDesign.control(through) == .seasons(7, text: "Through 2046 at least"))
        var noCount = through
        noCount.seasonsLeft = nil
        #expect(MorningReportDesign.control(noCount) == .seasons(0, text: "Through 2046 at least"))
        let clock = Components.Schemas.ControlTerm(kind: .init(value1: .clock), text: "Arbitration this winter", hint: "", through: nil, latest: nil, seasonsLeft: nil, atLeast: false, clock: .init(value1: .arbitration))
        #expect(MorningReportDesign.control(clock) == .clock("Arbitration this winter"))
        let unknown = Components.Schemas.ControlTerm(kind: .init(value1: .unknown), text: "Control not known", hint: "", through: nil, latest: nil, seasonsLeft: nil, atLeast: false, clock: nil)
        #expect(MorningReportDesign.control(unknown) == .unknown("Control not known"))
        let newer = Components.Schemas.ControlTerm(kind: .init(value2: "lease"), text: "On loan", hint: "", through: nil, latest: nil, seasonsLeft: nil, atLeast: false, clock: nil)
        #expect(MorningReportDesign.control(newer) == .unknown("On loan"))
    }

    @Test("the farm's next man's bar crosses only when Player Development serves both numbers, with its served words")
    func farmBar() throws {
        var node = try #require(try served().rosterMap?.positions.first)
        #expect(MorningReportDesign.position(node).farmBar == nil)
        node.farmNext = .init(playerId: 9, name: "L Moreau", short: "L. Moreau", level: "Triple-A", state: .init(value1: .notYet),
                              readiness: .init(display: "Not ready yet", hint: "His bat is behind the bar"), bar: .init(readiness: 41, required: 55), text: "L. Moreau · Triple-A · not ready yet")
        let drawn = MorningReportDesign.position(node)
        #expect(drawn.farmNext == "L. Moreau · Triple-A · not ready yet")
        #expect(drawn.farmBar == FarmBar(readiness: 41, required: 55, text: "Not ready yet", hint: "His bat is behind the bar"))
        node.farmNext?.bar = nil
        #expect(MorningReportDesign.position(node).farmBar == nil)
    }

    @Test("the staff crosses with each pitcher's served role, line, range, note, need and claim, and the needs at the roles as served lines")
    func staff() throws {
        var summary = try served()
        var map = try #require(summary.rosterMap)
        map.rotationNeeds = [.init(display: "A fifth starter until the rehab ends", hint: "Raised by the bench coach")]
        map.bullpenNeeds = [.init(display: "A second left-hander")]
        map.unavailable = nil
        summary.rosterMap = map
        let design = MorningReportDesign(served: summary)
        #expect(design.rotation.map(\.id) == map.rotation.map { String($0.playerId) })
        #expect(design.bullpen.map(\.id) == map.bullpen.map { String($0.playerId) })
        for (drawn, served) in zip(design.rotation + design.bullpen, map.rotation + map.bullpen) {
            #expect(drawn.role == served.role && drawn.name == served.short && drawn.line == served.line.display)
            #expect(drawn.value?.likely == served.value?.likely)
            #expect(drawn.note == served.note?.display)
            #expect(drawn.hint == served.hint && drawn.need == served.need && drawn.claim == served.claim)
        }
        #expect(design.rotation.first?.note == "Next game")
        #expect(design.rotationNeeds == [ServedLine(id: "rotation:0", text: "A fifth starter until the rehab ends", hint: "Raised by the bench coach")])
        #expect(design.bullpenNeeds == [ServedLine(id: "bullpen:0", text: "A second left-hander", hint: nil)])
        #expect(design.rosterUnavailable == nil)
    }

    @Test("a part the server did not build draws nothing, and a part it could not read carries its served reason")
    func absentParts() throws {
        var summary = try served()
        summary.teamSeason = nil
        summary.lede = nil
        summary.clubProfile = nil
        summary.rosterMap = nil
        let empty = MorningReportDesign(served: summary)
        #expect(empty.kicker == nil && empty.scoreboard == nil && empty.mastheadMissing.isEmpty && empty.lede == nil)
        #expect(empty.dimensions == nil && empty.positions == nil && empty.valueScale == nil)
        #expect(empty.rotation.isEmpty && empty.bullpen.isEmpty && empty.chips == nil && empty.wire == nil)
        var unread = try served()
        unread.clubProfile?.unavailable = .init(display: "The clubs' totals could not be read this time")
        unread.rosterMap?.unavailable = .init(display: "Player Value could not be read this time", hint: "The log has the detail")
        unread.rosterMap?.valueScale = nil
        let design = MorningReportDesign(served: unread)
        #expect(design.placesUnavailable?.text == "The clubs' totals could not be read this time")
        #expect(design.rosterUnavailable == ServedLine(id: "roster", text: "Player Value could not be read this time", hint: "The log has the detail"))
        // No scale: no diagram (the positions are kept for their notes; the view draws none without a scale)
        #expect(design.valueScale == nil)
        #expect(design.positions != nil)
    }
}
