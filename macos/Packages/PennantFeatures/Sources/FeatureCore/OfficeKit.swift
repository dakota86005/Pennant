import AppKit
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

// The Office kit's Mac half (N12, D-071 and D-072; D-071's amendment): the pieces every front-office view outside Major
// League Ops is drawn from, Finance's, Medical's, League Office's and Scouting's alike: a served table that can name a
// club as well as a player (`OfficeTable`), its pane with the chosen row's detail (N8's blocks, or Finance's facts,
// claims and short table), the served filters by each row's keys, a block of lines, a view's head and figures, and its
// loading state. They follow Major League Ops' (N8, N9) one for one: each draws what the server served and nothing more,
// and the only ordering is the unknown-last comparator over the served sort keys or words (D-056), or the server's own
// order where it sorts; the only narrowing is the served filters' keys on each row and the window search's words
// against the served names.

// MARK: Words

/// A served cell as words: a chip in its tone when it has one that says something, the secondary style for an unknown,
/// plain text otherwise; its help tag on hover; a mark-only cell reads its hint to VoiceOver.
public struct OfficeCell: View {
    let cell: Components.Schemas.Cell
    var chip: Bool
    /// Increased on a chosen table row (the selection's fill): the secondary style would sink into it, so the row's own
    /// foreground is used there.
    @Environment(\.backgroundProminence) private var prominence

    public init(_ cell: Components.Schemas.Cell, chip: Bool = true) {
        self.cell = cell
        self.chip = chip
    }

    public var body: some View {
        let tone = Tone(cell.tone)
        Group {
            switch tone {
            case .good, .bad, .caution where chip:
                Pill(cell.display, tone: tone)
            case .unknown:
                Text(verbatim: cell.display)
                    .foregroundStyle(prominence == .increased ? AnyShapeStyle(.primary) : AnyShapeStyle(.readableSecondary))
            default:
                Text(verbatim: cell.display)
            }
        }
        .help(detail: cell.hint)
        .accessibilityLabel(Text(verbatim: spoken))
    }

    private var spoken: String {
        let mark = !cell.display.contains { $0.isLetter || $0.isNumber }
        return mark ? (cell.hint ?? cell.display) : cell.display
    }
}

extension Components.Schemas.MlbPlayer {
    /// His organization's club (Open His Club), when served.
    public var officeClub: ClubRef? { open?.teamId.map { ClubRef(id: $0) } }
}

/// A player's served name: his window on a double-click or Return, the player's context menu, a drag.
public struct OfficePlayerName: View {
    let player: Components.Schemas.MlbPlayer
    var font: Font

    public init(_ player: Components.Schemas.MlbPlayer, font: Font = .body.weight(.semibold)) {
        self.player = player
        self.font = font
    }

    public var body: some View {
        Text(verbatim: player.name).font(font).playerName(id: player.playerId, name: player.name, opens: player.officeClub)
    }
}

/// One served line: its chips, its words (quiet in the secondary style), and the players it names.
public struct OfficeLine: View {
    let line: Components.Schemas.MlbLine

    public init(_ line: Components.Schemas.MlbLine) { self.line = line }

    public var body: some View {
        let text = Text(verbatim: line.text.display)
            .font(line.quiet ? .callout : .body)
            .foregroundStyle(line.quiet || Tone(line.text.tone) == .unknown ? Color.readableSecondary : Color.primary)
            .fixedSize(horizontal: false, vertical: true)
            .help(detail: line.text.hint)
        VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                ForEach(Array(line.chips.enumerated()), id: \.offset) { _, chip in OfficeCell(chip) }
                if line.players.count == 1, let player = line.players.first {
                    text.playerName(id: player.playerId, name: player.name, opens: player.officeClub)
                } else {
                    text
                }
            }
            if line.players.count > 1 {
                HStack(spacing: 10) {
                    ForEach(line.players, id: \.playerId) { OfficePlayerName($0, font: .callout.weight(.medium)) }
                }
            }
        }
        .accessibilityElement(children: line.players.isEmpty ? .combine : .contain)
    }
}

/// A served block: its title (or player) and chips, its claims with their basis a click away, and its lines; a
/// disclosure, closed at first, when served collapsed.
public struct OfficeBlock: View {
    let block: Components.Schemas.MlbBlock
    @State private var expanded: Bool

    public init(_ block: Components.Schemas.MlbBlock) {
        self.block = block
        _expanded = State(initialValue: !block.collapsed)
    }

