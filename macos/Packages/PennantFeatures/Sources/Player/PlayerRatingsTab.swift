import Charts
import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

/// Ratings: whose grades they are (our scouts', or OSA's view for him, marked), every group of grades on the save's own
/// scale as served, each a bar between the scale's ends, and his rating history in this save as a chart (a change of
/// source said beside it). A grade not scouted is its served words, never a bar at zero.
struct PlayerRatingsTab: View {
    let dossier: Components.Schemas.PlayerDossierView

    var body: some View {
        let r = dossier.ratings
        PlayerPage(id: "ratings") {
            PlayerSection(nil) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    if let fill = r.ratingsFill { RatingFillMark(fill) }
                    PlayerClaimLine(claim: r.source, font: .callout)
                }
                Text(verbatim: r.scale.words.display).font(.caption).foregroundStyle(.readableSecondary)
                if let velocity = r.velocity { CellText(velocity).font(.callout) }
            }
            if let empty = r.empty {
                Text(verbatim: empty.display).foregroundStyle(.readableSecondary)
            }
            ForEach(r.groups, id: \.id) { group in
                PlayerSection(nil) {
                    Text(verbatim: group.title.display).font(.title3.weight(.semibold)).accessibilityAddTraits(.isHeader)
                        .help(detail: group.title.hint)
                    if let note = group.note {
                        Text(verbatim: note.display).font(.callout).foregroundStyle(.readableSecondary).help(detail: note.hint)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    GradeRows(rows: group.rows, low: Double(r.scale.low), high: Double(r.scale.high), fill: r.ratingsFill)
                }
            }
            PlayerSection("Rating History") {
                RatingHistoryView(history: r.history, low: Double(r.scale.low), high: Double(r.scale.high))
            }
        }
    }
}

/// A group's grades: the tool, its bar between the scale's ends (now, and the ceiling as a mark), its served words.
struct GradeRows: View {
    let rows: [Components.Schemas.PlayerRatingRow]
    let low: Double
    let high: Double
    let fill: Components.Schemas.Cell?

