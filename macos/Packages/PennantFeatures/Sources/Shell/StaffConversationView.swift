import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

/// One conversation in the Staff room: what he is for and the questions worth asking him before the first one, the
/// served history (the GM's words as typed, each answer as served with its links and what was looked up), the answer
/// streaming in, how the last one failed (its partial kept), and the compose field. Following the bottom while an answer
/// streams unless the GM has scrolled up, as Messages does; VoiceOver hears each finished answer once, never the deltas.
struct StaffConversationView: View {
    let view: Components.Schemas.StaffRoomView
    let member: Components.Schemas.StaffMemberView
    /// In the room: who is in it (the GM's choice per club); nil for one person.
    let members: Binding<[String]>?
    @Environment(AppModel.self) private var model
    @State private var draft = ""
    @State private var atBottom = true
    @FocusState private var composing: Bool

    private var store: StaffRoomStore { model.staffRoom }
    private var with: String { member.id }
    private var conversation: Components.Schemas.StaffRoomConversation? { store.conversations[with] }
    private var answer: StaffRoomAnswer? { store.answers[with] }

    var body: some View {
        ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 14) {
                        if (conversation?.messages.isEmpty ?? true) && answer == nil { opening }
                        ForEach(kept, id: \.id) { message in MessageView(message: message, previous: previous(of: message)) }
                        if let answer { LiveAnswerView(answer: answer, keptIds: Set(kept.map(\.id))) }
                        endings
                        Color.clear.frame(height: 1).id(Self.bottom)
                    }
                    .padding(20)
                    .frame(maxWidth: 760)
                    .frame(maxWidth: .infinity)
                }
                // A conversation reads from the bottom, as Messages does; the opening, before one, from the top
                .defaultScrollAnchor(kept.isEmpty && answer == nil ? .top : .bottom)
                .onScrollGeometryChange(for: Bool.self) { geometry in
                    geometry.contentOffset.y + geometry.containerSize.height >= geometry.contentSize.height - 48
                } action: { _, bottom in atBottom = bottom }
                .onChange(of: answer?.messages.last?.streamed.count) { _, _ in follow(proxy) }
                .onChange(of: answer?.messages.count) { _, _ in follow(proxy) }
                .onChange(of: conversation?.conversationStamp) { _, _ in follow(proxy) }
                // Who is in the room above the conversation, the compose field below it, each in the safe area (under
                // the toolbar, never beneath it), on the page's opaque colour
                .safeAreaInset(edge: .top, spacing: 0) {
                    if let members, let room = view.room {
                        VStack(spacing: 0) {
                            RoomMembers(view: view, room: room, chosen: members)
                            Divider()
                        }
                        .background(Color.readablePage)
                    }
                }
                .safeAreaInset(edge: .bottom, spacing: 0) {
                    VStack(spacing: 0) {
                        Divider()
                        compose
                    }
                    .background(Color.readablePage)
                }
        }
        .background(Color.readablePage)
        .onChange(of: answer?.answeredCount) { _, count in
            guard let count, count > 0, let last = answer?.lastAnswered, let markdown = last.answer?.markdown else { return }
            let speaker = last.speaker?.display ?? ""
            AccessibilityNotification.Announcement("\(speaker)\n\(AiTextRendering.plain(markdown))").post()
        }
    }

    private static let bottom = "staffRoom.bottom"

    private func follow(_ proxy: ScrollViewProxy) {
        guard atBottom else { return }
        proxy.scrollTo(Self.bottom, anchor: .bottom)
    }

    /// The kept messages, then the question just asked while it is not kept yet.
    private var kept: [Components.Schemas.StaffRoomMessage] {
        var messages = conversation?.messages ?? []
        if let question = answer?.question, !messages.contains(where: { $0.id == question.id }) { messages.append(question) }
        return messages
    }

    private func previous(of message: Components.Schemas.StaffRoomMessage) -> Components.Schemas.StaffRoomMessage? {
        guard let index = kept.firstIndex(where: { $0.id == message.id }), index > 0 else { return nil }
        return kept[index - 1]
    }

    /// Before the first question: what he is for, and the questions worth asking him.
    private var opening: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(verbatim: member.intro.display)
                .font(.title3)
                .foregroundStyle(.primary)
                .fixedSize(horizontal: false, vertical: true)
            if view.ai.available {
                ForEach(Array(member.starters.enumerated()), id: \.offset) { _, starter in
                    Button { send(starter.display) } label: {
                        Label { Text(verbatim: starter.display) } icon: { Image(systemName: "text.bubble") }
                    }
                    .buttonStyle(.bordered)
                    .disabled(store.isAnswering(with))
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("staffRoom.opening")
    }

    /// How it stands after the last answer: the served failure (its partial answer above, kept), why a question was
    /// refused, "Started over with …", and the marking that the answers are the AI's.
    @ViewBuilder
    private var endings: some View {
        if let notices = answer?.notices, !notices.isEmpty {
            ForEach(Array(notices.enumerated()), id: \.offset) { _, notice in
                Text(verbatim: notice.display).font(.caption).foregroundStyle(.readableSecondary).help(detail: notice.hint)
            }
        }
        if let failure = store.failures[with] {
            AiClaimLine(failure.failure).accessibilityIdentifier("staffRoom.failure")
        }
        if let problem = store.askProblems[with] { ProblemLine(problem) }
        if let done = store.startedOver[with] {
            Text(verbatim: done.display).font(.callout).foregroundStyle(.readableSecondary)
        }
        if let written = conversation?.written, !kept.isEmpty { AiMarking(written) }
    }

    // MARK: The compose field

    @ViewBuilder
    private var compose: some View {
        if let off = view.ai.off {
            // AI off: one calm served line; everything else in Pennant works without it
            AiClaimLine(off)
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityIdentifier("staffRoom.aiOff")
        } else {
            HStack(alignment: .bottom, spacing: 8) {
                TextField(text: $draft, prompt: Text(verbatim: member.placeholder.display), axis: .vertical) {
                    Text("Message")
                }
                .textFieldStyle(.roundedBorder)
                .lineLimit(1...6)
                .focused($composing)
                .onSubmit { send(draft) }
                .accessibilityIdentifier("staffRoom.compose")
                Button { send(draft) } label: { Label("Send", systemImage: "arrow.up.circle.fill") }
                    .labelStyle(.iconOnly)
                    .keyboardShortcut(.return, modifiers: .command)
                    .disabled(store.isAnswering(with) || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                        || (members?.wrappedValue.isEmpty ?? false))
                    .help(Text("Send"))
                    .accessibilityIdentifier("staffRoom.send")
            }
            .padding(12)
            .onAppear { composing = true }
        }
    }

    private func send(_ words: String) {
        let question = words.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !question.isEmpty else { return }
        if model.askStaff(.typed(question), with: with, members: members?.wrappedValue) {
            if words == draft { draft = "" }
            atBottom = true
        }
    }
}

