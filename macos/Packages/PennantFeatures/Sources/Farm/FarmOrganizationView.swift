import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

/// Farm & Development ▸ Organization (N10): the farm as one organization. The served scope as the deck, then the
/// system-wide findings, who the organization could reach for at each position and level, starters against rotation
/// spots, the players past their level's window, the lines the reading used and what the farm can't establish.
public struct FarmOrganizationView: View {
    @Environment(AppModel.self) private var model

    public init() {}

    public var body: some View {
        let farm = model.farm
        FarmLoading(payload: farm.organization, problem: farm.organization == nil ? farm.problems["organization"] : nil) { view in
            FarmPage(
                view: "organization",
                head: .init(preparedBy: view.preparedBy, asOf: view.asOf),
                deck: view.scope,
                updating: farm.isStale("organization", for: model.storeKey),
                problem: farm.organization != nil ? farm.problems["organization"] : nil
            ) {
                OrganizationContent(view: view)
            }
        }
        .loadsFarm()
    }
}

struct OrganizationContent: View {
    let view: Components.Schemas.FarmOrganizationView
    @Environment(\.routeOpener) private var opener
    @State private var depthOrder: [ServedColumnSort<Components.Schemas.FarmDepthRow>] = []
    @State private var startersOrder: [ServedColumnSort<Components.Schemas.FarmStartersRow>] = []
    @State private var pastOrder: [ServedColumnSort<Components.Schemas.FarmPlayerRow>] = []
    @State private var pastSelection: Set<String> = []

    var body: some View {
        VStack(alignment: .leading, spacing: 26) {
            FarmSection("System-wide issues") {
                if let empty = view.findingsEmpty {
                    Text(verbatim: empty.display).foregroundStyle(.readableSecondary).fixedSize(horizontal: false, vertical: true)
                }
                ForEach(view.findings, id: \.id) { FindingView($0) }
            }
            FarmSection("Who the organization could reach for", note: view.depthNote) {
                depthTable
            }
            FarmSection("Starters against rotation spots", note: view.startersNote) {
                startersTable
            }
            if let past = view.pastWindow {
                VStack(alignment: .leading, spacing: 8) {
                    Text(verbatim: past.title.display).font(.title3.weight(.semibold)).accessibilityAddTraits(.isHeader)
                    Text(verbatim: past.note.display).font(.callout).foregroundStyle(.readableSecondary).fixedSize(horizontal: false, vertical: true)
                    pastTable(past.rows)
                }
            }
            if !view.unknowns.isEmpty {
                FarmSection("What the farm can't establish") {
                    ForEach(Array(view.unknowns.enumerated()), id: \.offset) { _, line in UnknownLine(cell: line) }
                }
            }
            FarmSection("The lines this reading used") {
                linesTable
            }
        }
    }

    private var depthTable: some View {
        let rows = ServedRows.sorted(view.depth, by: depthOrder)
        return Table(of: Components.Schemas.FarmDepthRow.self, sortOrder: $depthOrder) {
            TableColumn("Position", sortUsing: ServedColumnSort("position") { .number(Double($0.sort.position)) }) { row in
                CellText(row.position).fontWeight(.semibold)
            }
            .width(min: 60, ideal: 80)
            TableColumnForEach(Array(view.levels.enumerated()), id: \.element.id) { index, level in
                TableColumn(Text(verbatim: level.name), sortUsing: ServedColumnSort("level.\(level.id)") { row in
                    row.sort.atLevels.indices.contains(index) ? .number(Double(row.sort.atLevels[index])) : nil
                }) { row in
                    if row.atLevels.indices.contains(index) { CellText(row.atLevels[index]).monospacedDigit() }
                }
                .width(min: 70, ideal: 110)
            }
            TableColumn("Upper Minors", sortUsing: ServedColumnSort("upperMinors") { .number(Double($0.sort.upperMinors)) }) { row in
                CellText(row.upperMinors).monospacedDigit()
            }
            .width(min: 90, ideal: 110)
        } rows: {
            ForEach(rows, id: \.id) { TableRow($0) }
        }
        .frame(height: ShortTable.height(rows: rows.count))
        .scrollDisabled(true)
        .onReadablePage()
        .accessibilityIdentifier("farm.organization.depth")
    }

