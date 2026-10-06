import PennantAPI
import Charts
import SwiftUI

// The data graphics (SWIFTUI_REBUILD.md section 3.7, "Design language"): a league place among the clubs as a strip of
// dots, a value's range with its most likely value marked, a sparkline, a ring and an inline bar for a real share of
// a whole, control as pips, the last five as W and L dots. Each is tinted from the active pack, hatches or says so
// when the value is not known (never a zero, never an empty chart that reads as "none"), and carries the served
// sentence as its accessibility label. Colour is never the only signal: a mark has a shape and a word beside it.

/// A league place among `of` clubs, best on the left: the club's place filled in the accent, the clubs tied with it
/// drawn at the same size (a tie shares the size; they are paler, and the place's served words say "T-"), a hollow
/// ring at its recent place, and the top and bottom fifths shaded where the server says they fall (none in a league
/// too small to have them), so a strength and a weakness are visible. Too early to call (no place) draws the shading
/// and the dots alone. Every number is served: the clubs, the place, the lines. Drawn with Canvas, so it fits a tile
/// or a row.
public struct PlaceStrip: View {
    let dimension: PlaceDimension
    let height: CGFloat
    let maxDot: CGFloat
    @Environment(\.theme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @EffectiveContrast private var contrast

    /// One dot on the strip: whose it is and how large, as a multiple of the plain dot.
    nonisolated struct Dot: Equatable, Sendable {
        enum Kind: Equatable, Sendable { case club, tied, other }
        let place: Int
        let kind: Kind
        let scale: CGFloat
        /// The recent place is here (a hollow ring).
        let recent: Bool
    }

    /// How much larger the club's dot is than the others (and every club tied with it: a tie shares the size).
    nonisolated static let clubScale: CGFloat = 1.7

    /// The dots, best place first: the club's and those tied with it at the club's size, the rest plain. No dots at
    /// all when the size of the league is not served (`of` below one): a strip of one dot would read as a league of
    /// one.
    nonisolated static func dots(_ dimension: PlaceDimension) -> [Dot] {
        guard dimension.of >= 1 else { return [] }
        return (1...dimension.of).map { p in
            let kind: Dot.Kind
            if p == dimension.place {
                kind = .club
            } else if let place = dimension.place, p > place, p <= place + dimension.tiedWith {
                kind = .tied
            } else {
                kind = .other
            }
            return Dot(place: p, kind: kind, scale: kind == .other ? 1 : clubScale, recent: dimension.recentPlace == p)
        }
    }

    public init(_ dimension: PlaceDimension, height: CGFloat = 16, maxDot: CGFloat = 7) {
        self.dimension = dimension
        self.height = height
        self.maxDot = maxDot
    }

    /// The shaded ends as places along the strip (the first place shaded for a strength through the last, and the
    /// first for a weakness through the end), exactly as served; nil for an end the server does not serve, or with no
    /// strip to shade.
    nonisolated static func shading(_ dimension: PlaceDimension) -> (strength: ClosedRange<Int>?, weakness: ClosedRange<Int>?) {
        guard dimension.of >= 1 else { return (nil, nil) }
        let strength = dimension.strengthThrough.flatMap { $0 >= 1 ? 1...min($0, dimension.of) : nil }
        let weakness = dimension.weaknessFrom.flatMap { $0 <= dimension.of ? max(1, $0)...dimension.of : nil }
        return (strength, weakness)
    }

    public var body: some View {
        let palette = theme.palette(colorScheme: colorScheme, contrast: contrast)
        let accent = palette.isNeutral ? Color.accentColor : palette.accent
        let dots = Self.dots(dimension)
        let shading = Self.shading(dimension)
        Canvas { ctx, size in
            // The track's width over the served clubs (a place is a slot on it); no clubs, no slots
            let step = dots.isEmpty ? 0 : size.width / CGFloat(dots.count)
            let dot = min(maxDot, step * 0.62)
            let midY = size.height / 2
            // The top and bottom fifths, where the server says the lines fall (none in a small league, none without clubs)
            let band = { (places: ClosedRange<Int>) -> CGRect in
                CGRect(x: step * CGFloat(places.lowerBound - 1), y: 0, width: step * CGFloat(places.count), height: size.height)
            }
            if let strength = shading.strength {
                ctx.fill(Path(roundedRect: band(strength), cornerRadius: 4), with: .color(Tone.good.color.opacity(0.14)))
            }
            if let weakness = shading.weakness {
                ctx.fill(Path(roundedRect: band(weakness), cornerRadius: 4), with: .color(Tone.bad.color.opacity(0.14)))
            }
            if dots.isEmpty {
                // Not placed, no size: a quiet empty track, never dots that read as a league
                ctx.fill(Path(roundedRect: CGRect(x: 0, y: midY - 2, width: size.width, height: 4), cornerRadius: 2), with: .color(Color(nsColor: .quaternaryLabelColor).opacity(0.5)))
            }
            for d in dots {
                let cx = step * (CGFloat(d.place) - 0.5)
                let size = dot * d.scale
                let color: Color = switch d.kind {
                case .club: accent
                case .tied: accent.opacity(0.45)
                case .other: Color(nsColor: .quaternaryLabelColor)
                }
                ctx.fill(Path(ellipseIn: CGRect(x: cx - size / 2, y: midY - size / 2, width: size, height: size)), with: .color(color))
                if d.recent {
                    let r = d.kind == .other ? dot * Self.clubScale : dot * 2.5
                    let ring = Path(ellipseIn: CGRect(x: cx - r / 2, y: midY - r / 2, width: r, height: r))
                    // In dark the club's accent sits close to the shaded ends and the other dots: a halo behind a heavier
                    // ring keeps it apart (N6 polish: the rings read faint in dark). The halo is knocked out of the strip,
                    // so the page it sits on shows through, whatever that page is drawn in (the window's background is
                    // tinted on macOS 26, so no colour of the app's own would match it)
                    if colorScheme == .dark {
                        var halo = ctx
                        halo.blendMode = .clear
                        halo.stroke(ring, with: .color(.black), lineWidth: 4)
                        ctx.stroke(ring, with: .color(accent), lineWidth: 2)
                    } else {
                        ctx.stroke(ring, with: .color(accent), lineWidth: 1.5)
                    }
                }
            }
        }
        .frame(height: height)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: [dimension.name, dimension.placeText, dimension.recentText].joined(separator: ", ")))
        // A graphic with its served sentence: an image to VoiceOver and the audit, never an element of no role
        .accessibilityAddTraits(.isImage)
    }
}

