import AppKit
import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

/// Organizational Philosophy (N12 Track C; D-073): the editor as grouped sections, as System Settings lays out its panes
/// (a header over each group, its rows in a card, its footer beneath), with the system's own controls (a slider for each
/// preference, a pop-up for each policy) and every word the server's: the identity, the comparable clubs, each label and
/// where a setting reads. The groups are the design's cards on the content colour rather than `Form`'s grouped rows:
/// those are drawn vibrant on a system background, which the contrast audit can't read (the brief's rule: never text on a
/// system background). Its descriptions are in the primary colour at a smaller size (the audit read wrapped lines in
/// the secondary colour as too faint), the hierarchy carried by size and weight. A change is sent when the GM lets go of a slider (or a moment after its value stops moving, as
/// the arrow keys and VoiceOver move it), or picks a policy; the server checks it, writes it and says what it did in the
/// status strip under the editor, and ⌘Z undoes it through the request it answered with. The settings order the choices
/// the staff already finds sound; nothing here makes a move allowed or not (D-003, D-019, D-045).
struct OrganizationalPhilosophyView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.undoManager) private var undoManager
    @State private var confirming = false

    var body: some View {
        let store = model.philosophy
        LoadState(payload: store.philosophy, problem: store.problems["philosophy"]) { view in
            VStack(spacing: 0) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 22) {
                        PhilosophyHead(title: view.title, byline: view.byline, lede: view.lede, refreshing: store.writing)
                        GroupBlock(header: Text("Organizational Identity")) {
                            IdentityView(identity: view.identity)
                            Divider()
                            HStack(alignment: .firstTextBaseline) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(verbatim: view.source.title.display)
                                    CellWords(view.source.text).font(.callout)
                                }
                                Spacer(minLength: 12)
                                Text(verbatim: view.source.mode.display).font(.callout.weight(.semibold))
                            }
                            .accessibilityElement(children: .combine)
                        }
                        GroupBlock(header: Text(verbatim: view.comparables.title.display)) {
                            ForEach(Array(view.comparables.clubs.enumerated()), id: \.element.id) { index, club in
                                if index > 0 { Divider() }
                                VStack(alignment: .leading, spacing: 3) {
                                    HStack(alignment: .firstTextBaseline) {
                                        Text(verbatim: club.name.display).font(.headline)
                                        Spacer()
                                        Pill(club.match.display, tone: .neutral)
                                    }
                                    CellWords(club.description).font(.callout)
                                    if let shared = club.shared { CellWords(shared).font(.caption) }
                                }
                                .accessibilityElement(children: .combine)
                            }
                        } footer: {
                            CellWords(view.comparables.lede)
                            ClaimRow(view.comparables.note, font: .callout)
                        }
                        ForEach(view.groups, id: \.id) { group in
                            GroupBlock(header: Text(verbatim: group.title.display)) {
                                ForEach(Array(group.dimensions.enumerated()), id: \.element.id) { index, dimension in
                                    if index > 0 { Divider() }
                                    DimensionRow(dimension: dimension) { value in
                                        Task {
                                            await model.changePhilosophy(
                                                .init(dimensions: [.init(id: dimension.id, value: .init(value1: value))]),
                                                undoManager: undoManager
                                            )
                                        }
                                    }
                                }
                            } footer: {
                                CellWords(group.description)
                            }
                        }
                        GroupBlock(header: Text(verbatim: view.policies.title.display)) {
                            ForEach(Array(view.policies.items.enumerated()), id: \.element.id) { index, policy in
                                if index > 0 { Divider() }
                                HStack(alignment: .center, spacing: 12) {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(verbatim: policy.label.display)
                                        CellWords(policy.description).font(.callout)
                                    }
                                    Spacer(minLength: 8)
                                    Picker(selection: Binding(get: { policy.selected }, set: { chosen in
                                        guard chosen != policy.selected else { return }
                                        Task {
                                            await model.changePhilosophy(
                                                .init(policies: [.init(id: policy.id, value: .init(value2: chosen))]),
                                                undoManager: undoManager
                                            )
                                        }
                                    })) {
                                        ForEach(policy.options, id: \.value) { option in Text(verbatim: option.label.display).tag(option.value) }
                                    } label: {
                                        Text(verbatim: policy.label.display)
                                    }
                                    .pickerStyle(.menu)
                                    .labelsHidden()
                                    .fixedSize()
                                    .accessibilityIdentifier("philosophy.policy.\(policy.id)")
                                }
                            }
                        } footer: {
                            CellWords(view.policies.description)
                        }
                        GroupBlock(header: nil) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(verbatim: view.neutral.title.display).font(.headline)
                                CellWords(view.neutral.text).font(.callout)
                            }
                            Button { confirming = true } label: { Text(verbatim: view.neutral.reset.display) }
                                .disabled(store.writing)
                                .accessibilityIdentifier("philosophy.reset")
                                .confirmationDialog(Text(verbatim: view.neutral.confirm.display), isPresented: $confirming) {
                                    Button(role: .destructive) {
                                        Task { await model.resetPhilosophy(undoManager: undoManager) }
                                    } label: {
                                        Text(verbatim: view.neutral.reset.display)
                                    }
                                } message: {
                                    Text(verbatim: view.neutral.confirmDetail.display)
                                }
                        }
                    }
                    .padding(.horizontal, 28).padding(.vertical, 24)
                    .frame(maxWidth: 760, alignment: .leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .background(Color.readablePage)
                .accessibilityIdentifier("philosophy.form")
                // What the last change did (or why it was refused), in a status strip under the editor, seen wherever
                // the GM has scrolled to, as Finder's status bar is; beside the scroll view, never over its content
                if store.lastSaid != nil || store.changeProblem != nil {
                    Divider()
                    Group {
                        if let problem = store.changeProblem {
                            ProblemLine(problem)
                        } else if let said = store.lastSaid {
                            Label { CellWords(said) } icon: { Image(systemName: "checkmark.circle") }
                                // One element that says what the change did (combining the label's own element read
                                // as nothing to VoiceOver)
                                .accessibilityElement(children: .ignore)
                                .accessibilityLabel(Text(verbatim: said.display))
                                .accessibilityAddTraits(.isStaticText)
                                .accessibilityIdentifier("philosophy.said")
                        }
                    }
                    .font(.callout)
                    .padding(.horizontal, 20).padding(.vertical, 8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.readablePage)
                }
            }
        }
        .task(id: model.storeKey) { await model.loadPhilosophy() }
        .onChange(of: store.lastSaid?.display) { _, said in
            // What a change did, said aloud as it is shown
            if let said { AccessibilityNotification.Announcement(said).post() }
        }
    }
}

