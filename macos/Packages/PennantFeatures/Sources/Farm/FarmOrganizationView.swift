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
                    pastTable(past.rows, title: past.title)
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

    // The page's short tables are grids in the served order (`PageGrid`): a table never sits in a page's scroll view

    private var depthTable: some View {
        PageGrid(Text("Who the organization could reach for"),
                 columns: [Text("Position")] + view.levels.map { Text(verbatim: $0.name) } + [Text("Upper Minors")],
                 rows: view.depth) { row in
            [AnyView(GridCell(row.position).fontWeight(.semibold))]
                + view.levels.indices.map { index in
                    row.atLevels.indices.contains(index) ? AnyView(GridCell(row.atLevels[index]).monospacedDigit()) : AnyView(Text(verbatim: ""))
                }
                + [AnyView(GridCell(row.upperMinors).monospacedDigit())]
        }
        .accessibilityIdentifier("farm.organization.depth")
    }

    private var startersTable: some View {
        PageGrid(Text("Starters against rotation spots"),
                 columns: [Text("Level"), Text("Used as Starters"), Text("Rotation Spots"), Text("Spots")],
                 rows: view.starters) { row in
            [AnyView(GridCell(row.cells.level)), AnyView(GridCell(row.cells.starters).monospacedDigit()),
             AnyView(GridCell(row.cells.spots).monospacedDigit()), AnyView(GridCell(row.cells.state))]
        }
        .accessibilityIdentifier("farm.organization.starters")
    }

    private func pastTable(_ rows: [Components.Schemas.FarmPlayerRow], title: Components.Schemas.Cell) -> some View {
        PageGrid(Text(verbatim: title.display),
                 columns: [Text("Player"), Text("Age"), Text("Level"), Text("Club")],
                 rows: rows) { row in
            [AnyView(GridCell(row.cells.player).farmPlayer(id: row.playerId, name: row.cells.player.display, open: row.open)),
             AnyView(GridCell(row.cells.age).monospacedDigit()), AnyView(GridCell(row.cells.level)), AnyView(GridCell(row.cells.club))]
        }
        .accessibilityIdentifier("farm.organization.pastWindow")
    }

    private var linesTable: some View {
        PageGrid(Text("The lines this reading used"),
                 columns: [Text("What It Is"), Text("Value"), Text("Kind"), Text("Why")],
                 rows: view.lines) { row in
            [AnyView(GridCell(row.cells.name)), AnyView(GridCell(row.cells.value).monospacedDigit()),
             AnyView(GridCell(row.cells.kind)), AnyView(why(row))]
        }
        .accessibilityIdentifier("farm.organization.lines")
    }

    /// A line's why; one with a basis (the league's own lines set aside for resting on other ratings, D-068) opens it.
    @ViewBuilder
    private func why(_ row: Components.Schemas.FarmLineRow) -> some View {
        if let claim = row.claim {
            ClaimText(claim, edge: .leading) { GridCell(row.cells.why, secondary: true) }
            .accessibilityIdentifier("farm.organization.lines.setAside")
        } else {
            GridCell(row.cells.why, secondary: true)
        }
    }
}
