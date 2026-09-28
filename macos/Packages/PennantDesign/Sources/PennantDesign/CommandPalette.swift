import SwiftUI

/// The ⌘K palette ("Find anything"): a floating glass panel over the window, its results grouped, keyboard first
/// (↑ and ↓ move, ↩ opens, esc closes). It is a control, so glass is allowed on it; with Reduce Transparency it is
/// opaque with a border. The entries are the registry's (departments, views, commands) and, once the server serves
/// search, players and clubs; their words are the caller's, and the palette adds only its labels.
public struct CommandPalette: View {
    let entries: [PaletteEntry]
    @Binding var query: String
    let open: (PaletteEntry) -> Void
    let dismiss: () -> Void
    @State private var selected = 0
    @FocusState private var focused: Bool
    @Environment(\.theme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @EffectiveContrast private var contrast
    @EffectiveReduceTransparency private var reduceTransparency

    /// How many results are shown at most; the footer says how many matched.
    public static let shown = 9

    public init(entries: [PaletteEntry], query: Binding<String>, open: @escaping (PaletteEntry) -> Void, dismiss: @escaping () -> Void) {
        self.entries = entries
        _query = query
        self.open = open
        self.dismiss = dismiss
    }

    private var matches: [PaletteEntry] { PaletteEntry.matching(query, in: entries) }

    public var body: some View {
        let palette = theme.palette(colorScheme: colorScheme, contrast: contrast)
        let accent = palette.isNeutral ? Color.accentColor : palette.accent
        let results = matches
        let visible = Array(results.prefix(Self.shown))
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass").foregroundStyle(.readableSecondary).accessibilityHidden(true)
                TextField("Find anything", text: $query)
                    .textFieldStyle(.plain)
                    .font(.title3)
                    .focused($focused)
                    .onSubmit { openSelected(visible) }
                    .onKeyPress(.downArrow) { move(1, in: visible); return .handled }
                    .onKeyPress(.upArrow) { move(-1, in: visible); return .handled }
                    .onKeyPress(.escape) { dismiss(); return .handled }
                    .accessibilityIdentifier("palette.query")
                Text("⌘K").font(.caption).foregroundStyle(.readableSecondary).accessibilityHidden(true)
            }
            .padding(.horizontal, 16).padding(.vertical, 12)
            Divider()
            if visible.isEmpty {
                Text("Nothing matches").font(.callout).foregroundStyle(.readableSecondary).padding(16)
            } else {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(Array(visible.enumerated()), id: \.element.id) { index, entry in
                        if index == 0 || visible[index - 1].group != entry.group {
                            Text(verbatim: entry.group).font(.caption.weight(.semibold)).foregroundStyle(.readableSecondary).textCase(.uppercase).kerning(0.6)
                                .padding(.horizontal, 12).padding(.top, index == 0 ? 8 : 10).padding(.bottom, 2)
                                .accessibilityAddTraits(.isHeader)
                        }
                        Button { open(entry) } label: {
                            HStack(spacing: 10) {
                                SymbolTile(symbol: entry.symbol, tint: accent, size: 26)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(verbatim: entry.title).font(.body.weight(.medium))
                                    if let line = entry.line { Text(verbatim: line).font(.caption).foregroundStyle(.readableSecondary) }
                                }
                                Spacer()
                                if let shortcut = entry.shortcut { Text(verbatim: shortcut).font(.caption).foregroundStyle(.readableSecondary) }
                                if index == selected { Text("↩").font(.caption).foregroundStyle(.readableSecondary).accessibilityHidden(true) }
                            }
                            .padding(.horizontal, 10).padding(.vertical, 6)
                            .background(index == selected ? accent.opacity(0.14) : .clear, in: .rect(cornerRadius: 8))
                            .overlay {
                                if index == selected, contrast == .increased { RoundedRectangle(cornerRadius: 8).strokeBorder(accent, lineWidth: 1) }
                            }
                            .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                        .onHover { if $0 { selected = index } }
                        .accessibilityAddTraits(index == selected ? .isSelected : [])
                        .accessibilityIdentifier("palette.result.\(entry.id)")
                    }
                }
                .padding(8)
            }
            Divider()
            HStack(spacing: 14) {
                Label("Open", systemImage: "return").font(.caption)
                Label("Close", systemImage: "escape").font(.caption)
                Spacer()
                // One format key ("%lld of %lld"), so a language can order the counts its own way
                Text("\(visible.count) of \(results.count)").font(.caption).foregroundStyle(.readableSecondary).monospacedDigit()
            }
            .foregroundStyle(.readableSecondary)
            .padding(.horizontal, 16).padding(.vertical, 8)
        }
        .frame(width: 640)
        .modifier(PanelGlass(reduceTransparency: reduceTransparency, increasedContrast: contrast == .increased))
        .defaultFocus($focused, true)
        // The query takes the keyboard as the palette opens, and again once the window has settled: on a Mac whose
        // window became key a moment late (GitHub's runner), the first request alone was lost
        .task {
            focused = true
            try? await Task.sleep(for: .milliseconds(120))
            if !focused { focused = true }
        }
        .onChange(of: query) { selected = 0 }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("palette")
    }

    private func move(_ by: Int, in visible: [PaletteEntry]) {
        guard !visible.isEmpty else { return }
        selected = (selected + by + visible.count) % visible.count
    }

    private func openSelected(_ visible: [PaletteEntry]) {
        guard visible.indices.contains(selected) else { return }
        open(visible[selected])
    }
}

/// The panel's glass, or, with Reduce Transparency, an opaque panel with a border.
struct PanelGlass: ViewModifier {
    let reduceTransparency: Bool
    let increasedContrast: Bool

    func body(content: Content) -> some View {
        if reduceTransparency {
            content
                .background(Color(nsColor: .windowBackgroundColor), in: .rect(cornerRadius: 18))
                .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Color(nsColor: .separatorColor), lineWidth: increasedContrast ? 1.5 : 0.5))
                .shadow(color: .black.opacity(0.25), radius: 30, y: 12)
        } else {
            content
                .glassEffect(.regular, in: .rect(cornerRadius: 18))
                .overlay {
                    if increasedContrast { RoundedRectangle(cornerRadius: 18).strokeBorder(.primary, lineWidth: 1) }
                }
                .shadow(color: .black.opacity(0.25), radius: 30, y: 12)
        }
    }
}
