import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

/// The main window (SWIFTUI_REBUILD.md section 3.2): the sidebar from the registry with the club card, the current
/// view, the toolbar and the inspector. The shell is built at once, while the server starts (N6, Stage B2: the launch
/// budget), with "Starting…" where the view will be; a server that failed, is locked out or is stopping shows its state
/// instead. When the server is up with no save chosen, the Setup window opens (once per launch; Club ▸ Import Export…
/// opens it again).
public struct MainWindowView: View {
    @Environment(AppModel.self) private var model
    @Environment(AppRouting.self) private var routing
    @Environment(\.openWindow) private var openWindow
    private let window: MainWindowModel

    public init(window: MainWindowModel) {
        self.window = window
    }

    public var body: some View {
        Group {
            if Self.showsShell(model.serverState) {
                ShellSplitView(window: window)
            } else {
                ServerStateView()
            }
        }
        .focusedSceneValue(\.mainWindow, model.isReady ? window : nil)
        .onChange(of: model.needsSetup, initial: true) { _, needsSetup in
            if routing.shouldOpenSetupAutomatically(needsSetup: needsSetup) {
                openWindow(id: SceneID.setup)
            }
        }
        .onChange(of: AppAppearance.served(model.settings), initial: true) { _, theme in
            AppAppearance.apply(theme)
        }
    }
}

extension MainWindowView {
    /// Whether the window draws its shell: while the server starts (so the window's shell is built before it is ready,
    /// and the first report waits only on the server) and once it is up. A failure, a locked folder, a restart after a
    /// crash and a stop show the server's state instead.
    nonisolated static func showsShell(_ state: ServerState) -> Bool {
        switch state {
        case .idle, .starting, .ready: true
        case .restarting, .failed, .locked, .stopping, .stopped: false
        }
    }
}

/// The split view: sidebar, the view, the inspector, and the toolbar.
struct ShellSplitView: View {
    @Environment(AppModel.self) private var model
    @Bindable var window: MainWindowModel

    var body: some View {
        NavigationSplitView(columnVisibility: $window.sidebarVisibility) {
            SidebarView(window: window)
                .navigationSplitViewColumnWidth(
                    min: SidebarView.minimumWidth, ideal: SidebarView.idealWidth, max: SidebarView.maximumWidth
                )
        } detail: {
            DetailView(window: window)
                // The quiet notices: played since, a rating-history question, an import that did not start
                .safeAreaInset(edge: .top, spacing: 0) { NoticeStack() }
                .navigationTitle(Text(window.descriptor?.title ?? "Pennant"))
                .navigationSubtitle(ServedText.subtitle(dataStatus: model.dataStatus) ?? "")
                .toolbar { WindowToolbar(window: window) }
                .inspector(isPresented: $window.inspectorPresented) {
                    InspectorView(window: window)
                        .inspectorColumnWidth(min: 280, ideal: 320, max: 440)
                }
        }
        .searchable(text: $window.searchText, placement: .toolbar, prompt: Text("Search"))
        // The ⌘K palette: a glass control over the whole window, keyboard first; a click outside closes it
        .overlay(alignment: .top) {
            if window.paletteShown { PaletteOverlay(window: window) }
        }
        // The club's theme for every coloured piece in the window: the club card, the mastheads, the floating control
        .environment(\.theme, model.theme)
        .modifier(DebugIncreasedContrast())
    }
}

/// The ⌘K palette over the window (SWIFTUI_REBUILD.md section 3.6): the registry's views and the window's commands,
/// from `PaletteIndex`; opening an entry goes there or runs the command, and closes the palette.
struct PaletteOverlay: View {
    @Environment(AppModel.self) private var model
    @Environment(AppRouting.self) private var routing
    @Environment(\.openWindow) private var openWindow
    @Environment(\.openSettings) private var openSettings
    @Bindable var window: MainWindowModel

    var body: some View {
        let index = PaletteIndex(registry: window.registry, catalog: model.catalog, can: .of(model, window: window), inspectorShown: window.inspectorPresented)
        ZStack(alignment: .top) {
            Color.black.opacity(0.18).ignoresSafeArea()
                .onTapGesture { window.paletteShown = false }
                .accessibilityHidden(true)
            CommandPalette(entries: index.entries, query: $window.paletteQuery, open: { entry in
                window.paletteShown = false
                switch index.action(for: entry) {
                case .route(let route): window.go(to: route)
                case .command(.inspector): window.toggleInspector()
                case .command(.refreshData): Task { await model.startImport() }
                case .command(.importExport): routing.requestSetup(); openWindow(id: SceneID.setup)
                case .command(.dataStatus): routing.showDataStatus(); openSettings()
                case .command(.back): window.goBack()
                case .command(.forward): window.goForward()
                case nil: break
                }
            }, dismiss: { window.paletteShown = false })
            .padding(.top, 120)
        }
    }
}

