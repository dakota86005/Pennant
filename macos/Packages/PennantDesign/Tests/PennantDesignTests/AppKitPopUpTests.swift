import AppKit
import Testing
@testable import PennantDesign

/// The pop-up button's narrowest (native picker review): its bezel and arrows as AppKit measures an empty one, never a
/// guessed width, so a choice crowded by a narrow window keeps its arrows.
@Suite("Pop-up button")
@MainActor
struct AppKitPopUpTests {
    @Test("its narrowest is an empty button's own width, at each control size", arguments: [
        NSControl.ControlSize.mini, .small, .regular, .large,
    ])
    func narrowestIsMeasured(size: NSControl.ControlSize) {
        for pullsDown in [false, true] {
            let empty = NSPopUpButton(frame: .zero, pullsDown: pullsDown)
            empty.controlSize = size
            let measured = ceil(empty.cell?.cellSize.width ?? 0)
            #expect(measured > 0)
            #expect(AppKitPopUp.narrowest(pullsDown: pullsDown, controlSize: size) == measured)
        }
    }

    @Test("a larger control is never narrower, and a title only widens it")
    func ordered() {
        let sizes: [NSControl.ControlSize] = [.mini, .small, .regular, .large]
        let widths = sizes.map { AppKitPopUp.narrowest(pullsDown: false, controlSize: $0) }
        #expect(widths == widths.sorted())
        let titled = NSPopUpButton(frame: .zero, pullsDown: false)
        titled.addItem(withTitle: "Every Contract")
        #expect(titled.intrinsicContentSize.width > AppKitPopUp.narrowest(pullsDown: false, controlSize: .regular))
    }
}
