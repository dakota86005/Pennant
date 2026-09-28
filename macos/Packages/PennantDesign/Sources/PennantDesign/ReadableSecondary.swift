import AppKit
import SwiftUI

/// Secondary text on the content (N6, Stage B2: the accessibility audit on GitHub's runner). The system's secondary
/// label colour is black (or white) at half strength: about 3.9:1 on a white page, and at a non-Retina scale its thin
/// strokes measure near 3:1, so small secondary lines ("Last 15: 2nd", "Through May 5, 2040 · 30 games") failed the
/// contrast audit. This grey keeps the quieter look but reads at 4.5:1 or better on the window's own backgrounds, the
/// same ones a pack's accent is checked on (`WINDOW_BACKGROUNDS` in `server/presentation/themePacks.ts`): 6.6:1 on
/// white and 5.6:1 on a grouped section in light, 8.2:1 and 6.4:1 in dark; with Increase Contrast it is the label colour
/// itself. It is a system label shade, not a club's colour: a pack's colours stay the pack's.
public extension NSColor {
    static let readableSecondaryLabel = NSColor(name: "PennantReadableSecondaryLabel") { appearance in
        switch appearance.bestMatch(from: [.aqua, .darkAqua, .accessibilityHighContrastAqua, .accessibilityHighContrastDarkAqua]) {
        case .accessibilityHighContrastAqua?: .labelColor
        case .accessibilityHighContrastDarkAqua?: .labelColor
        case .darkAqua?: NSColor(srgbRed: 0.68, green: 0.68, blue: 0.68, alpha: 1)
        default: NSColor(srgbRed: 0.36, green: 0.36, blue: 0.36, alpha: 1)
        }
    }
}

public extension ShapeStyle where Self == Color {
    /// Secondary text on the content, readable at 4.5:1 or better (`NSColor.readableSecondaryLabel`).
    static var readableSecondary: Color { Color(nsColor: .readableSecondaryLabel) }
}
