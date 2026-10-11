import AppKit
import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

/// The menu bar extra's window (SWIFTUI_REBUILD.md section 3.1; N14, Stage A, D-075): off until the GM turns it on in
/// Settings ▸ General, then the served record, next game and desk count with its first items, and Open Pennant. Every
/// figure and sentence is the served glance (`IntegrationStore`); the help tags are the claims' own. Content on an
/// opaque, checked page, as everywhere in Pennant; the menu bar's own panel is the controls layer around it.
public struct MenuBarGlanceView: View {
    @Environment(AppModel.self) private var model
    /// Brings Pennant's main window forward (or opens one) on the Morning Report: the app's own routing.
    private let openPennant: () -> Void

    public init(openPennant: @escaping () -> Void) {
        self.openPennant = openPennant
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            content
            Divider()
            Button("Open Pennant", action: openPennant)
                .keyboardShortcut(.defaultAction)
                .accessibilityIdentifier("menuBarExtra.openPennant")
        }
        .padding(14)
        .frame(width: 300, alignment: .leading)
        .foregroundStyle(Color(nsColor: .labelColor))
        .background(Color(nsColor: .readablePage))
        .accessibilityIdentifier("menuBarExtra")
    }

    @ViewBuilder private var content: some View {
        if let glance = model.integration.glance, model.clubOwed == nil {
            GlanceBody(glance: glance)
        } else if let problem = model.integration.problem {
            ProblemLine(problem)
        } else {
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text("Starting…").foregroundStyle(.readableSecondary)
            }
        }
    }
}

/// The served glance, laid out: who and how current, the record, the next game, the desk.
struct GlanceBody: View {
    let glance: Components.Schemas.Glance

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                if let club = glance.club {
                    Text(verbatim: club.display).font(.headline).lineLimit(1)
                }
                Spacer(minLength: 8)
                Text(verbatim: glance.asOf.display).font(.caption).foregroundStyle(.readableSecondary).help(glance.asOf.hint ?? "")
            }
            if let record = glance.record {
                Text(verbatim: record.value?.display ?? record.text)
                    .font(.system(size: 28, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .help(record.hint ?? record.text)
                    .accessibilityLabel(Text(verbatim: record.text))
                    .accessibilityIdentifier("menuBarExtra.record")
            }
            if let game = glance.nextGame {
                VStack(alignment: .leading, spacing: 1) {
                    Text(verbatim: game.when.display).font(.caption.weight(.semibold))
                    Text(verbatim: game.matchup.display)
                }
                .help(game.claim.hint ?? game.claim.text)
                .accessibilityElement(children: .combine)
            }
            ForEach(Array(glance.missing.enumerated()), id: \.offset) { _, line in
                Text(verbatim: line.display).font(.caption).foregroundStyle(.readableSecondary)
            }
            Divider()
            Text(verbatim: glance.desk.line.display)
                .font(.subheadline.weight(.semibold))
                .help(glance.desk.line.hint ?? "")
                .accessibilityIdentifier("menuBarExtra.desk")
            ForEach(glance.desk.top, id: \.key) { item in
                VStack(alignment: .leading, spacing: 1) {
                    Text(verbatim: item.headline.text).font(.callout).lineLimit(2)
                    Text(verbatim: item.department.display).font(.caption).foregroundStyle(.readableSecondary)
                }
                .help(item.headline.hint ?? item.headline.text)
                .accessibilityElement(children: .combine)
            }
        }
    }
}
