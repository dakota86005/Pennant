import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

// The Front Office's served views in the design language (SWIFTUI_REBUILD.md sections 3.4, 3.5 and 3.7): served
// claims, items, cards and reports drawn with PennantDesign's components. Every sentence, number and order is the
// server's; the views add only structural labels from the String Catalog.

/// Served strings on one line, in the order given, with the missing ones left out.
func servedLine(_ parts: [String?]) -> String {
    parts.compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
}

/// What can open a route in the window a view is in (the Shell's window model): whether this build has the route,
/// going there, and the registry's department for a served id (its symbol). A reference, so the environment does not
/// change on every update.
@MainActor
public protocol RouteOpening: AnyObject {
    func canOpen(_ route: AppRoute) -> Bool
    func open(_ route: AppRoute)
    func department(_ id: DeptID) -> Department?
}

extension EnvironmentValues {
    /// The window's route opener (set by the Shell); nil where no window hosts the view, and nothing opens.
    @Entry public var routeOpener: (any RouteOpening)? = nil
}

/// A served target as a route in this build, when it names a department's view.
public func route(_ target: Components.Schemas.Target?) -> AppRoute? {
    guard let target, let department = target.department else { return nil }
    let dept = DeptID(rawValue: department.rawValue)
    // A decision opens its department's Decision view on its key (N10: the farm's, a player's id)
    if target.kind.value1 == .decision, let key = target.key { return AppRoute(department: dept, view: "decision", subject: key) }
    guard let view = target.view else { return nil }
    return AppRoute(department: dept, view: view, subject: target.key)
}

/// A served claim as one line: its tone's symbol, its text, its help tag, and its basis one click away.
public struct ClaimLine: View {
    let claim: Components.Schemas.Claim
    let font: Font

    public init(_ claim: Components.Schemas.Claim, font: Font = .body) {
        self.claim = claim
        self.font = font
    }

    public var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            ToneMark(served: claim.tone)
            ClaimText(claim, edge: .trailing) {
                Text(verbatim: claim.text)
                    .font(font)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

/// One item on the desk or in a report: the design's desk row, with the staff's options trailing when it has them, and
/// what the GM did with it beneath (its served status and his note). Its context menu, the Desk menu's keys (while the
/// keyboard focus is in it) and VoiceOver's actions mark it Reviewed, Deferred until one of the served days, or Handled
/// in OOTP, put it back, or change its note; each is undone with ⌘Z. A status never changes how urgent it is drawn.
public struct DeskItemRow: View {
    let item: Components.Schemas.FoItem
    /// Shows which department raised it (on the desk, where items from every department are merged).
    let showsDepartment: Bool
    let compact: Bool
    /// The undo manager to register on when the row is drawn in a popover (its own window): the window it was opened
    /// from (M6); nil for the row's own window's.
    let handedUndoManager: UndoManager?
    @Environment(AppModel.self) private var model
    @Environment(\.undoManager) private var windowUndoManager
    @Environment(\.routeOpener) private var opener
    @State private var editingNote = false

    public init(_ item: Components.Schemas.FoItem, showsDepartment: Bool = true, compact: Bool = false, undoManager: UndoManager? = nil) {
        self.item = item
        self.showsDepartment = showsDepartment
        self.compact = compact
        self.handedUndoManager = undoManager
    }

    private var undoManager: UndoManager? { handedUndoManager ?? windowUndoManager }

    /// The item's first served link this build opens in the window (its department's view or decision), when it has one.
    private var openable: AppRoute? {
        for link in item.headline.links {
            if let r = route(link), opener?.canOpen(r) ?? false { return r }
        }
        return nil
    }

    public var body: some View {
        let choices = model.frontOffice.summary?.desk.deferChoices ?? []
        DeskRow(item, showsDepartment: showsDepartment, compact: compact) {
            HStack(spacing: 6) {
                if model.frontOffice.deskBusy.contains(item.key) {
                    ProgressView().controlSize(.small).accessibilityLabel(Text("Saving"))
                }
                if let evidence = item.evidence {
                    TrailButton(evidence: evidence, compact: compact)
                } else if let open = openable {
                    // Where the department answers it, in this window (N10: a farm player's Decision, an affiliate)
                    Button { opener?.open(open) } label: {
                        if compact {
                            Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.readableSecondary)
                                .accessibilityLabel(Text("Open"))
                        } else {
                            Text("Open")
                        }
                    }
                    .buttonStyle(compact ? AnyButtonStyle(.plain) : AnyButtonStyle(.bordered))
                    .controlSize(.small)
                    .help(Text("Open"))
                    .accessibilityIdentifier("item.open")
                }
            }
        }
        .contentShape(.rect)
        .contextMenu {
            if let open = openable {
                Button("Open", systemImage: "arrow.up.forward.square") { opener?.open(open) }
                Divider()
            }
            DeskItemMenu(status: item.attention.status, deferChoices: choices, perform: perform, editNote: { editingNote = true })
        }
        .popover(isPresented: $editingNote, arrowEdge: .trailing) {
            // The popover is a window of its own: the note is undone in the row's window (M6)
            DeskNoteEditor(item: item, undoManager: undoManager) { editingNote = false }
        }
        .focusedValue(\.deskItem, FocusedDeskItem(
            key: item.key, status: item.attention.status, deferChoices: choices, perform: perform, editNote: { editingNote = true }
        ))
        .accessibilityAction(named: Text("Mark Reviewed")) { perform(.reviewed) }
        .accessibilityAction(named: Text("Mark Handled in OOTP")) { perform(.handled) }
        .accessibilityActions {
            if let first = choices.first {
                Button { perform(.deferred(until: first.until)) } label: { Text(verbatim: first.text.display) }
            }
            if item.attention.status.value1 != .open {
                Button("Put Back on Desk") { perform(.open) }
            }
            Button("Note…") { editingNote = true }
        }
    }

    private func perform(_ action: DeskAction) {
        model.perform(action, on: item, undoManager: undoManager)
    }
}

/// The staff's options behind an item, fetched when the GM asks (the server builds them on demand).
public struct TrailButton: View {
    @Environment(AppModel.self) private var model
    let evidence: String
    let compact: Bool
    @State private var showing = false

