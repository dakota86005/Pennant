import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

/// Contract & Rights: his deal as the export states it, the seasons it covers, and every roster move Player Rights
/// states for him with its reasons (a stale export says once that rights can't be stated, never a guess).
struct PlayerContractTab: View {
    let dossier: Components.Schemas.PlayerDossierView

    var body: some View {
        let c = dossier.contract
        PlayerPage(id: "contract") {
            PlayerSection("His Deal") {
                if let empty = c.empty {
                    Text(verbatim: empty.display).foregroundStyle(.readableSecondary)
                }
                if !c.facts.isEmpty { PlayerFacts(facts: c.facts) }
                if let schedule = c.schedule {
                    Text(verbatim: schedule.title.display).font(.headline).padding(.top, 6)
                    PlayerGrid(table: schedule)
                }
            }
            PlayerSection("Roster Moves") {
                if let note = c.rightsNote { UnknownNote(cell: note) }
                if !c.rightsFacts.isEmpty { PlayerFacts(facts: c.rightsFacts) }
                PlayerRightsList(actions: c.rights)
            }
        }
    }
}

/// A served line about something not known: the unknown's symbol and the words.
struct UnknownNote: View {
    let cell: Components.Schemas.Cell

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            ToneMark(.unknown)
            Text(verbatim: cell.display).fixedSize(horizontal: false, vertical: true)
        }
        .help(detail: cell.hint)
        .accessibilityElement(children: .combine)
    }
}