/// Strength or weakness, as a symbol and a word (never only the colour); nothing for the rest, and nothing for a
/// dimension not placed (the export lacks the figure: that is not a weakness).
public struct StrengthMark: View {
    let group: PlaceDimension.Group

    public init(_ group: PlaceDimension.Group) {
        self.group = group
    }

    public var body: some View {
        switch group {
        case .strength:
            Image(systemName: "arrow.up.circle.fill").foregroundStyle(Tone.good.color).accessibilityLabel(Text("Strength"))
        case .weakness:
            Image(systemName: "arrow.down.circle.fill").foregroundStyle(Tone.bad.color).accessibilityLabel(Text("Weakness"))
        case .rest, .tooEarly, .notPlaced:
            EmptyView()
        }
    }
}

/// One line of "How we win and lose": symbol, name, the strip, the place as a claim, the recent reading.
public struct PlaceRow: View {
    let dimension: PlaceDimension
    let wide: Bool

    public init(_ dimension: PlaceDimension, wide: Bool = true) {
        self.dimension = dimension
        self.wide = wide
    }

    public var body: some View {
        HStack(spacing: 12) {
            // A dimension not placed reads quieter: the export lacks its figure, which is no judgment of the club
            Label { Text(verbatim: dimension.name) } icon: { Image(systemName: dimension.symbol).frame(width: 18) }
                .font(.body)
                .foregroundStyle(dimension.group == .notPlaced ? Color.readableSecondary : Color.primary)
                .frame(width: wide ? 200 : 170, alignment: .leading)
                // The figure behind the place, as served ("4.63 runs a game · league middle 4.31"), on hover
                .help(dimension.detail.map { detail in Text(verbatim: [detail, dimension.detailHint].compactMap { $0 }.joined(separator: "\n")) } ?? Text(verbatim: dimension.name))
            PlaceStrip(dimension).frame(maxWidth: 480)
            Spacer(minLength: 8)
            ClaimText(dimension.claim) {
                HStack(spacing: 6) {
                    StrengthMark(dimension.group)
                    Text(verbatim: dimension.placeText).font(.body.weight(.semibold)).monospacedDigit()
                }
            }
            .frame(width: 130, alignment: .trailing)
            Text(verbatim: dimension.recentText).font(.callout).foregroundStyle(.readableSecondary).monospacedDigit()
                .frame(width: wide ? 120 : 96, alignment: .trailing)
                // Why there is no recent place, as served, when there is none
                .help(Text(verbatim: dimension.recentWhy ?? dimension.recentText))
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("place.\(dimension.id)")
    }
}

/// "How we win and lose": the served dimensions in their served groups (strengths, weaknesses, the rest, too early,
/// not placed), each group under its served heading (the title, and the policy line beside it where there is one, each
/// with its served help tag), and the served legend (the view keeps only its symbols; the shaded ends' entry only where
/// the server serves one).
public struct PlaceStrips: View {
    let dimensions: [PlaceDimension]
    /// Each group's heading as served, by group.
    let headings: [PlaceDimension.Group: PlaceDimension.Heading]
    /// The legend as served (the club profile's `legend`); nil draws none.
    let legend: Components.Schemas.ProfileLegend?
    let wide: Bool

