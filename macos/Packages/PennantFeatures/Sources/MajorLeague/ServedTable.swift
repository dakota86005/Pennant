import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

/// A served row as the table holds it: the row and its place in the served order (the order an unsorted table keeps).
nonisolated struct ServedRow: Identifiable, Hashable, Sendable {
    let row: Components.Schemas.MlbRow
    let index: Int
    var id: String { row.id }

    /// The served sort key for a column, or nil when it is unknown (sorted last whichever way).
    func key(_ column: String) -> SortKey? {
        guard let served = row.sort.additionalProperties[column] ?? nil else { return nil }
        if let number = served.value1 { return .number(number) }
        if let text = served.value2 { return .text(text) }
        return nil
    }

    /// The served cell for a column (every column has one).
    func cell(_ column: String) -> Components.Schemas.Cell? { row.cells.additionalProperties[column] }
}

/// Sorting a column by its served keys with the unknown-last rule (D-056): the only ordering the app does.
nonisolated struct ServedSort: SortComparator, Hashable, Sendable {
    let column: String
    var order: SortOrder = .forward

    func compare(_ lhs: ServedRow, _ rhs: ServedRow) -> ComparisonResult {
        let direction: SortDirection = order == .forward ? .ascending : .descending
        let a = lhs.key(column), b = rhs.key(column)
        if UnknownLast.precedes(a, b, direction: direction) { return .orderedAscending }
        if UnknownLast.precedes(b, a, direction: direction) { return .orderedDescending }
        return lhs.index < rhs.index ? .orderedAscending : lhs.index > rhs.index ? .orderedDescending : .orderedSame
    }

    /// The rows in this sort's order, stable (ties keep the served order).
    func sorted(_ rows: [ServedRow]) -> [ServedRow] {
        UnknownLast.sorted(rows, by: { $0.key(column) }, direction: order == .forward ? .ascending : .descending)
    }
}

/// A served table as a native `Table` (SWIFTUI_REBUILD.md section 3.6): the served columns (each can be hidden, moved
/// and resized, and the window remembers how), sorting by the served keys with unknowns last, keyboard navigation, a
/// player's row that drags as the player, and a context menu (and double-click or Return) that opens his club, follows
/// him, copies his name, or opens the decisions the row offers. It fills the space it is given and scrolls by itself:
/// it is only ever placed in a `TablePane`, never inside a page's scroll view (the N8 crash; see `TablePane`).
struct ServedTable: View {
    let table: Components.Schemas.MlbTable
    /// Where the window keeps this table's columns (a structural id, never shown).
    let id: String
    /// What the table is, as served (the view's or the group's title), for VoiceOver.
    let name: String
    @Binding var selection: ServedRow.ID?
    @State private var sortOrder: [ServedSort] = []
    @SceneStorage private var customization: TableColumnCustomization<ServedRow>
    @Environment(\.openWindow) private var openWindow
    @Environment(\.routeOpener) private var opener

    /// A column's narrowest: a name stays readable, a number keeps three digits, words a short label.
    static func minimumWidth(_ column: Components.Schemas.MlbColumn) -> CGFloat {
        if ["player", "pitcher"].contains(column.id) { return 110 }
        return column.numeric ? 44 : 72
    }

    /// A column's starting width (the GM can resize it): a name wide, a number narrow, words between.
    static func idealWidth(_ column: Components.Schemas.MlbColumn) -> CGFloat {
        if ["player", "pitcher"].contains(column.id) { return 170 }
        return column.numeric ? 64 : 104
    }

    init(_ table: Components.Schemas.MlbTable, id: String, name: String, selection: Binding<ServedRow.ID?>) {
        self.table = table
        self.id = id
        self.name = name
        _selection = selection
        _customization = SceneStorage(wrappedValue: TableColumnCustomization<ServedRow>(), "majorLeague.table.\(id)")
    }

    private var rows: [ServedRow] {
        let served = table.rows.enumerated().map { ServedRow(row: $0.element, index: $0.offset) }
        guard let sort = sortOrder.first else { return served }
        return sort.sorted(served)
    }

    var body: some View {
        if table.rows.isEmpty {
            Group {
                if let empty = table.empty {
                    Text(verbatim: empty.display).foregroundStyle(.readableSecondary).help(detail: empty.hint)
                }
            }
            .padding(.horizontal, 28).padding(.vertical, 12)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        } else {
            // The table's own identifier (the pane around it is a container, so an id put on the view never replaces it)
            nativeTable
                .accessibilityLabel(Text(verbatim: name))
                .accessibilityIdentifier("table.\(id)")
        }
    }

