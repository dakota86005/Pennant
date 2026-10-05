import Charts
import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

/// Season Trends (N9): the season game by game, each served chart drawn with Swift Charts: its served lines (a point the
/// server has no value for is left out, never drawn at zero), the served rule (the zero, .500), its headline and what it
/// means. VoiceOver reads each chart through an audio graph built from the same served points and summary.
struct SeasonTrendsView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let store = model.clubhouse
        ViewState(payload: store.trends, problem: store.problems["trends"]) { view in
            Page {
                VStack(alignment: .leading, spacing: 10) {
                    ViewHead(title: Text(verbatim: view.title.display), lede: view.lede, yardsticks: nil, refreshing: model.clubhouseUpdating("trends"))
                    if let summary = view.summary { ClaimLine(summary, font: .callout) }
                    if let empty = view.empty { Text(verbatim: empty.display).foregroundStyle(.readableSecondary) }
                }
                ForEach(view.charts, id: \.id) { chart in TrendChartView(chart: chart) }
            }
        }
        .task(id: model.storeKey) { await store.loadTrends(client: model.client, key: model.storeKey) }
    }
}

/// One served chart: its title and headline, its lines, its rule and its caption.
struct TrendChartView: View {
    let chart: Components.Schemas.MlbTrendChart
    @Environment(\.theme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @EffectiveContrast private var contrast

    /// The fixed colour for a served role: the pack's accent for the main line, the tones' green and red for runs
    /// scored and allowed (each line also named in the legend, so colour is never the only signal).
    private func color(_ role: String) -> Color {
        let palette = theme.palette(colorScheme: colorScheme, contrast: contrast)
        switch role {
        case "scored": return Tone.good.color
        case "allowed": return Tone.bad.color
        default: return palette.isNeutral ? Color.accentColor : palette.accent
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(verbatim: chart.title.display).font(.system(size: 22, weight: .bold, design: .serif)).accessibilityAddTraits(.isHeader)
                if let headline = chart.headline { CellText(headline) }
            }
            Chart {
                if let baseline = chart.baseline {
                    RuleMark(y: .value(chart.axis.display, baseline))
                        .foregroundStyle(Color.readableSecondary)
                        .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 3]))
                }
                ForEach(chart.series, id: \.id) { series in
                    ForEach(series.points.filter { $0.value != nil }, id: \.game) { point in
                        LineMark(
                            x: .value("Game", point.game),
                            y: .value(chart.axis.display, point.value ?? 0),
                            series: .value("Line", series.title.display)
                        )
                        .foregroundStyle(by: .value("Line", series.title.display))
                        .interpolationMethod(.linear)
                    }
                }
            }
            .chartForegroundStyleScale(domain: chart.series.map(\.title.display), range: chart.series.map { color($0.role) })
            .chartLegend(chart.series.count > 1 ? .visible : .hidden)
            .chartXAxisLabel { Text("Game") }
            .chartYAxisLabel { Text(verbatim: chart.axis.display) }
            .frame(height: 220)
            .accessibilityChartDescriptor(TrendDescriptor(chart: chart))
            .accessibilityLabel(Text(verbatim: chart.title.display))
            .accessibilityIdentifier("trend.\(chart.id)")
            ClaimLine(chart.caption, font: .callout)
        }
        .padding(.top, 10)
    }
}

/// A chart's audio graph from its served points and summary: the game number across, the served values up, each line
/// a series, and the served sentence as the summary.
struct TrendDescriptor: AXChartDescriptorRepresentable {
    let chart: Components.Schemas.MlbTrendChart

    func makeChartDescriptor() -> AXChartDescriptor {
        let points = chart.series.flatMap(\.points)
        let games = points.map(\.game)
        let values = points.compactMap(\.value)
        let x = AXNumericDataAxisDescriptor(
            title: String(localized: "Game"),
            range: Double(games.min() ?? 0)...Double(max(games.max() ?? 1, (games.min() ?? 0) + 1)),
            gridlinePositions: []
        ) { value in String(Int(value)) }
        let low = min(values.min() ?? 0, chart.baseline ?? .infinity)
        let high = max(values.max() ?? 1, chart.baseline ?? -.infinity)
        let byValue = Dictionary(points.compactMap { p in p.value.map { ($0, p.display) } }, uniquingKeysWith: { first, _ in first })
        let y = AXNumericDataAxisDescriptor(
            title: chart.axis.display,
            range: low...(high > low ? high : low + 1),
            gridlinePositions: chart.baseline.map { [$0] } ?? []
        ) { value in byValue[value] ?? String(format: "%.1f", value) }
        let series = chart.series.map { line in
            AXDataSeriesDescriptor(
                name: line.title.display,
                isContinuous: true,
                dataPoints: line.points.compactMap { p in
                    p.value.map { AXDataPoint(x: Double(p.game), y: $0, additionalValues: [], label: "\(p.date): \(p.display)") }
                }
            )
        }
        return AXChartDescriptor(title: chart.title.display, summary: chart.summary, xAxis: x, yAxis: y, additionalAxes: [], series: series)
    }
}
