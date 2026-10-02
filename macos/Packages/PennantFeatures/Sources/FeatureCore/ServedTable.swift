import Foundation
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

// Native tables of served rows (SWIFTUI_REBUILD.md section 4.1, N10): each column sorts by the row's served key through
// the unknown-last comparator (an unknown key sorts last whichever way), the served order stands until the GM clicks a
// header, and a cell is drawn as served: its words, its tone's symbol (never colour alone) and its help tag. A column the
// server gives no key to (developmental stakes, D-050) is drawn without `sortUsing`, so it cannot be sorted at all.

extension SortKey {
    /// A served sort key as generated (a number or a string, or neither: unknown).
    public static func served(_ number: Double?, _ text: String?) -> SortKey? {
        if let number { return .number(number) }
        if let text { return .text(text) }
        return nil
    }
}

/// One column's served sort for a native `Table`: the column it belongs to, its direction, and the row's served key. The
/// table hands it back in its sort order; `ServedRows.sorted` orders the rows with it, unknown last both ways.
public struct ServedColumnSort<Row>: SortComparator, @unchecked Sendable {
    public let column: String
    public var order: SortOrder
    private let key: (Row) -> SortKey?

    public init(_ column: String, order: SortOrder = .forward, key: @escaping (Row) -> SortKey?) {
        self.column = column
        self.order = order
        self.key = key
    }

    public func compare(_ lhs: Row, _ rhs: Row) -> ComparisonResult {
        let direction: SortDirection = order == .forward ? .ascending : .descending
        let (a, b) = (key(lhs), key(rhs))
        if UnknownLast.precedes(a, b, direction: direction) { return .orderedAscending }
        if UnknownLast.precedes(b, a, direction: direction) { return .orderedDescending }
        return .orderedSame
    }

    /// The rows in this column's order, stable, unknown last whichever way.
    public func sorted(_ rows: [Row]) -> [Row] {
        UnknownLast.sorted(rows, by: key, direction: order == .forward ? .ascending : .descending)
    }

    public static func == (lhs: Self, rhs: Self) -> Bool { lhs.column == rhs.column && lhs.order == rhs.order }
    public func hash(into hasher: inout Hasher) {
        hasher.combine(column)
        hasher.combine(order == .forward)
    }
}

public enum ServedRows {
    /// The rows as the GM sorted them: by the first column he clicked, else in the served order.
    public static func sorted<Row>(_ rows: [Row], by order: [ServedColumnSort<Row>]) -> [Row] {
        order.first.map { $0.sorted(rows) } ?? rows
    }
}

/// A served cell in a table or a line: its words, its tone's symbol when it has one beside the neutral, its help tag.
public struct CellText: View {
    let cell: Components.Schemas.Cell
    let secondary: Bool

    public init(_ cell: Components.Schemas.Cell, secondary: Bool = false) {
        self.cell = cell
        self.secondary = secondary
    }

    public var body: some View {
        let tone = Tone(cell.tone)
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            if cell.tone != nil, tone != .neutral { ToneMark(tone).font(.caption) }
            Text(verbatim: cell.display)
                .foregroundStyle(secondary ? AnyShapeStyle(.readableSecondary) : AnyShapeStyle(.primary))
        }
        .help(detail: cell.hint)
        .accessibilityElement(children: .combine)
    }
}

/// The height a short native table needs to show every row without scrolling, on a page that scrolls (a table of a few
/// served rows inside a report): the header and each row at the table's row height.
public enum ShortTable {
    public static func height(rows: Int, rowHeight: CGFloat = 24) -> CGFloat {
        CGFloat(max(rows, 1)) * rowHeight + 30
    }
}
