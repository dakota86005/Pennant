import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

// The pieces Finance's and Medical's views are drawn from (N12; D-071): the served head, figures, a native table of
// served rows with what goes with the chosen row beneath it, and the served filters. Each draws what the server served
// and nothing more: every word, tone, order and sort key is the payload's; the only ordering here is the unknown-last
// comparator over the served keys, and the only narrowing the served filters' own rows (and the GM's own search words
// against the served names).

public typealias OfficeTable = Components.Schemas.OfficeTable
public typealias OfficeRow = Components.Schemas.OfficeRow
public typealias OfficeFilterGroup = Components.Schemas.OfficeFilterGroup

/// A served row as a table holds it: the row and its place in the served order (the order an unsorted table keeps).
public struct OfficeRowItem: Identifiable, Hashable, Sendable {
    public let row: OfficeRow
    public let index: Int
    public var id: String { row.id }

    public init(row: OfficeRow, index: Int) {
        self.row = row
        self.index = index
    }

    /// The served sort key for a column, or nil when it is unknown (sorted last whichever way).
    public func key(_ column: String) -> SortKey? {
        guard let served = row.sort.additionalProperties[column] ?? nil else { return nil }
        return .served(served.value1, served.value2)
    }

    /// The served cell for a column (every column has one).
    public func cell(_ column: String) -> Components.Schemas.Cell? { row.cells.additionalProperties[column] }

    /// The player the row names, as a window's value.
    public var player: PlayerRef? { row.player.map { PlayerRef(id: $0.playerId) } }
}

extension OfficeFilterGroup {
    /// The rows a choice keeps (the first choice keeps them all).
    public func rows(_ choice: String?) -> Set<String>? {
        guard let choice, let chosen = choices.first(where: { $0.id == choice }), chosen.id != choices.first?.id else { return nil }
        return Set(chosen.rows)
    }
}

/// The rows the chosen filters keep, and the GM's search words matched against the served names; nil keeps every row.
public func officeRowsKept(_ table: OfficeTable, filters: [OfficeFilterGroup], chosen: [String: String], search: String) -> Set<String>? {
    var kept: Set<String>?
    for group in filters {
        guard let rows = group.rows(chosen[group.id]) else { continue }
        kept = kept.map { $0.intersection(rows) } ?? rows
    }
    let words = search.trimmingCharacters(in: .whitespaces)
    if !words.isEmpty {
        let named = Set(table.rows.filter { ($0.player?.name ?? "").localizedCaseInsensitiveContains(words) }.map(\.id))
        kept = kept.map { $0.intersection(named) } ?? named
    }
    return kept
}

// MARK: The head

/// A view's head: its served title, byline and lede (its explanation a click away), and how current the data is when
/// it is not.
public struct OfficeHead: View {
    let title: String
    let byline: Components.Schemas.Cell
    let lede: Components.Schemas.Claim
    let freshness: Components.Schemas.Claim?
    let refreshing: Bool

