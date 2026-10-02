import AppKit
import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

// What Farm & Development's views share (N10): the page frame, a finding, a player's name and the rows' menus. Every
// word is served; the views add only structural labels from the String Catalog.

/// A farm view's page: the masthead (the staff, the date, the view's served name and its deck), then the content, in the
/// report's measure. A failed reload says so above what is kept.
struct FarmPage<Figures: View, Content: View>: View {
    @Environment(AppModel.self) private var model
    let view: String
    let head: Head
    let deck: Components.Schemas.Claim?
    let updating: Bool
    let problem: RequestProblem?
    /// A served headline in place of the view's name (a Decision's player), its deck, and what wraps it (his name's menu).
    var headline: String?
    var deckText: String?
    var decorate: (@MainActor (AnyView) -> AnyView)?
    @ViewBuilder let figures: () -> Figures
    @ViewBuilder let content: () -> Content

    /// The served head every farm view carries.
    struct Head {
        let preparedBy: Components.Schemas.Cell
        let asOf: Components.Schemas.Cell
    }

    var body: some View {
        MastheadScrollView {
            ClubMagazineMasthead(
                kicker: [head.preparedBy.display, head.asOf.display],
                kickerHint: head.asOf.hint,
                kickerStatus: updating ? String(localized: "Updating") : nil,
                headline: Text(verbatim: headline ?? model.servedViewName(department: "farm", view: view) ?? ""),
                deck: deck,
                deckText: deckText,
                decorateHeadline: decorate,
                figures: figures
            )
        } content: {
            VStack(alignment: .leading, spacing: 22) {
                if let problem { ProblemLine(problem) }
                content()
            }
            .padding(.horizontal, 28).padding(.vertical, 24)
            .frame(maxWidth: 1100, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        // A fixed, checked page, never a system background (the words' contrast is measured against it)
        .background(Color.readablePage)
    }
}

extension FarmPage where Figures == EmptyView {
    init(
        view: String, head: Head, deck: Components.Schemas.Claim?, updating: Bool, problem: RequestProblem?,
        headline: String? = nil, deckText: String? = nil, decorate: (@MainActor (AnyView) -> AnyView)? = nil,
        @ViewBuilder content: @escaping () -> Content
    ) {
        self.init(view: view, head: head, deck: deck, updating: updating, problem: problem, headline: headline, deckText: deckText, decorate: decorate, figures: { EmptyView() }, content: content)
    }
}

/// A section of a farm page: a structural title, an optional served note under it, then its content.
struct FarmSection<Content: View>: View {
    let title: LocalizedStringResource
    let note: Components.Schemas.Cell?
    @ViewBuilder let content: () -> Content

    init(_ title: LocalizedStringResource, note: Components.Schemas.Cell? = nil, @ViewBuilder content: @escaping () -> Content) {
        self.title = title
        self.note = note
        self.content = content
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.title3.weight(.semibold)).accessibilityAddTraits(.isHeader)
            if let note {
                Text(verbatim: note.display).font(.callout).foregroundStyle(.readableSecondary).help(detail: note.hint)
                    .fixedSize(horizontal: false, vertical: true)
            }
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }
}

/// Served lines, one to a line, each with its tone's symbol when it has one.
struct ServedLines: View {
    let lines: [Components.Schemas.Cell]
    var font: Font = .body

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Image(systemName: "circle.fill").font(.system(size: 4)).foregroundStyle(.readableSecondary).accessibilityHidden(true)
                    CellText(line).font(font).fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A served line about something not known: the unknown's symbol, the words, in the content's own colours.
struct UnknownLine: View {
    let cell: Components.Schemas.Cell

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            ToneMark(.unknown)
            Text(verbatim: cell.display).fixedSize(horizontal: false, vertical: true)
        }
        .help(detail: cell.hint)
        .accessibilityElement(children: .combine)
    }
}

// MARK: A finding

