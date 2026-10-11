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
        // The main window used last, for Find Anything from any other window (PR #58)
        .background(MainWindowTracker(model: window))
        .onAppear { AfterNextFrame.run { model.noteLaunchStep("the main window's first frame is drawn") } }
        .onChange(of: model.needsSetup, initial: true) { _, needsSetup in
            if routing.shouldOpenSetupAutomatically(needsSetup: needsSetup) {
                openWindow(id: SceneID.setup)
            }
        }
        .onChange(of: AppAppearance.served(model.settings), initial: true) { _, theme in
            AppAppearance.apply(theme)
        }
        // How many a comparison holds, as served, for Compare from any menu
        .onChange(of: model.phrases?.compare.most, initial: true) { _, most in CompareRouter.shared.most = most }
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
    @Environment(\.openWindow) private var openWindow
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
                // AppKit's containers above the content, named for VoiceOver (the audit)
                .background(WindowContainerNames())
                .navigationTitle(Text(window.descriptor?.title ?? "Pennant"))
                .navigationSubtitle(ServedText.subtitle(dataStatus: model.dataStatus) ?? "")
                // Kept as the window's title (VoiceOver, the Window menu) but not drawn in the toolbar: the system's
                // subtitle grey, and the title over the masthead, failed the contrast audit; the masthead carries the
                // view's title and the Data Status button its state (N6 Stage B2 review)
                .toolbar(removing: .title)
                .toolbar { WindowToolbar(window: window) }
                .inspector(isPresented: $window.inspectorPresented) {
                    InspectorView(window: window)
                        .inspectorColumnWidth(min: 280, ideal: 320, max: 440)
                }
        }
        // The toolbar's search field (N7): the server's results as suggestions, grouped as served, followed first; a
        // suggestion opens its view or its club's window, and Return opens the first
        // A view may scope it to itself (N12 Track B: Player Search's tokens), as Finder's search scopes to the folder
        .searchable(
            text: $window.searchText, tokens: Bindable(window.search).tokens, suggestedTokens: Bindable(window.search).suggested,
            placement: .toolbar, prompt: Text(window.search.scope ?? "Search")
        ) { token in
            Text(verbatim: token.text)
        }
        .searchSuggestions {
            if window.search.scope == nil { ToolbarSearchSuggestions(window: window, open: openSearchResult) }
        }
        .environment(\.windowSearch, window.search)
        .onSubmit(of: .search) {
            guard window.search.scope == nil else { return }
            let results = window.currentSearch?.groups.flatMap(\.results) ?? []
            if let first = results.first(where: { PaletteIndex.opens($0.open) }) { openSearchResult(first.open) }
        }
        .task(id: window.searchText) {
            let query = window.searchText.trimmingCharacters(in: .whitespaces)
            // A scoped field asks its view's question, not the league's
            guard !query.isEmpty, window.search.scope == nil else { return }
            try? await Task.sleep(for: .milliseconds(150))
            // The last answer stays, said to be updating, until this one is in; a failure is said, never left silent (L3)
            switch await model.search(query) {
            case .success(let served)?:
                guard !Task.isCancelled else { return }
                window.searchAnswer = (query, served)
                window.searchProblem = nil
            case .failure(let problem)?:
                guard !Task.isCancelled else { return }
                window.searchProblem = (query, problem)
            case nil:
                return
            }
        }
        // While the palette is up the window behind it is dimmed and out of reach, so VoiceOver reads only the palette
        .accessibilityHidden(window.paletteShown)
        // The ⌘K palette: a glass control over the whole window, keyboard first; a click outside closes it
        .overlay(alignment: .top) {
            if window.paletteShown { PaletteOverlay(window: window, openOutside: openOutside) }
        }
        // The club's theme for every coloured piece in the window: the club card, the mastheads, the floating control
        .environment(\.theme, model.theme)
        .modifier(DebugIncreasedContrast())
    }
}

extension ShellSplitView {
    /// A player's or a club's window for a served target, opened by this window (which outlives the palette) once the
    /// palette has closed, so the new window comes to the front rather than behind this one (N11).
    func openOutside(_ target: Components.Schemas.Target) {
        DispatchQueue.main.async {
            if let player = playerRef(opening: target) {
                openWindow(value: player)
            } else if let club = clubRef(opening: target) {
                openWindow(value: club)
            }
        }
    }

    /// A served result: its view in this window, a player's own window (N11), or a club's; the field clears.
    func openSearchResult(_ target: Components.Schemas.Target) {
        if let route = route(target) {
            window.go(to: route)
        } else if let player = playerRef(opening: target) {
            openWindow(value: player)
        } else if let club = clubRef(opening: target) {
            openWindow(value: club)
        }
        window.searchText = ""
    }
}

/// The toolbar search field's suggestions: the server's groups and results, in its order, each with its served line.
struct ToolbarSearchSuggestions: View {
    let window: MainWindowModel
    let open: (Components.Schemas.Target) -> Void