    public init(title: String, byline: Components.Schemas.Cell, lede: Components.Schemas.Claim, freshness: Components.Schemas.Claim?, refreshing: Bool) {
        self.title = title
        self.byline = byline
        self.lede = lede
        self.freshness = freshness
        self.refreshing = refreshing
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(verbatim: byline.display)
                .font(.callout)
                .foregroundStyle(.readableSecondary)
                .help(detail: byline.hint)
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(verbatim: title)
                    .font(.system(size: 30, weight: .bold, design: .serif))
                    .accessibilityAddTraits(.isHeader)
                if refreshing { ProgressView { Text("Refreshing") }.controlSize(.small) }
            }
            ClaimText(lede, edge: .bottom) {
                Text(verbatim: lede.text).font(.title3).multilineTextAlignment(.leading)
            }
            if let freshness {
                ClaimText(freshness, edge: .bottom) {
                    Label { Text(verbatim: freshness.text) } icon: { ToneMark(served: freshness.tone) }
                        .font(.callout)
                }
                .accessibilityIdentifier("office.freshness")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Served figures: in a row of box figures where there is room, a list of their lines where there is not.
public struct OfficeFigures: View {
    let figures: [Components.Schemas.Claim]

    public init(_ figures: [Components.Schemas.Claim]) {
        self.figures = figures
    }

    public var body: some View {
        if !figures.isEmpty {
            ViewThatFits(in: .horizontal) {
                ReportFigures(figures: figures)
                // Three to a row where the box score has no room (the narrow column), each with its basis a click away
                Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 18, verticalSpacing: 10) {
                    ForEach(Array(stride(from: 0, to: figures.count, by: 3)), id: \.self) { start in
                        GridRow {
                            ForEach(Array(figures[start..<min(start + 3, figures.count)].enumerated()), id: \.offset) { _, figure in
                                ClaimText(figure) {
                                    VStack(alignment: .leading, spacing: 1) {
                                        Text(verbatim: figure.value?.display ?? "").font(.headline).monospacedDigit()
                                        Text(verbatim: figure.text).font(.callout).foregroundStyle(.readableSecondary)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text("Key Figures"))
            .accessibilityIdentifier("office.figures")
        }
    }
}

/// What a view says while it waits or when the server refused it: the server's sentence, never "Loading" for ever. A
/// failed read shows its problem even when an earlier payload is held.
public struct OfficeState<Payload, Content: View>: View {
    let payload: Payload?
    let problem: RequestProblem?
    let content: (Payload) -> Content

    public init(payload: Payload?, problem: RequestProblem?, @ViewBuilder content: @escaping (Payload) -> Content) {
        self.payload = payload
        self.problem = problem
        self.content = content
    }

    public var body: some View {
        if let problem {
            ProblemLine(problem).frame(maxWidth: .infinity, maxHeight: .infinity).background(Color.readablePage)
        } else if let payload {
            content(payload)
        } else {
            ProgressView { Text("Loading") }.frame(maxWidth: .infinity, maxHeight: .infinity).background(Color.readablePage)
        }
    }
}

// MARK: The table

/// A served table as a native `Table` (SWIFTUI_REBUILD.md section 3.6): the served columns (each can be hidden, moved and
/// resized, and the window remembers how), sorting by the served keys with unknowns last (the served order until a header
/// is clicked; a column served as not sortable keeps it), several rows chosen at once, a player's row that drags as the
/// player, and a context menu that opens his window (also a double-click or Return), compares the chosen players,
/// follows him or copies his name. A filled player's grades carry the OSA mark beside his name (D-067). It is only ever
/// placed in a `TablePane`, never inside a page's scroll view (the N8 crash).
public struct OfficeTableView: View {
    let table: OfficeTable
    let id: String
    let name: String
    let kept: Set<String>?
    @Binding var selection: Set<String>
    @State private var sortOrder: [ServedColumnSort<OfficeRowItem>] = []
    @SceneStorage private var customization: TableColumnCustomization<OfficeRowItem>
    @Environment(\.openWindow) private var openWindow

    public init(_ table: OfficeTable, id: String, name: String, kept: Set<String>? = nil, selection: Binding<Set<String>>) {
        self.table = table
        self.id = id
        self.name = name
        self.kept = kept
        _selection = selection
        _customization = SceneStorage(wrappedValue: TableColumnCustomization<OfficeRowItem>(), "office.table.\(id)")
    }

    private var rows: [OfficeRowItem] {
        let served = table.rows.enumerated()
            .filter { kept?.contains($0.element.id) ?? true }
            .map { OfficeRowItem(row: $0.element, index: $0.offset) }
        return ServedRows.sorted(served, by: sortOrder)
    }

    /// A column's narrowest and starting widths: a name wide, a number narrow, words between.
    static func widths(_ column: Components.Schemas.OfficeColumn) -> (min: CGFloat, ideal: CGFloat) {
        if column.id == "player" { return (110, 170) }
        return column.numeric ? (52, 86) : (64, 110)
    }

    public var body: some View {
        let shown = rows
        if shown.isEmpty {
            Group {
                if table.rows.isEmpty, let empty = table.empty {
                    Text(verbatim: empty.display).foregroundStyle(.readableSecondary).help(detail: empty.hint)
                } else if !table.rows.isEmpty {
                    Text("No players match these filters.").foregroundStyle(.readableSecondary)
                }
            }
            .padding(.horizontal, 28).padding(.vertical, 12)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(Color.readablePage)
            .accessibilityIdentifier("table.\(id).empty")
        } else {
            nativeTable(shown)
                .accessibilityLabel(Text(verbatim: name))
                .accessibilityIdentifier("table.\(id)")
        }
    }

    private func nativeTable(_ shown: [OfficeRowItem]) -> some View {
        Table(of: OfficeRowItem.self, selection: $selection, sortOrder: $sortOrder, columnCustomization: $customization) {
            TableColumnForEach(table.columns, id: \.id) { column in
                TableColumn(Text(verbatim: column.title.display), sortUsing: ServedColumnSort<OfficeRowItem>(column.id) { row in
                    column.sortable ? row.key(column.id) : nil
                }) { row in
                    if let cell = row.cell(column.id) {
                        if column.id == "player", let fill = row.row.ratingsFill {
                            HStack(spacing: 4) {
                                CellText(cell).lineLimit(1)
                                RatingFillMark(fill)
                            }
                        } else {
                            CellText(cell).monospacedDigit().lineLimit(1)
                        }
                    }
                }
                .width(min: Self.widths(column).min, ideal: Self.widths(column).ideal)
                .customizationID(column.id)
                .defaultVisibility(column.hidden == true ? .hidden : .automatic)
            }
        } rows: {
            ForEach(shown) { row in
                if let player = row.player {
                    TableRow(row).draggable(player)
                } else {
                    TableRow(row)
                }
            }
        }
        .tableStyle(.inset(alternatesRowBackgrounds: false))
        .scrollContentBackground(.hidden)
        .background(Color.readablePage)
        .contextMenu(forSelectionType: OfficeRowItem.ID.self) { ids in
            let chosen = table.rows.filter { ids.contains($0.id) }
            if let row = chosen.first, let player = row.player {
                OpenPlayerMenuItem(PlayerRef(id: player.playerId))
                CompareMenuItem(Self.players(in: chosen))
                FollowMenuItem(kind: "player", id: player.playerId)
                Button("Copy Name", systemImage: "doc.on.doc") { copy(player.name) }
            }
        } primaryAction: { ids in
            if let player = table.rows.first(where: { ids.contains($0.id) })?.player { openWindow(value: PlayerRef(id: player.playerId)) }
        }
    }

    /// The players the chosen rows name, in the table's order, each once.
    public static func players(in rows: [OfficeRow]) -> [PlayerRef] {
        var seen = Set<Int>()
        return rows.compactMap(\.player).filter { seen.insert($0.playerId).inserted }.map { PlayerRef(id: $0.playerId) }
    }
}

/// A served table in a `TablePane`: the view's head above it, the chosen row's served detail beneath it (or, with
/// nothing chosen, a line saying how to see one, and the view's notes).
public struct OfficeTablePane<Head: View, Notes: View>: View {
    let table: OfficeTable
    let id: String
    let name: String
    let kept: Set<String>?
    let detailShare: CGFloat
    let head: Head
    let notes: Notes
    @State private var selection: Set<String> = []

    public init(
        _ table: OfficeTable,
        id: String,
        name: String,
        kept: Set<String>? = nil,
        detailShare: CGFloat = 0.36,
        @ViewBuilder head: () -> Head,
        @ViewBuilder notes: () -> Notes
    ) {
        self.table = table
        self.id = id
        self.name = name
        self.kept = kept
        self.detailShare = detailShare
        self.head = head()
        self.notes = notes()
    }

    public var body: some View {
        TablePane(detailShare: detailShare, autosave: "office.\(id)") {
            head
        } table: {
            OfficeTableView(table, id: id, name: name, kept: kept, selection: $selection)
        } detail: {
            VStack(alignment: .leading, spacing: 16) {
                if let row = table.rows.first(where: { selection.contains($0.id) && (kept?.contains($0.id) ?? true) }) {
                    OfficeRowDetail(row: row)
                } else if !table.rows.isEmpty {
                    Text("Select a row to see more.").font(.callout).foregroundStyle(.readableSecondary)
                }
                notes
            }
        }
    }
}

/// One row's served detail: the player, his facts as a grid, the row's claims (each with its basis a click away), the
/// short table beneath it, and his window.
public struct OfficeRowDetail: View {
    let row: OfficeRow
    @Environment(\.openWindow) private var openWindow

    public init(row: OfficeRow) {
        self.row = row
    }

    public var body: some View {
        Card {
            VStack(alignment: .leading, spacing: 12) {
                if let player = row.player {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(verbatim: player.name)
                            .font(.title3.weight(.semibold))
                            .playerName(id: player.playerId, name: player.name, opens: clubRef(opening: player.open))
                        if let fill = row.ratingsFill { RatingFillMark(fill) }
                        Spacer(minLength: 0)
                        Button { openWindow(value: PlayerRef(id: player.playerId)) } label: {
                            Label("Open Player", systemImage: "person.text.rectangle")
                        }
                        .controlSize(.small)
                        .accessibilityIdentifier("office.openPlayer")
                    }
                }
                if !row.facts.isEmpty {
                    OfficeFacts(row.facts)
                }
                ForEach(Array(row.claims.enumerated()), id: \.offset) { _, claim in ClaimLine(claim, font: .callout) }
                if let grid = row.grid { OfficeGridView(grid) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("row.detail")
    }
}

/// Label and value facts: a grid where there is room, stacked where there is not.
public struct OfficeFacts: View {
    let facts: [Components.Schemas.OfficeFact]

    public init(_ facts: [Components.Schemas.OfficeFact]) {
        self.facts = facts
    }

    public var body: some View {
        ViewThatFits(in: .horizontal) {
            Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 14, verticalSpacing: 5) {
                ForEach(Array(facts.enumerated()), id: \.offset) { _, fact in
                    GridRow {
                        Text(verbatim: fact.label.display).foregroundStyle(.readableSecondary)
                        CellText(fact.value).fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            VStack(alignment: .leading, spacing: 6) {
                ForEach(Array(facts.enumerated()), id: \.offset) { _, fact in
                    VStack(alignment: .leading, spacing: 1) {
                        Text(verbatim: fact.label.display).font(.caption).foregroundStyle(.readableSecondary)
                        CellText(fact.value).fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
        .font(.callout)
    }
}

/// A short served table drawn as a grid (a contract's seasons under control): its title, its columns and its rows.
public struct OfficeGridView: View {
    let grid: Components.Schemas.OfficeGrid

    public init(_ grid: Components.Schemas.OfficeGrid) {
        self.grid = grid
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(verbatim: grid.title.display).font(.headline)
            if grid.rows.isEmpty, let empty = grid.empty {
                Text(verbatim: empty.display).foregroundStyle(.readableSecondary)
            } else {
                Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 16, verticalSpacing: 4) {
                    GridRow {
                        ForEach(Array(grid.columns.enumerated()), id: \.offset) { _, title in
                            Text(verbatim: title.display).font(.caption.weight(.semibold)).foregroundStyle(.readableSecondary)
                        }
                    }
                    ForEach(Array(grid.rows.enumerated()), id: \.offset) { _, cells in
                        GridRow {
                            ForEach(Array(cells.enumerated()), id: \.offset) { _, cell in CellText(cell).monospacedDigit() }
                        }
                    }
                }
                .font(.callout)
            }
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: The filters

/// The served filters as the window's toolbar does a view choice: one button whose popover holds each group as a
/// labelled radio group (a toolbar pull-down was found by the audit with no action to press; N8's choice popover).
public struct OfficeFilterButton: View {
    let groups: [OfficeFilterGroup]
    @Binding var chosen: [String: String]
    let id: String
    @State private var open = false

    public init(groups: [OfficeFilterGroup], chosen: Binding<[String: String]>, id: String) {
        self.groups = groups
        _chosen = chosen
        self.id = id
    }

    private var active: Bool {
        groups.contains { g in chosen[g.id].map { $0 != g.choices.first?.id } ?? false }
    }

    public var body: some View {
        if !groups.isEmpty {
            Button { open.toggle() } label: {
                Label("Filter", systemImage: active ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
            }
            .help(Text("Filter"))
            .accessibilityIdentifier(id)
            .popover(isPresented: $open, arrowEdge: .bottom) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        ForEach(groups, id: \.id) { group in
                            VStack(alignment: .leading, spacing: 6) {
                                Text(verbatim: group.title.display).font(.headline)
                                Picker(selection: Binding(
                                    get: { chosen[group.id] ?? group.choices.first?.id ?? "" },
                                    set: { chosen[group.id] = $0 }
                                )) {
                                    ForEach(group.choices, id: \.id) { choice in
                                        Text(verbatim: choice.title.display).help(detail: choice.title.hint).tag(choice.id)
                                    }
                                } label: {
                                    Text(verbatim: group.title.display)
                                }
                                .pickerStyle(.radioGroup)
                                .labelsHidden()
                                .accessibilityIdentifier("\(id).\(group.id)")
                            }
                        }
                        if active {
                            Button("Show Everyone") { chosen = [:] }
                                .accessibilityIdentifier("\(id).reset")
                        }
                    }
                    .padding(16)
                }
                .frame(minWidth: 260, maxHeight: 420, alignment: .leading)
                .background(Color.readablePage)
            }
        }
    }
}