/// A Debug build's UI tests and screenshots can draw the window as Increase Contrast or Reduce Transparency do without
/// changing the Mac's settings: `-PennantDebugAppearance increasedContrastLight` or `increasedContrastDark` (the app's
/// own pieces read the increased contrast, the theme's 7:1 colours and the borders, and AppKit the high-contrast
/// appearance, `AppAppearance.debugAppearance`), and `-PennantDebugReduceTransparency YES` (the app's own pieces draw
/// opaque; the system's glass follows only the Mac's setting). A release build draws what the Mac says.
struct DebugIncreasedContrast: ViewModifier {
    @Environment(\.forcesIncreasedContrast) private var increasedContrast
    @Environment(\.forcesReduceTransparency) private var reduceTransparency

    func body(content: Content) -> some View {
        #if DEBUG
        // A look the snapshot tests set above the window is kept; the launch arguments add to it
        content
            .environment(\.forcesIncreasedContrast, increasedContrast || AppAppearance.debugAppearance != nil)
            .environment(\.forcesReduceTransparency, reduceTransparency || UserDefaults.standard.bool(forKey: "PennantDebugReduceTransparency"))
        #else
        content
        #endif
    }
}

/// Back and Forward, Ask Staff (a stub until the staff room, N13) and the inspector toggle. Icons are monochrome.
struct WindowToolbar: ToolbarContent {
    let window: MainWindowModel

    var body: some ToolbarContent {
        ToolbarItemGroup(placement: .navigation) {
            Button("Back", systemImage: "chevron.backward") { window.goBack() }
                .disabled(!window.canGoBack)
                .help(Text("Back"))
                .accessibilityIdentifier("toolbar.back")
            Button("Forward", systemImage: "chevron.forward") { window.goForward() }
                .disabled(!window.canGoForward)
                .help(Text("Forward"))
                .accessibilityIdentifier("toolbar.forward")
        }
        ToolbarItem(placement: .primaryAction) {
            DataStatusButton()
        }
        ToolbarItem(placement: .primaryAction) {
            Button("Ask Staff", systemImage: "bubble.left.and.text.bubble.right") {}
                .disabled(true)
                .help(Text("Ask Staff arrives in a later build"))
                .accessibilityIdentifier("toolbar.askStaff")
        }
        ToolbarItem(placement: .primaryAction) {
            Button {
                window.toggleInspector()
            } label: {
                Label(window.inspectorPresented ? "Hide Inspector" : "Show Inspector", systemImage: "sidebar.trailing")
            }
            .help(window.inspectorPresented ? Text("Hide Inspector") : Text("Show Inspector"))
            .accessibilityIdentifier("toolbar.inspector")
        }
    }
}

/// How current the data is, at a glance: the served headline's tone as a symbol, the full served subtitle in the help
/// tag (the title bar shows the short one), and a click opens Settings at the data status.
struct DataStatusButton: View {
    @Environment(AppModel.self) private var model
    @Environment(AppRouting.self) private var routing
    @Environment(\.openSettings) private var openSettings

    var body: some View {
        Button {
            routing.showDataStatus()
            openSettings()
        } label: {
            Label {
                Text("Data Status")
            } icon: {
                ToneSymbol(tone: model.dataStatus?.headline.tone)
            }
        }
        .help(model.dataStatus.map { Text(verbatim: $0.subtitleHint) } ?? Text("Data Status"))
        .disabled(model.dataStatus == nil)
        .accessibilityIdentifier("toolbar.dataStatus")
    }
}

/// The current view: the descriptor's view, or, with no save chosen, the way to Setup. Opaque content. It gives the
/// views what a basis popover can do in this window (SWIFTUI_REBUILD.md section 3.3): pin to the inspector, detach
/// into a floating panel (the app's basis window), open a served target, and the departments' served names.
struct DetailView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openWindow) private var openWindow
    let window: MainWindowModel

    private var claimActions: ClaimActions {
        let window = window
        let catalog = model.catalog
        return ClaimActions(
            pin: { window.pin($0) },
            detach: { openWindow(value: $0) },
            canOpen: { target in route(target).map { window.canOpen($0) } ?? false },
            open: { target in if let route = route(target) { window.open(route) } },
            departmentName: { id in window.registry.name(of: id, catalog: catalog) }
        )
    }

    var body: some View {
        Group {
            if !model.isReady {
                // The shell is up before the server: the view waits for it, and no report is drawn before its save and
                // club are known
                StartingView()
            } else if model.status?.configured == false {
                NoSaveView()
            } else if let descriptor = window.descriptor {
                descriptor.makeView()
            } else {
                PlaceholderView(title: "Pennant", symbol: "questionmark.square.dashed")
            }
        }
        .id(window.route)
        .environment(\.routeOpener, window)
        .environment(\.claimActions, claimActions)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.background)
        .accessibilityIdentifier("detail.\(window.route.department.rawValue).\(window.route.view)")
    }
}

