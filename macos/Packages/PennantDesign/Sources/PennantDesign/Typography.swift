import PennantAPI
import SwiftUI

// The magazine typography (SWIFTUI_REBUILD.md section 3.7, "Design language"): New York at display sizes for the
// headline and the section titles, small-caps kickers and labels, a deck under the headline, box-score figures in
// condensed tabular SF, and thin rules. The type scale: headline 62, section title 28, deck 20, box figure 40, kicker
// caption semibold spaced 1.2, small-caps label caption2 semibold spaced 0.8.

/// A kicker or a small-caps label: uppercase, spaced, semibold.
public struct Kicker: View {
    public enum Size: Sendable { case regular, small }
    let text: Text
    let size: Size

    public init(_ key: LocalizedStringKey, size: Size = .regular) {
        text = Text(key)
        self.size = size
    }

    /// A served kicker, its parts joined with a middle dot ("Bay City Admirals · July 14, 2041 · Through July 13"),
    /// and a status after them while the caller has one: a structural word already looked up in the String Catalog
    /// ("Updating") or a served line ("Updated to May 6, 2040"). One string, one `Text`: no concatenated `Text`s.
    public init(served parts: [String?], status: String? = nil, size: Size = .regular) {
        let all = parts + [status]
        text = Text(verbatim: all.compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
        self.size = size
    }

    public init(_ served: String, size: Size = .regular) {
        text = Text(verbatim: served)
        self.size = size
    }

    public var body: some View {
        text
            .font(size == .regular ? .caption.weight(.semibold) : .caption2.weight(.semibold))
            .kerning(size == .regular ? 1.2 : 0.8)
            .textCase(.uppercase)
            .lineLimit(1)
    }
}

/// A section heading set like a magazine: a kicker in small caps in the club's accent, a serif title, a trailing note
/// and a thin rule. The kicker and the title are structural or served, as the caller says.
public struct MagazineSection: View {
    let kicker: Text?
    let title: Text
    let trailing: String?
    let trailingHint: String?
    @Environment(\.theme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @EffectiveContrast private var contrast

    /// - Parameter trailingHint: the trailing note's served help tag; nil draws none.
    public init(kicker: Text? = nil, title: Text, trailing: String? = nil, trailingHint: String? = nil) {
        self.kicker = kicker
        self.title = title
        self.trailing = trailing
        self.trailingHint = trailingHint
    }

    public var body: some View {
        let palette = theme.palette(colorScheme: colorScheme, contrast: contrast)
        VStack(alignment: .leading, spacing: 6) {
            if let kicker {
                kicker.font(.caption.weight(.bold)).kerning(1.2).textCase(.uppercase)
                    .foregroundStyle(palette.isNeutral ? Color.readableSecondary : palette.accent)
            }
            HStack(alignment: .firstTextBaseline) {
                title.font(.system(size: 28, weight: .bold, design: .serif))
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                if let trailing {
                    Text(verbatim: trailing).font(.callout).foregroundStyle(.readableSecondary).multilineTextAlignment(.trailing)
                        .help(Text(verbatim: trailingHint ?? trailing))
                }
            }
            Rectangle().fill(Color(nsColor: .separatorColor)).frame(height: 1)
        }
        .padding(.bottom, 4)
    }
}

/// A box-score figure: a condensed tabular value over a small-caps label, with room for a graphic beside the value.
public struct BoxFigure<Graphic: View>: View {
    let value: String
    let label: String
    let size: CGFloat
    @ViewBuilder let graphic: () -> Graphic
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(value: String, label: String, size: CGFloat = 40, @ViewBuilder graphic: @escaping () -> Graphic = { EmptyView() }) {
        self.value = value
        self.label = label
        self.size = size
        self.graphic = graphic
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .lastTextBaseline, spacing: 8) {
                Text(verbatim: value).font(.system(size: size, weight: .bold)).fontWidth(.condensed).monospacedDigit().lineLimit(1).fixedSize()
                    .contentTransition(reduceMotion ? .identity : .numericText())
                graphic()
            }
            Kicker(label, size: .small).fixedSize()
        }
        .accessibilityElement(children: .combine)
    }
}

