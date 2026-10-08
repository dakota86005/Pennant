import AppKit
@testable import FeatureCore
import Foundation
import PennantAPI
import PennantDesign
import PennantKit
@testable import Shell
import SwiftUI
import Testing
@testable import Trades

/// The Trade Desk's difference chart lays out at every narrow width and finishes (PR #60's lesson: on GitHub's macOS 26
/// runner at 1×, a Swift Chart with automatic axes never settled at a narrow width and froze the app). The chart's scale
/// is fixed on both axes with no axis marks; these tests lay the chart and the whole desk out in a window at every whole
/// width from 480 to 220 points with always-shown scroll bars, as the runner draws them. A chart that never settles hangs
/// the test instead of finishing. Not skipped on CI: the runner is where such a hang was seen.
@MainActor
@Suite("The Trade Desk's chart at narrow widths", .serialized)
struct TradesChartLayoutTests {
    private func chart(_ low: Double, _ high: Double, scale: ClosedRange<Double>) -> Components.Schemas.TradeRangeChart? {
        guard let analysis = PreviewFixtures.decode(Components.Schemas.TradeAnalysisView.self, "getTradeAnalysis"),
              var served = analysis.difference?.chart else { return nil }
        served.low = low
        served.high = high
        served.scaleLow = scale.lowerBound
        served.scaleHigh = scale.upperBound
        return served
    }

    @Test("The scale is the served one, never zero-width or unbounded")
    func domain() throws {
        let served = try #require(chart(-5.9, 2.2, scale: -7...7))
        #expect(DifferenceChart.domain(served) == -7...7)
        #expect(DifferenceChart.domain(try #require(chart(0, 0, scale: 0...0))) == -1...1)
        #expect(DifferenceChart.domain(try #require(chart(0, 0, scale: -Double.infinity...1))) == -1...1)
    }

    @Test("The difference chart lays out at every narrow width")
    func chartAtEveryWidth() throws {
        let served = try #require(PreviewFixtures.decode(Components.Schemas.TradeAnalysisView.self, "getTradeAnalysis")?.difference?.chart)
        try layOut(DifferenceChart(chart: served))
    }

    @Test("The Trade Desk with a deal weighed lays out at every narrow width")
    func deskAtEveryWidth() throws {
        try layOut(TradeDeskView())
    }

    private func layOut(_ view: some View) throws {
        // Scroll bars always shown, as on the runner (no trackpad): the content narrower by the bar's width
        UserDefaults.standard.register(defaults: ["AppleShowScrollBars": "Always"])
        _ = NSApplication.shared
        let model = PreviewFixtures.ready()
        let routing = MainWindowModel(registry: DepartmentRegistry(allDepartments))
        let host = NSHostingView(rootView: view.noContentMinimum().environment(model).environment(AppRouting()).environment(\.routeOpener, routing))
        let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: 480, height: 640), styleMask: [.titled, .resizable], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.contentView = host
        window.setFrameOrigin(NSPoint(x: -20_000, y: -20_000))
        window.orderFrontRegardless()
        defer { window.orderOut(nil) }
        for width in stride(from: 480, through: 220, by: -1) {
            window.setContentSize(CGSize(width: width, height: 640))
            host.layoutSubtreeIfNeeded()
            host.displayIfNeeded()
            RunLoop.main.run(until: Date().addingTimeInterval(0.005))
        }
        #expect(host.frame.width == 220)
    }
}
