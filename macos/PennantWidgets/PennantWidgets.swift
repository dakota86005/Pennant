import PennantGlance
import SwiftUI
import WidgetKit

/// Pennant's desktop widget (SWIFTUI_REBUILD.md section 6; N14, Stage A, D-075): the record, the next game and the desk,
/// as the app was last served them. It reads the glance the app writes to their shared App Group and never calls the
/// server; it writes no sentence of its own beyond the catalog's structural words for "nothing yet" and "out of date".
@main
struct PennantWidgets: WidgetBundle {
    var body: some Widget {
        GlanceWidget()
    }
}

struct GlanceWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: GlanceTimeline.widgetKind, provider: GlanceProvider()) { entry in
            GlanceWidgetView(state: entry.state)
        }
        .configurationDisplayName("Pennant")
        .description("Your record, next game and desk")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

/// One moment of the widget.
struct GlanceEntry: TimelineEntry {
    let date: Date
    let state: GlanceTimeline.State
}

/// Reads the snapshot and hands WidgetKit `GlanceTimeline`'s entries. The app asks for a reload after each snapshot it
/// writes, so the timeline itself never asks again (`.never`).
struct GlanceProvider: TimelineProvider {
    var store: GlanceSnapshotStore = AppGroup.glanceStore()

    func placeholder(in context: Context) -> GlanceEntry {
        GlanceEntry(date: Date(), state: .none)
    }

    func getSnapshot(in context: Context, completion: @escaping (GlanceEntry) -> Void) {
        let now = Date()
        completion(GlanceEntry(date: now, state: GlanceTimeline.state(of: store.read(), at: now)))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<GlanceEntry>) -> Void) {
        let entries = GlanceTimeline.entries(for: store.read(), at: Date()).map { GlanceEntry(date: $0.date, state: $0.state) }
        completion(Timeline(entries: entries, policy: .never))
    }
}
