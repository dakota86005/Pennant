import PennantAPI
import PennantDesign
import SwiftUI

/// The Morning Report's slots in the design's shapes (SWIFTUI_REBUILD.md section 3.4): the scoreboard and the lede,
/// the chips, "How we win and lose", the roster diagram with its staff, and the wire. In the running app they are
/// mapped from the served payload by `MorningReportDesign(served:)` (N6, Stage B1); a preview or a snapshot may set one
/// in the environment (`\.morningReportDesign`) from `DesignFixtures` instead. A slot the server does not serve yet
/// (the chips, the wire: N7) is nil and draws nothing.
public struct MorningReportDesign {
    /// The kicker's served parts after the club (the league's day, "Through …"); nil until the season's facts are served.
    public var kicker: [String?]?
    public var kickerHint: String?
    /// The club's name as the payload's kicker serves it; nil when the payload serves none.
    public var club: String?
    public var scoreboard: Scoreboard?
    /// The masthead's parts the export could not give, when there is no scoreboard at all (no record): each line says why.
    public var mastheadMissing: [ServedLine]
    public var lede: String?
    public var ledeHint: String?
    /// The lede as a claim, so the deck opens its basis; nil when not served.
    public var ledeClaim: Components.Schemas.Claim?
    public var chips: [Chip]?
    public var dimensions: [PlaceDimension]?
    /// Each group's heading as served (its title, and the policy line beside it where there is one).
    public var placeHeadings: [PlaceDimension.Group: PlaceDimension.Heading]
    /// The legend under the strips as served (the shaded ends' entry only where a strip shows them); nil draws none.
    public var placeLegend: Components.Schemas.ProfileLegend?
    /// The note beside "How we win and lose" ("Through July 13 · 89 games"), as served, with its help tag.
    public var placesNote: String?
    public var placesNoteHint: String?
    /// Why "How we win and lose" could not be read this time, as served; nil when it was.
    public var placesUnavailable: ServedLine?
    public var positions: [RosterPosition]?
    /// The scale the diagram's range bars share, served with the positions; no diagram without it.
    public var valueScale: ValueScale?
    public var rotation: [StaffPitcher]
    public var bullpen: [StaffPitcher]
    /// Major League Ops' needs at the staff's roles that name no pitcher shown, in its served words.
    public var rotationNeeds: [ServedLine]
    public var bullpenNeeds: [ServedLine]
    /// What the map says about itself ("The league plays without a designated hitter"), as served.
    public var rosterNotes: [ServedLine]
    /// Why the roster map could not be read this time, as served; nil when it was.
    public var rosterUnavailable: ServedLine?
    public var wire: [WireItem]?

    public init(
        kicker: [String?]? = nil, kickerHint: String? = nil, club: String? = nil,
        scoreboard: Scoreboard? = nil, mastheadMissing: [ServedLine] = [],
        lede: String? = nil, ledeHint: String? = nil, ledeClaim: Components.Schemas.Claim? = nil, chips: [Chip]? = nil,
        dimensions: [PlaceDimension]? = nil, placeHeadings: [PlaceDimension.Group: PlaceDimension.Heading] = [:],
        placeLegend: Components.Schemas.ProfileLegend? = nil, placesNote: String? = nil,
        placesUnavailable: ServedLine? = nil,
        positions: [RosterPosition]? = nil, valueScale: ValueScale? = nil, rotation: [StaffPitcher] = [], bullpen: [StaffPitcher] = [],
        rotationNeeds: [ServedLine] = [], bullpenNeeds: [ServedLine] = [], rosterNotes: [ServedLine] = [], rosterUnavailable: ServedLine? = nil,
        wire: [WireItem]? = nil
    ) {
        self.kicker = kicker
        self.kickerHint = kickerHint
        self.club = club
        self.scoreboard = scoreboard
        self.mastheadMissing = mastheadMissing
        self.lede = lede
        self.ledeHint = ledeHint
        self.ledeClaim = ledeClaim
        self.chips = chips
        self.dimensions = dimensions
        self.placeHeadings = placeHeadings
        self.placeLegend = placeLegend
        self.placesNote = placesNote
        self.placesUnavailable = placesUnavailable
        self.positions = positions
        self.valueScale = valueScale
        self.rotation = rotation
        self.bullpen = bullpen
        self.rotationNeeds = rotationNeeds
        self.bullpenNeeds = bullpenNeeds
        self.rosterNotes = rosterNotes
        self.rosterUnavailable = rosterUnavailable
        self.wire = wire
    }
}

