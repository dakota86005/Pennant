import AppKit
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

// The GM's attention in the Mac app (N7, Stage B; SWIFTUI_REBUILD.md sections 3.4 and 3.6, D-058): a desk item's status
// from its context menu, the Desk menu's keys and VoiceOver's actions; Follow and Unfollow wherever a club or a player
// appears; a club's name that opens its window (double-click, Return, "Open in New Window"); each change undone with the
// server's own request through the window's undo manager. Every word shown is served or a structural label.

// MARK: The desk

/// What the GM can do with a desk item. Each becomes the served request (`DeskUpdate`); the app works out no date: a
/// deferral runs to one of the served `deferChoices`.
public enum DeskAction: Hashable, Sendable {
    case reviewed
    case handled
    /// Back on the desk, open.
    case open
    case deferred(until: String)
    /// The note changed, the status kept.
    case note(String)

    /// The action's structural name (the menu's, and the Edit menu's "Undo …").
    public var name: LocalizedStringResource {
        switch self {
        case .reviewed: "Mark Reviewed"
        case .handled: "Mark Handled in OOTP"
        case .open: "Put Back on Desk"
        case .deferred: "Defer"
        case .note: "Change Note"
        }
    }

    /// The request for an item as it stands (a note kept as it is unless this is the note; a deferral's day kept when
    /// only the note changes).
    public func update(for attention: Components.Schemas.DeskAttention, key: String) -> Components.Schemas.DeskUpdate {
        func status(_ value: Components.Schemas.DeskStatus.Value1Payload) -> Components.Schemas.DeskStatus { .init(value1: value, value2: value.rawValue) }
        switch self {
        case .reviewed: return .init(key: key, status: status(.reviewed))
        case .handled: return .init(key: key, status: status(.handled))
        case .open: return .init(key: key, status: status(.open))
        case .deferred(let until): return .init(key: key, status: status(.deferred), until: until)
        case .note(let text):
            let deferred = attention.status.value1 == .deferred
            return .init(key: key, status: attention.status, until: deferred ? attention.until : nil, note: text)
        }
    }
}

/// The desk item the keyboard focus is in, for the Desk menu's commands: its status, the days it can be deferred to,
/// and what doing something to it means in its window (the window's undo manager).
public struct FocusedDeskItem {
    public var key: String
    public var status: Components.Schemas.DeskStatus
    public var deferChoices: [Components.Schemas.DeferChoice]
    public var perform: @MainActor (DeskAction) -> Void
    /// Opens the item's note for editing.
    public var editNote: @MainActor () -> Void
}

extension FocusedValues {
    @Entry public var deskItem: FocusedDeskItem?
}

/// The Desk menu's items for an item (its context menu, and the menu bar's Desk menu): Mark Reviewed, Defer ▸ the served
/// days, Mark Handled in OOTP, Put Back on Desk once set aside, and Note….
public struct DeskItemMenu: View {
    let status: Components.Schemas.DeskStatus
    let deferChoices: [Components.Schemas.DeferChoice]
    let perform: (DeskAction) -> Void
    let editNote: () -> Void

    public init(status: Components.Schemas.DeskStatus, deferChoices: [Components.Schemas.DeferChoice], perform: @escaping (DeskAction) -> Void, editNote: @escaping () -> Void) {
        self.status = status
        self.deferChoices = deferChoices
        self.perform = perform
        self.editNote = editNote
    }

    public var body: some View {
        let open = status.value1 == .open
        Button("Mark Reviewed", systemImage: "checkmark.circle") { perform(.reviewed) }
            .disabled(status.value1 == .reviewed)
        // The days are the server's; with none served (the league's day not known) nothing can be deferred from here
        Menu {
            ForEach(deferChoices, id: \.until) { choice in
                Button { perform(.deferred(until: choice.until)) } label: { Text(verbatim: choice.text.display) }
                    .help(choice.text.hint.map { Text(verbatim: $0) } ?? Text(verbatim: choice.text.display))
            }
        } label: {
            Label("Defer", systemImage: "clock.arrow.circlepath")
        }
        .disabled(deferChoices.isEmpty)
        Button("Mark Handled in OOTP", systemImage: "checkmark.seal") { perform(.handled) }
            .disabled(status.value1 == .handled)
        if !open {
            Button("Put Back on Desk", systemImage: "tray.and.arrow.up") { perform(.open) }
        }
        Divider()
        Button("Note…", systemImage: "note.text") { editNote() }
    }
}

