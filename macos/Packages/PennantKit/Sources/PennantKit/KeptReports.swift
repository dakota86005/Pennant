import Foundation
import PennantAPI

/// The last Morning Report the app received for a save and a club, kept across launches so the next launch draws it
/// at once and replaces it in place when the fresh one lands (SWIFTUI_REBUILD.md "The Mac stage's first items", 3;
/// the launch budget of one second, where the server builds the report cold in about two and a half).
///
/// Rules (N6, Stage B1):
/// - Keyed by the save's id (D-063, served on `/api/status`), the club and the contract this build was made against:
///   a payload from another save, another club or an older contract is never read.
/// - Written atomically after a successful decode of the served payload; a file that no longer decodes is dropped
///   silently (the app then waits for the server, as it did before).
/// - Kept in the app's own caches folder, never the shared data folder; tests give it a scratch folder.
public struct KeptReports: Sendable {
    /// What a kept payload is for. A payload is read only for the key it was written under.
    public struct Key: Hashable, Sendable {
        public var saveId: String
        public var clubId: Int
        /// The contract this build was made against (the app's version, which the sidecar's contract follows): a
        /// payload written by a build on another contract is never read, even where it would still decode.
        public var contractVersion: String

        public init(saveId: String, clubId: Int, contractVersion: String) {
            self.saveId = saveId
            self.clubId = clubId
            self.contractVersion = contractVersion
        }
    }

    /// The file's layout: the key it was written under, then the payload as served.
    struct Envelope: Codable {
        var format: Int
        var saveId: String
        var clubId: Int
        var contractVersion: String
        var summary: Components.Schemas.FrontOfficeSummary
    }

    /// The layout this build writes; a file of another layout is dropped.
    static let format = 1

    public let folder: URL

    public init(folder: URL) {
        self.folder = folder
    }

    /// The app's own caches folder for a bundle (`~/Library/Caches/<bundle id>/front-office`).
    public static func defaultFolder(bundleIdentifier: String) -> URL {
        (FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first ?? FileManager.default.temporaryDirectory)
            .appending(path: bundleIdentifier, directoryHint: .isDirectory)
            .appending(path: "front-office", directoryHint: .isDirectory)
    }

    /// Where a key's payload is kept: one file per save and club (a club's file is replaced whole).
    public func file(for key: Key) -> URL {
        folder.appending(path: "\(Self.fileSafe(key.saveId))-\(key.clubId).json")
    }

    /// The kept payload for the key, or nil: none kept, another save, club or contract, or a file that no longer
    /// decodes (removed, so it is not tried again).
    public func read(_ key: Key) -> Components.Schemas.FrontOfficeSummary? {
        let file = file(for: key)
        guard let data = try? Data(contentsOf: file) else { return nil }
        guard let envelope = try? JSONDecoder().decode(Envelope.self, from: data),
              envelope.format == Self.format,
              envelope.saveId == key.saveId, envelope.clubId == key.clubId, envelope.contractVersion == key.contractVersion
        else {
            try? FileManager.default.removeItem(at: file)
            return nil
        }
        return envelope.summary
    }

    /// Every kept payload in the folder that decodes, by its key (a file whose envelope no longer decodes, or is of
    /// another layout, is dropped): read once at launch, off the main actor, so the payload for the key is in hand
    /// the moment the key is known rather than decoded then (a Debug build decodes a payload in well over 100 ms).
    public func readAll() -> [Key: Components.Schemas.FrontOfficeSummary] {
        guard let names = try? FileManager.default.contentsOfDirectory(atPath: folder.path) else { return [:] }
        var found: [Key: Components.Schemas.FrontOfficeSummary] = [:]
        let decoder = JSONDecoder()
        for name in names where name.hasSuffix(".json") && !name.hasPrefix(".") {
            let file = folder.appending(path: name)
            guard let data = try? Data(contentsOf: file),
                  let envelope = try? decoder.decode(Envelope.self, from: data), envelope.format == Self.format
            else {
                try? FileManager.default.removeItem(at: file)
                continue
            }
            let key = Key(saveId: envelope.saveId, clubId: envelope.clubId, contractVersion: envelope.contractVersion)
            // Only a file kept under the name its key gives (a stray file is never another key's payload)
            guard self.file(for: key).lastPathComponent == name else { continue }
            found[key] = envelope.summary
        }
        return found
    }

    /// Keeps a served payload for the key, atomically: written to a temporary file in the folder, then moved into
    /// place, so a launch never reads half a file.
    public func write(_ summary: Components.Schemas.FrontOfficeSummary, for key: Key) throws {
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let envelope = Envelope(format: Self.format, saveId: key.saveId, clubId: key.clubId, contractVersion: key.contractVersion, summary: summary)
        let data = try JSONEncoder().encode(envelope)
        let file = file(for: key)
        let temporary = folder.appending(path: ".\(file.lastPathComponent).\(UUID().uuidString.prefix(8)).tmp")
        try data.write(to: temporary, options: .atomic)
        _ = try FileManager.default.replaceItemAt(file, withItemAt: temporary)
    }

    /// Forgets every kept payload (a data-folder restore, a test).
    public func removeAll() {
        try? FileManager.default.removeItem(at: folder)
    }

    /// A save's id as a file name: the served id is hex, but nothing here depends on that.
    static func fileSafe(_ id: String) -> String {
        String(id.unicodeScalars.map { CharacterSet.alphanumerics.contains($0) || $0 == "-" || $0 == "_" ? Character($0) : "_" })
    }
}
