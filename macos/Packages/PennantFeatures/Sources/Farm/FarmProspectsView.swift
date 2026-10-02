import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

/// Farm & Development ▸ Prospects (N10; React's Player Development page): Player Development's calls on every minor
/// leaguer as one native table, filtered by the served groups (the development meetings first, as React opened), with the
/// chosen player's meeting beside it. React's inbox and board are one view here: choosing a row is opening his meeting.
/// No score orders the board: it is in the roster's stated order until the GM sorts a column (D-044).
public struct FarmProspectsView: View {
    @Environment(AppModel.self) private var model

    public init() {}

    public var body: some View {
        let farm = model.farm
        FarmLoading(payload: farm.prospects, problem: farm.prospects == nil ? farm.problems["prospects"] : nil) { view in
            ProspectsBoard(view: view, updating: farm.isStale("prospects", for: model.storeKey), problem: farm.prospects != nil ? farm.problems["prospects"] : nil)
        }
        .loadsFarm()
    }
}

struct ProspectsBoard: View {
    let view: Components.Schemas.FarmProspectsView
    let updating: Bool
    let problem: RequestProblem?
    @Environment(\.routeOpener) private var opener
    @SceneStorage("farm.prospects.filter") private var filter = "attention"
    @SceneStorage("farm.prospects.level") private var levelStored = ""
    @SceneStorage("farm.prospects.columns") private var columns: TableColumnCustomization<Components.Schemas.FarmProspectRow>
    @State private var order: [ServedColumnSort<Components.Schemas.FarmProspectRow>] = []
    @State private var selection: Set<String> = []
    @State private var guide = false

    private var rows: [Components.Schemas.FarmProspectRow] {
        let shown = view.rows.filter { (filter == "all" || $0.filters.contains(filter)) && (levelStored.isEmpty || $0.levelId == levelStored) }
        return ServedRows.sorted(shown, by: order)
    }

    var body: some View {
        let rows = rows
        let chosen = rows.first { selection.contains($0.id) } ?? rows.first
        VStack(alignment: .leading, spacing: 0) {
            ProspectsHeader(view: view, updating: updating, problem: problem, guide: $guide)
            HSplitView {
                Table(of: Components.Schemas.FarmProspectRow.self, selection: $selection, sortOrder: $order, columnCustomization: $columns) {
                    TableColumn("Player", sortUsing: ServedColumnSort("player") { .served($0.sort.player?.value1, $0.sort.player?.value2) }) {
                        CellText($0.cells.player).fontWeight(.medium)
                    }
                    .width(min: 90, ideal: 150).customizationID("player")
                    TableColumn("Age", sortUsing: ServedColumnSort("age") { .served($0.sort.age?.value1, $0.sort.age?.value2) }) { CellText($0.cells.age).monospacedDigit() }
                        .width(min: 34, ideal: 40).customizationID("age")
                    TableColumn("Club", sortUsing: ServedColumnSort("club") { .served($0.sort.club?.value1, $0.sort.club?.value2) }) { CellText($0.cells.club) }
                        .width(min: 90, ideal: 150).customizationID("club")
                    TableColumn("Role", sortUsing: ServedColumnSort("role") { .served($0.sort.role?.value1, $0.sort.role?.value2) }) { CellText($0.cells.role) }
                        .width(min: 70, ideal: 110).customizationID("role")
                    TableColumn("Now → Ceiling", sortUsing: ServedColumnSort("ratings") { .served($0.sort.ratings?.value1, $0.sort.ratings?.value2) }) {
                        CellText($0.cells.ratings).monospacedDigit()
                    }
                    .width(min: 70, ideal: 100).customizationID("ratings")
                    TableColumn("Against His Peers", sortUsing: ServedColumnSort("pace") { .served($0.sort.pace?.value1, $0.sort.pace?.value2) }) { CellText($0.cells.pace) }
                        .width(min: 90, ideal: 110).customizationID("pace")
                    TableColumn("Player Development's Call", sortUsing: ServedColumnSort("call") { .served($0.sort.call?.value1, $0.sort.call?.value2) }) {
                        CellText($0.cells.call).fontWeight(.medium)
                    }
                    .width(min: 90, ideal: 170).customizationID("call")
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
                        Text(verbatim: view.empty.display).foregroundStyle(.readableSecondary).padding(40)
                    }
                }
                .frame(minWidth: 320, maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityIdentifier("farm.prospects.table")

                Group {
                    if let chosen, let card = view.meetings.first(where: { $0.playerId == chosen.playerId }) {
                        ScrollView { ProspectCardView(card: card).padding(20) }
                    } else if let chosen {
                        ProspectRowDetail(row: chosen)
                    } else if let empty = view.meetingsEmpty {
                        Text(verbatim: empty.display).foregroundStyle(.readableSecondary).padding(20)
                    }
                }
                .frame(minWidth: 260, idealWidth: 360, maxWidth: 480, maxHeight: .infinity, alignment: .topLeading)
                .background(.readablePage)
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("farm.prospects.detail")
            }
        }
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Picker(selection: $filter) {
                    ForEach(view.filters, id: \.id) { f in
                        Text(verbatim: f.label).tag(f.id)
                    }
                } label: {
                    Label("Show", systemImage: "line.3.horizontal.decrease.circle")
                }
                .help(Text("Show"))
                .accessibilityIdentifier("farm.filter.prospects")
                LevelPicker(levels: view.levels, selection: Binding(get: { levelStored.isEmpty ? nil : levelStored }, set: { levelStored = $0 ?? "" }))
            }
        }
    }
}

