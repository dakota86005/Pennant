import Accessibility
import Charts
import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

// The trade builder (N12 Track C; SWIFTUI_REBUILD.md section 9): two sides the GM drops players on, from anywhere a player
// can be dragged (a table's row, a name, the palette, Following, another window), or finds by name; the server weighs the
// deal each time it changes, and the difference is drawn as a range around zero in Swift Charts (the port of
// `src/tradeDifferenceGeometry.ts`, whose scale the server serves). Nothing here is a verdict: every figure and word is
// the server's.

typealias TradeSide = TradesStore.Side

/// One side of the builder: its title, a field to add a player by name, its players as served (or as the GM put them,
/// while the server weighs), its total; a drop target for players.
struct TradeSideView: View {
    let side: TradeSide
    let title: TradeCell
    let served: Components.Schemas.TradeDealSide?
    let pending: Bool
    /// What the side says with nobody on it before the server has weighed it (the desk's served words).
    let emptyWords: TradeCell?
    @Environment(AppModel.self) private var model
    @State private var targeted = false

    var body: some View {
        let store = model.trades
        let ids = side == .sent ? store.deal.sent : store.deal.received
        Card {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(verbatim: title.display)
                    .font(.headline)
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: 8)
                if pending, !ids.isEmpty { ProgressView().controlSize(.small).accessibilityLabel(Text("Weighing")) }
            }
            AddPlayerField(side: side)
            if ids.isEmpty {
                if let empty = served?.empty ?? emptyWords {
                    ServedWords(empty, quiet: true)
                        .font(.callout)
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .center)
                }
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(ids.enumerated()), id: \.element) { index, id in
                        if index > 0 { Divider().padding(.vertical, 6) }
                        if let row = served?.rows.first(where: { $0.player.playerId == id }) {
                            DealRowView(row: row, side: side)
                        } else {
                            PendingRow(id: id)
                        }
                    }
                }
                if let total = served?.total, !pending {
                    Divider()
                    ClaimWords(total, font: .callout.weight(.semibold))
                }
                if let leavesOut = served?.leavesOut, !pending { ServedWords(leavesOut, quiet: true).font(.callout) }
            }
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .overlay {
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(targeted ? Color.accentColor : Color.primary.opacity(0.12), style: StrokeStyle(lineWidth: targeted ? 2 : 1, dash: targeted ? [] : [5, 4]))
        }
        .dropDestination(for: PlayerRef.self) { players, _ in
            for player in players { store.add(player.id, to: side) }
            return !players.isEmpty
        } isTargeted: { targeted = $0 }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: title.display))
        .accessibilityIdentifier("trades.side.\(side.rawValue)")
    }
}

/// A player the GM put on a side, before the server has weighed him: his id only (his name arrives with the answer).
private struct PendingRow: View {
    let id: Int
    @Environment(AppModel.self) private var model

    var body: some View {
        HStack {
            ProgressView().controlSize(.small)
            Text("Weighing")
                .foregroundStyle(.readableSecondary)
            Spacer()
            RemoveButton(id: id, name: nil)
        }
    }
}

/// Takes a player off the builder.
private struct RemoveButton: View {
    let id: Int
    let name: String?
    @Environment(AppModel.self) private var model

    var body: some View {
        Button {
            model.trades.remove(id)
        } label: {
            Image(systemName: "xmark.circle.fill").foregroundStyle(.readableSecondary)
        }
        .buttonStyle(.plain)
        .help(Text("Take Him off the Deal"))
        .accessibilityLabel(Text("Remove from Deal"))
        .accessibilityIdentifier("trades.remove.\(id)")
    }
}

/// One player in the deal, as served: who he is, his contract value most likely and what it could be, his control, his
/// production, the value of keeping him, the seasons that count only if kept, and our view. Moves to the other side or
/// comes off from his menu.
struct DealRowView: View {
    let row: Components.Schemas.TradeDealRow
    let side: TradeSide
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                TradePlayerName(player: row.player)
                if let listed = row.listed { Pill(listed.display, tone: .neutral).help(detail: listed.hint) }
                Spacer(minLength: 6)
                ClaimWords(row.value, font: .body.weight(.semibold).monospacedDigit())
                    .accessibilityIdentifier("trades.value.\(row.player.playerId)")
                Button {
                    model.trades.add(row.player.playerId, to: side == .sent ? .received : .sent)
                } label: {
                    Image(systemName: "arrow.left.arrow.right.circle").foregroundStyle(.readableSecondary)
                }
                .buttonStyle(.plain)
                .help(side == .sent ? Text("Move to Receive") : Text("Move to Send"))
                .accessibilityLabel(side == .sent ? Text("Move to Receive") : Text("Move to Send"))
                .accessibilityIdentifier("trades.move.\(row.player.playerId)")
                RemoveButton(id: row.player.playerId, name: row.player.name)
            }
            ServedWords(row.line, quiet: true).font(.callout)
            ServedWords(row.range, quiet: true).font(.callout)
            ClaimWords(row.control, font: .callout, quiet: true)
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .firstTextBaseline, spacing: 10) { more }
                VStack(alignment: .leading, spacing: 4) { more }
            }
            if let ours = row.ours { ClaimWords(ours, font: .callout) }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("trades.row.\(row.player.playerId)")
    }

    @ViewBuilder private var more: some View {
        ClaimWords(row.production, font: .callout, quiet: true)
        if let keeping = row.keeping { ClaimWords(keeping, font: .callout, quiet: true) }
        if let ifKept = row.ifKept { ServedWords(ifKept, quiet: true).font(.callout) }
    }
}

