import AppKit
import Foundation
import PennantAPI
import SwiftUI
import Testing
@testable import PennantDesign

/// The theme a club wears, resolved from the served packs the real server sent on the synthetic save
/// (`contract/fixtures/`): each appearance's colours, and the neutral theme wherever the club's colours are not to be
/// drawn (team colours off, no pack, or served colours that do not read).
@Suite("Theme")
struct ThemeTests {
    static let responses = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .appending(path: "contract/fixtures/responses")

    static func decode<T: Decodable>(_ type: T.Type, _ name: String) throws -> T {
        try JSONDecoder().decode(type, from: Data(contentsOf: responses.appending(path: "\(name).json")))
    }

    /// The synthetic club's own colours, as the catalog serves them.
    static func clubColors() throws -> Components.Schemas.ThemePack {
        try #require(try decode(Components.Schemas.Catalog.self, "getCatalog").clubs.first?.theme)
    }

    /// The repository's example pack, as the club's choices serve it.
    static func examplePack() throws -> Components.Schemas.ThemePack {
        try #require(try decode(Components.Schemas.ThemeChoices.self, "getThemeChoices").choices.first { $0.id == "sunset-series" })
    }

    @Test("the club's own colours resolve in every appearance")
    func clubColorsResolve() throws {
        let pack = try Self.clubColors()
        #expect(pack.id == "club-colors")
        let theme = Theme(served: pack, useTeamColors: true)
        #expect(theme.packID == "club-colors")
        for variant in Theme.Variant.allCases { #expect(theme.isThemed(variant), "\(variant)") }
        #expect(theme.palette(for: .light) != theme.palette(for: .dark))
        #expect(theme.palette(for: .light).isNeutral == false)
        #expect(theme.palette(for: .dark).masthead.count == pack.tokens.dark.masthead.count)
    }

    @Test("the appearance follows the window's colour scheme and contrast")
    func variants() {
        #expect(Theme.Variant(colorScheme: .light, contrast: .standard) == .light)
        #expect(Theme.Variant(colorScheme: .dark, contrast: .standard) == .dark)
        #expect(Theme.Variant(colorScheme: .light, contrast: .increased) == .lightIncreasedContrast)
        #expect(Theme.Variant(colorScheme: .dark, contrast: .increased) == .darkIncreasedContrast)
        #expect(Theme.Variant.light.requiredContrast == 4.5)
        #expect(Theme.Variant.darkIncreasedContrast.requiredContrast == 7)
    }

    @Test("an installed pack resolves as the club's own colours do, and differs from them")
    func examplePack() throws {
        let theme = Theme(served: try Self.examplePack(), useTeamColors: true)
        #expect(theme.packID == "sunset-series")
        #expect(theme.name == "Sunset Series")
        for variant in Theme.Variant.allCases { #expect(theme.isThemed(variant), "\(variant)") }
        let own = Theme(served: try Self.clubColors(), useTeamColors: true)
        #expect(theme.palette(for: .dark) != own.palette(for: .dark))
    }

    @Test("team colours off, or no pack served, is the neutral theme in every appearance; the logo stays")
    func neutral() throws {
        var pack = try Self.clubColors()
        pack.logo = "/api/logo/1?v=abc"
        let off = Theme(served: pack, useTeamColors: false)
        for variant in Theme.Variant.allCases {
            #expect(!off.isThemed(variant))
            #expect(off.palette(for: variant) == .neutral)
        }
        #expect(off.packID == nil)
        #expect(off.logo == "/api/logo/1?v=abc")
        #expect(Theme(served: nil, useTeamColors: true) == .neutral)
        #expect(Theme.neutral.palette(for: .dark).isNeutral)
    }

    @Test("the neutral masthead's secondary lines read at 4.5:1 or better on its colours, in light and dark (N6 polish review)")
    func neutralSecondaryReads() throws {
        func luminance(_ color: NSColor) -> Double {
            let c = color.usingColorSpace(.sRGB)!
            func channel(_ v: CGFloat) -> Double { let v = Double(v); return v <= 0.03928 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4) }
            return 0.2126 * channel(c.redComponent) + 0.7152 * channel(c.greenComponent) + 0.0722 * channel(c.blueComponent)
        }
        /// The colour as drawn on the background: its own alpha composited over it (the system's secondary label is
        /// the label colour at part strength).
        func contrast(_ text: Color, on background: Color, in name: NSAppearance.Name) -> Double {
            var ratio = 0.0
            NSAppearance(named: name)!.performAsCurrentDrawingAppearance {
                let fg = NSColor(text).usingColorSpace(.sRGB)!
                let bg = NSColor(background).usingColorSpace(.sRGB)!
                let a = fg.alphaComponent
                let drawn = NSColor(srgbRed: fg.redComponent * a + bg.redComponent * (1 - a),
                                    green: fg.greenComponent * a + bg.greenComponent * (1 - a),
                                    blue: fg.blueComponent * a + bg.blueComponent * (1 - a), alpha: 1)
                let (l1, l2) = (luminance(drawn), luminance(bg))
                ratio = (max(l1, l2) + 0.05) / (min(l1, l2) + 0.05)
            }
            return ratio
        }
        let neutral = Theme.Palette.neutral
        for name in [NSAppearance.Name.aqua, .darkAqua] {
            for background in neutral.masthead + [neutral.mastheadTop] {
                let ratio = contrast(neutral.mastheadSecondaryText, on: background, in: name)
                #expect(ratio >= 4.5, "\(name.rawValue): \(ratio)")
            }
        }
    }

    @Test("Pennant's fixed fills read at 4.5:1 or better under their words, 7:1 with Increase Contrast, with any system accent (L5)")
    func readableFills() throws {
        func luminance(_ color: NSColor) -> Double {
            let c = color.usingColorSpace(.sRGB)!
            func channel(_ v: CGFloat) -> Double { let v = Double(v); return v <= 0.03928 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4) }
            return 0.2126 * channel(c.redComponent) + 0.7152 * channel(c.greenComponent) + 0.0722 * channel(c.blueComponent)
        }
        func contrast(_ text: NSColor, on background: NSColor, in name: NSAppearance.Name) -> Double {
            var ratio = 0.0
            NSAppearance(named: name)!.performAsCurrentDrawingAppearance {
                let fg = text.usingColorSpace(.sRGB)!
                let bg = background.usingColorSpace(.sRGB)!
                let a = fg.alphaComponent
                let drawn = NSColor(srgbRed: fg.redComponent * a + bg.redComponent * (1 - a),
                                    green: fg.greenComponent * a + bg.greenComponent * (1 - a),
                                    blue: fg.blueComponent * a + bg.blueComponent * (1 - a), alpha: 1)
                let (l1, l2) = (luminance(drawn), luminance(bg))
                ratio = (max(l1, l2) + 0.05) / (min(l1, l2) + 0.05)
            }
            return ratio
        }
        let appearances: [(NSAppearance.Name, Double)] = [
            (.aqua, 4.5), (.darkAqua, 4.5), (.accessibilityHighContrastAqua, 7), (.accessibilityHighContrastDarkAqua, 7),
        ]
        for (name, needed) in appearances {
            // Text on the page and on a chip: the label colour and the readable secondary grey
            for fill in [NSColor.readablePage, .readableChipFill] {
                for text in [NSColor.labelColor, .readableSecondaryLabel] {
                    let ratio = contrast(text, on: fill, in: name)
                    #expect(ratio >= needed, "\(name.rawValue): \(ratio)")
                }
            }
            // A caution's words ("Need") on the page, a chip and the window's background (the roster plate's), never
            // the system orange
            for fill in [NSColor.readablePage, .readableChipFill, .windowBackgroundColor] {
                let ratio = contrast(.readableCautionText, on: fill, in: name)
                #expect(ratio >= needed, "caution \(name.rawValue): \(ratio)")
            }
            // The heading chip's words on its fill, which no system accent touches
            let heading = contrast(.readableHeadingText, on: .readableHeadingFill, in: name)
            #expect(heading >= needed, "heading \(name.rawValue): \(heading)")
            // A hollow position badge (the roster diagram's "listed" man): the heading fill's colour as words on the page
            // and the window's background (N9 review, M7)
            for fill in [NSColor.readablePage, .windowBackgroundColor] {
                let hollow = contrast(.readableHeadingFill, on: fill, in: name)
                #expect(hollow >= needed, "hollow badge \(name.rawValue): \(hollow)")
            }
            // The system's white words on an action's tint
            let action = contrast(.white, on: .readableActionTint, in: name)
            #expect(action >= needed, "action \(name.rawValue): \(action)")
        }
        // The neutral heading chip no longer draws on the system accent, and neither does a position's badge
        #expect(Theme.Palette.neutral.isNeutral)
        #expect(Theme.Palette.neutral.badgeFill == Color(nsColor: .readableHeadingFill))
        #expect(Theme.Palette.neutral.badgeText == Color(nsColor: .readableHeadingText))
    }

