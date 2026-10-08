import AppKit
@testable import FeatureCore
import Foundation
import PennantAPI
import PennantDesign
import PennantKit
@testable import Philosophy
@testable import Shell
import SwiftUI
import Testing
@testable import Trades

/// Pictures of Trades and Philosophy & Staff for review (N12 Track C; SWIFTUI_REBUILD.md section 8), from the captured
/// fixtures, light and dark, into `build/macos-snapshots/` (`trades-*`, `philosophy-*`). Drawn the way the clubhouse's are:
/// hosted off-screen and cached, so the native tables and the form draw. Skipped on CI.
@MainActor
@Suite("Trades and Philosophy snapshots", .serialized, .enabled(if: ProcessInfo.processInfo.environment["CI"] == nil))
struct TradesPhilosophySnapshotTests {
    static let folder = PreviewFixtures.repositoryRoot.appending(path: "build/macos-snapshots", directoryHint: .isDirectory)

    init() throws {
        try FileManager.default.createDirectory(at: Self.folder, withIntermediateDirectories: true)
    }

    private func hosted(_ view: some View, model: AppModel = PreviewFixtures.ready()) -> some View {
        let window = MainWindowModel(registry: DepartmentRegistry(allDepartments))
        return view
            .environment(model)
            .environment(AppRouting())
            .environment(\.routeOpener, window)
    }

    @Test("Trade Desk: a deal weighed, the difference drawn, the inbox and the league's fits", arguments: [false, true])
    func tradeDesk(dark: Bool) throws {
        try draw(hosted(TradeDeskView()), size: CGSize(width: 1180, height: 2000), dark: dark, name: "trades-trade-desk")
    }

    @Test("Trade Desk on a narrow column: the sides one above the other", arguments: [false, true])
    func tradeDeskNarrow(dark: Bool) throws {
        try draw(hosted(TradeDeskView()), size: CGSize(width: 480, height: 2400), dark: dark, name: "trades-trade-desk-narrow")
    }

    @Test("Trade Desk with the AI desk on and an answer (drawn from a hand-made answer: the server's tests run with no key)", arguments: [false, true])
    func tradeDeskAI(dark: Bool) throws {
        var desk = try #require(PreviewFixtures.decode(Components.Schemas.TradeDeskView.self, "getTradeDesk"))
        desk.ai.available = true
        desk.ai.off = nil
        let answer = Components.Schemas.TradeAnswer(
            voice: desk.ai.voice,
            lines: [
                .init(heading: true, text: "Read"),
                .init(heading: false, text: "The figures lean slightly toward what goes out, and the range is wide enough to sit either side of even."),
            ],
            content: "## Read\nThe figures lean slightly toward what goes out.",
            notice: nil,
            about: desk.ai.note
        )
        let trades = TradesStore.preview(desk: desk, analysis: PreviewFixtures.decode(Components.Schemas.TradeAnalysisView.self, "getTradeAnalysis"), answers: [answer])
        try draw(hosted(TradeDeskView(), model: PreviewFixtures.ready(trades: trades)), size: CGSize(width: 1180, height: 2200), dark: dark, name: "trades-trade-desk-ai")
    }

    @Test("Organizational Philosophy: the identity, the comparable clubs, each preference and policy", arguments: [false, true])
    func philosophy(dark: Bool) throws {
        try draw(hosted(OrganizationalPhilosophyView()), size: CGSize(width: 900, height: 2600), dark: dark, name: "philosophy-organizational-philosophy")
    }

    @Test("Organizational Philosophy after a change: what it did, said", arguments: [false, true])
    func philosophyChanged(dark: Bool) throws {
        let change = try #require(PreviewFixtures.decode(Components.Schemas.PhilosophyChange.self, "setOrganizationalPhilosophy-one-preference"))
        let store = PhilosophyStore.preview(philosophy: change.view, staff: nil, lastSaid: change.said)
        try draw(hosted(OrganizationalPhilosophyView(), model: PreviewFixtures.ready(philosophy: store)), size: CGSize(width: 900, height: 1000), dark: dark, name: "philosophy-changed")
    }

    @Test("Coaching Staff: the major-league staff in a native table", arguments: [false, true])
    func staff(dark: Bool) throws {
        try draw(hosted(CoachingStaffView()), size: CGSize(width: 1180, height: 820), dark: dark, name: "philosophy-coaching-staff")
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
