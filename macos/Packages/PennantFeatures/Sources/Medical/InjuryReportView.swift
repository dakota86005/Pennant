import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

/// The Injury Report (N12): every injured player in the organization, majors to rookie ball, as a native table that
/// opens each player's window (Return, a double-click or the menu) and compares the chosen ones. The level is the
/// toolbar's filter; a return date the export doesn't give says so and sorts last, never a dash read as zero (D-018).
struct InjuryReportView: View {
    @Environment(AppModel.self) private var model
    @State private var chosen: [String: String] = [:]

    var body: some View {
        let store = model.office
        OfficeState(payload: store.injuries, problem: store.problems[OfficeStore.View.injuryReport.rawValue]) { view in
            let kept = officeRowsKept(view.table, filters: view.filters, chosen: chosen, search: "")
            OfficeTablePane(view.table, id: "injuryReport", name: view.title.display, kept: kept, detailShare: 0.3) {
                VStack(alignment: .leading, spacing: 10) {
                    OfficeHead(title: view.title.display, byline: view.byline, parts: view.bylineParts, lede: view.lede, freshness: view.freshness,
                               refreshing: model.office.updating(.injuryReport, for: model.storeKey))
                    OfficeFigures(view.figures)
                }
            } notes: {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(Array(view.unknowns.enumerated()), id: \.offset) { _, unknown in
                        Label { Text(verbatim: unknown.display) } icon: { ToneMark(served: unknown.tone ?? .init(value1: .unknown)) }
                            .font(.callout)
                    }
                }
            }
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    OfficeFilterButton(groups: view.filters, chosen: $chosen, id: "injuryReport.filter")
                }
            }
        }
        .task(id: model.storeKey) { await model.loadOffice() }
    }
}
