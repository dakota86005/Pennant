import Foundation
import PennantAPI

/// AI-written text as the app draws it (N13, D-074). The server serves a markdown subset (`AiText`: bold, italic, code,
/// links, lines and "• " items) for `AttributedString(markdown:)` with inline-only syntax, whitespace kept; every link in
/// it is listed beside it with its target. Only those links survive here: a link the server did not list (a model's
/// own `https://…`, a `pennant://` it wrote itself, a `javascript:`) is drawn as its words alone, never as a link, and
/// nothing is opened that the server did not name. Nothing here reads the prose for names.
public enum AiTextRendering {
    /// Where a served link leads.
    public enum Destination: Sendable, Equatable {
        case player(id: Int)
        case club(id: Int)
    }

    static let options = AttributedString.MarkdownParsingOptions(
        allowsExtendedAttributes: false,
        interpretedSyntax: .inlineOnlyPreservingWhitespace,
        failurePolicy: .returnPartiallyParsedIfPossible
    )

    /// The served text with only the server's links kept.
    public static func attributed(_ markdown: String, links: [Components.Schemas.AiLink]) -> AttributedString {
        let listed = Set(links.map(\.url))
        return parsed(markdown) { url in listed.contains(url.absoluteString) }
    }

    /// Text that streamed in, before the final text replaced it: the same subset, with no link at all (links arrive only
    /// with the final text).
    public static func streamed(_ markdown: String) -> AttributedString {
        parsed(markdown) { _ in false }
    }

    /// The served text as plain words, for VoiceOver's announcement of a finished answer and for copying.
    public static func plain(_ markdown: String) -> String {
        String(parsed(markdown) { _ in false }.characters)
    }

    /// Where a link in served text leads: only a link the server listed for this text, to a player or a club; nil for
    /// anything else, which is then never opened.
    public static func destination(of url: URL, in links: [Components.Schemas.AiLink]) -> Destination? {
        guard url.scheme == "pennant", let link = links.first(where: { $0.url == url.absoluteString }) else { return nil }
        switch link.target.kind.value1 {
        case .player: return link.target.playerId.map { .player(id: $0) }
        case .club: return link.target.teamId.map { .club(id: $0) }
        default: return nil
        }
    }

    private static func parsed(_ markdown: String, keeping keep: (URL) -> Bool) -> AttributedString {
        var text = (try? AttributedString(markdown: markdown, options: options)) ?? AttributedString(markdown)
        for run in text.runs {
            guard let url = run.link else { continue }
            if !keep(url) { text[run.range].link = nil }
        }
        return text
    }
}