/// The masthead as a magazine sets it (section 3.4, item 1; R2): a served kicker, the serif display headline, the deck
/// (a served claim written from the facts on the page; none until it is served), the box score the caller composes,
/// and the one control on it (tonight's game, glass: it opens Game Day). Content colour under the toolbar, extended
/// under the sidebar and the inspector; the pack's art at the trailing side, past every piece of text and cleared
/// around the control, so no word sits on the art (`ArtClearance`).
public struct MagazineMasthead<Figures: View, Control: View>: View {
    let kicker: [String?]
    let kickerHint: String?
    /// A word after the kicker's served parts: "Updating" while the kept report waits on the fresh one (looked up in the
    /// String Catalog), or the served "Updated to …" for a moment after an import lands.
    let kickerStatus: String?
    let headline: Text
    let deck: String?
    let deckHint: String?
    let deckClaim: Components.Schemas.Claim?
    let art: Image?
    @ViewBuilder let figures: () -> Figures
    @ViewBuilder let control: () -> Control
    @Environment(\.theme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @EffectiveContrast private var contrast
    @Environment(\.mastheadTopInset) private var topInset
    /// Where each piece of text ends, in the masthead's space, so the art starts past the furthest (`ArtClearance`).
    @State private var textEdges: [String: CGFloat] = [:]
    /// The control's frame, in the masthead's space, where the art is cleared.
    @State private var controlFrame: CGRect?

    /// - Parameters:
    ///   - kicker: the served parts of the kicker (the club, the game date, how current), joined with middle dots.
    ///   - kickerStatus: a word after them ("Updating", or the served "Updated to …"), or nil.
    ///   - headline: the view's served title.
    ///   - kickerHint: the kicker's help tag (how current the report is, as served).
    ///   - deck: the served lede, with its help tag; nil draws none. With `deckClaim`, the deck opens that claim's basis.
    ///   - art: the pack's masthead art, as served.
    ///   - figures: the box score (`BoxFigure`s, `ClaimText`s), laid out by the caller.
    ///   - control: the masthead's one control (`TonightControl`), or nothing.
    public init(
        kicker: [String?],
        kickerHint: String? = nil,
        kickerStatus: String? = nil,
        headline: Text,
        deck: String? = nil,
        deckHint: String? = nil,
        deckClaim: Components.Schemas.Claim? = nil,
        art: Image? = nil,
        @ViewBuilder figures: @escaping () -> Figures,
        @ViewBuilder control: @escaping () -> Control = { EmptyView() }
    ) {
        self.kicker = kicker
        self.kickerHint = kickerHint
        self.kickerStatus = kickerStatus
        self.headline = headline
        self.deck = deck
        self.deckHint = deckHint
        self.deckClaim = deckClaim
        self.art = art
        self.figures = figures
        self.control = control
    }

    public var body: some View {
        let palette = theme.palette(colorScheme: colorScheme, contrast: contrast)
        VStack(alignment: .leading, spacing: 14) {
            Kicker(served: kicker, status: kickerStatus).foregroundStyle(palette.mastheadSecondaryText)
                .help(kickerHint.map { Text(verbatim: $0) } ?? Text(verbatim: kicker.compactMap { $0 }.joined(separator: " · ")))
                .modifier(TextEdge(id: "kicker", edges: $textEdges))
                .accessibilityIdentifier("masthead.kicker")
            headline.font(.system(size: 62, weight: .bold, design: .serif)).kerning(-0.5)
                .lineLimit(2).minimumScaleFactor(0.6)
                .accessibilityAddTraits(.isHeader)
                .modifier(TextEdge(id: "headline", edges: $textEdges))
            if let deck {
                let text = Text(verbatim: deck)
                    .font(.system(size: 20, weight: .regular, design: .serif)).lineSpacing(3)
                    .foregroundStyle(palette.mastheadText)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                    .modifier(TextEdge(id: "deck", edges: $textEdges))
                    .frame(maxWidth: 640, alignment: .leading)
                if let deckClaim {
                    ClaimText(deckClaim) { text }.accessibilityIdentifier("masthead.deck")
                } else {
                    text.help(deckHint.map { Text(verbatim: $0) } ?? Text(verbatim: deck))
                }
            }
            // Only the layout that fits reports its geometry, so the figures' edge and the control's frame are always the
            // shown ones
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .bottom, spacing: 28) {
                    HStack(alignment: .bottom, spacing: 28) { figures() }.modifier(TextEdge(id: "figures", edges: $textEdges))
                    Spacer(minLength: 24)
                    control().onGeometryChange(for: CGRect.self) { $0.frame(in: .named(MastheadBackground.space)) } action: { controlFrame = $0 }
                }
                VStack(alignment: .leading, spacing: 16) {
                    VStack(alignment: .leading, spacing: 16) { figures() }.modifier(TextEdge(id: "figures", edges: $textEdges))
                    control().onGeometryChange(for: CGRect.self) { $0.frame(in: .named(MastheadBackground.space)) } action: { controlFrame = $0 }
                }
            }
            .padding(.top, 6)
        }
        .foregroundStyle(palette.mastheadText)
        .padding(.leading, 28)
        .padding(.trailing, 28)
        .padding(.bottom, 22)
        .padding(.top, topInset > 0 ? Masthead.fade + 8 : 22)
        .frame(maxWidth: .infinity, alignment: .leading)
        .coordinateSpace(.named(MastheadBackground.space))
        .background {
            // Run up under the toolbar, above the masthead's own frame (the scroll view keeps its content below the
            // toolbar, so the content scrolled under it gets the soft edge; N6 polish): the control's frame moves with it
            MastheadBackground(palette: palette, topInset: topInset, art: art, textTrailing: textEdges.values.max() ?? 0, control: controlFrame?.offsetBy(dx: 0, dy: topInset))
                .padding(.top, -topInset)
                .backgroundExtensionEffect()
        }
        .overlay(alignment: .bottom) {
            // With Increase Contrast the band ends on a line, not only on a change of colour
            if contrast == .increased { Rectangle().fill(palette.mastheadText).frame(height: 1) }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("masthead")
    }
}

