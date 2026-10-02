import AppKit
import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

// What Farm & Development's views share (N10): the page frame, a finding, a player's name and the rows' menus. Every
// word is served; the views add only structural labels from the String Catalog.

/// A farm view's page: the masthead (the staff, the date, the view's served name and its deck), then the content, in the
/// report's measure. A failed reload says so above what is kept.
struct FarmPage<Figures: View, Content: View>: View {
    @Environment(AppModel.self) private var model
    let view: String
    let head: Head
    let deck: Components.Schemas.Claim?
    let updating: Bool
    let problem: RequestProblem?
    /// A served headline in place of the view's name (a Decision's player), its deck, and what wraps it (his name's menu).
    var headline: String?
    var deckText: String?
    var decorate: (@MainActor (AnyView) -> AnyView)?
    @ViewBuilder let figures: () -> Figures
    @ViewBuilder let content: () -> Content

    /// The served head every farm view carries.
    struct Head {
        let preparedBy: Components.Schemas.Cell
        let asOf: Components.Schemas.Cell
    }

    var body: some View {
        MastheadScrollView {
            ClubMagazineMasthead(
                kicker: [head.preparedBy.display, head.asOf.display],
                kickerHint: head.asOf.hint,
                kickerStatus: updating ? String(localized: "Updating") : nil,
                headline: Text(verbatim: headline ?? model.servedViewName(department: "farm", view: view) ?? ""),
                deck: deck,
                deckText: deckText,
                decorateHeadline: decorate,
                figures: figures
            )
        } content: {
            VStack(alignment: .leading, spacing: 22) {
                if let problem { ProblemLine(problem) }
                content()
            }
            .padding(.horizontal, 28).padding(.vertical, 24)
            .frame(maxWidth: 1100, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

extension FarmPage where Figures == EmptyView {
    init(
        view: String, head: Head, deck: Components.Schemas.Claim?, updating: Bool, problem: RequestProblem?,
        headline: String? = nil, deckText: String? = nil, decorate: (@MainActor (AnyView) -> AnyView)? = nil,
        @ViewBuilder content: @escaping () -> Content
    ) {
        self.init(view: view, head: head, deck: deck, updating: updating, problem: problem, headline: headline, deckText: deckText, decorate: decorate, figures: { EmptyView() }, content: content)
    }
}

/// A section of a farm page: a structural title, an optional served note under it, then its content.
struct FarmSection<Content: View>: View {
    let title: LocalizedStringResource
    let note: Components.Schemas.Cell?
    @ViewBuilder let content: () -> Content

    init(_ title: LocalizedStringResource, note: Components.Schemas.Cell? = nil, @ViewBuilder content: @escaping () -> Content) {
        self.title = title
        self.note = note
        self.content = content
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.title3.weight(.semibold)).accessibilityAddTraits(.isHeader)
            if let note {
                Text(verbatim: note.display).font(.callout).foregroundStyle(.readableSecondary).help(detail: note.hint)
                    .fixedSize(horizontal: false, vertical: true)
            }
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }
}

/// Served lines, one to a line, each with its tone's symbol when it has one.
struct ServedLines: View {
    let lines: [Components.Schemas.Cell]
    var font: Font = .body

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Image(systemName: "circle.fill").font(.system(size: 4)).foregroundStyle(.readableSecondary).accessibilityHidden(true)
                    CellText(line).font(font).fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }
}

/// A served line about something not known: the unknown's symbol, the words, in the content's own colours.
struct UnknownLine: View {
    let cell: Components.Schemas.Cell

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            ToneMark(.unknown)
            Text(verbatim: cell.display).fixedSize(horizontal: false, vertical: true)
        }
        .help(detail: cell.hint)
        .accessibilityElement(children: .combine)
    }
}

// MARK: A finding

/// One finding of Minor League Operations or Player Development: its severity, its sentence (its evidence a click away),
/// who raised it; open, its evidence, the players it names, what is missing and what would settle it.
struct FindingView: View {
    let finding: Components.Schemas.FarmFindingView

    init(_ finding: Components.Schemas.FarmFindingView) {
        self.finding = finding
    }

