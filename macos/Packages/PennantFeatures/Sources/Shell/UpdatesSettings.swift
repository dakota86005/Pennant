import PennantDesign
import PennantKit
import SwiftUI

/// Settings ▸ Updates (N14 Stage B, D-076): whether Pennant checks for updates by itself, and when it last checked (a
/// check by hand is the app menu's Check for Updates…). Automatic checks stay off until the GM says yes, to Sparkle's own question at the second launch or to the
/// switch here. A build with no updater (every Debug build) shows the switch off and unavailable, with one line saying
/// so. The values are the updater's; the labels are structural.
public struct UpdatesSettings: View {
    @Environment(Updates.self) private var updates

    public init() {}

    public var body: some View {
        Form {
            Section("Updates") {
                Toggle("Check for Updates Automatically", isOn: Binding(
                    get: { updates.automaticallyChecks },
                    set: { updates.setAutomaticallyChecks($0) }
                ))
                .disabled(updates.availability == .offInThisBuild)
                .accessibilityIdentifier("settings.updates.automatic")
                // The value in the readable grey, never the system's secondary (3.9:1 on the runner's audit)
                LabeledContent("Last Checked") {
                    Group {
                        if let last = updates.lastCheck {
                            Text(last, format: .dateTime.year().month(.abbreviated).day().hour().minute())
                        } else {
                            Text("Never")
                        }
                    }
                    .foregroundStyle(.readableSecondary)
                }
                .accessibilityIdentifier("settings.updates.lastCheck")
                if updates.availability == .offInThisBuild {
                    Text("This build doesn't check for updates")
                        .foregroundStyle(.readableSecondary)
                        .accessibilityIdentifier("settings.updates.off")
                }
            }
        }
        .formStyle(.grouped)
        .background(SettingsPaneName())
        .onAppear { updates.refresh() }
        // The tab's container named, its controls kept as they are (the audit: a group with no description)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Updates"))
        .accessibilityIdentifier("settings.updates")
    }
}

/// Names the Settings window's own containers for VoiceOver (the audit on GitHub's runner found the tab's hosting view, a
/// group spanning the window, with no description). As with the sidebar's column (`SidebarColumnName`), AppKit draws that
/// container and no SwiftUI modifier reaches it, so each unnamed group above this view, up to the window, is given the
/// tab's structural name; only labels change, never children.
struct SettingsPaneName: NSViewRepresentable {
    static let name: LocalizedStringResource = "Updates"

    func makeNSView(context: Context) -> Finder { Finder() }
    func updateNSView(_ view: Finder, context: Context) { view.name() }

    final class Finder: NSView {
        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            name()
        }

        func name() {
            var view = superview
            while let current = view {
                if current.isAccessibilityElement(), current.accessibilityRole() == .group,
                   current.accessibilityLabel()?.isEmpty ?? true {
                    current.setAccessibilityLabel(String(localized: SettingsPaneName.name))
                }
                view = current.superview
            }
        }

        override func isAccessibilityElement() -> Bool { false }
    }
}
