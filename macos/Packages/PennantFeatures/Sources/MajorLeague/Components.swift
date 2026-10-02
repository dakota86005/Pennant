import AppKit
import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

// The pieces Major League Ops' views are drawn from (N8): a served cell, a line, a block, a player's name, a table. Each
// draws what the server served and nothing more: every word, tone, order and sort key is the payload's; the only
// ordering here is the unknown-last comparator over the served sort keys (D-056).

typealias MlbCell = Components.Schemas.Cell
typealias MlbLine = Components.Schemas.MlbLine
typealias MlbBlock = Components.Schemas.MlbBlock
typealias MlbPlayer = Components.Schemas.MlbPlayer
typealias MlbAction = Components.Schemas.MlbAction

/// A served cell as words: a chip in its tone when it has one that says something, the secondary style for an
/// unknown, plain text otherwise; its help tag on hover.
struct CellText: View {
    let cell: MlbCell
    var chip = true

    init(_ cell: MlbCell, chip: Bool = true) {
        self.cell = cell
        self.chip = chip
    }

    var body: some View {
        let tone = Tone(cell.tone)
        Group {
            switch tone {
            case .good, .bad, .caution where chip:
                Pill(cell.display, tone: tone)
            case .unknown:
                Text(verbatim: cell.display).foregroundStyle(.readableSecondary)
            default:
                Text(verbatim: cell.display)
            }
        }
        .help(detail: cell.hint)
    }
}

extension Components.Schemas.MlbPlayer {
    /// The club his name opens (his organization's, the nearest view until player windows), when served.
    var club: ClubRef? { open?.teamId.map { ClubRef(id: $0) } }
}

/// A player's served name: opens his club on a double-click or Return, follows and copies from its context menu, and
/// drags as a player (the app's player-name behaviour, `playerName`).
struct PlayerNameText: View {
    let player: MlbPlayer
    var font: Font = .body.weight(.semibold)

    var body: some View {
        Text(verbatim: player.name)
            .font(font)
            .playerName(id: player.playerId, name: player.name, opens: player.club)
    }
}

/// One served line: its chips, its words (quiet in the secondary style), and, when it names one player, his name's
/// behaviour on the whole line; more than one, each name after it.
struct LineView: View {
    let line: MlbLine

    var body: some View {
        let text = Text(verbatim: line.text.display)
            .font(line.quiet ? .callout : .body)
            .foregroundStyle(line.quiet ? Color.readableSecondary : Tone(line.text.tone) == .unknown ? Color.readableSecondary : Color.primary)
            .fixedSize(horizontal: false, vertical: true)
            .help(detail: line.text.hint)
        VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                ForEach(Array(line.chips.enumerated()), id: \.offset) { _, chip in CellText(chip) }
                if line.players.count == 1, let player = line.players.first {
                    text.playerName(id: player.playerId, name: player.name, opens: player.club)
                } else {
                    text
                }
            }
            if line.players.count > 1 {
                HStack(spacing: 10) {
                    ForEach(line.players, id: \.playerId) { player in
                        PlayerNameText(player: player, font: .callout.weight(.medium))
                    }
                }
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// A served block: its title (or the player it is about) and chips, its claims (each with its basis a click away), and
/// its lines; drawn as a disclosure, closed at first, when served collapsed.
struct BlockView: View {
    let block: MlbBlock
    @State private var expanded: Bool

    init(_ block: MlbBlock) {
        self.block = block
        _expanded = State(initialValue: !block.collapsed)
    }

    var body: some View {
        if block.collapsed, block.title != nil || block.player != nil {
            DisclosureGroup(isExpanded: $expanded) {
                content.padding(.top, 4)
            } label: {
                header
            }
        } else {
            VStack(alignment: .leading, spacing: 6) {
                if block.title != nil || block.player != nil || !block.chips.isEmpty { header }
                content
            }
        }
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            if let player = block.player { PlayerNameText(player: player) }
            if let title = block.title {
                Text(verbatim: title.display).font(.headline).help(detail: title.hint)
                    .accessibilityAddTraits(.isHeader)
            }
            ForEach(Array(block.chips.enumerated()), id: \.offset) { _, chip in CellText(chip) }
        }
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 5) {
            ForEach(Array(block.claims.enumerated()), id: \.offset) { _, claim in ClaimLine(claim) }
            ForEach(Array(block.lines.enumerated()), id: \.offset) { _, line in LineView(line: line) }
        }
    }
}

/// A view's served actions (a decision, another view) as buttons; one this build cannot open is left out.
struct ActionButtons: View {
    let actions: [MlbAction]
    @Environment(\.routeOpener) private var opener

    var body: some View {
        let openable = actions.compactMap { action in route(action.open).map { (action, $0) } }.filter { opener?.canOpen($0.1) == true }
        if !openable.isEmpty {
            HStack(spacing: 8) {
                ForEach(Array(openable.enumerated()), id: \.offset) { _, pair in
                    Button { opener?.open(pair.1) } label: {
                        Label { Text(verbatim: pair.0.text.display) } icon: { Image(systemName: "arrow.forward.circle") }
                    }
                    .help(detail: pair.0.text.hint)
                }
            }
            .controlSize(.small)
        }
    }
}

/// A view's head: its served title, the lede (one line, its explanation a click away) and where the yardsticks come
/// from, over the content colour.
struct ViewHead: View {
    let title: Text
    let lede: Components.Schemas.Claim
    let yardsticks: Components.Schemas.Claim?
    var refreshing = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                title
                    .font(.system(size: 30, weight: .bold, design: .serif))
                    .accessibilityAddTraits(.isHeader)
                if refreshing { ProgressView { Text("Refreshing") }.controlSize(.small) }
            }
            ClaimText(lede, edge: .bottom) {
                Text(verbatim: lede.text).font(.title3).foregroundStyle(.primary).multilineTextAlignment(.leading)
            }
            if let yardsticks {
                ClaimText(yardsticks, edge: .bottom) {
                    Label { Text(verbatim: yardsticks.text) } icon: { Image(systemName: "ruler") }
                        .font(.callout).foregroundStyle(.readableSecondary)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// What a view says while it waits or when the server refused it: the server's sentence, never "Loading" for ever. A
/// failed read shows its problem even when an earlier payload is held: the old one is never drawn as if current (the N8
/// review, M1).
struct ViewState<Payload, Content: View>: View {
    let payload: Payload?
    let problem: RequestProblem?
    @ViewBuilder let content: (Payload) -> Content

    var body: some View {
        if let problem {
            ProblemLine(problem).frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let payload {
            content(payload)
        } else {
            ProgressView { Text("Loading") }.frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

/// The page every Major League Ops view is laid on: the content colour, a readable measure, scrolling as one page.
struct Page<Content: View>: View {
    @ViewBuilder let content: () -> Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) { content() }
                .padding(.horizontal, 28).padding(.vertical, 24)
                .frame(maxWidth: 1100, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.readablePage)
    }
}
