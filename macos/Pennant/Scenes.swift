import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import FrontOffice
import Setup
import Shell
import SwiftUI

/// A main window: its state, kept across relaunches per window with `@SceneStorage` (the route and its history, the
/// inspector, the sidebar and its open departments; SWIFTUI_REBUILD.md section 3.1).
struct MainWindowScene: View {
    @Environment(\.openWindow) private var openWindow
    @SceneStorage("pennant.history") private var historyData = Data()
    @SceneStorage("pennant.inspector") private var inspectorPresented = false
    @SceneStorage("pennant.sidebarVisible") private var sidebarVisible = true
    @SceneStorage("pennant.expanded") private var expanded = ""
    @State private var window: MainWindowModel?

    var body: some View {
        Group {
            if let window {
                MainWindowView(window: window)
                    .onChange(of: window.history) { _, history in historyData = history.restorationData }
                    .onChange(of: window.inspectorPresented) { _, shown in inspectorPresented = shown }
                    .onChange(of: window.sidebarVisibleStorage) { _, shown in sidebarVisible = shown }
                    .onChange(of: window.expandedStorage) { _, ids in expanded = ids }
            } else {
                Color.clear
            }
        }
        .frame(minWidth: 900, minHeight: 560)
        .onAppear {
            guard window == nil else { return }
            let restored = MainWindowModel.restore(
                registry: AppRegistry.shared,
                history: historyData,
                inspectorPresented: inspectorPresented,
                sidebarVisible: sidebarVisible,
                expanded: expanded
            )
            #if DEBUG
            // A Debug build launched by a script for window screenshots can open with the ⌘K palette up
            // (`-PennantDebugPalette <query>`) or with a route (`-PennantDebugRoute department.view`, or
            // `department.view.key` with what the view has open: a decision's need)
            let defaults = UserDefaults.standard
            if let route = defaults.string(forKey: "PennantDebugRoute")?.split(separator: ".", maxSplits: 2).map(String.init), route.count >= 2 {
                restored.go(to: AppRoute(department: DeptID(rawValue: route[0]), view: route[1], key: route.count == 3 ? route[2] : nil))
            }
            if let query = defaults.string(forKey: "PennantDebugPalette") {
                restored.paletteShown = true
                restored.paletteQuery = query
            }
            // …or with a club's window open beside it (`-PennantDebugOpenClub <team id>`), for its captures
            if let club = defaults.string(forKey: "PennantDebugOpenClub").flatMap(Int.init) {
                DispatchQueue.main.asyncAfter(deadline: .now() + 1) { openWindow(value: ClubRef(id: club)) }
            }
            #endif
            window = restored
        }
    }
}

/// The Setup window: the steps, fed the served status (kept current by the event stream). On a first run it asks the
/// server to set up by itself (N6, Stage B2); it starts again at the save step whenever something asks for it
/// (Club ▸ Import Export…, Settings ▸ Choose Another Save…), and on a save the GM clicked to switch to ("played since").
/// Its model is the app's (`AppRouting.setup`), not the window's: closing the window while the club is owed keeps the
/// main window's report held, and opening it again comes back to the club question (N6 Stage B2 review, M4).
struct SetupScene: View {
    @Environment(AppModel.self) private var model
    @Environment(AppRouting.self) private var routing

    var body: some View {
        Group {
            if let setup = routing.setup, model.isReady {
                SetupView(model: setup, status: model.status)
            } else {
                ServerStateView()
            }
        }
        .frame(width: SetupView.size.width, height: SetupView.size.height)
        .onAppear {
            let setup = ensureSetup()
            // The window closed itself when the club was saved; opened again, it starts at the saves
            if setup.reopen() { Task { await setup.load() } }
        }
        // Start again at the saves (or come back to the club question while one is owed); taken when the window
        // appears too, since the request may come before the window opens
        .task(id: routing.setupRequest) {
            guard routing.takeSetupRequest() else { return }
            let setup = ensureSetup()
            if setup.clubQuestion != nil {
                await setup.resumeClubQuestion(status: model.status)
            } else if let owed = model.clubOwed {
                // The club the server says is still owed (across a relaunch): the question, in its words
                await setup.askOwedClub(owed)
            } else {
                setup.restart()
                await setup.load()
            }
        }
        // The main window's "Choose Your Club…": back to the club question
        .task(id: routing.clubRequest) {
            guard routing.takeClubRequest() else { return }
            let setup = ensureSetup()
            if setup.clubQuestion != nil {
                await setup.resumeClubQuestion(status: model.status)
            } else if let owed = model.clubOwed {
                await setup.askOwedClub(owed)
            }
        }
        // A switch the GM clicked in the main window: this save's import at once
        .task(id: routing.switchRequest) {
            guard let save = routing.takeSwitch() else { return }
            await ensureSetup().switchTo(save, status: model.status)
        }
    }

    /// The app's Setup model, made once: its client is the running server's, and a first run sets up by itself where
    /// the configuration lets it (`ServerConfiguration.findsSavesAutomatically`).
    private func ensureSetup() -> SetupModel {
        let model = model
        return routing.setupModel {
            SetupModel(
                client: { model.client },
                onClubSaved: { await model.reloadAll() },
                log: { model.logProblem($0) },
                setsUpAutomatically: model.configuration.findsSavesAutomatically
            )
        }
    }
}

/// A basis detached into its own floating panel: the claim's evidence view, with the departments' served names.
struct BasisPanelScene: View {
    @Environment(AppModel.self) private var model
    let claim: Components.Schemas.Claim?

    var body: some View {
        if let claim {
            EvidenceView(claim: claim)
                .environment(\.theme, model.theme)
                .environment(\.claimActions, ClaimActions(departmentName: { [catalog = model.catalog] id in
                    AppRegistry.shared.name(of: id, catalog: catalog)
                }))
                .frame(width: 380, height: 520)
        } else {
            Text("Nothing pinned").padding()
        }
    }
}

/// A club's report in its own window (SWIFTUI_REBUILD.md section 3.1, N7): any club, ours included, opened from its name
/// anywhere (a double-click, Return, "Open in New Window"), the wire, search or Following; restored at relaunch, since its
/// value is the club's id. A basis detaches into its own panel; there is no inspector to pin to here.
struct ClubWindowScene: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openWindow) private var openWindow
    let club: ClubRef?

    var body: some View {
        if let club {
            ClubReportView(teamId: club.id)
                .environment(\.claimActions, ClaimActions(
                    detach: { openWindow(value: $0) },
                    departmentName: { [catalog = model.catalog] id in AppRegistry.shared.name(of: id, catalog: catalog) }
                ))
        } else {
            Text("Nothing to show").padding()
        }
    }
}
