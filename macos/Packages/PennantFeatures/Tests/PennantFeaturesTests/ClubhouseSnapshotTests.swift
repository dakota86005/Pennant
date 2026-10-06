import AppKit
@testable import FeatureCore
import Foundation
@testable import MajorLeague
import PennantAPI
import PennantDesign
import PennantKit
@testable import Shell
import SwiftUI
import Testing

/// Pictures of Major League Ops' clubhouse tools for review (N9; SWIFTUI_REBUILD.md section 8), from the captured
/// fixtures, light and dark, into `build/macos-snapshots/` (`clubhouse-*`). Drawn the way `FarmSnapshotTests` draws:
/// hosted off-screen and cached, so the native tables draw. Skipped on CI.
@MainActor
@Suite("Clubhouse snapshots", .serialized, .enabled(if: ProcessInfo.processInfo.environment["CI"] == nil))
struct ClubhouseSnapshotTests {
    static let folder = PreviewFixtures.repositoryRoot.appending(path: "build/macos-snapshots", directoryHint: .isDirectory)

    init() throws {
        try FileManager.default.createDirectory(at: Self.folder, withIntermediateDirectories: true)
    }

    private func hosted(_ view: some View, route: AppRoute? = nil) -> some View {
        let model = PreviewFixtures.ready()
        let window = MainWindowModel(registry: DepartmentRegistry(allDepartments))
        return view
            .environment(model)
            .environment(AppRouting())
            .environment(\.routeOpener, window)
            .environment(\.currentRoute, route)
    }

    @Test("Lineup: the staff's card, its choices and the next game", arguments: [false, true])
    func lineup(dark: Bool) throws {
        try draw(hosted(LineupView()), size: CGSize(width: 1180, height: 900), dark: dark, name: "clubhouse-lineup")
    }

    @Test("Pitching Availability: the bullpen's rest calendar", arguments: [false, true])
    func pitching(dark: Bool) throws {
        try draw(hosted(PitchingAvailabilityView()), size: CGSize(width: 1280, height: 820), dark: dark, name: "clubhouse-pitching-availability")
    }

    @Test("Schedule & Game Plans: opened on the next game, its plan beneath", arguments: [false, true])
    func schedule(dark: Bool) throws {
        try draw(hosted(ScheduleView()), size: CGSize(width: 1180, height: 1000), dark: dark, name: "clubhouse-schedule")
    }

    @Test("Depth Chart by position: one position across every level in a table", arguments: [false, true])
    func depthByPosition(dark: Bool) throws {
        try draw(hosted(DepthChartView()), size: CGSize(width: 1180, height: 900), dark: dark, name: "clubhouse-depth-chart-by-position")
    }

    @Test("Depth Chart by club: the field and its pitchers", arguments: [false, true])
    func depth(dark: Bool) throws {
        try draw(hosted(DepthChartView(byClub: true)), size: CGSize(width: 1180, height: 900), dark: dark, name: "clubhouse-depth-chart")
    }

    @Test("Depth Chart by club on a narrow column: the positions as cards", arguments: [false, true])
    func depthNarrow(dark: Bool) throws {
        try draw(hosted(DepthChartView(byClub: true)), size: CGSize(width: 560, height: 1200), dark: dark, name: "clubhouse-depth-chart-narrow")
    }

    @Test("40-Man & Options, opened from a desk item on its player", arguments: [false, true])
    func fortyMan(dark: Bool) throws {
        let player = try #require(PreviewFixtures.clubhouse.fortyMan?.sections.last?.table.rows.first?.player?.playerId)
        try draw(hosted(FortyManView(), route: AppRoute(department: "majorLeague", view: "fortyManOptions", key: String(player))),
                 size: CGSize(width: 1180, height: 1000), dark: dark, name: "clubhouse-forty-man")
    }

    @Test("Rosters: the major league club's hitters", arguments: [false, true])
    func rosters(dark: Bool) throws {
        try draw(hosted(RostersView()), size: CGSize(width: 1280, height: 820), dark: dark, name: "clubhouse-rosters")
    }

    @Test("Season Trends", arguments: [false, true])
    func trends(dark: Bool) throws {
        try draw(hosted(SeasonTrendsView()), size: CGSize(width: 1000, height: 1300), dark: dark, name: "clubhouse-season-trends")
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
