import SwiftUI

/// The masthead at the top of a view (SWIFTUI_REBUILD.md sections 3.4 and 3.7): the club's colour band, carrying the
/// view's title, the club and its record, a served line and the club's logo. It is content-layer colour, not glass: its
/// colour runs up under the toolbar (drawn above the masthead's own frame, which starts in the safe area below it; at
/// rest the toolbar's background and the scroll edge are hidden, so the colour shows through the toolbar's glass,
/// `MastheadScrollView`) and is extended beneath the sidebar and the inspector (`backgroundExtensionEffect`), so the
/// glass of the window's chrome has the club's colour to refract.
///
/// Every word on it is served (the title, the club's name, the record, the line); it states facts and shows no odds or
/// posture (D-060). Its colours are the theme's: under the toolbar the pack's top colour, nearly white in light and
/// nearly black in dark, so the window's title and subtitle read as on a plain window; below it the club's colours,
/// which every piece of text on the masthead reads on (the server checked each pair). The logo is kept well inside the
/// masthead's edges, so the extension mirrors colour, not the logo.
public struct Masthead: View {
    private let title: Text
    private let club: String?
    private let record: String?
    private let recordHint: String?
    private let line: String?
    private let lineHint: String?
    private let logo: Image?
    private let art: Image?
    @Environment(\.theme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @EffectiveContrast private var contrast
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.mastheadTopInset) private var topInset
    /// Where the text column ends, so the art starts past it.
    @State private var textTrailing: CGFloat = 0

    /// - Parameters:
    ///   - title: the view's title: its served name, or its structural title while none is served.
    ///   - club: the club's served name; `record` its served record ("45–38") with `recordHint` its help tag.
    ///   - line: a served one-line summary beneath the title ("Prepared by …, Through May 5, 2040"), with its help tag.
    ///   - logo: the club's logo as served (the theme pack's, else the save's); nil draws none.
    ///   - art: the theme pack's masthead art, drawn at the trailing side; nil draws none.
    public init(
        title: Text,
        club: String? = nil,
        record: String? = nil,
        recordHint: String? = nil,
        line: String? = nil,
        lineHint: String? = nil,
        logo: Image? = nil,
        art: Image? = nil
    ) {
        self.title = title
        self.club = club
        self.record = record
        self.recordHint = recordHint
        self.line = line
        self.lineHint = lineHint
        self.logo = logo
        self.art = art
    }

    /// How far below the toolbar the masthead's text begins: the top colour fades into the club's over this band, so no
    /// text ever sits on the blend between them.
    public static let fade: CGFloat = 20

