import AppKit
import SwiftUI

/// Secondary text on the content (N6, Stage B2: the accessibility audit on GitHub's runner). The system's secondary
/// label colour is black (or white) at half strength: about 3.9:1 on a white page, and at a non-Retina scale its thin
/// strokes measure near 3:1, so small secondary lines ("Last 15: 2nd", "Through May 5, 2040 · 30 games") failed the
/// contrast audit. This grey keeps the quieter look but reads well past 4.5:1 on the window's own backgrounds, the
/// same ones a pack's accent is checked on (`WINDOW_BACKGROUNDS` in `server/presentation/themePacks.ts`): about 8.5:1 on
/// white and 7.8:1 on a grouped section in light, 8.9:1 on the window in dark (darker than at first, N6 Stage B2 review:
/// at the runner's 1× scale the first grey's thin strokes measured near 4:1); with Increase Contrast it is the label
/// colour itself. It is a system label shade, not a club's colour: a pack's colours stay the pack's.
public extension NSColor {
    nonisolated static let readableSecondaryLabel = NSColor(name: "PennantReadableSecondaryLabel") { appearance in
        switch appearance.bestMatch(from: [.aqua, .darkAqua, .accessibilityHighContrastAqua, .accessibilityHighContrastDarkAqua]) {
        case .accessibilityHighContrastAqua?: .labelColor
        case .accessibilityHighContrastDarkAqua?: .labelColor
        case .darkAqua?: NSColor(srgbRed: 0.74, green: 0.74, blue: 0.74, alpha: 1)
        default: NSColor(srgbRed: 0.30, green: 0.30, blue: 0.30, alpha: 1)
        }
    }
}

public extension ShapeStyle where Self == Color {
    /// Secondary text on the content, readable at 4.5:1 or better (`NSColor.readableSecondaryLabel`).
    static var readableSecondary: Color { Color(nsColor: .readableSecondaryLabel) }
}

// MARK: Fixed, checked fills (N7 review, L5)

/// Fills Pennant draws text on in its own views, each a fixed colour checked against the text it carries (4.5:1 or
/// better, 7:1 with Increase Contrast; `ThemeTests`), never a system background, fill or the system accent: macOS 26
/// draws some system backgrounds differently from 27 (the under-page colour is a mid grey in light on 26), and a yellow
/// or graphite system accent under white words reads well under 3:1.
public extension NSColor {
    /// A page Pennant's own content sits on (a club window, a popover's list): white in light, a near-black in dark.
    nonisolated static let readablePage = NSColor(name: "PennantReadablePage") { appearance in
        switch appearance.bestMatch(from: [.aqua, .darkAqua, .accessibilityHighContrastAqua, .accessibilityHighContrastDarkAqua]) {
        case .darkAqua?, .accessibilityHighContrastDarkAqua?: NSColor(srgbRed: 0.12, green: 0.12, blue: 0.12, alpha: 1)
        default: .white
        }
    }

    /// A chip's fill on the page (a wire entry's other clubs and players): a light grey in light, a dark grey in dark,
    /// under the label colour and the readable secondary grey.
    nonisolated static let readableChipFill = NSColor(name: "PennantReadableChipFill") { appearance in
        switch appearance.bestMatch(from: [.aqua, .darkAqua, .accessibilityHighContrastAqua, .accessibilityHighContrastDarkAqua]) {
        case .darkAqua?, .accessibilityHighContrastDarkAqua?: NSColor(srgbRed: 0.16, green: 0.16, blue: 0.16, alpha: 1)
        default: NSColor(srgbRed: 0.92, green: 0.92, blue: 0.92, alpha: 1)
        }
    }

    /// A heading chip's fill in the system's colours ("Since the export of May 1"), with `readableHeadingText` on it:
    /// the readable secondary grey (the label colour itself with Increase Contrast), never the system accent.
    nonisolated static let readableHeadingFill = NSColor(name: "PennantReadableHeadingFill") { appearance in
        switch appearance.bestMatch(from: [.aqua, .darkAqua, .accessibilityHighContrastAqua, .accessibilityHighContrastDarkAqua]) {
        case .accessibilityHighContrastAqua?: .black
        case .accessibilityHighContrastDarkAqua?: .white
        case .darkAqua?: NSColor(srgbRed: 0.74, green: 0.74, blue: 0.74, alpha: 1)
        default: NSColor(srgbRed: 0.30, green: 0.30, blue: 0.30, alpha: 1)
        }
    }

    /// The words on `readableHeadingFill`: white in light, black in dark.
    nonisolated static let readableHeadingText = NSColor(name: "PennantReadableHeadingText") { appearance in
        switch appearance.bestMatch(from: [.aqua, .darkAqua, .accessibilityHighContrastAqua, .accessibilityHighContrastDarkAqua]) {
        case .darkAqua?, .accessibilityHighContrastDarkAqua?: .black
        default: .white
        }
    }

    /// A caution's words ("Need", a pitcher's note): a dark orange in light, a light orange in dark, checked on the page,
    /// a chip and the window's background (`ThemeTests`): 7:1 or better in both, so Increase Contrast needs no shade of its own. The system orange reads near 2:1 on white, so it stays for
    /// symbols, dots and strokes only, never for text.
    nonisolated static let readableCautionText = NSColor(name: "PennantReadableCautionText") { appearance in
        switch appearance.bestMatch(from: [.aqua, .darkAqua, .accessibilityHighContrastAqua, .accessibilityHighContrastDarkAqua]) {
        case .darkAqua?, .accessibilityHighContrastDarkAqua?: NSColor(srgbRed: 1.0, green: 0.74, blue: 0.40, alpha: 1)
        default: NSColor(srgbRed: 0.50, green: 0.22, blue: 0.0, alpha: 1)
        }
    }

    /// A control's tint where the system draws white words on it (a swipe action): a dark grey in both appearances.
    nonisolated static let readableActionTint = NSColor(name: "PennantReadableActionTint") { appearance in
        switch appearance.bestMatch(from: [.aqua, .darkAqua, .accessibilityHighContrastAqua, .accessibilityHighContrastDarkAqua]) {
        case .accessibilityHighContrastAqua?, .accessibilityHighContrastDarkAqua?: NSColor(srgbRed: 0.15, green: 0.15, blue: 0.15, alpha: 1)
        case .darkAqua?: NSColor(srgbRed: 0.28, green: 0.28, blue: 0.28, alpha: 1)
        default: NSColor(srgbRed: 0.30, green: 0.30, blue: 0.30, alpha: 1)
        }
    }
}

public extension ShapeStyle where Self == Color {
    /// A page Pennant's content sits on (`NSColor.readablePage`).
    static var readablePage: Color { Color(nsColor: .readablePage) }
    /// A chip's fill on the page (`NSColor.readableChipFill`).
    static var readableChipFill: Color { Color(nsColor: .readableChipFill) }
    /// A heading chip's fill and its words (`NSColor.readableHeadingFill`, `.readableHeadingText`).
    static var readableHeadingFill: Color { Color(nsColor: .readableHeadingFill) }
    static var readableHeadingText: Color { Color(nsColor: .readableHeadingText) }
    /// A caution's words (`NSColor.readableCautionText`); the system orange stays for symbols.
    static var readableCaution: Color { Color(nsColor: .readableCautionText) }
    /// A tint under the system's white words (`NSColor.readableActionTint`).
    static var readableActionTint: Color { Color(nsColor: .readableActionTint) }
}
