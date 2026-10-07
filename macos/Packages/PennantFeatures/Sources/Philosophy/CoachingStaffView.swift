import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

/// Coaching Staff (N12 Track C; D-073): the club's coaches as the save has them, in a `TablePane` with the served sections
/// as a segmented control (the major-league staff, who on the farm out-rates a major-league incumbent, the farm's staff),
/// the chosen coach's ratings beneath. A coach opens nothing of his own until a staff window exists; an affiliate's row
/// opens its club from the context menu.
struct CoachingStaffView: View {
    @Environment(AppModel.self) private var model
    @SceneStorage("philosophy.staff.section") private var section = 0
    @State private var selection: StaffRow.ID?

    var body: some View {
        let store = model.philosophy
        LoadState(payload: store.staff, problem: store.problems["staff"]) { view in
            let index = min(max(section, 0), max(view.sections.count - 1, 0))
            let head = VStack(alignment: .leading, spacing: 12) {
                PhilosophyHead(title: view.title, byline: view.byline, lede: view.lede, refreshing: store.updating("staff", for: model.storeKey))
                if view.sections.count > 1 {
                    // The shared kit's section control (N12: Finance's and Medical's, one implementation)
                    OfficeSectionPicker(
                        titles: view.sections.map(\.title.display),
                        selection: Binding(get: { index }, set: { section = $0; selection = nil }),
                        id: "staff.sections"
                    )
                }
                if view.sections.indices.contains(index), let summary = view.sections[index].summary { CellWords(summary).font(.callout) }
                if let empty = view.empty { CellWords(empty, quiet: true) }
            }
            if view.sections.indices.contains(index) {
                let shown = view.sections[index]
                TablePane(detailShare: 0.38, autosave: "coachingStaff") {
                    head
                } table: {
                    StaffTable(shown.table, id: "staff.\(shown.id)", name: shown.title.display, selection: $selection)
                } detail: {
                    VStack(alignment: .leading, spacing: 14) {
                        if let row = shown.table.rows.first(where: { $0.id == selection }) {
                            StaffRowDetail(row: row)
                        } else if !shown.table.rows.isEmpty {
                            Text(verbatim: view.select.display)
                                .font(.callout).foregroundStyle(.readableSecondary)
                        }
                        if let note = shown.note { ClaimRow(note, font: .callout, quiet: true) }
                    }
                }
                .id(index)
            } else {
                head.padding(.horizontal, 28).padding(.vertical, 20)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    .background(Color.readablePage)
            }
        }
        .task(id: model.storeKey) { await model.loadCoachingStaff() }
    }
}
