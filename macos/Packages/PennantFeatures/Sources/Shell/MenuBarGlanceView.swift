import AppKit
import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

/// The menu bar extra's window (SWIFTUI_REBUILD.md section 3.1; N14, Stage A, D-075): off until the GM turns it on in
/// Settings ▸ General, then the served record, next game and desk count with its first items, and Open Pennant. Every
/// figure and sentence is the served glance (`IntegrationStore`); the help tags are the claims' own. With no save chosen
/// or the club question open it says so as the main window does (review N14A, L1). Content on an opaque, checked page,
/// as everywhere in Pennant; the menu bar's own panel is the controls layer around it.
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
        .background(MenuBarPanelTitle())
        // A container of its own, so its identifier names it and never replaces its children's
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("menuBarExtra")
    }

    /// What the window shows, in the main window's order: no save chosen, the club question, the glance, why it could
    /// not be read, or "Starting…" while it is on its way.
    enum Shown: Equatable {
        case noSave
        case clubOwed(String)
        case glance(Components.Schemas.Glance)
        case problem(RequestProblem)
        case starting

        @MainActor
        static func of(_ model: AppModel) -> Shown {
            if model.status?.configured == false { return .noSave }
            if let owed = model.clubOwed { return .clubOwed(owed.text) }
            if let glance = model.integration.glance { return .glance(glance) }
            if let problem = model.integration.problem { return .problem(problem) }
            return .starting
        }
    }

    @ViewBuilder private var content: some View {
        switch Shown.of(model) {
        case .noSave:
            // As the main window says it (`NoSaveView`); Open Pennant leads to Setup
            Label("No save chosen", systemImage: "externaldrive.badge.questionmark")
                .accessibilityIdentifier("menuBarExtra.noSave")
        case .clubOwed(let text):
            // The server's sentence, as the main window's `ClubPendingView` shows it
            Text(verbatim: text)
                .accessibilityIdentifier("menuBarExtra.clubOwed")
        case .glance(let glance):
            GlanceBody(glance: glance)
        case .problem(let problem):
            ProblemLine(problem)
        case .starting:
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

/// Names the menu bar extra's panel "Pennant", once, from inside it (review N14A, L9). AppKit makes the panel and the
/// hosting view in it for a `MenuBarExtra`, and the accessibility audit on GitHub's runner found both with no description
/// (run 38116687375). The panel gets the title any window has (`window.title`). The hosting view, which vends itself as a
/// group, is reached by no SwiftUI modifier: run 38348239530 found it unnamed with `.accessibilityLabel` on the glance's
/// root container, so the one unnamed group nearest the panel, between this view and the panel's content view, is
/// labelled, as the sidebar column's container is. One group only, never the nested ones, and only its label. Draws
/// nothing.
struct MenuBarPanelTitle: NSViewRepresentable {
    static let title: LocalizedStringResource = "Pennant"

    func makeNSView(context: Context) -> NamesItsPanel { NamesItsPanel() }
    func updateNSView(_ view: NamesItsPanel, context: Context) {}

    final class NamesItsPanel: NSView {
        /// The panel named, so a later move names no inner group in turn.
        private weak var named: NSWindow?

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            guard let window, window !== named else { return }
            named = window
            let name = String(localized: MenuBarPanelTitle.title)
            if window.title.isEmpty { window.title = name }
            var outermost: NSView?
            var view = superview
            while let current = view {
                if current.isAccessibilityElement(), current.accessibilityRole() == .group,
                   current.accessibilityLabel()?.isEmpty ?? true {
                    outermost = current
                }
                if current === window.contentView { break }
                view = current.superview
            }
            outermost?.setAccessibilityLabel(name)
        }

        override func isAccessibilityElement() -> Bool { false }
    }
}