    @Test("an appearance whose served text does not read is drawn neutral, never half-themed; the others keep the club's colours")
    func unreadableAppearance() throws {
        var pack = try Self.clubColors()
        // The dark masthead's text set to its own colour: unreadable
        pack.tokens.dark.mastheadText = pack.tokens.dark.masthead[0]
        let theme = Theme(served: pack, useTeamColors: true)
        #expect(!theme.isThemed(.dark))
        #expect(theme.palette(for: .dark) == .neutral)
        #expect(theme.isThemed(.light))
        #expect(theme.isThemed(.darkIncreasedContrast))
    }

    @Test("a gradient's blend is checked, not only its stops")
    func blend() throws {
        var pack = try Self.clubColors()
        // Green and red each read under white; their channel-wise blend (a yellow) does not
        pack.tokens.light.masthead = ["#008a00", "#d00000"]
        pack.tokens.light.mastheadText = "#ffffff"
        pack.tokens.light.mastheadSecondaryText = "#ffffff"
        #expect(!Theme(served: pack, useTeamColors: true).isThemed(.light))
    }

    @Test("a served token that is not a colour makes its appearance neutral")
    func notAColour() throws {
        var pack = try Self.clubColors()
        pack.tokens.light.card = "navy"
        #expect(!Theme(served: pack, useTeamColors: true).isThemed(.light))
        pack = try Self.clubColors()
        pack.tokens.lightIncreasedContrast.masthead = []
        #expect(!Theme(served: pack, useTeamColors: true).isThemed(.lightIncreasedContrast))
    }

