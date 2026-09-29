import AppKit
import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

/// The Morning Report (SWIFTUI_REBUILD.md section 3.4) in the design language (section 3.7, R2): the magazine
/// masthead, then the lead column and the side column (stacked below 1080 points). The server serves the desk and the
/// department cards (N4), the masthead's box score, the lede, "How we win and lose" and the roster map with its staff
/// (N6, Stage A), each mapped into the design's shapes by `MorningReportDesign(served:)` (Stage B1); the "since the last
/// export" chips and the wire arrive with N7 and show nothing until then. The previews and the snapshots may draw the
/// slots from `DesignFixtures` instead (`\.morningReportDesign`).
///
/// At launch the report the app kept from the last launch for this save and club is drawn at once and said to be
/// updating in the kicker (its own served kicker says how current it is); the fresh one replaces it in place, without
/// a flash (the rows keep their identity, the figures roll unless Reduce Motion is on). "Whole Desk" (the Front
/// Office's report, where every item waits) is a toolbar item, so nothing floats over content.
public struct MorningReportView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.routeOpener) private var opener
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// The served "Just updated" line is in the kicker (for a few seconds after an import lands while the GM reads).
    @State private var showsUpdated = false
    /// Moves each time an import lands in place, so the line's timer starts again.
    @State private var updatedMoment = 0

    public init() {}

    /// The Front Office's report: the whole desk.
    static let wholeDesk = AppRoute(department: "frontOffice", view: "report")
    /// How long the served "Just updated" line stays in the kicker before it fades.
    static let updatedFor: Duration = .seconds(4)

    /// The served "Just updated" line, only when it is about the import the report shown was built from (its
    /// `importStamp`): never over a report from another import, or before the data status has caught up.
    public static func landedLine(
        _ status: Components.Schemas.DataStatusView?, for summary: Components.Schemas.FrontOfficeSummary
    ) -> Components.Schemas.ImportLandedLine? {
        guard let line = status?.updated, let stamp = summary.importStamp, line.importStamp == stamp else { return nil }
        return line
    }

    public var body: some View {
        let store = model.frontOffice
        Group {
            if let summary = store.summary {
                // Never "Updating" while a reload has failed: the problem line says so instead
                let updating = store.showsUpdating(for: model.storeKey)
                MastheadScrollView {
                    MorningReportMasthead(
                        summary: summary, record: model.catalogClub?.record, headline: headline, updating: updating,
                        updated: showsUpdated && !updating ? Self.landedLine(model.dataStatus, for: summary) : nil
                    )
                } content: {
                    VStack(alignment: .leading, spacing: 12) {
                        // A reload that failed says so above what is kept, never "updating" for ever
                        if let problem = store.summaryProblem { ProblemLine(problem) }
                        MorningReportPage(summary: summary)
                    }
                    .padding(.horizontal, 28).padding(.top, 24).padding(.bottom, 12)
                }
                .onAppear {
                    // Timed once the frame holding it is committed to the screen, not when the view is made
                    let kept = store.summaryIsKept
                    AfterNextFrame.run { model.noteMorningReportDrawn(kept: kept) }
                }
                // An import landed while the GM reads: the report was swapped in place, and the kicker says so in the
                // server's words for a moment, then fades (no fade with Reduce Motion)
                .onChange(of: store.importLandings) {
                    withAnimation(reduceMotion ? nil : .easeIn(duration: 0.2)) { showsUpdated = true }
                    updatedMoment += 1
                }
                .task(id: updatedMoment) {
                    guard updatedMoment > 0 else { return }
                    try? await Task.sleep(for: Self.updatedFor)
                    guard !Task.isCancelled else { return }
                    withAnimation(reduceMotion ? nil : .easeOut(duration: 0.8)) { showsUpdated = false }
                }
                .onChange(of: updating, initial: true) { was, now in
                    if now { model.noteMorningReportUpdating() }
                    #if DEBUG
                    // A development build given a capture folder draws its own window there, updating and then fresh
                    if now { AfterNextFrame.run { DevWindowCapture.capture("morning-report-updating") } }
                    if was && !now { AfterNextFrame.run { DevWindowCapture.capture("morning-report-fresh") } }
                    #endif
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

/// The slots a view draws: the ones a preview or a snapshot put in the environment, else the served payload mapped.
extension MorningReportDesign {
    static func shown(_ override: MorningReportDesign?, for summary: Components.Schemas.FrontOfficeSummary) -> MorningReportDesign {
        override ?? MorningReportDesign(served: summary)
    }
}

/// The Morning Report's masthead: the kicker (the club, the league's day and how current the report is, as the
/// season's facts serve them; the summary's "as of" until they are), "Updating" after it while the report shown is the
/// kept one or a fresh one is on its way, the served headline, the lede as the deck (its basis a click away), and the
/// box score: the record with its place, the run differential with its trend, the last five, tonight's game with the
/// deadline; each part the export could not give says why, where it would be.
public struct MorningReportMasthead: View {
    let summary: Components.Schemas.FrontOfficeSummary
    let record: Components.Schemas.Cell?
    let headline: Text
    let updating: Bool
    let updated: Components.Schemas.ImportLandedLine?
    @Environment(\.morningReportDesign) private var override
    @Environment(\.routeOpener) private var opener

    /// The word after the kicker while the report shown is the kept one or a fresh one is on its way.
    static let updatingWord: LocalizedStringResource = "Updating"

    /// - Parameter updated: the served "Just updated" line, shown after the kicker while it is given (an import just
    ///   landed in place); nil shows none.
    public init(
        summary: Components.Schemas.FrontOfficeSummary, record: Components.Schemas.Cell?, headline: Text, updating: Bool = false,
        updated: Components.Schemas.ImportLandedLine? = nil
    ) {
        self.summary = summary
        self.record = record
        self.headline = headline
        self.updating = updating
        self.updated = updated
    }

    public var body: some View {
        let design = MorningReportDesign.shown(override, for: summary)
        let hints = [design.kickerHint ?? summary.asOf.hint, updated?.hint].compactMap { $0 }.filter { !$0.isEmpty }
        ClubMagazineMasthead(
            club: design.kicker == nil ? nil : .some(design.club),
            kicker: design.kicker ?? [summary.asOf.display],
            kickerHint: hints.isEmpty ? nil : hints.joined(separator: "\n"),
            kickerStatus: updating ? String(localized: Self.updatingWord) : updated?.display,
            headline: headline,
            deck: design.ledeClaim,
            deckText: design.lede,
            deckHint: design.ledeHint
        ) {
            if let scoreboard = design.scoreboard {
                ScoreboardFigures(scoreboard: scoreboard)
            } else if let record {
                VStack(alignment: .leading, spacing: 8) {
                    BoxFigure(value: record.display, label: "")
                        .help(record.hint.map { Text(verbatim: $0) } ?? Text(verbatim: record.display))
                        .accessibilityLabel(Text(verbatim: record.hint ?? record.display))
                        .accessibilityIdentifier("masthead.record")
                    MissingLines(design.mastheadMissing)
                }
            } else if !design.mastheadMissing.isEmpty {
                MissingLines(design.mastheadMissing)
            }
        } control: {
            // Tonight's game with the deadline beside it; with no game served, the deadline stands in the box score
            if let scoreboard = design.scoreboard, let tonight = scoreboard.tonight {
                let route = route(tonight.open)
                let canOpen = route.map { opener?.canOpen($0) ?? false } ?? false
                TonightControl(tonight: tonight, deadline: scoreboard.deadline, action: canOpen ? { if let route { opener?.open(route) } } : nil)
            }
        }
    }
}

/// The served lines for the parts of the box score the export could not give, where the parts would be.
struct MissingLines: View {
    let lines: [ServedLine]

    init(_ lines: [ServedLine]) {
        self.lines = lines
    }

    var body: some View {
        if !lines.isEmpty {
            VStack(alignment: .leading, spacing: 2) {
                ForEach(lines) { line in
                    Text(verbatim: line.text).font(.caption).fixedSize(horizontal: false, vertical: true)
                        .help(Text(verbatim: line.hint ?? line.text))
                }
            }
            .opacity(0.85)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("masthead.missing")
        }
    }
}

/// The scoreboard as the box score: the record with its place (its own claim), the run differential with its trend,
/// the last five with the streak (the served line alone when a letter is one this build does not draw), the deadline
/// when no game is served to stand beside, and the served lines for the parts the export could not give. The figures
/// roll when a fresh report replaces the kept one, unless Reduce Motion is on.
public struct ScoreboardFigures: View {
    let scoreboard: Scoreboard
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.theme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @EffectiveContrast private var contrast

    public init(scoreboard: Scoreboard) {
        self.scoreboard = scoreboard
    }

    public var body: some View {
        let s = scoreboard
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .bottom, spacing: 22) {
                VStack(alignment: .leading, spacing: 3) {
                    ClaimText(s.record) { BoxFigure(value: s.record.value?.display ?? s.record.text, label: "") }
                    if let place = s.placeClaim {
                        ClaimText(place) { Kicker(s.recordLine, size: .small).fixedSize() }.accessibilityIdentifier("masthead.place")
                    } else if !s.recordLine.isEmpty {
                        Kicker(s.recordLine, size: .small).fixedSize()
                    }
                }
                if let runs = s.runs {
                    BoxRule()
                    ClaimText(runs) {
                        BoxFigure(value: runs.value?.display ?? runs.text, label: s.runsLine ?? runs.text) {
                            if let trend = s.trend { Sparkline(values: trend, label: runs.hint ?? runs.text, height: 30).frame(width: 90) }
                        }
                    }
                }
                if let line = s.lastFiveLine {
                    BoxRule()
                    VStack(alignment: .leading, spacing: 5) {
                        if let five = s.lastFive { LastFiveDots(results: five, label: line) }
                        Kicker(line, size: .small).fixedSize()
                            .help(Text(verbatim: s.streakHint ?? line))
                    }
                    .accessibilityElement(children: .contain)
                    .accessibilityIdentifier("masthead.lastFive")
                }
                if s.tonight == nil, let deadline = s.deadline {
                    BoxRule()
                    DeadlineFigures(deadline: deadline, palette: theme.palette(colorScheme: colorScheme, contrast: contrast))
                }
            }
            MissingLines(s.missing)
        }
        .animation(reduceMotion ? nil : .default, value: s)
    }
}

/// The page under the masthead: the lead and side columns. With the served slots (or the fixtures in a preview or a
/// snapshot) the lead carries the club and the roster, and the desk sits in the side column as designed; with only the
/// desk and the cards served, the desk leads and the department reports sit beside it.
public struct MorningReportPage: View {
    let summary: Components.Schemas.FrontOfficeSummary
    @Environment(AppModel.self) private var model
    @Environment(\.contentWidth) private var contentWidth
    @Environment(\.morningReportDesign) private var override

    public init(summary: Components.Schemas.FrontOfficeSummary) {
        self.summary = summary
    }

    /// Below this width the two columns stack.
    public static let twoColumns: CGFloat = 1080

    public var body: some View {
        let design = MorningReportDesign.shown(override, for: summary)
        let designed = design.dimensions != nil || design.positions != nil || design.wire != nil
        VStack(alignment: .leading, spacing: 32) {
            if let chips = design.chips {
                ChipRow(label: Text("Since the last export"), chips: chips)
            }
            if contentWidth >= Self.twoColumns {
                HStack(alignment: .top, spacing: 40) {
                    lead(design, designed: designed).frame(maxWidth: .infinity, alignment: .leading)
                    side(designed: designed).frame(width: 340)
                }
            } else {
                lead(design, designed: designed)
                side(designed: designed)
            }
        }
    }

    @ViewBuilder
    private func lead(_ design: MorningReportDesign, designed: Bool) -> some View {
        VStack(alignment: .leading, spacing: 36) {
            if let dimensions = design.dimensions {
                VStack(alignment: .leading, spacing: 8) {
                    MagazineSection(kicker: Text("The club"), title: Text("How we win and lose"), trailing: design.placesNote, trailingHint: design.placesNoteHint)
                    if let unavailable = design.placesUnavailable {
                        ProblemLine(served: unavailable.text, detail: unavailable.hint)
                    }
                    PlaceStrips(dimensions, headings: design.placeHeadings, legend: design.placeLegend, wide: false)
                }
            }
            if let positions = design.positions {
                VStack(alignment: .leading, spacing: 12) {
                    MagazineSection(kicker: Text("The roster"), title: Text("Who we have"))
                    if let unavailable = design.rosterUnavailable {
                        ProblemLine(served: unavailable.text, detail: unavailable.hint)
                    }
                    if let scale = design.valueScale {
                        RosterDiagram(positions, scale: scale).frame(height: 540)
                        if let legend = model.phrases?.rosterLegend { RosterLegend(legend, notes: design.rosterNotes) }
                        HStack(alignment: .top, spacing: 24) {
                            Card { StaffColumn(title: Text("Rotation"), pitchers: design.rotation, scale: scale, needs: design.rotationNeeds) }
                            Card { StaffColumn(title: Text("Bullpen"), pitchers: design.bullpen, scale: scale, needs: design.bullpenNeeds) }
                        }
                    } else {
                        // No scale: nothing on the map is valued, and the map's own notes say what it can say
                        ForEach(design.rosterNotes) { note in
                            Text(verbatim: note.text).foregroundStyle(.readableSecondary).help(Text(verbatim: note.hint ?? note.text))
                        }
                    }
                }
            }
            if !designed { desk(compact: false) }
            if let wire = design.wire {
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
            if let incomplete = summary.desk.incomplete {
                ProblemLine(served: incomplete.display, detail: incomplete.hint)
            }
            if let empty = summary.desk.empty {
                Text(verbatim: empty.display).foregroundStyle(.readableSecondary)
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
            Text(verbatim: more.line.display).foregroundStyle(.readableSecondary)
        }
    }
}