/// Reports where a piece of the masthead's text ends, in the masthead's space, so the art starts past it.
struct TextEdge: ViewModifier {
    let id: String
    @Binding var edges: [String: CGFloat]

    func body(content: Content) -> some View {
        content.onGeometryChange(for: CGFloat.self) { $0.frame(in: .named(MastheadBackground.space)).maxX } action: { edges[id] = $0 }
    }
}

/// A thin vertical rule between box-score figures, in the masthead's text colour.
public struct BoxRule: View {
    @Environment(\.theme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @EffectiveContrast private var contrast

    public init() {}

    public var body: some View {
        let palette = theme.palette(colorScheme: colorScheme, contrast: contrast)
        Rectangle().fill(palette.mastheadText.opacity(0.25)).frame(width: 1, height: 44)
            .accessibilityHidden(true)
    }
}

/// Tonight's game on the masthead: the one control there (it opens the schedule and game plans, the nearest view to
/// Game Day until N9), so its surface is glass, per the HIG: glass on controls, not on content. With Reduce Transparency
/// the surface is opaque, in the masthead's own colour, with a border. Every word on it is served, drawn in the
/// masthead's checked text pair (`mastheadText`, `mastheadSecondaryText`), never a tint of the system's.
///
/// The game and the deadline are siblings, never one control inside another: the game is a button where this build can
/// open it (and plain content where it cannot: nothing is drawn disabled), and the deadline beside it is a claim of its
/// own, so a click on it opens the league's own row. The game's basis (the date, the start, the starters' source) opens
/// from its context menu ("Show why"). Nothing is drawn where the game is not served (the masthead's missing lines say
/// why, and the deadline stands alone in the box score).
public struct TonightControl: View {
    let tonight: TonightGame
    let deadline: DeadlineNote?
    /// Opens the game's served target; nil when this build cannot (the game is then drawn as content, not a control).
    let action: (() -> Void)?
    @EffectiveReduceTransparency private var reduceTransparency
    @EffectiveContrast private var contrast
    @Environment(\.theme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @State private var showingBasis = false

    public init(tonight: TonightGame, deadline: DeadlineNote?, action: (() -> Void)?) {
        self.tonight = tonight
        self.deadline = deadline
        self.action = action
    }

    public var body: some View {
        let palette = theme.palette(colorScheme: colorScheme, contrast: contrast)
        HStack(spacing: 16) {
            game(palette)
            if let deadline {
                Rectangle().fill(palette.mastheadText.opacity(0.3)).frame(width: 1, height: 36).accessibilityHidden(true)
                DeadlineFigures(deadline: deadline, palette: palette, alignment: .trailing)
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 8)
        .modifier(ControlSurface(reduceTransparency: reduceTransparency, palette: palette))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("masthead.tonightCard")
    }

    /// The game: a button where this build can open it, else the same words as content.
    @ViewBuilder
    private func game(_ palette: Theme.Palette) -> some View {
        let words = HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Kicker(tonight.when, size: .small).foregroundStyle(palette.mastheadSecondaryText)
                Text(verbatim: tonight.matchup).font(.headline).foregroundStyle(palette.mastheadText)
                Text(verbatim: tonight.starters).font(.caption).monospacedDigit().foregroundStyle(palette.mastheadSecondaryText)
            }
            if action != nil {
                Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(palette.mastheadSecondaryText)
                    .accessibilityHidden(true)
            }
        }
        Group {
            if let action {
                Button(action: action) { words.contentShape(.rect) }
                    .buttonStyle(.plain)
                    .accessibilityHint(Text(verbatim: tonight.hint))
            } else {
                words.accessibilityElement(children: .combine)
            }
        }
        .help(Text(verbatim: tonight.hint))
        .contextMenu {
            if tonight.claim != nil {
                Button("Show why") { showingBasis = true }
            }
        }
        .popover(isPresented: $showingBasis, arrowEdge: .bottom) {
            if let claim = tonight.claim { BasisPopover(claim: claim) }
        }
        .accessibilityCustomContent(Text("Why"), Text(verbatim: tonight.claim?.basis.because.map { "\($0.label): \($0.value)" }.joined(separator: "; ") ?? ""))
        .accessibilityIdentifier("masthead.tonight")
    }
}

/// The trade deadline's served count and words ("17 days", "to the deadline · August 3"), a claim of its own where it
/// is served as one (a click opens the league's own row), in the masthead's checked text pair. Beside tonight's game,
/// or alone in the box score when no game is served.
public struct DeadlineFigures: View {
    let deadline: DeadlineNote
    let palette: Theme.Palette
    let alignment: HorizontalAlignment

