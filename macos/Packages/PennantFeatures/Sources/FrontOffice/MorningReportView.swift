import FeatureCore
import PennantAPI
import PennantKit
import SwiftUI

/// The Morning Report's first plain rendering (SWIFTUI_REBUILD.md section 3.4, items 5 and 6): the GM's desk, every
/// department's items to decide in the server's stated order, then one card per department. The masthead, the club
/// profile, the roster map and the horizon arrive with N6, the look with N5; every word here is served.
public struct MorningReportView: View {
    @Environment(AppModel.self) private var model

    public init() {}

    public var body: some View {
        let store = model.frontOffice
        Group {
            if let summary = store.summary {
                ScrollView {
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
                }
                // A hard edge under the toolbar: the soft one blurs the content behind the window's title and
                // subtitle, and the accessibility audit measures them below contrast there
                .scrollEdgeEffectStyle(.hard, for: .top)
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
                    if refreshing { ProgressView { Text("Refreshing") }.controlSize(.small) }
                    Text(verbatim: summary.asOf.display)
                        .foregroundStyle(.secondary)
                        .help(detail: summary.asOf.hint)
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
