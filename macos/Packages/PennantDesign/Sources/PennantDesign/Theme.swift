import AppKit
import PennantAPI
import SwiftUI

/// The theme a club wears (SWIFTUI_REBUILD.md section 3.7, D-061): the served theme pack's colours for each appearance,
/// ready to draw. Every coloured piece (the masthead, the club card, the tinted floating control, chart accents later)
/// reads the theme in the environment (`\.theme`), never a colour of its own.
///
/// The server checks every pack before it serves one (each piece of text on its colour at 4.5:1, 7:1 with Increase
/// Contrast). The app checks again as it draws: an appearance whose served colours do not read (an older or faulty
/// server) is drawn neutral, with the system's own colours, never half-themed. With team colours off (the served
/// `useTeamColors`) or no club served, the whole theme is neutral.
nonisolated public struct Theme: Sendable, Equatable {
    /// The colours one appearance draws: the served pack's, or the system's for a neutral theme.
    public struct Palette: Sendable, Equatable {
        /// Under the toolbar, where macOS writes the window's title.
        public var mastheadTop: Color
        /// The masthead's colours from its leading top to its trailing bottom.
        public var masthead: [Color]
        public var mastheadText: Color
        public var mastheadSecondaryText: Color
        public var accent: Color
        public var accentText: Color
        public var tint: Color
        public var tintText: Color
        public var card: Color
        public var cardText: Color
        /// The system's colours, not a club's: drawn with the system's materials and label colours.
        public var isNeutral: Bool

        /// The system's colours, following the window's appearance: the window's background under the title, a
        /// grouped section's fill for the masthead, the label colours for its text, the system accent.
        public static let neutral = Palette(
            mastheadTop: Color(nsColor: .windowBackgroundColor),
            masthead: [Color(nsColor: .windowBackgroundColor), Color(nsColor: .underPageBackgroundColor)],
            mastheadText: Color(nsColor: .labelColor),
            mastheadSecondaryText: Color(nsColor: .secondaryLabelColor),
            accent: .accentColor,
            accentText: .white,
            tint: .accentColor,
            tintText: .white,
            card: Color(nsColor: .quaternarySystemFill),
            cardText: Color(nsColor: .labelColor),
            isNeutral: true
        )
    }

    /// Which of a pack's four appearances.
    public enum Variant: Sendable, Hashable, CaseIterable {
        case light, dark, lightIncreasedContrast, darkIncreasedContrast

        public init(colorScheme: ColorScheme, contrast: ColorSchemeContrast) {
            switch (colorScheme, contrast) {
            case (.dark, .increased): self = .darkIncreasedContrast
            case (.dark, _): self = .dark
            case (_, .increased): self = .lightIncreasedContrast
            default: self = .light
            }
        }

        /// The contrast every text pair needs in this appearance.
        public var requiredContrast: Double {
            switch self {
            case .light, .dark: 4.5
            case .lightIncreasedContrast, .darkIncreasedContrast: 7
            }
        }
    }

    /// The served pack's id (`club-colors` for the club's own colours); nil for a neutral theme.
    public var packID: String?
    /// The pack's name as served.
    public var name: String?
    /// Where to fetch the logo to draw (the pack's, else the save's), as served; nil when there is none.
    public var logo: String?
    /// Where to fetch the pack's masthead art, as served.
    public var art: String?
    private var palettes: [Variant: Palette]

    /// The neutral theme: the system's colours in every appearance.
    public static let neutral = Theme(packID: nil, name: nil, logo: nil, art: nil, palettes: [:])

    private init(packID: String?, name: String?, logo: String?, art: String?, palettes: [Variant: Palette]) {
        self.packID = packID
        self.name = name
        self.logo = logo
        self.art = art
        self.palettes = palettes
    }

    /// The theme a served pack draws, or the neutral one when there is no pack or the GM turned team colours off. The
    /// logo stays with a neutral theme (it is the club's, not a colour).
    public init(served pack: Components.Schemas.ThemePack?, useTeamColors: Bool) {
        guard let pack else {
            self = .neutral
            return
        }
        let tokens = pack.tokens
        var palettes: [Variant: Palette] = [:]
        if useTeamColors {
            for (variant, served) in [
                (Variant.light, tokens.light), (.dark, tokens.dark),
                (.lightIncreasedContrast, tokens.lightIncreasedContrast), (.darkIncreasedContrast, tokens.darkIncreasedContrast),
            ] {
                if let palette = Self.palette(served, variant: variant) { palettes[variant] = palette }
            }
        }
        self.init(packID: useTeamColors ? pack.id : nil, name: pack.name, logo: pack.logo, art: useTeamColors ? pack.art : nil, palettes: palettes)
    }

    /// The colours to draw in an appearance: the pack's, or the system's when the theme is neutral or that appearance's
    /// served colours do not read.
    public func palette(for variant: Variant) -> Palette {
        palettes[variant] ?? .neutral
    }

    public func palette(colorScheme: ColorScheme, contrast: ColorSchemeContrast) -> Palette {
        palette(for: Variant(colorScheme: colorScheme, contrast: contrast))
    }

    /// Whether an appearance draws the club's colours (false: the system's).
    public func isThemed(_ variant: Variant) -> Bool { palettes[variant] != nil }

    /// One appearance's served colours, or nil when one is not a colour or a text pair does not read at the contrast
    /// the appearance needs (the server's check, held again where the colours are drawn).
    static func palette(_ tokens: Components.Schemas.ThemeTokens, variant: Variant) -> Palette? {
        let needed = variant.requiredContrast
        func rgb(_ hex: String) -> Contrast.RGB? { ServedColor.components(hex) }
        guard let text = rgb(tokens.mastheadText), let secondary = rgb(tokens.mastheadSecondaryText),
              let accent = rgb(tokens.accent), let accentText = rgb(tokens.accentText),
              let tint = rgb(tokens.tint), let tintText = rgb(tokens.tintText),
              let card = rgb(tokens.card), let cardText = rgb(tokens.cardText),
              rgb(tokens.mastheadTop) != nil, !tokens.masthead.isEmpty
        else { return nil }
        let stops = tokens.masthead.compactMap(rgb)
        guard stops.count == tokens.masthead.count else { return nil }
        for textColor in [text, secondary] {
            for (index, stop) in stops.enumerated() {
                guard Contrast.ratio(stop, textColor) >= needed else { return nil }
                if index > 0, Contrast.ratio(Contrast.worstBlend(stops[index - 1], stop, under: textColor), textColor) < needed { return nil }
            }
        }
        guard Contrast.ratio(accent, accentText) >= needed, Contrast.ratio(tint, tintText) >= needed,
              Contrast.ratio(card, cardText) >= needed
        else { return nil }
        func color(_ hex: String) -> Color { ServedColor.color(hex) ?? .clear }
        return Palette(
            mastheadTop: color(tokens.mastheadTop),
            masthead: tokens.masthead.map(color),
            mastheadText: color(tokens.mastheadText),
            mastheadSecondaryText: color(tokens.mastheadSecondaryText),
            accent: color(tokens.accent),
            accentText: color(tokens.accentText),
            tint: color(tokens.tint),
            tintText: color(tokens.tintText),
            card: color(tokens.card),
            cardText: color(tokens.cardText),
            isNeutral: false
        )
    }
}

