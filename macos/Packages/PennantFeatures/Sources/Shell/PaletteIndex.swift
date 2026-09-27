import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit

/// What the ⌘K palette can open in a main window (SWIFTUI_REBUILD.md section 3.6): every department's views from the
/// registry (their served names when the catalog is there, the structural titles until then), with the Go menu's
/// shortcuts, and the commands that act on the window. Players and clubs join when the server serves search (N7).
public struct PaletteIndex: Sendable {
    /// A command the palette can run.
    public enum Command: String, Sendable, Hashable, CaseIterable {
        case inspector, refreshData, importExport, dataStatus, back, forward
    }

    /// What opening an entry does.
    public enum Action: Sendable, Hashable {
        case route(AppRoute)
        case command(Command)
    }

    public let entries: [PaletteEntry]
    public let actions: [String: Action]

    /// - Parameters:
    ///   - catalog: the served catalog, for the departments' and views' served names; nil uses the structural titles.
    ///   - can: which commands can act now (`CommandAvailability`); a command that cannot is left out.
    ///   - inspectorShown: whether the inspector is up, for the command's label.
    public init(registry: DepartmentRegistry, catalog: Components.Schemas.Catalog?, can: CommandAvailability, inspectorShown: Bool) {
        var entries: [PaletteEntry] = []
        var actions: [String: Action] = [:]
        let shortcuts = Dictionary(uniqueKeysWithValues: registry.shortcutDepartments.map { ($0.department.id, $0.number) })
        for department in registry.departments {
            let served = catalog?.departments.first { $0.id.rawValue == department.id.rawValue }
            let departmentName = served?.name ?? String(localized: department.title)
            for (index, view) in department.views.enumerated() {
                let route = department.route(to: view)
                let id = "view.\(route.department.rawValue).\(route.view)"
                let name = served?.views.first { $0.id == view.id }?.name ?? String(localized: view.title)
                let shortcut = index == 0 ? shortcuts[department.id].map { "⌘\($0)" } : nil
                entries.append(PaletteEntry(id: id, group: departmentName, symbol: view.symbol, title: name, line: departmentName,
                                            keywords: view.keywords + [department.id.rawValue, view.id], shortcut: shortcut))
                actions[id] = .route(route)
            }
        }
        let commands: [(Command, Bool, String, String, String?)] = [
            (.inspector, can.inspector, "sidebar.trailing", inspectorShown ? String(localized: "Hide Inspector") : String(localized: "Show Inspector"), "⌥⌘I"),
            (.refreshData, can.refreshData, "arrow.clockwise", String(localized: "Refresh Data"), "⌘R"),
            (.importExport, can.importExport, "square.and.arrow.down", String(localized: "Import Export…"), nil),
            (.dataStatus, can.dataStatus, "checkmark.circle", String(localized: "Data Status"), nil),
            (.back, can.back, "chevron.backward", String(localized: "Back"), "⌘["),
            (.forward, can.forward, "chevron.forward", String(localized: "Forward"), "⌘]"),
        ]
        let group = String(localized: "Commands")
        for (command, available, symbol, title, shortcut) in commands where available {
            let id = "command.\(command.rawValue)"
            entries.append(PaletteEntry(id: id, group: group, symbol: symbol, title: title, keywords: [command.rawValue], shortcut: shortcut))
            actions[id] = .command(command)
        }
        self.entries = entries
        self.actions = actions
    }

    public func action(for entry: PaletteEntry) -> Action? { actions[entry.id] }
}
