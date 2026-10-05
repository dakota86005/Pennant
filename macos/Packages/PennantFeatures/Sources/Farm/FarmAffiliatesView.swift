import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

/// Farm & Development ▸ Affiliates (N10): the organization drawn as served, from the major-league club down, each club a
/// node with its two readings (can it field a team, are its players developing; never one state, D-045); the chosen
/// affiliate read in full beneath it, in its own scroll area (a `TablePane`, as Mail lays out a message under its list).
/// A desk item or a link about an affiliate opens it here (the route's key).
public struct FarmAffiliatesView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.currentRoute) private var currentRoute

    public init() {}

    public var body: some View {
        let farm = model.farm
        FarmLoading(payload: farm.affiliates, problem: farm.affiliates == nil ? farm.problems["affiliates"] : nil) { view in
            AffiliatesSplit(view: view, initial: currentRoute?.key.flatMap(Int.init), updating: farm.isStale("affiliates", for: model.storeKey))
        }
        .loadsFarm()
    }
}

struct AffiliatesSplit: View {
    let view: Components.Schemas.FarmAffiliatesView
    let updating: Bool
    @State private var selection: Int?
    @Environment(\.routeOpener) private var opener

    init(view: Components.Schemas.FarmAffiliatesView, initial: Int?, updating: Bool) {
        self.view = view
        self.updating = updating
        let first = view.affiliates.first?.teamId
        _selection = State(initialValue: initial.flatMap { id in view.affiliates.contains { $0.teamId == id } ? id : nil } ?? first)
    }

    /// The next or previous affiliate, from the arrows.
    private func step(_ by: Int) -> KeyPress.Result {
        let ids = view.affiliates.map(\.teamId)
        guard !ids.isEmpty else { return .ignored }
        let at = selection.flatMap { ids.firstIndex(of: $0) } ?? -1
        selection = ids[min(max(at + by, 0), ids.count - 1)]
        return .handled
    }

    var body: some View {
        // The organization at the top, the chosen affiliate read beneath it in its own scroll area: the list fills what
        // the head leaves and scrolls itself, and nothing has a width of its own (N8's `TablePane`, the narrow window)
        TablePane(detailShare: 0.58) {
            HStack(spacing: 8) {
                Text(verbatim: view.order.display)
                    .font(.callout.weight(.medium)).foregroundStyle(.readableSecondary)
                    .help(detail: view.order.hint)
                    .fixedSize(horizontal: false, vertical: true)
                if updating { ProgressView().controlSize(.small).accessibilityLabel(Text("Updating")) }
            }
        } table: {
            // The chosen club is drawn in a fixed, checked fill rather than the system's selection, whose grey (when the
            // list is not focused) put the pills' words on a colour that changes with the system; arrows choose too
            List {
                ForEach(Array(view.clubs.enumerated()), id: \.element.teamId) { index, club in
                    let chosen = !club.majorLeague && club.teamId == selection
                    ClubNode(club: club, first: index == 0, last: index == view.clubs.count - 1, chosen: chosen)
                        .contentShape(.rect)
                        .onTapGesture { if !club.majorLeague { selection = club.teamId } }
                        .listRowBackground(
                            RoundedRectangle(cornerRadius: 8).fill(chosen ? Color.readableChipFill : Color.clear).padding(.horizontal, 6)
                        )
                        .accessibilityAction { if !club.majorLeague { selection = club.teamId } }
                        .contextMenu {
                            if club.majorLeague, let r = route(club.open), opener?.canOpen(r) ?? false {
                                Button("Open Report", systemImage: "list.bullet.clipboard") { opener?.open(r) }
                            }
                        }
                }
            }
            .listStyle(.inset)
            .onReadablePage()
            .focusable()
            .onKeyPress(.downArrow) { step(1) }
            .onKeyPress(.upArrow) { step(-1) }
            .overlay {
                if let empty = view.empty {
                    Text(verbatim: empty.display).foregroundStyle(.readableSecondary).padding()
                }
            }
            .accessibilityLabel(Text("Organization"))
            .accessibilityIdentifier("farm.affiliates.clubs")
        } detail: {
            if let affiliate = view.affiliates.first(where: { $0.teamId == selection }) {
                VStack(alignment: .leading, spacing: 20) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(verbatim: view.byline.display)
                            .font(.caption.weight(.semibold)).textCase(.uppercase).foregroundStyle(.readableSecondary)
                            .help(detail: view.byline.hint)
                        Text(verbatim: affiliate.name).font(.title.weight(.bold)).accessibilityAddTraits(.isHeader)
                            .fixedSize(horizontal: false, vertical: true)
                        Text(verbatim: affiliate.line.display).foregroundStyle(.readableSecondary).fixedSize(horizontal: false, vertical: true)
                    }
                    AffiliateDetailContent(affiliate: affiliate)
                }
                .frame(maxWidth: 1000, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("farm.affiliate.\(affiliate.teamId)")
                .id(affiliate.teamId)
            } else {
                Text("Choose an affiliate").foregroundStyle(.readableSecondary)
            }
        }
    }
}

