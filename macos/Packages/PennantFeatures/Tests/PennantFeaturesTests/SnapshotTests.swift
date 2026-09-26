import AppKit
import FeatureCore
import Foundation
import PennantAPI
import PennantKit
import Setup
@testable import Shell
import SwiftUI
import Testing

/// Pictures of the shell for review (SWIFTUI_REBUILD.md section 8), drawn from `contract/fixtures/` in light and dark
/// at their real sizes, into `build/macos-snapshots/` (ignored by Git). They are the visual check while UI automation
/// is unavailable; nothing is compared against a reference.
///
/// Each view is hosted in an off-screen window and drawn with `cacheDisplay`, which draws AppKit-backed controls
/// (lists, forms, toolbars) that `ImageRenderer` cannot. The floating glass sidebar of a split view does not draw that
/// way, so the main window's pictures draw the sidebar on its own and place it over the sidebar column.
///
/// Skipped on CI (no one looks at them there, and a hosted runner's window server is not guaranteed).
@MainActor
@Suite("Snapshots", .serialized, .enabled(if: ProcessInfo.processInfo.environment["CI"] == nil))
struct SnapshotTests {
    static let folder = PreviewFixtures.repositoryRoot.appending(path: "build/macos-snapshots", directoryHint: .isDirectory)
    static let window = CGSize(width: 1280, height: 800)
    let registry = DepartmentRegistry(allDepartments)

    init() throws {
        try FileManager.default.createDirectory(at: Self.folder, withIntermediateDirectories: true)
    }

    // MARK: The main window

    @Test("the sidebar with the club card", arguments: [false, true])
    func sidebar(dark: Bool) throws {
        let model = PreviewFixtures.ready()
        let window = MainWindowModel(registry: registry, expanded: ["frontOffice", "majorLeague"])
        try draw(sidebarView(model: model, window: window), size: CGSize(width: SidebarView.idealWidth, height: 800), dark: dark, name: "sidebar-club-card")
    }

    @Test("a department's placeholder view, with the inspector", arguments: [false, true])
    func placeholder(dark: Bool) throws {
        let model = PreviewFixtures.ready()
        let window = MainWindowModel(registry: registry, inspectorPresented: true, expanded: ["frontOffice", "majorLeague"])
        window.go(to: AppRoute(department: "majorLeague", view: "lineup"))
        window.go(to: AppRoute(department: "frontOffice", view: "morningReport"))
        try drawMainWindow(model: model, window: window, dark: dark, name: "main-window-morning-report")
    }

    @Test("a main window with no save chosen", arguments: [false, true])
    func noSave(dark: Bool) throws {
        let model = PreviewFixtures.ready(configured: false)
        let window = MainWindowModel(registry: registry)
        try drawMainWindow(model: model, window: window, dark: dark, name: "main-window-no-save")
    }

    nonisolated static let states: [(String, ServerState)] = [
        ("starting", .starting),
        ("restarting", .restarting(attempt: 2, after: .seconds(2))),
        ("failed", .failed(ServerFailure(kind: .startFailed, serverMessage: "The export folder could not be read."))),
        ("locked", .locked(message: "Another copy of Pennant is using this data folder (Pennant, pid 4242). Quit it and try again.")),
        ("backup-failed", .failed(ServerFailure(kind: .backupFailed, detail: "The disk is full."))),
        ("no-data-folder", .failed(ServerFailure(kind: .noDataFolderChosen))),
        ("not-installed", .failed(ServerFailure(kind: .notInstalled))),
    ]

    @Test("each server state", arguments: states.map(\.0), [false, true])
    func serverState(name: String, dark: Bool) throws {
        let state = try #require(Self.states.first { $0.0 == name }?.1)
        let model = PreviewFixtures.state(state)
        let window = MainWindowModel(registry: registry)
        try draw(MainWindowView(window: window).environment(model).environment(AppRouting()),
                 size: Self.window, dark: dark, name: "server-\(name)", titled: true)
    }

    // MARK: Setup

    static var locations: [Components.Schemas.SearchLocation] {
        [
            .init(label: "OOTP Baseball 27", path: "~/Library/Application Support/Out of the Park Developments/OOTP Baseball 27/saved_games", exists: true),
            .init(label: "OOTP Baseball 26", path: "~/Library/Application Support/Out of the Park Developments/OOTP Baseball 26/saved_games", exists: false),
        ]
    }

    nonisolated static let setupSteps: [String] = [
        "find-save", "find-save-problem", "find-save-unreachable", "importing", "import-failed", "import-interrupted",
        "pick-club", "pick-club-failed",
    ]

    static func setupModel(_ name: String) -> SetupModel {
        let saves = PreviewFixtures.saves
        let progress = Components.Schemas.ImportProgress(
            table: "players_career_batting_stats", fileIndex: 23, files: 71, rows: 184_220, phase: .init(value1: .writing),
            words: .init(phase: "Writing the league", table: "Career hitting", display: "Writing career hitting · 23 of 71")
        )
        switch name {
        case "find-save-problem":
            return .preview(step: .findSave, saves: [], locations: locations, folderProblem: .served("That folder is not an OOTP save, a folder of saves, or an export."))
        case "importing":
            return .preview(step: .importing, chosen: saves.first, progress: progress)
        case "find-save-unreachable":
            return .preview(step: .findSave, loadProblem: .unreachable(detail: "URLError(.timedOut)"))
        case "import-interrupted":
            return .preview(step: .importing, chosen: saves.first, importProblem: .served("The last import stopped before it finished. Import again to finish it."))
        case "pick-club-failed":
            return .preview(step: .pickClub, clubProblem: .failed(detail: "HTTP 500"))
        case "import-failed":
            return .preview(step: .importing, chosen: saves.first, importProblem: .served("A file in the export went missing while it was read. Export the league from OOTP again, then import.", detail: "ENOENT: players.csv"))
        case "pick-club":
            return .preview(step: .pickClub, clubs: PreviewFixtures.orgs)
        default:
            return .preview(step: .findSave, saves: saves, locations: locations)
        }
    }

