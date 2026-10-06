import AppKit
import SwiftUI
import Testing
@testable import PennantDesign

/// The table pane's movable boundary (N9 review, M1): drawn, with its VoiceOver slider, at every height from a short
/// window up, so a range narrower than a step can never trap.
@Suite("Table pane")
@MainActor
struct TablePaneTests {
    @Test("draws on a short window and a tall one, its divider's slider included", arguments: [120.0, 260.0, 380.0, 900.0])
    func draws(height: Double) throws {
        let pane = TablePane(autosave: nil) {
            Text(verbatim: "Head").font(.title)
        } table: {
            Color.gray
        } detail: {
            Text(verbatim: "Detail")
        }
        .frame(width: 600, height: height)
        let host = NSHostingView(rootView: pane)
        host.frame = NSRect(x: 0, y: 0, width: 600, height: height)
        host.layoutSubtreeIfNeeded()
        // The divider's accessibility tree (its slider) is built when asked for, as VoiceOver and the audit ask
        _ = host.accessibilityChildren()
        #expect(host.fittingSize.width >= 0)
        let renderer = ImageRenderer(content: pane)
        #expect(renderer.nsImage != nil)
    }

    @Test("the slider's range is never empty: a detail no taller than its minimum still reads")
    func range() {
        #expect(TablePane<EmptyView, EmptyView, EmptyView>.detailMinimum > 0)
        #expect(TablePane<EmptyView, EmptyView, EmptyView>.tableMinimum >= 120)
    }
}