    public var body: some View {
        if block.collapsed, block.title != nil || block.player != nil {
            DisclosureGroup(isExpanded: $expanded) { content.padding(.top, 4) } label: { header }
        } else {
            VStack(alignment: .leading, spacing: 6) {
                if block.title != nil || block.player != nil || !block.chips.isEmpty { header }
                content
            }
        }
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            if let player = block.player { OfficePlayerName(player) }
            if let title = block.title {
                Text(verbatim: title.display).font(.headline).help(detail: title.hint).accessibilityAddTraits(.isHeader)
            }
            ForEach(Array(block.chips.enumerated()), id: \.offset) { _, chip in OfficeCell(chip) }
        }
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 5) {
            ForEach(Array(block.claims.enumerated()), id: \.offset) { _, claim in ClaimLine(claim) }
            ForEach(Array(block.lines.enumerated()), id: \.offset) { _, line in OfficeLine(line) }
        }
    }
}

/// A view's head: its served title, byline (who prepared it and how current, optional) and lede (one line, its
/// explanation a click away), how current the data is when it is not, drawn as updating while a newer payload is read.
public struct OfficeHead: View {
    let title: Components.Schemas.Cell
    let byline: Components.Schemas.Cell?
    let parts: [Components.Schemas.Cell]
    let lede: Components.Schemas.Claim
    let freshness: Components.Schemas.Claim?
    let refreshing: Bool

    public init(
        title: Components.Schemas.Cell,
        byline: Components.Schemas.Cell? = nil,
        parts: [Components.Schemas.Cell] = [],
        lede: Components.Schemas.Claim,
        freshness: Components.Schemas.Claim? = nil,
        refreshing: Bool = false
    ) {
        self.title = title
        self.byline = byline
        self.parts = parts.isEmpty ? byline.map { [$0] } ?? [] : parts
        self.lede = lede
        self.freshness = freshness
        self.refreshing = refreshing
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(verbatim: title.display)
                    .font(.system(size: 30, weight: .bold, design: .serif))
                    .accessibilityAddTraits(.isHeader)
                if refreshing { ProgressView { Text("Refreshing") }.controlSize(.small) }
            }
            if let byline {
                // The byline on one line where it fits, else its served parts each on a line of its own: never broken
                // inside a date. A workaround of unknown cause, not a fix: the accessibility audit fails some wrapped
                // multi-line text frames whatever their colour (a wrapped "… Through May" over "6, 2040" failed at 14.9:1
                // by its pixels in the label colour, wherever it sat), and the same words on one line pass. Why the audit
                // measures a wrapped frame that way is not established
                ViewThatFits(in: .horizontal) {
                    Text(verbatim: byline.display).lineLimit(1).fixedSize()
                    VStack(alignment: .leading, spacing: 2) {
                        ForEach(Array(parts.enumerated()), id: \.offset) { _, part in
                            Text(verbatim: part.display).lineLimit(1).truncationMode(.tail).help(detail: part.hint ?? part.display)
                        }
                    }
                }
                .font(.callout)
                .foregroundStyle(.readableSecondary)
                .help(detail: byline.hint)
            }
            ClaimText(lede, edge: .bottom) {
                Text(verbatim: lede.text).font(.title3).foregroundStyle(.primary).multilineTextAlignment(.leading)
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

/// The page a view without a table is laid on: the content colour, a readable measure, scrolling as one page.
public struct OfficePage<Content: View>: View {
    let content: () -> Content

    public init(@ViewBuilder content: @escaping () -> Content) { self.content = content }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) { content() }
                .padding(.horizontal, 28).padding(.vertical, 24)
                .frame(maxWidth: 1100, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.readablePage)
    }
}

/// A segmented choice between a view's served sections (their titles), by index.
public struct OfficeSectionPicker: View {
    let titles: [String]
    @Binding var selection: Int
    let id: String

    public init(titles: [String], selection: Binding<Int>, id: String) {
        self.titles = titles
        _selection = selection
        self.id = id
    }