/// One finding of Minor League Operations or Player Development: its severity, its sentence (its evidence a click away),
/// who raised it; open, its evidence, the players it names, what is missing and what would settle it.
struct FindingView: View {
    let finding: Components.Schemas.FarmFindingView

    init(_ finding: Components.Schemas.FarmFindingView) {
        self.finding = finding
    }

    var body: some View {
        Fold(open: finding.expanded) {
            VStack(alignment: .leading, spacing: 8) {
                if !finding.evidence.isEmpty {
                    FarmFacts(facts: finding.evidence.map { .init(id: $0.id, label: $0.cells.label.display, value: $0.cells.value, why: $0.cells.why.display) })
                }
                ForEach(finding.players, id: \.playerId) { player in
                    FarmPlayerName(player: player).font(.callout)
                }
                if !finding.missing.isEmpty {
                    LabeledLines(title: "Not established", lines: finding.missing)
                }
                if !finding.wouldSettle.isEmpty {
                    LabeledLines(title: "What would settle it", lines: finding.wouldSettle)
                }
            }
            .padding(.top, 4)
        } label: {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Pill(finding.severity.display, tone: Tone(finding.severity.tone))
                ClaimText(finding.headline, edge: .trailing) {
                    Text(verbatim: finding.headline.text).fixedSize(horizontal: false, vertical: true)
                }
                Text(verbatim: finding.owner.display).font(.callout).foregroundStyle(.readableSecondary)
            }
        }
        // A container of its own, so the identifier is the finding's and not put on every element inside it
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("farm.finding.\(finding.id)")
    }
}

/// A structural title over served lines ("Not established", "What would settle it").
struct LabeledLines: View {
    let title: LocalizedStringResource
    let lines: [Components.Schemas.Cell]

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.callout.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
            ServedLines(lines: lines, font: .callout)
        }
        // Each line wraps to the column rather than running past its edge (the review's M4)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: A player

/// A farm player's served line, his name the way names work across the app: a double-click or Return opens his Decision
/// in this window, the context menu opens it, follows him and copies his name, and he can be dragged (onto Following).
struct FarmPlayerName: View {
    let player: Components.Schemas.FarmPlayerLine

    var body: some View {
        Text(verbatim: player.line.display)
            .fixedSize(horizontal: false, vertical: true)
            .help(detail: player.line.hint)
            .farmPlayer(id: player.playerId, name: player.name, open: player.open)
    }
}

extension View {
    /// A farm player's name: his Decision (the served target) on a double-click or Return, the farm's menu, a drag.
    func farmPlayer(id: Int, name: String, open: Components.Schemas.Target?) -> some View {
        modifier(FarmPlayerModifier(id: id, name: name, open: open))
    }
}

struct FarmPlayerModifier: ViewModifier {
    let id: Int
    let name: String
    let open: Components.Schemas.Target?
    @Environment(\.routeOpener) private var opener

    private var openable: AppRoute? {
        guard let r = route(open), opener?.canOpen(r) ?? false else { return nil }
        return r
    }

    func body(content: Content) -> some View {
        content
            .contentShape(.rect)
            .focusable()
            .onKeyPress(.return) {
                guard let openable else { return .ignored }
                opener?.open(openable)
                return .handled
            }
            .onTapGesture(count: 2) { if let openable { opener?.open(openable) } }
            .contextMenu { FarmPlayerMenu(id: id, name: name, open: open) }
            .draggable(PlayerRef(id: id)) {
                Label { Text(verbatim: name) } icon: { Image(systemName: "person") }
                    .padding(6).background(.regularMaterial, in: .capsule)
            }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(openable != nil ? .isButton : [])
            .accessibilityAction { if let openable { opener?.open(openable) } }
            .accessibilityIdentifier("farm.player.\(id)")
    }
}

/// A farm player's menu: Open Decision (where the served target leads), Follow or Unfollow, Copy Name.
struct FarmPlayerMenu: View {
    let id: Int
    let name: String
    let open: Components.Schemas.Target?
    @Environment(\.routeOpener) private var opener

