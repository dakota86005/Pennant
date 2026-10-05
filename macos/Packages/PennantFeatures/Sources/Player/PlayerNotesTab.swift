import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

/// Notes: the GM's own note on him, edited in place and saved as he types (a moment after the last key, exactly as typed:
/// the server keeps his words on his follow, as the watchlist did), undone with ⌘Z like any text; and the notes the staff
/// filed on him, each with who and when, removable (and that undone with ⌘Z too).
struct PlayerNotesTab: View {
    let playerId: Int
    @Environment(AppModel.self) private var model
    @Environment(\.undoManager) private var undoManager
    @State private var text = ""
    /// The note as the server last kept it: typing differs from it until it is saved.
    @State private var saved: String?
    /// Whether this window's first note is what followed him (its emptying again stops following him, the served undo).
    @State private var followedByNote = false
    @State private var loaded = false

    var body: some View {
        let notes = model.players.notes[playerId]
        PlayerPage(id: "notes") {
            PlayerSection("Your Note", note: notes?.explain) {
                TextEditor(text: $text)
                    .font(.body)
                    .scrollContentBackground(.hidden)
                    .padding(8)
                    .frame(minHeight: 160, maxHeight: 360)
                    .background(Color.readableChipFill, in: .rect(cornerRadius: 8))
                    .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color.primary.opacity(0.2)))
                    .disabled(!loaded)
                    .accessibilityLabel(Text("Your Note"))
                    .accessibilityIdentifier("player.notes.editor")
                HStack(spacing: 6) {
                    if text != (saved ?? "") && loaded {
                        Text("Saving…").font(.caption).foregroundStyle(.readableSecondary)
                    } else if let done = model.players.noteDone[playerId] {
                        Text(verbatim: done).font(.caption).foregroundStyle(.readableSecondary)
                            .accessibilityIdentifier("player.notes.done")
                    }
                }
                if let problem = model.players.noteProblems[playerId] { ProblemLine(problem) }
            }
            PlayerSection("Staff Notes") {
                if let notes {
                    if let empty = notes.staffEmpty { Text(verbatim: empty.display).foregroundStyle(.readableSecondary) }
                    ForEach(notes.staff, id: \.id) { note in StaffNoteRow(playerId: playerId, note: note) }
                }
            }
        }
        .task(id: playerId) {
            await model.loadPlayerNotes(playerId)
            guard let served = model.players.notes[playerId] else { return }
            if !loaded {
                saved = served.note ?? ""
                text = served.note ?? ""
                loaded = true
            }
        }
        // Saved a moment after the last key, as typed; the next key cancels the wait
        .task(id: text) {
            guard loaded, text != (saved ?? "") else { return }
            try? await Task.sleep(for: .milliseconds(600))
            guard !Task.isCancelled else { return }
            await save(text)
        }
    }

    private func save(_ typed: String) async {
        if typed.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, followedByNote {
            // Emptied again: undo what the first note did (it followed him), as the server's undo says
            if await model.undoFirstPlayerNote(playerId) != nil {
                followedByNote = false
                saved = typed
            }
            return
        }
        guard let change = await model.savePlayerNote(playerId, typed) else { return }
        if change.undoUnfollows { followedByNote = true }
        saved = typed
    }
}

/// A staff note as filed: who and when, the words as written, and Remove (undone with ⌘Z).
struct StaffNoteRow: View {
    let playerId: Int
    let note: Components.Schemas.PlayerStaffNote
    @Environment(AppModel.self) private var model
    @Environment(\.undoManager) private var undoManager

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(verbatim: note.who.display).fontWeight(.semibold)
                if let when = note.when { Text(verbatim: when.display).foregroundStyle(.readableSecondary) }
                Spacer(minLength: 0)
                Button("Remove") {
                    Task { await model.removeStaffNote(playerId, noteId: note.id, undoManager: undoManager, actionName: String(localized: "Remove Staff Note")) }
                }
                .buttonStyle(.borderless)
                .accessibilityIdentifier("player.notes.remove.\(note.id)")
            }
            .font(.callout)
            Text(verbatim: note.body).fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.readableChipFill, in: .rect(cornerRadius: 8))
        .accessibilityElement(children: .contain)
    }
}
