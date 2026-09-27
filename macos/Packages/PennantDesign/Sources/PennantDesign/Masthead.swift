import SwiftUI

/// The masthead at the top of a view (SWIFTUI_REBUILD.md sections 3.4 and 3.7): the club's colour band, carrying the
/// view's title, the club and its record, a served line and the club's logo. It is content-layer colour, not glass: it
/// runs up under the toolbar (the scroll view ignores the top safe area) and its colour is extended beneath the sidebar
/// and the inspector (`backgroundExtensionEffect`), so the glass of the window's chrome has the club's colour to refract.
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
        .padding(.top, topInset > 0 ? topInset + Self.fade + 8 : 22)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            MastheadBackground(palette: palette, topInset: topInset, art: art)
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

/// The masthead's colour: the club's colours from leading top to trailing bottom, the top colour held under the
/// toolbar and faded into them just below it, and the pack's art at the trailing side.
struct MastheadBackground: View {
    let palette: Theme.Palette
    let topInset: CGFloat
    let art: Image?

    var body: some View {
        let stops = palette.masthead.count == 1 ? palette.masthead + palette.masthead : palette.masthead
        let band = topInset + Masthead.fade
        let hold = band > 0 ? max(0, topInset - 6) / band : 0
        ZStack(alignment: .top) {
            LinearGradient(colors: stops, startPoint: .topLeading, endPoint: .bottomTrailing)
            if let art {
                art.resizable().scaledToFill()
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .trailing)
                    .mask(LinearGradient(colors: [.clear, .black], startPoint: .leading, endPoint: .trailing))
                    .accessibilityHidden(true)
            }
            // Nothing to hold where no toolbar sits above (a preview)
            if topInset > 0 {
                LinearGradient(
                    stops: [
                        .init(color: palette.mastheadTop, location: 0),
                        .init(color: palette.mastheadTop, location: hold),
                        .init(color: palette.mastheadTop.opacity(0), location: 1),
                    ],
                    startPoint: .top, endPoint: .bottom
                )
                .frame(height: band)
            }
        }
    }
}

extension EnvironmentValues {
    /// The height of the toolbar above a masthead, which its colour runs up under (set by `MastheadScrollView`).
    @Entry public var mastheadTopInset: CGFloat = 0
}

/// A view that opens on a masthead (SWIFTUI_REBUILD.md section 3.7): the scroll view runs up under the toolbar, which
/// shows the masthead's colour through its glass (its own background hidden), with the soft scroll edge once content
/// scrolls beneath it. The content below the masthead is the caller's, opaque. At most one floating control group sits
/// at the bottom, and the content keeps room for it.
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

    public var body: some View {
        GeometryReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    header.environment(\.mastheadTopInset, proxy.safeAreaInsets.top)
                    content
                }
            }
            .ignoresSafeArea(edges: .top)
            .scrollEdgeEffectStyle(.soft, for: .top)
            .contentMargins(.bottom, hasActions ? 72 : 0, for: .scrollContent)
            .overlay(alignment: .bottom) {
                actions.padding(.bottom, 18)
            }
        }
        .toolbarBackgroundVisibility(.hidden, for: .windowToolbar)
    }
}

extension MastheadScrollView where Actions == EmptyView {
    public init(@ViewBuilder header: () -> Header, @ViewBuilder content: () -> Content) {
        self.init(header: header, content: content, actions: { EmptyView() })
    }
}