    private var nativeTable: some View {
        Table(of: ServedRow.self, selection: $selection, sortOrder: $sortOrder, columnCustomization: $customization) {
            TableColumnForEach(table.columns, id: \.id) { column in
                TableColumn(Text(verbatim: column.title.display), sortUsing: ServedSort(column: column.id)) { row in
                    if let cell = row.cell(column.id) {
                        CellText(cell)
                            .monospacedDigit()
                            .lineLimit(1)
                    }
                }
                // A readable minimum: past it the table scrolls sideways. The window's content column reports no minimum
                // of its own (`NoContentMinimum`), so the columns' sum never reaches the split view (the N8 crash)
                .width(min: Self.minimumWidth(column), ideal: Self.idealWidth(column))
                .customizationID(column.id)
            }
        } rows: {
            ForEach(rows) { row in
                if let player = row.row.player {
                    TableRow(row).draggable(PlayerRef(id: player.playerId))
                } else {
                    TableRow(row)
                }
            }
        }
        .tableStyle(.inset(alternatesRowBackgrounds: false))
        .scrollContentBackground(.hidden)
        .background(Color.readablePage)
        .contextMenu(forSelectionType: ServedRow.ID.self) { ids in
            if let row = table.rows.first(where: { ids.contains($0.id) }) { menu(for: row) }
        } primaryAction: { ids in
            if let player = table.rows.first(where: { ids.contains($0.id) })?.player, let club = player.club { openWindow(value: club) }
        }
    }

    @ViewBuilder
    private func menu(for row: Components.Schemas.MlbRow) -> some View {
        if let player = row.player {
            if let club = player.club {
                Button("Open His Club", systemImage: "macwindow.badge.plus") { openWindow(value: club) }
            }
            FollowMenuItem(kind: "player", id: player.playerId)
            Button("Copy Name", systemImage: "doc.on.doc") { copy(player.name) }
        }
        let actions = row.actions.compactMap { action in route(action.open).map { (action, $0) } }.filter { opener?.canOpen($0.1) == true }
        if !actions.isEmpty {
            Divider()
            ForEach(Array(actions.enumerated()), id: \.offset) { _, pair in
                Button { opener?.open(pair.1) } label: { Text(verbatim: pair.0.text.display) }
            }
        }
    }
}

/// A served table in a `TablePane`: the view's head above it, and beneath it the selected row's served detail (what a
/// scout would say if asked, and what it offers to open), then the view's own notes. With nothing selected, a line
/// saying how to see a row's read, and the notes.
struct ServedTablePane<Head: View, Notes: View>: View {
    let table: Components.Schemas.MlbTable
    let id: String
    let name: String
    let detailShare: CGFloat
    let head: Head
    let notes: Notes
    @State private var selection: ServedRow.ID?

    init(
        _ table: Components.Schemas.MlbTable,
        id: String,
        name: String,
        detailShare: CGFloat = 0.42,
        @ViewBuilder head: () -> Head,
        @ViewBuilder notes: () -> Notes
    ) {
        self.table = table
        self.id = id
        self.name = name
        self.detailShare = detailShare
        self.head = head()
        self.notes = notes()
    }

    var body: some View {
        TablePane(detailShare: detailShare) {
            head
        } table: {
            ServedTable(table, id: id, name: name, selection: $selection)
        } detail: {
            VStack(alignment: .leading, spacing: 16) {
                if let row = table.rows.first(where: { $0.id == selection }) {
                    RowDetail(row: row)
                } else if !table.rows.isEmpty {
                    Text("Select a row to see the staff's read.")
                        .font(.callout).foregroundStyle(.readableSecondary)
                }
                notes
            }
        }
    }
}

/// One row's served detail: the player and the read's claim, the detail's blocks side by side when there is room, and
/// the row's actions.
struct RowDetail: View {
    let row: Components.Schemas.MlbRow

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    if let player = row.player { PlayerNameText(player: player, font: .title3.weight(.semibold)) }
                    if let claim = row.claim { ClaimLine(claim) }
                    Spacer(minLength: 0)
                }
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .top, spacing: 24) {
                        ForEach(Array(row.detail.enumerated()), id: \.offset) { _, block in
                            BlockView(block).frame(minWidth: 220, maxWidth: .infinity, alignment: .topLeading)
                        }
                    }
                    VStack(alignment: .leading, spacing: 14) {
                        ForEach(Array(row.detail.enumerated()), id: \.offset) { _, block in BlockView(block) }
                    }
                }
                ActionButtons(actions: row.actions)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("row.detail")
    }
}
