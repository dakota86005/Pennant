import AppKit
@testable import FeatureCore
import Foundation
import PennantAPI
import PennantDesign
import PennantKit
@testable import Player
@testable import Shell
import SwiftUI
import Testing

/// Pictures of the player window and Compare for review (N11; SWIFTUI_REBUILD.md section 8), from the captured and the
/// player tests' own fixtures, light and dark, into `build/macos-snapshots/` (`n11-*`). Drawn the way `SnapshotTests`
/// draws: hosted off-screen and cached, so the native tables and charts draw. Skipped on CI.
@MainActor
@Suite("Player snapshots", .serialized, .enabled(if: ProcessInfo.processInfo.environment["CI"] == nil))
struct PlayerSnapshotTests {
    static let folder = PreviewFixtures.repositoryRoot.appending(path: "build/macos-snapshots", directoryHint: .isDirectory)

    init() throws {
        try FileManager.default.createDirectory(at: Self.folder, withIntermediateDirectories: true)
    }

    private func hosted(_ view: some View) -> some View {
        view
            .environment(PreviewFixtures.ready())
            .environment(AppRouting())
    }

    private func dossier(_ name: String = "dossier-rich") throws -> Components.Schemas.PlayerDossierView {
        try #require(PreviewFixtures.playerFixture(Components.Schemas.PlayerDossierView.self, name))
    }

    /// The header above a tab, as the window draws them.
    private func page(_ d: Components.Schemas.PlayerDossierView, @ViewBuilder tab: () -> some View) -> some View {
        VStack(spacing: 0) {
            PlayerHeader(dossier: d, updating: false, problem: nil)
            Divider()
            tab()
        }
        .background(Color.readablePage)
    }

    @Test("Overview", arguments: [false, true])
    func overview(dark: Bool) throws {
        let d = try dossier()
        try draw(hosted(page(d) { PlayerOverviewTab(dossier: d) }), size: CGSize(width: 980, height: 900), dark: dark, name: "n11-player-overview")
    }

    @Test("Ratings: the grades and the rating history", arguments: [false, true])
    func ratings(dark: Bool) throws {
        let d = try dossier()
        try draw(hosted(page(d) { PlayerRatingsTab(dossier: d) }), size: CGSize(width: 980, height: 1300), dark: dark, name: "n11-player-ratings")
    }

    @Test("Ratings: OSA's view filling in, marked, with a change of source (D-067)", arguments: [false, true])
    func ratingsFilled(dark: Bool) throws {
        let d = try dossier("dossier-filled")
        try draw(hosted(page(d) { PlayerRatingsTab(dossier: d) }), size: CGSize(width: 980, height: 1300), dark: dark, name: "n11-player-ratings-osa")
    }

    @Test("Value: the totals, our view and the production cone", arguments: [false, true])
    func value(dark: Bool) throws {
        let d = try dossier()
        try draw(hosted(page(d) { PlayerValueTab(dossier: d) }), size: CGSize(width: 980, height: 1400), dark: dark, name: "n11-player-value")
    }

    @Test("Contract & Rights", arguments: [false, true])
    func contract(dark: Bool) throws {
        let d = try dossier()
        try draw(hosted(page(d) { PlayerContractTab(dossier: d) }), size: CGSize(width: 980, height: 900), dark: dark, name: "n11-player-contract")
    }

    @Test("History: the record, where he is now and the log", arguments: [false, true])
    func history(dark: Bool) throws {
        let d = try dossier()
        try draw(hosted(page(d) { PlayerHistoryTab(dossier: d) }), size: CGSize(width: 980, height: 1000), dark: dark, name: "n11-player-history")
    }

    @Test("Notes: the GM's and the staff's", arguments: [false, true])
    func notes(dark: Bool) throws {
        let d = try dossier()
        try draw(hosted(page(d) { PlayerNotesTab(playerId: d.playerId) }), size: CGSize(width: 980, height: 800), dark: dark, name: "n11-player-notes")
    }

    @Test("The whole window at its narrowest", arguments: [false, true])
    func narrow(dark: Bool) throws {
        let d = try dossier()
        try draw(hosted(PlayerWindowView(playerId: d.playerId)), size: CGSize(width: 520, height: 700), dark: dark, name: "n11-player-window-narrow")
    }

    @Test("Compare: three players, one marked OSA", arguments: [false, true])
    func compare(dark: Bool) throws {
        let c = try #require(PreviewFixtures.playerFixture(Components.Schemas.PlayerCompareView.self, "compare-three"))
        let value = ComparisonRef(players: c.players.map { PlayerRef(id: $0.playerId) })
        try draw(hosted(CompareWindowView(value: .constant(value))), size: CGSize(width: 1100, height: 1200), dark: dark, name: "n11-compare")
    }

    @Test("Compare: waiting for players", arguments: [false, true])
    func compareEmpty(dark: Bool) throws {
        try draw(hosted(CompareWindowView(value: .constant(ComparisonRef()))), size: CGSize(width: 700, height: 420), dark: dark, name: "n11-compare-empty")
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
