import PennantAPI
import SwiftUI

// The roster diagram (SWIFTUI_REBUILD.md section 3.4, item 4; the design's V2): a precise geometric field in one pack
// tone, the nine positions as nodes on it, radial hairlines to compact plates carrying the holder, his range bar, his
// most likely value, his place and his control as pips. A need Major League Ops raised is a ring on the node, the
// word on the plate and a tinted edge. Hover says who is behind him and the farm's next man; a click opens the basis.
// The diagram draws what it is given and adds no judgment: every sentence and number is served.

/// The field as geometry: home plate, the bases, the mound, the fence, and where each position stands.
nonisolated public struct FieldGeometry: Sendable {
    public let size: CGSize
    public let home: CGPoint
    /// The diamond's side (90 feet).
    public let side: CGFloat
    public let fenceRadius: CGFloat

    public init(size: CGSize) {
        self.size = size
        home = CGPoint(x: size.width * 0.5, y: size.height * 0.85)
        fenceRadius = min(size.height * 0.80, size.width * 0.62)
        side = fenceRadius / 3.4   // the fence sits about three and a half diamonds out, as a park does
    }

    public var first: CGPoint { CGPoint(x: home.x + side, y: home.y - side) }
    public var second: CGPoint { CGPoint(x: home.x, y: home.y - 2 * side) }
    public var third: CGPoint { CGPoint(x: home.x - side, y: home.y - side) }
    public var mound: CGPoint { CGPoint(x: home.x, y: home.y - side * 0.95) }   // 60.5 of 127 feet to second

    /// A point `feet` from home along a bearing (0 = straight out to centre, ±45 = the foul lines).
    public func point(feet: CGFloat, bearing degrees: CGFloat) -> CGPoint {
        let scale = side / 90
        let a = (-90 + degrees) * .pi / 180
        return CGPoint(x: home.x + cos(a) * feet * scale, y: home.y + sin(a) * feet * scale)
    }

    public func wedge(radius: CGFloat) -> Path {
        var p = Path()
        p.move(to: home)
        p.addArc(center: home, radius: radius, startAngle: .degrees(-135), endAngle: .degrees(-45), clockwise: false)
        p.closeSubpath()
        return p
    }

    public var diamond: Path {
        var p = Path()
        p.move(to: home); p.addLine(to: first); p.addLine(to: second); p.addLine(to: third); p.closeSubpath()
        return p
    }

    /// Where each position stands: the infield in feet, the outfield by the fence, the DH off the field by the dugout.
    public func spot(_ pos: String) -> CGPoint {
        let feetPerPoint = 90 / side
        switch pos {
        case "C": return CGPoint(x: home.x, y: home.y + side * 0.14)
        case "1B": return point(feet: 118, bearing: 40)
        case "2B": return point(feet: 145, bearing: 14)
        case "SS": return point(feet: 145, bearing: -14)
        case "3B": return point(feet: 118, bearing: -40)
        case "LF": return point(feet: fenceRadius * feetPerPoint * 0.74, bearing: -30)
        case "CF": return point(feet: fenceRadius * feetPerPoint * 0.80, bearing: 0)
        case "RF": return point(feet: fenceRadius * feetPerPoint * 0.74, bearing: 30)
        default: return CGPoint(x: home.x + side * 1.6, y: home.y + side * 0.02)
        }
    }

    /// Where a position's plate sits, away from its node.
    public func plate(_ pos: String) -> CGPoint {
        let s = spot(pos)
        switch pos {
        case "C": return CGPoint(x: s.x, y: s.y + 40)
        case "1B": return CGPoint(x: s.x + 112, y: s.y + 4)
        case "3B": return CGPoint(x: s.x - 112, y: s.y + 4)
        case "2B": return CGPoint(x: s.x + 96, y: s.y - 44)
        case "SS": return CGPoint(x: s.x - 96, y: s.y - 44)
        case "LF": return CGPoint(x: s.x - 40, y: s.y - 44)
        case "CF": return CGPoint(x: s.x, y: s.y - 44)
        case "RF": return CGPoint(x: s.x + 40, y: s.y - 44)
        default: return CGPoint(x: s.x + 40, y: s.y + 40)
        }
    }
}