    public init(_ dimensions: [PlaceDimension], headings: [PlaceDimension.Group: PlaceDimension.Heading], legend: Components.Schemas.ProfileLegend?, wide: Bool = true) {
        self.dimensions = dimensions
        self.headings = headings
        self.legend = legend
        self.wide = wide
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(PlaceDimension.Group.allCases, id: \.self) { group in
                self.group(group)
            }
            if let legend {
                HStack(spacing: 14) {
                    LegendEntry(legend.dot, symbol: "circle.fill")
                    LegendEntry(legend.ring, symbol: "circle")
                    if let shading = legend.shading { LegendEntry(shading, symbol: "rectangle.lefthalf.filled") }
                }
                .font(.caption.weight(.medium)).foregroundStyle(.readableSecondary).padding(.top, 4)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("placeStrips")
    }

    @ViewBuilder
    private func group(_ group: PlaceDimension.Group) -> some View {
        let members = dimensions.filter { $0.group == group }
        // A group with members and no served heading is drawn without one: its rows still say where each falls
        if !members.isEmpty {
            VStack(alignment: .leading, spacing: 2) {
                if let heading = headings[group] {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(verbatim: heading.title).font(.headline)
                            .help(Text(verbatim: heading.titleHint ?? heading.title))
                            .accessibilityAddTraits(.isHeader)
                        if let line = heading.line {
                            Text(verbatim: line).font(.caption).foregroundStyle(.readableSecondary)
                                .help(Text(verbatim: heading.lineHint ?? line))
                        }
                    }
                    .padding(.top, 8)
                }
                ForEach(members) { d in
                    PlaceRow(d, wide: wide).padding(.vertical, 3)
                    if d.id != members.last?.id { Divider() }
                }
            }
        }
    }
}

/// One line of a legend: its symbol (structural) and its served words, with the served help tag. The symbol is drawn
/// beside the words and hidden from VoiceOver, so the words are the element read (and measured: a ring's thin outline
/// measured as the words' own contrast, N6 Stage B2 review).
public struct LegendEntry: View {
    let line: Components.Schemas.Cell
    let symbol: String
    /// The symbol's own colour (a tone's orange), never the words': they keep the legend's readable colour.
    let symbolTint: Color?

    public init(_ line: Components.Schemas.Cell, symbol: String, symbolTint: Color? = nil) {
        self.line = line
        self.symbol = symbol
        self.symbolTint = symbolTint
    }

    public var body: some View {
        HStack(spacing: 5) {
            if let symbolTint {
                Image(systemName: symbol).foregroundStyle(symbolTint).accessibilityHidden(true)
            } else {
                Image(systemName: symbol).accessibilityHidden(true)
            }
            Text(verbatim: line.display)
        }
        .help(line.hint.map { Text(verbatim: $0) } ?? Text(verbatim: line.display))
    }
}

/// A value's range with its most likely value marked, on the scale served with it; hatched when there is no value
/// (never a zero). The scale is always the caller's, from the server (a diagram's bars share one); a value off the
/// scale is clipped at the bar's end, never moved onto it.
public struct RangeBar: View {
    let range: ValueRange?
    /// The served sentence the bar stands for (its accessibility label): the range, or why there is none.
    let label: String
    let scale: ValueScale
    let height: CGFloat
    @Environment(\.theme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @EffectiveContrast private var contrast

    public init(range: ValueRange?, label: String, scale: ValueScale, height: CGFloat = 8) {
        self.range = range
        self.label = label
        self.scale = scale
        self.height = height
    }

    public var body: some View {
        let palette = theme.palette(colorScheme: colorScheme, contrast: contrast)
        let accent = palette.isNeutral ? Color.accentColor : palette.accent
        GeometryReader { g in
            let w = g.size.width
            let x = { (v: Double) -> CGFloat in CGFloat(scale.position(of: v)) * w }
            ZStack(alignment: .leading) {
                Capsule().fill(Color(nsColor: .quaternaryLabelColor).opacity(0.5))
                if let range {
                    Capsule().fill(accent.opacity(0.35))
                        .frame(width: max(2, x(range.high) - x(range.low)))
                        .offset(x: x(range.low))
                    if let likely = range.likely {
                        Capsule().fill(accent).frame(width: 3, height: height + 4)
                            .offset(x: x(likely) - 1.5, y: -2)
                    }
                } else {
                    Hatch().frame(height: height).clipShape(Capsule())
                }
            }
            // Clipped at the ends only, so the mark still stands above and below the bar
            .mask(Rectangle().padding(.vertical, -4))
        }
        .frame(height: height)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: label))
        // A graphic with its served sentence: an image to VoiceOver and the audit, never an element of no role
        .accessibilityAddTraits(.isImage)
    }
}

