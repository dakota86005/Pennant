import Foundation
import PennantAPI

/// The last Morning Report the app received for a save and a club, kept across launches so the next launch draws it
/// at once and replaces it in place when the fresh one lands (SWIFTUI_REBUILD.md "The Mac stage's first items", 3;
/// the launch budget of one second, where the server builds the report cold in about two and a half).
///
/// Rules (N6, Stage B1, with the review's fixes):
/// - Keyed by the id of the save the imported data came from (D-063, served on `/api/status` with the import it is
///   tied to), the club and the contract this build was generated from (`contractDigest`): a payload from another
///   save, another club or another contract is never read. The club is checked against the payload's own `orgId` too.
/// - Written only when the payload is current for its key (the store checks), atomically (a temporary file, then
///   moved into place), after a successful decode of the served payload; a file that no longer decodes is dropped
///   silently (the app then waits for the server, as it did before).
/// - With the payload, the club's catalog entry (its theme and name) and the catalog's phrases, so the kept report is
///   drawn in the club's colours with its legends, exactly as the live one, until the live catalog arrives.
/// - Launch decodes one file: a small index names the last key written, and only that key's file is read. At most
///   `kept` files are kept (the most recently written); older ones, and any temporary file a crash left, are removed.
/// - An actor: writes run one at a time, and a write older than the last one written for its key is dropped, so an
///   older payload never replaces a newer one.
/// - Kept in the app's own caches folder, never the shared data folder; tests give it a scratch folder.
public actor KeptReports {
    /// What a kept payload is for. A payload is read only for the key it was written under.
    public struct Key: Hashable, Sendable, Codable {
        public var saveId: String
        public var clubId: Int
        /// The digest of the contract this build was generated from (`contractDigest`): a payload written by a build
        /// on another contract is never read, even where it would still decode.
        public var contract: String

        public init(saveId: String, clubId: Int, contract: String) {
            self.saveId = saveId
            self.clubId = clubId
            self.contract = contract
        }
    }

    /// The club's catalog entry and the catalog's phrases as they were when the payload was kept: the kept report is
    /// drawn with them until the live catalog arrives (the club's colours, its name, the legends), so it looks as the
    /// live one does.
    public struct Catalog: Hashable, Sendable, Codable {
        public var club: Components.Schemas.CatalogClub?
        public var phrases: Components.Schemas.CatalogPhrases?
        /// The Morning Report's served name ("Morning Report"), its headline.
        public var viewName: String?
        /// How the club was chosen when it was kept (`CurrentClub.Source.servedWord`: "human", "configured"), so the club
        /// card drawn from a kept report says which club it is, as the live one does (N6 polish); nil in a file an
        /// earlier build kept.
        public var clubSource: String?

        public init(club: Components.Schemas.CatalogClub?, phrases: Components.Schemas.CatalogPhrases?, viewName: String?, clubSource: String? = nil) {
            self.club = club
            self.phrases = phrases
            self.viewName = viewName
            self.clubSource = clubSource
        }
    }

    /// A kept payload with what it is drawn with.
    public struct Kept: Sendable {
        public var summary: Components.Schemas.FrontOfficeSummary
        public var catalog: Catalog?
    }

    /// The file's layout: the key it was written under, the payload as served, the catalog it is drawn with.
    struct Envelope: Codable {
        var format: Int
        var key: Key
        var summary: Components.Schemas.FrontOfficeSummary
        var catalog: Catalog?
    }

    /// The index: the last key written (the one a launch reads).
    struct Index: Codable {
        var format: Int
        var last: Key
    }

    /// The layout this build writes; a file of another layout is dropped.
    static let format = 2
    /// How many payloads are kept (the most recently written): a few clubs or saves, never an unbounded folder.
    public static let kept = 4
    static let indexName = "index.json"

    public nonisolated let folder: URL
    /// The sequence of the last write done for each file, so an older write that arrives late is dropped.
    private var written: [String: UInt64] = [:]

    public init(folder: URL) {
        self.folder = folder
    }

    /// The app's own caches folder for a bundle (`~/Library/Caches/<bundle id>/front-office`).
    public static func defaultFolder(bundleIdentifier: String) -> URL {
        (FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first ?? FileManager.default.temporaryDirectory)
            .appending(path: bundleIdentifier, directoryHint: .isDirectory)
            .appending(path: "front-office", directoryHint: .isDirectory)
    }

    /// Where a key's payload is kept: one file per save, club and contract (replaced whole).
    public nonisolated func file(for key: Key) -> URL {
        folder.appending(path: "\(Self.fileSafe(key.saveId))-\(key.clubId)-\(Self.fileSafe(String(key.contract.prefix(16)))).json")
    }

    /// The kept payload for the key, or nil: none kept, another save, club or contract, a payload whose own club is
    /// another, or a file that no longer decodes (removed, so it is not tried again).
    public func read(_ key: Key) -> Kept? {
        let file = file(for: key)
        guard let data = try? Data(contentsOf: file) else { return nil }
        guard let envelope = try? JSONDecoder().decode(Envelope.self, from: data),
              envelope.format == Self.format, envelope.key == key,
              // The payload's own club, not only the file's: the report of another club is never drawn as this one's
              envelope.summary.orgId == key.clubId
        else {
            try? FileManager.default.removeItem(at: file)
            return nil
        }
        return Kept(summary: envelope.summary, catalog: envelope.catalog)
    }

    /// The payload kept last, as the index names it, with its key: read once at launch, off the main actor, so the
    /// payload is decoded before the key is known; only that one file is decoded. Nil with no index, or when its file
    /// no longer decodes. Tidies the folder too: temporary files a crash left are removed.
    public func readLast() -> (key: Key, kept: Kept)? {
        removeLeftovers()
        guard let data = try? Data(contentsOf: folder.appending(path: Self.indexName)),
              let index = try? JSONDecoder().decode(Index.self, from: data), index.format == Self.format,
              let kept = read(index.last)
        else { return nil }
        return (index.last, kept)
    }

    /// Keeps a served payload for the key, atomically: written to a temporary file in the folder, then moved into
    /// place, so a launch never reads half a file; then the index names it and older files beyond `kept` are removed.
    /// `sequence` orders the writes: one older than the last written for its key is dropped (returns false).
    @discardableResult
    public func write(_ summary: Components.Schemas.FrontOfficeSummary, catalog: Catalog?, for key: Key, sequence: UInt64) throws -> Bool {
        let file = file(for: key)
        if let last = written[file.lastPathComponent], last >= sequence { return false }
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let data = try JSONEncoder().encode(Envelope(format: Self.format, key: key, summary: summary, catalog: catalog))
        try replace(file, with: data)
        try replace(folder.appending(path: Self.indexName), with: try JSONEncoder().encode(Index(format: Self.format, last: key)))
        written[file.lastPathComponent] = sequence
        prune()
        return true
    }

    /// Forgets every kept payload (a data-folder restore, which may put back another state of the same save; a test).
    public func removeAll() {
        try? FileManager.default.removeItem(at: folder)
        written = [:]
    }

    // MARK: Housekeeping

    private func replace(_ file: URL, with data: Data) throws {
        let temporary = folder.appending(path: ".\(file.lastPathComponent).\(UUID().uuidString.prefix(8)).tmp")
        do {
            try data.write(to: temporary)
            _ = try FileManager.default.replaceItemAt(file, withItemAt: temporary)
        } catch {
            try? FileManager.default.removeItem(at: temporary)
            throw error
        }
    }

    /// Removes the temporary files a write interrupted by a crash left behind.
    private func removeLeftovers() {
        guard let names = try? FileManager.default.contentsOfDirectory(atPath: folder.path(percentEncoded: false)) else { return }
        for name in names where name.hasPrefix(".") && name.hasSuffix(".tmp") {
            try? FileManager.default.removeItem(at: folder.appending(path: name))
        }
    }

    /// Keeps the `kept` most recently written payloads and removes the rest.
    private func prune() {
        let fm = FileManager.default
        guard let names = try? fm.contentsOfDirectory(atPath: folder.path(percentEncoded: false)) else { return }
        let payloads = names.filter { $0.hasSuffix(".json") && $0 != Self.indexName && !$0.hasPrefix(".") }.map { folder.appending(path: $0) }
        guard payloads.count > Self.kept else { return }
        let dated = payloads.map { url in
            (url, (try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast)
        }
        for (url, _) in dated.sorted(by: { $0.1 > $1.1 }).dropFirst(Self.kept) {
            try? fm.removeItem(at: url)
            written[url.lastPathComponent] = nil
        }
    }

    /// A save's id as a file name: the served id is hex, but nothing here depends on that.
    static func fileSafe(_ id: String) -> String {
        String(id.unicodeScalars.map { CharacterSet.alphanumerics.contains($0) || $0 == "-" || $0 == "_" ? Character($0) : "_" })
    }
}
