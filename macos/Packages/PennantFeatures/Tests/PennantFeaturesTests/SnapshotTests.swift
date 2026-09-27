import AppKit
import FeatureCore
import FrontOffice
import Foundation
import PennantAPI
import PennantDesign
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
        let height = SettingsView.height(tab, themes: model.themeChoices?.choices.count ?? 0, refusedPacks: model.themeChoices?.refused.count ?? 0)
        try draw(view.environment(model).environment(routing), size: CGSize(width: SettingsView.width, height: height), dark: dark, name: "settings-\(tab.rawValue)", titled: true)
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

    // MARK: The Front Office

    @Test("the Morning Report as served today: the desk and every department's card, at full length", arguments: [false, true])
    func morningReport(dark: Bool) throws {
        let model = PreviewFixtures.ready()
        let summary = try #require(model.frontOffice.summary)
        let view = ScrollView { MorningReportPage(summary: summary).padding(24) }.environment(model).environment(AppRouting())
            .environment(\.theme, model.theme).environment(\.contentWidth, 1000)
        try draw(view, size: CGSize(width: 1000, height: 2000), dark: dark, name: "morning-report-full")
    }

    nonisolated static let reports = ["frontOffice", "majorLeague", "farm", "finance", "medical", "scouting"]

    @Test("each department's report", arguments: reports, [false, true])
    func report(department: String, dark: Bool) throws {
        let model = PreviewFixtures.ready()
        let report = try #require(model.frontOffice.reports[department])
        let view = ScrollView { DepartmentReportContent(report: report).padding(24) }.environment(model).environment(AppRouting())
        try draw(view, size: CGSize(width: 900, height: department == "frontOffice" || department == "farm" ? 1700 : 900), dark: dark, name: "report-\(department)")
    }

    @Test("a report as the main window shows it", arguments: [false, true])
    func reportWindow(dark: Bool) throws {
        let model = PreviewFixtures.ready()
        let window = MainWindowModel(registry: registry, expanded: ["majorLeague"])
        window.go(to: AppRoute(department: "majorLeague", view: "report"))
        try drawMainWindow(model: model, window: window, dark: dark, name: "main-window-major-league-report")
    }

    @Test("an item's staff options (the evidence trail)", arguments: [false, true])
    func trail(dark: Bool) throws {
        let model = PreviewFixtures.ready()
        let key = try #require(model.frontOffice.trails.keys.first)
        try draw(TrailContent(evidence: key).padding().environment(model), size: CGSize(width: 420, height: 480), dark: dark, name: "staff-options")
    }

    // MARK: The glass shell and theme packs (N5)

    /// An appearance the shell is drawn in: light or dark, and with Increase Contrast or Reduce Transparency, as the app's
    /// own pieces draw them (`forcesIncreasedContrast`, `forcesReduceTransparency`), with AppKit in the high-contrast
    /// appearance for Increase Contrast. The system's own glass reads only the Mac's settings.
    enum Look: String, CaseIterable, Sendable {
        case light, dark, lightIncreasedContrast, darkIncreasedContrast, lightReduceTransparency, darkReduceTransparency

        var dark: Bool { [.dark, .darkIncreasedContrast, .darkReduceTransparency].contains(self) }
        var increasedContrast: Bool { self == .lightIncreasedContrast || self == .darkIncreasedContrast }
        var reduceTransparency: Bool { self == .lightReduceTransparency || self == .darkReduceTransparency }
        var appearance: NSAppearance.Name {
            switch self {
            case .lightIncreasedContrast: .accessibilityHighContrastAqua
            case .darkIncreasedContrast: .accessibilityHighContrastDarkAqua
            default: dark ? .darkAqua : .aqua
            }
        }
    }

    /// In the synthetic club's own colours and in the repository's example pack.
    @Test("the Morning Report's shell: masthead, glass and the floating control, in each theme and appearance",
          arguments: [nil, "sunset-series"] as [String?], Look.allCases)
    func shell(theme: String?, look: Look) throws {
        let model = PreviewFixtures.ready(themePack: theme)
        let window = MainWindowModel(registry: registry, expanded: ["frontOffice", "majorLeague"])
        window.go(to: AppRoute(department: "frontOffice", view: "morningReport"))
        try drawMainWindow(model: model, window: window, look: look, name: "shell-morning-report-\(theme ?? "club-colors")")
    }

    @Test("a department's report under its masthead, in each theme", arguments: [nil, "sunset-series"] as [String?], [Look.light, .dark])
    func reportShell(theme: String?, look: Look) throws {
        let model = PreviewFixtures.ready(themePack: theme)
        let window = MainWindowModel(registry: registry, expanded: ["majorLeague"])
        window.go(to: AppRoute(department: "majorLeague", view: "report"))
        try drawMainWindow(model: model, window: window, look: look, name: "shell-major-league-report-\(theme ?? "club-colors")")
    }

    @Test("the masthead and the club card with team colours off: neutral", arguments: [Look.light, .dark])
    func neutralShell(look: Look) throws {
        let model = PreviewFixtures.ready(useTeamColors: false)
        let window = MainWindowModel(registry: registry, expanded: ["frontOffice"])
        window.go(to: AppRoute(department: "frontOffice", view: "morningReport"))
        try drawMainWindow(model: model, window: window, look: look, name: "shell-morning-report-neutral")
    }

    @Test("Settings' theme choices with the example pack chosen", arguments: [Look.light, .dark])
    func themeSettings(look: Look) throws {
        let routing = AppRouting()
        routing.settingsTab = .appearance
        let model = PreviewFixtures.ready(themePack: "sunset-series")
        let view = AppearanceSettings().environment(model).environment(routing)
        let height = SettingsView.height(.appearance, themes: model.themeChoices?.choices.count ?? 0, refusedPacks: model.themeChoices?.refused.count ?? 0)
        try draw(view, size: CGSize(width: SettingsView.width, height: height), look: look, name: "settings-appearance-theme", titled: true)
    }

    // MARK: The design language (N5, Stage B)

    /// The design's window: the sample's size, so the pictures compare with the design shots.
    static let designWindow = CGSize(width: 1440, height: 900)
    nonisolated static let designThemes: [String?] = [nil, "sunset-series", "aurora-nights"]

    /// The Morning Report as designed (R2), the unserved slots drawn from the fixtures, in the club's own colours, the
    /// example pack and the example art pack, light, dark, and with Increase Contrast and Reduce Transparency.
    @Test("the Morning Report as designed, from the fixtures, in each theme and appearance", arguments: designThemes, Look.allCases)
    func designedMorningReport(theme: String?, look: Look) throws {
        // The art pack and the club's colours in every look; the example pack in light and dark alone
        guard theme != "sunset-series" || [.light, .dark].contains(look) else { return }
        let model = PreviewFixtures.ready(themePack: theme)
        let window = MainWindowModel(registry: registry, expanded: ["frontOffice"])
        window.go(to: AppRoute(department: "frontOffice", view: "morningReport"))
        try drawMainWindow(model: model, window: window, look: look, name: "design-morning-report-\(theme ?? "club-colors")", size: Self.designWindow, design: .fixture)
    }

    @Test("the Morning Report as designed, further down: the roster diagram, the staff, the wire and the departments", arguments: [Look.light, .dark])
    func designedMorningReportLower(look: Look) throws {
        let model = PreviewFixtures.ready()
        let summary = try #require(model.frontOffice.summary)
        let view = ScrollView { MorningReportPage(summary: summary).padding(.horizontal, 28).padding(.vertical, 24) }
            .environment(model).environment(AppRouting()).environment(\.theme, model.theme)
            .environment(\.contentWidth, 1160).environment(\.morningReportDesign, .fixture)
        try draw(view, size: CGSize(width: 1160, height: 2600), look: look, name: "design-morning-report-page")
    }

    @Test("the Morning Report as designed, narrow: the columns stack", arguments: [Look.light])
    func designedMorningReportNarrow(look: Look) throws {
        let model = PreviewFixtures.ready()
        let window = MainWindowModel(registry: registry, expanded: ["frontOffice"])
        window.go(to: AppRoute(department: "frontOffice", view: "morningReport"))
        try drawMainWindow(model: model, window: window, look: look, name: "design-morning-report-narrow", size: CGSize(width: 1000, height: 900), design: .fixture)
    }

    @Test("a department's report in the design, in each theme", arguments: designThemes, [Look.light, .dark])
    func designedReport(theme: String?, look: Look) throws {
        let model = PreviewFixtures.ready(themePack: theme)
        let window = MainWindowModel(registry: registry, expanded: ["majorLeague"])
        window.go(to: AppRoute(department: "majorLeague", view: "report"))
        try drawMainWindow(model: model, window: window, look: look, name: "design-major-league-report-\(theme ?? "club-colors")", size: Self.designWindow)
    }

    @Test("the ⌘K palette over the window", arguments: [Look.light, .dark, .lightReduceTransparency])
    func palette(look: Look) throws {
        let model = PreviewFixtures.ready()
        let window = MainWindowModel(registry: registry, expanded: ["frontOffice"])
        window.paletteShown = true
        window.paletteQuery = "rep"
        try drawMainWindow(model: model, window: window, look: look, name: "design-palette", size: Self.designWindow, design: .fixture)
    }

    @Test("a claim pinned to the inspector", arguments: [Look.light, .dark])
    func pinned(look: Look) throws {
        let model = PreviewFixtures.ready()
        let window = MainWindowModel(registry: registry, inspectorPresented: true, expanded: ["frontOffice"])
        window.pin(DesignFixtures.positions[0].claim)
        try drawMainWindow(model: model, window: window, look: look, name: "design-inspector-evidence", size: Self.designWindow, design: .fixture)
    }

    nonisolated static let components = ["masthead", "sections", "places", "roster", "rows", "basis", "palette"]

    @Test("each component, from the fixtures", arguments: components, Look.allCases)
    func component(name: String, look: Look) throws {
        let model = PreviewFixtures.ready(themePack: "aurora-nights")
        let width: CGFloat = name == "roster" || name == "masthead" ? 1160 : 1000
        let view = ComponentSheet(name: name).environment(model).environment(AppRouting()).environment(\.theme, model.theme)
            .environment(\.claimActions, ClaimActions(pin: { _ in }, detach: { _ in }, canOpen: { _ in true }, open: { _ in }, departmentName: { _ in "Major League Ops" }))
        try draw(view, size: CGSize(width: width, height: name == "roster" ? 900 : 700), look: look, name: "design-component-\(name)")
    }

    // MARK: Drawing

    private func sidebarView(model: AppModel, window: MainWindowModel) -> some View {
        SidebarView(window: window).environment(model).environment(AppRouting()).environment(\.theme, model.theme)
    }

    /// The main window, with the sidebar drawn on its own and laid over the sidebar column.
    private func drawMainWindow(model: AppModel, window: MainWindowModel, dark: Bool, name: String) throws {
        try drawMainWindow(model: model, window: window, look: dark ? .dark : .light, name: name, suffix: dark ? "dark" : "light")
    }

    private func drawMainWindow(model: AppModel, window: MainWindowModel, look: Look, name: String, suffix: String? = nil, size: CGSize = SnapshotTests.window, design: MorningReportDesign? = nil) throws {
        let whole = try image(looked(MainWindowView(window: window).environment(model).environment(AppRouting()).environment(\.morningReportDesign, design), look),
                              size: size, appearance: look.appearance, titled: true)
        let sidebar = try image(looked(sidebarView(model: model, window: window), look),
                                size: CGSize(width: SidebarView.idealWidth, height: size.height), appearance: look.appearance, titled: true)
        let composite = NSImage(size: whole.size, flipped: false) { rect in
            whole.draw(in: rect)
            sidebar.draw(in: CGRect(x: 0, y: 0, width: sidebar.size.width, height: sidebar.size.height))
            return true
        }
        try write(composite, file: "\(name)-\(suffix ?? look.rawValue).png")
    }

    /// The view with the look's accessibility settings the environment can carry.
    private func looked(_ view: some View, _ look: Look) -> some View {
        view
            .environment(\.forcesIncreasedContrast, look.increasedContrast)
            .environment(\.forcesReduceTransparency, look.reduceTransparency)
    }

    private func draw(_ view: some View, size: CGSize, dark: Bool, name: String, titled: Bool = false) throws {
        try write(try image(view, size: size, dark: dark, titled: titled), name: name, dark: dark)
    }

    private func draw(_ view: some View, size: CGSize, look: Look, name: String, titled: Bool = false) throws {
        try write(try image(looked(view, look), size: size, appearance: look.appearance, titled: titled), file: "\(name)-\(look.rawValue).png")
    }

    private func image(_ view: some View, size: CGSize, dark: Bool, titled: Bool) throws -> NSImage {
        try image(view, size: size, appearance: dark ? .darkAqua : .aqua, titled: titled)
    }

    /// Hosts the view in an off-screen window of the given content size and draws the whole window (with its title
    /// bar and toolbar when `titled`).
    private func image(_ view: some View, size: CGSize, appearance: NSAppearance.Name, titled: Bool) throws -> NSImage {
        _ = NSApplication.shared
        let host = NSHostingView(rootView: view.frame(width: size.width, height: size.height))
        let style: NSWindow.StyleMask = titled ? [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView] : [.borderless]
        let window = NSWindow(contentRect: CGRect(origin: .zero, size: size), styleMask: style, backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.appearance = NSAppearance(named: appearance)
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
        try write(image, file: "\(name)-\(dark ? "dark" : "light").png")
    }

    private func write(_ image: NSImage, file: String) throws {
        let tiff = try #require(image.tiffRepresentation)
        let png = try #require(NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]))
        try png.write(to: Self.folder.appending(path: file))
    }
}

