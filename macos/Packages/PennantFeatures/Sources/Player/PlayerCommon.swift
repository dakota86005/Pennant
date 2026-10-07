import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

// What the player window's sections share (N11): a section with its structural title, served facts, short served
// tables as grids, and served lines. Every word is served; the views add only structural labels from the String Catalog.

/// A section of a player tab: a structural title, an optional served note under it, then its content.
struct PlayerSection<Content: View>: View {
    let title: LocalizedStringResource?
    let note: Components.Schemas.Cell?
    @ViewBuilder let content: () -> Content

    init(_ title: LocalizedStringResource?, note: Components.Schemas.Cell? = nil, @ViewBuilder content: @escaping () -> Content) {
        self.title = title
        self.note = note
        self.content = content
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let title {
                Text(title).font(.title3.weight(.semibold)).accessibilityAddTraits(.isHeader)
            }
            if let note {
                Text(verbatim: note.display).font(.callout).foregroundStyle(.readableSecondary).help(detail: note.hint)
                    .fixedSize(horizontal: false, vertical: true)
            }
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(title.map { Text($0) } ?? Text(verbatim: note?.display ?? ""))
    }
}

/// A tab's page: the section stack on the fixed, checked page, scrolling by itself, in a readable measure.
struct PlayerPage<Content: View>: View {
    let id: String
    @ViewBuilder let content: () -> Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                content()
            }
            .padding(.horizontal, 24).padding(.vertical, 20)
            .frame(maxWidth: 980, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .scrollBounceBehavior(.basedOnSize)
        .background(Color.readablePage)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(PlayerTab(rawValue: id)?.name ?? "Player"))
        .accessibilityIdentifier("player.tab.\(id)")
    }
}

/// Served facts, each a label and its value (a claim's basis a click away where it has one): a grid where the column
/// has room, else each fact stacked, so a narrow window wraps them rather than squeezing a column to a word.
struct PlayerFacts: View {
    let facts: [Components.Schemas.PlayerFact]

    var body: some View {
        ViewThatFits(in: .horizontal) {
            Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 14, verticalSpacing: 5) {
                ForEach(Array(facts.enumerated()), id: \.offset) { _, fact in
                    GridRow {
                        Text(verbatim: fact.label.display).foregroundStyle(.readableSecondary).help(detail: fact.label.hint)
                        FactValue(fact: fact)
                    }
                }
            }
            VStack(alignment: .leading, spacing: 6) {
                ForEach(Array(facts.enumerated()), id: \.offset) { _, fact in
                    VStack(alignment: .leading, spacing: 1) {
                        Text(verbatim: fact.label.display).foregroundStyle(.readableSecondary).help(detail: fact.label.hint)
                            .fixedSize(horizontal: false, vertical: true)
                        FactValue(fact: fact)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        .font(.callout)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A fact's value: its served cell, or its claim (the basis a click away).
struct FactValue: View {
    let fact: Components.Schemas.PlayerFact

    var body: some View {
        if let claim = fact.claim {
            ClaimText(claim, edge: .trailing) { CellText(fact.value).fontWeight(.medium).fixedSize(horizontal: false, vertical: true) }
        } else {
            CellText(fact.value).fontWeight(.medium).fixedSize(horizontal: false, vertical: true)
        }
    }
}

/// A short served table on a page that scrolls: a native `Grid` under its column names where the column has room, else
/// each row stacked (its first cell, then each other cell under its column's name); its rows in the served order. A
/// `Table` is never put inside a page's scroll view (N8's crash, `TablePane`); a grid takes the width it is given.
struct PlayerGrid: View {
    let table: Components.Schemas.PlayerTable

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if table.rows.isEmpty, let empty = table.empty {
                Text(verbatim: empty.display).foregroundStyle(.readableSecondary)
            } else {
                ViewThatFits(in: .horizontal) {
                    Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 16, verticalSpacing: 6) {
                        GridRow {
                            ForEach(table.columns, id: \.id) { column in
                                Text(verbatim: column.title.display).font(.callout.weight(.semibold)).foregroundStyle(.readableSecondary)
                                    .gridColumnAlignment(column.numeric ? .trailing : .leading)
                                    .accessibilityAddTraits(.isHeader)
                            }
                        }
                        Divider()
                        ForEach(table.rows, id: \.id) { row in
                            GridRow {
                                ForEach(table.columns, id: \.id) { column in
                                    if let cell = row.cells.additionalProperties[column.id] {
                                        CellText(cell).monospacedDigit()
                                    } else {
                                        Color.clear.frame(width: 1, height: 1)
                                    }
                                }
                            }
                        }
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(table.rows, id: \.id) { row in
                            VStack(alignment: .leading, spacing: 2) {
                                ForEach(Array(table.columns.enumerated()), id: \.offset) { index, column in
                                    if let cell = row.cells.additionalProperties[column.id] {
                                        if index == 0 {
                                            CellText(cell).fontWeight(.semibold)
                                        } else {
                                            HStack(alignment: .firstTextBaseline, spacing: 8) {
                                                Text(verbatim: column.title.display).foregroundStyle(.readableSecondary)
                                                CellText(cell).monospacedDigit().fixedSize(horizontal: false, vertical: true)
                                            }
                                        }
                                    }
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            Divider()
                        }
                    }
                }
            }
            if let note = table.note {
                Text(verbatim: note.display).font(.caption).foregroundStyle(.readableSecondary).help(detail: note.hint)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .font(.callout)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: table.title.display))
    }
}

/// Served lines, one to a line.
struct PlayerLines: View {
    let lines: [Components.Schemas.Cell]

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                CellText(line, secondary: true).font(.callout).fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A served claim as a line with its tone's symbol, its basis one click away.
struct PlayerClaimLine: View {
    let claim: Components.Schemas.Claim
    var font: Font = .body

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            ToneMark(served: claim.tone)
            ClaimText(claim, edge: .trailing) {
                Text(verbatim: claim.text).font(font).multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

extension Components.Schemas.PlayerTableRow: @retroactive Identifiable {}

extension Components.Schemas.PlayerTableRow {
    /// A column's served sort key, or nil when it is unknown (sorted last whichever way).
    func key(_ column: String) -> SortKey? {
        guard let served = sort.additionalProperties[column] ?? nil else { return nil }
        return .served(served.value1, served.value2)
    }
}

/// A served cell's words on a tile's fill: the system's own text colour (no explicit style, which the accessibility
/// audit measured as too faint on a fill whatever its pixels read), its tone's symbol beside a non-neutral tone, its help tag.
struct FillWords: View {
    let cell: Components.Schemas.Cell

    init(_ cell: Components.Schemas.Cell) {
        self.cell = cell
    }

    var body: some View {
        let tone = Tone(cell.tone)
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            if cell.tone != nil, tone != .neutral { ToneMark(tone).font(.caption) }
            Text(verbatim: cell.display).fixedSize(horizontal: false, vertical: true)
        }
        .help(detail: cell.hint)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: cell.display))
    }
}

/// The header's tiles as cards on the page (the Overview of a narrow window: the header keeps to his name): side by side
/// where the column has room, else one above another. A plain stack, never a lazy grid, whose container and wrapped
/// words VoiceOver and the audit read with the wrong frames.
struct PlayerTileGrid: View {
    let tiles: [Components.Schemas.PlayerTile]

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: 10) {
                ForEach(tiles, id: \.id) { PlayerTileView(tile: $0) }
            }
            VStack(alignment: .leading, spacing: 10) {
                ForEach(tiles, id: \.id) { PlayerTileView(tile: $0).frame(maxWidth: .infinity, alignment: .leading) }
            }
        }
    }
}
