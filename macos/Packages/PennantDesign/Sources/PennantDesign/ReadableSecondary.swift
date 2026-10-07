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

    /// A range chart's mark (the Trade Desk's difference: the most likely point or stretch, and at a quarter strength the
    /// range behind it), never the system accent, whose graphite or yellow washes out on the page: a fixed blue, checked
    /// at 3:1 or better against the page and the window (4.5:1 with Increase Contrast; `ThemeTests`).
    nonisolated static let readableRangeMark = NSColor(name: "PennantReadableRangeMark") { appearance in
        switch appearance.bestMatch(from: [.aqua, .darkAqua, .accessibilityHighContrastAqua, .accessibilityHighContrastDarkAqua]) {
        case .accessibilityHighContrastAqua?: NSColor(srgbRed: 0.05, green: 0.24, blue: 0.52, alpha: 1)
        case .accessibilityHighContrastDarkAqua?: NSColor(srgbRed: 0.62, green: 0.80, blue: 1.0, alpha: 1)
        case .darkAqua?: NSColor(srgbRed: 0.50, green: 0.70, blue: 0.95, alpha: 1)
        default: NSColor(srgbRed: 0.12, green: 0.36, blue: 0.69, alpha: 1)
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

// MARK: Fixed, checked chart marks (N12 Track B review, M7)

/// A season chart's marks (Franchise History's wins by season): each a fixed colour, never the system accent (a green
/// accent read as titles) or a system background, checked at 3:1 or better as a graphic on the page and the window's
/// background, 4.5:1 with Increase Contrast (`ThemeTests`). Colour is never the only signal: a title carries a diamond, a
/// playoff season a dot, and a season whose ending isn't known is drawn hollow.
public extension NSColor {
    /// A title season: a deep gold in light, a light gold in dark.
    nonisolated static let readableChartTitle = NSColor(name: "PennantReadableChartTitle") { appearance in
        switch appearance.bestMatch(from: [.aqua, .darkAqua, .accessibilityHighContrastAqua, .accessibilityHighContrastDarkAqua]) {
        case .accessibilityHighContrastAqua?: NSColor(srgbRed: 0.40, green: 0.28, blue: 0.0, alpha: 1)
        case .accessibilityHighContrastDarkAqua?: NSColor(srgbRed: 1.0, green: 0.86, blue: 0.48, alpha: 1)
        case .darkAqua?: NSColor(srgbRed: 0.95, green: 0.78, blue: 0.30, alpha: 1)
        default: NSColor(srgbRed: 0.55, green: 0.40, blue: 0.0, alpha: 1)
        }
    }
    /// A playoff season: a deep blue in light, a light blue in dark.
    nonisolated static let readableChartPlayoffs = NSColor(name: "PennantReadableChartPlayoffs") { appearance in
        switch appearance.bestMatch(from: [.aqua, .darkAqua, .accessibilityHighContrastAqua, .accessibilityHighContrastDarkAqua]) {
        case .accessibilityHighContrastAqua?: NSColor(srgbRed: 0.04, green: 0.24, blue: 0.58, alpha: 1)
        case .accessibilityHighContrastDarkAqua?: NSColor(srgbRed: 0.62, green: 0.80, blue: 1.0, alpha: 1)
        case .darkAqua?: NSColor(srgbRed: 0.45, green: 0.68, blue: 1.0, alpha: 1)
        default: NSColor(srgbRed: 0.10, green: 0.35, blue: 0.75, alpha: 1)
        }
    }
    /// A season that missed the playoffs: a mid grey (darker with Increase Contrast).
    nonisolated static let readableChartOther = NSColor(name: "PennantReadableChartOther") { appearance in
        switch appearance.bestMatch(from: [.aqua, .darkAqua, .accessibilityHighContrastAqua, .accessibilityHighContrastDarkAqua]) {
        case .accessibilityHighContrastAqua?: NSColor(srgbRed: 0.36, green: 0.36, blue: 0.36, alpha: 1)
        case .accessibilityHighContrastDarkAqua?: NSColor(srgbRed: 0.70, green: 0.70, blue: 0.70, alpha: 1)
        case .darkAqua?: NSColor(srgbRed: 0.64, green: 0.64, blue: 0.64, alpha: 1)
        default: NSColor(srgbRed: 0.45, green: 0.45, blue: 0.45, alpha: 1)
        }
    }
}

public extension ShapeStyle where Self == Color {
    /// A season chart's marks (`NSColor.readableChartTitle`, `.readableChartPlayoffs`, `.readableChartOther`); a season
    /// whose ending isn't known is outlined in the readable secondary grey, never filled.
    static var readableChartTitle: Color { Color(nsColor: .readableChartTitle) }
    static var readableChartPlayoffs: Color { Color(nsColor: .readableChartPlayoffs) }
    static var readableChartOther: Color { Color(nsColor: .readableChartOther) }
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
    /// A range chart's mark, and its range at a quarter strength (`NSColor.readableRangeMark`).
    static var readableRangeMark: Color { Color(nsColor: .readableRangeMark) }
}