/// The view's served summary and figures, the meetings' note, the stated order, and How to Read This.
struct ProspectsHeader: View {
    let view: Components.Schemas.FarmProspectsView
    let updating: Bool
    let problem: RequestProblem?
    @Binding var guide: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let problem { ProblemLine(problem) }
            HStack(alignment: .top, spacing: 20) {
                VStack(alignment: .leading, spacing: 6) {
                    ServedClaimLine(view.summary, font: .callout)
                    HStack(spacing: 8) {
                        Text(verbatim: view.order.display).font(.callout.weight(.medium)).foregroundStyle(.readableSecondary).help(detail: view.order.hint)
                        Text(verbatim: view.meetingsNote.display).font(.callout).foregroundStyle(.readableSecondary)
                        if updating { ProgressView().controlSize(.small).accessibilityLabel(Text("Updating")) }
                    }
                }
                Spacer(minLength: 12)
                ReportFigures(figures: view.figures)
                Button { guide.toggle() } label: { Label("How to Read This", systemImage: "questionmark.circle") }
                    .labelStyle(.iconOnly)
                    .buttonStyle(.borderless)
                    .help(Text("How to Read This"))
                    .accessibilityIdentifier("farm.prospects.guide")
                    .popover(isPresented: $guide, arrowEdge: .bottom) { GuidePopover(rows: view.guide, footer: [view.boardNote, view.model]) }
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
    }
}

/// The served guide: each term and what it means, then the served notes.
struct GuidePopover: View {
    let rows: [Components.Schemas.FarmFactRow]
    let footer: [Components.Schemas.Cell]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("How to Read This").font(.headline)
            ForEach(rows, id: \.id) { row in
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: row.cells.label.display).fontWeight(.semibold)
                    Text(verbatim: row.cells.value.display).foregroundStyle(.readableSecondary).fixedSize(horizontal: false, vertical: true)
                }
            }
            ForEach(Array(footer.enumerated()), id: \.offset) { _, note in
                Text(verbatim: note.display).font(.callout).foregroundStyle(.readableSecondary).fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(16)
        .frame(width: 360, alignment: .leading)
    }
}

