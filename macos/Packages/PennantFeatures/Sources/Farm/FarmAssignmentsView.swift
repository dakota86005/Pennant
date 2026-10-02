import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

/// Farm & Development ▸ Assignments (N10): every minor leaguer's assignment in one native table, in the farm's stated
/// order (whether the GM needs to look, then name) until he sorts by a column; only those in question at first, as the
/// React view opened. Developmental stakes are shown and can't be sorted (D-050: never a rank). A double-click or Return
/// opens a player's Decision; his row can be dragged and has the player's menu.
public struct FarmAssignmentsView: View {
    @Environment(AppModel.self) private var model

    public init() {}

    public var body: some View {
        let farm = model.farm
        FarmLoading(payload: farm.assignments, problem: farm.assignments == nil ? farm.problems["assignments"] : nil) { view in
            AssignmentsTable(view: view, updating: farm.isStale("assignments", for: model.storeKey), problem: farm.assignments != nil ? farm.problems["assignments"] : nil)
        }
        .loadsFarm()
    }
}

struct AssignmentsTable: View {
    let view: Components.Schemas.FarmAssignmentsView
    let updating: Bool
    let problem: RequestProblem?
    @Environment(\.routeOpener) private var opener
    @SceneStorage("farm.assignments.inQuestion") private var onlyInQuestion = true
    @SceneStorage("farm.assignments.level") private var levelStored = ""
    @State private var order: [ServedColumnSort<Components.Schemas.FarmAssignmentRow>] = []
    @State private var selection: Set<String> = []
    @SceneStorage("farm.assignments.columns") private var columns: TableColumnCustomization<Components.Schemas.FarmAssignmentRow>

    private var level: Binding<String?> {
        Binding(get: { levelStored.isEmpty ? nil : levelStored }, set: { levelStored = $0 ?? "" })
    }

    /// The served "12 of 40 players" for the filters chosen.
    private var shownLabel: Components.Schemas.Cell? {
        view.shown.first { $0.inQuestionOnly == onlyInQuestion && ($0.levelId ?? "") == levelStored }?.label
    }

    private var rows: [Components.Schemas.FarmAssignmentRow] {
        let shown = view.rows.filter { (!onlyInQuestion || $0.inQuestion) && (levelStored.isEmpty || $0.levelId == levelStored) }
        return ServedRows.sorted(shown, by: order)
    }

    var body: some View {
        let rows = rows
        VStack(alignment: .leading, spacing: 0) {
            AssignmentsHeader(view: view, updating: updating, problem: problem, shown: shownLabel)
            Table(of: Components.Schemas.FarmAssignmentRow.self, selection: $selection, sortOrder: $order, columnCustomization: $columns) {
                TableColumn("Player", sortUsing: ServedColumnSort("player") { .served($0.sort.player?.value1, $0.sort.player?.value2) }) {
                    CellText($0.cells.player).fontWeight(.medium)
                }
                .width(min: 90, ideal: 170)
                .customizationID("player")
                TableColumn("Age", sortUsing: ServedColumnSort("age") { .served($0.sort.age?.value1, $0.sort.age?.value2) }) {
                    CellText($0.cells.age).monospacedDigit()
                }
                .width(min: 34, ideal: 40)
                .customizationID("age")
                TableColumn("Club", sortUsing: ServedColumnSort("club") { .served($0.sort.club?.value1, $0.sort.club?.value2) }) { CellText($0.cells.club) }
                    .width(min: 90, ideal: 190)
                    .customizationID("club")
                TableColumn("The Level", sortUsing: ServedColumnSort("level") { .served($0.sort.level?.value1, $0.sort.level?.value2) }) { CellText($0.cells.level) }
                    .width(min: 90, ideal: 240)
                    .customizationID("level")
                TableColumn("His Results", sortUsing: ServedColumnSort("results") { .served($0.sort.results?.value1, $0.sort.results?.value2) }) {
                    CellText($0.cells.results)
                }
                .width(min: 90, ideal: 170)
                .customizationID("results")
                TableColumn("His Work", sortUsing: ServedColumnSort("work") { .served($0.sort.work?.value1, $0.sort.work?.value2) }) { CellText($0.cells.work) }
                    .width(min: 90, ideal: 130)
                    .customizationID("work")
                // No `sortUsing`: the stakes are never a sort key (D-050). The cell opens the basis, with every reason
                TableColumn("Stakes") { row in
                    ClaimText(row.stakes, edge: .trailing) { CellText(row.cells.stakes) }
                }
                    .width(min: 90, ideal: 140)
                    .customizationID("stakes")
                TableColumn("Conclusion", sortUsing: ServedColumnSort("conclusion") { .served($0.sort.conclusion?.value1, $0.sort.conclusion?.value2) }) {
                    CellText($0.cells.conclusion).fontWeight(.medium)
                }
                .width(min: 90, ideal: 170)
                .customizationID("conclusion")
            } rows: {
                ForEach(rows) { row in TableRow(row).draggable(PlayerRef(id: row.playerId)) }
            }
            .contextMenu(forSelectionType: String.self) { ids in
                if let row = view.rows.first(where: { ids.contains($0.id) }) {
                    FarmPlayerMenu(id: row.playerId, name: row.cells.player.display, open: row.open)
                }
            } primaryAction: { ids in
                if let row = view.rows.first(where: { ids.contains($0.id) }) { openServed(row.open, with: opener) }
            }
            .overlay {
                if rows.isEmpty {
                    let empty = onlyInQuestion ? view.emptyInQuestion : view.emptyAll
                    Text(verbatim: empty.display).foregroundStyle(.readableSecondary).multilineTextAlignment(.center).padding(40)
                        .accessibilityIdentifier("farm.assignments.empty")
                }
            }
            .onReadablePage()
            .accessibilityIdentifier("farm.assignments.table")
        }
        // The header's words on the same fixed page as the table's
        .background(Color.readablePage)
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                LevelPicker(levels: view.levels, selection: level)
                Toggle(isOn: $onlyInQuestion) {
                    Label("In Question Only", systemImage: "line.3.horizontal.decrease.circle")
                }
                .help(Text("In Question Only"))
                .accessibilityIdentifier("farm.filter.inQuestion")
            }
        }
    }
}

/// The view's served note and stated order over the table, with how many rows show (served for the filters chosen).
struct AssignmentsHeader: View {
    let view: Components.Schemas.FarmAssignmentsView
    let updating: Bool
    let problem: RequestProblem?
    let shown: Components.Schemas.Cell?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let problem { ProblemLine(problem) }
            Text(verbatim: view.note.display).font(.callout).fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 8) {
                Text(verbatim: view.order.display).font(.callout.weight(.medium)).foregroundStyle(.readableSecondary).help(detail: view.order.hint)
                    .accessibilityIdentifier("farm.assignments.order")
                if let shown { Text(verbatim: shown.display).font(.callout).foregroundStyle(.readableSecondary).monospacedDigit() }
                if updating { ProgressView().controlSize(.small).accessibilityLabel(Text("Updating")) }
                Spacer()
                Text(verbatim: view.asOf.display).font(.callout).foregroundStyle(.readableSecondary).help(detail: view.asOf.hint)
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
    }
}