    public var body: some View {
        let palette = theme.palette(colorScheme: colorScheme, contrast: contrast)
        HStack(alignment: .bottom, spacing: 24) {
            VStack(alignment: .leading, spacing: 6) {
                if club != nil || record != nil {
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        if let club { Text(verbatim: club) }
                        if let record {
                            Text(verbatim: record)
                                .fontWidth(.condensed)
                                .monospacedDigit()
                                .contentTransition(reduceMotion ? .identity : .numericText())
                                .help(recordHint.map { Text(verbatim: $0) } ?? Text(verbatim: record))
                        }
                    }
                    .font(.headline)
                    .foregroundStyle(palette.mastheadSecondaryText)
                }
                title
                    .font(.largeTitle.weight(.bold))
                    .accessibilityAddTraits(.isHeader)
                if let line {
                    Text(verbatim: line)
                        .font(.callout)
                        .foregroundStyle(palette.mastheadSecondaryText)
                        .help(lineHint.map { Text(verbatim: $0) } ?? Text(verbatim: line))
                }
            }
            .fixedSize(horizontal: false, vertical: true)
            .onGeometryChange(for: CGFloat.self) { $0.frame(in: .named(MastheadBackground.space)).maxX } action: { textTrailing = $0 }
            Spacer(minLength: 0)
            if let logo {
                logo.resizable().scaledToFit()
                    .frame(width: 72, height: 72)
                    .accessibilityHidden(true)
            }
        }
        .foregroundStyle(palette.mastheadText)
        .padding(.leading, 28)
        .padding(.trailing, 48)
        .padding(.bottom, 22)
        .padding(.top, topInset > 0 ? Self.fade + 8 : 22)
        .frame(maxWidth: .infinity, alignment: .leading)
        .coordinateSpace(.named(MastheadBackground.space))
        .background {
            // Run up under the toolbar, above the masthead's own frame (N6 polish: the scroll view keeps its content in the
            // safe area below the toolbar, so content scrolled under it gets the soft edge instead of overprinting it)
            MastheadBackground(palette: palette, topInset: topInset, art: art, textTrailing: textTrailing)
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

/// Where the pack's art may show on a masthead: past every piece of text, and never behind the masthead's one control,
/// so no word sits on the art. The server checks each text colour against the masthead's colours (D-062), never against
/// a picture, so text over art would be a pair nobody checked: the art begins past the text column, and around the
/// control it is cleared, so the control sits on the masthead's own (checked) colour.
nonisolated struct ArtClearance: Equatable, Sendable {
    /// Where the art may begin, from the leading edge, in points.
    var start: CGFloat
    /// The control's frame with a margin, where the art is cleared; nil when the masthead has no control.
    var clear: CGRect?

    /// The room kept between text (or the control) and the art.
    static let margin: CGFloat = 16

    /// - Parameters:
    ///   - width: the masthead's width.
    ///   - textTrailing: where the furthest piece of text ends (the kicker, the headline, the deck, the figures).
    ///   - control: the masthead's control's frame, in the masthead's space; nil or empty for none.
    static func resolve(width: CGFloat, textTrailing: CGFloat, control: CGRect?) -> ArtClearance {
        let start = max(MastheadBackground.artStart, width * 0.5, textTrailing + margin)
        let clear = control.flatMap { $0.width > 0 && $0.height > 0 ? $0.insetBy(dx: -margin, dy: -margin) : nil }
        return ArtClearance(start: start, clear: clear)
    }
}

/// The masthead's colour: the club's colours from leading top to trailing bottom, the top colour held under the
/// toolbar and faded into them just below it, and the pack's art at the trailing side, clear of every word
/// (`ArtClearance`).
struct MastheadBackground: View {
    let palette: Theme.Palette
    let topInset: CGFloat
    let art: Image?
    /// Where the furthest piece of text ends, in the masthead's space (`space`).
    var textTrailing: CGFloat = 0
    /// The masthead's control's frame, in the masthead's space; nil for none.
    var control: CGRect? = nil

    /// Where the art may begin at the least, from the leading edge: past the text column (640 points of deck plus the
    /// padding), or half the width, whichever is further; past any text measured further out than that.
    nonisolated static let artStart: CGFloat = 680
    /// The coordinate space a masthead measures its text and its control in: the masthead's own frame, which is the
    /// background's.
    nonisolated static let space = "pennant.masthead"
    /// How softly the art's edge around the control fades (less than `ArtClearance.margin`, so the control's own frame
    /// is fully clear).
    nonisolated static let feather: CGFloat = 6

    var body: some View {
        let stops = palette.masthead.count == 1 ? palette.masthead + palette.masthead : palette.masthead
        let band = topInset + Masthead.fade
        // The top colour is held under the whole toolbar, so the window's title and subtitle sit on it alone (the
        // pack check's 17:1 or 14:1 pair), never on the fade: an accessibility audit reads the title's whole frame
        let hold = band > 0 ? topInset / band : 0
        ZStack(alignment: .top) {
            LinearGradient(colors: stops, startPoint: .topLeading, endPoint: .bottomTrailing)
            if let art {
                GeometryReader { proxy in
                    let clearance = ArtClearance.resolve(width: proxy.size.width, textTrailing: textTrailing, control: control)
                    let start = clearance.start / max(1, proxy.size.width)
                    art.resizable().scaledToFill()
                        .frame(width: proxy.size.width, height: proxy.size.height, alignment: .trailing)
                        .clipped()
                        .mask {
                            ZStack {
                                LinearGradient(stops: [
                                    .init(color: .clear, location: min(1, start)),
                                    .init(color: .black, location: min(1, start + 0.25)),
                                ], startPoint: .leading, endPoint: .trailing)
                                if let clear = clearance.clear {
                                    Capsule().fill(.black)
                                        .frame(width: clear.width, height: clear.height)
                                        .position(x: clear.midX, y: clear.midY)
                                        .blur(radius: Self.feather)
                                        .blendMode(.destinationOut)
                                }
                            }
                            .compositingGroup()
                        }
                }
                .accessibilityHidden(true)
            }
            // Nothing to hold where no toolbar sits above (a preview)
            if topInset > 0 {
                LinearGradient(stops: Self.fadeStops(top: palette.mastheadTop, into: stops[0], hold: hold), startPoint: .top, endPoint: .bottom)
                    .frame(height: band)
            }
        }
    }

    /// The top colour held under the toolbar, then faded into the club's colour: each step is mixed towards the
    /// club's colour perceptually before its opacity falls, so a near-white top over a navy never passes through a
    /// grey mid-way (the alpha blend alone did, in Stage A's light masthead).
    static func fadeStops(top: Color, into club: Color, hold: Double) -> [Gradient.Stop] {
        var stops: [Gradient.Stop] = [.init(color: top, location: 0), .init(color: top, location: hold)]
        let steps = 6
        for step in 1...steps {
            let t = Double(step) / Double(steps)
            let mixed = top.mix(with: club, by: t, in: .perceptual)
            stops.append(.init(color: mixed.opacity(1 - t), location: hold + (1 - hold) * t))
        }
        return stops
    }
}

extension EnvironmentValues {
    /// The height of the toolbar above a masthead, which its colour runs up under (set by `MastheadScrollView`).
    @Entry public var mastheadTopInset: CGFloat = 0
}

/// A view that opens on a masthead (SWIFTUI_REBUILD.md section 3.7). At rest the masthead's colour runs up under the
/// toolbar, which shows it through its glass: the toolbar's background and the top scroll edge are hidden. Once anything
/// scrolls under the toolbar, both come back, so what passes beneath it blurs and fades into the soft scroll edge and
/// never overprints the toolbar's controls (N6 polish and its review). The scroll view keeps its content in the safe area
/// the HIG intends, so the system knows where that edge is. The content below the masthead is the caller's, opaque. At
/// most one floating control group sits at the bottom, and the content keeps room for it.
public struct MastheadScrollView<Header: View, Content: View, Actions: View>: View {
    private let header: Header
    private let content: Content
    private let actions: Actions
    private let hasActions: Bool

    public init(
        @ViewBuilder header: () -> Header,
        @ViewBuilder content: () -> Content,
        @ViewBuilder actions: () -> Actions
    ) {
        self.header = header()
        self.content = content()
        self.actions = actions()
        self.hasActions = Actions.self != EmptyView.self
    }

    /// Something has scrolled under the toolbar (`MastheadToolbar.scrolledUnder`).
    @State private var underToolbar = false

    #if DEBUG
    /// A development build scrolls itself there once drawn (`-PennantDebugScrollTo <points>`), for window captures of
    /// content under the toolbar without any input (never in a release build).
    @State private var position = ScrollPosition()
    private static var debugScroll: CGFloat? {
        let y = UserDefaults.standard.double(forKey: "PennantDebugScrollTo")
        return y > 0 ? y : nil
    }
    #endif

    public var body: some View {
        GeometryReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    header.environment(\.mastheadTopInset, proxy.safeAreaInsets.top)
                    content
                }
                .environment(\.contentWidth, proxy.size.width)
            }
            // The content keeps in the safe area below the toolbar (the scroll view still reaches up under it, so the
            // masthead's colour, drawn above its own frame, shows there). At rest the soft edge is hidden, so that colour is
            // not washed out; once anything scrolls under the toolbar it is back, and what passes beneath blurs and fades
            .scrollEdgeEffectStyle(.soft, for: .top)
            .scrollEdgeEffectHidden(!underToolbar, for: .top)
            .onScrollGeometryChange(for: Bool.self) { geometry in
                MastheadToolbar.scrolledUnder(offset: geometry.contentOffset.y, topInset: geometry.contentInsets.top)
            } action: { _, now in
                underToolbar = now
            }
            .contentMargins(.bottom, hasActions ? 72 : 0, for: .scrollContent)
            #if DEBUG
            .scrollPosition($position)
            .task {
                guard let y = Self.debugScroll else { return }
                try? await Task.sleep(for: .seconds(1.5))
                position.scrollTo(y: y)
            }
            #endif
            .overlay(alignment: .bottom) {
                actions.padding(.bottom, 18)
            }
        }
        // Hidden at rest (the masthead's colour through the toolbar's glass); the system's once content scrolls under it
        .toolbarBackgroundVisibility(MastheadToolbar.background(underToolbar: underToolbar), for: .windowToolbar)
    }
}

/// The toolbar above a masthead (`MastheadScrollView`): at rest the masthead's colour shows through it; once anything
/// scrolls under it, the system's background and the soft scroll edge.
nonisolated enum MastheadToolbar {
    /// Whether anything has scrolled under the toolbar: the content's top has moved above the top of the safe area, by
    /// more than half a point (a scroll view at rest reports its offset as minus its top inset; a rubber band pulls it
    /// further down, which is still at rest). At rest the only thing under the toolbar is the masthead's own colour.
    static func scrolledUnder(offset: CGFloat, topInset: CGFloat) -> Bool {
        offset + topInset > 0.5
    }

    /// The toolbar's background: hidden at rest, so the masthead's colour shows through the toolbar's glass; the
    /// system's once content scrolls under it (on macOS 26 and 27 that background is the scroll edge itself, which
    /// hiding it takes away).
    static func background(underToolbar: Bool) -> Visibility {
        underToolbar ? .automatic : .hidden
    }
}

extension MastheadScrollView where Actions == EmptyView {
    public init(@ViewBuilder header: () -> Header, @ViewBuilder content: () -> Content) {
        self.init(header: header, content: content, actions: { EmptyView() })
    }
}