    private var startersTable: some View {
        let rows = ServedRows.sorted(view.starters, by: startersOrder)
        return Table(of: Components.Schemas.FarmStartersRow.self, sortOrder: $startersOrder) {
            TableColumn("Level", sortUsing: ServedColumnSort("level") { .served($0.sort.level?.value1, $0.sort.level?.value2) }) { CellText($0.cells.level) }
            TableColumn("Used as Starters", sortUsing: ServedColumnSort("starters") { .served($0.sort.starters?.value1, $0.sort.starters?.value2) }) {
                CellText($0.cells.starters).monospacedDigit()
            }
            TableColumn("Rotation Spots", sortUsing: ServedColumnSort("spots") { .served($0.sort.spots?.value1, $0.sort.spots?.value2) }) {
                CellText($0.cells.spots).monospacedDigit()
            }
            TableColumn("Spots", sortUsing: ServedColumnSort("state") { .served($0.sort.state?.value1, $0.sort.state?.value2) }) { CellText($0.cells.state) }
                .width(min: 90, ideal: 200)
        } rows: {
            ForEach(rows, id: \.id) { TableRow($0) }
        }
        .frame(height: ShortTable.height(rows: rows.count))
        .scrollDisabled(true)
        .onReadablePage()
        .accessibilityIdentifier("farm.organization.starters")
    }

    private func pastTable(_ served: [Components.Schemas.FarmPlayerRow]) -> some View {
        let rows = ServedRows.sorted(served, by: pastOrder)
        return Table(of: Components.Schemas.FarmPlayerRow.self, selection: $pastSelection, sortOrder: $pastOrder) {
            TableColumn("Player", sortUsing: ServedColumnSort("player") { .served($0.sort.player?.value1, $0.sort.player?.value2) }) { CellText($0.cells.player) }
            TableColumn("Age", sortUsing: ServedColumnSort("age") { .served($0.sort.age?.value1, $0.sort.age?.value2) }) { CellText($0.cells.age).monospacedDigit() }
                .width(min: 40, ideal: 50)
            TableColumn("Level", sortUsing: ServedColumnSort("level") { .served($0.sort.level?.value1, $0.sort.level?.value2) }) { CellText($0.cells.level) }
            TableColumn("Club", sortUsing: ServedColumnSort("club") { .served($0.sort.club?.value1, $0.sort.club?.value2) }) { CellText($0.cells.club) }
        } rows: {
            ForEach(rows, id: \.id) { row in
                TableRow(row).draggable(PlayerRef(id: row.playerId))
            }
        }
        .contextMenu(forSelectionType: String.self) { ids in
            if let row = served.first(where: { ids.contains($0.id) }) {
                FarmPlayerMenu(id: row.playerId, name: row.cells.player.display, open: row.open)
            }
        } primaryAction: { ids in
            if let row = served.first(where: { ids.contains($0.id) }) { openServed(row.open, with: opener) }
        }
        .frame(height: ShortTable.height(rows: rows.count))
        .scrollDisabled(true)
        .onReadablePage()
        .accessibilityIdentifier("farm.organization.pastWindow")
    }

    private var linesTable: some View {
        Table(of: Components.Schemas.FarmLineRow.self) {
            TableColumn("What It Is") { CellText($0.cells.name).lineLimit(3) }.width(min: 90, ideal: 480)
            TableColumn("Value") { CellText($0.cells.value).monospacedDigit() }.width(min: 80, ideal: 160)
            TableColumn("Kind") { CellText($0.cells.kind) }.width(min: 90, ideal: 130)
            TableColumn("Why") { CellText($0.cells.why, secondary: true) }.width(min: 90, ideal: 240)
        } rows: {
            ForEach(view.lines, id: \.id) { TableRow($0) }
        }
        .frame(height: ShortTable.height(rows: view.lines.count, rowHeight: 34))
        .scrollDisabled(true)
        .onReadablePage()
        .accessibilityIdentifier("farm.organization.lines")
    }
}