/// The field as geometry only, tinted by the pack: the outfield arc, the foul lines, the infield square, the infield
/// arc, the mound and the bases as small marks.
public struct FlatField: View {
    @Environment(\.theme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @EffectiveContrast private var contrast

    public init() {}

    public var body: some View {
        let palette = theme.palette(colorScheme: colorScheme, contrast: contrast)
        let accent = palette.isNeutral ? Color.accentColor : palette.accent
        let line = contrast == .increased ? accent : accent.opacity(colorScheme == .dark ? 0.55 : 0.45)
        Canvas { ctx, size in
            let g = FieldGeometry(size: size)
            let fair = g.wedge(radius: g.fenceRadius)
            ctx.fill(fair, with: .color(palette.wash(.field, in: colorScheme)))
            ctx.fill(g.diamond, with: .color(palette.wash(.fieldInner, in: colorScheme)))
            var arc = Path()
            arc.addArc(center: g.home, radius: g.fenceRadius, startAngle: .degrees(-135), endAngle: .degrees(-45), clockwise: false)
            ctx.stroke(arc, with: .color(line), lineWidth: 1.5)
            for b: CGFloat in [-45, 45] {
                var p = Path(); p.move(to: g.home); p.addLine(to: g.point(feet: g.fenceRadius / (g.side / 90), bearing: b))
                ctx.stroke(p, with: .color(line), lineWidth: 1)
            }
            ctx.stroke(g.diamond, with: .color(line), lineWidth: 1)
            // The 95-foot arc between the foul lines, centred on the mound
            let scale = g.side / 90
            let r = 95 * scale
            let m = g.home.y - g.mound.y
            let t = (m * 2.0.squareRoot() + (2 * m * m - 4 * (m * m - r * r)).squareRoot()) / 2
            let right = CGPoint(x: g.home.x + t / 2.0.squareRoot(), y: g.home.y - t / 2.0.squareRoot())
            let left = CGPoint(x: g.home.x - t / 2.0.squareRoot(), y: g.home.y - t / 2.0.squareRoot())
            let a1 = atan2(right.y - g.mound.y, right.x - g.mound.x)
            let a2 = atan2(left.y - g.mound.y, left.x - g.mound.x)
            var inf = Path()
            inf.addArc(center: g.mound, radius: r, startAngle: .radians(a1), endAngle: .radians(a2), clockwise: true)
            ctx.stroke(inf, with: .color(line), lineWidth: 1)
            ctx.fill(Path(ellipseIn: CGRect(x: g.mound.x - 4, y: g.mound.y - 4, width: 8, height: 8)), with: .color(line))
            for b in [g.first, g.second, g.third] {
                var p = Path(CGRect(x: -4, y: -4, width: 8, height: 8))
                p = p.applying(CGAffineTransform(translationX: b.x, y: b.y).rotated(by: .pi / 4))
                ctx.fill(p, with: .color(line))
            }
            ctx.fill(Path(ellipseIn: CGRect(x: g.home.x - 4, y: g.home.y - 4, width: 8, height: 8)), with: .color(line))
        }
        .accessibilityHidden(true)
    }
}

/// A position's node on the field: a filled dot; a need is a tinted ring around it (and the word on its plate).
public struct FieldNode: View {
    let need: Bool
    @Environment(\.theme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @EffectiveContrast private var contrast

    public init(need: Bool) {
        self.need = need
    }

    public var body: some View {
        let palette = theme.palette(colorScheme: colorScheme, contrast: contrast)
        let accent = palette.isNeutral ? Color.accentColor : palette.accent
        ZStack {
            if need { Circle().strokeBorder(Tone.caution.color, lineWidth: 2.5).frame(width: 22, height: 22) }
            Circle().fill(accent).frame(width: 11, height: 11)
                .overlay(Circle().strokeBorder(Color(nsColor: .windowBackgroundColor), lineWidth: 2))
        }
        .accessibilityHidden(true)
    }
}

/// The compact figures a position carries: the range bar with its mark, the served value, the served place.
public struct PositionFigures: View {
    let position: RosterPosition
    let barWidth: CGFloat

    public init(_ position: RosterPosition, barWidth: CGFloat = 56) {
        self.position = position
        self.barWidth = barWidth
    }

