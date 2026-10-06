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
/// pane's height is the pane's own number (a share of its height, or where the GM left the boundary), so no size is fed
/// back from the content to the window.
///
/// The boundary between the table and the detail is the GM's to move, as in Mail: drag it (or, with VoiceOver, adjust
/// it), and the pane remembers where it was left, per view, across launches (`autosave`; N9 review, M1). The table never
/// gets less than `tableMinimum` and the detail never less than `detailMinimum`: a remembered height that no longer
/// fits a smaller window gives way to the table. The heights are the pane's own numbers, never fed back from the
/// content to the window, so the constraint loop above cannot start.
///
/// Use it for every table that is more than a few lines of a page (the farm adopts it). A table never goes inside a
/// page's `ScrollView`.
public struct TablePane<Head: View, TableContent: View, Detail: View>: View {
    private let detailShare: CGFloat
    private let autosave: String?
    private let head: Head
    private let table: TableContent
    private let detail: Detail
    /// The detail's height as the GM left it (0: not moved yet), kept per view when the pane has an autosave name.
    @AppStorage private var saved: Double
    /// The same, for a pane with no autosave name: this showing only.
    @State private var moved: Double = 0
    @State private var headHeight: CGFloat = 0
    @State private var dragStart: CGFloat?

    /// The minimum heights that keep both panes usable on a short window.
    public static var tableMinimum: CGFloat { 120 }
    public static var detailMinimum: CGFloat { 110 }
    /// The divider's height, its line centred in it: tall enough to grab.
    static var dividerHeight: CGFloat { 7 }

    /// - Parameters:
    ///   - detailShare: the share of the pane's height the detail beneath the table takes until the GM moves the
    ///     boundary (0.25 to 0.6).
    ///   - autosave: the name the boundary's place is remembered under (each view its own); nil remembers it for this
    ///     showing only.
    ///   - head: the view's head, at its natural height and never scrolled away.
    ///   - table: the table, which fills what is left and scrolls by itself.
    ///   - detail: the selected row's detail or the view's notes, scrolling on its own.
    public init(
        detailShare: CGFloat = 0.42,
        autosave: String? = nil,
        @ViewBuilder head: () -> Head,
        @ViewBuilder table: () -> TableContent,
        @ViewBuilder detail: () -> Detail
    ) {
        self.detailShare = min(max(detailShare, 0.25), 0.6)
        self.autosave = autosave
        self.head = head()
        self.table = table()
        self.detail = detail()
        _saved = AppStorage(wrappedValue: 0, "TablePane.detailHeight.\(autosave ?? "")")
    }

    private var chosen: Double {
        get { autosave == nil ? moved : saved }
        nonmutating set { if autosave == nil { moved = newValue } else { saved = newValue } }
    }

    /// The detail's height in a pane of this height: the GM's (or the share's), within both minimums.
    private func detailHeight(in height: CGFloat) -> CGFloat {
        let most = max(Self.detailMinimum, height - headHeight - Self.tableMinimum - Self.dividerHeight)
        let wanted = chosen > 0 ? CGFloat(chosen) : (height * detailShare).rounded()
        return min(max(Self.detailMinimum, wanted), most)
    }

    public var body: some View {
        GeometryReader { proxy in
            let height = proxy.size.height
            let detailHeight = detailHeight(in: height)
            VStack(alignment: .leading, spacing: 0) {
                head
                    .padding(.horizontal, 28).padding(.top, 20).padding(.bottom, 12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { headHeight = $0 }
                table
                    .frame(maxWidth: .infinity, minHeight: Self.tableMinimum, maxHeight: .infinity)
                PaneDivider(
                    height: detailHeight,
                    range: Self.detailMinimum...max(Self.detailMinimum, height - headHeight - Self.tableMinimum - Self.dividerHeight)
                ) { chosen = Double($0) }
                ScrollView {
                    detail
                        .padding(.horizontal, 28).padding(.vertical, 16)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        // Named for VoiceOver (the audit found the pane's content with no description)
                        .accessibilityElement(children: .contain)
                        .accessibilityLabel(Text("Details"))
                }
                .scrollBounceBehavior(.basedOnSize)
                .frame(height: detailHeight)
                .accessibilityLabel(Text("Details"))
            }
            // Anchored at the leading edge, as `NoContentMinimum` is: a head that cannot be narrower than the pane runs
            // past its trailing edge (under the inspector), never under the sidebar (N10: the synthetic league's farm
            // widened a decision's candidates' head, and centred it half under the sidebar)
            .frame(width: proxy.size.width, height: proxy.size.height, alignment: .topLeading)
        }
        .background(Color.readablePage)
    }
}

/// The boundary between a table and its detail: the system's divider line in a strip tall enough to grab, the row
/// resize pointer over it, dragged up or down to move the boundary; VoiceOver adjusts it a step at a time.
struct PaneDivider: View {
    let height: CGFloat
    let range: ClosedRange<CGFloat>
    let set: (CGFloat) -> Void
    @State private var start: CGFloat?

    var body: some View {
        Divider()
            .frame(maxWidth: .infinity, minHeight: TablePane<EmptyView, EmptyView, EmptyView>.dividerHeight,
                   maxHeight: TablePane<EmptyView, EmptyView, EmptyView>.dividerHeight)
            .contentShape(Rectangle())
            .pointerStyle(.frameResize(position: .top))
            .gesture(
                DragGesture(minimumDistance: 1, coordinateSpace: .global)
                    .onChanged { drag in
                        let from = start ?? height
                        if start == nil { start = height }
                        set(min(max(from - drag.translation.height, range.lowerBound), range.upperBound).rounded())
                    }
                    .onEnded { _ in start = nil }
            )
            // To VoiceOver an adjustable slider (a role it can name). No fixed step: on a short window the range can be
            // narrower than any step, and a slider whose step exceeds its range traps ("max stride must be positive")
            .accessibilityRepresentation {
                Slider(
                    value: Binding(get: { Double(height) }, set: { set(CGFloat($0).rounded()) }),
                    in: Double(range.lowerBound)...Double(max(range.upperBound, range.lowerBound + 1))
                ) { Text("Details Height") }
            }
            .accessibilityIdentifier("tablePane.divider")
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
