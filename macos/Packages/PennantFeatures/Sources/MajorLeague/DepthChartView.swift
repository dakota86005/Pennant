import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

/// Depth Chart (N9): one of the organization's clubs at a time, its players at each position deepest first as the
/// scouts grade them now. Drawn in the V2 roster diagram's flat field language (D-069): the eight fielders' positions
/// on the field and the designated hitter by the dugout, each a plate listing its depth, with the starters and the
/// relievers in two columns beside it, which reads a club's depth at a glance where React's grid of every club at every
/// position needed scrolling both ways. On a narrow column the positions stack as cards, in the same served order.
struct DepthChartView: View {
    @Environment(AppModel.self) private var model
    @State private var team: Int?

    var body: some View {
        let store = model.clubhouse
        ViewState(payload: store.depth, problem: store.problems["depth"]) { view in
            let club = view.clubs.first { $0.teamId == team } ?? view.clubs.first
            Page {
                VStack(alignment: .leading, spacing: 12) {
                    ViewHead(title: Text(verbatim: view.title.display), lede: view.lede, yardsticks: nil, refreshing: model.clubhouseUpdating("depth"))
                    if view.clubs.count > 1, let club {
                        ChoicePopover(
                            current: club.title.display,
                            choices: view.clubs.map { ($0.title.display, $0.level.display, $0.teamId == club.teamId) },
                            id: "depthChart.club"
                        ) { team = view.clubs[$0].teamId }
                    }
                    ClaimLine(view.note, font: .callout)
                    if let empty = view.empty { Text(verbatim: empty.display).foregroundStyle(.readableSecondary) }
                }
                if let club { DepthClubView(club: club).id(club.teamId) }
            }
        }
        .task(id: model.storeKey) { await store.loadDepth(client: model.client, key: model.storeKey) }
    }
}

/// One club's depth: the field and its pitchers where there is room, the positions as cards where there is not.
struct DepthClubView: View {
    let club: Components.Schemas.MlbDepthClub

    private var fielders: [Components.Schemas.MlbDepthPosition] { club.positions.filter { !["SP", "RP"].contains($0.id) } }
    private var pitchers: [Components.Schemas.MlbDepthPosition] { club.positions.filter { ["SP", "RP"].contains($0.id) } }

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: 18) {
                DepthField(positions: fielders).frame(width: 720, height: 560)
                VStack(alignment: .leading, spacing: 14) {
                    ForEach(pitchers, id: \.id) { position in Card { DepthList(position: position) } }
                }
                .frame(width: 250)
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), spacing: 12, alignment: .top)], alignment: .leading, spacing: 12) {
                ForEach(club.positions, id: \.id) { position in Card { DepthList(position: position) } }
            }
            // Named for VoiceOver (the audit found a lazy grid's container unnamed)
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text("Positions"))
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("depthChart.club")
    }
}

/// The field in the roster diagram's language: the pack's tonal field and lines, a node at each position, and a plate
/// beside it with the position's depth. The geometry is PennantDesign's (`FieldGeometry`), the words all served.
struct DepthField: View {
    let positions: [Components.Schemas.MlbDepthPosition]
    @Environment(\.theme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @EffectiveContrast private var contrast

    var body: some View {
        let palette = theme.palette(colorScheme: colorScheme, contrast: contrast)
        let accent = palette.isNeutral ? Color.accentColor : palette.accent
        GeometryReader { proxy in
            let g = FieldGeometry(size: proxy.size)
            ZStack {
                FlatField()
                Canvas { ctx, _ in
                    for position in positions {
                        var path = Path(); path.move(to: g.spot(position.id)); path.addLine(to: g.plate(position.id))
                        ctx.stroke(path, with: .color(accent.opacity(0.5)), lineWidth: 1)
                    }
                }
                .accessibilityHidden(true)
                ForEach(positions, id: \.id) { position in FieldNode(need: false).position(g.spot(position.id)) }
                ForEach(positions, id: \.id) { position in
                    DepthPlate(position: position).position(g.plate(position.id))
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Depth Chart"))
        .accessibilityIdentifier("depthChart.field")
    }
}

/// A position's plate on the field: its badge and its first three men, deepest first, and the served count of the rest.
struct DepthPlate: View {
    let position: Components.Schemas.MlbDepthPosition
    @State private var showsAll = false
    @Environment(\.theme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @EffectiveContrast private var contrast

    var body: some View {
        let palette = theme.palette(colorScheme: colorScheme, contrast: contrast)
        let accent = palette.isNeutral ? Color.accentColor : palette.accent
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 6) {
                Text(verbatim: position.id).font(.system(size: 10, weight: .bold)).foregroundStyle(palette.badgeText)
                    .lineLimit(1).fixedSize()
                    .padding(.horizontal, 4).padding(.vertical, 1)
                    .background(palette.badgeFill, in: .rect(cornerRadius: 3))
                    .accessibilityLabel(Text(verbatim: position.title.display))
                if let empty = position.empty { Text(verbatim: empty.display).font(.caption).foregroundStyle(.readableSecondary) }
            }
            ForEach(Array(position.players.prefix(3).enumerated()), id: \.offset) { _, entry in
                DepthEntryLine(entry: entry, font: .system(size: 12, weight: .semibold))
            }
            if let more = position.more {
                // The rest of the position, a click away: the whole depth in a popover
                Button { showsAll = true } label: { Text(verbatim: more.display).font(.caption) }
                    .buttonStyle(.link)
                    .help(detail: more.hint)
                    .popover(isPresented: $showsAll, arrowEdge: .trailing) {
                        DepthList(position: position).padding(14).frame(minWidth: 240).background(Color.readablePage)
                    }
                    .accessibilityIdentifier("depth.\(position.id).more")
            }
        }
        .padding(.horizontal, 9).padding(.vertical, 7)
        .frame(width: 184, alignment: .leading)
        .background(Color.readablePage, in: .rect(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(accent.opacity(0.25), lineWidth: contrast == .increased ? 1.5 : 1))
        .shadow(color: .black.opacity(0.06), radius: 4, y: 1)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("depth.\(position.id)")
    }
}

/// A position's depth as a list (the pitchers beside the field, every position on a narrow column).
struct DepthList: View {
    let position: Components.Schemas.MlbDepthPosition

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(verbatim: position.title.display).font(.headline).accessibilityAddTraits(.isHeader)
            if let empty = position.empty { Text(verbatim: empty.display).font(.callout).foregroundStyle(.readableSecondary) }
            ForEach(Array(position.players.enumerated()), id: \.offset) { _, entry in
                DepthEntryLine(entry: entry, font: .callout.weight(.medium))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("depth.list.\(position.id)")
    }
}

/// One man at a position: his name (which opens his club, follows and drags as him) and his served line.
struct DepthEntryLine: View {
    let entry: Components.Schemas.MlbDepthEntry
    let font: Font

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            PlayerNameText(player: entry.player, font: font).lineLimit(1).truncationMode(.tail).layoutPriority(-1)
            // In the label colour at the footnote size: the secondary colour at the caption size was read by the audit
            // as only nearly passing, though its pixels read at 7.7:1; the name's weight keeps the order of the two
            Text(verbatim: entry.line.display).font(.footnote).monospacedDigit().foregroundStyle(.primary)
                .lineLimit(1).fixedSize()
                .help(detail: entry.line.hint)
        }
    }
}
