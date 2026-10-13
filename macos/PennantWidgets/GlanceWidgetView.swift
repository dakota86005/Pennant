import AppKit
import PennantDesign
import PennantGlance
import SwiftUI
import WidgetKit

/// The widget's face: the served glance in the small and medium families, or the catalog's words when there is none.
/// Every figure and sentence is the snapshot's, as served; the only words of its own are structural (the catalog).
struct GlanceWidgetView: View {
    let state: GlanceTimeline.State
    @Environment(\.widgetFamily) private var family
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.widgetRenderingMode) private var renderingMode

    var body: some View {
        let colors = GlanceColors(
            snapshot: state.snapshot, dark: colorScheme == .dark, increasedContrast: contrast == .increased,
            fullColor: renderingMode == .fullColor
        )
        Group {
            if let snapshot = state.snapshot {
                if family == .systemMedium {
                    HStack(alignment: .top, spacing: 14) {
                        summary(snapshot, colors: colors, showsDesk: false)
                        DeskColumn(desk: snapshot.desk, colors: colors)
                    }
                } else {
                    summary(snapshot, colors: colors, showsDesk: true)
                }
            } else {
                NothingYet(colors: colors)
            }
        }
        .foregroundStyle(colors.text)
        .containerBackground(for: .widget) { colors.background }
    }

    private func summary(_ snapshot: GlanceSnapshot, colors: GlanceColors, showsDesk: Bool) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            if let club = snapshot.club {
                Text(verbatim: club).font(.caption.weight(.semibold)).lineLimit(1)
            }
            if let record = snapshot.record {
                Text(verbatim: record.display)
                    .font(.system(size: 30, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .minimumScaleFactor(0.7)
                    .lineLimit(1)
                    .accessibilityLabel(Text(verbatim: record.spoken ?? record.display))
            }
            if let game = snapshot.nextGame {
                VStack(alignment: .leading, spacing: 0) {
                    Text(verbatim: game.when).font(.caption2.weight(.semibold))
                    Text(verbatim: game.matchup).font(.caption).lineLimit(1)
                }
                .accessibilityElement(children: .combine)
            }
            // A part not shown says why, in the server's sentence (never a blank read as nothing)
            ForEach(snapshot.missing, id: \.self) { line in
                Text(verbatim: line).font(.caption2).lineLimit(2)
            }
            Spacer(minLength: 0)
            if showsDesk {
                Text(verbatim: snapshot.desk.line).font(.caption.weight(.semibold)).lineLimit(1)
            }
            Footer(snapshot: snapshot, colors: colors)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

/// The desk: its served count in words and its first items, each with the department that raised it.
private struct DeskColumn: View {
    let desk: GlanceSnapshot.Desk
    let colors: GlanceColors

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(verbatim: desk.line).font(.caption.weight(.semibold)).lineLimit(1)
            ForEach(Array(desk.top.enumerated()), id: \.offset) { _, item in
                VStack(alignment: .leading, spacing: 0) {
                    Text(verbatim: item.headline).font(.caption2).lineLimit(2)
                    Text(verbatim: item.department).font(.caption2.weight(.semibold)).foregroundStyle(colors.secondary)
                }
                .accessibilityElement(children: .combine)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

/// How current, as facts: the served "as of" line (how current the data is), and when the app last wrote the glance, in
/// the system's relative time, which keeps itself current. Never "out of date": a glance not rewritten may still be the
/// latest there is (review N14A, M5).
private struct Footer: View {
    let snapshot: GlanceSnapshot
    let colors: GlanceColors

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(verbatim: snapshot.asOf)
            Text("Updated \(Text(snapshot.writtenAt, style: .relative)) ago")
        }
        .font(.caption2)
        .lineLimit(1)
        .minimumScaleFactor(0.8)
        .foregroundStyle(colors.secondary)
        .accessibilityElement(children: .combine)
    }
}

/// No glance yet: the app has not written one here (or this build cannot reach the App Group).
private struct NothingYet: View {
    let colors: GlanceColors

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Image(systemName: "baseball").font(.title2).accessibilityHidden(true)
            Spacer(minLength: 0)
            Text("Nothing to show yet").font(.headline)
            Text("Open Pennant to see your club").font(.caption).foregroundStyle(colors.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .accessibilityElement(children: .combine)
    }
}

/// The widget's colours (`GlanceInk`): in full colour, the club card's served pair when it reads (the server's own bar,
/// checked again here as the app checks what it draws), else Pennant's fixed, checked page and text colours; drawn tinted
/// or vibrant, the system's primary and secondary, which the system treats for that rendering (review N14A, M6). Text on
/// a club's colours takes its colour as served, never faded, so its quieter lines are the same colour, set smaller.
struct GlanceColors {
    var background: Color
    var text: Color
    var secondary: Color

    init(snapshot: GlanceSnapshot?, dark: Bool, increasedContrast: Bool, fullColor: Bool) {
        let ink = GlanceInk.choose(
            colors: snapshot?.colors, dark: dark, increasedContrast: increasedContrast, fullColor: fullColor
        ) { pair in
            guard let fill = ServedColor.components(pair.background), let ink = ServedColor.components(pair.text) else { return false }
            return Contrast.ratio(fill, ink) >= GlanceSnapshot.Colors.requiredRatio(increasedContrast: increasedContrast)
        }
        background = Color(nsColor: .readablePage)
        switch ink {
        case .system:
            text = .primary
            secondary = .secondary
        case .served(let pair):
            if let fill = ServedColor.color(pair.background), let served = ServedColor.color(pair.text) {
                background = fill
                text = served
                secondary = served
            } else {
                text = Color(nsColor: .labelColor)
                secondary = Color(nsColor: .readableSecondaryLabel)
            }
        case .fixed:
            text = Color(nsColor: .labelColor)
            secondary = Color(nsColor: .readableSecondaryLabel)
        }
    }
}
