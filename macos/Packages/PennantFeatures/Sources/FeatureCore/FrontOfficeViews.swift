import PennantAPI
import PennantKit
import SwiftUI

// The Front Office's first plain rendering (SWIFTUI_REBUILD.md sections 3.4 and 3.5): served claims, items, cards and
// reports laid out structurally. Every sentence, number and order is the server's; the views add only structural labels
// from the String Catalog. N5's design system (ClaimText, ReportCard, BasisPopover) and N6's Morning Report replace the
// look; the structure stays.

/// Served strings on one line, in the order given, with the missing ones left out.
func servedLine(_ parts: [String?]) -> String {
    parts.compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
}

/// What can open a route in the window a view is in (the Shell's window model): whether this build has the route, and
/// going there. A reference, so the environment does not change on every update.
@MainActor
public protocol RouteOpening: AnyObject {
    func canOpen(_ route: AppRoute) -> Bool
    func open(_ route: AppRoute)
}

extension EnvironmentValues {
    /// The window's route opener (set by the Shell); nil where no window hosts the view, and nothing opens.
    @Entry public var routeOpener: (any RouteOpening)? = nil
}

/// A served target as a route in this build, when it names a department's view.
func route(_ target: Components.Schemas.Target?) -> AppRoute? {
    guard let target, let view = target.view, let department = target.department else { return nil }
    return AppRoute(department: DeptID(rawValue: department.rawValue), view: view)
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
            ToneSymbol(tone: claim.tone)
            Text(verbatim: claim.text)
                .font(font)
                .fixedSize(horizontal: false, vertical: true)
            BasisButton(basis: claim.basis)
        }
        .help(detail: claim.hint)
    }
}

/// A key figure: its served value large, its line beneath, its basis one click away.
public struct FigureTile: View {
    let claim: Components.Schemas.Claim

    public init(_ claim: Components.Schemas.Claim) {
        self.claim = claim
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(verbatim: claim.value?.display ?? claim.text)
                    .font(.title2.weight(.semibold))
                    .monospacedDigit()
                BasisButton(basis: claim.basis)
            }
            if claim.value != nil {
                Text(verbatim: claim.text)
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
        }
        .help(detail: claim.hint)
        .accessibilityElement(children: .combine)
    }
}

/// One item on the desk or in a report: how urgent the department said it is, what it is, who raised it, and a second
/// line and a clock when it has them. Its basis and, for an item with one, the staff's options are a click away.
public struct DeskItemRow: View {
    let item: Components.Schemas.FoItem
    /// Shows which department raised it (on the desk, where items from every department are merged).
    let showsDepartment: Bool

    public init(_ item: Components.Schemas.FoItem, showsDepartment: Bool = true) {
        self.item = item
        self.showsDepartment = showsDepartment
    }

    public var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            ToneSymbol(tone: item.urgency.tone)
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(verbatim: item.headline.text)
                        .font(.body.weight(.medium))
                        .fixedSize(horizontal: false, vertical: true)
                        .help(detail: item.headline.hint)
                    BasisButton(basis: item.headline.basis)
                }
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(verbatim: servedLine([item.urgency.text, item.due?.display, showsDepartment ? item.raisedBy.display : nil]))
                        .font(.callout)
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                        .help(detail: item.urgency.hint)
                    // Why it sits where it does on the desk: the line that placed it, and any lean beside the plain reading
                    BasisButton(basis: item.urgency.basis)
                        .controlSize(.small)
                        .accessibilityIdentifier("item.urgency.basis")
                }
                if let detail = item.detail {
                    Text(verbatim: detail.display)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .help(detail: detail.hint)
                }
            }
            Spacer(minLength: 0)
            if let evidence = item.evidence {
                TrailButton(evidence: evidence)
            }
        }
        .padding(.vertical, 4)
        .accessibilityIdentifier("item.\(item.key)")
    }
}

/// The staff's options behind an item, fetched when the GM asks (the server builds them on demand).
public struct TrailButton: View {
    @Environment(AppModel.self) private var model
    let evidence: String
    @State private var showing = false

    public init(evidence: String) {
        self.evidence = evidence
    }

