import Charts
import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

// The Horizon Board (N12; D-057; SWIFTUI_REBUILD.md section 3.6): each position against the next three seasons, as
// Calendar's year view lays months side by side: every cell lists who the club controls there that season and how (the
// served words, its tone's symbol, the reason a click away), the farm's next man in a pipeline column of his own, never
// placed in a season (no arrival year is invented), and committed salary by season against the budget beneath. On a
// narrow column each position is a card with its seasons stacked, as Reminders stacks a list's sections.

struct HorizonBoardView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let store = model.office
        OfficeState(payload: store.horizon, problem: store.problems[OfficeStore.View.horizonBoard.rawValue]) { view in
            VStack(alignment: .leading, spacing: 0) {
            // The head stays put above the board, never under the toolbar's scroll edge
            OfficeHead(title: view.title.display, byline: view.byline, parts: view.bylineParts, lede: view.lede, freshness: view.freshness,
                       refreshing: model.officeUpdating(.horizonBoard))
                .padding(.horizontal, 28).padding(.top, 16).padding(.bottom, 10)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    ViewThatFits(in: .horizontal) {
                        HorizonGrid(view: view).frame(minWidth: 760)
                        HorizonCards(view: view)
                    }
                    HorizonMoney(view: view)
                    ForEach(Array(view.unknowns.enumerated()), id: \.offset) { _, unknown in
                        Label { Text(verbatim: unknown.display) } icon: { ToneMark(served: unknown.tone) }.font(.callout)
                    }
                }
                .padding(.horizontal, 28).padding(.vertical, 20)
                .frame(maxWidth: 1200, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(Color.readablePage)
            .accessibilityIdentifier("horizon.page")
        }
        .task(id: model.storeKey) { await model.loadOffice() }
    }
}

/// The board as a grid: a position per row, a season per column, the pipeline last.
struct HorizonGrid: View {
    let view: Components.Schemas.FinanceHorizonView