/// One component drawn on its own, from the fixtures (the pieces PennantDesign's previews show).
private struct ComponentSheet: View {
    let name: String
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            switch name {
            case "masthead":
                if let summary = model.frontOffice.summary {
                    MorningReportMasthead(summary: summary, record: model.catalogClub?.record, headline: Text(verbatim: DesignFixtures.served("Morning Report")))
                        .environment(\.morningReportDesign, .fixture)
                        .environment(\.mastheadTopInset, 52)
                }
            case "sections":
                ChipRow(label: Text(verbatim: DesignFixtures.served("Since the last export")), chips: DesignFixtures.chips)
                MagazineSection(kicker: Text(verbatim: DesignFixtures.served("The club")), title: Text(verbatim: DesignFixtures.served("How we win and lose")), trailing: DesignFixtures.served("Through July 13 · 89 games"))
                HStack(spacing: 8) {
                    ForEach(DesignFixtures.departmentCard.figures.indices, id: \.self) { i in
                        MetricTile(Figure(DesignFixtures.departmentCard.figures[i], id: "f\(i)"))
                    }
                }
                HStack(spacing: 14) {
                    Pill(DesignFixtures.served("Urgent"), tone: .bad); Pill(DesignFixtures.served("Needs attention"), tone: .caution); Pill(DesignFixtures.served("Noted"), tone: .neutral)
                    InlineBar(fraction: 0.62, text: "62%").frame(width: 200)
                    Ring(fraction: 39 / 40)
                    Sparkline(values: DesignFixtures.scoreboard.trend ?? [], label: DesignFixtures.served("Run differential over the last 20 games")).frame(width: 200)
                }
                HStack(spacing: 12) {
                    ControlPips(.seasons(4, text: DesignFixtures.served("Through 2044"))); ControlPips(.clock(DesignFixtures.served("Arbitration this winter"))); ControlPips(.unknown(DesignFixtures.served("Not known")))
                    RangeBar(range: DesignFixtures.positions[0].value, label: DesignFixtures.positions[0].valueText, scale: DesignFixtures.valueScale).frame(width: 120)
                    RangeBar(range: nil, label: DesignFixtures.served("Not valued yet"), scale: DesignFixtures.valueScale).frame(width: 120)
                }
            case "places":
                PlaceStrips(DesignFixtures.dimensions + [DesignFixtures.tooEarly], lines: DesignFixtures.placeLines, legend: DesignFixtures.placeLegend)
            case "roster":
                RosterDiagram(DesignFixtures.positions, scale: DesignFixtures.valueScale).frame(height: 540)
                RosterLegend(DesignFixtures.rosterLegend)
                HStack(alignment: .top, spacing: 24) {
                    Card { StaffColumn(title: Text(verbatim: DesignFixtures.served("Rotation")), pitchers: DesignFixtures.rotation, scale: DesignFixtures.valueScale) }
                    Card { StaffColumn(title: Text(verbatim: DesignFixtures.served("Bullpen")), pitchers: DesignFixtures.bullpen, scale: DesignFixtures.valueScale) }
                }
            case "rows":
                HStack(alignment: .top, spacing: 24) {
                    RowGroup {
                        DeskRow(DesignFixtures.deskItem, compact: true)
                        Divider()
                        DeskRow(DesignFixtures.deskItem)
                    }
                    VStack(spacing: 12) {
                        DepartmentTile(DesignFixtures.departmentCard, symbol: "baseball", open: {})
                        RowGroup {
                            DepartmentPlaceholderRow(DesignFixtures.notYetCard, symbol: "binoculars")
                            Divider()
                            DepartmentPlaceholderRow(DesignFixtures.notYetCard, symbol: "arrow.left.arrow.right")
                        }
                    }
                    .frame(width: 340)
                }
                RowGroup {
                    ForEach(DesignFixtures.wire) { item in
                        WireRow(item)
                        if item.id != DesignFixtures.wire.last?.id { Divider() }
                    }
                }
            case "basis":
                HStack(alignment: .top, spacing: 24) {
                    BasisPopover(claim: DesignFixtures.dimensions[3].claim)
                        .background(.background, in: .rect(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color(nsColor: .separatorColor)))
                    EvidenceView(claim: DesignFixtures.positions[0].claim).frame(width: 320, height: 560)
                        .background(.background.secondary)
                }
            default:
                CommandPalette(entries: DesignFixtures.paletteEntries, query: .constant("rep"), open: { _ in }, dismiss: {})
                    .padding(.top, 40)
            }
        }
        .padding(28)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(.background)
    }
}
