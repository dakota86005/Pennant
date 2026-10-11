import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

/// The Staff room (N13; SWIFTUI_REBUILD.md section 3.1, `Window(id: "staff")`; D-074): the people the club can ask down
/// the side, as Messages lists its conversations, and the conversation with the one chosen (or the room) beside them,
/// an answer streaming in. Every word is the server's; the AI explains Pennant's figures and decides nothing, and with
/// AI off the room says so in one served line while the rest of the app works. Drop a player on it to ask about him.
public struct StaffRoomScene: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openWindow) private var openWindow
    /// Who the GM is talking to, kept for the window.
    @SceneStorage("staffRoom.with") private var with = "analyst"
    /// The room's members the GM chose, per club (`[club id: [person ids]]` as JSON), else the served default.
    @AppStorage("PennantStaffRoomMembers") private var membersByClub = "{}"
    @State private var dropTargeted = false
    @State private var confirmingStartOver = false
    private let router = StaffRoomRouter.shared

    public init() {}

    private var store: StaffRoomStore { model.staffRoom }

    public var body: some View {
        NavigationSplitView {
            sidebar
                .navigationSplitViewColumnWidth(min: 180, ideal: 210, max: 280)
        } detail: {
            detail
        }
        // Kept as the window's title (VoiceOver, the Window menu) but not drawn in the toolbar, as the main window does:
        // the system's title grey over the content failed the contrast audit there
        .navigationTitle(Text(verbatim: store.view?.title.display ?? ""))
        .toolbar(removing: .title)
        .toolbar { toolbar }
        .dropDestination(for: PlayerRef.self) { players, _ in
            guard let player = players.first else { return false }
            return askAbout(player)
        } isTargeted: { dropTargeted = $0 }
        .overlay { if dropTargeted, let words = store.view?.askAbout { DropHint(words: words) } }
        .confirmationDialog(
            Text(verbatim: store.view?.startOver.display ?? ""), isPresented: $confirmingStartOver, titleVisibility: .visible
        ) {
            Button(role: .destructive) {
                let with = with
                Task { await model.startStaffOver(with) }
            } label: { Text(verbatim: store.view?.startOver.display ?? "") }
        } message: {
            // What it clears, in the server's words, as Mail says what can't be undone (review N13B, L8)
            if let warning = store.view?.staff.first(where: { $0.id == with })?.startOverWarning {
                Text(verbatim: warning.display)
            }
        }
        .task(id: RoomTask(key: model.storeKey, keysRevision: model.keysRevision)) { await model.loadStaffRoom() }
        .task(id: ConversationTask(key: model.storeKey, with: with)) { await model.loadStaffConversation(with) }
        .onAppear { takeHandedPlayer() }
        .onChange(of: router.pending) { _, _ in takeHandedPlayer() }
        // A player handed over before the room was read is asked about once it is
        .onChange(of: store.view == nil) { _, _ in takeHandedPlayer() }
        .onChange(of: store.view?.staff.map(\.id)) { _, ids in
            // A person this save's staff no longer has: back to the first served one
            if let ids, !ids.isEmpty, !ids.contains(with) { with = ids[0] }
        }
        .frame(minWidth: 640, minHeight: 460)
        .accessibilityIdentifier("staffRoom")
    }

    // MARK: Who can be asked

    @ViewBuilder
    private var sidebar: some View {
        if let view = store.view {
            List(selection: Binding(get: { Optional(with) }, set: { if let next = $0 { with = next } })) {
                ForEach(view.staff, id: \.id) { member in
                    VStack(alignment: .leading, spacing: 1) {
                        Text(verbatim: member.name.display).font(.body.weight(.semibold))
                            .accessibilityIdentifier("staffRoom.member.\(member.id)")
                        // On the selected row the system's selection colour: primary there, so it reads as the name does
                        Text(verbatim: member.role.display).font(.caption)
                            .foregroundStyle(member.id == with ? AnyShapeStyle(.primary) : AnyShapeStyle(.readableSecondary))
                    }
                    .help(detail: member.role.hint)
                    .tag(member.id)
                }
            }
            .listStyle(.sidebar)
            .accessibilityIdentifier("staffRoom.people")
            .background(SidebarColumnName())
        } else if let problem = store.viewProblem {
            ProblemLine(problem).padding()
        } else {
            ProgressView { Text("Loading") }.frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    @ViewBuilder
    private var detail: some View {
        if let view = store.view, let member = view.staff.first(where: { $0.id == with }) ?? view.staff.first {
            StaffConversationView(
                view: view,
                member: member,
                members: member.room ? Binding(get: { members(view) }, set: { keep($0) }) : nil
            )
            .id(member.id)
            .background(WindowContainerNames(names: ["Conversation", "Staff Room"]))
        } else if store.view == nil, store.viewProblem == nil, !model.isReady {
            ProgressView { Text("Starting…") }.frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            Color.clear
        }
    }

    // MARK: Stop, Start over

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        if let view = store.view {
            ToolbarItem(placement: .primaryAction) {
                if store.isAnswering(with) {
                    Button {
                        model.stopStaff(with)
                    } label: {
                        Label { Text(verbatim: view.stop.display) } icon: { Image(systemName: "stop.fill") }
                    }
                    .keyboardShortcut(.escape, modifiers: [])
                    .help(Text(verbatim: view.stop.display))
                    .accessibilityIdentifier("staffRoom.stop")
                } else {
                    Button {
                        confirmingStartOver = true
                    } label: {
                        Label { Text(verbatim: view.startOver.display) } icon: { Image(systemName: "square.and.pencil") }
                    }
                    .help(Text(verbatim: view.startOver.display))
                    .disabled((store.conversations[with]?.messages.isEmpty ?? true))
                    .accessibilityIdentifier("staffRoom.startOver")
                }
            }
        }
    }

    // MARK: The room's members, per club

    private var clubKey: String { model.club.map { String($0.ref.id) } ?? "automatic" }

    private func members(_ view: Components.Schemas.StaffRoomView) -> [String] {
        let kept = (try? JSONDecoder().decode([String: [String]].self, from: Data(membersByClub.utf8)))?[clubKey]
        let known = Set(view.staff.filter { !$0.room }.map(\.id))
        let chosen = (kept ?? view.room?.members ?? []).filter(known.contains)
        return Array(chosen.prefix(view.room?.limit ?? chosen.count))
    }

    private func keep(_ chosen: [String]) {
        var all = (try? JSONDecoder().decode([String: [String]].self, from: Data(membersByClub.utf8))) ?? [:]
        all[clubKey] = chosen
        if let data = try? JSONEncoder().encode(all) { membersByClub = String(decoding: data, as: UTF8.self) }
    }

    // MARK: Asking about a player

    /// A player dropped on the room, or handed over by "Ask Staff About Him": the server words the question.
    @discardableResult
    private func askAbout(_ player: PlayerRef) -> Bool {
        guard let view = store.view, view.ai.available else { return false }
        let room = view.staff.first { $0.id == with }?.room ?? false
        // The room with nobody in it asks no one, as its Send button does not (review N13B, L10)
        if room, members(view).isEmpty { return false }
        return model.askStaff(.about(playerId: player.id), with: with, members: room ? members(view) : nil)
    }

    private func takeHandedPlayer() {
        guard router.pending != nil, store.view != nil, let player = router.take() else { return }
        askAbout(player)
    }

    private struct RoomTask: Hashable {
        var key: AppModel.StoreKey?
        var keysRevision: Int
    }

    private struct ConversationTask: Hashable {
        var key: AppModel.StoreKey?
        var with: String
    }
}

/// While a player is dragged over the room: the served "Ask about him", on a fixed, checked fill.
private struct DropHint: View {
    let words: Components.Schemas.Cell

    var body: some View {
        RoundedRectangle(cornerRadius: 12)
            .strokeBorder(Color.accentColor, style: StrokeStyle(lineWidth: 3, dash: [8, 6]))
            .overlay {
                Label { Text(verbatim: words.display) } icon: { Image(systemName: "person.crop.circle.badge.questionmark") }
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(.primary)
                    .padding(.horizontal, 16).padding(.vertical, 10)
                    .background(Color.readableChipFill, in: .capsule)
            }
            .padding(8)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}
