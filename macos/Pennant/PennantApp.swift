import FeatureCore
import PennantAPI
import PennantKit
import Shell
import SwiftUI

/// Pennant for Mac (D-055): the scenes (SWIFTUI_REBUILD.md section 3.1). Main windows (several allowed), the Setup
/// window (opened by itself when the server has no save, and from Club ▸ Import Export…), and Settings. The menu bar's
/// commands are `PennantCommands`.
@main
struct PennantApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup(id: SceneID.main) {
            MainWindowScene()
                .environment(appDelegate.model)
                .environment(appDelegate.routing)
        }
        .defaultSize(width: 1280, height: 800)
        .commands {
            PennantCommands(model: appDelegate.model, routing: appDelegate.routing, registry: AppRegistry.shared)
        }

        // A basis detached from its popover (SWIFTUI_REBUILD.md section 3.3): a floating panel the GM keeps open while
        // working, one per claim
        WindowGroup("Basis", for: Components.Schemas.Claim.self) { claim in
            BasisPanelScene(claim: claim.wrappedValue)
                .environment(appDelegate.model)
        }
        .windowResizability(.contentSize)
        .windowLevel(.floating)
        .restorationBehavior(.disabled)
        .defaultSize(width: 380, height: 520)

        Window("Set Up Pennant", id: SceneID.setup) {
            SetupScene()
                .environment(appDelegate.model)
                .environment(appDelegate.routing)
        }
        .windowResizability(.contentSize)
        .defaultPosition(.center)
        .restorationBehavior(.disabled)

        Settings {
            SettingsView()
                .environment(appDelegate.model)
                .environment(appDelegate.routing)
        }
    }
}

/// Owns the app's model, starts the server when the app launches, and stops it cleanly before the app quits.
final class AppDelegate: NSObject, NSApplicationDelegate {
    let model: AppModel
    /// What the windows ask of each other (the Setup step, the Settings tab).
    let routing = AppRouting()
    private let quit: QuitCoordinator
    private var terminationSignal: (any DispatchSourceSignal)?

    override init() {
        let model = AppModel(configuration: AppConfiguration.server())
        let controller = model.serverController
        self.model = model
        quit = QuitCoordinator(prepare: { model.beginShutdown() }, stop: { await controller.stop() })
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        terminationSignal = Self.quitOnTerminationSignal()
        Task { await model.start() }
        #if DEBUG
        // A Debug build launched by a script for window screenshots comes to the front (`-PennantDebugActivate YES`)
        if UserDefaults.standard.bool(forKey: "PennantDebugActivate") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { NSApp.activate(ignoringOtherApps: true) }
        }
        #endif
    }

    /// SIGTERM (a `kill`, a script) quits like ⌘Q, so the server is stopped cleanly rather than orphaned. The handler
    /// runs on a background queue and asks through `QuitCoordinator.requestQuit()`, the one way to quit.
    nonisolated private static func quitOnTerminationSignal() -> any DispatchSourceSignal {
        signal(SIGTERM, SIG_IGN)
        let source = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .global(qos: .userInitiated))
        source.setEventHandler { QuitCoordinator.requestQuit() }
        source.resume()
        return source
    }

    /// Quit waits for the server (SIGTERM, up to 5 seconds, then SIGKILL; SWIFTUI_REBUILD.md section 5.3), without
    /// depending on the main queue (`QuitCoordinator`).
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        quit.shouldTerminate { ok in NSApp.reply(toApplicationShouldTerminate: ok) }
    }
}
