import AppKit
import SwiftUI

/// Closes the window it is drawn in, once asked and once that window is on screen (the N8 review, M7). The close is the
/// window's own (`NSWindow.close()`), applied to the window this view is in: never a scene-wide request that a window
/// still opening can drop, and never a retry on a timer. Asked before the view is in a window, or while its window is
/// not yet on screen, it closes the window the moment it is (the window's occlusion or key state changing says so).
struct WindowCloser: NSViewRepresentable {
    /// Whether the window should close.
    let close: Bool

    func makeNSView(context: Context) -> CloserView { CloserView() }

    func updateNSView(_ view: CloserView, context: Context) {
        if close { view.requestClose() }
    }

    final class CloserView: NSView {
        private(set) var asked = false
        private var observers: [NSObjectProtocol] = []

        func requestClose() {
            guard !asked else { return }
            asked = true
            observe()
            attempt()
        }

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            if asked { observe() }
            attempt()
        }

        /// Watches the window for the moment it is on screen (only once a close is asked).
        private func observe() {
            observers.forEach(NotificationCenter.default.removeObserver)
            observers = []
            guard let window else { return }
            for name in [NSWindow.didChangeOcclusionStateNotification, NSWindow.didBecomeKeyNotification, NSWindow.didUpdateNotification] {
                observers.append(NotificationCenter.default.addObserver(forName: name, object: window, queue: .main) { [weak self] _ in
                    MainActor.assumeIsolated { self?.attempt() }
                })
            }
        }

        private func attempt() {
            guard asked, let window, window.isVisible else { return }
            asked = false
            observers.forEach(NotificationCenter.default.removeObserver)
            observers = []
            window.close()
        }

        isolated deinit {
            observers.forEach(NotificationCenter.default.removeObserver)
        }
    }
}
