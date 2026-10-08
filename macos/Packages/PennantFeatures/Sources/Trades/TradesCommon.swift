import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

// The pieces the Trade Desk is drawn from (N12 Track C): a served cell, a player's name, a claim's line, the page. Each
// draws what the server served and nothing more: every word, tone, order and figure is the payload's (D-056).

typealias TradeCell = Components.Schemas.Cell
typealias TradeClaim = Components.Schemas.Claim
typealias TradePlayer = Components.Schemas.MlbPlayer

extension Components.Schemas.MlbPlayer {
    /// His organization's club (Open His Club), when served; his name opens his own window (N11).
    var club: ClubRef? { open?.teamId.map { ClubRef(id: $0) } }
}

/// A served cell as words: in the readable secondary colour when unknown or asked quiet, with its tone's mark when it
/// says something, its help tag on hover.
struct ServedWords: View {
    let cell: TradeCell
    var quiet = false

    init(_ cell: TradeCell, quiet: Bool = false) {
        self.cell = cell
        self.quiet = quiet
    }

    var body: some View {
        let tone = Tone(cell.tone)
        let words = Text(verbatim: cell.display)
            .foregroundStyle(quiet || tone == .unknown ? AnyShapeStyle(.readableSecondary) : AnyShapeStyle(.primary))
            .fixedSize(horizontal: false, vertical: true)
        if cell.tone != nil, tone != .neutral {
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                ToneMark(tone).font(.caption)
                words
            }
            .help(detail: cell.hint)
            // One element that says its words (a group with none has no description)
            .accessibilityElement(children: .combine)
            .accessibilityLabel(Text(verbatim: cell.display))
        } else {
            // Plain words: a text element of their own, its colour the audit reads (a combined group is read as none)
            words.help(detail: cell.hint)
        }
    }
}

/// A served claim as a line: its words with its basis a click away (`ClaimText`), its tone's mark beside it.
struct ClaimWords: View {
    let claim: TradeClaim
    var font: Font = .body
    var quiet = false

    init(_ claim: TradeClaim, font: Font = .body, quiet: Bool = false) {
        self.claim = claim
        self.font = font
        self.quiet = quiet
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 5) {
            if Tone(claim.tone) != .neutral { ToneMark(served: claim.tone).font(.caption) }
            ClaimText(claim, edge: .trailing) {
                Text(verbatim: claim.text)
                    .font(font)
                    .foregroundStyle(quiet || Tone(claim.tone) == .unknown ? AnyShapeStyle(.readableSecondary) : AnyShapeStyle(.primary))
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

/// A player's served name: his window on a double-click or Return, Compare, Follow and Copy Name from its context menu,
/// and a drag (onto the other side of the builder, Compare or Following).
struct TradePlayerName: View {
    let player: TradePlayer
    var font: Font = .body.weight(.semibold)

    var body: some View {
        Text(verbatim: player.name)
            .font(font)
            .playerName(id: player.playerId, name: player.name, opens: player.club)
    }
}

/// A section's served title, as a header.
struct SectionTitle: View {
    let cell: TradeCell

    init(_ cell: TradeCell) {
        self.cell = cell
    }

    var body: some View {
        Text(verbatim: cell.display)
            .font(.title2.weight(.semibold))
            .help(detail: cell.hint)
            .accessibilityAddTraits(.isHeader)
    }
}

/// What a view says while it waits or when the server refused it: the server's sentence, never "Loading" for ever. A
/// failed read shows its problem even when an earlier payload is held: the old one is never drawn as if current (the N8
/// review, M1).
struct TradesState<Payload, Content: View>: View {
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
