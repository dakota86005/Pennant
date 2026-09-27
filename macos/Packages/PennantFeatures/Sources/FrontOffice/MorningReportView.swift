import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

/// The Morning Report (SWIFTUI_REBUILD.md section 3.4) in the design language (section 3.7, R2): the magazine
/// masthead, then the lead column and the side column (stacked below 1080 points). Today the server serves the desk
/// and the department cards (N4), the club's record and how current the report is; the scoreboard's places, run
/// differential, last five, streak, tonight and deadline, the lede, the "since the last export" chips, "How we win
/// and lose", the roster diagram and the wire arrive with N6 and are drawn then. Until then those slots show nothing
/// in the running app; the previews and the snapshots draw them from `DesignFixtures`, so the page can be seen whole.
/// "Whole Desk" (the Front Office's report, where every item waits) is a toolbar item, so nothing floats over content.
public struct MorningReportView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.routeOpener) private var opener

    public init() {}

    /// The Front Office's report: the whole desk.
    static let wholeDesk = AppRoute(department: "frontOffice", view: "report")

    public var body: some View {
        let store = model.frontOffice
        Group {
            if let summary = store.summary {
                MastheadScrollView {
                    MorningReportMasthead(summary: summary, record: model.catalogClub?.record, headline: headline)
                } content: {
                    VStack(alignment: .leading, spacing: 12) {
                        // A reload that failed says so above what is kept, never "refreshing" for ever
                        if let problem = store.summaryProblem { ProblemLine(problem) }
                        MorningReportPage(
                            summary: summary,
                            refreshing: store.loadingSummary
                                || (store.summaryProblem == nil && model.storeKey.map { !store.summaryIsCurrent(for: $0) } ?? false)
                        )
                    }
                    .padding(.horizontal, 28).padding(.top, 24).padding(.bottom, 12)
                }
            } else if let problem = store.summaryProblem {
                ProblemLine(problem).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ProgressView { Text("Loading") }.frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .toolbar {
            if let opener, opener.canOpen(Self.wholeDesk) {
                ToolbarItem(placement: .primaryAction) {
                    Button { opener.open(Self.wholeDesk) } label: {
                        Label("Whole Desk", systemImage: "tray.full")
                    }
                    .help(Text("Every item to decide, from every department"))
                    .accessibilityIdentifier("morningReport.wholeDesk")
                }
                ToolbarSpacer(.fixed, placement: .primaryAction)
            }
        }
        .task(id: model.storeKey) { await model.loadFrontOffice() }
    }

    private var headline: Text {
        model.servedViewName(department: "frontOffice", view: "morningReport").map { Text(verbatim: $0) } ?? Text("Morning Report")
    }
}

/// The slots of the Morning Report the server does not serve yet (N6), for the previews and the snapshots only: the
/// scoreboard and the lede, the chips, "How we win and lose", the roster diagram with its staff, and the wire. The
/// running app never makes one of these; an adapter from the served payload replaces it when N6 serves the slots.
public struct MorningReportDesign {
    public var scoreboard: Scoreboard?
    public var lede: String?
    public var ledeHint: String?
    public var chips: [Chip]?
    public var dimensions: [PlaceDimension]?
    public var placeLines: [PlaceDimension.Group: String]
    /// The note beside "How we win and lose" ("Through July 13 · 89 games"), as served.
    public var placesNote: String?
    public var positions: [RosterPosition]?
    public var rotation: [StaffPitcher]
    public var bullpen: [StaffPitcher]
    public var wire: [WireItem]?

    public init(
        scoreboard: Scoreboard? = nil, lede: String? = nil, ledeHint: String? = nil, chips: [Chip]? = nil,
        dimensions: [PlaceDimension]? = nil, placeLines: [PlaceDimension.Group: String] = [:], placesNote: String? = nil,
        positions: [RosterPosition]? = nil, rotation: [StaffPitcher] = [], bullpen: [StaffPitcher] = [], wire: [WireItem]? = nil
    ) {
        self.scoreboard = scoreboard
        self.lede = lede
        self.ledeHint = ledeHint
        self.chips = chips
        self.dimensions = dimensions
        self.placeLines = placeLines
        self.placesNote = placesNote
        self.positions = positions
        self.rotation = rotation
        self.bullpen = bullpen
        self.wire = wire
    }
}

extension EnvironmentValues {
    /// The unserved slots, drawn only where a preview or a snapshot sets them.
    @Entry public var morningReportDesign: MorningReportDesign? = nil
}

/// The Morning Report's masthead: the club and how current the report is in the kicker, the served headline, the lede
/// once it is served, and the box score: today the served record alone; the places, the run differential, the last
/// five and tonight when N6 serves them.
public struct MorningReportMasthead: View {
    let summary: Components.Schemas.FrontOfficeSummary
    let record: Components.Schemas.Cell?
    let headline: Text
    @Environment(\.morningReportDesign) private var design

    public init(summary: Components.Schemas.FrontOfficeSummary, record: Components.Schemas.Cell?, headline: Text) {
        self.summary = summary
        self.record = record
        self.headline = headline
    }

    public var body: some View {
        ClubMagazineMasthead(
            kicker: [summary.asOf.display],
            kickerHint: summary.asOf.hint,
            headline: headline,
            deckText: design?.lede,
            deckHint: design?.ledeHint
        ) {
            if let scoreboard = design?.scoreboard {
                ScoreboardFigures(scoreboard: scoreboard)
            } else if let record {
                BoxFigure(value: record.display, label: "")
                    .help(record.hint.map { Text(verbatim: $0) } ?? Text(verbatim: record.display))
                    .accessibilityLabel(Text(verbatim: record.hint ?? record.display))
                    .accessibilityIdentifier("masthead.record")
            }
        } control: {
            if let scoreboard = design?.scoreboard, let tonight = scoreboard.tonight {
                TonightControl(tonight: tonight, deadline: scoreboard.deadline) {}
            }
        }
    }
}

/// The scoreboard as the box score: the record with its place, the run differential with its trend, the last five.
public struct ScoreboardFigures: View {
    let scoreboard: Scoreboard

    public init(scoreboard: Scoreboard) {
        self.scoreboard = scoreboard
    }

    public var body: some View {
        let s = scoreboard
        HStack(alignment: .bottom, spacing: 22) {
            ClaimText(s.record) { BoxFigure(value: s.record.value?.display ?? s.record.text, label: s.recordLine) }
            if let runs = s.runs {
                BoxRule()
                ClaimText(runs) {
                    BoxFigure(value: runs.value?.display ?? runs.text, label: s.runsLine ?? runs.text) {
                        if let trend = s.trend { Sparkline(values: trend, label: runs.hint ?? runs.text, height: 30).frame(width: 90) }
                    }
                }
            }
            if let five = s.lastFive, let line = s.lastFiveLine {
                BoxRule()
                VStack(alignment: .leading, spacing: 5) {
                    LastFiveDots(results: five, label: line)
                    Kicker(line, size: .small).fixedSize()
                }
            }
        }
    }
}

/// The page under the masthead: the lead and side columns. With the unserved slots in the environment (a preview or a
/// snapshot) the lead carries the club and the roster and the wire, and the desk sits in the side column as designed;
/// in the running app today the desk leads and the department reports sit beside it.
public struct MorningReportPage: View {
    let summary: Components.Schemas.FrontOfficeSummary
    let refreshing: Bool
    @Environment(\.contentWidth) private var contentWidth
    @Environment(\.morningReportDesign) private var design

    public init(summary: Components.Schemas.FrontOfficeSummary, refreshing: Bool = false) {
        self.summary = summary
        self.refreshing = refreshing
    }

    /// Below this width the two columns stack.
    public static let twoColumns: CGFloat = 1080

    public var body: some View {
        let designed = design?.dimensions != nil || design?.positions != nil || design?.wire != nil
        VStack(alignment: .leading, spacing: 32) {
            if let chips = design?.chips {
                ChipRow(label: Text("Since the last export"), chips: chips)
            }
            if contentWidth >= Self.twoColumns {
                HStack(alignment: .top, spacing: 40) {
                    lead(designed: designed).frame(maxWidth: .infinity, alignment: .leading)
                    side(designed: designed).frame(width: 340)
                }
            } else {
                lead(designed: designed)
                side(designed: designed)
            }
        }
    }

    @ViewBuilder
    private func lead(designed: Bool) -> some View {
        VStack(alignment: .leading, spacing: 36) {
            if let dimensions = design?.dimensions {
                VStack(alignment: .leading, spacing: 8) {
                    MagazineSection(kicker: Text("The club"), title: Text("How we win and lose"), trailing: design?.placesNote)
                    PlaceStrips(dimensions, lines: design?.placeLines ?? [:], wide: false)
                }
            }
            if let positions = design?.positions {
                VStack(alignment: .leading, spacing: 12) {
                    MagazineSection(kicker: Text("The roster"), title: Text("Who we have"))
                    RosterDiagram(positions).frame(height: 540)
                    RosterLegend()
                    HStack(alignment: .top, spacing: 24) {
                        Card { StaffColumn(title: Text("Rotation"), pitchers: design?.rotation ?? []) }
                        Card { StaffColumn(title: Text("Bullpen"), pitchers: design?.bullpen ?? []) }
                    }
                }
            }
            if !designed { desk(compact: false) }
            if let wire = design?.wire {
                VStack(alignment: .leading, spacing: 8) {
                    MagazineSection(kicker: Text("The league"), title: Text("Around the league"))
                    RowGroup {
                        ForEach(wire) { item in
                            WireRow(item)
                            if item.id != wire.last?.id { Divider() }
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func side(designed: Bool) -> some View {
        VStack(alignment: .leading, spacing: 36) {
            if designed { desk(compact: true) }
            departments
        }
    }

    /// The desk: its served title, order and items, each department's "and more" line, and what is missing.
    private func desk(compact: Bool) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            MagazineSection(kicker: Text("To decide"), title: Text(verbatim: summary.desk.title.display), trailing: summary.desk.order.display)
                .help(detail: summary.desk.order.hint)
            if refreshing { ProgressView { Text("Refreshing") }.controlSize(.small) }
            if let incomplete = summary.desk.incomplete {
                ProblemLine(served: incomplete.display, detail: incomplete.hint)
            }
            if let empty = summary.desk.empty {
                Text(verbatim: empty.display).foregroundStyle(.secondary)
            }
            if !summary.desk.items.isEmpty {
                RowGroup {
                    ForEach(Array(summary.desk.items.enumerated()), id: \.element.key) { index, item in
                        DeskItemRow(item, compact: compact)
                        if index < summary.desk.items.count - 1 { Divider() }
                    }
                }
            }
            // The rest of a department's items to decide are in its report
            ForEach(summary.desk.more, id: \.department.rawValue) { more in
                MoreLine(more: more)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: summary.desk.title.display))
        .accessibilityIdentifier("morningReport.desk")
    }

    /// The department reports: a tile for each department with a report, then the rest in one group.
    private var departments: some View {
        let reporting = summary.departments.filter { $0.status.value1 != .notYet }
        let notYet = summary.departments.filter { $0.status.value1 == .notYet }
        return VStack(alignment: .leading, spacing: 12) {
            MagazineSection(kicker: Text("The departments"), title: Text("Department Reports"))
            ForEach(reporting, id: \.department.rawValue) { card in
                DepartmentCardView(card)
            }
            if !notYet.isEmpty {
                RowGroup {
                    ForEach(Array(notYet.enumerated()), id: \.element.department.rawValue) { index, card in
                        DepartmentCardView(card)
                        if index < notYet.count - 1 { Divider() }
                    }
                }
            }
        }
        // A container of the cards, named for VoiceOver (a bare stack is a group with no description)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Department Reports"))
        .accessibilityIdentifier("morningReport.cards")
    }
}

/// "And 4 more in Farm & Development": a link to the department's report when this build has it, else the line alone.
struct MoreLine: View {
    @Environment(\.routeOpener) private var opener
    let more: Components.Schemas.DeskMore

    var body: some View {
        let target = AppRoute(department: DeptID(rawValue: more.department.rawValue), view: more.open.view ?? "report")
        if let opener, opener.canOpen(target) {
            Button { opener.open(target) } label: { Text(verbatim: more.line.display) }
                .buttonStyle(.link)
                .accessibilityIdentifier("desk.more.\(more.department.rawValue)")
        } else {
            Text(verbatim: more.line.display).foregroundStyle(.secondary)
        }
    }
}

#if DEBUG
extension MorningReportDesign {
    /// The unserved slots filled from the made-up fixtures, for the previews and the snapshots.
    public static let fixture = MorningReportDesign(
        scoreboard: DesignFixtures.scoreboard, lede: DesignFixtures.lede, ledeHint: DesignFixtures.ledeHint, chips: DesignFixtures.chips,
        dimensions: DesignFixtures.dimensions, placeLines: DesignFixtures.placeLines, placesNote: DesignFixtures.served("Through July 13 · 89 games"),
        positions: DesignFixtures.positions, rotation: DesignFixtures.rotation, bullpen: DesignFixtures.bullpen, wire: DesignFixtures.wire
    )
}
#endif
