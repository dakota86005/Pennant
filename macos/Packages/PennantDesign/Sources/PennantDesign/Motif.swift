import PennantAPI
import SwiftUI

// The Mac motif the owner pointed at (Mail, the Siri app, Now Playing, a menu-bar utility; Craft, Raycast, Bear,
// Freeform): symbols in tinted rounded squares, a bold title with one grey line, small-caps group headers, metric
// tiles, status pills, capsule chips, grouped cards with hairlines. Every card takes the club's colour faintly from the
// active pack (`Theme.Palette.wash`), never a colour of Swift's own; with Increase Contrast each card gets a border.

/// An opaque grouped card with a concentric corner (children use `Corner.inner`), washed in the pack's accent.
public struct Card<Content: View>: View {
    let padding: CGFloat
    @ViewBuilder let content: () -> Content
    @Environment(\.theme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @EffectiveContrast private var contrast

    public init(padding: CGFloat = Corner.cardPadding, @ViewBuilder content: @escaping () -> Content) {
        self.padding = padding
        self.content = content
    }

    public var body: some View {
        let palette = theme.palette(colorScheme: colorScheme, contrast: contrast)
        content()
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(palette.wash(.card, in: colorScheme), in: .rect(cornerRadius: Corner.card))
            .overlay {
                if contrast == .increased { RoundedRectangle(cornerRadius: Corner.card).strokeBorder(.primary, lineWidth: 1) }
            }
    }
}

/// A grouped card of rows with hairlines between them (the utility panel's blocks).
public struct RowGroup<Content: View>: View {
    @ViewBuilder let content: () -> Content

    public init(@ViewBuilder content: @escaping () -> Content) {
        self.content = content
    }

    public var body: some View {
        Card(padding: 0) {
            VStack(alignment: .leading, spacing: 0) { content() }.padding(.horizontal, 14)
        }
    }
}

/// An SF Symbol in a tinted rounded square (the utility panel's rows, Mail's chips). Decorative.
public struct SymbolTile: View {
    let symbol: String
    let tint: Color
    let size: CGFloat

    public init(symbol: String, tint: Color, size: CGFloat = 28) {
        self.symbol = symbol
        self.tint = tint
        self.size = size
    }

    public var body: some View {
        Image(systemName: symbol)
            .font(.system(size: size * 0.5, weight: .semibold))
            .foregroundStyle(tint)
            .frame(width: size, height: size)
            .background(tint.opacity(0.16), in: .rect(cornerRadius: size * 0.28))
            .accessibilityHidden(true)
    }
}

/// A status pill: a dot, a word, a tone. The word is always there.
public struct Pill<Content: View>: View {
    let tone: Tone
    @ViewBuilder let content: () -> Content

    public init(tone: Tone, @ViewBuilder content: @escaping () -> Content) {
        self.tone = tone
        self.content = content
    }

    public var body: some View {
        HStack(spacing: 5) {
            Circle().fill(tone.color).frame(width: 6, height: 6).accessibilityHidden(true)
            content().font(.caption.weight(.semibold))
        }
        .padding(.horizontal, 8).padding(.vertical, 3)
        .background(tone.color.opacity(0.14), in: .capsule)
        .accessibilityElement(children: .combine)
    }
}

extension Pill where Content == Text {
    /// A served word in a pill.
    public init(_ served: String, tone: Tone) {
        self.init(tone: tone) { Text(verbatim: served) }
    }
}

/// A small-caps group header ("Strengths"), with a served note and a served count beside it.
public struct GroupHeader: View {
    let title: Text
    let note: String?
    let trailing: String?

    public init(_ title: Text, note: String? = nil, trailing: String? = nil) {
        self.title = title
        self.note = note
        self.trailing = trailing
    }

    public var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            title.font(.caption.weight(.semibold)).foregroundStyle(.secondary).textCase(.uppercase).kerning(0.6)
            if let note { Text(verbatim: note).font(.caption).foregroundStyle(.secondary) }
            Spacer()
            if let trailing { Text(verbatim: trailing).font(.caption).foregroundStyle(.secondary).monospacedDigit() }
        }
    }
}

