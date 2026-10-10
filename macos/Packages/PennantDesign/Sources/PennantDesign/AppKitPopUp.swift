import AppKit
import SwiftUI

/// `PopUpChoice` and `PullDownMenu` as AppKit draws them: one `NSPopUpButton`, its menu rebuilt only when its items
/// change, its title truncated at the tail and its width as SwiftUI proposes, never wider than its widest item or 280
/// points.
struct AppKitPopUp: NSViewRepresentable {
    struct Item: Equatable {
        let title: String
        let hint: String?
        let section: String?
    }

    let pullsDown: Bool
    /// The accessible name, where the button's words are its choice (a pop-up); a pull-down is named by its prompt.
    let name: String?
    /// A pull-down's words.
    let heading: String?
    let help: String
    let systemImage: String?
    let items: [Item]
    let selected: Int?
    let id: String
    let act: (Int) -> Void

    static let widest: CGFloat = 280

    /// The bezel and arrows of an empty pop-up button, as AppKit measures one of this kind and size (its cell's
    /// `cellSize` with no item and no title), never an estimate: 57.5 points at the regular size on macOS 27, 49.5 small
    /// and 41.5 mini, pop-up and pull-down alike. Measured once for each, as the system's metrics differ by release.
    @MainActor static func narrowest(pullsDown: Bool, controlSize: NSControl.ControlSize) -> CGFloat {
        let key = "\(pullsDown) \(controlSize.rawValue)"
        if let known = measuredNarrowest[key] { return known }
        let empty = NSPopUpButton(frame: .zero, pullsDown: pullsDown)
        empty.controlSize = controlSize
        let width = (empty.cell?.cellSize.width).map { ceil($0) } ?? 0
        measuredNarrowest[key] = width
        return width
    }

    @MainActor private static var measuredNarrowest: [String: CGFloat] = [:]

    final class Coordinator: NSObject {
        var act: (Int) -> Void = { _ in }
        var built: [Item]?
        var builtHeading: String?

        /// Every choice the GM makes is forwarded, the current one too: the marked choice can be stale while the chosen
        /// one loads, so comparing against it would swallow a re-choice. Each caller is idempotent.
        @objc func chose(_ sender: NSPopUpButton) {
            guard let tag = sender.selectedItem?.tag, tag >= 0 else { return }
            act(tag)
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeNSView(context: Context) -> NSPopUpButton {
        let button = NSPopUpButton(frame: .zero, pullsDown: pullsDown)
        button.target = context.coordinator
        button.action = #selector(Coordinator.chose(_:))
        button.lineBreakMode = .byTruncatingTail
        button.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        return button
    }

    func updateNSView(_ button: NSPopUpButton, context: Context) {
        let coordinator = context.coordinator
        coordinator.act = act
        if coordinator.built != items || coordinator.builtHeading != heading {
            build(button.menu ?? NSMenu())
            coordinator.built = items
            coordinator.builtHeading = heading
        }
        // A pull-down chooses nothing: every item acts, so none is ever the current one
        if !pullsDown {
            if let selected { button.selectItem(withTag: selected) } else { button.select(nil) }
        }
        showSymbol(on: button)
        button.toolTip = help
        if let name { button.setAccessibilityLabel(name) }
        button.setAccessibilityIdentifier(id)
    }

    func sizeThatFits(_ proposal: ProposedViewSize, nsView button: NSPopUpButton, context: Context) -> CGSize? {
        let ideal = button.intrinsicContentSize
        let width = min(ideal.width, Self.widest, proposal.width ?? ideal.width)
        // Never narrower than its bezel and arrows with no words, however little room it is offered
        let narrowest = Self.narrowest(pullsDown: pullsDown, controlSize: button.controlSize)
        return CGSize(width: max(width, min(narrowest, ideal.width)), height: ideal.height)
    }

    /// The menu: a pull-down's words first (its title item), then each item, a section's under its header and the
    /// sections apart; an item's hint as its subtitle; each item tagged with its index and named `id.index`.
    private func build(_ menu: NSMenu) {
        menu.removeAllItems()
        if pullsDown { menu.addItem(withTitle: heading ?? "", action: nil, keyEquivalent: "").tag = -1 }
        var section: String?
        for (index, item) in items.enumerated() {
            if index == 0 || item.section != section {
                if index > 0 { menu.addItem(.separator()) }
                if let header = item.section { menu.addItem(.sectionHeader(title: header)) }
            }
            section = item.section
            let entry = NSMenuItem(title: item.title, action: nil, keyEquivalent: "")
            entry.subtitle = item.hint
            entry.tag = index
            entry.identifier = NSUserInterfaceItemIdentifier("\(id).\(index)")
            menu.addItem(entry)
        }
        for entry in menu.items where entry.isSectionHeader || entry.isSeparatorItem { entry.tag = -1 }
    }

    /// A toolbar filter's symbol before its current choice: the button shows an item of its own (the current choice's
    /// words with the symbol) rather than the menu's.
    private func showSymbol(on button: NSPopUpButton) {
        guard let systemImage, !pullsDown, let cell = button.cell as? NSPopUpButtonCell else { return }
        cell.usesItemFromMenu = false
        let shown = NSMenuItem(title: button.selectedItem?.title ?? "", action: nil, keyEquivalent: "")
        shown.image = NSImage(systemSymbolName: systemImage, accessibilityDescription: nil)
        cell.menuItem = shown
    }
}
