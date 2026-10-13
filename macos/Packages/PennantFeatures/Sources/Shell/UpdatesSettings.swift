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

/// Names the Settings window's container for VoiceOver (the audit on GitHub's runner found a group spanning the window
/// with no description). As with the sidebar's column (`SidebarColumnName`), AppKit draws that container and no SwiftUI
/// modifier reaches it, so the nearest enclosing view that vends itself as a group is found, given a structural name
/// when it has none, and the walk stops there, never past the window's content view; only its label changes, never its
/// children. The name is the tab's ("Updates") only inside a tab view's own item, which leaves with the tab; a container
/// any other tab shows too (the window's, which outlives a switch to General) is named for the window, "Settings".
struct SettingsPaneName: NSViewRepresentable {
    static let tabName: LocalizedStringResource = "Updates"
    static let windowName: LocalizedStringResource = "Settings"

    func makeNSView(context: Context) -> Finder { Finder() }
    func updateNSView(_ view: Finder, context: Context) { view.name() }

    final class Finder: NSView {
        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            name()
        }

        func name() {
            let content = window?.contentView
            var view = superview
            while let current = view {
                if current.isAccessibilityElement(), current.accessibilityRole() == .group {
                    if current.accessibilityLabel()?.isEmpty ?? true {
                        let name = Self.isInTabItem(current) ? SettingsPaneName.tabName : SettingsPaneName.windowName
                        current.setAccessibilityLabel(String(localized: name))
                    }
                    return
                }
                if current === content { return }
                view = current.superview
            }
        }

        /// Whether a view sits inside a tab view (so in one tab's item), rather than holding it.
        private static func isInTabItem(_ view: NSView) -> Bool {
            var above = view.superview
            while let current = above {
                if current is NSTabView { return true }
                above = current.superview
            }
            return false
        }

        override func isAccessibilityElement() -> Bool { false }
    }
}
