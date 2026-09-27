import Charts
import SwiftUI

// The data graphics (SWIFTUI_REBUILD.md section 3.7, "Design language"): a league place among the clubs as a strip of
// dots, a value's range with its most likely value marked, a sparkline, a ring and an inline bar for a real share of
// a whole, control as pips, the last five as W and L dots. Each is tinted from the active pack, hatches or says so
// when the value is not known (never a zero, never an empty chart that reads as "none"), and carries the served
// sentence as its accessibility label. Colour is never the only signal: a mark has a shape and a word beside it.

/// A league place among `of` clubs, best on the left: the club's place filled in the accent (a tie shares the size),
/// a hollow ring at its recent place, and the top and bottom fifths shaded so a strength and a weakness are visible.
/// Too early to call (no place) draws the shading and the dots alone. Drawn with Canvas, so it fits a tile or a row.
public struct PlaceStrip: View {
    let dimension: PlaceDimension
    let height: CGFloat
    let maxDot: CGFloat
    @Environment(\.theme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @EffectiveContrast private var contrast

    public init(_ dimension: PlaceDimension, height: CGFloat = 16, maxDot: CGFloat = 7) {
        self.dimension = dimension
        self.height = height
        self.maxDot = maxDot
    }

    public var body: some View {
        let palette = theme.palette(colorScheme: colorScheme, contrast: contrast)
        let accent = palette.isNeutral ? Color.accentColor : palette.accent
        let of = max(1, dimension.of)
        Canvas { ctx, size in
            let step = size.width / CGFloat(of)
            let dot = min(maxDot, step * 0.62)
            let midY = size.height / 2
            // The top and bottom fifths, the stated lines for a strength and a weakness
            let fifth = CGFloat((Double(of) / 5).rounded(.down)) * step
            ctx.fill(Path(roundedRect: CGRect(x: 0, y: 0, width: fifth, height: size.height), cornerRadius: 4), with: .color(Tone.good.color.opacity(0.14)))
            ctx.fill(Path(roundedRect: CGRect(x: size.width - fifth, y: 0, width: fifth, height: size.height), cornerRadius: 4), with: .color(Tone.bad.color.opacity(0.14)))
            for p in 1...of {
                let cx = step * (CGFloat(p) - 0.5)
                let mine = p == dimension.place
                let tied = dimension.place.map { p > $0 && p <= $0 + dimension.tiedWith } ?? false
                let d = mine ? dot * 1.7 : dot
                let color: Color = mine ? accent : (tied ? accent.opacity(0.45) : Color(nsColor: .quaternaryLabelColor))
                ctx.fill(Path(ellipseIn: CGRect(x: cx - d / 2, y: midY - d / 2, width: d, height: d)), with: .color(color))
                if dimension.recentPlace == p {
                    let r = mine ? dot * 2.5 : dot * 1.7
                    ctx.stroke(Path(ellipseIn: CGRect(x: cx - r / 2, y: midY - r / 2, width: r, height: r)), with: .color(accent), lineWidth: 1.5)
                }
            }
        }
        .frame(height: height)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: [dimension.name, dimension.placeText, dimension.recentText].joined(separator: ", ")))
    }
}

/// Strength or weakness, as a symbol and a word (never only the colour); nothing for the rest.
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
        case .rest, .tooEarly:
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
            Label { Text(verbatim: dimension.name) } icon: { Image(systemName: dimension.symbol).frame(width: 18) }
                .font(.body)
                .frame(width: wide ? 200 : 170, alignment: .leading)
            PlaceStrip(dimension).frame(maxWidth: 480)
            Spacer(minLength: 8)
            ClaimText(dimension.claim) {
                HStack(spacing: 6) {
                    StrengthMark(dimension.group)
                    Text(verbatim: dimension.placeText).font(.body.weight(.semibold)).monospacedDigit()
                }
            }
            .frame(width: 130, alignment: .trailing)
            Text(verbatim: dimension.recentText).font(.callout).foregroundStyle(.secondary).monospacedDigit()
                .frame(width: wide ? 120 : 96, alignment: .trailing)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("place.\(dimension.id)")
    }
}

/// "How we win and lose": the served dimensions in their served groups (strengths, weaknesses, the rest, too early),
/// each group under its structural header with the served policy line beside it, and the legend.
public struct PlaceStrips: View {
    let dimensions: [PlaceDimension]
    /// The policy lines as served, by group ("Top fifth of the league").
    let lines: [PlaceDimension.Group: String]
    let wide: Bool

    public init(_ dimensions: [PlaceDimension], lines: [PlaceDimension.Group: String], wide: Bool = true) {
        self.dimensions = dimensions
        self.lines = lines
        self.wide = wide
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            group(Text("Strengths"), .strength)
            group(Text("Weaknesses"), .weakness)
            group(Text("The rest"), .rest)
            group(Text("Too early to call"), .tooEarly)
            HStack(spacing: 14) {
                Label("Filled dot: this season", systemImage: "circle.fill")
                Label("Ring: the last 15 games", systemImage: "circle")
                Label("Shaded: the top and bottom fifths", systemImage: "rectangle.lefthalf.filled")
            }
            .font(.caption).foregroundStyle(.secondary).padding(.top, 4)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("placeStrips")
    }

    @ViewBuilder
    private func group(_ title: Text, _ group: PlaceDimension.Group) -> some View {
        let members = dimensions.filter { $0.group == group }
        if !members.isEmpty {
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    title.font(.headline)
                    if let line = lines[group] { Text(verbatim: line).font(.caption).foregroundStyle(.secondary) }
                }
                .padding(.top, 8)
                ForEach(members) { d in
                    PlaceRow(d, wide: wide).padding(.vertical, 3)
                    if d.id != members.last?.id { Divider() }
                }
            }
        }
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
                    Capsule().fill(accent).frame(width: 3, height: height + 4)
                        .offset(x: x(range.likely) - 1.5, y: -2)
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
            Text(verbatim: text).font(.caption.weight(.medium)).monospacedDigit().foregroundStyle(.secondary).frame(width: 58, alignment: .trailing)
        }
        .accessibilityElement(children: .combine)
    }
}

/// Control as small pips: one per season the club holds him, a hollow pip for a clock, a hatched pip when not known.
/// The served words are in the help tag and the accessibility label.
public struct ControlPips: View {
    let control: ControlTerm
    @Environment(\.theme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @EffectiveContrast private var contrast

    public init(_ control: ControlTerm) {
        self.control = control
    }

    public var body: some View {
        let palette = theme.palette(colorScheme: colorScheme, contrast: contrast)
        let accent = (palette.isNeutral ? Color.accentColor : palette.accent).opacity(0.8)
        HStack(spacing: 2) {
            switch control {
            case .seasons(let count, _):
                ForEach(0..<max(1, count), id: \.self) { _ in
                    RoundedRectangle(cornerRadius: 1).fill(accent).frame(width: 5, height: 7)
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
    }
}

/// The last five results, oldest first: a filled dot with a W, a hollow one with an L, on the masthead.
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
                    if result == .win {
                        Circle().fill(palette.mastheadText)
                        Text("W").font(.system(size: size * 0.55, weight: .bold)).foregroundStyle(palette.masthead.first ?? palette.mastheadTop)
                    } else {
                        Circle().strokeBorder(palette.mastheadText.opacity(0.7), lineWidth: 1.5)
                        Text("L").font(.system(size: size * 0.55, weight: .semibold)).foregroundStyle(palette.mastheadText)
                    }
                }
                .frame(width: size, height: size)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: label))
    }
}