    public var body: some View {
        Picker(selection: $selection) {
            ForEach(Array(titles.enumerated()), id: \.offset) { index, title in Text(verbatim: title).tag(index) }
        } label: {
            Text("Section")
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .fixedSize()
        .accessibilityIdentifier(id)
    }
}

// MARK: The filters

extension Components.Schemas.OfficeFilterGroup {
    /// Whether a choice keeps a row: the first choice keeps every row, another the rows whose served key for this group
    /// names it (a row with no key for the group, his age not known, is kept only by the first). Nil keeps every row.
    public func keeps(_ choice: String?) -> ((Components.Schemas.OfficeRow) -> Bool)? {
        guard let choice, choices.contains(where: { $0.id == choice }), choice != choices.first?.id else { return nil }
        let group = id
        return { $0.filterKeys?.additionalProperties[group] == choice }
    }
}

/// The rows the chosen filters keep, and the GM's search words matched against the served names; nil keeps every row.
public func officeRowsKept(
    _ table: Components.Schemas.OfficeTable, filters: [Components.Schemas.OfficeFilterGroup], chosen: [String: String], search: String
) -> Set<String>? {
    let tests = filters.compactMap { $0.keeps(chosen[$0.id]) }
    let words = search.trimmingCharacters(in: .whitespaces)
    guard !tests.isEmpty || !words.isEmpty else { return nil }
    return Set(table.rows.filter { row in
        tests.allSatisfy { $0(row) } && (words.isEmpty || (row.player?.name ?? row.club?.name ?? "").localizedCaseInsensitiveContains(words))
    }.map(\.id))
}

/// The served filters (Contracts' groups, Free Agents' positions and ages), each one choice among a few: the one way
/// Pennant offers that (`ChoicePopover`), side by side where there is room, else one under another.
public struct OfficeFilterChoices: View {
    let groups: [Components.Schemas.OfficeFilterGroup]
    @Binding var chosen: [String: String]
    let id: String

    public init(groups: [Components.Schemas.OfficeFilterGroup], chosen: Binding<[String: String]>, id: String) {
        self.groups = groups
        _chosen = chosen
        self.id = id
    }

    public var body: some View {
        if !groups.isEmpty {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 10) { choices }
                VStack(alignment: .leading, spacing: 6) { choices }
            }
        }
    }

    private var choices: some View {
        ForEach(groups, id: \.id) { group in
            let current = chosen[group.id] ?? group.choices.first?.id
            let shown = group.choices.first { $0.id == current } ?? group.choices.first
            ChoicePopover(
                Text(verbatim: group.title.display),
                current: Text(verbatim: shown?.title.display ?? group.title.display),
                help: Text(verbatim: group.title.display),
                choices: group.choices.map { .init(verbatim: $0.title.display, hint: $0.title.hint, selected: $0.id == current) },
                id: "\(id).\(group.id)"
            ) { index in
                chosen[group.id] = group.choices[index].id
            }
        }
    }
}

// MARK: The table

extension FocusedValues {
    /// The players chosen in a served table (N12): Compare (⌥⌘C) in the Player menu takes them all.
    @Entry public var chosenPlayers: [PlayerRef]?
}

/// A served row as the table holds it: the row and its place in the served order.
nonisolated public struct OfficeTableRow: Identifiable, Hashable, Sendable {
    public let row: Components.Schemas.OfficeRow
    public let index: Int
    public var id: String { row.id }

    /// The served sort key for a column, or nil when it is unknown (sorted last whichever way). A column that sorts by its
    /// words (`byWords`) is served no keys: its cell's words are the key, an unknown cell last.
    func key(_ column: String, byWords: Bool = false) -> SortKey? {
        if byWords {
            guard let cell = cell(column), Tone(cell.tone) != .unknown else { return nil }
            return .text(cell.display)
        }
        guard let served = row.sort.additionalProperties[column] ?? nil else { return nil }
        if let number = served.value1 { return .number(number) }
        if let text = served.value2 { return .text(text) }
        return nil
    }

    func cell(_ column: String) -> Components.Schemas.Cell? { row.cells.additionalProperties[column] }
}

/// Sorting a column by its served keys (or its cells' words, `byWords`) with the unknown-last rule (D-056).
nonisolated public struct OfficeSort: SortComparator, Hashable, Sendable {
    public let column: String
    public var byWords: Bool
    public var order: SortOrder = .forward

    public init(column: String, byWords: Bool = false, order: SortOrder = .forward) {
        self.column = column
        self.byWords = byWords
        self.order = order
    }

    public func compare(_ lhs: OfficeTableRow, _ rhs: OfficeTableRow) -> ComparisonResult {
        let direction: SortDirection = order == .forward ? .ascending : .descending
        let a = lhs.key(column, byWords: byWords), b = rhs.key(column, byWords: byWords)
        if UnknownLast.precedes(a, b, direction: direction) { return .orderedAscending }
        if UnknownLast.precedes(b, a, direction: direction) { return .orderedDescending }
        return lhs.index < rhs.index ? .orderedAscending : lhs.index > rhs.index ? .orderedDescending : .orderedSame
    }

    func sorted(_ rows: [OfficeTableRow]) -> [OfficeTableRow] {
        UnknownLast.sorted(rows, by: { $0.key(column, byWords: byWords) }, direction: order == .forward ? .ascending : .descending)
    }
}