    var body: some View {
        if let r = route(open), opener?.canOpen(r) ?? false {
            Button("Open Decision", systemImage: "checkmark.seal") { opener?.open(r) }
        }
        FollowMenuItem(kind: "player", id: id)
        Divider()
        Button("Copy Name", systemImage: "doc.on.doc") {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(name, forType: .string)
        }
    }
}

/// Opens a served target in the window, when this build has its view.
@MainActor
func openServed(_ target: Components.Schemas.Target?, with opener: (any RouteOpening)?) {
    guard let r = route(target), opener?.canOpen(r) ?? false else { return }
    opener?.open(r)
}

/// A toolbar filter: a button naming the current choice that opens the choices in a popover, the chosen one checked, as
/// N8's what-if does (the pull-down `Menu` and the pop-up `Picker` were both found by the accessibility audit with no
/// action to press).
struct FilterMenu<ID: Hashable>: View {
    let title: LocalizedStringResource
    let systemImage: String
    let choices: [(id: ID, text: Text)]
    let current: Text
    @Binding var selection: ID
    @State private var choosing = false

    var body: some View {
        Button {
            choosing = true
        } label: {
            Label { current } icon: { Image(systemName: systemImage) }
                .labelStyle(.titleAndIcon)
        }
        .help(Text(title))
        .accessibilityValue(current)
        .popover(isPresented: $choosing, arrowEdge: .bottom) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.callout.weight(.semibold)).foregroundStyle(.readableSecondary)
                    .padding(.horizontal, 10).padding(.bottom, 4)
                    .accessibilityAddTraits(.isHeader)
                ForEach(Array(choices.enumerated()), id: \.offset) { _, choice in
                    Button {
                        choosing = false
                        selection = choice.id
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "checkmark").opacity(choice.id == selection ? 1 : 0).accessibilityHidden(true)
                            choice.text
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .padding(.horizontal, 10).padding(.vertical, 4)
                    .accessibilityAddTraits(choice.id == selection ? .isSelected : [])
                }
            }
            .padding(.vertical, 8)
            .frame(minWidth: 220, alignment: .leading)
            .background(Color.readablePage)
        }
    }
}

/// The served level filter: every level, then each served level by name.
struct LevelPicker: View {
    let levels: [Components.Schemas.FarmLevelChoice]
    @Binding var selection: String?

    var body: some View {
        FilterMenu(
            title: "Level",
            systemImage: "square.stack.3d.up",
            choices: [(id: String?.none, text: Text("All Levels"))] + levels.map { (id: String?.some($0.id), text: Text(verbatim: $0.name)) },
            current: selection.flatMap { id in levels.first { $0.id == id } }.map { Text(verbatim: $0.name) } ?? Text("All Levels"),
            selection: $selection
        )
        .accessibilityIdentifier("farm.filter.level")
    }
}

/// The view's load, keyed on the store key: the five lists together.
struct FarmLoad: ViewModifier {
    @Environment(AppModel.self) private var model

    func body(content: Content) -> some View {
        content.task(id: model.storeKey) { await model.loadFarm() }
    }
}

extension View {
    func loadsFarm() -> some View { modifier(FarmLoad()) }
}

/// Loading, a problem, or the view.
struct FarmLoading<Payload, Content: View>: View {
    let payload: Payload?
    let problem: RequestProblem?
    @ViewBuilder let content: (Payload) -> Content

