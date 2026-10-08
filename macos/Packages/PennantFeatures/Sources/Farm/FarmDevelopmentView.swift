import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

/// Farm & Development ▸ Development tracking (N10; React's Scouted Development page): what our scouts have seen of each
/// minor leaguer over this save's own rating history (D-064), as one native table, with the served tabs (ahead, behind,
/// the biggest changes, everyone) in the served order and the chosen player's history beneath it (a `TablePane`). With fewer than two
/// snapshots it says the history is building, never a change of zero.
public struct FarmDevelopmentView: View {
    @Environment(AppModel.self) private var model

    public init() {}

    public var body: some View {
        let farm = model.farm
        FarmLoading(payload: farm.development, problem: farm.development == nil ? farm.problems["development"] : nil) { view in
            DevelopmentBoard(view: view, updating: farm.isStale("development", for: model.storeKey), problem: farm.development != nil ? farm.problems["development"] : nil)
        }
        .loadsFarm()
    }
}

struct DevelopmentBoard: View {
    @Environment(AppModel.self) private var model
    let view: Components.Schemas.FarmDevelopmentView
    let updating: Bool
    let problem: RequestProblem?
    @Environment(\.routeOpener) private var opener
    @SceneStorage("farm.development.tab") private var tabStored = ""
    @SceneStorage("farm.development.level") private var levelStored = ""
    @SceneStorage("farm.development.columns") private var columns: TableColumnCustomization<Components.Schemas.FarmDevelopmentRow>
    @State private var order: [ServedColumnSort<Components.Schemas.FarmDevelopmentRow>] = []
    @State private var selection: Set<String> = []
    @State private var guide = false

    private var tab: Components.Schemas.FarmDevelopmentTab? {
        let id = tabStored.isEmpty ? view.initialTab : tabStored
        return view.tabs.first { $0.id == id } ?? view.tabs.first
    }

    /// The tab's rows in its served order, at the chosen level, then as the GM sorted them.
    private var rows: [Components.Schemas.FarmDevelopmentRow] {
        guard let tab else { return [] }
        let byId = Dictionary(uniqueKeysWithValues: view.rows.map { ($0.id, $0) })
        let shown = tab.order.compactMap { byId[$0] }.filter { levelStored.isEmpty || $0.levelId == levelStored }
        return ServedRows.sorted(shown, by: order)
    }

