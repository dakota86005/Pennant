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
/// player's row that drags as the player, and a context menu that opens his window (also a double-click or Return, N11)
/// or his club, compares the selected players, follows him, copies his name, or opens the decisions the row offers; a row
/// about no one player that names some (a game's two starters) opens each and compares them. A
/// filled player's grades carry the OSA mark beside his name (D-067). It fills the space it is given and scrolls by itself:
/// it is only ever placed in a `TablePane`, never inside a page's scroll view (the N8 crash; see `TablePane`).
struct ServedTable: View {
    let table: Components.Schemas.MlbTable
    /// Where the window keeps this table's columns (a structural id, never shown).
    let id: String
    /// What the table is, as served (the view's or the group's title), for VoiceOver.
    let name: String
    /// Several rows can be chosen (N11: Compare takes the chosen players); the detail beneath shows one.
    @Binding var selection: Set<ServedRow.ID>
    /// A row to bring into view when the table appears (N9: the schedule's next game, the 40-man's player a desk item
    /// opened on).
    var reveal: ServedRow.ID? = nil
    @State private var sortOrder: [ServedSort] = []
    @SceneStorage private var customization: TableColumnCustomization<ServedRow>
    @Environment(\.openWindow) private var openWindow
    @Environment(\.routeOpener) private var opener

    /// A column's narrowest: a name stays readable, a number keeps three digits, words a short label.
    /// Columns of served words that run long (a reason, an availability, what can be done): wider to start.
    static let wordy: Set<String> = ["why", "tonight", "now", "issues", "result", "series", "opponent", "ourStarter", "theirStarter", "standing"]

    static func minimumWidth(_ column: Components.Schemas.MlbColumn) -> CGFloat {
        if ["player", "pitcher"].contains(column.id) { return 110 }
        return column.numeric ? 44 : 72
    }

    /// A column's starting width (the GM can resize it): a name wide, a number narrow, words between.
    static func idealWidth(_ column: Components.Schemas.MlbColumn) -> CGFloat {
        if ["player", "pitcher"].contains(column.id) { return 170 }
        if wordy.contains(column.id) { return 190 }
        return column.numeric ? 64 : 104
    }

    init(_ table: Components.Schemas.MlbTable, id: String, name: String, selection: Binding<Set<ServedRow.ID>>, reveal: ServedRow.ID? = nil) {
        self.table = table
        self.id = id
        self.name = name
        self.reveal = reveal
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
            ScrollViewReader { proxy in
                nativeTable
                    .accessibilityLabel(Text(verbatim: name))
                    .accessibilityIdentifier("table.\(id)")
                    .onAppear {
                        guard let reveal else { return }
                        // After the first layout, so the row is there to scroll to; to the middle of the table's height
                        // and its leading edge, so the columns are never scrolled sideways under the sidebar
                        AfterNextFrame.run { proxy.scrollTo(reveal, anchor: UnitPoint(x: 0, y: 0.5)) }
                    }
            }
        }
    }

    private var nativeTable: some View {
        Table(of: ServedRow.self, selection: $selection, sortOrder: $sortOrder, columnCustomization: $customization) {
            TableColumnForEach(table.columns, id: \.id) { column in
                TableColumn(Text(verbatim: column.title.display), sortUsing: ServedSort(column: column.id)) { row in
                    if let cell = row.cell(column.id) {
                        if let fill = row.row.ratingsFill, ["player", "pitcher"].contains(column.id) {
                            HStack(spacing: 4) {
                                CellText(cell).monospacedDigit().lineLimit(1)
                                RatingFillMark(fill)
                            }
                        } else {
                            CellText(cell)
                                .monospacedDigit()
                                .lineLimit(1)
                        }
                    }
                }
                // A readable minimum: past it the table scrolls sideways. The window's content column reports no minimum
                // of its own (`NoContentMinimum`), so the columns' sum never reaches the split view (the N8 crash)
                .width(min: Self.minimumWidth(column), ideal: Self.idealWidth(column))
                .customizationID(column.id)
                // A column served hidden (a roster's other season lines, N9) is shown from the table's own columns
                .defaultVisibility(column.hidden == true ? .hidden : .automatic)
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
            if let row = table.rows.first(where: { ids.contains($0.id) }) {
                menu(for: row, chosen: Self.players(in: table.rows.filter { ids.contains($0.id) }))
            }
        } primaryAction: { ids in
            if let player = table.rows.first(where: { ids.contains($0.id) })?.player { openWindow(value: PlayerRef(id: player.playerId)) }
        }
    }

    /// The players the chosen rows name, in the table's order, each once: a row's player, or the players a row about no one
    /// player names (a game's two starters), so Compare takes them all.
    static func players(in rows: [Components.Schemas.MlbRow]) -> [PlayerRef] {
        var seen = Set<Int>()
        return rows.flatMap { row in row.player.map { [$0] } ?? row.players ?? [] }
            .filter { seen.insert($0.playerId).inserted }
            .map { PlayerRef(id: $0.playerId) }
    }

    @ViewBuilder
    private func menu(for row: Components.Schemas.MlbRow, chosen: [PlayerRef]) -> some View {
        if row.player == nil, let named = row.players, !named.isEmpty {
            // A row about no one player that names some (a game's starters): each opens in his own window
            if named.count == 1, let only = named.first {
                OpenPlayerMenuItem(PlayerRef(id: only.playerId))
            } else {
                Menu("Open Player", systemImage: "person.text.rectangle") {
                    ForEach(named, id: \.playerId) { player in
                        Button { openWindow(value: PlayerRef(id: player.playerId)) } label: { Text(verbatim: player.name) }
                    }
                }
            }
            CompareMenuItem(chosen)
        }
        if let player = row.player {
            OpenPlayerMenuItem(PlayerRef(id: player.playerId))
            if let club = player.club {
                Button("Open His Club", systemImage: "macwindow.badge.plus") { openWindow(value: club) }
            }
            CompareMenuItem(chosen)
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
    let reveal: ServedRow.ID?
    @State private var selection: Set<ServedRow.ID>

    /// - Parameter selected: the row chosen and brought into view when the pane appears (N9: a desk item's player).
    init(
        _ table: Components.Schemas.MlbTable,
        id: String,
        name: String,
        detailShare: CGFloat = 0.42,
        selected: ServedRow.ID? = nil,
        @ViewBuilder head: () -> Head,
        @ViewBuilder notes: () -> Notes
    ) {
        self.table = table
        self.id = id
        self.name = name
        self.detailShare = detailShare
        self.head = head()
        self.notes = notes()
        reveal = selected
        _selection = State(initialValue: selected.map { [$0] } ?? [])
    }

    var body: some View {
        TablePane(detailShare: detailShare, autosave: id) {
            head
        } table: {
            ServedTable(table, id: id, name: name, selection: $selection, reveal: reveal)
        } detail: {
            VStack(alignment: .leading, spacing: 16) {
                if let row = table.rows.first(where: { selection.contains($0.id) }) {
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
