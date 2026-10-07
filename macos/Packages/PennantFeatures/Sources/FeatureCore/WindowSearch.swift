import PennantKit
import SwiftUI

// MARK: The window's search, scoped by a view

/// A served search token as the window's search field holds it (N12 Track B: Player Search's position, level, club …).
public struct ScopedSearchToken: Identifiable, Hashable, Sendable {
    public let id: String
    public let kind: String
    public let text: String

    public init(id: String, kind: String, text: String) {
        self.id = id
        self.kind = kind
        self.text = text
    }
}

/// The window's one search field (N7), which a view can scope to itself, as Finder's and Mail's search the folder or
/// mailbox shown (N12 Track B): while a view scopes it, what is typed and the tokens chosen are the view's question
/// (Player Search), the field offers the view's tokens, and the server's whole-league suggestions stand aside. A
/// window has one search field: a second `.searchable` in the toolbar on a narrow window looped AppKit's layout.
@Observable @MainActor
public final class WindowSearch {
    public var text = ""
    public var tokens: [ScopedSearchToken] = []
    /// The tokens the field offers for what is typed (the scoping view's).
    public var suggested: [ScopedSearchToken] = []
    /// The view scoping the field (its prompt); nil when the field searches the league.
    public var scope: LocalizedStringKey?

    public init() {}

    /// The view scoping the field leaves it: back to the league's search, emptied.
    public func unscope() {
        scope = nil
        tokens = []
        suggested = []
        text = ""
    }
}

extension EnvironmentValues {
    /// The window's search field (`MainWindowModel.search`); nil outside a main window (a preview, a snapshot).
    @Entry public var windowSearch: WindowSearch?
}