    var body: some View {
        Group {
            if let payload {
                content(payload)
            } else if let problem {
                ProblemLine(problem).padding().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ProgressView { Text("Loading") }.frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        // The window's content column asks nothing of its content (`.noContentMinimum()` on the detail, N8): a view
        // with a table is a `TablePane`, and a page's short tables are grids that wrap (`PageGrid`), so nothing here
        // has a width of its own to push past the column
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// A table view's head: its served words with its figures beside them where the column has room, and beneath them
/// (each on its own line, if need be) where it hasn't, so nothing in the head is wider than the column it is in.
struct FarmHead<Words: View, Accessory: View>: View {
    let figures: [Components.Schemas.Claim]
    @ViewBuilder let words: () -> Words
    @ViewBuilder let accessory: () -> Accessory

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: 20) {
                // The words want a readable measure beside the figures; below it, the figures go beneath
                words().frame(minWidth: 0, idealWidth: 340, maxWidth: .infinity, alignment: .leading)
                ReportFigures(figures: figures)
                accessory()
            }
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top, spacing: 12) {
                    words().frame(maxWidth: .infinity, alignment: .leading)
                    accessory()
                }
                ViewThatFits(in: .horizontal) {
                    ReportFigures(figures: figures)
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(Array(figures.enumerated()), id: \.offset) { _, figure in
                            ClaimText(figure) {
                                HStack(alignment: .firstTextBaseline, spacing: 6) {
                                    Text(verbatim: figure.value?.display ?? figure.text).font(.title3.weight(.bold)).monospacedDigit()
                                    if figure.value != nil {
                                        Text(verbatim: figure.text).font(.callout).foregroundStyle(.readableSecondary)
                                            .fixedSize(horizontal: false, vertical: true)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/// A short served table on a page that scrolls (a few rows inside a report: depth by level, an affiliate's cover): a
/// native `Grid` under its column names where the column has room for it, else each row stacked (its first cell, then
/// each other cell under its column's name), its rows in the served order, its words wrapping. A `Table` is never put
/// inside a page's scroll view (N8's crash at narrow widths, see `TablePane`); a grid has no scroll view of its own,
/// takes the width it is given and grows to its rows. A player's name keeps his menu, drag and Decision.
struct PageGrid<Row: Identifiable>: View {
    let name: Text
    let columns: [Text]
    let rows: [Row]
    let cells: (Row) -> [AnyView]

    init(_ name: Text, columns: [Text], rows: [Row], cells: @escaping (Row) -> [AnyView]) {
        self.name = name
        self.columns = columns
        self.rows = rows
        self.cells = cells
    }

    var body: some View {
        ViewThatFits(in: .horizontal) {
            Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 18, verticalSpacing: 7) {
                GridRow {
                    ForEach(Array(columns.enumerated()), id: \.offset) { _, title in
                        title.font(.callout.weight(.semibold)).foregroundStyle(.readableSecondary).accessibilityAddTraits(.isHeader)
                    }
                }
                Divider()
                ForEach(rows) { row in
                    let row = cells(row)
                    GridRow {
                        ForEach(row.indices, id: \.self) { row[$0] }
                    }
                }
            }
            VStack(alignment: .leading, spacing: 8) {
                ForEach(rows) { row in
                    let row = cells(row)
                    VStack(alignment: .leading, spacing: 3) {
                        if let first = row.first { first.fontWeight(.semibold) }
                        ForEach(Array(row.indices.dropFirst()), id: \.self) { index in
                            HStack(alignment: .firstTextBaseline, spacing: 8) {
                                if columns.indices.contains(index) {
                                    columns[index].foregroundStyle(.readableSecondary).fixedSize(horizontal: false, vertical: true)
                                }
                                row[index]
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    Divider()
                }
            }
        }
        .font(.callout)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(name)
    }
}

/// Served facts, each a label, its value and why where it has one: a grid where the column has room, else each fact
/// stacked (the label, its value beneath, then the why), so a narrow window wraps them rather than squeezing a
/// column to a word.
struct FarmFacts: View {
    struct Fact: Identifiable {
        let id: String
        let label: String
        let value: Components.Schemas.Cell
        var why: String?
        var strong = true
    }

    let facts: [Fact]
    var secondaryLabels = true

    var body: some View {
        ViewThatFits(in: .horizontal) {
            Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 14, verticalSpacing: 4) {
                ForEach(facts) { fact in
                    GridRow {
                        label(fact)
                        GridCell(fact.value).fontWeight(fact.strong ? .semibold : .regular)
                        if let why = fact.why {
                            Text(verbatim: why).foregroundStyle(.readableSecondary)
                        }
                    }
                }
            }
            VStack(alignment: .leading, spacing: 6) {
                ForEach(facts) { fact in
                    VStack(alignment: .leading, spacing: 1) {
                        // The label over its value: a long value gets the column's whole width
                        label(fact)
                        GridCell(fact.value).fontWeight(fact.strong ? .semibold : .regular)
                        if let why = fact.why {
                            Text(verbatim: why).foregroundStyle(.readableSecondary).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        .font(.callout)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func label(_ fact: Fact) -> some View {
        Text(verbatim: fact.label)
            .foregroundStyle(secondaryLabels ? AnyShapeStyle(.readableSecondary) : AnyShapeStyle(.primary))
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// A served cell in a `PageGrid`, wrapping to its column.
struct GridCell: View {
    let cell: Components.Schemas.Cell
    var secondary = false

    init(_ cell: Components.Schemas.Cell, secondary: Bool = false) {
        self.cell = cell
        self.secondary = secondary
    }

    var body: some View {
        CellText(cell, secondary: secondary).fixedSize(horizontal: false, vertical: true)
    }
}

// MARK: Served rows are identified by their served id

extension Components.Schemas.FarmDepthRow: @retroactive Identifiable {}
extension Components.Schemas.FarmStartersRow: @retroactive Identifiable {}
extension Components.Schemas.FarmPlayerRow: @retroactive Identifiable {}
extension Components.Schemas.FarmLineRow: @retroactive Identifiable {}
extension Components.Schemas.FarmCoverRow: @retroactive Identifiable {}
extension Components.Schemas.FarmConcernRow: @retroactive Identifiable {}
extension Components.Schemas.FarmAssignmentRow: @retroactive Identifiable {}
extension Components.Schemas.FarmAlternativeRow: @retroactive Identifiable {}
extension Components.Schemas.FarmProspectRow: @retroactive Identifiable {}
extension Components.Schemas.FarmEvaluationRow: @retroactive Identifiable {}
extension Components.Schemas.FarmDevelopmentRow: @retroactive Identifiable {}
extension Components.Schemas.FarmSnapshotRow: @retroactive Identifiable {}
extension Components.Schemas.FarmMovementRow: @retroactive Identifiable {}

// MARK: A fold

/// A titled fold, closed or open as served (a finding's evidence, the results behind a verdict, who decided what): the
/// native `DisclosureGroup`, which gives VoiceOver its title and whether it is open, with its content laid out from the
/// leading edge beneath it.
struct Fold<Label: View, Content: View>: View {
    @State private var open: Bool
    @ViewBuilder let label: () -> Label
    @ViewBuilder let content: () -> Content

    init(open: Bool = false, @ViewBuilder content: @escaping () -> Content, @ViewBuilder label: @escaping () -> Label) {
        _open = State(initialValue: open)
        self.label = label
        self.content = content
    }

    var body: some View {
        DisclosureGroup(isExpanded: $open) {
            content().frame(maxWidth: .infinity, alignment: .leading)
        } label: {
            // The title opens and closes it too, as a section's title does in Finder's Get Info
            label().fixedSize(horizontal: false, vertical: true).contentShape(.rect).onTapGesture { withAnimation { open.toggle() } }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: Text on a fixed page

extension View {
    /// A table, list or scrolling pane's words on Pennant's fixed, checked page rather than the system's background
    /// (macOS 26 draws some system backgrounds differently from 27), as the Morning Report's lists do.
    func onReadablePage() -> some View {
        scrollContentBackground(.hidden).background(Color.readablePage)
    }
}
