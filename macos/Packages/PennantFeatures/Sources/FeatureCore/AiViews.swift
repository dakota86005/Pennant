import Observation
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

// The pieces every AI surface draws (N13, D-074): AI-written text in the server's markdown subset, its links opening only
// what the server listed; the served marking that it is written by AI and decides nothing; and "Ask Staff About Him".
// Nothing here writes a word or reads the AI's prose for names.

/// AI-written text as served: the markdown subset through `AttributedString`, selectable, its links opening the player's
/// or the club's window when the server listed them for this text. Any other URL is never opened, not even a web page.
public struct AiTextView: View {
    let text: Components.Schemas.AiText
    let font: Font
    @Environment(\.openWindow) private var openWindow

    public init(_ text: Components.Schemas.AiText, font: Font = .body) {
        self.text = text
        self.font = font
    }

    public var body: some View {
        let links = text.links
        Text(AiTextRendering.attributed(text.markdown, links: links))
            .font(font)
            .foregroundStyle(.primary)
            .textSelection(.enabled)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .environment(\.openURL, OpenURLAction { url in
                switch AiTextRendering.destination(of: url, in: links) {
                case .player(let id)?: openWindow(value: PlayerRef(id: id))
                case .club(let id)?: openWindow(value: ClubRef(id: id))
                case nil: break
                }
                // Handled either way: an unlisted URL is dropped, never passed to the system
                return .handled
            })
    }
}

/// Text still streaming in: the same subset, with no links (they arrive with the final text).
public struct AiStreamedText: View {
    let markdown: String

    public init(_ markdown: String) {
        self.markdown = markdown
    }

    public var body: some View {
        Text(AiTextRendering.streamed(markdown))
            .foregroundStyle(.primary)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The served marking beside AI text ("Written by AI from Pennant's figures. It decides nothing."): a quiet line with
/// its basis a click away, the sparkle a mark that it is the AI's (never colour alone).
public struct AiMarking: View {
    let claim: Components.Schemas.Claim

    public init(_ claim: Components.Schemas.Claim) {
        self.claim = claim
    }

    public var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 5) {
            Image(systemName: "sparkles").font(.caption).foregroundStyle(.readableSecondary).accessibilityHidden(true)
            ClaimText(claim, edge: .trailing) {
                Text(verbatim: claim.text)
                    .font(.caption)
                    .foregroundStyle(.readableSecondary)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityIdentifier("ai.marking")
    }
}

/// A served claim as a quiet line with its basis a click away (AI off, a status, a failure).
public struct AiClaimLine: View {
    let claim: Components.Schemas.Claim
    let font: Font

    public init(_ claim: Components.Schemas.Claim, font: Font = .callout) {
        self.claim = claim
        self.font = font
    }

    public var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 5) {
            ToneSymbol(tone: claim.tone)
            ClaimText(claim, edge: .trailing) {
                Text(verbatim: claim.text)
                    .font(font)
                    .foregroundStyle(.primary)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

// MARK: Asking the Staff room about a player

/// Where "Ask Staff About Him" sends a player: the Staff room window, which takes him once and asks the server to word
/// the question.
@Observable @MainActor
public final class StaffRoomRouter {
    public static let shared = StaffRoomRouter()

    /// The player handed to the room, until it takes him.
    public private(set) var pending: PlayerRef?

    public init() {}

    /// Hands a player to the room and brings it forward.
    public func ask(about player: PlayerRef, open: () -> Void) {
        pending = player
        open()
    }

    /// The player handed over, taken once.
    public func take() -> PlayerRef? {
        defer { pending = nil }
        return pending
    }
}

/// "Ask Staff About Him" for a player, in a context menu or the Player menu.
public struct AskStaffMenuItem: View {
    let player: PlayerRef
    @Environment(\.openWindow) private var openWindow

    public init(_ player: PlayerRef) {
        self.player = player
    }

    public var body: some View {
        Button("Ask Staff About Him", systemImage: "bubble.left.and.text.bubble.right") {
            StaffRoomRouter.shared.ask(about: player) { openWindow(id: SceneID.staff) }
        }
    }
}