    var body: some View {
        let rows = rows
        let chosen = rows.first { selection.contains($0.id) } ?? rows.first
        // The head at its height, the table filling the rest and scrolling itself, the chosen player's history beneath it
        // in its own scroll area: never a table in a page's scroll view (N8's `TablePane`, the narrow-window crash)
        TablePane(detailShare: 0.45, autosave: "farm.development") {
            VStack(alignment: .leading, spacing: 8) {
                DevelopmentHeader(view: view, tab: tab, updating: updating, problem: problem, guide: $guide)
                if let building = view.building {
                    ServedClaimLine(building).accessibilityIdentifier("farm.development.building")
                }
            }
        } table: {
                Table(of: Components.Schemas.FarmDevelopmentRow.self, selection: $selection, sortOrder: $order, columnCustomization: $columns) {
                    TableColumn("Player", sortUsing: ServedColumnSort("player") { .served($0.sort.player?.value1, $0.sort.player?.value2) }) {
                        FarmPlayerCell(cell: $0.cells.player, fill: $0.ratingsFill)
                    }
                    .width(min: 90, ideal: 150).customizationID("player")
                    TableColumn("Age", sortUsing: ServedColumnSort("age") { .served($0.sort.age?.value1, $0.sort.age?.value2) }) { CellText($0.cells.age).monospacedDigit() }
                        .width(min: 34, ideal: 40).customizationID("age")
                    TableColumn("Club", sortUsing: ServedColumnSort("club") { .served($0.sort.club?.value1, $0.sort.club?.value2) }) { CellText($0.cells.club) }
                        .width(min: 90, ideal: 150).customizationID("club")
                    TableColumn("Role", sortUsing: ServedColumnSort("role") { .served($0.sort.role?.value1, $0.sort.role?.value2) }) { CellText($0.cells.role) }
                        .width(min: 70, ideal: 110).customizationID("role")
                    TableColumn("Our Read", sortUsing: ServedColumnSort("current") { .served($0.sort.current?.value1, $0.sort.current?.value2) }) {
                        CellText($0.cells.current).monospacedDigit()
                    }
                    .width(min: 60, ideal: 80).customizationID("current")
                    TableColumn("Change", sortUsing: ServedColumnSort("change") { .served($0.sort.change?.value1, $0.sort.change?.value2) }) {
                        CellText($0.cells.change).monospacedDigit()
                    }
                    .width(min: 60, ideal: 90).customizationID("change")
                    TableColumn("Against His Peers", sortUsing: ServedColumnSort("pace") { .served($0.sort.pace?.value1, $0.sort.pace?.value2) }) { CellText($0.cells.pace) }
                        .width(min: 90, ideal: 110).customizationID("pace")
                    TableColumn("History", sortUsing: ServedColumnSort("history") { .served($0.sort.history?.value1, $0.sort.history?.value2) }) {
                        CellText($0.cells.history, secondary: true).monospacedDigit()
                    }
                    .width(min: 70, ideal: 100).customizationID("history")
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
                    if rows.isEmpty { Text(verbatim: view.empty.display).foregroundStyle(.readableSecondary).padding(40) }
                }
                // Rows on the fixed page, as N8's tables: the system's alternating rows are a system colour under the words
                .tableStyle(.inset(alternatesRowBackgrounds: false))
                .onReadablePage()
                // Named for VoiceOver by the view's served name
                .accessibilityLabel(Text(verbatim: model.servedViewName(department: "farm", view: "developmentTracking") ?? ""))
                // A served table's identifier as N8 names them (`table.…`), so the audit knows AppKit's cell containers in it
                .accessibilityIdentifier("table.farm.development")
        } detail: {
            Group {
                if let chosen { DevelopmentDetailPane(playerId: chosen.playerId) }
            }
            .frame(maxWidth: .infinity, alignment: .topLeading)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("farm.development.detail")
        }
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                FilterMenu(
                    title: "Show",
                    systemImage: "line.3.horizontal.decrease.circle",
                    choices: view.tabs.map { (id: $0.id, text: $0.label) },
                    selection: Binding(get: { tab?.id ?? view.initialTab }, set: { tabStored = $0; order = [] }),
                    id: "farm.filter.development"
                )
                LevelPicker(levels: view.levels, selection: Binding(get: { levelStored.isEmpty ? nil : levelStored }, set: { levelStored = $0 ?? "" }))
            }
        }
    }
}

/// The served figures, the tab's heading and its stated rule, this save's history notes, and How to Read This.
struct DevelopmentHeader: View {
    let view: Components.Schemas.FarmDevelopmentView
    let tab: Components.Schemas.FarmDevelopmentTab?
    let updating: Bool
    let problem: RequestProblem?
    @Binding var guide: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let problem { ProblemLine(problem) }
            FarmHead(figures: view.figures) {
                VStack(alignment: .leading, spacing: 6) {
                    if let tab {
                        Text(verbatim: tab.title.display).font(.title3.weight(.semibold)).accessibilityAddTraits(.isHeader)
                            .fixedSize(horizontal: false, vertical: true)
                        Text(verbatim: tab.rule.display).font(.callout).foregroundStyle(.readableSecondary).help(detail: tab.rule.hint)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityIdentifier("farm.development.rule")
                    }
                    ForEach(Array(view.historyNotes.enumerated()), id: \.offset) { _, note in
                        UnknownLine(cell: note).font(.callout)
                    }
                    if updating { ProgressView().controlSize(.small).accessibilityLabel(Text("Updating")) }
                }
            } accessory: {
                Button { guide.toggle() } label: { Label("How to Read This", systemImage: "questionmark.circle") }
                    .labelStyle(.iconOnly)
                    .buttonStyle(.borderless)
                    .help(Text("How to Read This"))
                    .popover(isPresented: $guide, arrowEdge: .bottom) { GuidePopover(rows: view.guide, footer: [view.tableNote, view.model]) }
            }
        }
    }
}

/// One player's scouting history in this save, read when chosen: the change in our read and how it compares, each
/// snapshot, and the grades that moved.
struct DevelopmentDetailPane: View {
    @Environment(AppModel.self) private var model
    let playerId: Int

