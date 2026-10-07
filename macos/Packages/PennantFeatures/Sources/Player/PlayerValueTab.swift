import Charts
import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

/// Value: the totals as Player Value serves them ("Most likely … · could be …", or one sentence and no figure), our view
/// beside them, expected production season by season as a chart of its two ranges (a season not established keeps its
/// slot, outlined, with no range and no zero), and the season-by-season breakdown with what it rests on.
struct PlayerValueTab: View {
    let dossier: Components.Schemas.PlayerDossierView

    var body: some View {
        let v = dossier.value
        PlayerPage(id: "value") {
            if let note = v.note { PlayerClaimLine(claim: note) }
            if !v.totals.isEmpty {
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .top, spacing: 12) { ForEach(v.totals, id: \.id) { ValueTotalCard(total: $0) } }
                    VStack(alignment: .leading, spacing: 12) { ForEach(v.totals, id: \.id) { ValueTotalCard(total: $0) } }
                }
            }
            if let ours = v.ourView {
                PlayerSection(nil) {
                    Text(verbatim: ours.title.display).font(.headline).help(detail: ours.title.hint)
                    ForEach(Array(ours.figures.enumerated()), id: \.offset) { _, f in CellText(f).font(.callout) }
                    ForEach(Array(ours.leans.enumerated()), id: \.offset) { _, lean in PlayerClaimLine(claim: lean, font: .callout) }
                    if let line = ours.line { CellText(line, secondary: true).font(.callout).fixedSize(horizontal: false, vertical: true) }
                }
            }
            PlayerSection(nil) {
                Text(verbatim: v.cone.title.display).font(.title3.weight(.semibold)).accessibilityAddTraits(.isHeader).help(detail: v.cone.title.hint)
                ConeView(cone: v.cone)
            }
            if !v.seasonNotes.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(Array(v.seasonNotes.enumerated()), id: \.offset) { _, note in PlayerClaimLine(claim: note, font: .callout) }
                }
            }
            if let breakdown = v.breakdown {
                DisclosureGroup {
                    VStack(alignment: .leading, spacing: 10) {
                        PlayerGrid(table: breakdown)
                        PlayerLines(lines: v.restsOn)
                    }
                    .padding(.top, 6)
                } label: {
                    Text(verbatim: breakdown.title.display).font(.headline).help(detail: breakdown.title.hint)
                }
                .accessibilityIdentifier("player.value.breakdown")
            }
        }
    }
}

/// A value total: its title (its hover says what it means), the headline with its basis a click away, the range, and
/// the gloss; not valued, the served sentence and no figure.
struct ValueTotalCard: View {
    let total: Components.Schemas.PlayerValueTotal

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(verbatim: total.title.display).font(.caption.weight(.semibold)).help(detail: total.title.hint)
            ClaimText(total.headline, edge: .bottom) {
                Text(verbatim: total.headline.text).font(total.known ? .title3.weight(.semibold) : .callout.weight(.medium))
                    .monospacedDigit().fixedSize(horizontal: false, vertical: true)
            }
            if let couldBe = total.couldBe { FillWords(couldBe).font(.callout) }
            if let established = total.established { FillWords(established).font(.callout) }
            FillWords(total.gloss).font(.caption)
        }
        .padding(12)
        .frame(minWidth: 200, maxWidth: 360, alignment: .leading)
        // An outline on the page rather than a fill: the audit can't read words on a tinted fill as their pixels read
        .background(Color.readablePage, in: .rect(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Color.primary.opacity(0.18)))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: total.title.display))
        .accessibilityIdentifier("player.value.\(total.id)")
    }
}

/// Expected production: each season's two ranges (the wider and the narrower), expected wins as a line, the replacement
/// level as a rule, and a season not established as an outlined slot with no range; beneath, every season as a button
/// that opens its detail (its figures and what they rest on), so each is reached by the keyboard and VoiceOver too. The
/// seasons wrap in a grid, never a sideways scroll nested in the page's vertical one.
struct ConeView: View {
    let cone: Components.Schemas.PlayerConeView

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let empty = cone.empty {
                PlayerClaimLine(claim: empty)
            } else {
                HStack(spacing: 14) {
                    LegendSwatch(opacity: 0.18, cell: cone.legend.outer)
                    LegendSwatch(opacity: 0.4, cell: cone.legend.inner)
                    HStack(spacing: 4) {
                        Circle().frame(width: 6, height: 6).accessibilityHidden(true)
                        Text(verbatim: cone.legend.expected.display)
                    }
                }
                .font(.caption)
                .foregroundStyle(.readableSecondary)
                ConeChart(cone: cone).frame(height: 220)
                if let checked = cone.checked { PlayerClaimLine(claim: checked, font: .caption) }
                // The seasons wrap onto as many rows as the width needs: no sideways scroll inside the page's own
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 92), spacing: 6, alignment: .topLeading)], alignment: .leading, spacing: 6) {
                    ForEach(cone.seasons, id: \.season) { s in
                        ClaimText(s.detail, edge: .bottom) {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(verbatim: s.label.display).font(.caption.weight(.semibold)).monospacedDigit()
                                Text(verbatim: s.control.display).font(.caption2)
                                if let cost = s.cost {
                                    Text(verbatim: cost.display).font(.caption2).monospacedDigit()
                                }
                            }
                            .padding(6)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Color.primary.opacity(0.18)))
                        }
                        .accessibilityIdentifier("player.cone.season.\(s.season)")
                    }
                }
                PlayerLines(lines: cone.notes)
            }
        }
    }
}