/// A development meeting: the player, his call (its evidence a click away), his facts, the case for and against, the
/// moves supported, whose question the move is, and Player Development's evidence scores in a fold.
struct ProspectCardView: View {
    let card: Components.Schemas.FarmProspectCard
    @Environment(\.routeOpener) private var opener

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Player Development").font(.caption.weight(.semibold)).foregroundStyle(.readableSecondary).textCase(.uppercase)
                Text(verbatim: card.name).font(.title2.weight(.bold)).farmPlayer(id: card.playerId, name: card.name, open: card.open)
                Text(verbatim: card.line.display).foregroundStyle(.readableSecondary)
                CellText(card.queueLine, secondary: true).font(.callout)
            }
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                ClaimText(card.call, edge: .leading) { Pill(card.call.text, tone: Tone(card.call.tone)) }
                Text(verbatim: card.means.display).font(.callout).foregroundStyle(.readableSecondary).fixedSize(horizontal: false, vertical: true)
            }
            FactGrid(rows: card.facts)
            if !card.supporting.isEmpty { LabeledLines(title: "For", lines: card.supporting) }
            if !card.cautions.isEmpty { LabeledLines(title: "Against", lines: card.cautions) }
            VStack(alignment: .leading, spacing: 6) {
                Text("Moves supported").font(.callout.weight(.semibold))
                if let empty = card.nextEmpty { Text(verbatim: empty.display).font(.callout).foregroundStyle(.readableSecondary) }
                ForEach(Array(card.next.enumerated()), id: \.offset) { _, next in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(verbatim: next.move.display).font(.callout.weight(.medium))
                        HStack(spacing: 6) {
                            ForEach(Array(next.destinations.enumerated()), id: \.offset) { _, destination in
                                Pill(destination.display, tone: .neutral)
                            }
                        }
                    }
                }
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(verbatim: card.placeTitle.display).font(.callout.weight(.semibold))
                Text(verbatim: card.place.display).font(.callout).foregroundStyle(.readableSecondary).fixedSize(horizontal: false, vertical: true)
                if let r = route(card.open), opener?.canOpen(r) ?? false {
                    Button("Open Decision") { opener?.open(r) }
                        .controlSize(.small)
                        .accessibilityIdentifier("farm.prospects.openDecision")
                }
            }
            Fold {
                VStack(alignment: .leading, spacing: 8) {
                    Text(verbatim: card.scoresNote.display).font(.callout).foregroundStyle(.readableSecondary)
                    FactGrid(rows: card.scores)
                    ForEach(card.evaluations, id: \.id) { row in
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(spacing: 8) {
                                Text(verbatim: row.cells.move.display).fontWeight(.medium)
                                Pill(row.cells.judgment.display, tone: Tone(row.cells.judgment.tone))
                                CellText(row.cells.philosophy, secondary: true)
                            }
                            if !row.notes.isEmpty { ServedLines(lines: row.notes, font: .caption) }
                        }
                        .font(.callout)
                    }
                }
            } label: {
                Text("Full development evidence")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("farm.prospect.\(card.playerId)")
    }
}

/// A player with no meeting: his row's served words, and his Decision.
struct ProspectRowDetail: View {
    let row: Components.Schemas.FarmProspectRow
    @Environment(\.routeOpener) private var opener

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(verbatim: row.cells.player.display).font(.title2.weight(.bold)).farmPlayer(id: row.playerId, name: row.cells.player.display, open: row.open)
            Text(verbatim: [row.cells.age.display, row.cells.role.display, row.cells.club.display].joined(separator: " · ")).foregroundStyle(.readableSecondary)
            Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 4) {
                GridRow { Text("Player Development's Call").foregroundStyle(.readableSecondary); CellText(row.cells.call) }
                GridRow { Text("Now → Ceiling").foregroundStyle(.readableSecondary); CellText(row.cells.ratings) }
                GridRow { Text("Against His Peers").foregroundStyle(.readableSecondary); CellText(row.cells.pace) }
            }
            .font(.callout)
            if let r = route(row.open), opener?.canOpen(r) ?? false {
                Button("Open Decision") { opener?.open(r) }.controlSize(.small)
            }
            Spacer()
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
