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
                LabeledContent("Last Checked") {
                    if let last = updates.lastCheck {
                        Text(last, format: .dateTime.year().month(.abbreviated).day().hour().minute())
                    } else {
                        Text("Never")
                    }
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
        .onAppear { updates.refresh() }
        .accessibilityIdentifier("settings.updates")
    }
}