struct LegendSwatch: View {
    let opacity: Double
    let cell: Components.Schemas.Cell

    var body: some View {
        HStack(spacing: 4) {
            RoundedRectangle(cornerRadius: 2).fill(Color.accentColor.opacity(opacity)).frame(width: 14, height: 8).accessibilityHidden(true)
            Text(verbatim: cell.display).help(detail: cell.hint)
        }
    }
}

struct ConeChart: View {
    let cone: Components.Schemas.PlayerConeView

    private var known: [Components.Schemas.PlayerConeSeason] { cone.seasons.filter(\.established) }
    private var pending: [Components.Schemas.PlayerConeSeason] { cone.seasons.filter { !$0.established } }

    var body: some View {
        let pad = max((cone.axis.high - cone.axis.low) * 0.08, 0.2)
        Chart {
            ForEach(known, id: \.season) { s in
                if let outer = s.outer {
                    AreaMark(x: .value("Season", s.season), yStart: .value("Low", outer.low), yEnd: .value("High", outer.high), series: .value("Range", "outer"))
                        .foregroundStyle(Color.accentColor.opacity(0.18))
                        .interpolationMethod(.linear)
                }
            }
            ForEach(known, id: \.season) { s in
                if let inner = s.inner {
                    AreaMark(x: .value("Season", s.season), yStart: .value("Low", inner.low), yEnd: .value("High", inner.high), series: .value("Range", "inner"))
                        .foregroundStyle(Color.accentColor.opacity(0.4))
                        .interpolationMethod(.linear)
                }
            }
            ForEach(known, id: \.season) { s in
                if let expected = s.expected {
                    LineMark(x: .value("Season", s.season), y: .value("Wins", expected), series: .value("Range", "expected"))
                        .foregroundStyle(Color.accentColor)
                    PointMark(x: .value("Season", s.season), y: .value("Wins", expected))
                        .foregroundStyle(Color.accentColor)
                }
            }
            if let first = pending.first, let last = pending.last {
                RectangleMark(
                    xStart: .value("Season", Double(first.season) - 0.45), xEnd: .value("Season", Double(last.season) + 0.45),
                    yStart: .value("Low", cone.axis.low - pad), yEnd: .value("High", cone.axis.high + pad)
                )
                .foregroundStyle(Color(nsColor: .quaternaryLabelColor).opacity(0.35))
                .annotation(position: .overlay) {
                    if let pending = cone.pending { Text(verbatim: pending.display).font(.caption2).foregroundStyle(.readableSecondary) }
                }
            }
            RuleMark(y: .value("Replacement", 0))
                .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 4]))
                .foregroundStyle(Color(nsColor: .secondaryLabelColor))
                .annotation(position: .top, alignment: .leading) {
                    Text(verbatim: cone.legend.replacement.display).font(.caption2).foregroundStyle(.readableSecondary)
                }
        }
        .chartYScale(domain: (cone.axis.low - pad)...(cone.axis.high + pad))
        // The served seasons only (a numeric axis would otherwise start at zero)
        .chartXScale(domain: Double(cone.seasons.map(\.season).min() ?? 0) - 0.5...Double(cone.seasons.map(\.season).max() ?? 1) + 0.5)
        .chartXAxis {
            AxisMarks(values: cone.seasons.map(\.season)) { value in
                AxisGridLine()
                AxisValueLabel {
                    if let season = value.as(Int.self) { Text(verbatim: String(season)).font(.caption2) }
                }
            }
        }
        .accessibilityChartDescriptor(ConeChartDescriptor(cone: cone))
        .accessibilityLabel(Text(verbatim: cone.title.display))
        .accessibilityValue(Text(verbatim: cone.summary))
        .accessibilityIdentifier("player.cone")
    }
}

/// The cone for VoiceOver's audio graphs: expected wins by season, and each range's ends, in the served figures.
struct ConeChartDescriptor: AXChartDescriptorRepresentable {
    let cone: Components.Schemas.PlayerConeView

    func makeChartDescriptor() -> AXChartDescriptor {
        let seasons = cone.seasons.map { String($0.season) }
        let x = AXCategoricalDataAxisDescriptor(title: String(localized: "Season"), categoryOrder: seasons)
        let y = AXNumericDataAxisDescriptor(title: String(localized: "Wins"), range: cone.axis.low...max(cone.axis.high, cone.axis.low + 0.1), gridlinePositions: [0]) {
            String(format: "%.1f", $0)
        }
        let expected = AXDataSeriesDescriptor(name: cone.legend.expected.display, isContinuous: true, dataPoints: cone.seasons.compactMap { s in
            s.expected.map { AXDataPoint(x: String(s.season), y: $0, additionalValues: [], label: s.detail.text) }
        })
        let outerLow = AXDataSeriesDescriptor(name: cone.legend.outer.display, isContinuous: true, dataPoints: cone.seasons.compactMap { s in
            s.outer.map { AXDataPoint(x: String(s.season), y: $0.low) }
        })
        let outerHigh = AXDataSeriesDescriptor(name: cone.legend.outer.display, isContinuous: true, dataPoints: cone.seasons.compactMap { s in
            s.outer.map { AXDataPoint(x: String(s.season), y: $0.high) }
        })
        return AXChartDescriptor(title: cone.title.display, summary: cone.summary, xAxis: x, yAxis: y, additionalAxes: [], series: [expected, outerLow, outerHigh])
    }
}