extension EnvironmentValues {
    /// The theme the current club wears (set by the main window from the served catalog); neutral where none is set.
    @Entry public var theme: Theme = .neutral

    /// Draws the app's own pieces as Increase Contrast does whatever the Mac's setting: set only by a Debug build's UI
    /// tests and window screenshots, and the snapshot tests, so the increased-contrast drawing can be checked without
    /// changing the Mac's accessibility settings. (SwiftUI's own `colorSchemeContrast` is read from the Mac at every
    /// window column, so it cannot be set for a test.)
    @Entry public var forcesIncreasedContrast = false

    /// Draws the app's own pieces as Reduce Transparency does whatever the Mac's setting (tests only, as above; the
    /// system's own glass follows the Mac's setting).
    @Entry public var forcesReduceTransparency = false
}

/// Whether the app's own pieces draw opaque: the Mac's Reduce Transparency, or where a test forces it.
@MainActor
@propertyWrapper
public struct EffectiveReduceTransparency: DynamicProperty {
    @Environment(\.accessibilityReduceTransparency) private var system
    @Environment(\.forcesReduceTransparency) private var forced

    public init() {}

    public var wrappedValue: Bool { forced || system }
}

/// The contrast the app's own pieces draw for: the Mac's (`colorSchemeContrast`), or increased where a test forces it.
@MainActor
@propertyWrapper
public struct EffectiveContrast: DynamicProperty {
    @Environment(\.colorSchemeContrast) private var system
    @Environment(\.forcesIncreasedContrast) private var forced

    public init() {}

    public var wrappedValue: ColorSchemeContrast { forced ? .increased : system }
}

/// WCAG 2's contrast arithmetic on sRGB colours, for drawing only (the served packs were checked the same way).
nonisolated public enum Contrast {
    public typealias RGB = (red: Double, green: Double, blue: Double)

    /// Relative luminance of an sRGB colour.
    public static func luminance(_ c: RGB) -> Double {
        func channel(_ v: Double) -> Double { v <= 0.03928 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4) }
        return 0.2126 * channel(c.red) + 0.7152 * channel(c.green) + 0.0722 * channel(c.blue)
    }

    /// The contrast ratio of two sRGB colours, 1...21.
    public static func ratio(_ a: RGB, _ b: RGB) -> Double {
        let la = luminance(a), lb = luminance(b)
        return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)
    }

    /// The colour of a gradient between two stops nearest its text: under light text each channel's larger value,
    /// under dark text each channel's smaller one (as the server's check reads it).
    public static func worstBlend(_ a: RGB, _ b: RGB, under text: RGB) -> RGB {
        let lighter = luminance(text) > 0.18
        func pick(_ x: Double, _ y: Double) -> Double { lighter ? Swift.max(x, y) : Swift.min(x, y) }
        return (pick(a.red, b.red), pick(a.green, b.green), pick(a.blue, b.blue))
    }
}
