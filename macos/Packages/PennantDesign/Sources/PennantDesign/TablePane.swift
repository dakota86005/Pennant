import SwiftUI

/// The native shape for a view that is mostly a table, as Mail and Finder lay one out: a head at its natural height,
/// the `Table` filling the rest of the content column and doing its own scrolling, and beneath it a pane for the
/// selected row's detail (or, with nothing selected, the view's own notes) that scrolls on its own.
///
/// Why it exists (N8, the crash at narrow widths): a native `Table` placed inside a page's vertical `ScrollView`, given
/// a height computed from its rows, in the content column beside the inspector, made AppKit abort with "more Update
/// Constraints in Window passes than there are views in the window". The loop ran through nested
/// `_NSConstraintBasedLayoutHostingView`s with no Pennant frame in it: the table's `NSScrollView` and the page's each
/// asked the other for a size, and a narrow window never settled. A fixed width from a `GeometryReader` did not stop
/// it. Here no table is nested in a scroll view: the table is sized by the pane and scrolls by itself, and the detail
/// pane's height is a fixed share of the pane's own height, so no size is fed back from the content to the window.
///
/// Use it for every table that is more than a few lines of a page (the farm adopts it). A table never goes inside a
/// page's `ScrollView`.
public struct TablePane<Head: View, TableContent: View, Detail: View>: View {
    private let detailShare: CGFloat
    private let head: Head
    private let table: TableContent
    private let detail: Detail

    /// The minimum heights that keep both panes usable on a short window.
    public static var tableMinimum: CGFloat { 120 }
    public static var detailMinimum: CGFloat { 110 }

    /// - Parameters:
    ///   - detailShare: the share of the pane's height the detail beneath the table takes (0.25 to 0.6).
    ///   - head: the view's head, at its natural height and never scrolled away.
    ///   - table: the table, which fills what is left and scrolls by itself.
    ///   - detail: the selected row's detail or the view's notes, scrolling on its own.
    public init(
        detailShare: CGFloat = 0.42,
        @ViewBuilder head: () -> Head,
        @ViewBuilder table: () -> TableContent,
        @ViewBuilder detail: () -> Detail
    ) {
        self.detailShare = min(max(detailShare, 0.25), 0.6)
        self.head = head()
        self.table = table()
        self.detail = detail()
    }

    public var body: some View {
        GeometryReader { proxy in
            let detailHeight = max(Self.detailMinimum, (proxy.size.height * detailShare).rounded())
            VStack(alignment: .leading, spacing: 0) {
                head
                    .padding(.horizontal, 28).padding(.top, 20).padding(.bottom, 12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                table
                    .frame(maxWidth: .infinity, minHeight: Self.tableMinimum, maxHeight: .infinity)
                Divider()
                ScrollView {
                    detail
                        .padding(.horizontal, 28).padding(.vertical, 16)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .scrollBounceBehavior(.basedOnSize)
                .frame(height: detailHeight)
            }
            .frame(width: proxy.size.width, height: proxy.size.height, alignment: .top)
        }
        .background(Color.readablePage)
        // A container: an identifier the view puts on the pane names the pane, never every element inside it
        .accessibilityElement(children: .contain)
    }
}

/// A view that reports no minimum size of its own to the split view that holds it: it takes the size it is offered and
/// lays its content out in exactly that, so nothing inside (a menu sized to its title, a segmented control, a table's
/// columns, text that will not wrap) can push the column's minimum past what the window has.
///
/// Why it exists (N8, the crash at narrow widths; the review's H2). The crash's own stack names the loop:
/// `SplitViewChildController.hostingView(_:didUpdateMinSize:maxSize:)` → layout invalidated → constraints updated →
/// a new minimum → ..., until AppKit aborts with "more Update Constraints in Window passes than there are views in the
/// window". A content column whose minimum width depends on its content, at a window too narrow for the sidebar, the
/// content and the inspector, never settles. The window's content column wears this (`DetailView`), so no department's
/// view can start the loop; a table also goes in a `TablePane`, never in a page's scroll view.
public struct NoContentMinimum: ViewModifier {
    public init() {}

    public func body(content: Content) -> some View {
        GeometryReader { proxy in
            // Anchored at the top leading corner: content that cannot be narrower than the column runs past its trailing
            // edge (under the inspector, where the system lays it on a narrow window), never under the sidebar
            content.frame(width: proxy.size.width, height: proxy.size.height, alignment: .topLeading)
        }
    }
}

public extension View {
    /// Takes the size offered and reports no minimum of its own (`NoContentMinimum`).
    func noContentMinimum() -> some View { modifier(NoContentMinimum()) }
}
