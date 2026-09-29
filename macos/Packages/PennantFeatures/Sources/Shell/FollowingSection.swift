import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI
import UniformTypeIdentifiers

/// The sidebar's Following section (SWIFTUI_REBUILD.md section 3.2, D-058): the clubs and players the GM follows, each
/// with its served line; a club opens its window (double-click, Return, or "Open in New Window") and a player his club's
/// for now; each can be unfollowed from its context menu (⌘Z puts it back as it was). Drop a club or a player on the
/// section to follow it. The division rivals are suggested with the server's why, and followed only on the GM's click.
/// A refusal ("The save you chose isn't imported yet, …") is the server's sentence, in place.
struct FollowingSection: View {
    @Environment(AppModel.self) private var model
    @Environment(\.undoManager) private var undoManager
    @State private var targeted = false

    var body: some View {
        let store = model.following
        Section {
            if let following = store.following {
                ForEach(following.clubs, id: \.id) { item in
                    FollowedRow(item: item)
                        .clubName(id: item.id, name: item.name)
                        .followingDrop(targeted: $targeted, follow: follow)
                        .accessibilityIdentifier("following.club.\(item.id)")
                }
                ForEach(following.players, id: \.id) { item in
                    FollowedRow(item: item)
                        .playerName(id: item.id, name: item.name, opens: clubRef(opening: item.open))
                        .followingDrop(targeted: $targeted, follow: follow)
                        .accessibilityIdentifier("following.player.\(item.id)")
                }
                if let empty = following.empty {
                    Text(verbatim: empty.display)
                        .font(.callout)
                        .foregroundStyle(.readableSecondary)
                        .help(detail: empty.hint)
                        .followingDrop(targeted: $targeted, follow: follow)
                        .accessibilityIdentifier("following.empty")
                }
                if let watchlist = following.watchlist {
                    Text(verbatim: watchlist.display).font(.caption).foregroundStyle(.readableSecondary).help(detail: watchlist.hint)
                }
                ForEach(following.suggestions, id: \.id) { suggestion in
                    SuggestionRow(suggestion: suggestion)
                }
            } else if let problem = store.problem {
                ProblemLine(problem)
            }
            if let refusal = store.refusal {
                HStack(alignment: .firstTextBaseline) {
                    ProblemLine(refusal)
                    Button("Dismiss") { store.dismissRefusal() }.controlSize(.small)
                }
                .accessibilityIdentifier("following.refusal")
            }
        } header: {
            Text("Following")
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 2)
                .background(targeted ? Color.accentColor.opacity(0.18) : .clear, in: .rect(cornerRadius: 6))
                .contentShape(.rect)
                .followingDrop(targeted: $targeted, follow: follow)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("sidebar.following")
                // AppKit's row for the section's header, named for VoiceOver (the audit found it a group with none)
                .background(SectionHeaderName())
        }
        .task(id: model.storeKey) { await model.loadFollowing() }
    }

    /// Follows what was dropped (never what was already followed: the server keeps a follow once).
    private func follow(_ kind: String, _ id: Int) {
        guard !model.following.isFollowing(kind: kind, id: id) else { return }
        model.toggleFollow(kind: kind, id: id, undoManager: undoManager)
    }
}

/// A followed club or player: a star, the served name and line, and the served "following since" in its help tag.
struct FollowedRow: View {
    let item: Components.Schemas.FollowedItem

    var body: some View {
        Label {
            VStack(alignment: .leading, spacing: 1) {
                Text(verbatim: item.name).lineLimit(1)
                Text(verbatim: item.line.display).font(.caption).foregroundStyle(.readableSecondary).lineLimit(1)
            }
        } icon: {
            Image(systemName: item.kind.value1 == .player ? "person.fill" : "star.fill").accessibilityHidden(true)
        }
        .help(Text(verbatim: [item.since.display, item.note].compactMap { $0 }.joined(separator: "\n")))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("following.\(item.kind.value1?.rawValue ?? item.kind.value2 ?? "item").\(item.id)")
    }
}

/// A division rival the server suggests, with its why; Follow is the GM's click, never done by itself.
struct SuggestionRow: View {
    let suggestion: Components.Schemas.FollowSuggestion
    @Environment(AppModel.self) private var model
    @Environment(\.undoManager) private var undoManager

    var body: some View {
        HStack(spacing: 6) {
            VStack(alignment: .leading, spacing: 1) {
                Text(verbatim: suggestion.name).lineLimit(1)
                Text(verbatim: suggestion.why.display).font(.caption).foregroundStyle(.readableSecondary).lineLimit(1)
            }
            .clubName(id: suggestion.id, name: suggestion.name)
            Spacer(minLength: 4)
            Button("Follow") { model.toggleFollow(kind: "club", id: suggestion.id, undoManager: undoManager) }
                .controlSize(.small)
                .help(detail: suggestion.why.hint ?? suggestion.why.display)
                .accessibilityIdentifier("following.suggestion.\(suggestion.id)")
        }
        .accessibilityElement(children: .contain)
    }
}

extension View {
    /// Takes a club or a player dropped here (dragged from the wire, a club window, a report) and follows it.
    func followingDrop(targeted: Binding<Bool>, follow: @escaping @MainActor (String, Int) -> Void) -> some View {
        onDrop(of: [.pennantClub, .pennantPlayer], isTargeted: targeted) { providers in
                var took = false
            for provider in providers {
                if provider.hasItemConformingToTypeIdentifier(UTType.pennantClub.identifier) {
                    took = true
                    _ = provider.loadTransferable(type: ClubRef.self) { result in
                        if case .success(let club) = result { Task { @MainActor in follow("club", club.id) } }
                    }
                } else if provider.hasItemConformingToTypeIdentifier(UTType.pennantPlayer.identifier) {
                    took = true
                    _ = provider.loadTransferable(type: PlayerRef.self) { result in
                        if case .success(let player) = result { Task { @MainActor in follow("player", player.id) } }
                    }
                }
            }
            return took
        }
    }
}

/// Names the list's own row around the Following header for VoiceOver: AppKit draws it (a group with no description, which
/// the accessibility audit reports), so no SwiftUI modifier reaches it. Walking up a few views from the header, the first
/// that vends itself as an unnamed group is given the section's structural name; only its label changes.
struct SectionHeaderName: NSViewRepresentable {
    static let name: LocalizedStringResource = "Following"

    func makeNSView(context: Context) -> Finder { Finder() }
    func updateNSView(_ view: Finder, context: Context) { view.name() }

    final class Finder: NSView {
        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            name()
        }

        func name() {
            var view = superview
            var steps = 0
            while let current = view, steps < 6, !(current is NSTableView), !(current is NSOutlineView) {
                if current.isAccessibilityElement(), current.accessibilityRole() == .group, current.accessibilityLabel()?.isEmpty ?? true {
                    current.setAccessibilityLabel(String(localized: SectionHeaderName.name))
                    return
                }
                view = current.superview
                steps += 1
            }
        }

        override func isAccessibilityElement() -> Bool { false }
    }
}
