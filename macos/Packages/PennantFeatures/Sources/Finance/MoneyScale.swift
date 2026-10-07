import Charts
import Foundation
import SwiftUI

/// A money chart's vertical scale, fixed from the figures it draws: zero to a round top above the highest of them, with a
/// gridline at each round step (a quarter or so of the highest, rounded to 1, 2, 2.5 or 5 of a power of ten).
///
/// Why it is fixed (PR #60): on GitHub's macOS 26 runner, at 1× and about 274 points of content, Payroll's chart never
/// settled. The main thread's stack (the UI tests' watchdog) showed one layout pass in which Charts evaluated the chart's
/// content and its axis labels' closures over and over, never returning. With automatic marks the money ticks follow the
/// plot's height, the width their labels take moves the plot's width, and the season labels beneath move with that
/// width: sizes that feed each other. Fixed ticks, a fixed domain and annotations that never move the plot leave the
/// plot's size nothing to change. Presentation only, never a judgment: it draws the served figures.
struct MoneyScale: Equatable {
    /// The top of the scale (the bottom is zero).
    let top: Double
    /// Where the gridlines and their labels go, zero first.
    let ticks: [Double]

    init(_ amounts: [Double]) {
        let high = amounts.filter { $0.isFinite && $0 > 0 }.max() ?? 0
        guard high > 0 else {
            // Nothing above zero: an axis from zero to one, never a zero-width domain
            top = 1
            ticks = [0]
            return
        }
        let rough = high / 4
        let magnitude = pow(10, (log10(rough)).rounded(.down))
        let step = [1, 2, 2.5, 5, 10].map { $0 * magnitude }.first { $0 >= rough } ?? 10 * magnitude
        // One step above the highest figure, so a label on its rule has room above it
        let count = Int((high / step).rounded(.down)) + 1
        ticks = (0...count).map { Double($0) * step }
        top = Double(count) * step
    }

    var domain: ClosedRange<Double> { 0...top }
}

extension MoneyScale {
    /// The money axis drawn on this scale: its gridlines and labels, as the chart's own axis prints dollars ("$150M").
    var axisMarks: some AxisContent {
        AxisMarks(values: ticks) { value in
            AxisGridLine()
            AxisValueLabel {
                if let dollars = value.as(Double.self) {
                    Text(dollars, format: .currency(code: "USD").notation(.compactName).precision(.fractionLength(0...1)))
                }
            }
        }
    }
}
