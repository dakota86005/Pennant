import FeatureCore
import PennantAPI
import PennantKit
import Player
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

        // Any club's report, one window per club (N7)
        WindowGroup("Club", for: ClubRef.self) { club in
            ClubWindowScene(club: club.wrappedValue)
                .environment(appDelegate.model)
                .environment(appDelegate.routing)
        }
        .defaultSize(width: 1180, height: 820)
        // A club window opens only for a club (never File ▸ New Club Window with none)
        .commandsRemoved()

        // A player's dossier, one window per player (N11): opened or brought forward from his name anywhere, restored at
        // relaunch (its value is his id)
        WindowGroup("Player", for: PlayerRef.self) { player in
            PlayerWindowScene(player: player.wrappedValue)
                .environment(appDelegate.model)
                .environment(appDelegate.routing)
        }
        .defaultSize(width: 920, height: 780)
        // A player window opens only for a player (never File ▸ New Player Window with none)
        .commandsRemoved()

        // Two to four players side by side (N11): drop players on it or choose Compare; restored with its players
        WindowGroup("Compare", for: ComparisonRef.self) { comparison in
            CompareWindowView(value: comparison)
                .environment(appDelegate.model)
                .environment(appDelegate.routing)
        }
        .defaultSize(width: 980, height: 760)
        .commandsRemoved()

        // The Staff room (N13): the people the club can ask, a conversation each, an answer streaming in
        Window("Staff Room", id: SceneID.staff) {
            StaffRoomScene()
                .environment(appDelegate.model)
                .environment(appDelegate.routing)
        }
        // Fits GitHub's runner's 1024 × 768 screen whole
        .defaultSize(width: 860, height: 600)
        // Window ▸ Staff Room (⇧⌘0) is the app's own command: the scene adds no second item (review N13B, L7)
        .commandsRemoved()

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
    /// The served notification when a new export is read, and the desk's count on the Dock icon (N7).
    private let outside: OutsideTheWindow
    private let quit: QuitCoordinator
    /// The app's own log (the quit's steps).
    private let appLog: @Sendable (String) -> Void
    private var terminationSignal: (any DispatchSourceSignal)?
    #if DEBUG
    private var watchdog: MainThreadWatchdog?
    #endif

    override init() {
        #if DEBUG
        // A UI test's first launch starts from fresh defaults (`-PennantTestFreshDefaults YES`): the window frames and
        // choices an earlier test left in the app's defaults never carry into the next (PR #58 on the runner: after the
        // player-window tests, ⌘K's palette no longer appeared in the tests that followed)
        // …and from no saved windows: the app's own saved state is removed before any window is restored, as the
        // test process (which may not reach it on the runner) cannot be relied on to (PR #58), wherever this macOS keeps
        // it (`FreshTestState`: on macOS 26 and later a daemon's container, where a player's window frame outlived its
        // test). Said in the app's log below.
        var savedStateLine: String?
        if UserDefaults.standard.bool(forKey: "PennantTestFreshDefaults"), let id = Bundle.main.bundleIdentifier {
            UserDefaults.standard.removePersistentDomain(forName: id)
            savedStateLine = FreshTestState.removeSavedWindows(bundleId: id)
        }
        #endif
        let model = AppModel(configuration: AppConfiguration.server(), keys: AppConfiguration.keyStore())
        let controller = model.serverController
        self.model = model
        outside = OutsideTheWindow(model: model)
        let log = controller.log
        appLog = { log.write($0, source: "app") }
        // Each time a main window's ⌘K palette comes up or goes away, with why (PR #58)
        MainWindowModel.paletteLog = { log.write($0, source: "app") }
        // Which process this is, for reading a quit that stops short against the processes running then (PR #58)
        log.write("launch: this is process \(ProcessInfo.processInfo.processIdentifier)", source: "app")
        #if DEBUG
        if let savedStateLine { log.write(savedStateLine, source: "app") }
        #endif
        quit = QuitCoordinator(
            prepare: { model.beginShutdown() },
            lastWords: { model.lastNoteSaves() },
            forceExit: { _exit(0) },
            log: { log.write($0, source: "app") },
            stop: { await controller.stop() }
        )
        super.init()
        // The server starts now, while the windows are built (the launch budget); `applicationDidFinishLaunching` follows it
        model.startEarly()
        model.noteLaunchStep("the app's model is made and the server started")
    }

    func applicationWillFinishLaunching(_ notification: Notification) {
        // The appearance the settings served last time, before the first window is built (the served one follows)
        AppAppearance.applyRemembered()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        model.noteLaunchStep("the app finished launching")
        terminationSignal = Self.quitOnTerminationSignal()
        #if DEBUG
        // A UI test's launch: each key equivalent and the modifier keys held, said in the app's log (PR #58)
        if UserDefaults.standard.bool(forKey: "PennantTestLogKeys") {
            KeyEquivalentLog.start(appLog)
            // …and the main thread's stack when it stops answering for 5 s (PR #60)
            let watchdog = MainThreadWatchdog(folder: model.serverController.log.url.deletingLastPathComponent(), log: appLog)
            watchdog.start()
            self.watchdog = watchdog
        }
        #endif
        outside.start()
        Task { await model.start() }
        #if DEBUG
        // A Debug build launched by a script for window screenshots comes to the front (`-PennantDebugActivate YES`)
        if UserDefaults.standard.bool(forKey: "PennantDebugActivate") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { NSApp.activate(ignoringOtherApps: true) }
        }
        // A Debug build writes its main window's own drawing to a PNG (`-PennantDebugCaptureWindow <path>`, after
        // `-PennantDebugCaptureAfter <seconds>`, 3 by default): the window only, drawn by the app itself, so no screen
        // is captured and no screen-recording permission is asked for. As with the snapshot tests, the system's glass
        // is not drawn this way (the toolbar and the Tonight control read plain).
        if let path = UserDefaults.standard.string(forKey: "PennantDebugCaptureWindow"), !path.isEmpty {
            let after = UserDefaults.standard.double(forKey: "PennantDebugCaptureAfter")
            DispatchQueue.main.asyncAfter(deadline: .now() + (after > 0 ? after : 3)) { Self.captureMainWindow(to: path) }
        }
        // The main window at a given size (`-PennantDebugWindowSize 1000x760`), for captures of a narrow window. Never
        // larger than its screen's visible frame, and wholly on it: `setFrame` does not constrain a window to its screen,
        // and on GitHub's runner (a 1024 × 768 screen) a 1280 × 820 window ran past the screen's edges, so its screenshot
        // held only the part on the screen and every pixel read from it was taken from the wrong place (PR #54)
        if let size = UserDefaults.standard.string(forKey: "PennantDebugWindowSize")?.split(separator: "x").compactMap({ Double($0) }), size.count == 2 {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                guard let window = NSApp.windows.filter({ $0.isVisible && $0.styleMask.contains(.titled) }).max(by: { $0.frame.width < $1.frame.width }) else { return }
                var frame = CGRect(origin: window.frame.origin, size: CGSize(width: size[0], height: size[1]))
                if let visible = (window.screen ?? NSScreen.main)?.visibleFrame {
                    frame.size = CGSize(width: min(frame.width, visible.width), height: min(frame.height, visible.height))
                    // AppKit's origin is the bottom-left corner: keep the top where it was, then move it wholly on the screen
                    frame.origin.y = window.frame.maxY - frame.height
                    frame.origin.x = min(max(frame.minX, visible.minX), visible.maxX - frame.width)
                    frame.origin.y = min(max(frame.minY, visible.minY), visible.maxY - frame.height)
                }
                window.setFrame(frame, display: true)
            }
        }
        // Settings opened by itself (`-PennantDebugOpenSettings YES`), for its captures
        if UserDefaults.standard.bool(forKey: "PennantDebugOpenSettings") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil) }
        }
        // Every visible window drawn by itself (`-PennantDebugCaptureWindows <folder>` after `-PennantDebugCaptureAfter`):
        // the Setup and Settings windows as well as the main one, named by title and appearance
        if let folder = UserDefaults.standard.string(forKey: "PennantDebugCaptureWindows"), !folder.isEmpty {
            let after = UserDefaults.standard.double(forKey: "PennantDebugCaptureAfter")
            DispatchQueue.main.asyncAfter(deadline: .now() + (after > 0 ? after : 3)) { Self.captureWindows(to: folder) }
        }
        // The app's own accessibility tree, as it vends it, written to a file (`-PennantDebugAXDump <path>`): each element's
        // role, label, identifier and frame, so a finding of the audit can be looked for without UI automation
        if let path = UserDefaults.standard.string(forKey: "PennantDebugAXDump"), !path.isEmpty {
            let after = UserDefaults.standard.double(forKey: "PennantDebugCaptureAfter")
            DispatchQueue.main.asyncAfter(deadline: .now() + (after > 0 ? after : 3) + 0.5) { Self.dumpAccessibility(to: path) }
        }
        #endif
    }

    #if DEBUG
    private static func captureWindows(to folder: String) {
        for window in NSApp.windows where window.isVisible && window.styleMask.contains(.titled) {
            guard let view = window.contentView?.superview ?? window.contentView,
                  let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { continue }
            view.cacheDisplay(in: view.bounds, to: rep)
            let dark = window.effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
            let name = (window.title.isEmpty ? "window" : window.title).replacingOccurrences(of: " ", with: "-").lowercased()
            let url = URL(fileURLWithPath: folder, isDirectory: true).appending(path: "\(name)-\(dark ? "dark" : "light").png")
            try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            if let png = rep.representation(using: .png, properties: [:]) { try? png.write(to: url) }
        }
    }

    private static func dumpAccessibility(to path: String) {
        var lines: [String] = []
        func walk(_ element: Any, depth: Int) {
            guard depth < 60, let object = element as? NSObject else { return }
            func read(_ key: String) -> Any? { object.responds(to: NSSelectorFromString(key)) ? object.value(forKey: key) : nil }
            let role = (read("accessibilityRole") as? String) ?? "-"
            let label = (read("accessibilityLabel") as? String) ?? ""
            let title = (read("accessibilityTitle") as? String) ?? ""
            let identifier = (read("accessibilityIdentifier") as? String) ?? ""
            let frame = (read("accessibilityFrame") as? NSRect) ?? .zero
            lines.append(String(repeating: "  ", count: depth) + "\(role) id='\(identifier)' label='\(label)' title='\(title)' \(NSStringFromRect(frame)) <\(type(of: object))>")
            for child in (read("accessibilityChildren") as? [Any]) ?? [] {
                // A child whose parent is not this element: what the audit calls a parent/child mismatch
                if let node = child as? NSObject, node.responds(to: NSSelectorFromString("accessibilityParent")),
                   let parent = node.value(forKey: "accessibilityParent") as AnyObject?, parent !== object {
                    lines.append(String(repeating: "  ", count: depth + 1) + "MISMATCH: parent is <\(type(of: parent))>")
                }
                walk(child, depth: depth + 1)
            }
        }
        for window in NSApp.windows where window.isVisible { walk(window, depth: 0) }
        // The AppKit views, with the role each vends: where a container the audit names comes from
        func views(_ view: NSView, depth: Int) {
            guard depth < 40 else { return }
            let frame = view.window.map { _ in view.convert(view.bounds, to: nil) } ?? view.frame
            let role = view.accessibilityRole()?.rawValue ?? "-"
            lines.append("V " + String(repeating: "  ", count: depth) + "\(type(of: view)) element=\(view.isAccessibilityElement()) role=\(role) label='\(view.accessibilityLabel() ?? "")' \(NSStringFromRect(frame))")
            for sub in view.subviews { views(sub, depth: depth + 1) }
        }
        for window in NSApp.windows where window.isVisible { if let root = window.contentView?.superview { views(root, depth: 0) } }
        try? lines.joined(separator: "\n").write(toFile: path, atomically: true, encoding: .utf8)
    }
    #endif

    #if DEBUG
    /// The main window's content, drawn by the app (`cacheDisplay`), as a PNG at `path`; the failure, if any, is on stderr.
    private static func captureMainWindow(to path: String) {
        guard let window = NSApp.windows.filter({ $0.isVisible && $0.styleMask.contains(.titled) }).max(by: { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height }),
              let view = window.contentView?.superview ?? window.contentView,
              let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds)
        else {
            FileHandle.standardError.write(Data("PennantDebugCaptureWindow: no main window to capture\n".utf8))
            return
        }
        view.cacheDisplay(in: view.bounds, to: rep)
        guard let png = rep.representation(using: .png, properties: [:]) else { return }
        do {
            try png.write(to: URL(fileURLWithPath: path))
            FileHandle.standardError.write(Data("PennantDebugCaptureWindow: wrote \(path)\n".utf8))
        } catch {
            FileHandle.standardError.write(Data("PennantDebugCaptureWindow: \(error)\n".utf8))
        }
    }
    #endif

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
    /// Said in the app's log, so a quit that stops short shows how far AppKit got (PR #58).
    func applicationWillTerminate(_ notification: Notification) {
        appLog("quit: AppKit is ending the app")
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        #if DEBUG
        // Where the keyboard's text input stood as the quit was asked (PR #58), for the UI tests' key log
        if UserDefaults.standard.bool(forKey: "PennantTestLogKeys") {
            let key = NSApp.keyWindow.map { String(($0.identifier?.rawValue ?? "unnamed").prefix(60)) } ?? "none"
            let responder = NSApp.keyWindow?.firstResponder.map { String(describing: type(of: $0)) } ?? "none"
            let editing = NSApp.windows.filter { $0.firstResponder is NSText }.count
            appLog("keys: quit asked; key window \(key), first responder \(responder); windows editing text \(editing); input context \(NSTextInputContext.current.map { _ in "active" } ?? "none")")
        }
        #endif
        return quit.shouldTerminate { ok in NSApp.reply(toApplicationShouldTerminate: ok) }
    }
}