/// A group of the editor: its header above, its rows in the design's card (the served accent's wash), its footer below.
private struct GroupBlock<Content: View, Footer: View>: View {
    let header: Text?
    @ViewBuilder let content: () -> Content
    @ViewBuilder let footer: () -> Footer

    init(header: Text?, @ViewBuilder content: @escaping () -> Content, @ViewBuilder footer: @escaping () -> Footer) {
        self.header = header
        self.content = content
        self.footer = footer
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let header {
                header.font(.headline).accessibilityAddTraits(.isHeader).padding(.leading, 4)
            }
            Card {
                VStack(alignment: .leading, spacing: 12) { content() }
            }
            VStack(alignment: .leading, spacing: 4) { footer() }
                .font(.callout)
                .padding(.horizontal, 4)
        }
        .accessibilityElement(children: .contain)
    }
}

extension GroupBlock where Footer == EmptyView {
    init(header: Text?, @ViewBuilder content: @escaping () -> Content) {
        self.init(header: header, content: content, footer: { EmptyView() })
    }
}

/// The identity, as served: its headline, its tags as chips, the summary (its basis a click away) and the nuance.
private struct IdentityView: View {
    let identity: Components.Schemas.PhilosophyIdentity

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(verbatim: identity.headline.display)
                .font(.title2.weight(.bold))
                .accessibilityIdentifier("philosophy.identity")
            ChipFlow(spacing: 6) {
                ForEach(Array(identity.tags.enumerated()), id: \.offset) { _, tag in
                    Text(verbatim: tag.display)
                        .font(.caption.weight(.semibold))
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(Color.readableChipFill, in: .capsule)
                }
            }
            .accessibilityElement(children: .combine)
            ClaimRow(identity.summary)
            CellWords(identity.nuance).font(.callout)
        }
        .padding(.vertical, 4)
    }
}

/// One preference: its label, the number and where it reads (served), its line, and a slider between its two served ends.
/// The number follows the slider at once; the words follow when the server has the change. A change goes when the GM lets
/// go, or a moment after the last arrow key.
private struct DimensionRow: View {
    let dimension: Components.Schemas.PhilosophyDimensionView
    let send: (Int) -> Void
    @State private var value: Double
    @State private var dragging = false
    @State private var settle: Task<Void, Never>?