/// A utility-panel row: the symbol tile, a bold title, one grey line, and something trailing.
public struct UtilityRow<Trailing: View>: View {
    let symbol: String
    let tint: Color
    let title: Text
    let line: Text?
    @ViewBuilder let trailing: () -> Trailing

    public init(symbol: String, tint: Color, title: Text, line: Text? = nil, @ViewBuilder trailing: @escaping () -> Trailing = { EmptyView() }) {
        self.symbol = symbol
        self.tint = tint
        self.title = title
        self.line = line
        self.trailing = trailing
    }

    public var body: some View {
        HStack(alignment: .center, spacing: 12) {
            SymbolTile(symbol: symbol, tint: tint)
            VStack(alignment: .leading, spacing: 2) {
                title.font(.body.weight(.semibold)).lineLimit(2).fixedSize(horizontal: false, vertical: true)
                if let line { line.font(.callout).foregroundStyle(.secondary).lineLimit(2).fixedSize(horizontal: false, vertical: true) }
            }
            Spacer(minLength: 8)
            trailing()
        }
        .padding(.vertical, 8)
    }
}

/// A metric tile: a served figure's small-caps label and its big value, its basis one click away, a ring beside the
/// value when the figure is a real share of a whole. The inner corner is concentric with the card's.
public struct MetricTile: View {
    let figure: Figure
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(_ figure: Figure) {
        self.figure = figure
    }

    public var body: some View {
        ClaimText(figure.claim) {
            VStack(alignment: .leading, spacing: 4) {
                // The served label may wrap to a second line rather than truncate ("On the injured list")
                Text(verbatim: figure.claim.text).font(.caption2.weight(.semibold)).kerning(0.5).textCase(.uppercase)
                    .foregroundStyle(.secondary).lineLimit(2).minimumScaleFactor(0.85).fixedSize(horizontal: false, vertical: true)
                HStack(alignment: .lastTextBaseline, spacing: 8) {
                    Text(verbatim: figure.claim.value?.display ?? figure.claim.text)
                        .font(.system(size: 22, weight: .bold)).fontWidth(.condensed).monospacedDigit().lineLimit(1)
                        .minimumScaleFactor(0.72)
                        .contentTransition(reduceMotion ? .identity : .numericText())
                    if let fraction = figure.fraction { Ring(fraction: fraction, size: 18, line: 3) }
                }
            }
            .padding(.horizontal, 10).padding(.vertical, 9)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(nsColor: .controlBackgroundColor).opacity(0.7), in: .rect(cornerRadius: Corner.inner))
            .overlay(RoundedRectangle(cornerRadius: Corner.inner).strokeBorder(Color(nsColor: .separatorColor), lineWidth: 0.5))
        }
    }
}

