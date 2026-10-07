import AppKit
@testable import FeatureCore
@testable import Finance
import Foundation
import PennantAPI
import PennantDesign
import PennantKit
@testable import Shell
import SwiftUI
import Testing

/// Finance's money charts lay out at every narrow width and finish (PR #60). On GitHub's macOS 26 runner at 1×, Payroll's
/// chart with Charts' automatic axes never settled at about 274 points of content: one layout pass evaluated the chart
/// without end and the app froze. These tests lay Payroll's page and the Horizon Board out in a window at every whole
/// width from 220 to 480 points, with the system's always-shown scroll bars as the runner draws them, on the machine's
/// own scale (1× on the runner); a chart that never settles hangs the test instead of finishing. Not skipped on CI: the
/// runner is where it was seen.
@MainActor
@Suite("Finance's charts at narrow widths", .serialized)
struct FinanceChartLayoutTests {
    @Test("The money scale: zero to a round top above every figure, never a zero-width domain")
    func moneyScale() {
        let payroll = MoneyScale([90_000_000, 60_000_000, 150_000_000, 11_800_000])
        #expect(payroll.ticks == [0, 50_000_000, 100_000_000, 150_000_000, 200_000_000])
        #expect(payroll.domain == 0...200_000_000)
        #expect(MoneyScale([700_000]).ticks == [0, 200_000, 400_000, 600_000, 800_000])
        #expect(MoneyScale([]).domain == 0...1)
        #expect(MoneyScale([0, 0]).ticks == [0])
        #expect(MoneyScale([.nan, -5]).domain == 0...1)
        // Every figure under the top, whatever its size
        for high in [1.0, 9.99, 123_456_789, 2.5e9] { #expect(MoneyScale([high]).top > high) }
    }

    @Test("Payroll & Budget's seasons page lays out at every narrow width")
    func payrollAtEveryWidth() throws {
        let payload = try #require(PreviewFixtures.office.payroll)
        try layOut(PayrollSeasonsPage(view: payload, refreshing: false))
    }

    @Test("The Horizon Board lays out at every narrow width")
    func horizonAtEveryWidth() throws {
        try layOut(HorizonBoardView())
    }

    private func layOut(_ view: some View) throws {
        // Scroll bars always shown, as on the runner (no trackpad): the content narrower by the bar's width
        UserDefaults.standard.register(defaults: ["AppleShowScrollBars": "Always"])
        _ = NSApplication.shared
        let model = PreviewFixtures.ready()
        let routing = MainWindowModel(registry: DepartmentRegistry(allDepartments))
        // As the window's content column holds a view: taking the width offered, with no minimum of its own
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