/// A field to find a player by name and put him on a side: the server's search (`/api/v2/search`), its players only, as
/// native suggestions under the field.
struct AddPlayerField: View {
    let side: TradeSide
    @Environment(AppModel.self) private var model
    @State private var text = ""
    @State private var found: [Components.Schemas.SearchResult] = []
    @FocusState private var focused: Bool

    var body: some View {
        TextField(side == .sent ? "Find a player to send" : "Find a player to receive", text: $text)
            .textFieldStyle(.roundedBorder)
            .focused($focused)
            .textInputSuggestions {
                ForEach(found, id: \.id) { result in
                    Label {
                        Text(verbatim: result.title)
                        Text(verbatim: result.line)
                    } icon: {
                        Image(systemName: "person")
                    }
                    .textInputCompletion(completion(result))
                }
            }
            .onChange(of: text) { _, now in
                // A suggestion chosen fills the field with its completion: that player goes on the side
                if let chosen = found.first(where: { completion($0) == now }), let id = Int(chosen.id) {
                    model.trades.add(id, to: side)
                    text = ""
                    found = []
                }
            }
            .onSubmit {
                if let first = found.first, let id = Int(first.id) {
                    model.trades.add(id, to: side)
                    text = ""
                    found = []
                }
            }
            .task(id: text) {
                let query = text.trimmingCharacters(in: .whitespaces)
                guard query.count >= 2, !found.contains(where: { completion($0) == text }) else {
                    if query.count < 2 { found = [] }
                    return
                }
                try? await Task.sleep(for: .milliseconds(200))
                guard !Task.isCancelled else { return }
                if case .success(let answer)? = await model.league.search(query, client: model.client) {
                    found = answer.groups.filter { $0.kind.value1 == .player }.flatMap(\.results).prefix(12).map { $0 }
                }
            }
            .accessibilityIdentifier("trades.find.\(side.rawValue)")
    }

    /// The text a suggestion fills the field with: unique per player, so the field can tell which was chosen.
    private func completion(_ result: Components.Schemas.SearchResult) -> String {
        "\(result.title) · \(result.line) #\(result.id)"
    }
}

// MARK: The difference

/// The difference between the sides: the served headline, the range around zero in Swift Charts, what it leaves out, its
/// parts in a disclosure, our view and the salary moving.
struct DifferenceView: View {
    let analysis: Components.Schemas.TradeAnalysisView
    let difference: Components.Schemas.TradeDifferenceView
    @State private var partsShown = false

