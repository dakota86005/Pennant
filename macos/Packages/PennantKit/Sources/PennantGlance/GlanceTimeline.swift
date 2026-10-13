import Foundation

/// What the widget shows when (N14, Stage A): the timeline its provider hands WidgetKit, worked out here so it is tested
/// as a unit. The widget is told to reload whenever the app writes a new snapshot, and between writes nothing it draws
/// changes but the snapshot's age, which the system's own relative time keeps current (`Text(_:style: .relative)`). It
/// never calls a snapshot "out of date": a glance the app has not rewritten may still be the latest there is, so the
/// widget states facts, the served "as of" and when the app last wrote it (review N14A, M5).
public enum GlanceTimeline {
    /// The widget's kind: the app asks WidgetKit to reload it by this name after each snapshot it writes.
    public static let widgetKind = "PennantGlance"

    /// What one entry draws.
    public enum State: Equatable, Sendable {
        /// No snapshot yet: the app has not written one (or could not reach the App Group).
        case none
        /// The snapshot, with its served words and when it was written.
        case shown(GlanceSnapshot)

        public var snapshot: GlanceSnapshot? {
            switch self {
            case .none: nil
            case .shown(let snapshot): snapshot
            }
        }
    }

    /// The state for a snapshot, however old.
    public static func state(of snapshot: GlanceSnapshot?) -> State {
        snapshot.map(State.shown) ?? .none
    }

    /// The entries from `now`: one, since nothing changes until the app writes again.
    public static func entries(for snapshot: GlanceSnapshot?, at now: Date) -> [(date: Date, state: State)] {
        [(now, state(of: snapshot))]
    }
}