    var body: some View {
        let farm = model.farm
        Group {
            // In the pane beneath the table, which scrolls it
            if let detail = farm.details[playerId] {
                DevelopmentDetailContent(detail: detail)
            } else if let problem = farm.problems["detail:\(playerId)"] {
                ProblemLine(problem)
            } else {
                ProgressView { Text("Loading") }.frame(maxWidth: .infinity)
            }
        }
        .task(id: DetailKey(id: playerId, key: model.storeKey)) { await model.loadFarmDetail(playerId) }
    }

    struct DetailKey: Hashable {
        let id: Int
        let key: AppModel.StoreKey?
    }
}

struct DevelopmentDetailContent: View {
    let detail: Components.Schemas.FarmDevelopmentDetail
    @Environment(\.routeOpener) private var opener

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Scouting history").font(.caption.weight(.semibold)).foregroundStyle(.readableSecondary).textCase(.uppercase)
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(verbatim: detail.name).font(.title2.weight(.bold))
                        .farmPlayer(id: detail.playerId, name: detail.name, open: detail.open)
                    // His reads and snapshots are OSA's view filling in for our scouts (D-067)
                    if let fill = detail.ratingsFill { RatingFillMark(fill) }
                }
                Text(verbatim: detail.line.display).foregroundStyle(.readableSecondary)
                Pill(detail.pace.display, tone: Tone(detail.pace.tone))
            }
            // His ratings changed source between snapshots (D-067): said, with what it leaves out in its basis
            if let sourceSwitch = detail.sourceSwitch {
                ServedClaimLine(sourceSwitch, font: .callout)
                    .accessibilityIdentifier("farm.development.sourceSwitch")
            }
            Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 4) {
                GridRow { Text("First Read").foregroundStyle(.readableSecondary); CellText(detail.first).monospacedDigit() }
                GridRow { Text("Latest Read").foregroundStyle(.readableSecondary); CellText(detail.latest).monospacedDigit() }
                GridRow {
                    Text(verbatim: detail.change.text).foregroundStyle(.readableSecondary)
                    ClaimText(detail.change, edge: .leading) {
                        Text(verbatim: detail.change.value?.display ?? "").monospacedDigit().fontWeight(.semibold)
                    }
                }
                GridRow { Text("Ceiling Change").foregroundStyle(.readableSecondary); CellText(detail.ceilingChange).monospacedDigit() }
            }
            .font(.callout)
            ServedClaimLine(detail.summary, font: .callout)
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Text("Snapshots").font(.callout.weight(.semibold))
                    if let fill = detail.ratingsFill { RatingFillMark(fill) }
                }
                Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 3) {
                    GridRow {
                        Text("Date"); Text("Level"); Text("Our Read"); Text("Ceiling")
                    }
                    .font(.caption.weight(.semibold)).foregroundStyle(.readableSecondary)
                    ForEach(detail.snapshots, id: \.id) { s in
                        GridRow {
                            CellText(s.cells.date); CellText(s.cells.level); CellText(s.cells.current).monospacedDigit(); CellText(s.cells.ceiling).monospacedDigit()
                        }
                    }
                }
                .font(.callout)
            }
            VStack(alignment: .leading, spacing: 6) {
                Text("Grades that moved").font(.callout.weight(.semibold))
                if let empty = detail.movementEmpty { Text(verbatim: empty.display).font(.callout).foregroundStyle(.readableSecondary) }
                Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 3) {
                    ForEach(detail.movement, id: \.id) { m in
                        GridRow {
                            CellText(m.cells.tool)
                            CellText(m.cells.from).monospacedDigit()
                            Image(systemName: "arrow.right").font(.caption).foregroundStyle(.readableSecondary).accessibilityHidden(true)
                            CellText(m.cells.to).monospacedDigit()
                            CellText(m.cells.change).monospacedDigit()
                        }
                    }
                }
                .font(.callout)
            }
            if !detail.peers.isEmpty { LabeledLines(title: "Against his peers", lines: detail.peers) }
            Text(verbatim: detail.fogNote.display).font(.callout).foregroundStyle(.readableSecondary).fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("farm.development.player.\(detail.playerId)")
    }
}