/// One club in the organization's diagram: a node on the rail that runs from the major-league club down, its level and
/// league, its two readings as pills (their words served; the symbol beside each colour), and its active list.
struct ClubNode: View {
    let club: Components.Schemas.FarmClubStep
    let first: Bool
    let last: Bool
    var chosen = false

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            // The rail: a line through every club, a node at each; the major-league club's node filled
            ZStack(alignment: .top) {
                VStack(spacing: 0) {
                    Rectangle().fill(first ? .clear : Color.readableSecondary.opacity(0.45)).frame(width: 2, height: 10)
                    Rectangle().fill(last ? .clear : Color.readableSecondary.opacity(0.45)).frame(width: 2)
                }
                Circle()
                    .strokeBorder(Color.readableSecondary, lineWidth: 2)
                    .background(Circle().fill(club.majorLeague ? Color.readableSecondary : Color.clear))
                    .frame(width: 12, height: 12)
                    .padding(.top, 5)
            }
            .frame(width: 14)
            .frame(maxHeight: .infinity)
            .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 4) {
                Text(verbatim: club.name).font(.body.weight(.semibold))
                Text(verbatim: club.levelLine.display)
                    .font(.callout).foregroundStyle(.readableSecondary)
                if club.operational != nil || club.developmental != nil {
                    HStack(spacing: 6) {
                        if let op = club.operational { Pill(op.display, tone: Tone(op.tone)).help(detail: op.hint) }
                        if let dev = club.developmental { Pill(dev.display, tone: Tone(dev.tone)).help(detail: dev.hint) }
                    }
                }
                if let players = club.players {
                    Text(verbatim: players.display).font(.caption).foregroundStyle(.readableSecondary)
                }
            }
            .padding(.vertical, 6)
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(chosen ? [.isSelected, .isButton] : club.majorLeague ? [] : .isButton)
        .accessibilityIdentifier("farm.club.\(club.teamId)")
    }
}

/// One affiliate read twice, its two readings kept apart, then everything behind each.
struct AffiliateDetailContent: View {
    let affiliate: Components.Schemas.FarmAffiliateDetail

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: 14) {
                    Reading(title: "Can the club field a team?", claim: affiliate.operational).frame(minWidth: 240)
                    Reading(title: "Are its players developing?", claim: affiliate.developmental).frame(minWidth: 240)
                }
                VStack(alignment: .leading, spacing: 10) {
                    Reading(title: "Can the club field a team?", claim: affiliate.operational)
                    Reading(title: "Are its players developing?", claim: affiliate.developmental)
                }
            }
            FarmSection("Can the club do its job?") {
                if let empty = affiliate.operationalEmpty {
                    Text(verbatim: empty.display).foregroundStyle(.readableSecondary).fixedSize(horizontal: false, vertical: true)
                }
                ForEach(affiliate.operationalFindings, id: \.id) { FindingView($0) }
                coverTable
                Text(verbatim: affiliate.coverNote.display).font(.callout).foregroundStyle(.readableSecondary).fixedSize(horizontal: false, vertical: true)
                Text(verbatim: affiliate.pitching.display).font(.callout).fixedSize(horizontal: false, vertical: true)
            }
            FarmSection("Are the players here developing?", note: affiliate.assessment) {
                if let empty = affiliate.developmentalEmpty {
                    Text(verbatim: empty.display).foregroundStyle(.readableSecondary)
                }
                ForEach(affiliate.developmentalFindings, id: \.id) { FindingView($0) }
                if !affiliate.concerns.isEmpty {
                    Text("Assignments worth reviewing").font(.headline).padding(.top, 6)
                    concernsTable
                }
            }
            if !affiliate.rosterContext.isEmpty {
                FarmSection("Not counted as ordinary members", note: affiliate.rosterContextNote) {
                    ForEach(affiliate.rosterContext, id: \.playerId) { FarmPlayerName(player: $0) }
                }
            }
            if !affiliate.unknowns.isEmpty {
                FarmSection("Not established") {
                    ForEach(Array(affiliate.unknowns.enumerated()), id: \.offset) { _, line in UnknownLine(cell: line) }
                }
            }
        }
    }

    // The affiliate's short tables are grids in the served order (`PageGrid`): a table never sits in a scroll view

    private var coverTable: some View {
        PageGrid(Text("Can the club do its job?"),
                 columns: [Text("Position"), Text("Graded Cover"), Text("Listed Only"), Text("Strong")],
                 rows: affiliate.cover) { row in
            [AnyView(GridCell(row.cells.position).fontWeight(.semibold)), AnyView(GridCell(row.cells.graded).monospacedDigit()),
             AnyView(GridCell(row.cells.listedOnly).monospacedDigit()), AnyView(GridCell(row.cells.strong).monospacedDigit())]
        }
        .accessibilityIdentifier("farm.affiliate.cover")
    }

    private var concernsTable: some View {
        PageGrid(Text("Assignments worth reviewing"),
                 columns: [Text("Player"), Text("Age"), Text("What the Level Is Doing"), Text("Whose Question"), Text("Where It Leaves Him")],
                 rows: affiliate.concerns) { row in
            [AnyView(GridCell(row.cells.player).farmPlayer(id: row.playerId, name: row.cells.player.display, open: row.open)),
             AnyView(GridCell(row.cells.age).monospacedDigit()), AnyView(GridCell(row.cells.verdict)),
             AnyView(GridCell(row.cells.question, secondary: true)), AnyView(GridCell(row.cells.summary))]
        }
        .accessibilityIdentifier("farm.affiliate.concerns")
    }
}

/// One of a club's two readings: the question it answers (structural), the served state with its basis a click away.
struct Reading: View {
    let title: LocalizedStringResource
    let claim: Components.Schemas.Claim

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: 6) {
                Text(title).font(.callout).foregroundStyle(.readableSecondary)
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    ToneMark(served: claim.tone)
                    ClaimText(claim, edge: .bottom) {
                        Text(verbatim: claim.text).font(.title3.weight(.semibold))
                    }
                }
            }
        }
        .accessibilityElement(children: .contain)
    }
}