extension AppModel {
    /// Sends a desk action for an item and registers its undo in the window (`undoManager`), under the action's name.
    public func perform(_ action: DeskAction, on item: Components.Schemas.FoItem, undoManager: UndoManager?) {
        let update = action.update(for: item.attention, key: item.key)
        Task { await changeDesk(update, undoManager: undoManager, actionName: String(localized: action.name)) }
    }
}

/// Edits an item's note: the GM's own words, saved with the status as it is (an empty note clears it).
struct DeskNoteEditor: View {
    let item: Components.Schemas.FoItem
    let dismiss: () -> Void
    @Environment(AppModel.self) private var model
    @Environment(\.undoManager) private var undoManager
    @State private var text: String
    @FocusState private var focused: Bool

    init(item: Components.Schemas.FoItem, dismiss: @escaping () -> Void) {
        self.item = item
        self.dismiss = dismiss
        _text = State(initialValue: item.attention.note ?? "")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Note").font(.headline)
            Text(verbatim: item.headline.text).font(.callout).foregroundStyle(.readableSecondary).lineLimit(2)
            TextField("Your note", text: $text, axis: .vertical)
                .lineLimit(3...6)
                .textFieldStyle(.roundedBorder)
                .focused($focused)
                .accessibilityIdentifier("desk.note.field")
            HStack {
                if item.attention.note != nil {
                    Button("Clear Note") { save("") }
                }
                Spacer()
                Button("Cancel", role: .cancel) { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button("Save Note") { save(text) }
                    .keyboardShortcut(.defaultAction)
                    .accessibilityIdentifier("desk.note.save")
            }
            .controlSize(.small)
        }
        .padding(16)
        .frame(width: 340)
        .onAppear { focused = true }
    }

    private func save(_ note: String) {
        model.perform(.note(note), on: item, undoManager: undoManager)
        dismiss()
    }
}

// MARK: Following

extension AppModel {
    /// Follows or unfollows a club or a player, undone through the window's undo manager.
    public func toggleFollow(kind: String, id: Int, undoManager: UndoManager?) {
        let following = following.isFollowing(kind: kind, id: id)
        let request: FollowingStore.Request = following ? .unfollow(kind: kind, id: id) : .follow(kind: kind, id: id)
        let name: LocalizedStringResource = following ? "Unfollow" : "Follow"
        Task { await changeFollow(request, undoManager: undoManager, actionName: String(localized: name)) }
    }
}

/// Follow or Unfollow in a menu, by what the served Following names.
public struct FollowMenuItem: View {
    let kind: String
    let id: Int
    @Environment(AppModel.self) private var model
    @Environment(\.undoManager) private var undoManager

    public init(kind: String, id: Int) {
        self.kind = kind
        self.id = id
    }

    public var body: some View {
        if model.following.isFollowing(kind: kind, id: id) {
            Button("Unfollow", systemImage: "star.slash") { model.toggleFollow(kind: kind, id: id, undoManager: undoManager) }
        } else {
            Button("Follow", systemImage: "star") { model.toggleFollow(kind: kind, id: id, undoManager: undoManager) }
        }
    }
}

// MARK: A club's name, a player's name

/// Where a player opens for now (N7): his organization's club window, when the served target names it (player windows
/// arrive with N11).
public func clubRef(opening target: Components.Schemas.Target?) -> ClubRef? {
    guard let target, let team = target.teamId else { return nil }
    switch target.kind.value1 {
    case .club, .player: return ClubRef(id: team)
    default: return nil
    }
}

extension View {
    /// A club's name that opens the club's window: a double-click, Return while it is focused, or its context menu's
    /// "Open in New Window"; the menu also follows or unfollows it and copies its name, and it can be dragged (onto
    /// Following, to follow it). VoiceOver offers the same as actions.
    public func clubName(id: Int, name: String) -> some View {
        modifier(ClubNameModifier(id: id, name: name))
    }

    /// A player's name: Follow or Unfollow and Copy Name in its context menu, the nearest view (his organization's club
    /// window) on a double-click or Return when served, and a drag (onto Following).
    /// `name` is his served name, or nil where only a served line about him is shown (no Copy Name then).
    public func playerName(id: Int, name: String?, opens club: ClubRef?) -> some View {
        modifier(PlayerNameModifier(id: id, name: name, club: club))
    }
}

