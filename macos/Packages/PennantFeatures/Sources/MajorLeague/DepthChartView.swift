import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

/// Depth Chart (N9): the organization's depth two ways, chosen in the head and remembered by the window.
///
/// - **By Position** (N9 review, the React page's main use): one position across every level in a native table, the
///   clubs from the major league club down and each club's men deepest first, so who is behind a man reads straight
///   down; sorted by served keys like any table, his row's detail beneath.
/// - **By Club**: one of the organization's clubs at a time, drawn in the V2 roster diagram's flat field language
///   (D-069): the eight fielders' positions on the field and the designated hitter by the dugout, each a plate listing
///   its depth, with the starters and the relievers in two columns beside it. On a narrow column the positions stack as
///   cards, in the same served order.
struct DepthChartView: View {
    @Environment(AppModel.self) private var model
    @State private var team: Int?
    @SceneStorage private var byClub: Bool
    @SceneStorage("depthChart.position") private var position = ""

    /// - Parameter byClub: the way it opens until the window remembers the GM's (by position, unless a test asks).
    init(byClub: Bool = false) {
        _byClub = SceneStorage(wrappedValue: byClub, "depthChart.byClub")
    }

    var body: some View {
        let store = model.clubhouse
        ViewState(payload: store.depth, problem: store.problems["depth"]) { view in
            if byClub || view.byPosition.isEmpty {
                clubPage(view)
            } else {
                positionPane(view)
            }
        }
        .task(id: model.storeKey) { await store.loadDepth(client: model.client, key: model.storeKey) }
    }

    /// The two ways of reading the depth, as a segmented choice.
    private var mode: some View {
        Picker(selection: $byClub) {
            Text("By Position").tag(false)
            Text("By Club").tag(true)
        } label: {
            Text("Show")
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .fixedSize()
        .accessibilityIdentifier("depthChart.mode")
    }

    private func positionPane(_ view: Components.Schemas.MlbDepthChartView) -> some View {
        let index = view.byPosition.firstIndex { $0.id == position } ?? 0
        let shown = view.byPosition[index]
        return ServedTablePane(shown.table, id: "depthChart.\(shown.id)", name: shown.title.display) {
            VStack(alignment: .leading, spacing: 12) {
                ViewHead(title: Text(verbatim: view.title.display), lede: view.lede, yardsticks: nil, refreshing: model.clubhouseUpdating("depth"))
                HStack(spacing: 12) {
                    mode
                    ChoicePopover(
                        Text("Position"),
                        current: Text(verbatim: shown.title.display),
                        choices: view.byPosition.map { .init(verbatim: $0.title.display, hint: $0.summary?.display, selected: $0.id == shown.id) },
                        id: "depthChart.position"
                    ) { position = view.byPosition[$0].id }
                }
                ClaimLine(view.note, font: .callout)
            }
        } notes: {
            EmptyView()
        }
        .id(shown.id)
    }

    private func clubPage(_ view: Components.Schemas.MlbDepthChartView) -> some View {
        let club = view.clubs.first { $0.teamId == team } ?? view.clubs.first
        return Page {
            VStack(alignment: .leading, spacing: 12) {
                ViewHead(title: Text(verbatim: view.title.display), lede: view.lede, yardsticks: nil, refreshing: model.clubhouseUpdating("depth"))
                HStack(spacing: 12) {
                    if !view.byPosition.isEmpty { mode }
                    if view.clubs.count > 1, let club {
                        ChoicePopover(
                            Text("Club"),
                            current: Text(verbatim: club.title.display),
                            choices: view.clubs.map { .init(verbatim: $0.title.display, hint: $0.level.display, selected: $0.teamId == club.teamId) },
                            id: "depthChart.club"
                        ) { team = view.clubs[$0].teamId }
                    }
                }
                ClaimLine(view.note, font: .callout)
                if let empty = view.empty { Text(verbatim: empty.display).foregroundStyle(.readableSecondary) }
            }
            if let club { DepthClubView(club: club).id(club.teamId) }
        }
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

/// One man at a position: his name (which opens his window, compares, follows and drags as him), his served line, and
/// the OSA mark beside it when his grades are OSA's view filling in for our scouts (D-067).
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
            if let fill = entry.ratingsFill { RatingFillMark(fill).fixedSize() }
        }
    }
}
