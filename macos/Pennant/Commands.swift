import FeatureCore
import PennantKit
import Shell
import SwiftUI

/// The menu bar's commands (SWIFTUI_REBUILD.md section 3.6). Go and View act on the key main window
/// (`FocusedValues.mainWindow`); Club acts on the app. What can act comes from `CommandAvailability`.
struct PennantCommands: Commands {
    let model: AppModel
    let routing: AppRouting
    let registry: DepartmentRegistry
    @FocusedValue(\.mainWindow) private var window
    @Environment(\.openWindow) private var openWindow
    @Environment(\.openSettings) private var openSettings

    private var can: CommandAvailability { .of(model, window: window) }

    var body: some Commands {
        SidebarCommands()

        CommandGroup(after: .sidebar) {
            Button(window?.inspectorPresented == true ? "Hide Inspector" : "Show Inspector") {
                window?.toggleInspector()
            }
            .keyboardShortcut("i", modifiers: [.command, .option])
            .disabled(!can.inspector)
            Button("Find Anything…") {
                window?.togglePalette()
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
