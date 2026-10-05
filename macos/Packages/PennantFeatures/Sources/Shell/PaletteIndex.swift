import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit

/// What the ⌘K palette can open in a main window (SWIFTUI_REBUILD.md section 3.6): every department's views from the
/// registry (their served names when the catalog is there, the structural titles until then), with the Go menu's
/// shortcuts, and the commands that act on the window; and, with a query, the server's search answer (N7): its players,
/// clubs and views as served, grouped and ordered by the server (followed first), the registry's views then left out.
public struct PaletteIndex: Sendable {
    /// A command the palette can run.
    public enum Command: String, Sendable, Hashable, CaseIterable {
        case inspector, refreshData, importExport, dataStatus, back, forward
    }

    /// What opening an entry does.
    public enum Action: Sendable, Hashable {
        case route(AppRoute)
        case command(Command)
        /// A served search result's target: a view, a club's window, or a player's own window (N11).
        case served(Components.Schemas.Target)
    }

    public let entries: [PaletteEntry]
    /// The served answer's results, in its order; empty with no answer.
    public let served: [PaletteEntry]
    /// The served line when nothing matches; nil with no answer.
    public let emptyLine: String?
    public let actions: [String: Action]

    /// - Parameters:
    ///   - catalog: the served catalog, for the departments' and views' served names; nil uses the structural titles.
    ///   - can: which commands can act now (`CommandAvailability`); a command that cannot is left out.
    ///   - inspectorShown: whether the inspector is up, for the command's label.
    ///   - search: the server's answer for the query typed; nil when none is here (the registry's views are searched).
    ///   - searchFailed: the server couldn't answer the query: the registry's views are not searched in its place, so a
    ///     failure never reads as an answer (L3).
    public init(registry: DepartmentRegistry, catalog: Components.Schemas.Catalog?, can: CommandAvailability, inspectorShown: Bool,
                search: Components.Schemas.SearchAnswer? = nil, searchFailed: Bool = false) {
        var entries: [PaletteEntry] = []
        var actions: [String: Action] = [:]
        var served: [PaletteEntry] = []
        for group in search?.groups ?? [] {
            for result in group.results {
                let kind = result.kind.value1?.rawValue ?? result.kind.value2 ?? "result"
                let id = "search.\(kind).\(result.id)"
                served.append(PaletteEntry(id: id, group: group.title.display, symbol: Self.symbol(kind), title: result.title,
                                           line: result.line.isEmpty ? nil : result.line, followed: result.followed,
                                           opens: Self.opens(result.open)))
                actions[id] = .served(result.open)
            }
        }
        self.served = served
        emptyLine = search?.empty?.display
        let shortcuts = Dictionary(uniqueKeysWithValues: registry.shortcutDepartments.map { ($0.department.id, $0.number) })
        // With the server's answer here its views stand for the registry's (the same views, in its order)
        for department in registry.departments where search == nil && !searchFailed {
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

    /// Whether a served target opens anything here: a view, a player's own window (N11), or a club's window.
    static func opens(_ target: Components.Schemas.Target) -> Bool {
        route(target) != nil || playerRef(opening: target) != nil || clubRef(opening: target) != nil
    }

    /// A served result's symbol by its kind.
    static func symbol(_ kind: String) -> String {
        switch kind {
        case "player": "person"
        case "club": "building.2"
        default: "rectangle.stack"
        }
    }
}
