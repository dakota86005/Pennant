import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

// The pieces Philosophy & Staff is drawn from (N12 Track C): a served cell, a claim's line, a served table and what goes
// with its chosen row. Each draws what the server served and nothing more (D-056).

typealias StaffCell = Components.Schemas.Cell
typealias StaffClaim = Components.Schemas.Claim

/// A served cell as words: the readable secondary colour when unknown or asked quiet, its tone's mark when it says
/// something, its help tag on hover.
struct CellWords: View {
    let cell: StaffCell
    var quiet = false

    init(_ cell: StaffCell, quiet: Bool = false) {
        self.cell = cell
        self.quiet = quiet
    }

    var body: some View {
        let tone = Tone(cell.tone)
        let words = Text(verbatim: cell.display)
            .foregroundStyle(quiet || tone == .unknown ? AnyShapeStyle(.readableSecondary) : AnyShapeStyle(.primary))
            .fixedSize(horizontal: false, vertical: true)
        if cell.tone != nil, tone != .neutral {
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                ToneMark(tone).font(.caption)
                words
            }
            .help(detail: cell.hint)
            // One element that says its words (a group with none has no description)
            .accessibilityElement(children: .combine)
            .accessibilityLabel(Text(verbatim: cell.display))
        } else {
            // Plain words: a text element of their own, its colour the audit reads (a combined group is read as none)
            words.help(detail: cell.hint)
        }
    }
}

/// A served claim as a line, its basis a click away.
struct ClaimRow: View {
    let claim: StaffClaim
    var font: Font = .body
    var quiet = false

