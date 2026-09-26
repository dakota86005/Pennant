import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

/// The main window (SWIFTUI_REBUILD.md section 3.2): the sidebar from the registry with the club card, the current
/// view, the toolbar and the inspector. While the server is not ready the window shows its state instead. When the
/// server is up with no save chosen, the Setup window opens (once per launch; Club ▸ Import Export… opens it again).
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
            if model.isReady {
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
                .safeAreaInset(edge: .top, spacing: 0) { ImportRequestBanner() }
                .navigationTitle(Text(window.descriptor?.title ?? "Pennant"))
                .navigationSubtitle(ServedText.subtitle(dataStatus: model.dataStatus) ?? "")
                .toolbar { WindowToolbar(window: window) }
                .inspector(isPresented: $window.inspectorPresented) {
                    InspectorView()
                        .inspectorColumnWidth(min: 280, ideal: 320, max: 440)
                }
        }
        .searchable(text: $window.searchText, placement: .toolbar, prompt: Text("Search"))
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

/// The current view: the descriptor's view, or, with no save chosen, the way to Setup. Opaque content.
struct DetailView: View {
    @Environment(AppModel.self) private var model
    let window: MainWindowModel

    var body: some View {
        Group {
            if model.status?.configured == false {
                NoSaveView()
            } else if let descriptor = window.descriptor {
                descriptor.makeView()
            } else {
                PlaceholderView(title: "Pennant", symbol: "questionmark.square.dashed")
            }
        }
        .id(window.route)
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

/// The inspector column (SWIFTUI_REBUILD.md section 3.2): its evidence tab, empty until figures carry a basis (N5).
struct InspectorView: View {
    private enum Tab: Hashable { case evidence }
    @State private var tab = Tab.evidence

    var body: some View {
        VStack(spacing: 0) {
            Picker("Inspector", selection: $tab) {
                Text("Evidence").tag(Tab.evidence)
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .padding(8)
            ContentUnavailableView {
                Label("Evidence", systemImage: "doc.text.magnifyingglass")
            } description: {
                Text("Nothing selected")
            }
            .frame(maxHeight: .infinity)
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
        let appearance: NSAppearance? = switch theme {
        case "dark": NSAppearance(named: .darkAqua)
        case "light": NSAppearance(named: .aqua)
        default: nil
        }
        if NSApp.appearance != appearance { NSApp.appearance = appearance }
    }
}