/// A served table's columns in up to four runs, in the served order: sortable, then not, then sortable, then not. A
/// native `Table` takes a sortable column and one that isn't only in groups of their own; four runs keep every served
/// table's order (Player Search's hands, Us vs Them's two clubs), and a fifth run, never served, joins the last of its kind.
nonisolated struct OfficeColumnRuns: Sendable {
    var runs: [[Components.Schemas.OfficeColumn]] = [[], [], [], []]

    init(_ columns: [Components.Schemas.OfficeColumn]) {
        var index = 0
        for column in columns {
            let sortable = column.sortable
            // Runs 0 and 2 sort, 1 and 3 don't
            if sortable != (index % 2 == 0) { index = min(index + 1, 3) }
            if sortable != (index % 2 == 0) { index = sortable ? 2 : 3 }
            runs[index].append(column)
        }
    }
}

/// A served table as a native `Table` (SWIFTUI_REBUILD.md section 3.6): the served columns (hidden, moved and resized as
/// the GM likes, remembered by the window; a column served hidden is shown from the header's menu), sorting by the served
/// keys with unknowns last, keyboard navigation and several rows chosen at once. A player's row drags as the player and
/// opens his window (a double-click, Return or the context menu, with Compare over the chosen players, ⌥⌘C); a club's
/// row opens the club's window. A filled player's grades carry the OSA mark beside his name (D-067), and our own rows
/// carry a mark of their own besides the served words that say so. Only ever placed in a `TablePane`.
public struct OfficeTable: View {
    let table: Components.Schemas.OfficeTable
    let id: String
    let name: String
    /// The rows shown, by id, in the served order (a served filter's rows); nil shows every row.
    let only: Set<String>?
    @Binding var selection: Set<OfficeTableRow.ID>
    /// The sort the server applies, where it sorts (`serverSorts`, Player Search): a column chosen asks it again.
    let serverSort: Binding<OfficeSort?>?
    @State private var sortOrder: [OfficeSort] = []
    @SceneStorage private var customization: TableColumnCustomization<OfficeTableRow>
    @Environment(\.openWindow) private var openWindow
    @Environment(\.routeOpener) private var opener

    static let nameColumns: Set<String> = ["player", "club", "team", "measure"]

    /// The column naming what the row is about (its player's, else its club's), where its marks are drawn once.
    static func isSubject(_ column: String, of row: Components.Schemas.OfficeRow) -> Bool {
        row.player != nil ? column == "player" : ["club", "team"].contains(column)
    }

    static func minimumWidth(_ column: Components.Schemas.OfficeColumn) -> CGFloat {
        if nameColumns.contains(column.id) { return 110 }
        return column.numeric ? 44 : 72
    }

    static func idealWidth(_ column: Components.Schemas.OfficeColumn) -> CGFloat {
        if nameColumns.contains(column.id) { return 170 }
        return column.numeric ? 64 : 110
    }

    public init(
        _ table: Components.Schemas.OfficeTable,
        id: String,
        name: String,
        only: Set<String>? = nil,
        selection: Binding<Set<OfficeTableRow.ID>>,
        serverSort: Binding<OfficeSort?>? = nil
    ) {
        self.table = table
        self.id = id
        self.name = name
        self.only = only
        _selection = selection
        self.serverSort = serverSort
        _customization = SceneStorage(wrappedValue: TableColumnCustomization<OfficeTableRow>(), "office.table.\(id)")
    }

    /// Whether the server sorts this table (its rows carry no keys): a column chosen is asked of it, never applied here.
    private var sortsOnServer: Bool { table.serverSorts == true && serverSort != nil }

    private var rows: [OfficeTableRow] {
        let served = table.rows.enumerated().compactMap { offset, row -> OfficeTableRow? in
            guard only?.contains(row.id) ?? true else { return nil }
            return OfficeTableRow(row: row, index: offset)
        }
        guard !sortsOnServer, let sort = sortOrder.first else { return served }
        return sort.sorted(served)
    }