/// Who is in the room: the served title, each person as a toggle (at most the served limit), how the room works in the
/// help tag, and the served "Pick at least one." when nobody is.
private struct RoomMembers: View {
    let view: Components.Schemas.StaffRoomView
    let room: Components.Schemas.StaffRoomPicker
    let chosen: Binding<[String]>

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Text(verbatim: room.title.display).font(.callout.weight(.semibold)).help(detail: room.hint.display)
                ForEach(view.staff.filter { !$0.room }, id: \.id) { person in
                    let on = chosen.wrappedValue.contains(person.id)
                    Toggle(isOn: Binding(get: { on }, set: { toggle(person.id, $0) })) {
                        Text(verbatim: person.name.display)
                    }
                    .toggleStyle(.button)
                    .disabled(!on && chosen.wrappedValue.count >= room.limit)
                    .help(detail: person.role.hint ?? person.role.display)
                    .accessibilityIdentifier("staffRoom.inRoom.\(person.id)")
                }
            }
            if chosen.wrappedValue.isEmpty {
                Text(verbatim: room.pickOne.display).font(.caption).foregroundStyle(.readableSecondary)
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: room.title.display))
        .accessibilityIdentifier("staffRoom.room")
    }

    private func toggle(_ id: String, _ on: Bool) {
        var next = chosen.wrappedValue.filter { $0 != id }
        if on, next.count < room.limit { next.append(id) }
        chosen.wrappedValue = next
    }
}

