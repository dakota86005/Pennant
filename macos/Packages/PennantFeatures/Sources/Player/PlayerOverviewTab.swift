import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

/// Overview: the facts a GM reads first, why he is where he is, this season's line, his honours and the roster moves
/// worth knowing about (the full statement is on Contract & Rights).
struct PlayerOverviewTab: View {
    let dossier: Components.Schemas.PlayerDossierView
    /// The header's tiles drawn here (a narrow window).
    var tiles = false

    var body: some View {
        let o = dossier.overview
        PlayerPage(id: "overview") {
            if tiles { PlayerTileGrid(tiles: dossier.header.tiles) }
            PlayerSection("Who He Is") { PlayerFacts(facts: o.facts) }
            if let season = o.thisSeason {
                PlayerSection("This Season") { PlayerClaimLine(claim: season) }
            }
            if let assignment = o.assignment {
                PlayerSection("Why He Is Where He Is") {
                    PlayerClaimLine(claim: assignment.claim, font: .body.weight(.medium))
                    PlayerLines(lines: assignment.lines)
                }
            }
            if !o.rights.isEmpty {
                PlayerSection("Roster Moves") { PlayerRightsList(actions: o.rights) }
            }
            if let honours = o.honours {
                PlayerSection("Honours") { CellText(honours).fixedSize(horizontal: false, vertical: true) }
            }
        }
    }
}

/// Roster moves as Player Rights states them: what it is, whether it can be done now (a symbol and a word, never
/// colour alone), and why a click away.
struct PlayerRightsList: View {
    let actions: [Components.Schemas.PlayerRightsAction]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(actions, id: \.action) { a in
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        ClaimText(a.claim, edge: .trailing) { Text(verbatim: a.claim.text).fontWeight(.medium) }
                        CellText(a.status, secondary: true)
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        ClaimText(a.claim, edge: .trailing) { Text(verbatim: a.claim.text).fontWeight(.medium).fixedSize(horizontal: false, vertical: true) }
                        CellText(a.status, secondary: true)
                    }
                }
                .accessibilityElement(children: .contain)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