    public init(evidence: String, compact: Bool = false) {
        self.evidence = evidence
        self.compact = compact
    }

    public var body: some View {
        Button { showing.toggle() } label: {
            if compact {
                Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.readableSecondary)
                    .accessibilityLabel(Text("Staff's Options"))
            } else {
                Text("Staff's Options")
            }
        }
        .buttonStyle(compact ? AnyButtonStyle(.plain) : AnyButtonStyle(.bordered))
        .controlSize(.small)
        .help(Text("Staff's Options"))
        .accessibilityIdentifier("item.options")
        .popover(isPresented: $showing, arrowEdge: .trailing) {
            TrailContent(evidence: evidence)
                .padding()
                .frame(width: 420, alignment: .leading)
                .task { await model.loadTrail(evidence) }
        }
    }
}

/// A button style chosen at run time.
struct AnyButtonStyle: PrimitiveButtonStyle {
    private let make: (Configuration) -> AnyView

    init<S: PrimitiveButtonStyle>(_ style: S) {
        make = { AnyView(style.makeBody(configuration: $0)) }
    }

    func makeBody(configuration: Configuration) -> some View { make(configuration) }
}

/// An evidence trail: its headline, then each section's claims, as served.
public struct TrailContent: View {
    @Environment(AppModel.self) private var model
    let evidence: String

    public init(evidence: String) {
        self.evidence = evidence
    }

    public var body: some View {
        let store = model.frontOffice
        if let trail = store.trails[evidence] {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Text(verbatim: trail.title.display).font(.headline)
                    ClaimLine(trail.headline)
                    // The need's own basis (why, not known), above the responses
                    BasisSections(basis: trail.headline.basis).font(.callout)
                    ForEach(Array(trail.sections.enumerated()), id: \.offset) { _, section in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(verbatim: section.title.display).font(.subheadline.weight(.semibold))
                            ForEach(Array(section.claims.enumerated()), id: \.offset) { _, claim in
                                ClaimLine(claim, font: .callout)
                            }
                            if let empty = section.empty {
                                Text(verbatim: empty.display).font(.callout).foregroundStyle(.readableSecondary)
                            }
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxHeight: 480)
        } else if let problem = store.trailProblems[evidence] {
            ProblemLine(problem)
        } else {
            ProgressView { Text("Loading") }
        }
    }
}

/// A department's card on the Morning Report: the design's tile for a department with a report, or its placeholder
/// row for one with none yet. The symbol is the registry's; a report only this build can open gets the way in.
public struct DepartmentCardView: View {
    @Environment(\.routeOpener) private var opener
    let card: Components.Schemas.DepartmentCard

