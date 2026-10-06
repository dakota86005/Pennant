import SwiftUI

/// One choice among a few (a division, a level, an opponent, a player to ask a what-if of), the one way Pennant offers
/// it (N12 Track B review: N8's what-if, the farm's filters, the clubhouse's clubs and the league office's choices had
/// four copies of this). A button naming the current choice with a trailing chevron opens the choices in a popover;
/// there the arrow keys move a highlight (the pointer moves it too), Return chooses, Escape closes, and the chosen one is
/// checked. It is a named button with its current choice as its value, as the accessibility audit needs (a pull-down
/// `Menu` and a pop-up `Picker` were found with no action to press). The highlight is a fixed, checked fill under its
/// own words, never the system accent (`readableHeadingFill`, `readableHeadingText`).
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
    ///   - title: what is chosen ("Division"): the button's accessible name, and the popover's heading when `heading`.
    ///   - current: the button's words (the current choice, or a prompt); its value to VoiceOver.
    ///   - systemImage: a leading symbol, where the control has one (a toolbar filter).
    ///   - id: the button's identifier; each choice is `id.index` unless it names its own.
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
