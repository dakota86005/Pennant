import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

/// Organizational Philosophy (N12 Track C; D-073): the editor as a native grouped `Form`, the system's own controls (a
/// slider for each preference, a pop-up for each policy), and every word the server's: the identity, the comparable
/// clubs, each label and where a setting reads. A change is sent when the GM lets go of a slider (or stops pressing its
/// arrow keys), or picks a policy; the server checks it, writes it and says what it did, and ⌘Z undoes it through the
/// request it answered with. The settings order the choices the staff already finds sound; nothing here makes a move
/// allowed or not (D-003, D-019, D-045).
struct OrganizationalPhilosophyView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.undoManager) private var undoManager
    @State private var confirming = false

    var body: some View {
        let store = model.philosophy
        LoadState(payload: store.philosophy, problem: store.problems["philosophy"]) { view in
            Form {
                Section {
                    PhilosophyHead(title: view.title, byline: view.byline, lede: view.lede, refreshing: store.writing)
                }
                Section {
                    IdentityView(identity: view.identity)
                    LabeledContent {
                        Text(verbatim: view.source.mode.display).font(.callout.weight(.semibold))
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(verbatim: view.source.title.display)
                            CellWords(view.source.text, quiet: true).font(.caption)
                        }
                    }
                } header: {
                    Text("Organizational Identity")
                }
                Section {
                    ForEach(view.comparables.clubs, id: \.id) { club in
                        VStack(alignment: .leading, spacing: 3) {
                            HStack(alignment: .firstTextBaseline) {
                                Text(verbatim: club.name.display).font(.headline)
                                Spacer()
                                Pill(club.match.display, tone: .neutral)
                            }
                            CellWords(club.description, quiet: true).font(.callout)
                            if let shared = club.shared { CellWords(shared).font(.caption) }
                        }
                        .accessibilityElement(children: .combine)
                    }
                } header: {
                    Text(verbatim: view.comparables.title.display)
                } footer: {
                    VStack(alignment: .leading, spacing: 4) {
                        CellWords(view.comparables.lede, quiet: true)
                        ClaimRow(view.comparables.note, font: .caption, quiet: true)
                    }
                }
                ForEach(view.groups, id: \.id) { group in
                    Section {
                        ForEach(group.dimensions, id: \.id) { dimension in
                            DimensionRow(dimension: dimension) { value in
                                Task {
                                    await model.changePhilosophy(
                                        .init(dimensions: [.init(id: dimension.id, value: .init(value1: value))]),
                                        undoManager: undoManager
                                    )
                                }
                            }
                        }
                    } header: {
                        Text(verbatim: group.title.display)
                    } footer: {
                        CellWords(group.description, quiet: true)
                    }
                }
                Section {
                    ForEach(view.policies.items, id: \.id) { policy in
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
                            VStack(alignment: .leading, spacing: 2) {
                                Text(verbatim: policy.label.display)
                                CellWords(policy.description, quiet: true).font(.caption)
                            }
                        }
                        .pickerStyle(.menu)
                        .accessibilityIdentifier("philosophy.policy.\(policy.id)")
                    }
                } header: {
                    Text(verbatim: view.policies.title.display)
                } footer: {
                    CellWords(view.policies.description, quiet: true)
                }
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(verbatim: view.neutral.title.display).font(.headline)
                        CellWords(view.neutral.text, quiet: true).font(.callout)
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
            .formStyle(.grouped)
            .scrollContentBackground(.hidden)
            .background(Color.readablePage)
            .accessibilityIdentifier("philosophy.form")
            // What the last change did (or why it was refused), in a status strip under the form, where it is seen
            // wherever the GM has scrolled to, as Finder's status bar is
            .safeAreaInset(edge: .bottom, spacing: 0) {
                if store.lastSaid != nil || store.changeProblem != nil {
                    VStack(spacing: 0) {
                        Divider()
                        Group {
                            if let problem = store.changeProblem {
                                ProblemLine(problem)
                            } else if let said = store.lastSaid {
                                Label { CellWords(said) } icon: { Image(systemName: "checkmark.circle") }
                                    .accessibilityElement(children: .combine)
                                    .accessibilityIdentifier("philosophy.said")
                            }
                        }
                        .font(.callout)
                        .padding(.horizontal, 20).padding(.vertical, 8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
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
            CellWords(identity.nuance, quiet: true).font(.callout)
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
            CellWords(dimension.description, quiet: true).font(.caption)
            // Continuous, rounded to a whole number when sent (a stepped slider draws a hundred tick marks)
            Slider(value: $value, in: 0...100) {
                Text(verbatim: dimension.label.display)
            } onEditingChanged: { editing in
                dragging = editing
                if !editing { commit() }
            }
            .labelsHidden()
            .accessibilityHint(Text(verbatim: dimension.position.display))
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
