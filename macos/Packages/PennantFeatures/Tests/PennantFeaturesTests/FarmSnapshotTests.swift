import AppKit
@testable import Farm
@testable import FeatureCore
import Foundation
import PennantAPI
import PennantDesign
import PennantKit
@testable import Shell
import SwiftUI
import Testing

/// Pictures of Farm & Development's views for review (N10; SWIFTUI_REBUILD.md section 8), from the captured and the
/// farm's own fixtures, light and dark, into `build/macos-snapshots/` (`farm-*`). Drawn the way `SnapshotTests` draws:
/// hosted off-screen and cached, so the native tables draw. Skipped on CI.
@MainActor
@Suite("Farm snapshots", .serialized, .enabled(if: ProcessInfo.processInfo.environment["CI"] == nil))
struct FarmSnapshotTests {
    static let folder = PreviewFixtures.repositoryRoot.appending(path: "build/macos-snapshots", directoryHint: .isDirectory)

    init() throws {
        try FileManager.default.createDirectory(at: Self.folder, withIntermediateDirectories: true)
    }

    private func hosted(_ view: some View, subject: String? = nil) -> some View {
        let model = PreviewFixtures.ready()
        let window = MainWindowModel(registry: DepartmentRegistry(allDepartments))
        return view
            .environment(model)
            .environment(AppRouting())
            .environment(\.routeOpener, window)
            .environment(\.routeSubject, subject)
    }

    @Test("Organization", arguments: [false, true])
    func organization(dark: Bool) throws {
        try draw(hosted(FarmOrganizationView()), size: CGSize(width: 1100, height: 2200), dark: dark, name: "farm-organization")
    }

    @Test("Affiliates: the organization and an affiliate", arguments: [false, true])
    func affiliates(dark: Bool) throws {
        try draw(hosted(FarmAffiliatesView()), size: CGSize(width: 1180, height: 1400), dark: dark, name: "farm-affiliates")
    }

    @Test("Assignments", arguments: [false, true])
    func assignments(dark: Bool) throws {
        try draw(hosted(NavigationStack { FarmAssignmentsView() }), size: CGSize(width: 1180, height: 520), dark: dark, name: "farm-assignments")
    }

    @Test("A decision whose chain has steps and leaves a hole", arguments: [false, true])
    func decisionCascade(dark: Bool) throws {
        let cascade = try #require(PreviewFixtures.farmFixture(Components.Schemas.FarmDecisionView.self, "decision-cascade"))
        try draw(hosted(FarmDecisionView(), subject: String(cascade.playerId)), size: CGSize(width: 1100, height: 3000), dark: dark, name: "farm-decision-cascade")
    }

    @Test("Decision opened on its own: the assignments in question", arguments: [false, true])
    func decisionIndex(dark: Bool) throws {
        try draw(hosted(FarmDecisionView()), size: CGSize(width: 1000, height: 420), dark: dark, name: "farm-decision-index")
    }

    @Test("Prospects: the board and a development meeting", arguments: [false, true])
    func prospects(dark: Bool) throws {
        try draw(hosted(NavigationStack { FarmProspectsView() }), size: CGSize(width: 1280, height: 900), dark: dark, name: "farm-prospects")
    }

    @Test("Development tracking: the movers and a player's history", arguments: [false, true])
    func development(dark: Bool) throws {
        try draw(hosted(NavigationStack { FarmDevelopmentView() }), size: CGSize(width: 1280, height: 900), dark: dark, name: "farm-development")
    }

    @Test("the farm's report, its items opening where the farm answers them", arguments: [false, true])
    func report(dark: Bool) throws {
        try draw(hosted(DepartmentReportView(department: "farm")), size: CGSize(width: 1000, height: 1800), dark: dark, name: "farm-report")
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
