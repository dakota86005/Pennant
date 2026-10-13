import AppKit
import FeatureCore
import PennantAPI
import PennantKit
import Shell
import SwiftUI

/// Where Shortcuts, Spotlight and the menu bar extra reach the app (N14, Stage A): the app's model for the served lists,
/// and the scenes' own `openWindow` for the windows they open. A request made before any scene has handed over its
/// `openWindow` (Pennant launched by the intent itself) waits for the first one.
@MainActor
final class IntentRouter {
    static let shared = IntentRouter()

    enum Request: Equatable {
        case player(Int)
        case club(Int)
        case morningReport
        case askStaff(Int)
    }

    private(set) var model: AppModel?
    private var routing: AppRouting?
    private var openWindow: OpenWindowAction?
    private var pending: [Request] = []

    /// The app's model and routing, set once at launch.
    func attach(model: AppModel, routing: AppRouting) {
        self.model = model
        self.routing = routing
    }

    /// A scene's `openWindow`, handed over when it appears; any request waiting for one is carried out.
    func capture(_ action: OpenWindowAction) {
        openWindow = action
        let waiting = pending
        pending = []
        for request in waiting { perform(request, with: action) }
    }

    /// Opens what was asked: at once when a scene has handed over its `openWindow`, else as soon as one does.
    func open(_ request: Request) {
        NSApp.activate()
        guard let openWindow else {
            pending.append(request)
            return
        }
        perform(request, with: openWindow)
    }

    private func perform(_ request: Request, with openWindow: OpenWindowAction) {
        switch request {
        case .player(let id):
            openWindow(value: PlayerRef(id: id))
        case .club(let id):
            openWindow(value: ClubRef(id: id))
        case .askStaff(let id):
            StaffRoomRouter.shared.ask(about: PlayerRef(id: id)) { openWindow(id: SceneID.staff) }
        case .morningReport:
            let route = AppRoute(department: DeptID(rawValue: "frontOffice"), view: "morningReport", key: nil)
            if let last = MainWindows.shared.last() {
                if last.window.isMiniaturized { last.window.deminiaturize(nil) }
                last.window.makeKeyAndOrderFront(nil)
                last.model.go(to: route)
            } else {
                routing?.requestRoute(route)
                openWindow(id: SceneID.main)
            }
        }
    }

    /// Club ▸ Refresh Data, once the server is up (an intent may have launched Pennant a moment ago).
    func refresh() async {
        guard let model else { return }
        await serverUp(model)
        guard model.isReady else { return }
        _ = await model.startImport()
    }

    // MARK: The entities' answers

    /// Waits for the server while it is still coming up (an intent may have launched Pennant a moment ago), at most 30 s;
    /// a server that failed, is locked or stopped is not waited for.
    private func serverUp(_ model: AppModel) async {
        for _ in 0..<300 where Self.isComing(model.serverState) {
            try? await Task.sleep(for: .milliseconds(100))
        }
    }

    private static func isComing(_ state: ServerState) -> Bool {
        switch state {
        case .idle, .starting, .restarting: true
        case .ready, .failed, .locked, .stopping, .stopped: false
        }
    }

    /// Answers from the served list once it is there (a Spotlight result opened with Pennant not running): the server
    /// first, then the list, read on the store key once the settings are in, at most 10 s more (review N14A, L6). With no
    /// save set or the club question open there is no list to wait for.
    private func listed() async -> IntegrationStore? {
        guard let model else { return nil }
        await serverUp(model)
        for _ in 0..<100 where model.isReady && Self.awaitsList(model) {
            try? await Task.sleep(for: .milliseconds(100))
        }
        return model.integration
    }

    private static func awaitsList(_ model: AppModel) -> Bool {
        let store = model.integration
        guard store.spotlight == nil, store.problem == nil, model.clubOwed == nil else { return false }
        return model.status?.configured != false
    }

    func resolve(_ ids: [String], kind: IntegrationStore.EntityKind) async -> [IntegrationStore.EntityLine] {
        guard let store = await listed() else { return [] }
        return store.entities(for: ids, kind: kind)
    }

    func search(_ text: String, kind: IntegrationStore.EntityKind) async -> [IntegrationStore.EntityLine] {
        guard let model else { return [] }
        return await model.integration.search(text, kind: kind, client: model.client)
    }

    func suggested(_ kind: IntegrationStore.EntityKind) async -> [IntegrationStore.EntityLine] {
        await listed()?.suggested(kind) ?? []
    }
}

/// Hands a scene's `openWindow` to the router when the scene appears. Draws nothing.
struct HandsOverWindowOpening: ViewModifier {
    @Environment(\.openWindow) private var openWindow

    func body(content: Content) -> some View {
        content.onAppear { IntentRouter.shared.capture(openWindow) }
    }
}

extension View {
    func handsOverWindowOpening() -> some View { modifier(HandsOverWindowOpening()) }
}
