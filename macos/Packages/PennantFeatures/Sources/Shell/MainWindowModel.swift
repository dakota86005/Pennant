import FeatureCore
import Observation
import PennantKit
import SwiftUI

/// One main window's state (SWIFTUI_REBUILD.md section 3.2): where it is and where it has been (Back and Forward), the
/// sidebar's open departments, the inspector and the sidebar's visibility, and the search field. The window keeps it
/// across relaunches through `@SceneStorage` (`restore(...)` and the `…Storage` values). Commands reach the key
/// window's model through `FocusedValues.mainWindow`.
@Observable @MainActor
public final class MainWindowModel {
    public let registry: DepartmentRegistry
    public private(set) var history: NavigationHistory
    public var inspectorPresented: Bool
    public var sidebarVisibility: NavigationSplitViewVisibility
    /// The departments open in the sidebar.
    public var expanded: Set<DeptID>
    /// The search field (a stub until search arrives).
    public var searchText = ""

    public init(
        registry: DepartmentRegistry,
        history: NavigationHistory? = nil,
        inspectorPresented: Bool = false,
        sidebarVisible: Bool = true,
        expanded: Set<DeptID>? = nil
    ) {
        self.registry = registry
        let start = history?.filtered(keeping: registry.contains, fallback: registry.defaultRoute)
            ?? NavigationHistory(current: registry.defaultRoute)
        self.history = start
        self.inspectorPresented = inspectorPresented
        sidebarVisibility = sidebarVisible ? .all : .detailOnly
        self.expanded = expanded ?? [start.current.department]
        self.expanded.insert(start.current.department)
    }

    // MARK: Where the window is

    public var route: AppRoute { history.current }
    public var department: Department? { registry.department(route.department) }
    public var descriptor: DepartmentViewDescriptor? { registry.descriptor(for: route) }
    public var canGoBack: Bool { history.canGoBack }
    public var canGoForward: Bool { history.canGoForward }

    /// The sidebar's selection: the current route. Selecting a row goes there.
    public var selection: AppRoute? {
        get { route }
        set { if let newValue { go(to: newValue) } }
    }

    /// Goes to a route this build knows; its department opens in the sidebar.
    public func go(to route: AppRoute) {
        guard registry.contains(route) else { return }
        history.go(to: route)
        expanded.insert(route.department)
    }

    /// Go ▸ a department (⌘1 to ⌘9): its first view.
    public func go(toDepartment id: DeptID) {
        if let route = registry.department(id)?.firstRoute { go(to: route) }
    }

    /// Go ▸ ⌘`number`.
    public func go(toShortcut number: Int) {
        if let route = registry.route(forShortcut: number) { go(to: route) }
    }

    public func goBack() {
        if history.goBack() { expanded.insert(route.department) }
    }

    public func goForward() {
        if history.goForward() { expanded.insert(route.department) }
    }

    public func toggleInspector() { inspectorPresented.toggle() }

    public func isExpanded(_ id: DeptID) -> Binding<Bool> {
        Binding(
            get: { self.expanded.contains(id) },
            set: { open in if open { self.expanded.insert(id) } else { self.expanded.remove(id) } }
        )
    }

    // MARK: Scene restoration (@SceneStorage)

    /// The route and its history, as `@SceneStorage` keeps them.
    public var historyStorage: Data { history.restorationData }
    /// The open departments, as `@SceneStorage` keeps them (their ids, comma-separated).
    public var expandedStorage: String { expanded.map(\.rawValue).sorted().joined(separator: ",") }
    public var sidebarVisibleStorage: Bool { sidebarVisibility != .detailOnly }

    /// A window's model from what `@SceneStorage` kept; anything missing or unknown to this build falls back to the
    /// defaults (the first department's first view, the inspector closed, the sidebar shown).
    public static func restore(
        registry: DepartmentRegistry,
        history: Data,
        inspectorPresented: Bool,
        sidebarVisible: Bool,
        expanded: String
    ) -> MainWindowModel {
        let ids = expanded.split(separator: ",").map { DeptID(rawValue: String($0)) }
            .filter { registry.department($0) != nil }
        return MainWindowModel(
            registry: registry,
            history: NavigationHistory.restored(from: history),
            inspectorPresented: inspectorPresented,
            sidebarVisible: sidebarVisible,
            expanded: expanded.isEmpty ? nil : Set(ids)
        )
    }
}

extension FocusedValues {
    /// The key main window's model, for the Go and View commands.
    @Entry public var mainWindow: MainWindowModel?
}

/// The window opens routes for the views it hosts (a card's report, a desk's "more" line).
extension MainWindowModel: RouteOpening {
    public func canOpen(_ route: AppRoute) -> Bool { registry.contains(route) }
    public func open(_ route: AppRoute) { go(to: route) }
}
