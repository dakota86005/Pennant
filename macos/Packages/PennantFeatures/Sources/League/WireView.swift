import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

/// League Office ▸ Wire (D-059; SWIFTUI_REBUILD.md section 3.4, "As built at N7"): every entry since the last export
/// (or this season), with the served filters in the toolbar (a club, a kind, only what the GM follows), the stated order
/// said above the list, each club's name opening its window and each player's name following him, and what the wire
/// cannot show (league news, a log that couldn't be read) in the server's sentences. The order is the server's.
public struct WireView: View {
    @Environment(AppModel.self) private var model
    @State private var query = LeagueStore.WireQuery()

    public init() {}

    struct TaskKey: Hashable {
        let query: LeagueStore.WireQuery
        let key: AppModel.StoreKey?
        let stamp: String?
    }

    public var body: some View {
        let league = model.league
        Group {
            if let wire = league.wire {
                MastheadScrollView {
                    ClubMagazineMasthead(kicker: [wire.since.display], headline: headline(wire)) { EmptyView() }
                } content: {
                    WirePage(wire: wire, problem: league.wireProblem, updating: league.loadingWire)
                        .padding(.horizontal, 28).padding(.top, 24).padding(.bottom, 12)
                        .frame(maxWidth: 980, alignment: .leading)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            } else if let problem = league.wireProblem {
                ProblemLine(problem).padding().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ProgressView { Text("Loading") }.frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .toolbar { WireFilters(query: $query, kinds: league.wire?.kinds ?? [], clubs: model.catalog?.clubs ?? []) }
        // Again when the follow stamp moves (a follow here or anywhere): Following first, so the first look asks once
        .task(id: TaskKey(query: query, key: model.storeKey, stamp: model.following.following?.followStamp)) {
            await model.loadFollowing()
            await model.loadWire(query)
        }
    }

    private func headline(_ wire: Components.Schemas.Wire) -> Text {
        model.servedViewName(department: "league", view: "wire").map { Text(verbatim: $0) } ?? Text(verbatim: wire.title.display)
    }
}

/// The wire's served filters as the toolbar's scope controls: a kind (the served kinds with their counts), a club (the
/// catalog's), only what the GM follows, and since the last export or the whole season.
struct WireFilters: ToolbarContent {
    @Binding var query: LeagueStore.WireQuery
    let kinds: [Components.Schemas.WireKindChoice]
    let clubs: [Components.Schemas.CatalogClub]

    var body: some ToolbarContent {
        ToolbarItemGroup(placement: .primaryAction) {
            Picker(selection: $query.kind) {
                Text("All Kinds").tag(String?.none)
                ForEach(kinds, id: \.name) { kind in
                    let raw = kind.kind.value1?.rawValue ?? kind.kind.value2 ?? kind.name
                    Text(verbatim: [kind.name, String(kind.count)].joined(separator: " · ")).tag(String?.some(raw))
                }
            } label: {
                Label("Kind", systemImage: "line.3.horizontal.decrease.circle")
            }
            .help(Text("Kind"))
            .accessibilityIdentifier("wire.filter.kind")
            Picker(selection: $query.club) {
                Text("All Clubs").tag(Int?.none)
                ForEach(clubs, id: \.teamId) { club in
                    Text(verbatim: club.name).tag(Int?.some(club.teamId))
                }
            } label: {
                Label("Club", systemImage: "building.2")
            }
            .help(Text("Club"))
            .accessibilityIdentifier("wire.filter.club")
            Picker(selection: $query.season) {
                Text("Since the Last Export").tag(false)
                Text("This Season").tag(true)
            } label: {
                Label("Since", systemImage: "calendar")
            }
            .help(Text("Since"))
            .accessibilityIdentifier("wire.filter.since")
            Toggle(isOn: $query.followedOnly) {
                Label("Followed Only", systemImage: "star")
            }
            .help(Text("Followed Only"))
            .accessibilityIdentifier("wire.filter.followed")
        }
    }
}

/// The wire's page: the stated order, then every entry as served, each with the players it names; then the served line
/// for more, and the gaps.
struct WirePage: View {
    let wire: Components.Schemas.Wire
    let problem: RequestProblem?
    let updating: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let problem { ProblemLine(problem) }
            HStack(spacing: 8) {
                Text(verbatim: wire.order.line.display).font(.callout.weight(.medium)).foregroundStyle(.readableSecondary)
                    .help(detail: wire.order.line.hint)
                    .accessibilityIdentifier("wire.order")
                if updating { ProgressView().controlSize(.small).accessibilityLabel(Text("Updating")) }
                Spacer()
            }
            if let empty = wire.empty {
                Text(verbatim: empty.display).foregroundStyle(.readableSecondary).help(detail: empty.hint)
                    .accessibilityIdentifier("wire.empty")
            }
            if !wire.entries.isEmpty {
                RowGroup {
                    ForEach(Array(wire.entries.enumerated()), id: \.element.id) { index, entry in
                        WireEntryRow(entry: entry)
                        if index < wire.entries.count - 1 { Divider() }
                    }
                }
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("wire.entries")
            }
            if let more = wire.more {
                Text(verbatim: more.display).foregroundStyle(.readableSecondary).help(detail: more.hint)
            }
            ForEach(Array(wire.gaps.enumerated()), id: \.offset) { _, gap in
                Label { Text(verbatim: gap.display).fixedSize(horizontal: false, vertical: true) } icon: { ToneMark(served: gap.tone) }
                    .font(.callout)
                    .foregroundStyle(.readableSecondary)
                    .help(detail: gap.hint)
            }
            .accessibilityElement(children: .contain)
        }
    }
}

/// One entry: the design's wire row (its first club's name opens that club's window), and the players it names, each a
/// name the GM can follow or drag onto Following.
struct WireEntryRow: View {
    let entry: Components.Schemas.WireEntry

    var body: some View {
        let item = WireItem(
            id: entry.id, club: entry.clubs.first?.name ?? "", abbreviation: entry.clubs.first?.abbreviation ?? "",
            followed: entry.followed, text: entry.headline.text, when: entry.when.display, claim: entry.headline,
            clubId: entry.clubs.first?.teamId
        )
        VStack(alignment: .leading, spacing: 2) {
            WireRow(item) { name in
                if let id = item.clubId { name.clubName(id: id, name: item.club) } else { name }
            }
            if entry.clubs.count > 1 || !entry.players.isEmpty {
                HStack(spacing: 6) {
                    ForEach(entry.clubs.dropFirst(), id: \.teamId) { club in
                        Text(verbatim: club.name).font(.caption.weight(.medium))
                            .padding(.horizontal, 7).padding(.vertical, 2)
                            .background(Color(nsColor: .quaternarySystemFill), in: .capsule)
                            .clubName(id: club.teamId, name: club.name)
                    }
                    ForEach(entry.players, id: \.playerId) { player in
                        HStack(spacing: 3) {
                            Image(systemName: player.followed ? "star.fill" : "person").font(.caption2).accessibilityHidden(true)
                            Text(verbatim: player.name).font(.caption.weight(.medium))
                        }
                        .padding(.horizontal, 7).padding(.vertical, 2)
                        .background(Color(nsColor: .quaternarySystemFill), in: .capsule)
                        .accessibilityElement(children: .combine)
                        // His club as served (his organization's), never the entry's first club; none served, nothing to open (M3)
                        .playerName(id: player.playerId, name: player.name, opens: clubRef(opening: player.open))
                    }
                }
                .padding(.leading, 40)
                .padding(.bottom, 6)
            }
        }
    }
}