    var body: some View {
        Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 12, verticalSpacing: 6) {
            ForEach(rows, id: \.id) { row in
                GridRow {
                    Text(verbatim: row.cells.tool.display).font(.callout).fixedSize(horizontal: false, vertical: true)
                    GradeBar(now: row.now, ceiling: row.ceiling, low: low, high: high)
                        .frame(minWidth: 60, maxWidth: 260)
                        .gridColumnAlignment(.leading)
                    HStack(spacing: 4) {
                        CellText(row.cells.grade).font(.callout.weight(.medium)).monospacedDigit()
                        if let fill { RatingFillMark(fill) }
                    }
                }
                .accessibilityElement(children: .combine)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// One grade drawn between the scale's ends: a filled bar to the grade now, a mark at the ceiling; hatched when not
/// scouted (never a zero). A graphic: its words are the row's served grade beside it.
struct GradeBar: View {
    let now: Double?
    let ceiling: Double?
    let low: Double
    let high: Double
    @Environment(\.theme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @EffectiveContrast private var contrast

    var body: some View {
        let palette = theme.palette(colorScheme: colorScheme, contrast: contrast)
        let accent = palette.isNeutral ? Color.accentColor : palette.accent
        let span = max(high - low, 1)
        let at = { (v: Double) in min(1, max(0, (v - low) / span)) }
        GeometryReader { g in
            ZStack(alignment: .leading) {
                Capsule().fill(Color(nsColor: .quaternaryLabelColor).opacity(0.5))
                if let now {
                    Capsule().fill(accent).frame(width: max(4, g.size.width * at(now)))
                    if let ceiling, ceiling > now {
                        Capsule().fill(accent.opacity(0.35)).frame(width: max(4, g.size.width * at(ceiling)))
                        Rectangle().fill(accent).frame(width: 2, height: 10).offset(x: g.size.width * at(ceiling) - 1, y: -2)
                    }
                } else {
                    Hatch().clipShape(Capsule())
                }
            }
        }
        .frame(height: 6)
        .accessibilityHidden(true)
    }
}

/// His rating history: the scouted average now and its ceiling at each snapshot as two lines (the served points, in the
/// order taken; a date is never parsed), the snapshots beneath, and a change of source said. With fewer than two
/// snapshots, the served sentence and no chart that would read as "no change".
struct RatingHistoryView: View {
    let history: Components.Schemas.PlayerRatingHistory
    let low: Double
    let high: Double

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let switchNote = history.sourceSwitch { PlayerClaimLine(claim: switchNote, font: .callout) }
            if history.points.count >= 2 {
                HistoryChart(history: history, low: low, high: high)
                    .frame(height: 180)
            }
            if let empty = history.empty {
                Text(verbatim: empty.display).foregroundStyle(.readableSecondary).help(detail: empty.hint)
            }
            if let table = history.table, history.points.count >= 2 {
                PlayerGrid(table: table)
            }
        }
    }
}

struct HistoryChart: View {
    let history: Components.Schemas.PlayerRatingHistory
    let low: Double
    let high: Double

    var body: some View {
        Chart {
            ForEach(history.points, id: \.index) { p in
                if let now = p.now {
                    LineMark(x: .value("Snapshot", p.index), y: .value("Grade", now), series: .value("Series", "now"))
                        .foregroundStyle(by: .value("Series", String(localized: "Now")))
                    PointMark(x: .value("Snapshot", p.index), y: .value("Grade", now))
                        .foregroundStyle(by: .value("Series", String(localized: "Now")))
                }
                if let ceiling = p.ceiling {
                    LineMark(x: .value("Snapshot", p.index), y: .value("Grade", ceiling), series: .value("Series", "ceiling"))
                        .foregroundStyle(by: .value("Series", String(localized: "Ceiling")))
                        .lineStyle(StrokeStyle(lineWidth: 2, dash: [4, 3]))
                }
            }
        }
        .chartYScale(domain: low...high)
        .chartXScale(domain: -0.3...Double(max(history.points.count - 1, 1)) + 0.3)
        .chartXAxis {
            AxisMarks(values: history.points.map(\.index)) { value in
                AxisGridLine()
                AxisValueLabel {
                    if let i = value.as(Int.self), let p = history.points.first(where: { $0.index == i }) {
                        Text(verbatim: p.label.display).font(.caption2)
                    }
                }
            }
        }
        .accessibilityChartDescriptor(HistoryChartDescriptor(history: history, low: low, high: high))
        .accessibilityLabel(Text(verbatim: history.title.display))
        .accessibilityValue(Text(verbatim: history.summary))
    }
}

/// The history chart for VoiceOver's audio graphs: each snapshot's grade now and its ceiling, in the served words.
struct HistoryChartDescriptor: AXChartDescriptorRepresentable {
    let history: Components.Schemas.PlayerRatingHistory
    let low: Double
    let high: Double

    func makeChartDescriptor() -> AXChartDescriptor {
        let labels = history.points.map(\.label.display)
        let x = AXCategoricalDataAxisDescriptor(title: String(localized: "Snapshot"), categoryOrder: labels)
        let y = AXNumericDataAxisDescriptor(title: String(localized: "Grade"), range: low...high, gridlinePositions: []) { "\(Int($0.rounded()))" }
        let now = AXDataSeriesDescriptor(name: String(localized: "Now"), isContinuous: true, dataPoints: history.points.compactMap { p in
            p.now.map { AXDataPoint(x: p.label.display, y: $0) }
        })
        let ceiling = AXDataSeriesDescriptor(name: String(localized: "Ceiling"), isContinuous: true, dataPoints: history.points.compactMap { p in
            p.ceiling.map { AXDataPoint(x: p.label.display, y: $0) }
        })
        return AXChartDescriptor(title: history.title.display, summary: history.summary, xAxis: x, yAxis: y, additionalAxes: [], series: [now, ceiling])
    }
}