    public var body: some View {
        HStack(spacing: 8) {
            RangeBar(range: position.value, label: position.value?.text ?? position.valueText, height: 5).frame(width: barWidth)
            Text(verbatim: position.valueText).font(.system(size: 11, weight: .semibold)).fontWidth(.condensed).monospacedDigit()
                .foregroundStyle(position.value == nil ? .secondary : .primary).lineLimit(1)
            Text(verbatim: position.placeText).font(.system(size: 11)).fontWidth(.condensed).monospacedDigit()
                .foregroundStyle(.secondary).lineLimit(1)
        }
    }
}

/// The roster diagram (V2): the tonal field, the nodes, radial hairlines and the plates. The diagram is given its
/// height by the caller (540 points reads well; the plates keep their size).
public struct RosterDiagram: View {
    let positions: [RosterPosition]
    @Environment(\.theme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @EffectiveContrast private var contrast

    public init(_ positions: [RosterPosition]) {
        self.positions = positions
    }

    public var body: some View {
        let palette = theme.palette(colorScheme: colorScheme, contrast: contrast)
        let accent = palette.isNeutral ? Color.accentColor : palette.accent
        GeometryReader { proxy in
            let g = FieldGeometry(size: proxy.size)
            ZStack {
                FlatField()
                Canvas { ctx, _ in
                    for position in positions {
                        var path = Path(); path.move(to: g.spot(position.id)); path.addLine(to: g.plate(position.id))
                        ctx.stroke(path, with: .color(accent.opacity(0.5)), lineWidth: 1)
                    }
                }
                .accessibilityHidden(true)
                ForEach(positions) { position in FieldNode(need: position.need).position(g.spot(position.id)) }
                ForEach(positions) { position in PositionPlate(position).position(g.plate(position.id)) }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Roster diagram"))
        .accessibilityIdentifier("rosterDiagram")
    }
}

/// A position's plate: the position badge, the holder, the word "Need" when Major League Ops raised one, his control
/// as pips, and his figures. Hover shows who is behind him and the farm's next man; a click opens the basis.
public struct PositionPlate: View {
    let position: RosterPosition
    @Environment(\.theme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @EffectiveContrast private var contrast
    @State private var hovering = false

    public init(_ position: RosterPosition) {
        self.position = position
    }

    public var body: some View {
        let palette = theme.palette(colorScheme: colorScheme, contrast: contrast)
        let accent = palette.isNeutral ? Color.accentColor : palette.accent
        let accentText = palette.isNeutral ? Color.white : palette.accentText
        ClaimText(position.claim) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(verbatim: position.id).font(.system(size: 10, weight: .bold)).foregroundStyle(accentText)
                        .padding(.horizontal, 4).padding(.vertical, 1).background(accent, in: .rect(cornerRadius: 3))
                    Text(verbatim: position.holder).font(.system(size: 13, weight: .semibold)).lineLimit(1)
                    if position.need { Text("Need").font(.system(size: 9, weight: .bold)).foregroundStyle(Tone.caution.color) }
                    Spacer(minLength: 0)
                    ControlPips(position.control)
                }
                PositionFigures(position)
                if hovering {
                    VStack(alignment: .leading, spacing: 1) {
                        LabeledContent("Behind him") { Text(verbatim: position.behind) }
                        if let farmNext = position.farmNext {
                            LabeledContent("Farm's next man") { Text(verbatim: farmNext) }
                        }
                    }
                    .font(.system(size: 10)).foregroundStyle(.secondary).lineLimit(1)
                    .transition(.opacity)
                }
            }
            .padding(.horizontal, 9).padding(.vertical, 7)
            .frame(width: 202, alignment: .leading)
            .background(Color(nsColor: .windowBackgroundColor), in: .rect(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(accent.opacity(position.need ? 0 : 0.25), lineWidth: contrast == .increased ? 1.5 : 1))
            .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Tone.caution.color.opacity(position.need ? 0.9 : 0), lineWidth: 1.5))
            .shadow(color: .black.opacity(0.06), radius: 4, y: 1)
        }
        .onHover { hovering = $0 }
        .accessibilityCustomContent(Text("Behind him"), Text(verbatim: position.behind))
        .accessibilityCustomContent(Text("Farm's next man"), Text(verbatim: position.farmNext ?? ""))
        .accessibilityIdentifier("position.\(position.id)")
    }
}

/// The diagram's legend: what the band, the pips, the ring and a click mean.
public struct RosterLegend: View {
    public init() {}

    public var body: some View {
        HStack(spacing: 14) {
            Label("Range: what he's worth beyond his pay, most likely value marked · hatched: not valued yet", systemImage: "rectangle.lefthalf.filled")
            Label("Pips: seasons we control him", systemImage: "square.grid.3x1.below.line.grid.1x2")
            Label("Ring and word: a need Major League Ops raised", systemImage: "circle.circle").foregroundStyle(Tone.caution.color)
            Label("Hover for more; click for the basis", systemImage: "cursorarrow.click")
        }
        .font(.caption).foregroundStyle(.secondary)
    }
}
