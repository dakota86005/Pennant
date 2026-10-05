import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

/// Two to four players side by side (`WindowGroup("Compare", for: ComparisonRef.self)`; N11, D-070): drop a player on
/// the window, or choose Compare on him anywhere (the window used last takes him); removing one is one click. The same
/// field is lined up for each as his own dossier serves it, a range drawn on one line per row (the row's served ranges
/// set its ends: chart geometry, nothing more), and under the row what the ranges allow saying, served. Restored at
/// relaunch with its players (its value is theirs).
public struct CompareWindowView: View {
    @Binding var value: ComparisonRef?
    @Environment(AppModel.self) private var model
    @Environment(\.openWindow) private var openWindow
    @Environment(\.controlActiveState) private var active
    @State private var token = UUID()
    @State private var refused = false

    public init(value: Binding<ComparisonRef?>) {
        _value = value
    }

    private var players: [PlayerRef] { value?.players ?? [] }
    private var ids: [Int] { players.map(\.id) }

    public var body: some View {
        let store = model.players
        let comparison = store.comparisons[ids]
        VStack(alignment: .leading, spacing: 0) {
            CompareHead(players: players, served: comparison, remove: remove, refused: refused)
            Divider()
            if players.count < 2 {
                ContentUnavailableView {
                    Label("Compare Players", systemImage: "rectangle.split.2x1")
                } description: {
                    Text("Drop two to four players here")
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color.readablePage)
            } else if let comparison {
                CompareTable(comparison: comparison)
            } else if let problem = store.compareProblems[ids] {
                ProblemLine(problem).padding().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ProgressView { Text("Loading") }.frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(minWidth: 560, minHeight: 420)
        .background(Color.readablePage)
        .background(WindowContainerLabels(["Compare", "Compare Window"]))
        .navigationTitle(Text("Compare"))
        .toolbar(removing: .title)
        .dropDestination(for: PlayerRef.self) { dropped, _ in
            add(dropped)
            return true
        }
        .environment(\.theme, model.theme)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("compare.window")
        .onAppear { CompareRouter.shared.register(token, value: value ?? ComparisonRef()) }
        .onDisappear { CompareRouter.shared.forget(token) }
        .onChange(of: active) { _, state in
            if state == .key { CompareRouter.shared.register(token, value: value ?? ComparisonRef()) }
        }
        .onChange(of: value) { _, next in CompareRouter.shared.register(token, value: next ?? ComparisonRef()) }
        // Players handed to this window by Compare elsewhere
        .onChange(of: CompareRouter.shared.handed[token]) { _, handed in
            if handed != nil { add(CompareRouter.shared.take(token)) }
        }
        .task(id: CompareTaskKey(ids: ids, key: model.storeKey)) {
            await model.loadCompare(ids)
        }
    }

    private func add(_ dropped: [PlayerRef]) {
        let current = value ?? ComparisonRef()
        let next = CompareRouter.adding(dropped, to: current)
        refused = next.players.count == CompareRouter.most && dropped.contains { !next.players.contains($0) }
        value = next
    }

    private func remove(_ player: PlayerRef) {
        var next = value ?? ComparisonRef()
        next.players.removeAll { $0 == player }
        refused = false
        value = next
    }
}

struct CompareTaskKey: Hashable {
    let ids: [Int]
    let key: AppModel.StoreKey?
}

/// The players compared, each with his name (opens his window, drags), his served line and a one-click remove; the
/// served note on how to read the comparison.
struct CompareHead: View {
    let players: [PlayerRef]
    let served: Components.Schemas.PlayerCompareView?
    let remove: (PlayerRef) -> Void
    let refused: Bool
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ScrollView(.horizontal) {
                HStack(alignment: .top, spacing: 10) {
                    ForEach(players, id: \.self) { player in
                        let shown = served?.players.first { $0.playerId == player.id }
                        HStack(alignment: .top, spacing: 6) {
                            VStack(alignment: .leading, spacing: 2) {
                                HStack(spacing: 4) {
                                    Text(verbatim: shown?.name ?? "").font(.headline)
                                        .playerName(id: player.id, name: shown?.name, opens: nil)
                                    if let fill = shown?.ratingsFill { RatingFillMark(fill) }
                                }
                                if let line = shown?.line { CellText(line, secondary: true).font(.caption) }
                            }
                            Button { remove(player) } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.readableSecondary) }
                                .buttonStyle(.plain)
                                .help(Text("Remove from Compare"))
                                .accessibilityLabel(Text("Remove from Compare"))
                                .accessibilityIdentifier("compare.remove.\(player.id)")
                        }
                        .padding(8)
                        .background(Color.readableChipFill, in: .rect(cornerRadius: 8))
                        .accessibilityElement(children: .contain)
                        .accessibilityIdentifier("compare.player.\(player.id)")
                    }
                }
                .padding(.horizontal, 20)
            }
            .scrollBounceBehavior(.basedOnSize)
            if refused {
                Text("Compare holds four players at most").font(.caption).foregroundStyle(.readableSecondary)
                    .padding(.horizontal, 20)
            }
            if let note = served?.note {
                Text(verbatim: note.display).font(.caption).foregroundStyle(.readableSecondary).help(detail: note.hint)
                    .padding(.horizontal, 20).fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.readablePage)
    }
}