    var body: some View {
        Fold(open: finding.expanded) {
            VStack(alignment: .leading, spacing: 8) {
                if !finding.evidence.isEmpty {
                    Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 4) {
                        ForEach(finding.evidence, id: \.id) { row in
                            GridRow(alignment: .firstTextBaseline) {
                                Text(verbatim: row.cells.label.display).foregroundStyle(.readableSecondary)
                                CellText(row.cells.value).fontWeight(.semibold)
                                Text(verbatim: row.cells.why.display).foregroundStyle(.readableSecondary).fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                    .font(.callout)
                }
                ForEach(finding.players, id: \.playerId) { player in
                    FarmPlayerName(player: player).font(.callout)
                }
                if !finding.missing.isEmpty {
                    LabeledLines(title: "Not established", lines: finding.missing)
                }
                if !finding.wouldSettle.isEmpty {
                    LabeledLines(title: "What would settle it", lines: finding.wouldSettle)
                }
            }
            .padding(.top, 4)
        } label: {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Pill(finding.severity.display, tone: Tone(finding.severity.tone))
                ClaimText(finding.headline, edge: .trailing) {
                    Text(verbatim: finding.headline.text).fixedSize(horizontal: false, vertical: true)
                }
                Text(verbatim: finding.owner.display).font(.callout).foregroundStyle(.readableSecondary)
            }
        }
        .accessibilityIdentifier("farm.finding.\(finding.id)")
    }
}

/// A structural title over served lines ("Not established", "What would settle it").
struct LabeledLines: View {
    let title: LocalizedStringResource
    let lines: [Components.Schemas.Cell]

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.callout.weight(.semibold))
            ServedLines(lines: lines, font: .callout)
        }
    }
}

// MARK: A player

/// A farm player's served line, his name the way names work across the app: a double-click or Return opens his Decision
/// in this window, the context menu opens it, follows him and copies his name, and he can be dragged (onto Following).
struct FarmPlayerName: View {
    let player: Components.Schemas.FarmPlayerLine

    var body: some View {
        Text(verbatim: player.line.display)
            .fixedSize(horizontal: false, vertical: true)
            .help(detail: player.line.hint)
            .farmPlayer(id: player.playerId, name: player.name, open: player.open)
    }
}

extension View {
    /// A farm player's name: his Decision (the served target) on a double-click or Return, the farm's menu, a drag.
    func farmPlayer(id: Int, name: String, open: Components.Schemas.Target?) -> some View {
        modifier(FarmPlayerModifier(id: id, name: name, open: open))
    }
}

struct FarmPlayerModifier: ViewModifier {
    let id: Int
    let name: String
    let open: Components.Schemas.Target?
    @Environment(\.routeOpener) private var opener

    private var openable: AppRoute? {
        guard let r = route(open), opener?.canOpen(r) ?? false else { return nil }
        return r
    }

    func body(content: Content) -> some View {
        content
            .contentShape(.rect)
            .focusable()
            .onKeyPress(.return) {
                guard let openable else { return .ignored }
                opener?.open(openable)
                return .handled
            }
            .onTapGesture(count: 2) { if let openable { opener?.open(openable) } }
            .contextMenu { FarmPlayerMenu(id: id, name: name, open: open) }
            .draggable(PlayerRef(id: id)) {
                Label { Text(verbatim: name) } icon: { Image(systemName: "person") }
                    .padding(6).background(.regularMaterial, in: .capsule)
            }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(openable != nil ? .isButton : [])
            .accessibilityAction { if let openable { opener?.open(openable) } }
            .accessibilityIdentifier("farm.player.\(id)")
    }
}

/// A farm player's menu: Open Decision (where the served target leads), Follow or Unfollow, Copy Name.
struct FarmPlayerMenu: View {
    let id: Int
    let name: String
    let open: Components.Schemas.Target?
    @Environment(\.routeOpener) private var opener

    var body: some View {
        if let r = route(open), opener?.canOpen(r) ?? false {
            Button("Open Decision", systemImage: "checkmark.seal") { opener?.open(r) }
        }
        FollowMenuItem(kind: "player", id: id)
        Divider()
        Button("Copy Name", systemImage: "doc.on.doc") {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(name, forType: .string)
        }
    }
}

