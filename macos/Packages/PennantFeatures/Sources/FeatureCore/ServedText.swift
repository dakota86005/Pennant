import Foundation
import PennantAPI

/// Served values made ready to show, without adding anything the server did not say.
public enum ServedText {
    /// The toolbar's subtitle: how current the data is, as the server writes it (`subtitle` on `/api/v2/data-status`:
    /// the game date and the headline, SWIFTUI_REBUILD.md section 3.2). Nothing until the data status arrives: a time
    /// or a game date is never formatted or parsed here.
    public nonisolated static func subtitle(dataStatus: Components.Schemas.DataStatusView?) -> String? {
        guard let served = dataStatus?.subtitle.trimmingCharacters(in: .whitespaces), !served.isEmpty else { return nil }
        return served
    }
}