    init(_ claim: StaffClaim, font: Font = .body, quiet: Bool = false) {
        self.claim = claim
        self.font = font
        self.quiet = quiet
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 5) {
            if Tone(claim.tone) != .neutral { ToneMark(served: claim.tone).font(.caption) }
            ClaimText(claim, edge: .trailing) {
                Text(verbatim: claim.text)
                    .font(font)
                    .foregroundStyle(quiet || Tone(claim.tone) == .unknown ? AnyShapeStyle(.readableSecondary) : AnyShapeStyle(.primary))
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

/// What a view says while it waits or when the server refused it; a failed read shows its problem, never an earlier
/// payload as if current (the N8 review, M1).
struct LoadState<Payload, Content: View>: View {
    let payload: Payload?
    let problem: RequestProblem?
    @ViewBuilder let content: (Payload) -> Content

    var body: some View {
        if let problem {
            ProblemLine(problem).frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let payload {
            content(payload)
        } else {
            ProgressView { Text("Loading") }.frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

/// A view's head: its served title, byline and lede, over the content colour.
struct PhilosophyHead: View {
    let title: StaffCell
    let byline: StaffCell
    let lede: StaffClaim
    var refreshing = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(verbatim: title.display)
                    .font(.system(size: 30, weight: .bold, design: .serif))
                    .accessibilityAddTraits(.isHeader)
                if refreshing { ProgressView { Text("Refreshing") }.controlSize(.small) }
            }
            CellWords(byline, quiet: true).font(.callout)
            ClaimText(lede, edge: .bottom) {
                Text(verbatim: lede.text).font(.title3).multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: A served table

/// A served row as the table holds it: the row and its place in the served order.
nonisolated struct StaffRow: Identifiable, Hashable, Sendable {
    let row: Components.Schemas.MlbRow
    let index: Int
    var id: String { row.id }

    func key(_ column: String) -> SortKey? {
        guard let served = row.sort.additionalProperties[column] ?? nil else { return nil }
        if let number = served.value1 { return .number(number) }
        if let text = served.value2 { return .text(text) }
        return nil
    }
}

/// Sorting a column by its served keys, unknown last both ways, ties in the served order (D-056).
nonisolated struct StaffSort: SortComparator, Hashable, Sendable {
    let column: String
    var order: SortOrder = .forward

    func compare(_ lhs: StaffRow, _ rhs: StaffRow) -> ComparisonResult {
        let direction: SortDirection = order == .forward ? .ascending : .descending
        let a = lhs.key(column), b = rhs.key(column)
        if UnknownLast.precedes(a, b, direction: direction) { return .orderedAscending }
        if UnknownLast.precedes(b, a, direction: direction) { return .orderedDescending }
        return lhs.index < rhs.index ? .orderedAscending : lhs.index > rhs.index ? .orderedDescending : .orderedSame
    }
}

/// A served table as a native `Table`: the served columns (hidden, moved and resized by the GM, remembered by the window),
/// sorted by the served keys with the unknown last, keyboard navigation, and a context menu with what the row offers to
/// open (an affiliate's club) and Copy. A coach opens nothing of his own until a staff window exists.
struct StaffTable: View {
    let table: Components.Schemas.MlbTable
    let id: String
    let name: String
    @Binding var selection: StaffRow.ID?
    @State private var sortOrder: [StaffSort] = []
    @SceneStorage private var customization: TableColumnCustomization<StaffRow>
    @Environment(\.openWindow) private var openWindow

    init(_ table: Components.Schemas.MlbTable, id: String, name: String, selection: Binding<StaffRow.ID?>) {
        self.table = table
        self.id = id
        self.name = name
        _selection = selection
        _customization = SceneStorage(wrappedValue: TableColumnCustomization<StaffRow>(), "philosophy.table.\(id)")
    }

    private var rows: [StaffRow] {
        let served = table.rows.enumerated().map { StaffRow(row: $0.element, index: $0.offset) }
        guard let sort = sortOrder.first else { return served }
        return UnknownLast.sorted(served, by: { $0.key(sort.column) }, direction: sort.order == .forward ? .ascending : .descending)
    }

    var body: some View {
        if table.rows.isEmpty {
            Group {
                if let empty = table.empty { CellWords(empty, quiet: true) }
            }
            .padding(.horizontal, 28).padding(.vertical, 12)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .accessibilityIdentifier("table.\(id).empty")
        } else {
            Table(of: StaffRow.self, selection: $selection, sortOrder: $sortOrder, columnCustomization: $customization) {
                TableColumnForEach(table.columns, id: \.id) { column in
                    TableColumn(Text(verbatim: column.title.display), sortUsing: StaffSort(column: column.id)) { row in
                        if let cell = row.row.cells.additionalProperties[column.id] {
                            CellWords(cell).monospacedDigit().lineLimit(1)
                        }
                    }
                    .width(min: column.numeric ? 44 : 72, ideal: column.numeric ? 72 : (["coach", "club", "ratings", "contract"].contains(column.id) ? 180 : 110))
                    .customizationID(column.id)
                }
            } rows: {
                ForEach(rows) { row in TableRow(row) }
            }
            .tableStyle(.inset(alternatesRowBackgrounds: false))
            .scrollContentBackground(.hidden)
            .background(Color.readablePage)
            .contextMenu(forSelectionType: StaffRow.ID.self) { ids in
                if let row = table.rows.first(where: { ids.contains($0.id) }) { menu(for: row) }
            }
            .accessibilityLabel(Text(verbatim: name))
            .accessibilityIdentifier("table.\(id)")
        }
    }

    @ViewBuilder
    private func menu(for row: Components.Schemas.MlbRow) -> some View {
        ForEach(Array(row.actions.enumerated()), id: \.offset) { _, action in
            if let club = clubRef(opening: action.open) {
                Button { openWindow(value: club) } label: { Text(verbatim: action.text.display) }
            }
        }
        if let first = table.columns.first(where: { ["coach", "role"].contains($0.id) }), let cell = row.cells.additionalProperties[first.id] {
            Button("Copy Name", systemImage: "doc.on.doc") { copy(cell.display) }
        }
    }
}

/// A row's served detail: its claim and each block's title and claims, a rating on its served scale drawn as a gauge
/// beside its words.
struct StaffRowDetail: View {
    let row: Components.Schemas.MlbRow

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let claim = row.claim { ClaimRow(claim) }
            ForEach(Array(row.detail.enumerated()), id: \.offset) { _, block in
                VStack(alignment: .leading, spacing: 6) {
                    if let title = block.title {
                        Text(verbatim: title.display).font(.headline).accessibilityAddTraits(.isHeader)
                    }
                    ForEach(Array(block.claims.enumerated()), id: \.offset) { _, claim in
                        RatingLine(claim: claim)
                    }
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("staff.detail")
    }
}

/// A served rating: its words, and where a whole is served, a gauge of the value against it (the 1–200 scale), never a
/// gauge for a rating not known.
private struct RatingLine: View {
    let claim: StaffClaim

    var body: some View {
        HStack(spacing: 10) {
            ClaimRow(claim, font: .callout)
                .frame(minWidth: 160, alignment: .leading)
            if let value = claim.value, let n = value.n, let whole = value.whole, whole > 0 {
                Gauge(value: min(max(n, 0), whole), in: 0...whole) { EmptyView() }
                    .gaugeStyle(.linearCapacity)
                    .frame(maxWidth: 220)
                    .accessibilityHidden(true)
            }
        }
    }
}