extension EnvironmentValues {
    /// The slots as a preview or a snapshot sets them from the fixtures; nil in the running app, which maps the served
    /// payload.
    @Entry public var morningReportDesign: MorningReportDesign? = nil
}

// MARK: The adapters (SWIFTUI_REBUILD.md section 3.4, "What the Stage B adapters map")

/// The served payload mapped into the design's shapes: pure functions, one place, tested against the committed fixture
/// (`MorningReportAdapterTests`). Every sentence and number crosses as served; nothing is computed, ranked or judged
/// here, and a part the server serves as null carries its served reason (a missing line, a served "Not placed", a
/// hatched bar with its sentence), never a blank or a placeholder number.
extension MorningReportDesign {
    public init(served summary: Components.Schemas.FrontOfficeSummary) {
        self.init()
        if let season = summary.teamSeason {
            kicker = [season.kicker.today.display, season.kicker.through.display]
            // Each part's served help tag: the league's day, then how current the export is
            let hints = [season.kicker.today.hint, season.kicker.through.hint].compactMap { $0 }.filter { !$0.isEmpty }
            kickerHint = hints.isEmpty ? nil : hints.joined(separator: "\n")
            club = season.kicker.club?.display
            scoreboard = Self.scoreboard(season)
            if scoreboard == nil { mastheadMissing = Self.missing(season) }
        }
        if let lede = summary.lede {
            self.lede = lede.text
            ledeHint = lede.hint
            ledeClaim = lede
        }
        if let profile = summary.clubProfile {
            dimensions = Self.dimensions(profile)
            placeHeadings = Self.headings(profile.groups)
            placeLegend = profile.legend
            placesNote = profile.note.display
            placesNoteHint = profile.note.hint
            placesUnavailable = profile.unavailable.map { ServedLine(id: "profile", text: $0.display, hint: $0.hint) }
        }
        if let map = summary.rosterMap {
            positions = map.positions.map(Self.position)
            valueScale = map.valueScale.flatMap { ValueScale(low: $0.low, high: $0.high) }
            rotation = map.rotation.map(Self.pitcher)
            bullpen = map.bullpen.map(Self.pitcher)
            rotationNeeds = Self.lines(map.rotationNeeds, prefix: "rotation")
            bullpenNeeds = Self.lines(map.bullpenNeeds, prefix: "bullpen")
            rosterNotes = Self.lines(map.notes, prefix: "note")
            rosterUnavailable = map.unavailable.map { ServedLine(id: "roster", text: $0.display, hint: $0.hint) }
        }
    }

    /// Served cells as lines, each with an id of the caller's prefix and its place (or the ids given).
    nonisolated static func lines(_ cells: [Components.Schemas.Cell], prefix: String, ids: [String]? = nil) -> [ServedLine] {
        cells.enumerated().map { index, cell in
            ServedLine(id: "\(prefix):\(ids?[index] ?? String(index))", text: cell.display, hint: cell.hint)
        }
    }

    // MARK: The masthead

