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

/// Text still streaming in: the same subset, with no links (they arrive with the final text). The whole text is parsed
/// again at most every `interval`, and once more after the last delta, never on every one: a long answer re-parsed on
/// each delta cost the square of its length (review N13B, L9). `version` says when the text grew (its UTF-8 length,
/// which a Swift string knows without counting).
public struct AiStreamedText: View {
    let markdown: String
    let version: Int
    @State private var shown: AttributedString?
    @State private var parsedAt = ContinuousClock.now - .seconds(1)

    /// How often a growing text is parsed again at most.
    public static let interval: Duration = .milliseconds(100)

    public init(_ markdown: String) {
        self.markdown = markdown
        version = markdown.utf8.count
    }

    public var body: some View {
        Text(shown ?? AiTextRendering.streamed(markdown))
            .foregroundStyle(.primary)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .task(id: version) {
                // A delta sooner than the interval waits out the rest of it; a later one replaces this wait, and parses
                // at once if the interval has passed by then
                let since = ContinuousClock.now - parsedAt
                if since < Self.interval {
                    try? await Task.sleep(for: Self.interval - since)
                    if Task.isCancelled { return }
                }
                shown = AiTextRendering.streamed(markdown)
                parsedAt = .now
            }
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
    /// Whether the line takes the height its wrapping needs (on a page); false keeps it to two lines, for a bar whose
    /// height must not grow with a narrow proposal (the Staff room's compose bar).
    let wraps: Bool

    public init(_ claim: Components.Schemas.Claim, font: Font = .callout, wraps: Bool = true) {
        self.claim = claim
        self.font = font
        self.wraps = wraps
    }

    public var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 5) {
            ToneSymbol(tone: claim.tone)
            ClaimText(claim, edge: .trailing) {
                if wraps {
                    Text(verbatim: claim.text)
                        .font(font)
                        .foregroundStyle(.primary)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    Text(verbatim: claim.text)
                        .font(font)
                        .foregroundStyle(.primary)
                        .multilineTextAlignment(.leading)
                        .lineLimit(2)
                }
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
