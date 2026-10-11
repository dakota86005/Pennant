import Foundation

/// What the widget shows when (N14, Stage A): the timeline its provider hands WidgetKit, worked out here so it is tested
/// as a unit. The widget is told to reload whenever the app writes a new snapshot; between writes the only change is a
/// snapshot growing old.
public enum GlanceTimeline {
    /// The widget's kind: the app asks WidgetKit to reload it by this name after each snapshot it writes.
    public static let widgetKind = "PennantGlance"

    /// After how long a snapshot is drawn as out of date: a day without the app refreshing it. The app's own freshness
    /// rule about its own file, not a baseball one; the served "as of" line says how current the data itself is.
    public static let outOfDateAfter: TimeInterval = 24 * 60 * 60

    /// What one entry draws.
    public enum State: Equatable, Sendable {
        /// No snapshot yet: the app has not written one (or could not reach the App Group).
        case none
        case current(GlanceSnapshot)
        /// Older than `outOfDateAfter`: drawn with its served words, and marked out of date.
        case outOfDate(GlanceSnapshot)

        public var snapshot: GlanceSnapshot? {
            switch self {
            case .none: nil
            case .current(let snapshot), .outOfDate(let snapshot): snapshot
            }
        }
    }

    /// The state at a moment. A snapshot written after `now` (the clock moved back) is current until a day after it
    /// says it was written.
    public static func state(of snapshot: GlanceSnapshot?, at now: Date) -> State {
        guard let snapshot else { return .none }
        return now.timeIntervalSince(snapshot.writtenAt) >= outOfDateAfter ? .outOfDate(snapshot) : .current(snapshot)
    }

    /// The entries from `now`: what shows now and, while the snapshot is current, the moment it turns out of date.
    public static func entries(for snapshot: GlanceSnapshot?, at now: Date) -> [(date: Date, state: State)] {
        let first = state(of: snapshot, at: now)
        guard case .current(let current) = first else { return [(now, first)] }
        // Current means the moment it turns is still ahead (a snapshot from the future turns a day after it says)
        return [(now, first), (current.writtenAt.addingTimeInterval(outOfDateAfter), .outOfDate(current))]
    }
}
