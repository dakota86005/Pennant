import PennantAPI
import SwiftUI

/// The symbol beside a served line, from its served tone: a different shape for each tone, so colour is never the only
/// signal (SWIFTUI_REBUILD.md section 2). Decorative: the served words beside it say the same thing to VoiceOver.
/// (The design system's tone colours arrive with N5; this is the shell's stand-in until then.)
public struct ToneSymbol: View {
    let tone: Components.Schemas.Tone?

    public init(tone: Components.Schemas.Tone?) {
        self.tone = tone
    }

    public var body: some View {
        let (name, style): (String, Color) = switch tone?.value1 {
        case .good: ("checkmark.circle.fill", .green)
        case .bad: ("exclamationmark.octagon.fill", .red)
        case .caution: ("exclamationmark.triangle.fill", .orange)
        case .unknown: ("questionmark.circle", .secondary)
        case .neutral, nil: ("circle", .secondary)
        }
        Image(systemName: name)
            .foregroundStyle(style)
            .accessibilityHidden(true)
    }
}
