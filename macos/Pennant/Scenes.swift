import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import Setup
import Shell
import SwiftUI

/// A main window: its state, kept across relaunches per window with `@SceneStorage` (the route and its history, the
/// inspector, the sidebar and its open departments; SWIFTUI_REBUILD.md section 3.1).
struct MainWindowScene: View {
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
            // (`-PennantDebugPalette <query>`) or with a route (`-PennantDebugRoute department.view`)
            let defaults = UserDefaults.standard
            if let route = defaults.string(forKey: "PennantDebugRoute")?.split(separator: ".").map(String.init), route.count == 2 {
                restored.go(to: AppRoute(department: DeptID(rawValue: route[0]), view: route[1]))
            }
            if let query = defaults.string(forKey: "PennantDebugPalette") {
                restored.paletteShown = true
                restored.paletteQuery = query
            }
            #endif
            window = restored
        }
    }
}

/// The Setup window: the steps, fed the served status (kept current by the event stream), started again at the save
/// step whenever something asks for it (Club ▸ Import Export…, Settings ▸ Choose Save…).
struct SetupScene: View {
    @Environment(AppModel.self) private var model
    @Environment(AppRouting.self) private var routing
    @State private var setup: SetupModel?

    var body: some View {
        Group {
            if let setup, model.isReady {
                SetupView(model: setup, status: model.status)
            } else {
                ServerStateView()
            }
        }
        .frame(width: SetupView.size.width, height: SetupView.size.height)
        .onAppear {
            guard setup == nil else { return }
            let model = model
            setup = SetupModel(
                client: { model.client },
                onClubSaved: { await model.reloadAll() },
                log: { model.logProblem($0) }
            )
        }
        .onChange(of: routing.setupRequest) {
            setup?.restart()
            Task { await setup?.load() }
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
