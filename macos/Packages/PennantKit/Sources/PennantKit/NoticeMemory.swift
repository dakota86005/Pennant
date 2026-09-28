import Foundation
import Observation
import PennantAPI

/// The notices the GM dismissed in the main window (N6, Stage B2): "played since" and the rating-history questions.
/// A dismissed notice stays hidden until its key changes, and the keys are remembered per save, so another save's
/// notice (or the same save played again) shows. The key is made only of served facts: a "played since" notice's kind,
/// the id of the save it names and when that save was last played; a question's served id. Nothing here decides
/// whether a notice is shown in the first place: the server serves it or not.
///
/// Kept in the app's own caches folder (`notices.json` beside the kept reports; tests and Debug builds on a scratch
/// folder get their own), never the shared data folder. A lost file only shows a dismissed notice again.
@Observable @MainActor
public final class NoticeMemory {
    /// For each save (its served id, else its export folder), the notice keys dismissed there, most recent last.
    private var dismissed: [String: [String]]
    @ObservationIgnored private let file: URL?

    /// How many keys are kept per save: enough for every notice a save can have at once, never an unbounded file.
    static let keptPerSave = 16

    /// - Parameter folder: where `notices.json` is kept; nil keeps nothing across launches (a preview).
    public init(folder: URL?) {
        file = folder?.appending(path: "notices.json")
        if let file, let data = try? Data(contentsOf: file),
           let read = try? JSONDecoder().decode([String: [String]].self, from: data) {
            dismissed = read
        } else {
            dismissed = [:]
        }
    }

    /// What a "played since" notice is: its kind, the save it names and when that save was last played, as served.
    public nonisolated static func key(_ notice: Components.Schemas.SavePlayedElsewhere) -> String {
        let kind = notice.kind.value1?.rawValue ?? notice.kind.value2 ?? "notice"
        return "played:\(kind):\(notice.save.id ?? notice.save.lgPath):\(notice.save.lastPlayedAt ?? "")"
    }

    /// What a rating-history question is: its served id and kind.
    public nonisolated static func key(_ offer: Components.Schemas.RatingHistoryOffer) -> String {
        "history:\(offer.kind.value1?.rawValue ?? offer.kind.value2 ?? "offer"):\(offer.id)"
    }

    /// The save a notice is remembered under: the served id of the save the data came from, else the chosen export
    /// folder; nil with no save chosen (nothing is remembered then).
    public nonisolated static func save(_ status: Components.Schemas.ServerStatus?) -> String? {
        guard let status, status.configured else { return nil }
        if let id = status.saveId, !id.isEmpty { return id }
        return status.csvDir
    }

    public func isDismissed(_ key: String, save: String?) -> Bool {
        guard let save else { return false }
        return dismissed[save]?.contains(key) == true
    }

    /// Hides the notice with this key for this save until its key changes.
    public func dismiss(_ key: String, save: String?) {
        guard let save else { return }
        var keys = dismissed[save, default: []].filter { $0 != key }
        keys.append(key)
        dismissed[save] = Array(keys.suffix(Self.keptPerSave))
        write()
    }

    private func write() {
        guard let file, let data = try? JSONEncoder().encode(dismissed) else { return }
        try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: file, options: .atomic)
    }
}