    @Test("each Setup step", arguments: setupSteps, [false, true])
    func setup(step: String, dark: Bool) throws {
        let view = SetupView(model: Self.setupModel(step), status: nil)
        try draw(view, size: SetupView.size, dark: dark, name: "setup-\(step)", titled: true)
    }

    // MARK: Settings

    @Test("each Settings tab", arguments: AppRouting.SettingsTab.allCases, [false, true])
    func settings(tab: AppRouting.SettingsTab, dark: Bool) throws {
        let routing = AppRouting()
        routing.settingsTab = tab
        let model = PreviewFixtures.ready()
        let view = Group {
            switch tab {
            case .general: GeneralSettings()
            case .appearance: AppearanceSettings()
            case .ai: AISettings(preloaded: PreviewFixtures.providers)
            }
        }
        try draw(view.environment(model).environment(routing), size: CGSize(width: SettingsView.width, height: SettingsView.height(tab)), dark: dark, name: "settings-\(tab.rawValue)", titled: true)
    }

    @Test("General at full length, down to the data status", arguments: [false, true])
    func generalFull(dark: Bool) throws {
        let view = GeneralSettings().environment(PreviewFixtures.ready()).environment(AppRouting())
        try draw(view, size: CGSize(width: SettingsView.width, height: 1300), dark: dark, name: "settings-general-full", titled: true)
    }

    @Test("every department open in the sidebar: every view title fits", arguments: [false, true])
    func sidebarAllOpen(dark: Bool) throws {
        let model = PreviewFixtures.ready()
        let window = MainWindowModel(registry: registry, expanded: Set(registry.departments.map(\.id)))
        try draw(sidebarView(model: model, window: window), size: CGSize(width: SidebarView.idealWidth, height: 2000), dark: dark, name: "sidebar-all-departments")
    }

    @Test("the club card with team colours off: neutral", arguments: [false, true])
    func neutralCard(dark: Bool) throws {
        let model = PreviewFixtures.ready(useTeamColors: false)
        let window = MainWindowModel(registry: registry)
        try draw(sidebarView(model: model, window: window), size: CGSize(width: SidebarView.idealWidth, height: 300), dark: dark, name: "sidebar-club-card-neutral")
    }

    @Test("a main window showing why the import the GM asked for did not start", arguments: [false, true])
    func importProblem(dark: Bool) throws {
        let model = PreviewFixtures.ready(importRequestProblem: .served("CSV directory not found: /Users/gm/OOTP/Test League.lg/import_export/csv"))
        let window = MainWindowModel(registry: registry)
        try drawMainWindow(model: model, window: window, dark: dark, name: "main-window-import-problem")
    }

    // MARK: Drawing

    private func sidebarView(model: AppModel, window: MainWindowModel) -> some View {
        SidebarView(window: window).environment(model).environment(AppRouting())
    }

    /// The main window, with the sidebar drawn on its own and laid over the sidebar column.
    private func drawMainWindow(model: AppModel, window: MainWindowModel, dark: Bool, name: String) throws {
        let whole = try image(MainWindowView(window: window).environment(model).environment(AppRouting()),
                              size: Self.window, dark: dark, titled: true)
        let sidebar = try image(sidebarView(model: model, window: window),
                                size: CGSize(width: SidebarView.idealWidth, height: Self.window.height), dark: dark, titled: true)
        let composite = NSImage(size: whole.size, flipped: false) { rect in
            whole.draw(in: rect)
            sidebar.draw(in: CGRect(x: 0, y: 0, width: sidebar.size.width, height: sidebar.size.height))
            return true
        }
        try write(composite, name: name, dark: dark)
    }

    private func draw(_ view: some View, size: CGSize, dark: Bool, name: String, titled: Bool = false) throws {
        try write(try image(view, size: size, dark: dark, titled: titled), name: name, dark: dark)
    }

    /// Hosts the view in an off-screen window of the given content size and draws the whole window (with its title
    /// bar and toolbar when `titled`).
    private func image(_ view: some View, size: CGSize, dark: Bool, titled: Bool) throws -> NSImage {
        _ = NSApplication.shared
        let host = NSHostingView(rootView: view.frame(width: size.width, height: size.height))
        let style: NSWindow.StyleMask = titled ? [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView] : [.borderless]
        let window = NSWindow(contentRect: CGRect(origin: .zero, size: size), styleMask: style, backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = host
        window.setFrameOrigin(NSPoint(x: -20_000, y: -20_000))
        window.orderFrontRegardless()
        for _ in 0..<30 { RunLoop.main.run(until: Date().addingTimeInterval(0.03)) }
        let drawn = window.contentView?.superview ?? host
        let rep = try #require(drawn.bitmapImageRepForCachingDisplay(in: drawn.bounds))
        drawn.cacheDisplay(in: drawn.bounds, to: rep)
        window.orderOut(nil)
        let image = NSImage(size: drawn.bounds.size)
        image.addRepresentation(rep)
        return image
    }

    private func write(_ image: NSImage, name: String, dark: Bool) throws {
        let tiff = try #require(image.tiffRepresentation)
        let png = try #require(NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]))
        try png.write(to: Self.folder.appending(path: "\(name)-\(dark ? "dark" : "light").png"))
    }
}
