import PennantKit
import SwiftUI

/// One view a department offers (SWIFTUI_REBUILD.md sections 3.5 and 6): its id inside the department, its title and
/// SF Symbol for the sidebar and the Go menu, the words search matches, and how to build it. Adding a function to the
/// app means adding one of these.
public struct DepartmentViewDescriptor: Identifiable, Sendable {
    /// The view's id inside its department (`report`, `positionPlayers`, ...); the second half of an `AppRoute`.
    public let id: String
    /// A structural name (a String Catalog key).
    public let title: LocalizedStringResource
    public let symbol: String
    /// What search matches besides the title (search arrives later; the words are never shown).
    public let keywords: [String]
    private let build: @MainActor @Sendable () -> AnyView

    public init<Content: View>(
        id: String,
        title: LocalizedStringResource,
        symbol: String,
        keywords: [String] = [],
        @ViewBuilder view: @escaping @MainActor @Sendable () -> Content
    ) {
        self.id = id
        self.title = title
        self.symbol = symbol
        self.keywords = keywords
        build = { AnyView(view()) }
    }

    /// A view that has not been built yet: the structural placeholder with its title and symbol.
    public static func placeholder(
        id: String,
        title: LocalizedStringResource,
        symbol: String,
        keywords: [String] = []
    ) -> DepartmentViewDescriptor {
        DepartmentViewDescriptor(id: id, title: title, symbol: symbol, keywords: keywords) {
            PlaceholderView(title: title, symbol: symbol)
        }
    }

    /// Builds the view.
    public func makeView() -> AnyView { build() }
}

/// A department (SWIFTUI_REBUILD.md section 6): what one PennantFeatures target exports. The app target lists the
/// modules; the registry orders them and derives the sidebar, the Go menu (⌘1 to ⌘9 in `order`) and, later, search.
public protocol DepartmentModule {
    static var id: DeptID { get }
    static var title: LocalizedStringResource { get }
    static var symbol: String { get }
    /// The department's place in the sidebar and the Go menu.
    static var order: Int { get }
    /// Its views, in the order the sidebar lists them; the first is where Go takes the GM.
    static var views: [DepartmentViewDescriptor] { get }
    /// The count of items "to decide" for the sidebar badge, from what the server serves (the desk arrives with N7);
    /// nil draws no badge.
    @MainActor static func badge(from model: AppModel) -> Int?
}

extension DepartmentModule {
    @MainActor public static func badge(from model: AppModel) -> Int? { nil }
}

/// The structural placeholder a view shows until its milestone builds it: its title and one line.
public struct PlaceholderView: View {
    let title: LocalizedStringResource
    let symbol: String

    public init(title: LocalizedStringResource, symbol: String) {
        self.title = title
        self.symbol = symbol
    }

    public var body: some View {
        // Drawn by hand rather than with ContentUnavailableView, whose dimmed title and line failed the accessibility
        // audit's contrast check: the symbol is decorative, and both lines are primary text
        VStack(spacing: 10) {
            Image(systemName: symbol)
                .font(.system(size: 40))
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
            Text(title)
                .font(.title2.weight(.semibold))
            Text("Arrives in a later build")
                .font(.body)
        }
        .foregroundStyle(.primary)
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
