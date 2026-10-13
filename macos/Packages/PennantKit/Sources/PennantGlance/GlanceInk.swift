/// The colours the widget's text is drawn in (review N14A, M6), worked out here so it is tested as a unit.
public enum GlanceInk: Equatable, Sendable {
    /// The system's primary and secondary: the widget is drawn tinted or vibrant (not in full colour), where the system
    /// draws the background and gives the text its own treatment, so a fixed or served colour is not what shows.
    case system
    /// The club card's served pair, which reads at the server's bar as drawn.
    case served(GlanceSnapshot.Pair)
    /// Pennant's fixed, checked page and text colours: team colours off, none served, or a pair that does not read.
    case fixed

    /// The ink for an appearance.
    /// - Parameters:
    ///   - fullColor: whether the widget is drawn in full colour (`WidgetRenderingMode.fullColor`).
    ///   - reads: whether a served pair reaches `GlanceSnapshot.Colors.requiredRatio` as drawn.
    public static func choose(
        colors: GlanceSnapshot.Colors?, dark: Bool, increasedContrast: Bool, fullColor: Bool,
        reads: (GlanceSnapshot.Pair) -> Bool
    ) -> GlanceInk {
        guard fullColor else { return .system }
        if let pair = colors?.pair(dark: dark, increasedContrast: increasedContrast), reads(pair) { return .served(pair) }
        return .fixed
    }
}