    @Test("Increase Contrast holds the served colours to 7:1")
    func increasedContrastBar() throws {
        var pack = try Self.clubColors()
        // The plain light colours read at 4.5:1 but not 7:1: served as the Increase Contrast ones, they are refused
        pack.tokens.lightIncreasedContrast = pack.tokens.light
        pack.tokens.lightIncreasedContrast.card = "#767676"
        pack.tokens.lightIncreasedContrast.cardText = "#ffffff"
        #expect(Theme.palette(pack.tokens.light, variant: .light) != nil)
        #expect(!Theme(served: pack, useTeamColors: true).isThemed(.lightIncreasedContrast))
    }

    @Test("the Tonight card's words read on its plate, for every club in the synthetic league and the example pack, in every appearance")
    func tonightPlateReads() throws {
        let catalog = try Self.decode(Components.Schemas.Catalog.self, "getCatalog")
        let packs = catalog.clubs.map(\.theme) + [try Self.examplePack()]
        #expect(catalog.clubs.count >= 4)
        for pack in packs {
            let theme = Theme(served: pack, useTeamColors: true)
            for (variant, tokens) in [
                (Theme.Variant.light, pack.tokens.light), (.dark, pack.tokens.dark),
                (.lightIncreasedContrast, pack.tokens.lightIncreasedContrast), (.darkIncreasedContrast, pack.tokens.darkIncreasedContrast),
            ] {
                let plate = try #require(Theme.controlPlate(tokens).flatMap(ServedColor.components))
                for text in [tokens.mastheadText, tokens.mastheadSecondaryText] {
                    let ratio = Contrast.ratio(plate, try #require(ServedColor.components(text)))
                    #expect(ratio >= variant.requiredContrast, "\(pack.id) \(variant): \(text) on the plate reads \(ratio)")
                }
                // The plate the card draws is that served colour
                #expect(theme.palette(for: variant).controlPlate == ServedColor.color(Theme.controlPlate(tokens)!))
            }
        }
    }

    @Test("the contrast ratio is WCAG's: black on white is 21:1, a colour on itself 1:1")
    func contrastRatio() {
        #expect(abs(Contrast.ratio((0, 0, 0), (1, 1, 1)) - 21) < 0.001)
        #expect(abs(Contrast.ratio((0.5, 0.2, 0.1), (0.5, 0.2, 0.1)) - 1) < 0.001)
    }
}