    init(dimension: Components.Schemas.PhilosophyDimensionView, send: @escaping (Int) -> Void) {
        self.dimension = dimension
        self.send = send
        _value = State(initialValue: Double(dimension.value))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(verbatim: dimension.label.display).font(.body.weight(.semibold))
                Spacer()
                Text(verbatim: String(Int(value.rounded())))
                    .font(.body.monospacedDigit().weight(.semibold))
                    .accessibilityHidden(true)
                CellWords(dimension.position, quiet: Int(value.rounded()) != dimension.value).font(.callout)
            }
            CellWords(dimension.description).font(.callout)
            // The system's slider (AppKit's own, continuous, rounded to a whole number when sent), named for VoiceOver
            PreferenceSlider(
                value: $value,
                label: dimension.label.display,
                hint: dimension.position.display,
                identifier: "philosophy.dimension.\(dimension.id)"
            ) { editing in
                dragging = editing
                if !editing { commit() }
            }
            .accessibilityIdentifier("philosophy.dimension.\(dimension.id)")
            // The served ends and the middle under the slider, as the React page's endpoints are
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(verbatim: dimension.low.display).frame(maxWidth: .infinity, alignment: .leading)
                    Text(verbatim: dimension.balanced.display).fixedSize()
                    Text(verbatim: dimension.high.display).frame(maxWidth: .infinity, alignment: .trailing)
                }
                .lineLimit(1)
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(verbatim: dimension.low.display).frame(maxWidth: .infinity, alignment: .leading)
                    Text(verbatim: dimension.high.display).multilineTextAlignment(.trailing).frame(maxWidth: .infinity, alignment: .trailing)
                }
            }
            .font(.caption)
            .foregroundStyle(.readableSecondary)
            .accessibilityHidden(true)
        }
        .onChange(of: value) { _, _ in
            guard !dragging else { return }
            // The arrow keys move it a step at a time: send once they stop
            settle?.cancel()
            settle = Task {
                try? await Task.sleep(for: .milliseconds(350))
                guard !Task.isCancelled else { return }
                commit()
            }
        }
        .onChange(of: dimension.value) { _, served in
            // The server's answer (or an undo) is what the slider shows
            if !dragging { value = Double(served) }
        }
        .padding(.vertical, 2)
    }

    private func commit() {
        settle?.cancel()
        let chosen = Int(value.rounded())
        if chosen != dimension.value { send(chosen) }
    }
}

/// Chips that wrap onto the next line where the row is full.
private struct ChipFlow: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache _: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, line: CGFloat = 0, widest: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width {
                y += line + spacing
                x = 0
                line = 0
            }
            x += size.width + spacing
            line = max(line, size.height)
            widest = max(widest, x - spacing)
        }
        return CGSize(width: min(widest, width), height: y + line)
    }

    func placeSubviews(in bounds: CGRect, proposal _: ProposedViewSize, subviews: Subviews, cache _: inout ()) {
        var x = bounds.minX, y = bounds.minY, line: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX {
                y += line + spacing
                x = bounds.minX
                line = 0
            }
            view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            line = max(line, size.height)
        }
    }
}

/// AppKit's slider for a preference, 0–100: the system's control, drawn and adjusted as every Mac slider is (drag, click,
/// the arrow keys, VoiceOver). It reports a drag's start and end (the change is sent when it ends) and any other change
/// through its value. AppKit's slider names its thumb from its own label (SwiftUI's, with its label hidden, left the
/// thumb with no description, the audit found).
struct PreferenceSlider: NSViewRepresentable {
    @Binding var value: Double
    let label: String
    let hint: String
    let identifier: String
    let editing: (Bool) -> Void

    /// AppKit's slider, telling when the GM's drag starts and ends: `mouseDown` tracks the drag until the button is let
    /// go (AppKit's own loop), so a change by the keyboard or VoiceOver is never taken for a drag.
    final class Slider: NSSlider {
        var editing: ((Bool) -> Void)?

        override func mouseDown(with event: NSEvent) {
            editing?(true)
            super.mouseDown(with: event)
            editing?(false)
        }
    }

    final class Coordinator: NSObject {
        var parent: PreferenceSlider

        init(_ parent: PreferenceSlider) {
            self.parent = parent
        }

        @MainActor @objc func moved(_ sender: NSSlider) {
            parent.value = sender.doubleValue
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeNSView(context: Context) -> Slider {
        let slider = Slider(value: value, minValue: 0, maxValue: 100, target: context.coordinator, action: #selector(Coordinator.moved(_:)))
        slider.isContinuous = true
        slider.editing = { editing in context.coordinator.parent.editing(editing) }
        slider.controlSize = .regular
        slider.setContentHuggingPriority(.defaultLow, for: .horizontal)
        slider.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        return slider
    }

    func updateNSView(_ slider: Slider, context: Context) {
        context.coordinator.parent = self
        if abs(slider.doubleValue - value) > 0.0001 { slider.doubleValue = value }
        slider.setAccessibilityLabel(label)
        slider.setAccessibilityHelp(hint)
        slider.setAccessibilityIdentifier(identifier)
    }
}