    /// The table's sort: its own, or (where the server sorts) the server's, a column chosen asking it again.
    private var order: Binding<[OfficeSort]> {
        guard sortsOnServer, let serverSort else { return $sortOrder }
        return Binding { serverSort.wrappedValue.map { [$0] } ?? [] } set: { serverSort.wrappedValue = $0.first }
    }

    public var body: some View {
        if table.rows.isEmpty || rows.isEmpty {
            Group {
                if table.rows.isEmpty, let empty = table.empty {
                    Text(verbatim: empty.display).foregroundStyle(.readableSecondary).help(detail: empty.hint)
                } else if !table.rows.isEmpty, let none = table.noneKept {
                    // The filters keep none of its rows: the served sentence saying so
                    Text(verbatim: none.display).foregroundStyle(.readableSecondary).help(detail: none.hint)
                }
            }
            .padding(.horizontal, 28).padding(.vertical, 12)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(Color.readablePage)
            .accessibilityIdentifier("table.\(id).empty")
        } else {
            nativeTable
                .accessibilityLabel(Text(verbatim: name))
                .accessibilityIdentifier("table.\(id)")
        }
    }

    private var nativeTable: some View {
        let runs = OfficeColumnRuns(table.columns).runs
        return Table(of: OfficeTableRow.self, selection: $selection, sortOrder: order, columnCustomization: $customization) {
            // A column served as not sorting (`sortable: false`, one of mixed units) has no sort; the runs keep the order
            TableColumnForEach(runs[0], id: \.id) { column in
                TableColumn(Text(verbatim: column.title.display), sortUsing: OfficeSort(column: column.id, byWords: column.byWords == true)) { cellView($0, column) }
                    .width(min: Self.minimumWidth(column), ideal: Self.idealWidth(column))
                    .customizationID(column.id)
                    .defaultVisibility(column.hidden == true ? .hidden : .automatic)
            }
            TableColumnForEach(runs[1], id: \.id) { column in
                TableColumn(Text(verbatim: column.title.display)) { cellView($0, column) }
                    .width(min: Self.minimumWidth(column), ideal: Self.idealWidth(column))
                    .customizationID(column.id)
                    .defaultVisibility(column.hidden == true ? .hidden : .automatic)
            }
            TableColumnForEach(runs[2], id: \.id) { column in
                TableColumn(Text(verbatim: column.title.display), sortUsing: OfficeSort(column: column.id, byWords: column.byWords == true)) { cellView($0, column) }
                    .width(min: Self.minimumWidth(column), ideal: Self.idealWidth(column))
                    .customizationID(column.id)
                    .defaultVisibility(column.hidden == true ? .hidden : .automatic)
            }
            TableColumnForEach(runs[3], id: \.id) { column in
                TableColumn(Text(verbatim: column.title.display)) { cellView($0, column) }
                    .width(min: Self.minimumWidth(column), ideal: Self.idealWidth(column))
                    .customizationID(column.id)
                    .defaultVisibility(column.hidden == true ? .hidden : .automatic)
            }
        } rows: {
            ForEach(rows) { row in
                // A player's row drags as the player, a club's as the club (SWIFTUI_REBUILD.md section 3.6)
                if let player = row.row.player {
                    TableRow(row).draggable(PlayerRef(id: player.playerId))
                } else if let club = row.row.club {
                    TableRow(row).draggable(ClubRef(id: club.teamId))
                } else {
                    TableRow(row)
                }
            }
        }
        .tableStyle(.inset(alternatesRowBackgrounds: false))
        .scrollContentBackground(.hidden)
        .background(Color.readablePage)
        // The chosen rows' players for the Player menu: Open Player takes the first, Compare (⌥⌘C) them all
        .focusedValue(\.player, chosenPlayers.first)
        .focusedValue(\.chosenPlayers, chosenPlayers.isEmpty ? nil : chosenPlayers)
        .contextMenu(forSelectionType: OfficeTableRow.ID.self) { ids in
            if let row = table.rows.first(where: { ids.contains($0.id) }) {
                menu(for: row, chosen: Self.players(in: table.rows.filter { ids.contains($0.id) }))
            }
        } primaryAction: { ids in
            guard let row = table.rows.first(where: { ids.contains($0.id) }) else { return }
            if let player = row.player {
                openWindow(value: PlayerRef(id: player.playerId))
            } else if let club = row.club {
                openWindow(value: ClubRef(id: club.teamId))
            } else if let only = row.players, only.count == 1, let player = only.first {
                openWindow(value: PlayerRef(id: player.playerId))
            }
        }
    }

