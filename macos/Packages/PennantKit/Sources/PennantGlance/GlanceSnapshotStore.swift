import Foundation

/// Where the glance is kept (N14, Stage A): one JSON file in a folder, written whole or not at all (a temporary file
/// renamed into place), so the widget never reads half of one. The folder is the App Group's container, or nil when
/// this process cannot reach it (an unsigned build, a missing entitlement): then nothing is written or read, and
/// nothing fails. Tests and the UI tests give a scratch folder.
public struct GlanceSnapshotStore: Sendable {
    public static let fileName = "glance.json"

    /// The folder the file is kept in; nil when there is none to reach.
    public let folder: URL?

    public init(folder: URL?) {
        self.folder = folder
    }

    public var file: URL? { folder?.appending(path: Self.fileName) }

    /// Writes the snapshot whole, replacing the one there; false when there is no folder to write to.
    @discardableResult
    public func write(_ snapshot: GlanceSnapshot) throws -> Bool {
        guard let folder, let file else { return false }
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        // `.atomic` writes beside the file and renames it into place
        try encoder.encode(snapshot).write(to: file, options: [.atomic])
        return true
    }

    /// The snapshot kept; nil when there is none, it cannot be read, or it is of a format this build does not know.
    public func read() -> GlanceSnapshot? {
        guard let file, let data = try? Data(contentsOf: file) else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        guard let snapshot = try? decoder.decode(GlanceSnapshot.self, from: data),
              snapshot.version <= GlanceSnapshot.currentVersion else { return nil }
        return snapshot
    }

    /// Removes the snapshot (no club to show any more); nothing to remove is no failure.
    public func remove() {
        guard let file else { return }
        try? FileManager.default.removeItem(at: file)
    }
}