/// The comparison's sections: a row per field, a column per player, a range bar under a figure that has one (one line
/// per row, its ends the row's served ranges), and the served reading under the row.
struct CompareTable: View {
    let comparison: Components.Schemas.PlayerCompareView

    var body: some View {
        ScrollView([.vertical, .horizontal]) {
            Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 18, verticalSpacing: 8) {
                ForEach(comparison.sections, id: \.id) { section in
                    GridRow {
                        Text(verbatim: section.title.display).font(.title3.weight(.semibold)).accessibilityAddTraits(.isHeader)
                            .gridCellColumns(comparison.players.count + 1)
                            .padding(.top, 10)
                    }
                    ForEach(section.rows, id: \.id) { row in
                        CompareRowView(row: row)
                    }
                }
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.readablePage)
        .accessibilityIdentifier("compare.table")
    }
}

struct CompareRowView: View {
    let row: Components.Schemas.CompareRow

    /// The row's line: the ends of its served ranges (nothing to draw when fewer than one has a range).
    private var scale: ValueScale? {
        let ranges = row.cells.compactMap(\.range)
        guard let low = ranges.map(\.low).min(), let high = ranges.map(\.high).max() else { return nil }
        let span = high - low
        return ValueScale(low: low - max(span * 0.05, 0.05), high: high + max(span * 0.05, 0.05))
    }

    var body: some View {
        GridRow {
            Text(verbatim: row.label.display).foregroundStyle(.readableSecondary).help(detail: row.label.hint)
                .frame(minWidth: 120, alignment: .leading)
            ForEach(Array(row.cells.enumerated()), id: \.offset) { _, c in
                VStack(alignment: .leading, spacing: 3) {
                    CellText(c.display).fontWeight(.medium).monospacedDigit().fixedSize(horizontal: false, vertical: true)
                    if let scale, let range = c.range {
                        RangeBar(
                            range: ValueRange(low: range.low, likely: range.mid ?? (range.low + range.high) / 2, high: range.high, text: c.display.display, short: c.display.display),
                            label: c.display.hint ?? c.display.display,
                            scale: scale
                        )
                        .frame(width: 150)
                    }
                }
                .frame(minWidth: 150, alignment: .leading)
            }
        }
        if let reading = row.reading {
            GridRow {
                Color.clear.frame(width: 1, height: 1)
                PlayerClaimLine(claim: reading, font: .caption)
                    .gridCellColumns(row.cells.count)
            }
        }
    }
}