/// One kept message: the served day where it changes, then the GM's words as typed (trailing), or an answer as served
/// (who said it, the text with its links, what he looked up, the time).
private struct MessageView: View {
    let message: Components.Schemas.StaffRoomMessage
    let previous: Components.Schemas.StaffRoomMessage?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let day = message.calendarDay, day.display != previous?.calendarDay?.display {
                Text(verbatim: day.display)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.readableSecondary)
                    .frame(maxWidth: .infinity)
                    .accessibilityAddTraits(.isHeader)
            }
            if message.from.value1 == .gm {
                QuestionBubble(words: message.typed ?? "", clock: message.clock)
            } else {
                AnswerBody(
                    speaker: message.speaker, lookedUp: message.lookedUp, clock: message.clock,
                    text: { if let answer = message.answer { AiTextView(answer) } }
                )
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("staffRoom.message.\(message.id)")
    }
}

/// The GM's question, as typed, on the trailing side.
private struct QuestionBubble: View {
    let words: String
    let clock: Components.Schemas.Cell?

    var body: some View {
        VStack(alignment: .trailing, spacing: 3) {
            Text(verbatim: words)
                .foregroundStyle(.primary)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 12).padding(.vertical, 8)
                .background(Color.readableChipFill, in: .rect(cornerRadius: 12))
            if let clock { Text(verbatim: clock.display).font(.caption2).foregroundStyle(.readableSecondary) }
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
        .padding(.leading, 80)
    }
}

/// An answer's frame: who answered, the steps he looked up (quiet lines), the text, the time.
private struct AnswerBody<Content: View>: View {
    let speaker: Components.Schemas.Cell?
    let lookedUp: [Components.Schemas.Cell]
    let clock: Components.Schemas.Cell?
    @ViewBuilder let text: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            if let speaker {
                Text(verbatim: speaker.display).font(.caption.weight(.semibold)).foregroundStyle(.readableSecondary)
                    .help(detail: speaker.hint)
            }
            ForEach(Array(lookedUp.enumerated()), id: \.offset) { _, step in
                Label { Text(verbatim: step.display) } icon: { Image(systemName: "magnifyingglass") }
                    .font(.caption)
                    .foregroundStyle(.readableSecondary)
            }
            text()
            if let clock { Text(verbatim: clock.display).font(.caption2).foregroundStyle(.readableSecondary) }
        }
        .padding(.trailing, 40)
        .overlay(alignment: .leading) { Rectangle().fill(Color.accentColor.opacity(0.5)).frame(width: 3).offset(x: -10) }
    }
}

/// The answer streaming in: each person's text as it arrives (the final text with its links once `answered` replaces
/// it), the steps he is looking up, and a spinner while the first words are awaited.
private struct LiveAnswerView: View {
    let answer: StaffRoomAnswer
    /// Messages already in the kept conversation (drawn there).
    let keptIds: Set<String>

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            ForEach(answer.messages.filter { !keptIds.contains($0.id) }) { live in
                AnswerBody(speaker: live.speaker ?? live.final?.speaker, lookedUp: live.final?.lookedUp ?? live.lookedUp, clock: live.final?.clock) {
                    if let final = live.final?.answer {
                        AiTextView(final)
                    } else if !live.streamed.isEmpty {
                        AiStreamedText(live.streamed)
                    }
                }
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("staffRoom.live.\(live.id)")
            }
            if answer.outcome.isRunning, answer.messages.last?.streamed.isEmpty ?? true, answer.messages.last?.final == nil {
                ProgressView().controlSize(.small).accessibilityLabel(Text("Thinking"))
            }
        }
    }
}