    public var body: some View {
        Button("Staff's Options") { showing.toggle() }
            .controlSize(.small)
            .accessibilityIdentifier("item.options")
            .popover(isPresented: $showing, arrowEdge: .trailing) {
                TrailContent(evidence: evidence)
                    .padding()
                    .frame(width: 420, alignment: .leading)
                    .task { await model.loadTrail(evidence) }
            }
    }
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
                    BasisContent(basis: trail.headline.basis)
                    ForEach(Array(trail.sections.enumerated()), id: \.offset) { _, section in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(verbatim: section.title.display).font(.subheadline.weight(.semibold))
                            ForEach(Array(section.claims.enumerated()), id: \.offset) { _, claim in
                                ClaimLine(claim, font: .callout)
                            }
                            if let empty = section.empty {
                                Text(verbatim: empty.display).font(.callout).foregroundStyle(.secondary)
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

/// A department's card on the Morning Report: its name and who prepared it, its summary, two or three key figures and
/// its first items, and the way into its report.
public struct DepartmentCardView: View {
    @Environment(\.routeOpener) private var opener
    let card: Components.Schemas.DepartmentCard

    public init(_ card: Components.Schemas.DepartmentCard) {
        self.card = card
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: card.name).font(.headline)
                Text(verbatim: card.preparedBy.display)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .help(detail: card.preparedBy.hint)
            }
            ClaimLine(card.summary)
            if !card.figures.isEmpty {
                HStack(alignment: .top, spacing: 20) {
                    ForEach(Array(card.figures.enumerated()), id: \.offset) { _, figure in
                        FigureTile(figure)
                    }
                }
            }
            if !card.top.isEmpty {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(card.top, id: \.key) { item in
                        DeskItemRow(item, showsDepartment: false)
                    }
                }
            }
            // Only a report this build can open: a card with none has no button
            if let route = route(card.open), let opener, opener.canOpen(route) {
                Button("Open Report") { opener.open(route) }
                    .controlSize(.small)
                    .accessibilityIdentifier("card.open.\(route.department.rawValue)")
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(.background.secondary, in: .rect(cornerRadius: 10))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("card.\(card.department.rawValue)")
    }
}

extension Components.Schemas.DeptId {
    /// The served department's id, whether this build knows it or not.
    public var rawValue: String { value1?.rawValue ?? value2 ?? "" }
}

/// A department's report in the one anatomy (SWIFTUI_REBUILD.md section 3.5): who prepared it and when, its summary,
/// key figures, what to decide, what it is watching, and what it can't see. "What changed" and the staff memo appear
/// when the server serves them (N7, the AI pass).
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
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        // A reload that failed says so above what is kept, never "refreshing" for ever
                        if let problem = store.reportProblems[department.rawValue] { ProblemLine(problem) }
                        DepartmentReportContent(
                            report: report,
                            refreshing: store.loadingReports.contains(department.rawValue)
                                || (store.reportProblems[department.rawValue] == nil && model.storeKey.map { !store.reportIsCurrent(department.rawValue, for: $0) } ?? false)
                        )
                    }
                    .padding(24)
                    .frame(maxWidth: 900, alignment: .leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                // As the Morning Report: a hard edge under the toolbar keeps the window's title legible
                .scrollEdgeEffectStyle(.hard, for: .top)
            } else if let problem = store.reportProblems[department.rawValue] {
                ProblemLine(problem).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ProgressView { Text("Loading") }.frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task(id: model.storeKey) { await model.loadReport(department) }
    }
}

/// The report itself, from a served payload.
public struct DepartmentReportContent: View {
    let report: Components.Schemas.DepartmentReport
    let refreshing: Bool

    public init(report: Components.Schemas.DepartmentReport, refreshing: Bool = false) {
        self.report = report
        self.refreshing = refreshing
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline) {
                    Text(verbatim: report.name).font(.largeTitle.weight(.semibold))
                    if refreshing { ProgressView { Text("Refreshing") }.controlSize(.small) }
                }
                Text(verbatim: servedLine([report.preparedBy.display, report.asOf.display]))
                    .foregroundStyle(.secondary)
                    .help(detail: report.asOf.hint)
            }
            ClaimLine(report.summary, font: .title3)
            if !report.figures.isEmpty {
                HStack(alignment: .top, spacing: 28) {
                    ForEach(Array(report.figures.enumerated()), id: \.offset) { _, figure in
                        FigureTile(figure)
                    }
                }
            }
            ItemSection(section: report.toDecide, showsDepartment: report.department.rawValue == "frontOffice")
            ItemSection(section: report.watching, showsDepartment: report.department.rawValue == "frontOffice")
            if let changes = report.changes, !changes.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(Array(changes.enumerated()), id: \.offset) { _, change in ClaimLine(change.line) }
                }
            }
            VStack(alignment: .leading, spacing: 6) {
                Text(verbatim: report.unknowns.title.display).font(.title3.weight(.semibold))
                ForEach(Array(report.unknowns.lines.enumerated()), id: \.offset) { _, line in
                    Text(verbatim: line.display)
                        .fixedSize(horizontal: false, vertical: true)
                        .help(detail: line.hint)
                }
            }
            if let memo = report.memo {
                VStack(alignment: .leading, spacing: 4) {
                    Text(verbatim: memo.by.display).font(.headline)
                    ForEach(Array(memo.lines.enumerated()), id: \.offset) { _, line in Text(verbatim: line.display) }
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("report.content")
    }
}

/// "To decide" or "Watching": its title, its items, and its served line when it has none. A section with no items and
/// no line (a department that could not be read, or has no report yet) is left out: its summary says why.
struct ItemSection: View {
    let section: Components.Schemas.ReportSection
    let showsDepartment: Bool

    var body: some View {
        if !section.items.isEmpty || section.empty != nil {
            VStack(alignment: .leading, spacing: 6) {
                Text(verbatim: section.title.display).font(.title3.weight(.semibold))
                if let empty = section.empty {
                    Text(verbatim: empty.display).foregroundStyle(.secondary)
                }
                ForEach(section.items, id: \.key) { item in
                    DeskItemRow(item, showsDepartment: showsDepartment)
                    Divider()
                }
            }
        }
    }
}