    var body: some View {
        if let problem = window.currentSearchProblem {
            ProblemLine(problem).accessibilityIdentifier("search.problem")
        } else if let answer = window.shownSearch {
            if window.searchUpdating {
                Label { Text("Updating") } icon: { ProgressView().controlSize(.small) }
                    .accessibilityIdentifier("search.updating")
            }
            ForEach(Array(answer.groups.enumerated()), id: \.offset) { _, group in
                Section {
                    ForEach(group.results, id: \.id) { result in
                        Button { open(result.open) } label: {
                            Label {
                                Text(verbatim: result.line.isEmpty ? result.title : "\(result.title) · \(result.line)")
                            } icon: {
                                Image(systemName: result.followed ? "star.fill" : PaletteIndex.symbol(result.kind.value1?.rawValue ?? result.kind.value2 ?? ""))
                            }
                        }
                        // A result that opens nothing here (a free agent, no club to open) is shown, not offered (L3)
                        .disabled(!PaletteIndex.opens(result.open))
                        .accessibilityIdentifier("search.result.\(result.id)")
                    }
                } header: {
                    Text(verbatim: group.title.display)
                }
            }
            if let empty = answer.empty {
                Text(verbatim: empty.display)
            }
        }
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
    /// Opens a player's or a club's window from the window behind the palette (the palette is gone by then).
    let openOutside: (Components.Schemas.Target) -> Void
    /// The server's answer for the query typed, and the query it answers.
    @State private var answer: (query: String, answer: Components.Schemas.SearchAnswer)?
    /// Why the search for a query failed, and the query.
    @State private var problem: (query: String, problem: RequestProblem)?

    var body: some View {
        let query = window.paletteQuery.trimmingCharacters(in: .whitespaces)
        // A failure for the query typed is said in place of results (L3); otherwise the last answer stays, said to be
        // updating, until the one for the query typed is in
        let failed = problem.flatMap { $0.query == query && !query.isEmpty ? $0.problem : nil }
        let search = failed == nil && !query.isEmpty ? answer?.answer : nil
        let updating = search != nil && answer?.query != query
        let index = PaletteIndex(registry: window.registry, catalog: model.catalog, can: .of(model, window: window),
                                 inspectorShown: window.inspectorPresented, search: search, searchFailed: failed != nil)
        ZStack(alignment: .top) {
            Color.black.opacity(0.18).ignoresSafeArea()
                .onTapGesture { window.hidePalette("a click outside it") }
                .accessibilityHidden(true)
            CommandPalette(entries: index.entries, served: index.served, emptyLine: index.emptyLine, problem: failed?.title,
                           updating: updating, query: $window.paletteQuery, open: { entry in
                window.hidePalette("a result chosen")
                switch index.action(for: entry) {
                case .served(let target): open(target)
                case .route(let route): window.go(to: route)
                case .command(.inspector): window.toggleInspector()
                case .command(.refreshData): Task { await model.startImport() }
                case .command(.importExport): routing.requestSetup(); openWindow(id: SceneID.setup)
                case .command(.dataStatus): routing.showDataStatus(); openSettings()
                case .command(.back): window.goBack()
                case .command(.forward): window.goForward()
                case nil: break
                }
            }, dismiss: { window.hidePalette("Escape") })
            .padding(.top, 120)
        }
        // Asked as the GM types, a moment after the last key, and cancelled by the next one
        .task(id: query) {
            guard !query.isEmpty else { return }
            try? await Task.sleep(for: .milliseconds(120))
            switch await model.search(query) {
            case .success(let served)?:
                guard !Task.isCancelled else { return }
                answer = (query, served)
                problem = nil
            case .failure(let failure)?:
                guard !Task.isCancelled else { return }
                problem = (query, failure)
            case nil:
                return
            }
        }
    }

    /// A served target: a view in this window, or a player's own window (N11) or a club's, opened by the window behind.
    private func open(_ target: Components.Schemas.Target) {
        if let route = route(target) {
            window.go(to: route)
        } else {
            openOutside(target)
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

/// Back and Forward, Ask Staff (the Staff room, N13) and the inspector toggle. Icons are monochrome.
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
            AskStaffButton()
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

/// Ask Staff: opens the Staff room (N13), or brings it forward.
struct AskStaffButton: View {
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        Button("Ask Staff", systemImage: "bubble.left.and.text.bubble.right") { openWindow(id: SceneID.staff) }
            .help(Text("Ask Staff"))
            .accessibilityIdentifier("toolbar.askStaff")
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
    @Environment(AppRouting.self) private var routing
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
            if !model.isReady && !Self.drawsWhileStarting(window.route) {
                // The shell is up before the server: the view waits for it, and no report is drawn before its save and
                // club are known
                StartingView()
            } else if model.status?.configured == false {
                NoSaveView()
            } else if routing.awaitingClub || model.clubOwed != nil {
                // Its own identifier: the route's would name a view that is not drawn. The club the server says is still
                // owed holds it too, across a relaunch (N7)
                ClubPendingView()
            } else {
                Group {
                    if let descriptor = window.descriptor {
                        descriptor.makeView()
                    } else {
                        PlaceholderView(title: "Pennant", symbol: "questionmark.square.dashed")
                    }
                }
                // A container named for the route: the view's own elements keep their identifiers (an identifier on a
                // view that is not an element would be put on every element inside it)
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("detail.\(window.route.department.rawValue).\(window.route.view)")
            }
        }
        .id(window.route)
        .environment(\.routeOpener, window)
        .environment(\.currentRoute, window.route)
        .environment(\.claimActions, claimActions)
        // The column reports no minimum of the view's own: a minimum that moved with the content looped AppKit's
        // constraint passes on a narrow window with the inspector open until it aborted (the N8 crash, `NoContentMinimum`)
        .noContentMinimum()
        .background(.background)
    }
}

extension DetailView {
    /// The Morning Report is drawn while the server starts (it says "Starting…" itself, with the club card of the report
    /// kept last drawn at once; the report itself only once its save and club are confirmed), so the window's toolbar and
    /// content are the same from the first frame to the report (N6 polish: the relaunch's layout jump). Every other view
    /// waits in `StartingView`.
    nonisolated static func drawsWhileStarting(_ route: AppRoute) -> Bool {
        route.department.rawValue == "frontOffice" && route.view == "morningReport"
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

/// The club is owed for the save chosen in Setup: no report is drawn until the GM saves one there. It says why in the
/// server's words ("You manage 2 clubs in this save, …"), and its button brings the Setup window back to the question.
struct ClubPendingView: View {
    @Environment(AppRouting.self) private var routing
    @Environment(AppModel.self) private var model
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        ContentUnavailableView {
            Label("Pick the Club", systemImage: "person.crop.circle.badge.questionmark")
        } description: {
            if let text = routing.owedClubText ?? model.clubOwed?.text {
                Text(verbatim: text)
                    .accessibilityIdentifier("detail.clubPending.why")
            }
        } actions: {
            Button("Choose Your Club…") {
                routing.requestClubQuestion()
                openWindow(id: SceneID.setup)
            }
            .accessibilityIdentifier("detail.pickClub")
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("detail.clubPending")
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
                    // Content, so opaque: the column's glass shows the masthead's colour extended beneath it, and the
                    // evidence's text must read on the page, not on that (the audit, N6 Stage B2 review)
                    .background(.background)
            } else {
                // Drawn by hand rather than with ContentUnavailableView, whose dimmed text failed the contrast audit, on
                // the fixed, checked page colour: on the column's glass (the masthead's colour beneath it) the label
                // colour read dark on dark in a 900-point window (the N8 review)
                VStack(spacing: 10) {
                    Image(systemName: "doc.text.magnifyingglass").font(.system(size: 32)).foregroundStyle(.readableSecondary).accessibilityHidden(true)
                    Text("Nothing pinned").font(.body.weight(.semibold))
                    Text("Pin a figure's basis from its popover").font(.callout)
                }
                // The label colour and the page as AppKit resolves both for the column's own appearance: a checked pair
                // (`ThemeTests`), where SwiftUI's `.primary` followed a scheme the column's glass did not
                .foregroundStyle(Color(nsColor: .labelColor))
                .multilineTextAlignment(.center)
                .padding()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color.readablePage)
                .accessibilityIdentifier("inspector.empty")
            }
        }
        .controlSize(.small)
        // No minimum of the pinned evidence's own pushed on the column (`NoContentMinimum`, the N8 crash)
        .noContentMinimum()
        // AppKit's container for the column, named for VoiceOver (the audit)
        .background(InspectorColumnName())
        // A container, so its identifier does not replace the pinned evidence's own
        .accessibilityElement(children: .contain)
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

    /// Where the served appearance is remembered, in the app's own preferences (never the data folder), so the next
    /// launch draws its first frame in it: a window drawn in the system's appearance and redrawn in the served one when
    /// the settings arrive cost about 80 ms of the launch (N6 polish).
    static let rememberedKey = "PennantServedAppearance"

    /// The appearance the settings served last time, applied before the first window is built; the served settings
    /// correct it when they arrive.
    @MainActor public static func applyRemembered() {
        guard let theme = UserDefaults.standard.string(forKey: rememberedKey) else { return }
        apply(theme, remember: false)
    }

    public static func apply(_ theme: String?) {
        apply(theme, remember: true)
    }

    static func apply(_ theme: String?, remember: Bool) {
        // Nil: the settings are not served yet; the appearance applied at launch stays until they are
        guard let theme else {
            #if DEBUG
            if let override = debugAppearance, NSApp.appearance != override { NSApp.appearance = override }
            #endif
            return
        }
        if remember { UserDefaults.standard.set(theme, forKey: rememberedKey) }
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
