import AppKit
import SwiftUI

/// The app's open main windows, the one the GM used last first (PR #58). Find Anything (⌘K) works from every Pennant
/// window, as Open Quickly does from any of Xcode's: from a player's, a club's or Compare's window, or with no window
/// key at all, it brings the main window used last forward with its palette up. Only the menu command reads this; the
/// key main window is still reached through `FocusedValues.mainWindow`.
@MainActor
public final class MainWindows {
    public static let shared = MainWindows()

    private struct Entry {
        weak var model: MainWindowModel?
        weak var window: NSWindow?
    }

    /// The most recently key first.
    private var entries: [Entry] = []

    init() {}

    /// A main window drawn (or made key): it goes first.
    func use(_ model: MainWindowModel, in window: NSWindow) {
        entries.removeAll { $0.window == nil || $0.model == nil || $0.window === window }
        entries.insert(Entry(model: model, window: window), at: 0)
    }

    /// The main window used last that is still open, with its model; nil when every main window is closed.
    public func last() -> (model: MainWindowModel, window: NSWindow)? {
        entries.removeAll { $0.window == nil || $0.model == nil }
        for entry in entries {
            if let model = entry.model, let window = entry.window, window.isVisible || window.isMiniaturized {
                return (model, window)
            }
        }
        return nil
    }
}

/// Puts its main window in `MainWindows` when it is drawn and each time it becomes key. Draws nothing and is no
/// element for VoiceOver.
struct MainWindowTracker: NSViewRepresentable {
    let model: MainWindowModel

    func makeNSView(context: Context) -> Tracker { Tracker(model: model) }
    func updateNSView(_ view: Tracker, context: Context) { view.model = model }

    final class Tracker: NSView {
        weak var model: MainWindowModel?
        private weak var observed: NSWindow?

        init(model: MainWindowModel) {
            self.model = model
            super.init(frame: .zero)
        }

        @available(*, unavailable)
        required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            if let observed {
                NotificationCenter.default.removeObserver(self, name: NSWindow.didBecomeKeyNotification, object: observed)
            }
            observed = window
            guard let window else { return }
            NotificationCenter.default.addObserver(self, selector: #selector(becameKey), name: NSWindow.didBecomeKeyNotification, object: window)
            if let model { MainWindows.shared.use(model, in: window) }
        }

        @objc private func becameKey(_ notification: Notification) {
            guard let window, let model else { return }
            MainWindows.shared.use(model, in: window)
        }

        override func isAccessibilityElement() -> Bool { false }
    }
}