    public init(_ card: Components.Schemas.DepartmentCard) {
        self.card = card
    }

    public var body: some View {
        let symbol = opener?.department(DeptID(rawValue: card.department.rawValue))?.symbol ?? "building.2"
        if card.status.value1 == .notYet {
            DepartmentPlaceholderRow(card, symbol: symbol)
        } else {
            let target = route(card.open)
            DepartmentTile(card, symbol: symbol, open: target.flatMap { route in
                guard let opener, opener.canOpen(route) else { return nil }
                return { opener.open(route) }
            })
        }
    }
}

/// A department's report in the one anatomy (SWIFTUI_REBUILD.md section 3.5), set like a magazine: the masthead
/// carries its served name, its summary as the deck and its key figures as the box score; below, what to decide, what
/// it is watching, what changed and what it can't see. The staff memo appears when the server serves one (N7).
public struct DepartmentReportView: View {
    @Environment(AppModel.self) private var model
    let department: DeptID

    public init(department: DeptID) {
        self.department = department
    }

    public var body: some View {
        let store = model.frontOffice
        Group {
            if let report = store.reports[department.rawValue] {
                MastheadScrollView {
                    ClubMagazineMasthead(
                        kicker: [report.preparedBy.display, report.asOf.display],
                        kickerHint: report.asOf.hint,
                        headline: Text(verbatim: report.name),
                        deck: report.summary
                    ) {
                        ReportFigures(figures: report.figures)
                    }
                } content: {
                    VStack(alignment: .leading, spacing: 12) {
                        // A reload that failed says so above what is kept, never "refreshing" for ever
                        if let problem = store.reportProblems[department.rawValue] { ProblemLine(problem) }
                        DepartmentReportContent(
                            report: report,
                            refreshing: store.loadingReports.contains(department.rawValue)
                                || (store.reportProblems[department.rawValue] == nil && model.storeKey.map { !store.reportIsCurrent(department.rawValue, for: $0) } ?? false),
                            showsHeader: false
                        )
                    }
                    .padding(.horizontal, 28).padding(.vertical, 24)
                    .frame(maxWidth: 1100, alignment: .leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            } else if let problem = store.reportProblems[department.rawValue] {
                ProblemLine(problem).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ProgressView { Text("Loading") }.frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        // The statuses of its items change without a new key (the GM's own change, the desk-changed event)
        .task(id: ReportTaskKey(key: model.storeKey, attention: store.attentionRevision)) { await model.loadReport(department) }
    }
}

/// What a report view reloads on: the store key, and the statuses' revision.
struct ReportTaskKey: Hashable {
    let key: AppModel.StoreKey?
    let attention: Int
}

/// The symbol for a served kind of change (new, resolved, moved, results), shared by the chips and the reports; a kind
/// this build has not heard of gets a plain one.
nonisolated public enum ChangeKind {
    public static func symbol(_ kind: String) -> String {
        switch kind {
        case "new": "plus.circle"
        case "resolved": "checkmark.circle"
        case "moved": "arrow.up.arrow.down.circle"
        case "results": "calendar"
        default: "circle"
        }
    }
}

/// A report's served key figures as the masthead's box score, each with its basis a click away.
public struct ReportFigures: View {
    let figures: [Components.Schemas.Claim]

    public init(figures: [Components.Schemas.Claim]) {
        self.figures = figures
    }

    public var body: some View {
        HStack(alignment: .bottom, spacing: 22) {
            ForEach(Array(figures.enumerated()), id: \.offset) { index, figure in
                if index > 0 { BoxRule() }
                ClaimText(figure) {
                    BoxFigure(value: figure.value?.display ?? figure.text, label: figure.value == nil ? "" : figure.text)
                }
            }
        }
    }
}

/// The report itself, from a served payload.
public struct DepartmentReportContent: View {
    let report: Components.Schemas.DepartmentReport
    let refreshing: Bool
    /// The report's name, who prepared it and when, and its summary and figures above it (false where a masthead
    /// says them).
    let showsHeader: Bool

    public init(report: Components.Schemas.DepartmentReport, refreshing: Bool = false, showsHeader: Bool = true) {
        self.report = report
        self.refreshing = refreshing
        self.showsHeader = showsHeader
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 28) {
            if showsHeader {
                VStack(alignment: .leading, spacing: 8) {
                    Kicker(served: [report.preparedBy.display, report.asOf.display]).foregroundStyle(.readableSecondary)
                    HStack(alignment: .firstTextBaseline) {
                        Text(verbatim: report.name).font(.system(size: 40, weight: .bold, design: .serif))
                        if refreshing { ProgressView { Text("Refreshing") }.controlSize(.small) }
                    }
                    ClaimLine(report.summary, font: .title3)
                    if !report.figures.isEmpty {
                        HStack(spacing: 8) {
                            ForEach(Array(report.figures.enumerated()), id: \.offset) { index, figure in
                                MetricTile(Figure(figure, id: "\(report.department.rawValue).\(index)"))
                            }
                        }
                    }
                }
            } else if refreshing {
                ProgressView { Text("Refreshing") }.controlSize(.small)
            }
            ItemSection(section: report.toDecide, showsDepartment: report.department.rawValue == "frontOffice")
            ItemSection(section: report.watching, showsDepartment: report.department.rawValue == "frontOffice")
            // What changed since the last export, drawn as the Morning Report's chips draw their items: each served line
            // under its kind's symbol; with nothing to compare, or nothing changed, the served sentence
            if (report.changes?.isEmpty == false) || report.changesNote != nil {
                VStack(alignment: .leading, spacing: 8) {
                    MagazineSection(title: Text("What changed"))
                    if let note = report.changesNote {
                        Text(verbatim: note.display).foregroundStyle(.readableSecondary).help(detail: note.hint)
                            .accessibilityIdentifier("report.changesNote")
                    }
                    if let changes = report.changes, !changes.isEmpty {
                        RowGroup {
                            ForEach(Array(changes.enumerated()), id: \.offset) { index, change in
                                HStack(alignment: .firstTextBaseline, spacing: 8) {
                                    // The kind in the served word beside its symbol (M8): never a symbol alone, and
                                    // the word is what VoiceOver reads
                                    Image(systemName: ChangeKind.symbol(change.kind.value1?.rawValue ?? change.kind.value2 ?? ""))
                                        .foregroundStyle(.readableSecondary)
                                        .accessibilityHidden(true)
                                    Text(verbatim: change.word).font(.callout.weight(.semibold)).foregroundStyle(.readableSecondary)
                                        .frame(minWidth: 64, alignment: .leading)
                                    ClaimLine(change.line)
                                }
                                .padding(.vertical, 8)
                                if index < changes.count - 1 { Divider() }
                            }
                        }
                        .accessibilityIdentifier("report.changes")
                    }
                }
            }
            VStack(alignment: .leading, spacing: 8) {
                MagazineSection(title: Text(verbatim: report.unknowns.title.display))
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(Array(report.unknowns.lines.enumerated()), id: \.offset) { _, line in
                        Label {
                            Text(verbatim: line.display).fixedSize(horizontal: false, vertical: true)
                        } icon: {
                            Image(systemName: "questionmark.circle").foregroundStyle(.readableSecondary)
                        }
                        .help(detail: line.hint)
                    }
                }
            }
            if let memo = report.memo {
                VStack(alignment: .leading, spacing: 8) {
                    MagazineSection(title: Text(verbatim: memo.by.display))
                    ForEach(Array(memo.lines.enumerated()), id: \.offset) { _, line in Text(verbatim: line.display) }
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("report.content")
    }
}

/// "To decide" or "Watching": its served title as a section, its items in a grouped card, and its served line when it
/// has none. A section with no items and no line (a department that could not be read, or has no report yet) is left
/// out: its summary says why.
struct ItemSection: View {
    let section: Components.Schemas.ReportSection
    let showsDepartment: Bool

    var body: some View {
        if !section.items.isEmpty || section.empty != nil {
            VStack(alignment: .leading, spacing: 8) {
                MagazineSection(title: Text(verbatim: section.title.display))
                if let empty = section.empty {
                    Text(verbatim: empty.display).foregroundStyle(.readableSecondary)
                }
                if !section.items.isEmpty {
                    RowGroup {
                        ForEach(Array(section.items.enumerated()), id: \.element.key) { index, item in
                            DeskItemRow(item, showsDepartment: showsDepartment)
                            if index < section.items.count - 1 { Divider() }
                        }
                    }
                }
            }
        }
    }
}