/// A hatched fill for "not known" (never a zero, never an empty bar that reads as none).
public struct Hatch: View {
    public init() {}

    public var body: some View {
        Canvas { ctx, size in
            var path = Path()
            var x: CGFloat = -size.height
            while x < size.width {
                path.move(to: CGPoint(x: x, y: size.height))
                path.addLine(to: CGPoint(x: x + size.height, y: 0))
                x += 5
            }
            ctx.stroke(path, with: .color(Color(nsColor: .tertiaryLabelColor)), lineWidth: 1)
        }
        .accessibilityHidden(true)
    }
}

/// A sparkline of served values (oldest first) in the accent, the last point marked. Nothing is drawn for fewer than
/// two values: a flat line would read as a trend the evidence does not give.
public struct Sparkline: View {
    let values: [Int]
    let height: CGFloat
    /// The served sentence the line stands for (its accessibility label).
    let label: String
    @Environment(\.theme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @EffectiveContrast private var contrast

    public init(values: [Int], label: String, height: CGFloat = 36) {
        self.values = values
        self.label = label
        self.height = height
    }

    public var body: some View {
        let palette = theme.palette(colorScheme: colorScheme, contrast: contrast)
        let accent = palette.isNeutral ? Color.accentColor : palette.accent
        if values.count >= 2, let low = values.min(), let high = values.max() {
            let pts = values.enumerated().map { (i: $0.offset, v: $0.element) }
            Chart(pts, id: \.i) { p in
                AreaMark(x: .value("Game", p.i), y: .value("Runs", p.v))
                    .interpolationMethod(.monotone)
                    .foregroundStyle(LinearGradient(colors: [accent.opacity(0.3), accent.opacity(0.02)], startPoint: .top, endPoint: .bottom))
                LineMark(x: .value("Game", p.i), y: .value("Runs", p.v))
                    .interpolationMethod(.monotone)
                    .foregroundStyle(accent)
                    .lineStyle(StrokeStyle(lineWidth: 2))
                if p.i == pts.count - 1 {
                    PointMark(x: .value("Game", p.i), y: .value("Runs", p.v)).foregroundStyle(accent).symbolSize(30)
                }
            }
            .chartXAxis(.hidden).chartYAxis(.hidden).chartLegend(.hidden)
            .chartYScale(domain: (low - 4)...(high + 4))
            .frame(height: height)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: label))
            // A graphic with its served sentence: an image to VoiceOver and the audit, never an element of no role
            .accessibilityAddTraits(.isImage)
        }
    }
}