    /// A row's cell under a column: our mark and the OSA mark beside the name it is about, else the cell alone.
    @ViewBuilder
    private func cellView(_ row: OfficeTableRow, _ column: Components.Schemas.OfficeColumn) -> some View {
        if let cell = row.cell(column.id) {
            if Self.isSubject(column.id, of: row.row), row.row.ratingsFill != nil || row.row.ours == true {
                HStack(spacing: 4) {
                    if row.row.ours == true { OursMark() }
                    OfficeCell(cell).monospacedDigit().lineLimit(1)
                    if let fill = row.row.ratingsFill { RatingFillMark(fill) }
                }
            } else {
                OfficeCell(cell).monospacedDigit().lineLimit(1)
            }
        }
    }

    private var chosenPlayers: [PlayerRef] { Self.players(in: table.rows.filter { selection.contains($0.id) }) }

    /// The players the chosen rows name, in the table's order, each once.
    public static func players(in rows: [Components.Schemas.OfficeRow]) -> [PlayerRef] {
        var seen = Set<Int>()
        return rows.flatMap { row in row.player.map { [$0] } ?? row.players ?? [] }
            .filter { seen.insert($0.playerId).inserted }
            .map { PlayerRef(id: $0.playerId) }
    }

    @ViewBuilder
    private func menu(for row: Components.Schemas.OfficeRow, chosen: [PlayerRef]) -> some View {
        if let player = row.player {
            OpenPlayerMenuItem(PlayerRef(id: player.playerId))
            if let club = player.officeClub {
                Button("Open His Club", systemImage: "macwindow.badge.plus") { openWindow(value: club) }
            }
            CompareMenuItem(chosen)
            FollowMenuItem(kind: "player", id: player.playerId)
            Button("Copy Name", systemImage: "doc.on.doc") { copy(player.name) }
        } else if let named = row.players, !named.isEmpty {
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
        if let club = row.club {
            Button("Open Club", systemImage: "macwindow.badge.plus") { openWindow(value: ClubRef(id: club.teamId)) }
            FollowMenuItem(kind: "club", id: club.teamId)
            Button("Copy Name", systemImage: "doc.on.doc") { copy(club.name) }
        }
        let actions = row.actions.filter { $0.open.kind.value1 != .club }.compactMap { action in route(action.open).map { (action, $0) } }
            .filter { opener?.canOpen($0.1) == true }
        if !actions.isEmpty {
            Divider()
            ForEach(Array(actions.enumerated()), id: \.offset) { _, pair in
                Button { opener?.open(pair.1) } label: { Text(verbatim: pair.0.text.display) }
            }
        }
    }
}

/// The mark beside our own row's name (the row's words say so too): in the row's own colour on a chosen row.
struct OursMark: View {
    @Environment(\.backgroundProminence) private var prominence

    var body: some View {
        Image(systemName: "star.fill").font(.caption2)
            .foregroundStyle(prominence == .increased ? AnyShapeStyle(.primary) : AnyShapeStyle(.readableSecondary))
            .accessibilityHidden(true)
    }
}

/// One row's served detail: the player or club and the row's claim, the detail's blocks side by side when there is
/// room, the row's facts, claims and short table (Finance and Medical), and what the row offers to open.
public struct OfficeRowDetail: View {
    let row: Components.Schemas.OfficeRow
    @Environment(\.openWindow) private var openWindow
    @Environment(\.routeOpener) private var opener

    public init(_ row: Components.Schemas.OfficeRow) { self.row = row }

