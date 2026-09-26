import PennantAPI
import PennantKit
import SwiftUI

/// An import under way, as the server reports it (`importProgress` on the status and the event stream): when the
/// served counts allow it, a determinate bar with the served line under it ("Writing standings · 12 of 70"), and the
/// table's OOTP file name in the help tag. Before the first progress arrives it is an indeterminate bar.
public struct ImportProgressView: View {
    let progress: Components.Schemas.ImportProgress?

    public init(progress: Components.Schemas.ImportProgress?) {
        self.progress = progress
    }

    public var body: some View {
        Group {
            if let progress, progress.files > 0 {
                ProgressView(value: Double(min(progress.fileIndex, progress.files)), total: Double(progress.files)) {
                    Text("Importing…")
                } currentValueLabel: {
                    Text(verbatim: progress.words.display).monospacedDigit()
                }
            } else {
                ProgressView {
                    Text("Importing…")
                }
            }
        }
        // The table as OOTP names its file, for whoever wants it; the line above names it for a person
        .help(detail: progress?.table)
        .accessibilityIdentifier("import.progress")
    }
}
