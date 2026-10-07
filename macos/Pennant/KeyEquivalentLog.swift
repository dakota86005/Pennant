#if DEBUG
import AppKit
import Carbon.HIToolbox

/// A Debug build launched by the UI tests (`-PennantTestLogKeys YES`) says in the app's log how each key equivalent
/// reached it (PR #58: on GitHub's macOS 26 runner ⌘K, ⌘4 and ⌘Q stopped reaching the app's menu after the player-note
/// test, while typing into a clicked field still worked). At launch: the modifier keys the system holds down and the
/// keyboard's input source. Then, for each key pressed with ⌘ or ⌃ (never plain typing, so nothing the GM writes is
/// logged): the key, every modifier with it, the key window, and the menu item that key belongs to, enabled or not.
@MainActor
enum KeyEquivalentLog {
    private static var monitor: Any?

    static func start(_ log: @escaping @Sendable (String) -> Void) {
        guard monitor == nil else { return }
        log("keys: at launch the system holds \(names(NSEvent.modifierFlags)); input source \(inputSource())")
        // Whether the app is active and which window is key, as each changes (the keys go to the key window)
        let center = NotificationCenter.default
        for name in [NSApplication.didBecomeActiveNotification, NSApplication.didResignActiveNotification, NSWindow.didBecomeKeyNotification, NSWindow.didResignKeyNotification] {
            center.addObserver(forName: name, object: nil, queue: .main) { note in
                let what = name.rawValue.replacingOccurrences(of: "Notification", with: "")
                nonisolated(unsafe) let object = note.object
                MainActor.assumeIsolated {
                    let window = (object as? NSWindow).map { String(($0.identifier?.rawValue ?? "unnamed").prefix(60)) } ?? "the app"
                    log("keys: \(what): \(window); active \(NSApp.isActive)")
                }
            }
        }
        monitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown]) { event in
            // Local monitors are called on the main thread, as the event is taken from the queue
            MainActor.assumeIsolated { describe(event, log) }
            return event
        }
    }

    private static func describe(_ event: NSEvent, _ log: (String) -> Void) {
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        guard !flags.isDisjoint(with: [.command, .control]) else { return }
        let key = event.charactersIgnoringModifiers ?? "?"
        let window = NSApp.keyWindow.map { String(($0.identifier?.rawValue ?? "unnamed").prefix(60)) } ?? "none"
        let item = menuItem(for: event).map { "\($0.title) (\($0.isEnabled ? "enabled" : "disabled"))" } ?? "none"
        log("keys: \(names(flags)) '\(key)' (key code \(event.keyCode), repeat \(event.isARepeat)); key window \(window); menu item \(item); input source \(inputSource())")
    }

    /// The modifier keys in a set of flags, by name.
    private static func names(_ flags: NSEvent.ModifierFlags) -> String {
        let all: [(NSEvent.ModifierFlags, String)] = [(.command, "⌘"), (.shift, "⇧"), (.option, "⌥"), (.control, "⌃"),
                                                     (.capsLock, "caps lock"), (.function, "fn"), (.numericPad, "keypad"), (.help, "help")]
        let held = all.filter { flags.contains($0.0) }.map(\.1)
        return held.isEmpty ? "no modifier" : held.joined(separator: " ")
    }

    /// The main menu's item whose key equivalent the event is (its key with its ⌘ ⌥ ⌃ ⇧; an upper-case key equivalent
    /// carries ⇧), searched through every menu.
    private static func menuItem(for event: NSEvent) -> NSMenuItem? {
        let key = (event.charactersIgnoringModifiers ?? "").lowercased()
        let mask: NSEvent.ModifierFlags = [.command, .option, .control, .shift]
        let flags = event.modifierFlags.intersection(mask)
        func search(_ menu: NSMenu) -> NSMenuItem? {
            for item in menu.items {
                var wanted = item.keyEquivalentModifierMask.intersection(mask)
                if item.keyEquivalent != item.keyEquivalent.lowercased() { wanted.insert(.shift) }
                if !item.keyEquivalent.isEmpty, item.keyEquivalent.lowercased() == key, wanted == flags {
                    return item
                }
                if let submenu = item.submenu, let found = search(submenu) { return found }
            }
            return nil
        }
        return NSApp.mainMenu.flatMap(search)
    }

    /// The keyboard's current input source (its identifier, such as com.apple.keylayout.US).
    private static func inputSource() -> String {
        guard let source = TISCopyCurrentKeyboardInputSource()?.takeRetainedValue(),
              let id = TISGetInputSourceProperty(source, kTISPropertyInputSourceID) else { return "unknown" }
        return Unmanaged<CFString>.fromOpaque(id).takeUnretainedValue() as String
    }
}
#endif