    public var body: some View {
        Card {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    if let player = row.player { OfficePlayerName(player, font: .title3.weight(.semibold)) }
                    if let club = row.club {
                        Text(verbatim: club.name).font(.title3.weight(.semibold)).clubName(id: club.teamId, name: club.name)
                    }
                    if let claim = row.claim { ClaimLine(claim) }
                    Spacer(minLength: 0)
                }
                if !row.detail.isEmpty {
                    ViewThatFits(in: .horizontal) {
                        HStack(alignment: .top, spacing: 24) {
                            ForEach(Array(row.detail.enumerated()), id: \.offset) { _, block in
                                OfficeBlock(block).frame(minWidth: 220, maxWidth: .infinity, alignment: .topLeading)
                            }
                        }
                        VStack(alignment: .leading, spacing: 14) {
                            ForEach(Array(row.detail.enumerated()), id: \.offset) { _, block in OfficeBlock(block) }
                        }
                    }
                }
                // Finance's and Medical's detail: the row's facts, its claims (each with its basis a click away) and its short table
                if let facts = row.facts, !facts.isEmpty { OfficeFacts(facts) }
                ForEach(Array((row.claims ?? []).enumerated()), id: \.offset) { _, claim in ClaimLine(claim, font: .callout) }
                if let grid = row.grid { OfficeGridView(grid) }
                if let named = row.players, row.player == nil, !named.isEmpty {
                    HStack(spacing: 10) {
                        ForEach(named, id: \.playerId) { OfficePlayerName($0, font: .callout.weight(.medium)) }
                    }
                }
                actions
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("row.detail")
    }

    @ViewBuilder
    private var actions: some View {
        let openable = row.actions.compactMap { action -> (Components.Schemas.MlbAction, AppRoute?)? in
            action.open.kind.value1 == .club ? (action, nil) : route(action.open).map { (action, $0) }
        }
        if !openable.isEmpty {
            HStack(spacing: 8) {
                ForEach(Array(openable.enumerated()), id: \.offset) { _, pair in
                    Button {
                        if let route = pair.1 { opener?.open(route) } else if let team = pair.0.open.teamId { openWindow(value: ClubRef(id: team)) }
                    } label: {
                        Label { Text(verbatim: pair.0.text.display) } icon: { Image(systemName: "arrow.forward.circle") }
                    }
                    .help(detail: pair.0.text.hint)
                }
            }
            .controlSize(.small)
        }
    }
}

/// A served table in a `TablePane`: the view's head above it, and beneath it the chosen row's served detail, then the
/// view's own notes; with nothing chosen, a line saying how to see a row's detail, and the notes.
public struct OfficeTablePane<Head: View, Notes: View>: View {
    let table: Components.Schemas.OfficeTable
    let id: String
    let name: String
    let only: Set<String>?
    let detailShare: CGFloat
    let serverSort: Binding<OfficeSort?>?
    /// The chosen row as its detail draws it: the served row, or (the Draft Board) the row with what was read when it was
    /// chosen; `chose` hears each choice, so a view can read it.
    let detailOf: (Components.Schemas.OfficeRow) -> Components.Schemas.OfficeRow
    let chose: (String?) -> Void
    let head: Head
    let notes: Notes
    @State private var selection: Set<OfficeTableRow.ID> = []

    /// The chosen row, when the filters still show it.
    private var chosenRow: Components.Schemas.OfficeRow? {
        table.rows.first { selection.contains($0.id) && (only?.contains($0.id) ?? true) }
    }

    public init(
        _ table: Components.Schemas.OfficeTable,
        id: String,
        name: String,
        only: Set<String>? = nil,
        detailShare: CGFloat = 0.36,
        serverSort: Binding<OfficeSort?>? = nil,
        detailOf: @escaping (Components.Schemas.OfficeRow) -> Components.Schemas.OfficeRow = { $0 },
        chose: @escaping (String?) -> Void = { _ in },
        @ViewBuilder head: () -> Head,
        @ViewBuilder notes: () -> Notes
    ) {
        self.table = table
        self.id = id
        self.name = name
        self.only = only
        self.detailShare = detailShare
        self.serverSort = serverSort
        self.detailOf = detailOf
        self.chose = chose
        self.head = head()
        self.notes = notes()
    }

    public var body: some View {
        TablePane(detailShare: detailShare, autosave: id) {
            head
        } table: {
            OfficeTable(table, id: id, name: name, only: only, selection: $selection, serverSort: serverSort)
        } detail: {
            VStack(alignment: .leading, spacing: 16) {
                if let row = chosenRow {
                    OfficeRowDetail(detailOf(row))
                } else if !table.rows.isEmpty {
                    if let choose = table.choose {
                        Text(verbatim: choose.display).font(.callout).foregroundStyle(.readableSecondary)
                    } else {
                        Text("Select a row to see more.").font(.callout).foregroundStyle(.readableSecondary)
                    }
                }
                notes
            }
        }
        .onChange(of: chosenRow?.id) { _, now in chose(now) }
    }
}

// MARK: Finance's and Medical's detail

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