/// Opens a served target in the window, when this build has its view.
@MainActor
func openServed(_ target: Components.Schemas.Target?, with opener: (any RouteOpening)?) {
    guard let r = route(target), opener?.canOpen(r) ?? false else { return }
    opener?.open(r)
}

/// The served level filter as a menu: every level, then each served level by name.
struct LevelPicker: View {
    let levels: [Components.Schemas.FarmLevelChoice]
    @Binding var selection: String?

    var body: some View {
        Picker(selection: $selection) {
            Text("All Levels").tag(String?.none)
            ForEach(levels, id: \.id) { level in
                Text(verbatim: level.name).tag(String?.some(level.id))
            }
        } label: {
            Label("Level", systemImage: "square.stack.3d.up")
        }
        .help(Text("Level"))
        .accessibilityIdentifier("farm.filter.level")
    }
}

/// The view's load, keyed on the store key: the five lists together.
struct FarmLoad: ViewModifier {
    @Environment(AppModel.self) private var model

    func body(content: Content) -> some View {
        content.task(id: model.storeKey) { await model.loadFarm() }
    }
}

extension View {
    func loadsFarm() -> some View { modifier(FarmLoad()) }
}

/// Loading, a problem, or the view.
struct FarmLoading<Payload, Content: View>: View {
    let payload: Payload?
    let problem: RequestProblem?
    @ViewBuilder let content: (Payload) -> Content

    var body: some View {
        Group {
            if let payload {
                content(payload)
            } else if let problem {
                ProblemLine(problem).padding().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ProgressView { Text("Loading") }.frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        // The view asks no minimum of the window: its tables scroll and its panes give way, and the split view's own
        // collapsing (the sidebar, the inspector) decides what shows on a narrow window, as macOS does
        .frame(minWidth: 0, maxWidth: .infinity, minHeight: 0, maxHeight: .infinity)
    }
}

// MARK: Served rows are identified by their served id

extension Components.Schemas.FarmDepthRow: @retroactive Identifiable {}
extension Components.Schemas.FarmStartersRow: @retroactive Identifiable {}
extension Components.Schemas.FarmPlayerRow: @retroactive Identifiable {}
extension Components.Schemas.FarmLineRow: @retroactive Identifiable {}
extension Components.Schemas.FarmCoverRow: @retroactive Identifiable {}
extension Components.Schemas.FarmConcernRow: @retroactive Identifiable {}
extension Components.Schemas.FarmAssignmentRow: @retroactive Identifiable {}
extension Components.Schemas.FarmAlternativeRow: @retroactive Identifiable {}
extension Components.Schemas.FarmProspectRow: @retroactive Identifiable {}
extension Components.Schemas.FarmEvaluationRow: @retroactive Identifiable {}
extension Components.Schemas.FarmDevelopmentRow: @retroactive Identifiable {}
extension Components.Schemas.FarmSnapshotRow: @retroactive Identifiable {}
extension Components.Schemas.FarmMovementRow: @retroactive Identifiable {}

// MARK: A fold

/// A titled fold, closed or open (a finding's evidence, the results behind a verdict, who decided what): its label a
/// button with the system's disclosure chevron, its content laid out from the leading edge beneath it.
struct Fold<Label: View, Content: View>: View {
    @State private var open: Bool
    @ViewBuilder let label: () -> Label
    @ViewBuilder let content: () -> Content

    init(open: Bool = false, @ViewBuilder content: @escaping () -> Content, @ViewBuilder label: @escaping () -> Label) {
        _open = State(initialValue: open)
        self.label = label
        self.content = content
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Button { withAnimation(.snappy) { open.toggle() } } label: {
                    Image(systemName: "chevron.right")
                        .font(.caption.weight(.semibold))
                        .rotationEffect(.degrees(open ? 90 : 0))
                        .frame(width: 14)
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(open ? Text("Close") : Text("Open"))
                .accessibilityValue(open ? Text("Open") : Text("Closed"))
                label()
            }
            if open {
                content()
                    .padding(.leading, 20)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