/// "Since the last export": a leading label filled in the accent, then each served chip as a capsule the GM can open.
public struct ChipRow: View {
    let label: Text
    let chips: [Chip]
    let open: (Chip) -> Void
    @Environment(\.theme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @EffectiveContrast private var contrast

    public init(label: Text, chips: [Chip], open: @escaping (Chip) -> Void = { _ in }) {
        self.label = label
        self.chips = chips
        self.open = open
    }

    public var body: some View {
        let palette = theme.palette(colorScheme: colorScheme, contrast: contrast)
        HStack(spacing: 8) {
            label
                .font(.callout.weight(.semibold))
                .padding(.horizontal, 12).padding(.vertical, 6)
                .foregroundStyle(palette.isNeutral ? Color.white : palette.accentText)
                .background(palette.isNeutral ? Color.accentColor : palette.accent, in: .capsule)
            ForEach(chips) { chip in
                Button { open(chip) } label: {
                    Label { Text(verbatim: chip.text) } icon: { Image(systemName: chip.symbol) }
                        .font(.callout.weight(.medium))
                        .padding(.horizontal, 11).padding(.vertical, 6)
                        .background(palette.wash(.chip, in: colorScheme), in: .capsule)
                        .overlay(Capsule().strokeBorder(Color(nsColor: .separatorColor), lineWidth: contrast == .increased ? 1 : 0))
                        .contentShape(.capsule)
                }
                .buttonStyle(.plain)
                .help(Text(verbatim: chip.hint))
            }
            Spacer()
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("chips")
    }
}

/// One item on the desk: how urgent the department said it is as a symbol tile, the served headline as a claim, the
/// urgency, the clock and who raised it beneath (a claim too: why it sits where it does), and whatever the caller adds
/// trailing (the staff's options).
public struct DeskRow<Trailing: View>: View {
    let item: Components.Schemas.FoItem
    let showsDepartment: Bool
    let compact: Bool
    @ViewBuilder let trailing: () -> Trailing

    /// - Parameters:
    ///   - showsDepartment: writes who raised it (on the desk, where every department's items are merged).
    ///   - compact: the side column's tighter row.
    public init(_ item: Components.Schemas.FoItem, showsDepartment: Bool = true, compact: Bool = false, @ViewBuilder trailing: @escaping () -> Trailing = { EmptyView() }) {
        self.item = item
        self.showsDepartment = showsDepartment
        self.compact = compact
        self.trailing = trailing
    }

    public var body: some View {
        let tone = Tone(item.urgency.tone)
        HStack(alignment: .center, spacing: 12) {
            SymbolTile(symbol: tone.symbol, tint: tone.color, size: compact ? 26 : 30)
            VStack(alignment: .leading, spacing: 2) {
                ClaimText(item.headline, edge: .trailing) {
                    Text(verbatim: item.headline.text)
                        .font(compact ? .callout.weight(.semibold) : .body.weight(.semibold))
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                }
                ClaimText(item.urgency, edge: .trailing) {
                    Text(verbatim: line)
                        .font(compact ? .caption : .callout)
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .accessibilityIdentifier("item.urgency.basis")
                if let detail = item.detail {
                    Text(verbatim: detail.display)
                        .font(compact ? .caption : .callout)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .help(detail.hint.map { Text(verbatim: $0) } ?? Text(verbatim: detail.display))
                }
            }
            Spacer(minLength: 8)
            trailing()
        }
        .padding(.vertical, compact ? 7 : 9)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("item.\(item.key)")
    }

    private var line: String {
        [item.urgency.text, item.due?.display, showsDepartment ? item.raisedBy.display : nil]
            .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
    }
}

/// A department's tile on the Morning Report: its symbol, its served name and who prepared it, a pill with what it
/// has to decide, its served key figures as metric tiles, its summary line, and the way into its report.
public struct DepartmentTile: View {
    let card: Components.Schemas.DepartmentCard
    let symbol: String
    let open: (() -> Void)?
    @Environment(\.theme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @EffectiveContrast private var contrast

    /// - Parameters:
    ///   - symbol: the department's SF Symbol, from the registry.
    ///   - open: opens its report; nil when this build has none (no way in is drawn).
    public init(_ card: Components.Schemas.DepartmentCard, symbol: String, open: (() -> Void)?) {
        self.card = card
        self.symbol = symbol
        self.open = open
    }

    public var body: some View {
        let palette = theme.palette(colorScheme: colorScheme, contrast: contrast)
        let tint = palette.isNeutral ? Color.accentColor : palette.accent
        Card {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 10) {
                    SymbolTile(symbol: symbol, tint: tint, size: 30)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(verbatim: card.name).font(.headline).lineLimit(1)
                        Text(verbatim: card.preparedBy.display).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                            .help(card.preparedBy.hint.map { Text(verbatim: $0) } ?? Text(verbatim: card.preparedBy.display))
                    }
                    Spacer(minLength: 0)
                    if let count = card.toDecide, count > 0 {
                        Pill(tone: .caution) {
                            Text("\(count) to decide")
                        }
                    }
                }
                if !card.figures.isEmpty {
                    HStack(spacing: 8) {
                        ForEach(Array(card.figures.enumerated()), id: \.offset) { index, claim in
                            MetricTile(Figure(claim, id: "\(card.department.rawValue).\(index)"))
                        }
                    }
                }
                // The one-sentence summary as served, its basis a click away
                HStack(spacing: 6) {
                    ToneMark(served: card.summary.tone).font(.caption)
                    ClaimText(card.summary, edge: .trailing) {
                        Text(verbatim: card.summary.text).font(.callout).multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                    }
                }
                if let open {
                    Button(action: open) {
                        HStack(spacing: 6) {
                            Text("Open Report").font(.callout)
                            Spacer(minLength: 4)
                            Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
                        }
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("card.open.\(card.department.rawValue)")
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("card.\(card.department.rawValue)")
    }
}

extension Components.Schemas.DeptId {
    /// The served department's id, whether this build knows it or not.
    public var rawValue: String { value1?.rawValue ?? value2 ?? "" }
}

/// A department with no report yet: its symbol and served name, one grey line, a chevron.
public struct DepartmentPlaceholderRow: View {
    let card: Components.Schemas.DepartmentCard
    let symbol: String

    public init(_ card: Components.Schemas.DepartmentCard, symbol: String) {
        self.card = card
        self.symbol = symbol
    }

    public var body: some View {
        UtilityRow(symbol: symbol, tint: Color.secondary, title: Text(verbatim: card.name), line: Text(verbatim: card.summary.text)) {
            Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
        }
        .help(card.summary.hint.map { Text(verbatim: $0) } ?? Text(verbatim: card.summary.text))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("card.\(card.department.rawValue)")
    }
}

/// One entry on the league wire: the club's abbreviation in a tile, its name (a star when followed), what happened,
/// and when.
public struct WireRow: View {
    let item: WireItem
    @Environment(\.theme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @EffectiveContrast private var contrast

    public init(_ item: WireItem) {
        self.item = item
    }

    public var body: some View {
        let palette = theme.palette(colorScheme: colorScheme, contrast: contrast)
        let tint = item.followed ? (palette.isNeutral ? Color.accentColor : palette.accent) : Color.secondary
        HStack(alignment: .center, spacing: 12) {
            Text(verbatim: item.abbreviation)
                .font(.caption.weight(.bold))
                .foregroundStyle(tint)
                .frame(width: 28, height: 28)
                .background(tint.opacity(0.14), in: .rect(cornerRadius: 8))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(verbatim: item.club).font(.body.weight(.semibold))
                    if item.followed {
                        Image(systemName: "star.fill").font(.caption2).foregroundStyle(Tone.caution.color)
                            .accessibilityLabel(Text("Followed"))
                    }
                }
                Text(verbatim: item.text).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            Spacer()
            Text(verbatim: item.when).font(.caption).foregroundStyle(.secondary)
        }
        .padding(.vertical, 7)
        .accessibilityElement(children: .combine)
    }
}

/// The rotation or the bullpen beside the roster diagram: role, name, a served note, the line, and the range bar on the
/// diagram's served scale.
public struct StaffColumn: View {
    let title: Text
    let pitchers: [StaffPitcher]
    let scale: ValueScale

    public init(title: Text, pitchers: [StaffPitcher], scale: ValueScale) {
        self.title = title
        self.pitchers = pitchers
        self.scale = scale
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            title.font(.caption.weight(.semibold)).foregroundStyle(.secondary).textCase(.uppercase).kerning(0.6)
            ForEach(pitchers) { p in
                HStack(spacing: 8) {
                    Text(verbatim: p.role).font(.caption2.weight(.bold)).foregroundStyle(.secondary).frame(width: 26, alignment: .leading)
                    Text(verbatim: p.name).font(.callout.weight(.medium)).lineLimit(1)
                    Spacer(minLength: 4)
                    if let note = p.note {
                        Text(verbatim: note).font(.caption2).foregroundStyle(Tone.caution.color).lineLimit(1)
                    }
                    Text(verbatim: p.line).font(.caption).monospacedDigit().foregroundStyle(.secondary)
                    RangeBar(range: p.value, label: p.hint, scale: scale, height: 5).frame(width: 54)
                }
                .help(Text(verbatim: p.hint))
                .accessibilityElement(children: .combine)
            }
        }
    }
}