    /// The box score: nil without a record (the served missing lines say why); otherwise every served part, and a
    /// missing line for each part the export could not give.
    nonisolated static func scoreboard(_ season: Components.Schemas.TeamSeason) -> Scoreboard? {
        guard let record = season.record else { return nil }
        return Scoreboard(
            record: record,
            recordLine: season.place?.claim.text ?? "",
            runs: season.runs?.claim,
            runsLine: season.runs?.line.display,
            trend: season.runs.flatMap { $0.trend.isEmpty ? nil : $0.trend },
            lastFive: season.lastFive.flatMap(lastFive),
            lastFiveLine: season.lastFive?.line.display,
            tonight: season.tonight.map(tonight),
            deadline: season.deadline.map { DeadlineNote(count: $0.count.display, text: $0.text.display, claim: $0.claim) },
            placeClaim: season.place?.claim,
            streak: season.streak?.display,
            streakHint: season.streak?.hint,
            missing: missing(season)
        )
    }

    /// Each part of the box score the export could not give, with its served sentence.
    nonisolated static func missing(_ season: Components.Schemas.TeamSeason) -> [ServedLine] {
        lines(season.missing.map(\.line), prefix: "missing", ids: season.missing.map { $0.part.value1?.rawValue ?? $0.part.value2 ?? "part" })
    }

    /// The last five as served letters; nil when a letter is not one this build draws (a newer server's), since four
    /// dots would read as four games.
    nonisolated static func lastFive(_ served: Components.Schemas.LastFive) -> [GameResult]? {
        let results = served.results.compactMap { GameResult(served: $0.value1?.rawValue ?? $0.value2 ?? "") }
        return results.count == served.results.count ? results : nil
    }

    nonisolated static func tonight(_ served: Components.Schemas.TonightGame) -> TonightGame {
        TonightGame(
            when: served.when.display, matchup: served.matchup.display, starters: served.starters.display,
            hint: served.claim.hint ?? served.claim.text, claim: served.claim, open: served.open
        )
    }

    // MARK: How we win and lose

    /// Each dimension as served, on the strip the server serves for it: its clubs (0 draws an empty track and no dots)
    /// and where the stated lines fall (none in a league too small to have a top or bottom fifth). Nothing is counted
    /// or borrowed from a sibling here.
    nonisolated static func dimensions(_ profile: Components.Schemas.ClubProfile) -> [PlaceDimension] {
        profile.dimensions.map { served in
            PlaceDimension(
                id: served.id, name: served.name, symbol: served.symbol,
                place: served.place?.rank,
                of: served.strip.of,
                strengthThrough: served.strip.strengthThrough,
                weaknessFrom: served.strip.weaknessFrom,
                tiedWith: served.place?.tiedWith ?? 0,
                recentPlace: served.recent.place?.rank,
                placeText: served.placeText, recentText: served.recent.text,
                group: group(served.group), claim: served.claim,
                detail: served.detail.display, detailHint: served.detail.hint, recentWhy: served.recent.why
            )
        }
    }

    /// A served group as the design's; one this build has not heard of reads as the rest (quiet), never a weakness.
    nonisolated static func group(_ served: Components.Schemas.ProfileGroup) -> PlaceDimension.Group {
        switch served.value1 {
        case .strength: .strength
        case .weakness: .weakness
        case .rest: .rest
        case .tooEarly: .tooEarly
        case .notPlaced: .notPlaced
        case nil: .rest
        }
    }

    /// Each group's served heading: its title and, where served, its line, each with its help tag.
    nonisolated static func headings(_ groups: Components.Schemas.ProfileGroups) -> [PlaceDimension.Group: PlaceDimension.Heading] {
        let heading = { (served: Components.Schemas.ProfileGroupHeading) in
            PlaceDimension.Heading(title: served.title.display, titleHint: served.title.hint, line: served.line?.display, lineHint: served.line?.hint)
        }
        return [
            .strength: heading(groups.strength), .weakness: heading(groups.weakness), .rest: heading(groups.rest),
            .tooEarly: heading(groups.tooEarly), .notPlaced: heading(groups.notPlaced),
        ]
    }

    // MARK: The roster map