    var body: some View {
        Grid(alignment: .topLeading, horizontalSpacing: 10, verticalSpacing: 10) {
            GridRow {
                Text("Position").font(.caption.weight(.semibold)).foregroundStyle(.readableSecondary)
                ForEach(Array(view.seasonTitles.enumerated()), id: \.offset) { _, title in
                    Text(verbatim: title.display).font(.headline).monospacedDigit()
                }
                Text(verbatim: view.pipelineTitle.display).font(.headline).help(detail: view.pipelineTitle.hint)
            }
            ForEach(view.rows, id: \.id) { row in
                GridRow {
                    Text(verbatim: row.position.display).font(.headline)
                        .accessibilityAddTraits(.isHeader)
                    ForEach(row.cells, id: \.season) { cell in
                        HorizonCellView(cell: cell).frame(maxWidth: .infinity, alignment: .leading)
                    }
                    HorizonPipeline(row: row).frame(maxWidth: .infinity, alignment: .leading)
                }
                Divider().gridCellUnsizedAxes(.horizontal)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("horizon.grid")
    }
}

/// The board on a narrow column: a card per position, its seasons stacked, then its pipeline.
struct HorizonCards: View {
    let view: Components.Schemas.FinanceHorizonView

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(view.rows, id: \.id) { row in
                Card {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(verbatim: row.position.display).font(.headline).accessibilityAddTraits(.isHeader)
                        ForEach(row.cells, id: \.season) { cell in
                            HStack(alignment: .firstTextBaseline, spacing: 10) {
                                Text(verbatim: String(cell.season)).font(.callout.weight(.semibold)).monospacedDigit()
                                    .frame(width: 44, alignment: .leading)
                                HorizonCellView(cell: cell)
                            }
                        }
                        if !row.pipeline.isEmpty || row.pipelineEmpty != nil {
                            HStack(alignment: .firstTextBaseline, spacing: 10) {
                                Text(verbatim: view.pipelineTitle.display).font(.callout.weight(.semibold))
                                HorizonPipeline(row: row)
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("horizon.cards")
    }
}

/// One position in one season: who the club controls and how, each name opening his window, each status's reason a
/// click away; the served sentence when nobody, and beside the entries how many more couldn't be read.
struct HorizonCellView: View {
    let cell: Components.Schemas.FinanceHorizonCell

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(cell.entries, id: \.player.playerId) { entry in
                VStack(alignment: .leading, spacing: 0) {
                    Text(verbatim: entry.player.name)
                        .font(.callout.weight(.medium))
                        .playerName(id: entry.player.playerId, name: entry.player.name, opens: clubRef(opening: entry.player.open))
                    ClaimText(entry.why, edge: .trailing) {
                        HStack(spacing: 3) {
                            if Tone(entry.status.tone) != .neutral { ToneMark(served: entry.status.tone).font(.caption2) }
                            Text(verbatim: entry.status.display).font(.caption).foregroundStyle(.readableSecondary)
                        }
                    }
                    .help(detail: entry.status.hint)
                }
            }
            if let empty = cell.empty {
                Text(verbatim: empty.display).font(.caption).foregroundStyle(.readableSecondary).help(detail: empty.hint)
            }
            // Beside the entries, the players whose control that season couldn't be read: a mixed cell never hides them
            if let unread = cell.unreadNote {
                HStack(spacing: 3) {
                    ToneMark(served: unread.tone).font(.caption2)
                    Text(verbatim: unread.display).font(.caption).foregroundStyle(.readableSecondary)
                }
                .accessibilityElement(children: .combine)
                .help(detail: unread.hint)
            }
        }
    }
}

/// The farm's next men at a position, each with his level and Player Development's readiness: never in a season.
struct HorizonPipeline: View {
    let row: Components.Schemas.FinanceHorizonRow

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(row.pipeline, id: \.player.playerId) { prospect in
                VStack(alignment: .leading, spacing: 0) {
                    HStack(spacing: 4) {
                        Text(verbatim: prospect.player.name)
                            .font(.callout.weight(.medium))
                            .playerName(id: prospect.player.playerId, name: prospect.player.name, opens: clubRef(opening: prospect.player.open))
                        if let fill = prospect.ratingsFill { RatingFillMark(fill) }
                    }
                    HStack(spacing: 4) {
                        Text(verbatim: prospect.level.display).font(.caption).foregroundStyle(.readableSecondary)
                        CellText(prospect.readiness, secondary: true).font(.caption)
                    }
                }
            }
            if let empty = row.pipelineEmpty {
                Text(verbatim: empty.display).font(.caption).foregroundStyle(.readableSecondary)
            }
        }
    }
}

/// Committed salary by season against the club's budget: bars and a dashed rule, one image element with its audio graph.
struct HorizonMoney: View {
    let view: Components.Schemas.FinanceHorizonView
    @Environment(\.theme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @EffectiveContrast private var contrast

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Committed Salary").font(.headline).accessibilityAddTraits(.isHeader)
            if let note = view.payrollNote {
                Text(verbatim: note.display).foregroundStyle(.readableSecondary)
            } else {
                let palette = theme.palette(colorScheme: colorScheme, contrast: contrast)
                Chart {
                    ForEach(view.payroll, id: \.season) { money in
                        BarMark(x: .value("Season", String(money.season)), y: .value("Committed", money.committed), width: .ratio(0.45))
                            .foregroundStyle(palette.isNeutral ? Color.accentColor : palette.accent)
                    }
                    if let budget = view.budget?.amount {
                        RuleMark(y: .value("Budget", budget))
                            .foregroundStyle(Color.primary.opacity(0.7))
                            .lineStyle(StrokeStyle(lineWidth: 1.5, dash: [6, 4]))
                            .annotation(position: .top, alignment: .leading) {
                                Text(verbatim: view.budget?.label.display ?? "").font(.caption).foregroundStyle(.readableSecondary)
                            }
                    }
                }
                .chartYAxis {
                    AxisMarks { value in
                        AxisGridLine()
                        AxisValueLabel {
                            if let dollars = value.as(Double.self) {
                                Text(dollars, format: .currency(code: "USD").notation(.compactName).precision(.fractionLength(0)))
                            }
                        }
                    }
                }
                .frame(height: 160)
                .accessibilityElement(children: .ignore)
                .accessibilityAddTraits(.isImage)
                .accessibilityLabel(Text("Committed Salary"))
                .accessibilityValue(Text(verbatim: view.chartSummary.display))
                .accessibilityChartDescriptor(HorizonMoneyDescriptor(view: view))
                .accessibilityIdentifier("horizon.money")
                HStack(spacing: 14) {
                    ForEach(view.payroll, id: \.season) { money in ClaimLine(money.claim, font: .caption) }
                }
            }
        }
    }
}

/// The money strip's audio graph from its served figures and summary.
struct HorizonMoneyDescriptor: AXChartDescriptorRepresentable {
    let view: Components.Schemas.FinanceHorizonView

    func makeChartDescriptor() -> AXChartDescriptor {
        let x = AXCategoricalDataAxisDescriptor(title: String(localized: "Season"), categoryOrder: view.payroll.map { String($0.season) })
        let high = max(view.payroll.map(\.committed).max() ?? 1, view.budget?.amount ?? 0, 1)
        let words = Dictionary(view.payroll.map { ($0.committed, $0.claim.text) }, uniquingKeysWith: { first, _ in first })
        let y = AXNumericDataAxisDescriptor(title: String(localized: "Committed"), range: 0...high, gridlinePositions: view.budget?.amount.map { [$0] } ?? []) { value in
            words[value] ?? view.budget?.label.display ?? ""
        }
        let series = AXDataSeriesDescriptor(
            name: String(localized: "Committed"),
            isContinuous: false,
            dataPoints: view.payroll.map { AXDataPoint(x: String($0.season), y: $0.committed, additionalValues: [], label: $0.claim.text) }
        )
        return AXChartDescriptor(title: String(localized: "Committed Salary"), summary: view.chartSummary.display, xAxis: x, yAxis: y, additionalAxes: [], series: [series])
    }
}
