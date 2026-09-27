import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

/// The Morning Report (SWIFTUI_REBUILD.md section 3.4): the club's masthead (at N5 the view's title, the club, its
/// record and how current the report is; the scoreboard's contents are N6), then the GM's desk, every department's items
/// to decide in the server's stated order, then one card per department. The club profile, the roster map and the
/// horizon arrive with N6; every word here is served. Its one floating control opens the whole desk (the Front Office's
/// report), where every item waits, not only each department's first five.
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
                    ClubMasthead(
                        title: model.servedViewName(department: "frontOffice", view: "morningReport").map { Text(verbatim: $0) }
                            ?? Text("Morning Report"),
                        line: summary.asOf.display,
                        lineHint: summary.asOf.hint
                    )
                } content: {
                    VStack(alignment: .leading, spacing: 12) {
                        // A reload that failed says so above what is kept, never "refreshing" for ever
                        if let problem = store.summaryProblem { ProblemLine(problem) }
                        MorningReportContent(
                            summary: summary,
                            refreshing: store.loadingSummary
                                || (store.summaryProblem == nil && model.storeKey.map { !store.summaryIsCurrent(for: $0) } ?? false)
                        )
                    }
                    .padding(24)
                    .frame(maxWidth: 1100, alignment: .leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                } actions: {
                    if let opener, opener.canOpen(Self.wholeDesk) {
                        FloatingControlGroup { namespace in
                            FloatingControl("Whole Desk", systemImage: "tray.full", prominent: true, id: "wholeDesk", in: namespace) {
                                opener.open(Self.wholeDesk)
                            }
                            .help(Text("Every item to decide, from every department"))
                            .accessibilityIdentifier("morningReport.wholeDesk")
                        }
                    }
                }
            } else if let problem = store.summaryProblem {
                ProblemLine(problem).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ProgressView { Text("Loading") }.frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task(id: model.storeKey) { await model.loadFrontOffice() }
    }
}

/// The desk and the cards, from a served summary.
public struct MorningReportContent: View {
    let summary: Components.Schemas.FrontOfficeSummary
    let refreshing: Bool

    public init(summary: Components.Schemas.FrontOfficeSummary, refreshing: Bool = false) {
        self.summary = summary
        self.refreshing = refreshing
    }

    private let columns = [GridItem(.adaptive(minimum: 320, maximum: 520), spacing: 16, alignment: .top)]

    public var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text(verbatim: summary.desk.title.display).font(.largeTitle.weight(.semibold))
                    Text(verbatim: summary.desk.order.display)
                        .foregroundStyle(.secondary)
                        .help(detail: summary.desk.order.hint)
                    Spacer()
                    // How current it is sits on the masthead
                    if refreshing { ProgressView { Text("Refreshing") }.controlSize(.small) }
                }
                if let incomplete = summary.desk.incomplete {
                    ProblemLine(served: incomplete.display, detail: incomplete.hint)
                }
                if let empty = summary.desk.empty {
                    Text(verbatim: empty.display).foregroundStyle(.secondary)
                }
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(summary.desk.items, id: \.key) { item in
                        DeskItemRow(item)
                        Divider()
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
            LazyVGrid(columns: columns, alignment: .leading, spacing: 16) {
                ForEach(summary.departments, id: \.department.rawValue) { card in
                    DepartmentCardView(card)
                }
            }
            // A container of the cards, named for VoiceOver (a bare grid is a group with no description)
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text("Department Reports"))
            .accessibilityIdentifier("morningReport.cards")
        }
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
