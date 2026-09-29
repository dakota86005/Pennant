import AppKit
import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

/// The Morning Report (SWIFTUI_REBUILD.md section 3.4) in the design language (section 3.7, R2): the magazine
/// masthead, then the lead column and the side column (stacked below 1080 points). The server serves the desk and the
/// department cards (N4), the masthead's box score, the lede, "How we win and lose" and the roster map with its staff
/// (N6, Stage A), each mapped into the design's shapes by `MorningReportDesign(served:)` (Stage B1); since N7 the "since
/// the last export" chips (each opening its items), the desk's statuses with the set-aside items, and around the league
/// (followed clubs first). The previews and the snapshots may draw the slots from `DesignFixtures` instead
/// (`\.morningReportDesign`).
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
                waiting
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

    /// While there is no report to show: the server starting, then the report on its way (structural words only).
    @ViewBuilder
    private var waiting: some View {
        if model.isReady, let upgrade = model.status?.leagueUpgrade {
            // A league an earlier version imported, brought up to date once: said in the server's words
            ProgressView { Text(verbatim: upgrade.text) }
                .help(Text(verbatim: upgrade.hint))
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityIdentifier("morningReport.leagueUpgrade")
        } else if model.isReady {
            ProgressView { Text("Loading") }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            // The server's waiting state while it starts, named as the shell's own view names it (the UI tests wait on it)
            ProgressView { Text("Starting…") }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityIdentifier("server.waiting")
        }
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

    /// Whether the parts below the first screen are built yet: the page's first frame holds the masthead, the places
    /// and the roster map (what the window shows), and the rest (the staff, and in one column the desk and the
    /// departments) follows in the next frame (N6 polish: the launch budget; they cost about a third of the page's first
    /// layout, and nobody sees them before they scroll).
    @State private var belowTheFold = false

    public var body: some View {
        let design = MorningReportDesign.shown(override, for: summary)
        let designed = design.dimensions != nil || design.positions != nil || design.wire != nil
        let twoColumns = contentWidth >= Self.twoColumns
        VStack(alignment: .leading, spacing: 32) {
            SinceLastExportRow(summary: summary, chips: design.chips)
            if twoColumns {
                HStack(alignment: .top, spacing: 40) {
                    lead(design, designed: designed).frame(maxWidth: .infinity, alignment: .leading)
                    side(designed: designed).frame(width: 340)
                }
            } else {
                lead(design, designed: designed)
                if belowTheFold { side(designed: designed) }
            }
        }
        .onAppear {
            guard !belowTheFold else { return }
            AfterNextFrame.run { belowTheFold = true }
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
                        if belowTheFold {
                            HStack(alignment: .top, spacing: 24) {
                                Card { StaffColumn(title: Text("Rotation"), pitchers: design.rotation, scale: scale, needs: design.rotationNeeds) }
                                Card { StaffColumn(title: Text("Bullpen"), pitchers: design.bullpen, scale: scale, needs: design.bullpenNeeds) }
                            }
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
                AroundTheLeague(top: summary.wire, items: wire)
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
            DeskChangeLines()
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
            // What the GM set aside, one click away
            if let aside = summary.desk.setAside {
                SetAsideButton(aside: aside)
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

// MARK: Since the last export, the desk's statuses, around the league (N7, Stage B)

/// "Since the last export": the served "since" line as the label, then each served chip (new, resolved, moved, results),
/// which opens its items; with no earlier export, the served sentence saying so (never an empty row read as "nothing
/// changed"). The fixtures' chips, in a preview or a snapshot, draw with the structural label.
struct SinceLastExportRow: View {
    let summary: Components.Schemas.FrontOfficeSummary
    let chips: [Chip]?

    var body: some View {
        if let changes = summary.changes, let chips {
            ChipRow(label: Text(verbatim: changes.since.display), labelHint: changes.since.hint, chips: chips) { chip in
                if let served = [changes.new, changes.resolved, changes.moved, changes.results].first(where: { ($0.kind.value1?.rawValue ?? $0.kind.value2) == chip.id }) {
                    ChangeItemsView(chip: served)
                }
            }
        } else if let chips {
            ChipRow(label: Text("Since the last export"), chips: chips)
        } else if let note = summary.changesNote {
            HStack(spacing: 8) {
                Text("Since the last export")
                    .font(.callout.weight(.semibold))
                    .foregroundStyle(.readableSecondary)
                    .accessibilityAddTraits(.isHeader)
                Text(verbatim: note.display)
                    .font(.callout)
                    .fixedSize(horizontal: false, vertical: true)
                    .help(detail: note.hint)
                    .accessibilityIdentifier("changes.note")
                Spacer()
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("chips")
        }
    }
}

/// What a chip opens: its served words, then each item as served (its line with its basis a click away, and where it
/// opens when this build has the view).
struct ChangeItemsView: View {
    let chip: Components.Schemas.ChangeChip
    @Environment(\.routeOpener) private var opener

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(verbatim: chip.text).font(.headline)
            Text(verbatim: chip.hint).font(.callout).foregroundStyle(.readableSecondary)
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(chip.items, id: \.key) { item in
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            ClaimLine(item.line, font: .callout)
                            Spacer(minLength: 4)
                            if let target = route(item.open), let opener, opener.canOpen(target) {
                                Button { opener.open(target) } label: {
                                    Image(systemName: "arrow.up.forward.square").accessibilityLabel(Text("Open"))
                                }
                                .buttonStyle(.borderless)
                                .help(Text("Open"))
                            }
                        }
                        .accessibilityElement(children: .contain)
                        .accessibilityIdentifier("change.\(item.key)")
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxHeight: 360)
        }
        .padding(16)
        .frame(width: 400, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("chip.items")
    }
}

/// The GM's last change on the desk in the server's words ("Marked reviewed"), said for a moment and announced to
/// VoiceOver; and why the last one was refused, in the server's sentence, until dismissed.
struct DeskChangeLines: View {
    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown: Int?

    var body: some View {
        let store = model.frontOffice
        VStack(alignment: .leading, spacing: 4) {
            if let done = store.deskDone, shown == done.moment {
                Label { Text(verbatim: done.text) } icon: { Image(systemName: "checkmark").accessibilityHidden(true) }
                    .font(.callout.weight(.medium))
                    .foregroundStyle(.readableSecondary)
                    .transition(.opacity)
                    .accessibilityIdentifier("desk.done")
            }
            if let problem = store.deskProblem {
                HStack {
                    ProblemLine(problem)
                    Spacer()
                    Button("Dismiss") { store.dismissDeskProblem() }.controlSize(.small)
                }
                .accessibilityIdentifier("desk.problem")
            }
        }
        .task(id: store.deskDone?.moment) {
            guard let done = store.deskDone else { return }
            withAnimation(reduceMotion ? nil : .easeIn(duration: 0.2)) { shown = done.moment }
            AccessibilityNotification.Announcement(done.text).post()
            try? await Task.sleep(for: .seconds(4))
            guard !Task.isCancelled else { return }
            withAnimation(reduceMotion ? nil : .easeOut(duration: 0.6)) { shown = nil }
        }
    }
}

/// The served "2 reviewed · 1 deferred" line, which opens the items set aside: each with its status and note, and the
/// way to put it back on the desk (its context menu, or a swipe).
struct SetAsideButton: View {
    let aside: Components.Schemas.DeskSetAside
    @State private var showing = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Button { showing.toggle() } label: {
            Label { Text(verbatim: aside.line.display).contentTransition(reduceMotion ? .identity : .numericText()) } icon: {
                Image(systemName: "tray")
            }
        }
        .buttonStyle(.link)
        .help(detail: aside.line.hint)
        .accessibilityIdentifier("desk.setAside")
        .popover(isPresented: $showing, arrowEdge: .bottom) {
            SetAsideList(aside: aside)
        }
    }
}

/// The items set aside, as served: a list the GM can swipe or right-click to put an item back.
struct SetAsideList: View {
    let aside: Components.Schemas.DeskSetAside
    @Environment(AppModel.self) private var model
    @Environment(\.undoManager) private var undoManager

    var body: some View {
        // The live set-aside list (a change made here redraws it), else the one the button was drawn with
        let items = model.frontOffice.summary?.desk.setAside?.items ?? []
        VStack(alignment: .leading, spacing: 8) {
            Text(verbatim: model.frontOffice.summary?.desk.setAside?.line.display ?? aside.line.display).font(.headline)
            if items.isEmpty {
                if let empty = model.frontOffice.summary?.desk.empty { Text(verbatim: empty.display).foregroundStyle(.readableSecondary) }
            } else {
                List(items, id: \.key) { item in
                    DeskItemRow(item, compact: true)
                        .swipeActions(edge: .trailing) {
                            Button("Put Back on Desk", systemImage: "tray.and.arrow.up") { model.perform(.open, on: item, undoManager: undoManager) }
                                .tint(.accentColor)
                        }
                }
                .listStyle(.plain)
                .frame(minHeight: 120, maxHeight: 420)
                .accessibilityLabel(Text(verbatim: aside.line.display))
            }
        }
        .padding(14)
        .frame(width: 420)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: aside.line.display))
        .accessibilityIdentifier("desk.setAside.list")
    }
}

/// Around the league on the Morning Report: the served title and stated order, the top entries (followed clubs first),
/// each club's name opening its window, the served gaps ("League news isn't on the wire…") as sentences, and the way to
/// the whole wire in League Office. The fixtures draw the entries alone.
struct AroundTheLeague: View {
    let top: Components.Schemas.WireTop?
    let items: [WireItem]
    @Environment(\.routeOpener) private var opener

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            MagazineSection(
                kicker: Text("The league"),
                title: top.map { Text(verbatim: $0.title.display) } ?? Text("Around the league"),
                trailing: top?.order.line.display, trailingHint: top?.order.line.hint
            )
            if let empty = top?.empty {
                Text(verbatim: empty.display).foregroundStyle(.readableSecondary).help(detail: empty.hint)
            }
            if !items.isEmpty {
                RowGroup {
                    ForEach(items) { item in
                        WireRow(item) { name in
                            if let id = item.clubId { name.clubName(id: id, name: item.club) } else { name }
                        }
                        if item.id != items.last?.id { Divider() }
                    }
                }
            }
            if let top {
                ForEach(Array(top.gaps.enumerated()), id: \.offset) { _, gap in
                    Label { Text(verbatim: gap.display).fixedSize(horizontal: false, vertical: true) } icon: { ToneMark(served: gap.tone) }
                        .font(.callout)
                        .foregroundStyle(.readableSecondary)
                        .help(detail: gap.hint)
                }
                if let target = route(top.open), let opener, opener.canOpen(target) {
                    Button { opener.open(target) } label: {
                        if let more = top.more { Text(verbatim: more.display) } else { Text("The Whole Wire") }
                    }
                    .buttonStyle(.link)
                    .help(detail: top.more?.hint)
                    .accessibilityIdentifier("wire.open")
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("morningReport.wire")
    }
}
