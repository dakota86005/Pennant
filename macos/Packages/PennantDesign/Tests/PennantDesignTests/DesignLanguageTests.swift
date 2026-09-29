import PennantAPI
import SwiftUI
import Testing
@testable import PennantDesign

/// The design language's rules that are not pictures (SWIFTUI_REBUILD.md section 3.7): what the palette matches, when
/// a figure earns a ring, how a served tone and a served letter are read, and the masthead's fade.
@MainActor
@Suite("Design language")
struct DesignLanguageTests {
    @Test("the masthead's colour runs under the toolbar at rest; once anything scrolls under it, the toolbar's background and the soft edge come back (N6 polish review)")
    func mastheadUnderTheToolbar() {
        // At rest (the offset is minus the top inset), and pulled down by a rubber band: nothing under the toolbar
        #expect(!MastheadToolbar.scrolledUnder(offset: -52, topInset: 52))
        #expect(!MastheadToolbar.scrolledUnder(offset: -80, topInset: 52))
        #expect(!MastheadToolbar.scrolledUnder(offset: -51.8, topInset: 52))
        #expect(MastheadToolbar.background(underToolbar: false) == .hidden)
        // Scrolled by a point or more: the system's background (the soft scroll edge) over what passes beneath
        #expect(MastheadToolbar.scrolledUnder(offset: -51, topInset: 52))
        #expect(MastheadToolbar.scrolledUnder(offset: 400, topInset: 52))
        #expect(MastheadToolbar.background(underToolbar: true) == .automatic)
        // No toolbar above (a preview): at rest at zero
        #expect(!MastheadToolbar.scrolledUnder(offset: 0, topInset: 0))
    }

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

    @Test("a tie shares the size: every club tied with ours is drawn at our size (review S6)")
    func tiesShareTheSize() {
        // "T-26th of 30" with two others on the same figure
        let bullpen = try! #require(DesignFixtures.dimensions.first { $0.tiedWith == 2 })
        let dots = PlaceStrip.dots(bullpen)
        let place = try! #require(bullpen.place)
        let club = try! #require(dots.first { $0.kind == .club })
        #expect(club.place == place)
        let tied = dots.filter { $0.kind == .tied }
        #expect(tied.map(\.place) == [place + 1, place + 2])
        #expect(tied.allSatisfy { $0.scale == club.scale })
        #expect(club.scale > 1)
        #expect(dots.filter { $0.kind == .other }.allSatisfy { $0.scale == 1 })
        // Too early: no club dot, nothing tied, every dot plain
        #expect(PlaceStrip.dots(DesignFixtures.tooEarly).allSatisfy { $0.kind == .other && $0.scale == 1 })
    }

    @Test("control pips draw exactly the served seasons: none for none, never an invented pip (review S7)")
    func controlPips() {
        #expect(ControlPips.seasonPips(.seasons(3, text: "Through 2043")) == 3)
        #expect(ControlPips.seasonPips(.seasons(1, text: "Through 2041")) == 1)
        #expect(ControlPips.seasonPips(.seasons(0, text: "Free agent after this season")) == 0)
        #expect(ControlPips.seasonPips(.seasons(-1, text: "x")) == 0)
        #expect(ControlPips.seasonPips(.clock("Arbitration this winter")) == 0)
    }

    @Test("Space opens a focused claim's basis, as the design says (review nit)")
    func spaceOpensTheBasis() {
        #expect(ClaimText<Text, EmptyView>.basisKey == .space)
    }

    @Test("a served tone maps to a distinct symbol and reads neutral when unknown to this build")
    func tones() {
        #expect(Set(Tone.allCases.map(\.symbol)).count == Tone.allCases.count)
        #expect(Tone(.init(value1: .bad)) == .bad)
        #expect(Tone(.init(value1: .caution)) == .caution)
        #expect(Tone(.init(value1: nil, value2: "brandNew")) == .neutral)
        #expect(Tone(nil) == .neutral)
    }

    @Test("a served result letter reads W, L or T (a tie) and nothing else")
    func results() {
        #expect(GameResult(served: "W") == .win)
        #expect(GameResult(served: "l") == .loss)
        #expect(GameResult(served: "T") == .tie)
        #expect(GameResult(served: "X") == nil)
    }

    @Test("a dimension not placed draws no dot of its own and no ring, and a league of unknown size draws no dots at all")
    func notPlacedStrip() {
        let notPlaced = DesignFixtures.notPlaced
        #expect(notPlaced.group == .notPlaced)
        let dots = PlaceStrip.dots(notPlaced)
        #expect(dots.count == 30)
        #expect(dots.allSatisfy { $0.kind == .other && !$0.recent })
        var unsized = notPlaced
        unsized.of = 0
        #expect(PlaceStrip.dots(unsized).isEmpty)
        // A tie shares the club's size, still
        let tied = DesignFixtures.dimensions.first { $0.tiedWith > 0 }!
        #expect(PlaceStrip.dots(tied).filter { $0.kind == .tied }.count == tied.tiedWith)
    }

    @Test("the roster diagram's unit is expected wins: the fixtures' ranges, scale and legend say wins, never dollars")
    func winsNotDollars() {
        for position in DesignFixtures.positions {
            if let value = position.value {
                #expect(value.text.contains("wins") && !value.text.contains("$"))
                #expect(value.short.hasSuffix("wins"))
            }
        }
        #expect(DesignFixtures.rosterLegend.range.display.contains("expected wins"))
        #expect(DesignFixtures.valueScale.low <= 0 && DesignFixtures.valueScale.high > 0)
        // A holder merely listed says so; the farm's bar rides with its served words
        #expect(DesignFixtures.positions.contains { $0.holderRule == .listed })
        #expect(DesignFixtures.positions.first { $0.id == "C" }?.farmBar == DesignFixtures.farmBar(41, 55, text: "Not ready yet", hint: "Player Development: his bat is behind the bar for Triple-A"))
    }

    @Test("the farm's bar is drawn on its served scale: a man past his bar is past the line, never a full bar (review)")
    func farmBarScale() {
        let past = DesignFixtures.farmBar(88, 76, text: "Ready for a look")
        #expect(past.position(of: past.readiness) == 0.88)
        #expect(past.position(of: past.required) == 0.76)
        #expect(past.position(of: 140) == 1 && past.position(of: -5) == 0)
        #expect(past.line == "Readiness 88 · his bar 76")
    }

    @Test("a strip shades only where the server says the lines fall, and nothing in a league without fifths (review M1)")
    func shading() {
        let placed = DesignFixtures.dimensions[0]
        #expect(PlaceStrip.shading(placed).strength == 1...6)
        #expect(PlaceStrip.shading(placed).weakness == 25...30)
        var small = placed
        small.of = 4
        small.strengthThrough = nil
        small.weaknessFrom = nil
        #expect(PlaceStrip.shading(small).strength == nil && PlaceStrip.shading(small).weakness == nil)
        #expect(PlaceStrip.dots(small).count == 4)
    }

    @Test("control reads its served words whatever its form; seasons with no served count are not known, never none (review H2)")
    func control() {
        #expect(ControlTerm.seasons(3, text: "Through 2043").text == "Through 2043")
        #expect(ControlPips.seasonPips(.seasons(3, text: "Through 2043")) == 3)
        #expect(ControlPips.seasonPips(.seasons(nil, text: "Through 2043")) == nil)
        #expect(ControlPips.seasonPips(.seasons(0, text: "Through 2041")) == 0)
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