/// A ring for a real share of a whole ("39 of 40"), in the accent. Decorative: the figure beside it says the number.
public struct Ring: View {
    let fraction: Double
    let size: CGFloat
    let line: CGFloat
    @Environment(\.theme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @EffectiveContrast private var contrast

    public init(fraction: Double, size: CGFloat = 44, line: CGFloat = 5) {
        self.fraction = fraction
        self.size = size
        self.line = line
    }

    public var body: some View {
        let palette = theme.palette(colorScheme: colorScheme, contrast: contrast)
        let accent = palette.isNeutral ? Color.accentColor : palette.accent
        ZStack {
            Circle().stroke(Color(nsColor: .quaternaryLabelColor).opacity(0.5), lineWidth: line)
            Circle().trim(from: 0, to: min(1, max(0, fraction)))
                .stroke(accent, style: StrokeStyle(lineWidth: line, lineCap: .round))
                .rotationEffect(.degrees(-90))
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// An inline bar with its served figure beside it, for a real share of a whole ("CPU ▬▬▬ 20%").
public struct InlineBar: View {
    let fraction: Double
    let text: String
    let tone: Tone?
    @Environment(\.theme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @EffectiveContrast private var contrast

    public init(fraction: Double, text: String, tone: Tone? = nil) {
        self.fraction = fraction
        self.text = text
        self.tone = tone
    }

    public var body: some View {
        let palette = theme.palette(colorScheme: colorScheme, contrast: contrast)
        let accent = palette.isNeutral ? Color.accentColor : palette.accent
        HStack(spacing: 8) {
            GeometryReader { g in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color(nsColor: .quaternaryLabelColor).opacity(0.5))
                    Capsule().fill(tone?.color ?? accent).frame(width: max(4, g.size.width * min(1, max(0, fraction))))
                }
            }
            .frame(height: 6)
            .accessibilityHidden(true)
            Text(verbatim: text).font(.caption.weight(.medium)).monospacedDigit().foregroundStyle(.readableSecondary).frame(width: 58, alignment: .trailing)
        }
        .accessibilityElement(children: .combine)
    }
}

/// Control as small pips: one per season the club holds him (none for none: a pip is never invented), a hollow pip for
/// a clock, a hatched pip when not known, and hatched too when the server gives seasons through a year but no count
/// (unknown is never drawn as none). The served words are in the help tag and the accessibility label.
public struct ControlPips: View {
    let control: ControlTerm
    @Environment(\.theme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @EffectiveContrast private var contrast

    public init(_ control: ControlTerm) {
        self.control = control
    }

    /// How many filled pips the served seasons draw: exactly that many, none for zero (or a count below it); nil when
    /// the count is not served (drawn hatched, as not known).
    nonisolated static func seasonPips(_ control: ControlTerm) -> Int? {
        if case .seasons(let count, _) = control { return count.map { max(0, $0) } }
        return 0
    }

    public var body: some View {
        let palette = theme.palette(colorScheme: colorScheme, contrast: contrast)
        let accent = (palette.isNeutral ? Color.accentColor : palette.accent).opacity(0.8)
        HStack(spacing: 2) {
            switch control {
            case .seasons:
                if let pips = Self.seasonPips(control) {
                    ForEach(0..<pips, id: \.self) { _ in
                        RoundedRectangle(cornerRadius: 1).fill(accent).frame(width: 5, height: 7)
                    }
                } else {
                    Hatch().frame(width: 12, height: 7).clipShape(RoundedRectangle(cornerRadius: 1))
                }
            case .clock:
                RoundedRectangle(cornerRadius: 1).strokeBorder(accent, lineWidth: 1).frame(width: 5, height: 7)
            case .unknown:
                Hatch().frame(width: 12, height: 7).clipShape(RoundedRectangle(cornerRadius: 1))
            }
        }
        .help(Text(verbatim: control.text))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: control.text))
        // A graphic with its served sentence: an image to VoiceOver and the audit, never an element of no role
        .accessibilityAddTraits(.isImage)
    }
}

/// The last five results, oldest first: a filled dot with a W, a hollow one with an L, a dashed one with a T for a
/// tie, on the masthead.
public struct LastFiveDots: View {
    let results: [GameResult]
    let size: CGFloat
    /// The served line the dots stand for ("Lost 1 · last five 3–2"), read by VoiceOver.
    let label: String
    @Environment(\.theme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @EffectiveContrast private var contrast

    public init(results: [GameResult], label: String, size: CGFloat = 22) {
        self.results = results
        self.label = label
        self.size = size
    }

    public var body: some View {
        let palette = theme.palette(colorScheme: colorScheme, contrast: contrast)
        HStack(spacing: 6) {
            ForEach(Array(results.enumerated()), id: \.offset) { _, result in
                ZStack {
                    // Each letter in a served, checked pair as served (the masthead's text and its colour), never faded
                    switch result {
                    case .win:
                        Circle().fill(palette.mastheadText)
                        Text("W").font(.system(size: size * 0.55, weight: .bold)).foregroundStyle(palette.masthead.first ?? palette.mastheadTop)
                    case .loss:
                        Circle().strokeBorder(palette.mastheadText.opacity(0.7), lineWidth: 1.5)
                        Text("L").font(.system(size: size * 0.55, weight: .semibold)).foregroundStyle(palette.mastheadText)
                    case .tie:
                        Circle().strokeBorder(palette.mastheadText.opacity(0.7), style: StrokeStyle(lineWidth: 1.5, dash: [2.5, 2]))
                        Text("T").font(.system(size: size * 0.55, weight: .semibold)).foregroundStyle(palette.mastheadText)
                    }
                }
                .frame(width: size, height: size)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: label))
        // A graphic with its served sentence: an image to VoiceOver and the audit, never an element of no role
        .accessibilityAddTraits(.isImage)
    }
}
