import FeatureCore
import Observation
import PennantAPI
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
    /// The toolbar's search field, and the server's answer for what was typed (N7). A view may scope the field to itself
    /// (`WindowSearch`, N12 Track B: Player Search).
    public let search = WindowSearch()
    public var searchText: String {
        get { search.text }
        set { search.text = newValue }
    }
    public var searchAnswer: (query: String, answer: Components.Schemas.SearchAnswer)?
    /// Why the search for a query failed (the server's sentence or the kind of failure), and the query.
    public var searchProblem: (query: String, problem: RequestProblem)?
    /// The answer for the text in the field now; nil while it is being asked, or with nothing typed.
    public var currentSearch: Components.Schemas.SearchAnswer? {
        let query = searchText.trimmingCharacters(in: .whitespaces)
        guard !query.isEmpty, let searchAnswer, searchAnswer.query == query else { return nil }
        return searchAnswer.answer
    }
    /// The answer shown: the one for the text now, else the last one while the text now is asked (`searchUpdating`);
    /// none once the text now failed (L3).
    public var shownSearch: Components.Schemas.SearchAnswer? {
        let query = searchText.trimmingCharacters(in: .whitespaces)
        guard !query.isEmpty, currentSearchProblem == nil else { return nil }
        return searchAnswer?.answer
    }
    /// The answer shown answers an earlier text while the text now is asked.
    public var searchUpdating: Bool {
        let query = searchText.trimmingCharacters(in: .whitespaces)
        guard !query.isEmpty, currentSearchProblem == nil, let searchAnswer else { return false }
        return searchAnswer.query != query
    }
    /// Why the search for the text now failed; nil when it didn't (or hasn't answered).
    public var currentSearchProblem: RequestProblem? {
        let query = searchText.trimmingCharacters(in: .whitespaces)
        guard !query.isEmpty, let searchProblem, searchProblem.query == query else { return nil }
        return searchProblem.problem
    }
    /// The ⌘K palette: whether it is up, and what is typed in it.
    public var paletteShown = false
    public var paletteQuery = ""
    /// The claim pinned to the inspector's evidence tab (SWIFTUI_REBUILD.md section 3.3); nil when none is.
    public var pinnedClaim: Components.Schemas.Claim?

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

    /// The sidebar's selection: the current route's view (a decision open in Decision selects Decision). Selecting a row
    /// goes to that view, with nothing open.
    public var selection: AppRoute? {
        get { route.viewOnly }
        set { if let newValue, newValue != route { go(to: newValue) } }
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

    /// Pins a claim to the inspector's evidence tab and shows the inspector.
    public func pin(_ claim: Components.Schemas.Claim) {
        pinnedClaim = claim
        inspectorPresented = true
    }

    /// View ▸ Find Anything… (⌘K): the palette, its query cleared each time it opens.
    public func togglePalette() {
        paletteShown.toggle()
        if paletteShown { paletteQuery = "" }
    }

    /// Find Anything (⌘K) chosen while another window is key: the palette up (never toggled away), its query cleared.
    public func showPalette() {
        if !paletteShown { paletteQuery = "" }
        paletteShown = true
    }

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
    public func department(_ id: DeptID) -> Department? { registry.department(id) }
}
