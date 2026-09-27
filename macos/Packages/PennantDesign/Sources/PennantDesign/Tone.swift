import PennantAPI
import SwiftUI

/// A served tone (`Claim.tone`, `Cell.tone`) as the app draws it (SWIFTUI_REBUILD.md section 3.7): a system colour
/// that follows the appearance and Increase Contrast, and a symbol with a different shape for each, so colour is
/// never the only signal. The served words beside it say the same thing to VoiceOver.
nonisolated public enum Tone: Sendable, Hashable, CaseIterable {
    case good, bad, caution, neutral, unknown

    /// The served tone; a tone this build does not know, or none, reads neutral.
    public init(_ served: Components.Schemas.Tone?) {
        switch served?.value1 {
        case .good: self = .good
        case .bad: self = .bad
        case .caution: self = .caution
        case .unknown: self = .unknown
        case .neutral, nil: self = .neutral
        }
    }

    public var color: Color {
        switch self {
        case .good: Color(nsColor: .systemGreen)
        case .bad: Color(nsColor: .systemRed)
        case .caution: Color(nsColor: .systemOrange)
        case .neutral: Color(nsColor: .secondaryLabelColor)
        case .unknown: Color(nsColor: .tertiaryLabelColor)
        }
    }

    /// The symbol drawn beside a line of this tone: a distinct shape for each tone.
    public var symbol: String {
        switch self {
        case .good: "checkmark.circle.fill"
        case .bad: "exclamationmark.circle.fill"
        case .caution: "exclamationmark.triangle.fill"
        case .unknown: "questionmark.circle"
        case .neutral: "eye.fill"
        }
    }
}

/// The symbol beside a served line, from its served tone. Decorative: the served words beside it say the same thing.
public struct ToneMark: View {
    let tone: Tone

    public init(_ tone: Tone) {
        self.tone = tone
    }

    public init(served: Components.Schemas.Tone?) {
        tone = Tone(served)
    }

    public var body: some View {
        Image(systemName: tone.symbol)
            .foregroundStyle(tone.color)
            .accessibilityHidden(true)
    }
}