    nonisolated static func position(_ node: Components.Schemas.RosterNode) -> RosterPosition {
        RosterPosition(
            id: node.pos,
            holder: node.holder?.short ?? node.claim.text,
            value: node.value.map(value),
            valueText: node.valueText,
            placeText: node.placeText,
            behind: node.behind.display,
            farmNext: node.farmNext?.text ?? node.farmText.display,
            control: control(node.control),
            need: node.need,
            claim: node.claim,
            name: node.name,
            overlapText: node.overlapText.display,
            overlapHint: node.overlapText.hint,
            holderRule: holderRule(node.holderRule),
            farmBar: node.farmNext.flatMap { next in
                next.bar.map {
                    FarmBar(readiness: $0.readiness, required: $0.required, scaleLow: $0.scale.low, scaleHigh: $0.scale.high,
                            line: $0.line.display, lineHint: $0.line.hint, text: next.readiness.display, hint: next.readiness.hint)
                }
            },
            controlHint: node.control.hint
        )
    }

    nonisolated static func value(_ served: Components.Schemas.WinsValue) -> ValueRange {
        ValueRange(low: served.low, likely: served.likely, high: served.high, text: served.text, short: served.short)
    }

    /// Control as served: seasons through a year (the served count of seasons left, or none served: drawn as not
    /// known, never as no seasons), a clock, or not known. A kind this build has not heard of reads as not known, with
    /// its served words.
    nonisolated static func control(_ served: Components.Schemas.ControlTerm) -> ControlTerm {
        switch served.kind.value1 {
        case .through: .seasons(served.seasonsLeft, text: served.text)
        case .clock: .clock(served.text)
        case .unknown, nil: .unknown(served.text)
        }
    }

    nonisolated static func holderRule(_ served: Components.Schemas.HolderRule?) -> HolderRule? {
        switch served?.value1 {
        case .starts: .starts
        case .listed: .listed
        case nil: nil
        }
    }

    nonisolated static func pitcher(_ served: Components.Schemas.StaffPitcher) -> StaffPitcher {
        StaffPitcher(
            id: String(served.playerId), role: served.role, name: served.short, line: served.line.display,
            value: served.value.map(value), note: served.note?.display, hint: served.hint, need: served.need, claim: served.claim
        )
    }
}

#if DEBUG
extension MorningReportDesign {
    /// The slots filled from the made-up fixtures, for the previews and the snapshots.
    public static let fixture = MorningReportDesign(
        kicker: Array(DesignFixtures.kicker.dropFirst()), club: DesignFixtures.kicker.first ?? nil,
        scoreboard: DesignFixtures.scoreboard, lede: DesignFixtures.lede, ledeHint: DesignFixtures.ledeHint, chips: DesignFixtures.chips,
        dimensions: DesignFixtures.dimensions, placeHeadings: DesignFixtures.placeHeadings, placeLegend: DesignFixtures.placeLegend,
        placesNote: DesignFixtures.served("Through July 13 · 89 games"),
        positions: DesignFixtures.positions, valueScale: DesignFixtures.valueScale, rotation: DesignFixtures.rotation, bullpen: DesignFixtures.bullpen,
        rotationNeeds: DesignFixtures.rotationNeeds, bullpenNeeds: DesignFixtures.bullpenNeeds, rosterNotes: DesignFixtures.rosterNotes,
        wire: DesignFixtures.wire
    )

    /// The fixture with the mismatches Stage B closed drawn: a tie in the last five, parts the export could not give,
    /// a dimension not placed, a listed holder (in the positions already), the staff's needs.
    public static let fixtureEdges: MorningReportDesign = {
        var design = fixture
        design.scoreboard = DesignFixtures.scoreboardWithTieAndMissing
        design.dimensions = DesignFixtures.dimensions + [DesignFixtures.tooEarly, DesignFixtures.notPlaced]
        return design
    }()

    /// No game served: the deadline stands alone in the box score; and a last five this build cannot draw (a letter it
    /// does not know), so the served line stands without dots.
    public static let fixtureNoGame: MorningReportDesign = {
        var design = fixture
        design.scoreboard?.tonight = nil
        design.scoreboard?.lastFive = nil
        return design
    }()
}
#endif