    public init(deadline: DeadlineNote, palette: Theme.Palette, alignment: HorizontalAlignment = .leading) {
        self.deadline = deadline
        self.palette = palette
        self.alignment = alignment
    }

    public var body: some View {
        let figures = VStack(alignment: alignment, spacing: 2) {
            Text(verbatim: deadline.count).font(.title3.weight(.bold)).fontWidth(.condensed).monospacedDigit()
                .foregroundStyle(palette.mastheadText)
            Text(verbatim: deadline.text).font(.caption).foregroundStyle(palette.mastheadSecondaryText)
        }
        if let claim = deadline.claim {
            ClaimText(claim, edge: .bottom) { figures }.accessibilityIdentifier("masthead.deadline")
        } else {
            figures.accessibilityElement(children: .combine).accessibilityIdentifier("masthead.deadline")
        }
    }
}

/// The Tonight card's surface: the system's glass (a control's layer) around an opaque plate in the masthead's own
/// colour, which the words sit on (N6 polish: on the bare glass, which lightens in a light appearance, the club's white
/// words read about 1.9:1; on the plate they read as the checked pair does, 4.5:1 or better in every appearance and 7:1
/// with Increase Contrast). The glass shows as the control's rim and its response to the pointer. With Reduce
/// Transparency, the plate alone with a border in its text colour.
struct ControlSurface: ViewModifier {
    let reduceTransparency: Bool
    let palette: Theme.Palette
    /// How much of the glass shows around the plate.
    static let rim: CGFloat = 2

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: 16, style: .continuous)
        if reduceTransparency {
            content
                .background(palette.controlPlate, in: shape)
                .overlay(shape.strokeBorder(palette.mastheadText.opacity(0.6), lineWidth: 1))
        } else {
            content
                .background(palette.controlPlate, in: shape.inset(by: Self.rim))
                .glassEffect(.regular.interactive(), in: shape)
        }
    }
}
