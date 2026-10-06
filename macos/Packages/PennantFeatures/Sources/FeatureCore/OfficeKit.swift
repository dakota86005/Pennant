import AppKit
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

// The pieces League Office's and Scouting's views are drawn from (N12 Track B, D-072): a served table that can name a
// club as well as a player (`OfficeTable`), its pane with the chosen row's detail, a block of lines, a view's head and
// its loading state. They follow Major League Ops' (N8, N9) one for one, public here so both departments use them: each
// draws what the server served and nothing more, and the only ordering is the unknown-last comparator over the served
// sort keys (D-056).

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

/// A view's head: its served title, the lede (one line, its explanation a click away), drawn as updating while a newer
/// payload is read.
public struct OfficeHead: View {
    let title: Components.Schemas.Cell
    let lede: Components.Schemas.Claim
    let refreshing: Bool

    public init(title: Components.Schemas.Cell, lede: Components.Schemas.Claim, refreshing: Bool = false) {
        self.title = title
        self.lede = lede
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
            ClaimText(lede, edge: .bottom) {
                Text(verbatim: lede.text).font(.title3).foregroundStyle(.primary).multilineTextAlignment(.leading)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Served figures as a row of box figures where there is room, a list of their lines where there is not.
public struct OfficeFigures: View {
    let figures: [Components.Schemas.Claim]

    public init(_ figures: [Components.Schemas.Claim]) { self.figures = figures }

    public var body: some View {
        if !figures.isEmpty {
            ViewThatFits(in: .horizontal) {
                ReportFigures(figures: figures)
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(Array(figures.enumerated()), id: \.offset) { _, figure in
                        ClaimText(figure) {
                            HStack(alignment: .firstTextBaseline, spacing: 6) {
                                Text(verbatim: figure.text).foregroundStyle(.readableSecondary)
                                Text(verbatim: figure.value?.display ?? "").font(.headline).monospacedDigit()
                            }
                        }
                    }
                }
            }
        }
    }
}

/// What a view says while it waits or when the server refused it: the server's sentence, never "Loading" for ever; a
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
            ProblemLine(problem).frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let payload {
            content(payload)
        } else {
            ProgressView { Text("Loading") }.frame(maxWidth: .infinity, maxHeight: .infinity)
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

/// A pop-up of served choices (a club, a category), its current choice as its title; one that runs long truncates with
/// its full title in a help tag, so it is never clipped on a narrow window.
public struct OfficeChoiceMenu: View {
    let title: LocalizedStringKey
    let choices: [(text: String, hint: String?, selected: Bool)]
    let id: String
    let choose: (Int) -> Void

    public init(_ title: LocalizedStringKey, choices: [(text: String, hint: String?, selected: Bool)], id: String, choose: @escaping (Int) -> Void) {
        self.title = title
        self.choices = choices
        self.id = id
        self.choose = choose
    }

    @State private var open = false

    public var body: some View {
        let current = choices.first(where: \.selected)?.text ?? choices.first?.text ?? ""
        // A button that shows the choices in a popover, as the farm's and the clubhouse's filters do: a plain button the
        // audit and VoiceOver read by its name, with the current choice as its value
        Button {
            open = true
        } label: {
            Label { Text(verbatim: current).lineLimit(1).truncationMode(.tail) } icon: { Image(systemName: "chevron.down") }
                .labelStyle(.titleAndIcon)
        }
        .frame(maxWidth: 280, alignment: .leading)
        .fixedSize(horizontal: false, vertical: true)
        .help(Text(verbatim: current))
        .accessibilityLabel(Text(title))
        .accessibilityValue(Text(verbatim: current))
        .accessibilityIdentifier(id)
        .popover(isPresented: $open, arrowEdge: .bottom) {
            ScrollView {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(Array(choices.enumerated()), id: \.offset) { index, choice in
                        Button {
                            open = false
                            choose(index)
                        } label: {
                            HStack(spacing: 6) {
                                Image(systemName: "checkmark").opacity(choice.selected ? 1 : 0).accessibilityHidden(true)
                                Text(verbatim: choice.text)
                                if let hint = choice.hint { Text(verbatim: hint).foregroundStyle(.readableSecondary) }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                        .padding(.horizontal, 10).padding(.vertical, 4)
                        .accessibilityAddTraits(choice.selected ? .isSelected : [])
                        .accessibilityIdentifier("\(id).\(index)")
                    }
                }
                .padding(.vertical, 6)
            }
            .frame(minWidth: 240, maxHeight: 360)
            .background(Color.readablePage)
        }
    }
}

// MARK: The window's search, scoped by a view

/// A served search token as the window's search field holds it (N12 Track B: Player Search's position, level, club …).
public struct ScopedSearchToken: Identifiable, Hashable, Sendable {
    public let id: String
    public let kind: String
    public let text: String

    public init(id: String, kind: String, text: String) {
        self.id = id
        self.kind = kind
        self.text = text
    }
}

/// The window's one search field (N7), which a view can scope to itself, as Finder's and Mail's search the folder or
/// mailbox shown (N12 Track B): while a view scopes it, what is typed and the tokens chosen are the view's question
/// (Player Search), the field offers the view's tokens, and the server's whole-league suggestions stand aside. A
/// window has one search field: a second `.searchable` in the toolbar on a narrow window looped AppKit's layout.
@Observable @MainActor
public final class WindowSearch {
    public var text = ""
    public var tokens: [ScopedSearchToken] = []
    /// The tokens the field offers for what is typed (the scoping view's).
    public var suggested: [ScopedSearchToken] = []
    /// The view scoping the field (its prompt); nil when the field searches the league.
    public var scope: LocalizedStringKey?

    public init() {}

    /// The view scoping the field leaves it: back to the league's search, emptied.
    public func unscope() {
        scope = nil
        tokens = []
        suggested = []
        text = ""
    }
}

extension EnvironmentValues {
    /// The window's search field (`MainWindowModel.search`); nil outside a main window (a preview, a snapshot).
    @Entry public var windowSearch: WindowSearch?
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

    /// The served sort key for a column, or nil when it is unknown (sorted last whichever way).
    func key(_ column: String) -> SortKey? {
        guard let served = row.sort.additionalProperties[column] ?? nil else { return nil }
        if let number = served.value1 { return .number(number) }
        if let text = served.value2 { return .text(text) }
        return nil
    }

    func cell(_ column: String) -> Components.Schemas.Cell? { row.cells.additionalProperties[column] }
}

/// Sorting a column by its served keys with the unknown-last rule (D-056).
nonisolated public struct OfficeSort: SortComparator, Hashable, Sendable {
    public let column: String
    public var order: SortOrder = .forward

    public init(column: String, order: SortOrder = .forward) {
        self.column = column
        self.order = order
    }

    public func compare(_ lhs: OfficeTableRow, _ rhs: OfficeTableRow) -> ComparisonResult {
        let direction: SortDirection = order == .forward ? .ascending : .descending
        let a = lhs.key(column), b = rhs.key(column)
        if UnknownLast.precedes(a, b, direction: direction) { return .orderedAscending }
        if UnknownLast.precedes(b, a, direction: direction) { return .orderedDescending }
        return lhs.index < rhs.index ? .orderedAscending : lhs.index > rhs.index ? .orderedDescending : .orderedSame
    }

    func sorted(_ rows: [OfficeTableRow]) -> [OfficeTableRow] {
        UnknownLast.sorted(rows, by: { $0.key(column) }, direction: order == .forward ? .ascending : .descending)
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
    @State private var sortOrder: [OfficeSort] = []
    @SceneStorage private var customization: TableColumnCustomization<OfficeTableRow>
    @Environment(\.openWindow) private var openWindow
    @Environment(\.routeOpener) private var opener

    static let nameColumns: Set<String> = ["player", "club", "team", "measure"]

    /// The column naming what the row is about (its player's, else its club's), where its marks are drawn once.
    static func isSubject(_ column: String, of row: Components.Schemas.OfficeRow) -> Bool {
        row.player != nil ? column == "player" : ["club", "team"].contains(column)
    }

    static func minimumWidth(_ column: Components.Schemas.MlbColumn) -> CGFloat {
        if nameColumns.contains(column.id) { return 110 }
        return column.numeric ? 44 : 72
    }

    static func idealWidth(_ column: Components.Schemas.MlbColumn) -> CGFloat {
        if nameColumns.contains(column.id) { return 170 }
        return column.numeric ? 64 : 110
    }

    public init(_ table: Components.Schemas.OfficeTable, id: String, name: String, only: Set<String>? = nil, selection: Binding<Set<OfficeTableRow.ID>>) {
        self.table = table
        self.id = id
        self.name = name
        self.only = only
        _selection = selection
        _customization = SceneStorage(wrappedValue: TableColumnCustomization<OfficeTableRow>(), "office.table.\(id)")
    }

    private var rows: [OfficeTableRow] {
        let served = table.rows.enumerated().compactMap { offset, row -> OfficeTableRow? in
            guard only?.contains(row.id) ?? true else { return nil }
            return OfficeTableRow(row: row, index: offset)
        }
        guard let sort = sortOrder.first else { return served }
        return sort.sorted(served)
    }

    public var body: some View {
        if table.rows.isEmpty {
            Group {
                if let empty = table.empty { Text(verbatim: empty.display).foregroundStyle(.readableSecondary).help(detail: empty.hint) }
            }
            .padding(.horizontal, 28).padding(.vertical, 12)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        } else {
            nativeTable
                .accessibilityLabel(Text(verbatim: name))
                .accessibilityIdentifier("table.\(id)")
        }
    }

    private var nativeTable: some View {
        Table(of: OfficeTableRow.self, selection: $selection, sortOrder: $sortOrder, columnCustomization: $customization) {
            TableColumnForEach(table.columns, id: \.id) { column in
                TableColumn(Text(verbatim: column.title.display), sortUsing: OfficeSort(column: column.id)) { row in
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
                .width(min: Self.minimumWidth(column), ideal: Self.idealWidth(column))
                .customizationID(column.id)
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
/// room, and what the row offers to open.
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
    let head: Head
    let notes: Notes
    @State private var selection: Set<OfficeTableRow.ID> = []

    public init(
        _ table: Components.Schemas.OfficeTable,
        id: String,
        name: String,
        only: Set<String>? = nil,
        detailShare: CGFloat = 0.36,
        @ViewBuilder head: () -> Head,
        @ViewBuilder notes: () -> Notes
    ) {
        self.table = table
        self.id = id
        self.name = name
        self.only = only
        self.detailShare = detailShare
        self.head = head()
        self.notes = notes()
    }

    public var body: some View {
        TablePane(detailShare: detailShare, autosave: id) {
            head
        } table: {
            OfficeTable(table, id: id, name: name, only: only, selection: $selection)
        } detail: {
            VStack(alignment: .leading, spacing: 16) {
                if let row = table.rows.first(where: { selection.contains($0.id) }) {
                    OfficeRowDetail(row)
                } else if !table.rows.isEmpty {
                    Text("Select a row to see more.").font(.callout).foregroundStyle(.readableSecondary)
                }
                notes
            }
        }
    }
}
