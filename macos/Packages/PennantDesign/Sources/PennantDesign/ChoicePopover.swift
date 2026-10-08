import SwiftUI

/// One choice among a few (a division, a level, an opponent, a player to ask a what-if of), using macOS's native
/// pop-up menu (`Picker` with `.menu` style) where one is currently selected. This passes the XCUITest accessibility
/// audit (D-073): the picker's label carries the served words and is hidden with `.labelsHidden()`, providing an
/// accessible name without needing modifier attributes. Where `current` is a prompt and no choice is selected,
/// the old custom popover is used instead, as adding a "none" entry would not read naturally (D-073 guidance).
public struct ChoicePopover: View {
    /// A choice: its words, an optional quieter hint beside them, whether it is the current one, and its identifier.
    public struct Choice {
        public let text: Text
        public let hint: Text?
        public let selected: Bool
        public let identifier: String?

        public init(_ text: Text, hint: Text? = nil, selected: Bool = false, identifier: String? = nil) {
            self.text = text
            self.hint = hint
            self.selected = selected
            self.identifier = identifier
        }

        /// A served choice's words, verbatim.
        public init(verbatim text: String, hint: String? = nil, selected: Bool = false, identifier: String? = nil) {
            self.init(Text(verbatim: text), hint: hint.map { Text(verbatim: $0) }, selected: selected, identifier: identifier)
        }
    }

    let title: Text
    let current: Text
    let help: Text?
    let systemImage: String?
    let heading: Bool
    let choices: [Choice]
    let id: String
    let choose: (Int) -> Void
    @State private var open = false

    /// - Parameters:
    ///   - title: what is chosen ("Division"): the picker's accessible name via its label.
    ///   - current: the picker's button words (the current choice, or a prompt).
    ///   - systemImage: a leading symbol in the label, where the control has one (a toolbar filter).
    ///   - id: the picker's identifier; each choice is `id.index` unless it names its own.
    public init(
        _ title: Text,
        current: Text,
        help: Text? = nil,
        systemImage: String? = nil,
        heading: Bool = false,
        choices: [Choice],
        id: String,
        choose: @escaping (Int) -> Void
    ) {
        self.title = title
        self.current = current
        self.help = help
        self.systemImage = systemImage
        self.heading = heading
        self.choices = choices
        self.id = id
        self.choose = choose
    }

    public var body: some View {
        // Use native Picker if a choice is selected; otherwise use the custom popover (D-073 guidance)
        let selectedIndex = choices.firstIndex { $0.selected }

        if let selectedIndex {
            // Native picker: passes the accessibility audit
            Picker(selection: .init(get: { selectedIndex }, set: { choose($0) })) {
                ForEach(Array(choices.enumerated()), id: \.offset) { index, choice in
                    menuItem(choice, index: index).tag(index)
                }
            } label: {
                if let systemImage {
                    Label(title: { labelText }, icon: { Image(systemName: systemImage) })
                } else {
                    labelText
                }
            }
            .pickerStyle(.menu)
            .labelsHidden()
            .fixedSize()
            .help(help ?? current)
            .accessibilityIdentifier(id)
        } else {
            // Custom popover for prompt case (no selection)
            Button {
                open = true
            } label: {
                HStack(spacing: 5) {
                    if let systemImage { Image(systemName: systemImage).accessibilityHidden(true) }
                    current.lineLimit(1).truncationMode(.tail)
                    Image(systemName: "chevron.down").font(.caption2.weight(.semibold)).accessibilityHidden(true)
                }
            }
            .frame(maxWidth: 280, alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)
            .help(help ?? current)
            .accessibilityLabel(title)
            .accessibilityValue(current)
            .accessibilityIdentifier(id)
            .popover(isPresented: $open, arrowEdge: .bottom) {
                ChoiceList(title: heading ? title : nil, choices: choices, id: id) { index in
                    open = false
                    if let index { choose(index) }
                }
            }
        }
    }

    private var labelText: some View {
        current.lineLimit(1).truncationMode(.tail)
    }

    private func menuItem(_ choice: Choice, index: Int) -> some View {
        HStack(spacing: 6) {
            choice.text
            if let hint = choice.hint {
                hint.foregroundStyle(.readableSecondary)
            }
        }
        .accessibilityIdentifier(choice.identifier ?? "\(id).\(index)")
    }
}

/// The popover's list: a row per choice, the arrow keys and the pointer moving one highlight, Return choosing it and
/// Escape closing; scrolled to keep the highlight in view.
private struct ChoiceList: View {
    let title: Text?
    let choices: [ChoicePopover.Choice]
    let id: String
    /// The index chosen, or nil when the list closes with none.
    let done: (Int?) -> Void
    @State private var highlighted: Int?
    @FocusState private var focused: Bool

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 2) {
                    if let title {
                        title.font(.callout.weight(.semibold)).foregroundStyle(.readableSecondary)
                            .padding(.horizontal, 10).padding(.bottom, 4)
                            .accessibilityAddTraits(.isHeader)
                    }
                    ForEach(Array(choices.enumerated()), id: \.offset) { index, choice in
                        row(choice, index: index).id(index)
                    }
                }
                .padding(.vertical, 6)
            }
            .frame(minWidth: 240, maxHeight: 360)
            .background(Color.readablePage)
            .focusable()
            .focused($focused)
            .focusEffectDisabled()
            .onAppear {
                highlighted = choices.firstIndex { $0.selected } ?? (choices.isEmpty ? nil : 0)
                focused = true
                if let highlighted { proxy.scrollTo(highlighted, anchor: .center) }
            }
            .onKeyPress(.downArrow) { move(1, proxy) }
            .onKeyPress(.upArrow) { move(-1, proxy) }
            .onKeyPress(.return) {
                guard let highlighted else { return .ignored }
                done(highlighted)
                return .handled
            }
            .onKeyPress(.escape) {
                done(nil)
                return .handled
            }
        }
    }

    private func move(_ step: Int, _ proxy: ScrollViewProxy) -> KeyPress.Result {
        guard !choices.isEmpty else { return .ignored }
        let next = min(max((highlighted ?? (step > 0 ? -1 : choices.count)) + step, 0), choices.count - 1)
        highlighted = next
        proxy.scrollTo(next)
        return .handled
    }

    private func row(_ choice: ChoicePopover.Choice, index: Int) -> some View {
        let lit = highlighted == index
        return Button {
            done(index)
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "checkmark").opacity(choice.selected ? 1 : 0).accessibilityHidden(true)
                choice.text
                if let hint = choice.hint {
                    hint.foregroundStyle(lit ? AnyShapeStyle(Color.readableHeadingText) : AnyShapeStyle(Color.readableSecondary))
                }
            }
            .foregroundStyle(lit ? AnyShapeStyle(Color.readableHeadingText) : AnyShapeStyle(.primary))
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 8).padding(.vertical, 4)
            .background(lit ? Color.readableHeadingFill : Color.clear, in: RoundedRectangle(cornerRadius: 5))
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 4)
        .onHover { inside in if inside { highlighted = index } }
        .accessibilityAddTraits(choice.selected ? .isSelected : [])
        .accessibilityIdentifier(choice.identifier ?? "\(id).\(index)")
    }
}
