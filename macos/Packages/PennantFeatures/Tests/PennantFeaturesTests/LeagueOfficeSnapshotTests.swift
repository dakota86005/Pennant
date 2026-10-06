import AppKit
@testable import FeatureCore
import Foundation
@testable import League
import PennantAPI
import PennantDesign
import PennantKit
@testable import Scouting
@testable import Shell
import SwiftUI
import Testing

/// Pictures of League Office's and Scouting's views for review (N12 Track B; SWIFTUI_REBUILD.md section 8), from the
/// captured fixtures, light and dark, into `build/macos-snapshots/` (`league-*`, `scouting-*`). Drawn the way
/// `ClubhouseSnapshotTests` draws: hosted off-screen and cached, so the native tables and the charts draw. Skipped on CI.
@MainActor
@Suite("League Office and Scouting snapshots", .serialized, .enabled(if: ProcessInfo.processInfo.environment["CI"] == nil))
struct LeagueOfficeSnapshotTests {
    static let folder = PreviewFixtures.repositoryRoot.appending(path: "build/macos-snapshots", directoryHint: .isDirectory)

    init() throws {
        try FileManager.default.createDirectory(at: Self.folder, withIntermediateDirectories: true)
    }

    private func hosted(_ view: some View) -> some View {
        let model = PreviewFixtures.ready()
        let window = MainWindowModel(registry: DepartmentRegistry(allDepartments))
        return NavigationStack { view }
            .environment(model)
            .environment(AppRouting())
            .environment(\.routeOpener, window)
    }

    @Test("Standings: our division, the race as facts, the staff's rough read beneath", arguments: [false, true])
    func standings(dark: Bool) throws {
        try draw(hosted(StandingsView()), size: CGSize(width: 1180, height: 900), dark: dark, name: "league-standings")
    }

    @Test("Leaders: a batting category's top ten", arguments: [false, true])
    func leaders(dark: Bool) throws {
        try draw(hosted(LeadersView()), size: CGSize(width: 1000, height: 760), dark: dark, name: "league-leaders")
    }

    @Test("Org Comparison: our figures and every club", arguments: [false, true])
    func orgComparison(dark: Bool) throws {
        try draw(hosted(OrgComparisonView()), size: CGSize(width: 1280, height: 860), dark: dark, name: "league-org-comparison")
    }

    @Test("Franchise History: the record and its chart", arguments: [false, true])
    func franchise(dark: Bool) throws {
        try draw(hosted(FranchiseHistoryView()), size: CGSize(width: 1100, height: 900), dark: dark, name: "league-franchise-history")
    }

    @Test("Franchise History's chart on a long history (86 seasons, the served shape, made up for the picture)", arguments: [false, true])
    func longHistoryChart(dark: Bool) throws {
        let served = try #require(PreviewFixtures.leagueOffice.franchise?.chart)
        var chart = served
        chart.points = (1930...2015).map { year in
            let wins = 62 + (year * 37 % 41)
            let result = year % 17 == 0 ? "title" : year % 5 == 0 ? "playoffs" : "none"
            return .init(year: year, wins: wins, losses: 162 - wins, result: result, display: "\(year): \(wins)-\(162 - wins)")
        }
        try draw(hosted(OfficePage { SeasonRecordChart(chart: chart) }), size: CGSize(width: 1000, height: 420), dark: dark, name: "league-franchise-chart-86")
    }

    @Test("Us vs Them: the season side by side", arguments: [false, true])
    func usVsThem(dark: Bool) throws {
        try draw(hosted(UsVsThemView()), size: CGSize(width: 1100, height: 860), dark: dark, name: "league-us-vs-them")
    }

    @Test("Draft Board", arguments: [false, true])
    func draftBoard(dark: Bool) throws {
        try draw(hosted(DraftBoardView()), size: CGSize(width: 1180, height: 860), dark: dark, name: "scouting-draft-board")
    }

    @Test("Player Search as it opens", arguments: [false, true])
    func playerSearch(dark: Bool) throws {
        try draw(hosted(PlayerSearchView()), size: CGSize(width: 1280, height: 860), dark: dark, name: "scouting-player-search")
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
