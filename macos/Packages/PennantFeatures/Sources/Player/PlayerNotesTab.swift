import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

/// Notes: the GM's own note on him, edited in place and saved as he types (a moment after the last key, exactly as typed:
/// the server keeps his words on his follow, as the watchlist did), undone with ⌘Z like any text; and the notes the staff
/// filed on him, each with who and when, removable (and that undone with ⌘Z too). What he types lives in the player
/// store, not in this view (review H2): leaving the section or closing the window saves it at once, and a quit sends it
/// before the server stops.
struct PlayerNotesTab: View {
    let playerId: Int
    @Environment(AppModel.self) private var model

    var body: some View {
        let store = model.players
        let notes = store.notes[playerId]
        PlayerPage(id: "notes") {
            PlayerSection("Your Note", note: notes?.explain) {
                TextEditor(text: Binding(get: { store.noteText(playerId) }, set: { model.typePlayerNote(playerId, $0) }))
                    .font(.body)
                    .scrollContentBackground(.hidden)
                    .padding(8)
                    .frame(minHeight: 160, maxHeight: 360)
                    .background(Color.readableChipFill, in: .rect(cornerRadius: 8))
                    .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color.primary.opacity(0.2)))
                    .disabled(!store.noteReady(playerId))
                    .accessibilityLabel(Text("Your Note"))
                    .accessibilityIdentifier("player.notes.editor")
                HStack(spacing: 6) {
                    if store.drafts[playerId] != nil, store.noteProblems[playerId] == nil {
                        Text("Saving…").font(.caption).foregroundStyle(.readableSecondary)
                    } else if let done = store.noteDone[playerId] {
                        Text(verbatim: done).font(.caption).foregroundStyle(.readableSecondary)
                            .accessibilityIdentifier("player.notes.done")
                    }
                }
                if let problem = store.noteProblems[playerId] { ProblemLine(problem) }
            }
            PlayerSection("Staff Notes") {
                if let notes {
                    if let empty = notes.staffEmpty { Text(verbatim: empty.display).foregroundStyle(.readableSecondary) }
                    ForEach(notes.staff, id: \.id) { note in StaffNoteRow(playerId: playerId, note: note) }
                }
            }
        }
        .task(id: playerId) { await model.loadPlayerNotes(playerId) }
        // Another section, or the window closed: what he typed is saved now, not lost with the view
        .onDisappear { Task { await model.flushPlayerNote(playerId) } }
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
                if let when = note.when { Text(verbatim: when.display) }
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
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color.primary.opacity(0.18)))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: note.who.display))
    }
}
