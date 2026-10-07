import FeatureCore
import PennantAPI
import PennantKit
import Shell
import SwiftUI

/// The menu bar's commands (SWIFTUI_REBUILD.md section 3.6). Go and View act on the key main window
/// (`FocusedValues.mainWindow`), except Find Anything, which works from every window; Club acts on the app. What can act comes from `CommandAvailability`.
struct PennantCommands: Commands {
    let model: AppModel
    let routing: AppRouting
    let registry: DepartmentRegistry
    @FocusedValue(\.mainWindow) private var window
    /// The desk item the keyboard focus is in (its context menu's actions, by key).
    @FocusedValue(\.deskItem) private var deskItem
    /// The club or player name the keyboard focus is on (Follow or Unfollow, by key).
    @FocusedValue(\.followable) private var followable
    /// The player whose name, row or window has the focus (N11: the Player menu acts on him).
    @FocusedValue(\.player) private var player
    @Environment(\.openWindow) private var openWindow
    @Environment(\.openSettings) private var openSettings

    private var can: CommandAvailability { .of(model, window: window) }

    /// Find Anything (⌘K) from any Pennant window (PR #58), as Open Quickly works from any of Xcode's: the key main
    /// window's palette; else, from a player's, a club's or Compare's window or with no window key, the main window used
    /// last comes forward with its palette up; with every main window closed, a new one opens with it. Which way it went
    /// is said in the app's log.
    private func findAnything() {
        if let window {
            window.togglePalette()
            return
        }
        let log = model.serverController.log
        let key = NSApp.keyWindow?.identifier?.rawValue ?? "none"
        if let last = MainWindows.shared.last() {
            log.write("find anything: no main window was key (key window: \(key)); the main window used last came forward with its palette", source: "app")
            if last.window.isMiniaturized { last.window.deminiaturize(nil) }
            last.window.makeKeyAndOrderFront(nil)
            NSApp.activate()
            last.model.showPalette()
        } else {
            log.write("find anything: no main window was open (key window: \(key)); a new one opens with its palette", source: "app")
            routing.requestPalette()
            openWindow(id: SceneID.main)
        }
    }

    var body: some Commands {
        SidebarCommands()

        CommandGroup(after: .sidebar) {
            Button(window?.inspectorPresented == true ? "Hide Inspector" : "Show Inspector") {
                window?.toggleInspector()
            }
            .keyboardShortcut("i", modifiers: [.command, .option])
            .disabled(!can.inspector)
            Button("Find Anything…") {
                findAnything()
            }
            .keyboardShortcut("k", modifiers: .command)
            .disabled(!can.findAnything)
        }

        CommandMenu("Go") {
            ForEach(registry.shortcutDepartments, id: \.department.id) { entry in
                Button {
                    window?.go(toShortcut: entry.number)
                } label: {
                    Text(entry.department.title)
                }
                .keyboardShortcut(KeyEquivalent(Character(String(entry.number))), modifiers: .command)
                .disabled(!can.goToDepartment)
            }
            Divider()
            Button("Back") { window?.goBack() }
                .keyboardShortcut("[", modifiers: .command)
                .disabled(!can.back)
            Button("Forward") { window?.goForward() }
                .keyboardShortcut("]", modifiers: .command)
                .disabled(!can.forward)
        }

        // The desk item in focus (N7, D-058): its status by key, each undone with ⌘Z
        CommandMenu("Desk") {
            Button("Mark Reviewed") { deskItem?.perform(.reviewed) }
                .keyboardShortcut("r", modifiers: [.command, .shift])
                .disabled(deskItem == nil || deskItem?.status.value1 == .reviewed)
            Menu("Defer") {
                ForEach(Array((deskItem?.deferChoices ?? []).enumerated()), id: \.element.until) { index, choice in
                    if index == 0 {
                        Button { deskItem?.perform(.deferred(until: choice.until)) } label: { Text(verbatim: choice.text.display) }
                            .keyboardShortcut("d", modifiers: [.command, .shift])
                    } else {
                        Button { deskItem?.perform(.deferred(until: choice.until)) } label: { Text(verbatim: choice.text.display) }
                    }
                }
            }
            .disabled(deskItem?.deferChoices.isEmpty ?? true)
            Button("Mark Handled in OOTP") { deskItem?.perform(.handled) }
                .keyboardShortcut("h", modifiers: [.command, .shift])
                .disabled(deskItem == nil || deskItem?.status.value1 == .handled)
            Button("Put Back on Desk") { deskItem?.perform(.open) }
                .keyboardShortcut("o", modifiers: [.command, .shift])
                .disabled(deskItem == nil || deskItem?.status.value1 == .open)
            Divider()
            Button("Note…") { deskItem?.editNote() }
                .keyboardShortcut("n", modifiers: [.command, .shift])
                .disabled(deskItem == nil)
            Divider()
            // The club or player name in focus (M4), undone with ⌘Z like a status
            Button { followable?.toggle() } label: { followable?.following == true ? Text("Unfollow") : Text("Follow") }
                .keyboardShortcut("f", modifiers: [.command, .shift])
                .disabled(followable == nil)
        }

        // N11: the player in focus (his name, his row, his window), as section 3.6's Player menu
        CommandMenu("Player") {
            Button("Open Player") { if let player { openWindow(value: player) } }
                .keyboardShortcut("o", modifiers: [.command, .option])
                .disabled(player == nil)
            Button("Compare") { if let player { CompareRouter.shared.compare([player]) { openWindow(value: $0) } } }
                .keyboardShortcut("c", modifiers: [.command, .option])
                .disabled(player == nil)
        }

        CommandMenu("Club") {
            // A refusal (the server's sentence) or a failure is kept on the model and shown in every main window
            Button("Refresh Data") {
                Task { await model.startImport() }
            }
            .keyboardShortcut("r", modifiers: .command)
            .disabled(!can.refreshData)
            Button("Import Export…") {
                routing.requestSetup()
                openWindow(id: SceneID.setup)
            }
            .disabled(!can.importExport)
            Divider()
            Button("Data Status") {
                routing.showDataStatus()
                openSettings()
            }
            .disabled(!can.dataStatus)
        }

        CommandGroup(after: .help) {
            Button("Server Log") {
                NSWorkspace.shared.open(model.logFile)
            }
        }
    }
}
