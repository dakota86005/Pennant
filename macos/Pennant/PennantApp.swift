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
        // A Debug build writes its main window's own drawing to a PNG (`-PennantDebugCaptureWindow <path>`, after
        // `-PennantDebugCaptureAfter <seconds>`, 3 by default): the window only, drawn by the app itself, so no screen
        // is captured and no screen-recording permission is asked for. As with the snapshot tests, the system's glass
        // is not drawn this way (the toolbar and the Tonight control read plain).
        if let path = UserDefaults.standard.string(forKey: "PennantDebugCaptureWindow"), !path.isEmpty {
            let after = UserDefaults.standard.double(forKey: "PennantDebugCaptureAfter")
            DispatchQueue.main.asyncAfter(deadline: .now() + (after > 0 ? after : 3)) { Self.captureMainWindow(to: path) }
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
            for child in (read("accessibilityChildren") as? [Any]) ?? [] { walk(child, depth: depth + 1) }
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
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        quit.shouldTerminate { ok in NSApp.reply(toApplicationShouldTerminate: ok) }
    }
}
