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
    /// and a structural status after them ("Updating") while the caller has one.
    public init(served parts: [String?], status: Text? = nil, size: Size = .regular) {
        let separator = " · "
        let served = Text(verbatim: parts.compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: separator))
        text = status.map { served + Text(verbatim: separator) + $0 } ?? served
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
    @Environment(\.theme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @EffectiveContrast private var contrast

    public init(kicker: Text? = nil, title: Text, trailing: String? = nil) {
        self.kicker = kicker
        self.title = title
        self.trailing = trailing
    }

    public var body: some View {
        let palette = theme.palette(colorScheme: colorScheme, contrast: contrast)
        VStack(alignment: .leading, spacing: 6) {
            if let kicker {
                kicker.font(.caption.weight(.semibold)).kerning(1.2).textCase(.uppercase)
                    .foregroundStyle(palette.isNeutral ? Color.secondary : palette.accent)
            }
            HStack(alignment: .firstTextBaseline) {
                title.font(.system(size: 28, weight: .bold, design: .serif))
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                if let trailing {
                    Text(verbatim: trailing).font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.trailing)
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
    /// A structural word after the kicker's served parts ("Updating" while the kept report waits on the fresh one).
    let kickerStatus: Text?
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
    ///   - kickerStatus: a structural word after them ("Updating"), or nil.
    ///   - headline: the view's served title.
    ///   - kickerHint: the kicker's help tag (how current the report is, as served).
    ///   - deck: the served lede, with its help tag; nil draws none. With `deckClaim`, the deck opens that claim's basis.
    ///   - art: the pack's masthead art, as served.
    ///   - figures: the box score (`BoxFigure`s, `ClaimText`s), laid out by the caller.
    ///   - control: the masthead's one control (`TonightControl`), or nothing.
    public init(
        kicker: [String?],
        kickerHint: String? = nil,
        kickerStatus: Text? = nil,
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
        .padding(.top, topInset > 0 ? topInset + Masthead.fade + 8 : 22)
        .frame(maxWidth: .infinity, alignment: .leading)
        .coordinateSpace(.named(MastheadBackground.space))
        .background {
            MastheadBackground(palette: palette, topInset: topInset, art: art, textTrailing: textEdges.values.max() ?? 0, control: controlFrame)
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

/// Tonight's game on the masthead: a control (it opens the schedule and game plans, the nearest view to Game Day until
/// N9), so it is glass, per the HIG: glass on controls, not on content. With Reduce Transparency it is opaque with a
/// border. Every word on it is served. Its basis (the date, the start, the starters' source) opens from the control's
/// context menu ("Show why"); the deadline beside it is a claim of its own, so a click on it opens the league's own
/// row. Nothing is drawn where the game or the deadline is not served (the masthead's missing lines say why).
public struct TonightControl: View {
    let tonight: TonightGame
    let deadline: DeadlineNote?
    /// Opens the game's served target; nil when this build cannot (the control is then disabled).
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
        Button(action: { action?() }) {
            HStack(spacing: 16) {
                VStack(alignment: .leading, spacing: 2) {
                    Kicker(tonight.when, size: .small)
                    Text(verbatim: tonight.matchup).font(.headline)
                    Text(verbatim: tonight.starters).font(.caption).monospacedDigit()
                }
                if let deadline {
                    Rectangle().fill(.primary.opacity(0.2)).frame(width: 1, height: 36)
                    let figures = VStack(alignment: .trailing, spacing: 2) {
                        Text(verbatim: deadline.count).font(.title3.weight(.bold)).fontWidth(.condensed).monospacedDigit()
                        Text(verbatim: deadline.text).font(.caption)
                    }
                    if let claim = deadline.claim {
                        ClaimText(claim, edge: .bottom) { figures }.accessibilityIdentifier("masthead.deadline")
                    } else {
                        figures
                    }
                }
                Image(systemName: "chevron.right").font(.caption.weight(.semibold)).opacity(0.7)
            }
            .padding(.horizontal, 6).padding(.vertical, 4)
        }
        .modifier(GlassOrOpaque(reduceTransparency: reduceTransparency, borderColor: palette.mastheadText))
        .controlSize(.large)
        .disabled(action == nil)
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

/// The system's glass button style, or, with Reduce Transparency, an opaque capsule with a border.
struct GlassOrOpaque: ViewModifier {
    let reduceTransparency: Bool
    let borderColor: Color

    func body(content: Content) -> some View {
        if reduceTransparency {
            content
                .buttonStyle(.plain)
                .padding(.horizontal, 12).padding(.vertical, 8)
                .background(Color(nsColor: .controlBackgroundColor), in: .capsule)
                .foregroundStyle(Color(nsColor: .labelColor))
                .overlay(Capsule().strokeBorder(borderColor.opacity(0.6), lineWidth: 1))
        } else {
            content.buttonStyle(.glass)
        }
    }
}
