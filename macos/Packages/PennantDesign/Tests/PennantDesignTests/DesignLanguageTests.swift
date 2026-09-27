import PennantAPI
import SwiftUI
import Testing
@testable import PennantDesign

/// The design language's rules that are not pictures (SWIFTUI_REBUILD.md section 3.7): what the palette matches, when
/// a figure earns a ring, how a served tone and a served letter are read, and the masthead's fade.
@MainActor
@Suite("Design language")
struct DesignLanguageTests {
    @Test("the palette matches every word of the query as a prefix, in the title, the group, the line or the keywords")
    func paletteMatching() {
        let entries = DesignFixtures.paletteEntries
        #expect(PaletteEntry.matching("", in: entries).count == entries.count)
        #expect(PaletteEntry.matching("bench", in: entries).map(\.id) == ["majorLeague.benchCoverage"])
        #expect(PaletteEntry.matching("catch", in: entries).map(\.id) == ["majorLeague.benchCoverage"])
        #expect(PaletteEntry.matching("major rep", in: entries).map(\.id) == ["majorLeague.report"])
        #expect(PaletteEntry.matching("xyz", in: entries).isEmpty)
    }

    @Test("a title starting with the query comes first, then a title containing it, then the rest; ties keep the given order")
    func paletteOrder() {
        let entries = DesignFixtures.paletteEntries
        let ids = PaletteEntry.matching("rep", in: entries).map(\.id)
        #expect(ids.prefix(2) == ["frontOffice.report", "majorLeague.report"])
        #expect(ids.contains("frontOffice.morningReport"))
        #expect(ids.firstIndex(of: "frontOffice.morningReport")! > ids.firstIndex(of: "majorLeague.report")!)
    }

    @Test("a figure gets a ring only when its served value has a whole to be a share of; a bare count gets none")
    func figureRing() {
        let card = DesignFixtures.departmentCard
        let forty = Figure(card.figures[1], id: "forty")
        #expect(forty.fraction.map { abs($0 - 39.0 / 40) < 0.0001 } == true)
        let injured = Figure(card.figures[2], id: "injured")
        #expect(injured.fraction == nil)
        let notKnown = Figure(DesignFixtures.claim("Free agents", value: "At least 4", basis: DesignFixtures.basis([])), id: "fa")
        #expect(notKnown.fraction == nil)
        // A range's high end is the end of a range, never a whole: no ring (review B1)
        var ranged = card.figures[2]
        ranged.value = .init(n: 8, unit: .init(value1: .dollars), low: 4, high: 11, display: "$8M")
        #expect(Figure(ranged, id: "ranged").fraction == nil)
    }

    @Test("a range bar's scale is the served one: two ends, low below high, and a value off it is not moved onto it")
    func valueScale() {
        #expect(ValueScale(low: 3, high: 3) == nil)
        #expect(ValueScale(low: 5, high: -5) == nil)
        #expect(ValueScale(low: .nan, high: 1) == nil)
        let scale = ValueScale(low: -5, high: 30)!
        #expect(scale.position(of: -5) == 0)
        #expect(scale.position(of: 30) == 1)
        #expect(scale.position(of: 12.5) == 0.5)
        // Off the scale stays off it (the bar clips it), never clamped onto the end
        #expect(scale.position(of: 37) > 1)
        #expect(scale.position(of: -12) < 0)
    }

    @Test("the art starts past every word and is cleared around the masthead's control (review S2)")
    func artClearance() {
        // The Tonight control at the trailing side of a wide masthead, where the art is
        let control = CGRect(x: 1020, y: 300, width: 260, height: 56)
        let clearance = ArtClearance.resolve(width: 1320, textTrailing: 600, control: control)
        #expect(clearance.start >= MastheadBackground.artStart)
        let clear = try! #require(clearance.clear)
        #expect(clear.contains(control))
        // The feathered edge stays outside the control's own frame
        #expect(clear.insetBy(dx: MastheadBackground.feather * 2, dy: MastheadBackground.feather * 2).contains(control))
        // A headline running past the usual column pushes the art further out
        #expect(ArtClearance.resolve(width: 1320, textTrailing: 900, control: nil).start >= 900 + ArtClearance.margin)
        // No control (or one not laid out) clears nothing
        #expect(ArtClearance.resolve(width: 1320, textTrailing: 0, control: nil).clear == nil)
        #expect(ArtClearance.resolve(width: 1320, textTrailing: 0, control: .zero).clear == nil)
    }

    @Test("a served tone maps to a distinct symbol and reads neutral when unknown to this build")
    func tones() {
        #expect(Set(Tone.allCases.map(\.symbol)).count == Tone.allCases.count)
        #expect(Tone(.init(value1: .bad)) == .bad)
        #expect(Tone(.init(value1: .caution)) == .caution)
        #expect(Tone(.init(value1: nil, value2: "brandNew")) == .neutral)
        #expect(Tone(nil) == .neutral)
    }

    @Test("a served result letter reads W or L and nothing else")
    func results() {
        #expect(GameResult(served: "W") == .win)
        #expect(GameResult(served: "l") == .loss)
        #expect(GameResult(served: "T") == nil)
    }

    @Test("control reads its served words whatever its form")
    func control() {
        #expect(ControlTerm.seasons(3, text: "Through 2043").text == "Through 2043")
        #expect(ControlTerm.clock("Free agent after this season").text == "Free agent after this season")
        #expect(ControlTerm.unknown("Not known: no contract in the export").text == "Not known: no contract in the export")
    }

    @Test("the masthead's fade holds the top colour under the toolbar, then steps towards the club's colour as it clears")
    func fade() {
        let stops = MastheadBackground.fadeStops(top: .white, into: .blue, hold: 0.6)
        #expect(stops.count == 8)
        #expect(stops[0].location == 0 && stops[1].location == 0.6)
        #expect(stops.last?.location == 1)
        let locations = stops.map(\.location)
        #expect(locations == locations.sorted())
    }

    @Test("a neutral palette washes nothing of a club's; a themed one washes its served accent faintly")
    func wash() {
        #expect(Theme.Palette.neutral.wash(.card, in: .light) == Color(nsColor: .quaternarySystemFill))
        let themed = Theme.preview.palette(for: .dark)
        #expect(!themed.isNeutral)
        #expect(themed.wash(.card, in: .dark) == themed.accent.opacity(0.13))
        #expect(themed.wash(.card, in: .light) == themed.accent.opacity(0.07))
    }
}