    var body: some View {
        Card {
        VStack(alignment: .leading, spacing: 10) {
            Text(verbatim: difference.title.display)
                .font(.headline)
                .accessibilityAddTraits(.isHeader)
            ClaimWords(difference.headline, font: .title3.weight(.semibold).monospacedDigit())
                .accessibilityIdentifier("trades.difference.headline")
            if let chart = difference.chart { DifferenceChart(chart: chart) }
            if let leavesOut = difference.leavesOut { ServedWords(leavesOut, quiet: true).font(.callout) }
            if let inWins = difference.inWins { ClaimWords(inWins, font: .callout) }
            if let parts = difference.parts {
                DisclosureGroup(isExpanded: $partsShown) {
                    VStack(alignment: .leading, spacing: 8) {
                        PartsGrid(table: parts)
                        ForEach(Array(difference.partsNotes.enumerated()), id: \.offset) { _, note in
                            ServedWords(note, quiet: true).font(.callout)
                        }
                    }
                    .padding(.top, 6)
                } label: {
                    Text("What Makes Up the Difference")
                }
                .accessibilityIdentifier("trades.parts")
            }
            if let ours = analysis.ourView { ClaimWords(ours, font: .callout) }
            if let salary = analysis.salary { ClaimWords(salary, font: .callout, quiet: true) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("trades.difference")
    }
}

/// What makes up the difference, as a short grid (a table this size is a grid, N11): each player's part as served.
private struct PartsGrid: View {
    let table: Components.Schemas.MlbTable

    var body: some View {
        Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 6) {
            GridRow {
                ForEach(table.columns, id: \.id) { column in
                    Text(verbatim: column.title.display)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.readableSecondary)
                        .gridColumnAlignment(column.numeric ? .trailing : .leading)
                }
            }
            ForEach(table.rows, id: \.id) { row in
                GridRow {
                    ForEach(table.columns, id: \.id) { column in
                        if let cell = row.cells.additionalProperties[column.id] {
                            if column.id == "player", let player = row.player {
                                TradePlayerName(player: player, font: .callout)
                            } else {
                                Text(verbatim: cell.display).font(.callout.monospacedDigit()).help(detail: cell.hint)
                            }
                        }
                    }
                }
            }
        }
    }
}

/// The difference drawn as a range around zero (`src/tradeDifferenceGeometry.ts` in Swift Charts): the range washed, the
/// most likely a point (or a darker stretch where it depends on an open season), zero dashed and labelled, on the
/// served scale, symmetric about zero, with the served words under each end. One image element for VoiceOver with its
/// audio graph (`AXChartDescriptor`) and the served summary.
struct DifferenceChart: View {
    let chart: Components.Schemas.TradeRangeChart

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Chart {
                BarMark(xStart: .value("Low", chart.low), xEnd: .value("High", chart.high), y: .value("Deal", "deal"), height: .fixed(16))
                    .foregroundStyle(Color.accentColor.opacity(0.22))
                    .clipShape(.rect(cornerRadius: 3))
                if chart.likelyHigh - chart.likelyLow > (chart.scaleHigh - chart.scaleLow) * 0.005 {
                    BarMark(xStart: .value("Likely low", chart.likelyLow), xEnd: .value("Likely high", chart.likelyHigh), y: .value("Deal", "deal"), height: .fixed(16))
                        .foregroundStyle(Color.accentColor.opacity(0.55))
                } else {
                    PointMark(x: .value("Most likely", chart.likelyLow), y: .value("Deal", "deal"))
                        .symbolSize(110)
                        .foregroundStyle(Color.accentColor)
                }
                RuleMark(x: .value("Even", 0))
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
                    .foregroundStyle(Color(nsColor: .labelColor))
                    .annotation(position: .bottom) {
                        Text(verbatim: chart.zero.display).font(.caption2).foregroundStyle(.readableSecondary)
                    }
            }
            .chartXScale(domain: chart.scaleLow...chart.scaleHigh)
            .chartXAxis(.hidden)
            .chartYAxis(.hidden)
            .frame(height: 54)
            .help(detail: chart.zero.hint)
            .accessibilityElement(children: .ignore)
            .accessibilityChartDescriptor(DifferenceChartDescriptor(chart: chart))
            .accessibilityLabel(Text(verbatim: chart.summary.display))
            .accessibilityAddTraits(.isImage)
            .accessibilityIdentifier("trades.chart")
            HStack {
                Text(verbatim: chart.left.display)
                Spacer()
                Text(verbatim: chart.right.display)
            }
            .font(.caption)
            .foregroundStyle(.readableSecondary)
            .accessibilityHidden(true)
        }
    }
}

/// The difference for VoiceOver's audio graph: lowest, most likely and highest, in the served words.
struct DifferenceChartDescriptor: AXChartDescriptorRepresentable {
    let chart: Components.Schemas.TradeRangeChart

    func makeChartDescriptor() -> AXChartDescriptor {
        let names = chart.marks.map(\.display)
        let x = AXCategoricalDataAxisDescriptor(title: String(localized: "Reading"), categoryOrder: names)
        let values = [chart.low, (chart.likelyLow + chart.likelyHigh) / 2, chart.high]
        let y = AXNumericDataAxisDescriptor(title: String(localized: "Coming in less going out"), range: chart.scaleLow...chart.scaleHigh, gridlinePositions: [0]) { value in
            // The served words for each served figure; a point between them has no words of its own
            zip(values, names).first { abs($0.0 - value) < 1e-9 }?.1 ?? ""
        }
        let points = zip(names, values).map { AXDataPoint(x: $0.0, y: $0.1, additionalValues: [], label: $0.0) }
        let series = AXDataSeriesDescriptor(name: chart.summary.display, isContinuous: false, dataPoints: points)
        return AXChartDescriptor(title: chart.summary.display, summary: chart.summary.display, xAxis: x, yAxis: y, additionalAxes: [], series: [series])
    }
}