/// Why the import the GM asked for (Club ▸ Refresh Data, Import Now) did not start: the server's sentence, or the kind
/// of failure, until it is dismissed or an import starts.
struct ImportRequestBanner: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        if let problem = model.importRequestProblem {
            HStack {
                ProblemLine(problem)
                Spacer()
                Button("Dismiss") { model.dismissImportRequestProblem() }
                    .controlSize(.small)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .background(.bar)
            .accessibilityIdentifier("banner.importProblem")
        }
    }
}

/// No save chosen yet: a structural empty state with the way to Setup.
struct NoSaveView: View {
    @Environment(AppRouting.self) private var routing
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        ContentUnavailableView {
            Label("No save chosen", systemImage: "externaldrive.badge.questionmark")
        } actions: {
            Button("Set Up Pennant…") {
                routing.requestSetup()
                openWindow(id: SceneID.setup)
            }
            .accessibilityIdentifier("detail.setUp")
        }
    }
}

/// The inspector column (SWIFTUI_REBUILD.md sections 3.2 and 3.3): its evidence tab shows the claim pinned from a
/// basis popover, in full; nothing is selected until one is pinned.
struct InspectorView: View {
    private enum Tab: Hashable { case evidence }
    @State private var tab = Tab.evidence
    @Environment(AppModel.self) private var model
    let window: MainWindowModel

    var body: some View {
        VStack(spacing: 0) {
            Picker("Inspector", selection: $tab) {
                Text("Evidence").tag(Tab.evidence)
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .padding(8)
            if let claim = window.pinnedClaim {
                EvidenceView(claim: claim)
                    .environment(\.claimActions, ClaimActions(departmentName: { [registry = window.registry, catalog = model.catalog] id in
                        registry.name(of: id, catalog: catalog)
                    }))
                    .frame(maxHeight: .infinity)
            } else {
                // Drawn by hand rather than with ContentUnavailableView, whose dimmed text failed the contrast audit
                VStack(spacing: 10) {
                    Image(systemName: "doc.text.magnifyingglass").font(.system(size: 32)).foregroundStyle(.secondary).accessibilityHidden(true)
                    Text("Nothing pinned").font(.body.weight(.semibold))
                    Text("Pin a figure's basis from its popover").font(.callout)
                }
                .foregroundStyle(.primary)
                .multilineTextAlignment(.center)
                .padding()
                .frame(maxHeight: .infinity)
            }
        }
        .controlSize(.small)
        .accessibilityIdentifier("inspector")
    }
}

/// The app's appearance, from the served preference (`theme` in the settings): System, Light or Dark, for every
/// window. A value this build does not know follows the system.
public enum AppAppearance {
    public static func served(_ settings: Components.Schemas.SettingsResponse?) -> String? {
        guard let theme = settings?.settings.theme else { return nil }
        return theme.value1?.rawValue ?? theme.value2
    }

    public static func apply(_ theme: String?) {
        var appearance: NSAppearance? = switch theme {
        case "dark": NSAppearance(named: .darkAqua)
        case "light": NSAppearance(named: .aqua)
        default: nil
        }
        #if DEBUG
        if let override = debugAppearance { appearance = override }
        #endif
        if NSApp.appearance != appearance { NSApp.appearance = appearance }
    }

    #if DEBUG
    /// A Debug build's UI tests draw the app in the system's high-contrast appearance, which is what Increase Contrast
    /// gives (AppKit and SwiftUI both follow it), without changing the Mac's own accessibility setting: the launch
    /// argument `-PennantDebugAppearance increasedContrastLight` or `increasedContrastDark`. Never in a release build.
    static var debugAppearance: NSAppearance? {
        switch UserDefaults.standard.string(forKey: "PennantDebugAppearance") {
        case "increasedContrastLight": NSAppearance(named: .accessibilityHighContrastAqua)
        case "increasedContrastDark": NSAppearance(named: .accessibilityHighContrastDarkAqua)
        default: nil
        }
    }
    #endif
}