struct ClubNameModifier: ViewModifier {
    let id: Int
    let name: String
    @Environment(\.openWindow) private var openWindow
    @Environment(AppModel.self) private var model
    @Environment(\.undoManager) private var undoManager

    func body(content: Content) -> some View {
        content
            .contentShape(.rect)
            .focusable()
            .onKeyPress(.return) {
                openWindow(value: ClubRef(id: id))
                return .handled
            }
            .onTapGesture(count: 2) { openWindow(value: ClubRef(id: id)) }
            .contextMenu {
                Button("Open in New Window", systemImage: "macwindow.badge.plus") { openWindow(value: ClubRef(id: id)) }
                FollowMenuItem(kind: "club", id: id)
                Divider()
                Button("Copy Name", systemImage: "doc.on.doc") { copy(name) }
            }
            .draggable(ClubRef(id: id)) {
                Label { Text(verbatim: name) } icon: { Image(systemName: "building.2") }
                    .padding(6).background(.regularMaterial, in: .capsule)
            }
            // One element for VoiceOver: the club's name, a button that opens its window, with Follow as an action
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isButton)
            .accessibilityAction { openWindow(value: ClubRef(id: id)) }
            .accessibilityAction(named: Text("Open in New Window")) { openWindow(value: ClubRef(id: id)) }
            .accessibilityAction(named: model.following.isFollowing(kind: "club", id: id) ? Text("Unfollow") : Text("Follow")) {
                model.toggleFollow(kind: "club", id: id, undoManager: undoManager)
            }
            .accessibilityIdentifier("club.\(id)")
    }
}

struct PlayerNameModifier: ViewModifier {
    let id: Int
    let name: String?
    let club: ClubRef?
    @Environment(\.openWindow) private var openWindow
    @Environment(AppModel.self) private var model
    @Environment(\.undoManager) private var undoManager

    func body(content: Content) -> some View {
        content
            .contentShape(.rect)
            .onTapGesture(count: 2) { if let club { openWindow(value: club) } }
            .contextMenu {
                if let club {
                    Button("Open His Club", systemImage: "macwindow.badge.plus") { openWindow(value: club) }
                }
                FollowMenuItem(kind: "player", id: id)
                if let name {
                    Divider()
                    Button("Copy Name", systemImage: "doc.on.doc") { copy(name) }
                }
            }
            .draggable(PlayerRef(id: id)) {
                Label { if let name { Text(verbatim: name) } } icon: { Image(systemName: "person") }
                    .padding(6).background(.regularMaterial, in: .capsule)
            }
            .accessibilityElement(children: .combine)
            .accessibilityAction(named: model.following.isFollowing(kind: "player", id: id) ? Text("Unfollow") : Text("Follow")) {
                model.toggleFollow(kind: "player", id: id, undoManager: undoManager)
            }
            .accessibilityIdentifier("player.\(id)")
    }
}

/// Copies a served name to the pasteboard.
@MainActor
func copy(_ text: String) {
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(text, forType: .string)
}

/// Names the AppKit containers above a window's content for VoiceOver (the audit reports each as a group with no
/// description; no SwiftUI modifier reaches them): walking up from the content, each view that vends itself as an unnamed
/// group takes the next structural name. Only labels change, never children or roles. The main window's are named in
/// the Shell; a club's window names its own with this.
public struct WindowContainerLabels: NSViewRepresentable {
    let names: [LocalizedStringResource]

    public init(_ names: [LocalizedStringResource]) {
        self.names = names
    }

    public func makeNSView(context: Context) -> Finder { Finder(names: names) }
    public func updateNSView(_ view: Finder, context: Context) { view.nameContainers() }

    public final class Finder: NSView {
        let names: [LocalizedStringResource]

        init(names: [LocalizedStringResource]) {
            self.names = names
            super.init(frame: .zero)
        }

        required init?(coder: NSCoder) { nil }

        override public func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            nameContainers()
        }

        func nameContainers() {
            var names = names
            var view = superview
            while let current = view, !names.isEmpty {
                if current.isAccessibilityElement(), current.accessibilityRole() == .group {
                    let name = names.removeFirst()
                    if current.accessibilityLabel()?.isEmpty ?? true { current.setAccessibilityLabel(String(localized: name)) }
                }
                view = current.superview
            }
        }

        override public func isAccessibilityElement() -> Bool { false }
    }
}
