import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

/// Farm & Development ▸ Affiliates (N10): the organization drawn as served, from the major-league club down, each club a
/// node with its two readings (can it field a team, are its players developing; never one state, D-045); the chosen
/// affiliate read in full beside it. A desk item or a link about an affiliate opens it here (the route's subject).
public struct FarmAffiliatesView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.routeSubject) private var subject

    public init() {}

    public var body: some View {
        let farm = model.farm
        FarmLoading(payload: farm.affiliates, problem: farm.affiliates == nil ? farm.problems["affiliates"] : nil) { view in
            AffiliatesSplit(view: view, initial: subject.flatMap(Int.init), updating: farm.isStale("affiliates", for: model.storeKey))
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

    var body: some View {
        HSplitView {
            VStack(alignment: .leading, spacing: 0) {
                Text(verbatim: view.order.display)
                    .font(.callout.weight(.medium)).foregroundStyle(.readableSecondary)
                    .help(detail: view.order.hint)
                    .padding(.horizontal, 14).padding(.top, 12).padding(.bottom, 6)
                List(selection: $selection) {
                    ForEach(Array(view.clubs.enumerated()), id: \.element.teamId) { index, club in
                        ClubNode(club: club, first: index == 0, last: index == view.clubs.count - 1)
                            .tag(club.majorLeague ? nil : Optional(club.teamId))
                            .selectionDisabled(club.majorLeague)
                            .contextMenu {
                                if club.majorLeague, let r = route(club.open), opener?.canOpen(r) ?? false {
                                    Button("Open Report", systemImage: "list.bullet.clipboard") { opener?.open(r) }
                                }
                            }
                    }
                }
                .listStyle(.inset)
                .accessibilityIdentifier("farm.affiliates.clubs")
                if let empty = view.empty {
                    Text(verbatim: empty.display).foregroundStyle(.readableSecondary).padding()
                }
            }
            .frame(minWidth: 200, idealWidth: 280, maxWidth: 380)
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text("Organization"))

            Group {
                if let affiliate = view.affiliates.first(where: { $0.teamId == selection }) {
                    // A pane beside the organization: a plain header rather than the report's masthead, so it gives way
                    // on a narrow window
                    ScrollView {
                        VStack(alignment: .leading, spacing: 20) {
                            VStack(alignment: .leading, spacing: 6) {
                                HStack(spacing: 6) {
                                    Text(verbatim: [view.preparedBy.display, view.asOf.display].joined(separator: " · "))
                                        .font(.caption.weight(.semibold)).textCase(.uppercase).foregroundStyle(.readableSecondary)
                                        .help(detail: view.asOf.hint)
                                    if updating { ProgressView().controlSize(.small).accessibilityLabel(Text("Updating")) }
                                }
                                Text(verbatim: affiliate.name).font(.largeTitle.weight(.bold)).accessibilityAddTraits(.isHeader)
                                Text(verbatim: affiliate.line.display).foregroundStyle(.readableSecondary).fixedSize(horizontal: false, vertical: true)
                            }
                            AffiliateDetailContent(affiliate: affiliate)
                        }
                        .padding(.horizontal, 24).padding(.vertical, 20)
                        .frame(maxWidth: 1000, alignment: .leading)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .id(affiliate.teamId)
                } else {
                    Text("Choose an affiliate").foregroundStyle(.readableSecondary).frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .frame(minWidth: 300, maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

/// One club in the organization's diagram: a node on the rail that runs from the major-league club down, its level and
/// league, its two readings as pills (their words served; the symbol beside each colour), and its active list.
struct ClubNode: View {
    let club: Components.Schemas.FarmClubStep
    let first: Bool
    let last: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            // The rail: a line through every club, a node at each; the major-league club's node filled
            ZStack(alignment: .top) {
                VStack(spacing: 0) {
                    Rectangle().fill(first ? .clear : Color.secondary.opacity(0.45)).frame(width: 2, height: 10)
                    Rectangle().fill(last ? .clear : Color.secondary.opacity(0.45)).frame(width: 2)
                }
                Circle()
                    .strokeBorder(Color.secondary, lineWidth: 2)
                    .background(Circle().fill(club.majorLeague ? Color.secondary : Color.clear))
                    .frame(width: 12, height: 12)
                    .padding(.top, 5)
            }
            .frame(width: 14)
            .frame(maxHeight: .infinity)
            .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 4) {
                Text(verbatim: club.name).font(.body.weight(.semibold))
                Text(verbatim: [club.level.display, club.league?.display].compactMap { $0 }.joined(separator: " · "))
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
        .accessibilityIdentifier("farm.club.\(club.teamId)")
    }
}

/// One affiliate read twice, its two readings kept apart, then everything behind each.
struct AffiliateDetailContent: View {
    let affiliate: Components.Schemas.FarmAffiliateDetail
    @Environment(\.routeOpener) private var opener
    @State private var coverOrder: [ServedColumnSort<Components.Schemas.FarmCoverRow>] = []
    @State private var concernOrder: [ServedColumnSort<Components.Schemas.FarmConcernRow>] = []
    @State private var concernSelection: Set<String> = []

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

    private var coverTable: some View {
        let rows = ServedRows.sorted(affiliate.cover, by: coverOrder)
        return Table(of: Components.Schemas.FarmCoverRow.self, sortOrder: $coverOrder) {
            TableColumn("Position", sortUsing: ServedColumnSort("position") { .served($0.sort.position?.value1, $0.sort.position?.value2) }) {
                CellText($0.cells.position).fontWeight(.semibold)
            }
            TableColumn("Graded Cover", sortUsing: ServedColumnSort("graded") { .served($0.sort.graded?.value1, $0.sort.graded?.value2) }) {
                CellText($0.cells.graded).monospacedDigit()
            }
            TableColumn("Listed Only", sortUsing: ServedColumnSort("listedOnly") { .served($0.sort.listedOnly?.value1, $0.sort.listedOnly?.value2) }) {
                CellText($0.cells.listedOnly).monospacedDigit()
            }
            TableColumn("Strong", sortUsing: ServedColumnSort("strong") { .served($0.sort.strong?.value1, $0.sort.strong?.value2) }) {
                CellText($0.cells.strong).monospacedDigit()
            }
        } rows: {
            ForEach(rows) { TableRow($0) }
        }
        .frame(height: ShortTable.height(rows: rows.count))
        .scrollDisabled(true)
        .accessibilityIdentifier("farm.affiliate.cover")
    }

    private var concernsTable: some View {
        let rows = ServedRows.sorted(affiliate.concerns, by: concernOrder)
        return Table(of: Components.Schemas.FarmConcernRow.self, selection: $concernSelection, sortOrder: $concernOrder) {
            TableColumn("Player", sortUsing: ServedColumnSort("player") { .served($0.sort.player?.value1, $0.sort.player?.value2) }) { CellText($0.cells.player) }
            TableColumn("Age", sortUsing: ServedColumnSort("age") { .served($0.sort.age?.value1, $0.sort.age?.value2) }) { CellText($0.cells.age).monospacedDigit() }
                .width(min: 36, ideal: 44)
            TableColumn("What the Level Is Doing", sortUsing: ServedColumnSort("verdict") { .served($0.sort.verdict?.value1, $0.sort.verdict?.value2) }) {
                CellText($0.cells.verdict)
            }
            TableColumn("Whose Question", sortUsing: ServedColumnSort("question") { .served($0.sort.question?.value1, $0.sort.question?.value2) }) {
                CellText($0.cells.question, secondary: true)
            }
            TableColumn("Where It Leaves Him", sortUsing: ServedColumnSort("summary") { .served($0.sort.summary?.value1, $0.sort.summary?.value2) }) {
                CellText($0.cells.summary).lineLimit(2)
            }
            .width(min: 90, ideal: 320)
        } rows: {
            ForEach(rows) { row in TableRow(row).draggable(PlayerRef(id: row.playerId)) }
        }
        .contextMenu(forSelectionType: String.self) { ids in
            if let row = affiliate.concerns.first(where: { ids.contains($0.id) }) {
                FarmPlayerMenu(id: row.playerId, name: row.cells.player.display, open: row.open)
            }
        } primaryAction: { ids in
            if let row = affiliate.concerns.first(where: { ids.contains($0.id) }) { openServed(row.open, with: opener) }
        }
        .frame(height: ShortTable.height(rows: rows.count, rowHeight: 34))
        .scrollDisabled(true)
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
