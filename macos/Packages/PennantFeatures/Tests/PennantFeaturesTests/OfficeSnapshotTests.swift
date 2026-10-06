import AppKit
@testable import FeatureCore
@testable import Finance
import Foundation
@testable import Medical
import PennantAPI
import PennantDesign
import PennantKit
@testable import Shell
import SwiftUI
import Testing

/// Pictures of Finance's and Medical's views for review (N12; SWIFTUI_REBUILD.md section 8), from the captured
/// fixtures, light and dark, into `build/macos-snapshots/` (`n12-*`). Drawn the way `ClubhouseSnapshotTests` draws:
/// hosted off-screen and cached, so the native tables draw. Skipped on CI.
@MainActor
@Suite("Finance and Medical snapshots", .serialized, .enabled(if: ProcessInfo.processInfo.environment["CI"] == nil))
struct OfficeSnapshotTests {
    static let folder = PreviewFixtures.repositoryRoot.appending(path: "build/macos-snapshots", directoryHint: .isDirectory)

    init() throws {
        try FileManager.default.createDirectory(at: Self.folder, withIntermediateDirectories: true)
    }

    private func hosted(_ view: some View) -> some View {
        let model = PreviewFixtures.ready()
        let window = MainWindowModel(registry: DepartmentRegistry(allDepartments))
        return view
            .environment(model)
            .environment(AppRouting())
            .environment(\.routeOpener, window)
    }

    @Test("Payroll & Budget: the seasons, the chart and the budget rule", arguments: [false, true])
    func payroll(dark: Bool) throws {
        try draw(hosted(PayrollSeasonsPage(view: try #require(PreviewFixtures.office.payroll), refreshing: false)),
                 size: CGSize(width: 1180, height: 1500), dark: dark, name: "n12-payroll")
    }

    @Test("Payroll & Budget: every contract", arguments: [false, true])
    func payrollContracts(dark: Bool) throws {
        let view = try #require(PreviewFixtures.office.payroll)
        try draw(hosted(OfficeTablePane(view.contracts, id: "payroll.contracts", name: view.title.display) {
            OfficeHead(title: view.title.display, byline: view.byline, parts: view.bylineParts, lede: view.lede, freshness: view.freshness, refreshing: false)
        } notes: { EmptyView() }), size: CGSize(width: 1280, height: 820), dark: dark, name: "n12-payroll-contracts")
    }

    @Test("Contracts", arguments: [false, true])
    func contracts(dark: Bool) throws {
        try draw(hosted(ContractsView()), size: CGSize(width: 1280, height: 860), dark: dark, name: "n12-contracts")
    }

    @Test("Free Agents", arguments: [false, true])
    func freeAgents(dark: Bool) throws {
        try draw(hosted(FreeAgentsView()), size: CGSize(width: 1280, height: 860), dark: dark, name: "n12-free-agents")
    }

    @Test("The Horizon Board", arguments: [false, true])
    func horizon(dark: Bool) throws {
        try draw(hosted(HorizonBoardView()), size: CGSize(width: 1180, height: 1500), dark: dark, name: "n12-horizon")
    }

    @Test("The Horizon Board on a narrow column: a card per position", arguments: [false, true])
    func horizonNarrow(dark: Bool) throws {
        try draw(hosted(HorizonBoardView()), size: CGSize(width: 560, height: 1800), dark: dark, name: "n12-horizon-narrow")
    }

    @Test("The Injury Report", arguments: [false, true])
    func injuries(dark: Bool) throws {
        try draw(hosted(InjuryReportView()), size: CGSize(width: 1100, height: 720), dark: dark, name: "n12-injury-report")
    }

    // MARK: Drawing

    private func draw(_ view: some View, size: CGSize, dark: Bool, name: String) throws {
        _ = NSApplication.shared
        let host = NSHostingView(rootView: view.frame(width: size.width, height: size.height))
        let window = NSWindow(contentRect: CGRect(origin: .zero, size: size), styleMask: [.titled, .closable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = host
        window.setFrameOrigin(NSPoint(x: -20_000, y: -20_000))
        window.orderFrontRegardless()
        for _ in 0..<40 { RunLoop.main.run(until: Date().addingTimeInterval(0.03)) }
        let drawn = window.contentView?.superview ?? host
        let rep = try #require(drawn.bitmapImageRepForCachingDisplay(in: drawn.bounds))
        drawn.cacheDisplay(in: drawn.bounds, to: rep)
        window.orderOut(nil)
        let png = try #require(rep.representation(using: .png, properties: [:]))
        try png.write(to: Self.folder.appending(path: "\(name)-\(dark ? "dark" : "light").png"))
    }
}
