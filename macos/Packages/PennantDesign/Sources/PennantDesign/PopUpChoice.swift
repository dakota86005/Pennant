import AppKit
import SwiftUI

/// One choice among a few (a division, a level, an opponent, a list), the one way Pennant offers it: AppKit's own pop-up
/// button, `NSPopUpButton`, as Finder, Mail and System Settings offer one (D-073's amendment). Its accessible name is the
/// `title` ("Division"), not shown; the button shows the current choice and its menu checks it; a choice's hint is its
/// menu item's subtitle, the quieter line the system draws under it; a section's choices are listed under its header.
/// AppKit's pop-up offers VoiceOver both of its actions (press and show menu); SwiftUI's own `Picker` in the `.menu`
/// style offered only press on macOS 27.2, where the accessibility audit found "Action is missing" on it (D-073's
/// amendment).
/// The button is as wide as its widest choice, at most 280 points and narrower where the window is, the system
/// truncating its words at the tail, so a long choice never widens a narrow window.
public struct PopUpChoice: View {
    /// A choice: its words, a hint (the menu item's subtitle), the section it is listed under, and whether it is the
    /// current one.
    public struct Choice: Equatable {
        public let title: String
        public let hint: String?
        public let section: String?
        public let selected: Bool

        public init(_ title: String, hint: String? = nil, section: String? = nil, selected: Bool = false) {
            self.title = title
            self.hint = hint
            self.section = section
            self.selected = selected
        }
    }

    let name: String
    let help: String?
    let systemImage: String?
    let choices: [Choice]
    let id: String
    let choose: (Int) -> Void

    /// - Parameters:
    ///   - title: what is chosen, a structural label ("Division"): the button's accessible name and its help tag.
    ///   - help: the help tag, where it is not the title.
    ///   - systemImage: a symbol leading the button's words, where the control is a toolbar filter.
    ///   - id: the button's identifier; each choice's menu item is `id.index`.
    public init(
        title: LocalizedStringResource,
        help: String? = nil,
        systemImage: String? = nil,
        choices: [Choice],
        id: String,
        choose: @escaping (Int) -> Void
    ) {
        self.init(verbatim: String(localized: title), help: help, systemImage: systemImage, choices: choices, id: id, choose: choose)
    }

    /// A served title, verbatim.
    public init(
        verbatim title: String,
        help: String? = nil,
        systemImage: String? = nil,
        choices: [Choice],
        id: String,
        choose: @escaping (Int) -> Void
    ) {
        name = title
        self.help = help
        self.systemImage = systemImage
        self.choices = choices
        self.id = id
        self.choose = choose
    }

    public var body: some View {
        AppKitPopUp(
            pullsDown: false,
            name: name,
            heading: nil,
            help: help ?? name,
            systemImage: systemImage,
            items: choices.map { .init(title: $0.title, hint: $0.hint, section: $0.section) },
            // The marked choice; none where none is marked (the button then shows no choice)
            selected: choices.firstIndex(where: \.selected),
            id: id,
            act: choose
        )
    }
}

/// A menu of actions under a served prompt (the what-if's players, each opening his scenario): AppKit's pull-down
/// button, the prompt its words, each action a menu item (`id.index`). Nothing in it is current.
public struct PullDownMenu: View {
    let prompt: String
    let help: String?
    let actions: [PopUpChoice.Choice]
    let id: String
    let act: (Int) -> Void

    public init(verbatim prompt: String, help: String? = nil, actions: [PopUpChoice.Choice], id: String, act: @escaping (Int) -> Void) {
        self.prompt = prompt
        self.help = help
        self.actions = actions
        self.id = id
        self.act = act
    }

    public var body: some View {
        AppKitPopUp(
            pullsDown: true,
            name: nil,
            heading: prompt,
            help: help ?? prompt,
            systemImage: nil,
            items: actions.map { .init(title: $0.title, hint: $0.hint, section: $0.section) },
            selected: nil,
            id: id,
            act: act
        )
    }
}
