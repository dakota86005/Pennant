import Foundation
import HTTPTypes
import OpenAPIRuntime
import PennantAPI
@testable import PennantKit
import Testing

/// The Morning Report kept across launches (N6, Stage B1, with the review's fixes; SWIFTUI_REBUILD.md "The Mac stage's
/// first items", 3): read only for the save, club and contract it was written under (and only when the payload's own
/// club is the key's), written atomically, in order, with the catalog it is drawn with; launch decodes one file; a few
/// files at most; dropped silently when it no longer decodes; never in the data folder. Every test uses a scratch folder.
@Suite("The kept Morning Report")
struct KeptReportsTests {
    private func summary() throws -> Components.Schemas.FrontOfficeSummary {
        try JSONDecoder().decode(Components.Schemas.FrontOfficeSummary.self, from: fixtureData("responses/getFrontOffice.json"))
    }

    private func catalog() throws -> KeptReports.Catalog {
        let served = try JSONDecoder().decode(Components.Schemas.Catalog.self, from: fixtureData("responses/getCatalog.json"))
        return KeptReports.Catalog(club: served.clubs.first { $0.teamId == 1 }, phrases: served.phrases, viewName: "Morning Report")
    }

    private let key = KeptReports.Key(saveId: "abc123", clubId: 1, contract: "digest-a")

    private func names(_ kept: KeptReports) throws -> Set<String> {
        Set(try FileManager.default.contentsOfDirectory(atPath: kept.folder.path(percentEncoded: false)))
    }

    @Test("writes a served payload with its catalog and reads it back for the same save, club and contract")
    func roundTrip() async throws {
        let kept = KeptReports(folder: try scratchFolder("kept"))
        #expect(await kept.read(key) == nil)
        let served = try summary()
        #expect(try await kept.write(served, catalog: try catalog(), for: key, sequence: 1))
        let read = try #require(await kept.read(key))
        #expect(read.summary == served)
        #expect(read.catalog == (try catalog()))
        #expect(read.catalog?.club?.theme != nil)
        // The payload and the index, nothing temporary beside them
        #expect(try names(kept) == [kept.file(for: key).lastPathComponent, KeptReports.indexName])
    }

    @Test("a payload from another save, another club or another contract is never read, nor one whose own club is another")
    func otherKeys() async throws {
        let kept = KeptReports(folder: try scratchFolder("kept"))
        try await kept.write(try summary(), catalog: nil, for: key, sequence: 1)
        #expect(await kept.read(KeptReports.Key(saveId: "other", clubId: 1, contract: "digest-a")) == nil)
        #expect(await kept.read(KeptReports.Key(saveId: "abc123", clubId: 2, contract: "digest-a")) == nil)
        #expect(await kept.read(KeptReports.Key(saveId: "abc123", clubId: 1, contract: "digest-b")) == nil)
        #expect(await kept.read(key) != nil)
        // A file kept under club 2 whose payload is club 1's: never drawn as club 2's, and dropped
        let club2 = KeptReports.Key(saveId: "abc123", clubId: 2, contract: "digest-a")
        try await kept.write(try summary(), catalog: nil, for: club2, sequence: 1)
        #expect(await kept.read(club2) == nil)
        #expect(FileManager.default.fileExists(atPath: kept.file(for: club2).path(percentEncoded: false)) == false)
    }

    @Test("a file that no longer decodes is dropped silently, and not tried again")
    func malformed() async throws {
        let kept = KeptReports(folder: try scratchFolder("kept"))
        try FileManager.default.createDirectory(at: kept.folder, withIntermediateDirectories: true)
        let file = kept.file(for: key)
        try Data("{\"format\":2,\"key\":{\"saveId\":\"abc123\",\"clubId\":1,\"contract\":\"digest-a\"},\"summary\":{\"desk\":null}}".utf8).write(to: file)
        #expect(await kept.read(key) == nil)
        #expect(FileManager.default.fileExists(atPath: file.path(percentEncoded: false)) == false)
        // Another layout of the file is another build's: dropped too
        try Data("{\"format\":1,\"saveId\":\"abc123\",\"clubId\":1,\"contractVersion\":\"0.1.0\",\"summary\":{}}".utf8).write(to: file)
        #expect(await kept.read(key) == nil)
        #expect(FileManager.default.fileExists(atPath: file.path(percentEncoded: false)) == false)
    }

    @Test("launch decodes one file: the one the index names; the others are left unread")
    func readLast() async throws {
        let kept = KeptReports(folder: try scratchFolder("kept"))
        #expect(await kept.readLast() == nil)
        let other = KeptReports.Key(saveId: "other", clubId: 1, contract: "digest-a")
        try await kept.write(try summary(), catalog: nil, for: other, sequence: 1)
        try await kept.write(try summary(), catalog: try catalog(), for: key, sequence: 2)
        // The other file is corrupted: were it decoded, it would be dropped
        try Data("{".utf8).write(to: kept.file(for: other))
        let last = try #require(await kept.readLast())
        #expect(last.key == key)
        #expect(last.kept.catalog == (try catalog()))
        #expect(FileManager.default.fileExists(atPath: kept.file(for: other).path(percentEncoded: false)))
    }

    @Test("an older write never replaces a newer one for its key")
    func ordered() async throws {
        let kept = KeptReports(folder: try scratchFolder("kept"))
        var older = try summary()
        older.asOf = .init(display: "Through an older day")
        let newer = try summary()
        #expect(try await kept.write(newer, catalog: nil, for: key, sequence: 2))
        #expect(try await kept.write(older, catalog: nil, for: key, sequence: 1) == false)
        #expect(await kept.read(key)?.summary == newer)
    }

    @Test("keeps the few most recent payloads and removes the rest, and what a crash left behind")
    func housekeeping() async throws {
        let kept = KeptReports(folder: try scratchFolder("kept"))
        let keys = (0..<(KeptReports.kept + 3)).map { KeptReports.Key(saveId: "save-\($0)", clubId: 1, contract: "digest-a") }
        for (n, k) in keys.enumerated() {
            try await kept.write(try summary(), catalog: nil, for: k, sequence: UInt64(n + 1))
            try await Task.sleep(for: .milliseconds(15))
        }
        let payloads = try names(kept).filter { $0 != KeptReports.indexName }
        #expect(payloads.count == KeptReports.kept)
        #expect(Set(payloads) == Set(keys.suffix(KeptReports.kept).map { kept.file(for: $0).lastPathComponent }))
        // A temporary file a crash left is removed at the next launch's read
        let leftover = kept.folder.appending(path: ".\(kept.file(for: key).lastPathComponent).dead.tmp")
        try Data("half".utf8).write(to: leftover)
        _ = await kept.readLast()
        #expect(FileManager.default.fileExists(atPath: leftover.path(percentEncoded: false)) == false)
        // A restore forgets them all
        await kept.removeAll()
        #expect(FileManager.default.fileExists(atPath: kept.folder.path(percentEncoded: false)) == false)
    }

    @Test("a save id is a file name whatever it holds")
    func fileNames() {
        #expect(KeptReports.fileSafe("0123abcd") == "0123abcd")
        #expect(KeptReports.fileSafe("a/b:c d") == "a_b_c_d")
    }

    @Test("the default folder is the app's own caches, never the data folder")
    func defaultFolder() {
        let folder = KeptReports.defaultFolder(bundleIdentifier: "com.example.pennant-test")
        #expect(folder.path.contains("/Caches/com.example.pennant-test/front-office"))
        #expect(folder.path.contains("ootp-front-office") == false)
    }

    @Test("the contract key is the generated digest of the committed contract")
    func contractKey() {
        #expect(contractDigest.count == 64)
        #expect(contractDigest.allSatisfy { $0.isHexDigit })
    }
}

/// The store shows the kept payload first, as updating, then the server's, and keeps each fresh one once it is current
/// and its catalog is in hand.
@Suite("The store and the kept Morning Report")
@MainActor
struct KeptSummaryStoreTests {
    private let club = ClubRef(id: 1)
    private func key(saveId: String? = "save-a", restores: Int = 0, importStamp: String = "", reportStamp: String = "") -> AppModel.StoreKey {
        AppModel.StoreKey(importStamp: importStamp, club: club, restores: restores, reportStamp: reportStamp, saveId: saveId)
    }

    private func client(_ transport: any ClientTransport) -> Client {
        PennantClient.make(port: 5178, token: String(repeating: "t", count: 64), transport: transport)
    }

    private func transport() throws -> RoutedTransport {
        RoutedTransport(["/api/v2/front-office/1": try RoutedTransport.json("getFrontOffice")])
    }

    private func catalog() throws -> KeptReports.Catalog {
        let served = try JSONDecoder().decode(Components.Schemas.Catalog.self, from: fixtureData("responses/getCatalog.json"))
        return KeptReports.Catalog(club: served.clubs.first { $0.teamId == 1 }, phrases: served.phrases, viewName: "Morning Report")
    }

    @Test("the first load keeps the served payload; the next launch shows it at once with its catalog, as updating, then swaps in the fresh one")
    func keptAcrossLaunches() async throws {
        let kept = KeptReports(folder: try scratchFolder("kept"))
        let first = FrontOfficeStore(kept: kept, contract: "digest-a")
        await first.loadSummary(client: client(try transport()), key: key())
        #expect(first.summary != nil)
        #expect(first.summaryIsKept == false)
        // Nothing kept without the catalog it is drawn with; kept (and written, awaited) once it is here
        await first.keep(catalog: nil, for: key())
        let keptKey = try #require(FrontOfficeStore.keptKey(key(), contract: "digest-a"))
        #expect(await kept.read(keptKey) == nil)
        await first.keep(catalog: try catalog(), for: key())
        #expect(await kept.read(keptKey) != nil)

        // The next launch: the server's answer waits, and the kept payload is shown meanwhile, in the club's colours
        let gate = GatedTransport(try RoutedTransport.json("getFrontOffice"))
        let second = FrontOfficeStore(kept: kept, contract: "digest-a")
        let load = Task { await second.loadSummary(client: client(gate), key: key()) }
        await gate.waitUntilAsked()
        #expect(second.summary != nil)
        #expect(second.summaryIsKept)
        #expect(second.keptCatalog == (try catalog()))
        #expect(second.showsUpdating(for: key()))
        // The kept payload is never written back as if it were fresh
        await second.keep(catalog: try catalog(), for: key())
        gate.open()
        await load.value
        #expect(second.summary != nil)
        #expect(second.summaryIsKept == false)
        #expect(second.loadingSummary == false)
        #expect(second.showsUpdating(for: key()) == false)
    }

    @Test("kept shown, then the fetch fails: the problem is said, and \"Updating\" never stays on")
    func keptThenFailure() async throws {
        let kept = KeptReports(folder: try scratchFolder("kept"))
        let first = FrontOfficeStore(kept: kept, contract: "digest-a")
        await first.loadSummary(client: client(try transport()), key: key())
        await first.keep(catalog: try catalog(), for: key())
        let failing = RoutedTransport(["/api/v2/front-office/1": try RoutedTransport.json("getFrontOffice")], statuses: ["/api/v2/front-office/1": 500])
        let second = FrontOfficeStore(kept: kept, contract: "digest-a")
        await second.loadSummary(client: client(failing), key: key())
        #expect(second.summary != nil)
        #expect(second.summaryIsKept)
        #expect(second.summaryProblem != nil)
        #expect(second.showsUpdating(for: key()) == false)
    }

    @Test("a payload is kept only when it is current for its key: never under a save or import it is not")
    func keptOnlyWhenCurrent() async throws {
        let kept = KeptReports(folder: try scratchFolder("kept"))
        let store = FrontOfficeStore(kept: kept, contract: "digest-a")
        await store.loadSummary(client: client(try transport()), key: key())
        // The key has moved to another import (the payload was read just before): not written
        let moved = key(importStamp: "2040-07-02T00:00:00.000Z")
        await store.keep(catalog: try catalog(), for: moved)
        #expect(await kept.read(try #require(FrontOfficeStore.keptKey(moved, contract: "digest-a"))) == nil)
        // Another club's key: its payload is never kept as that club's
        let otherClub = AppModel.StoreKey(importStamp: "", club: ClubRef(id: 2), restores: 0, saveId: "save-a")
        await store.keep(catalog: try catalog(), for: otherClub)
        #expect(await kept.read(try #require(FrontOfficeStore.keptKey(otherClub, contract: "digest-a"))) == nil)
        // No save id (the served save not worked out, or a save chosen and not imported): nothing kept
        await store.keep(catalog: try catalog(), for: key(saveId: nil))
        #expect(await kept.readLast() == nil)
        // Current: kept
        await store.keep(catalog: try catalog(), for: key())
        #expect(await kept.readLast()?.key == FrontOfficeStore.keptKey(key(), contract: "digest-a"))
    }

    @Test("nothing kept is shown for another save, another club, another contract, or with no save id")
    func neverAnothers() async throws {
        let kept = KeptReports(folder: try scratchFolder("kept"))
        let first = FrontOfficeStore(kept: kept, contract: "digest-a")
        await first.loadSummary(client: client(try transport()), key: key())
        await first.keep(catalog: try catalog(), for: key())
        let keptKey = try #require(FrontOfficeStore.keptKey(key(), contract: "digest-a"))
        #expect(await kept.read(keptKey) != nil)
        for (label, store, storeKey) in [
            ("another save", FrontOfficeStore(kept: kept, contract: "digest-a"), key(saveId: "save-b")),
            ("another contract", FrontOfficeStore(kept: kept, contract: "digest-b"), key()),
            ("no save id", FrontOfficeStore(kept: kept, contract: "digest-a"), key(saveId: nil)),
            ("another club", FrontOfficeStore(kept: kept, contract: "digest-a"), AppModel.StoreKey(importStamp: "", club: ClubRef(id: 2), restores: 0, saveId: "save-a")),
        ] {
            let gate = GatedTransport(try RoutedTransport.json("getFrontOffice"))
            let load = Task { await store.loadSummary(client: client(gate), key: storeKey) }
            await gate.waitUntilAsked()
            #expect(store.summary == nil, "\(label)")
            #expect(store.summaryIsKept == false, "\(label)")
            gate.open()
            await load.value
        }
        #expect(FrontOfficeStore.keptKey(key(saveId: nil), contract: "digest-a") == nil)
        #expect(FrontOfficeStore.keptKey(AppModel.StoreKey(importStamp: "", club: nil, restores: 0, saveId: "save-a"), contract: "digest-a") == nil)
    }

    @Test("a switch to another save keeps the report on screen with its own club's catalog, said to be updating, from the moment the save is chosen until the new save's report lands (N6 polish and its review)")
    func switchHoldsTheWindowTogether() async throws {
        // The fixture's own build stamp, so the real "current" test runs (an empty stamp would pass anything)
        func key(saveId: String? = "save-a", importStamp: String = "") -> AppModel.StoreKey {
            self.key(saveId: saveId, importStamp: importStamp, reportStamp: "rstamp")
        }
        let kept = KeptReports(folder: try scratchFolder("kept"))
        let store = FrontOfficeStore(kept: kept, contract: "digest-a")
        await store.loadSummary(client: client(try transport()), key: key(), catalog: try catalog())
        #expect(store.shownKey == key())
        #expect(store.heldCatalog(for: key()) == nil)
        #expect(store.summaryIsCurrent(for: key()))
        #expect(store.showsUpdating(for: key()) == false)

        // Another save is chosen: until its import lands the key names no save, and the server still serves the old
        // save's import. Updating at once, before any request, and nothing is asked (the answer would be the old save's)
        let chosen = key(saveId: nil)
        #expect(store.showsUpdating(for: chosen))
        #expect(store.summaryIsCurrent(for: chosen) == false)
        #expect(store.heldCatalog(for: chosen) == (try catalog()))
        let refused = GatedTransport(try RoutedTransport.json("getFrontOffice"))
        refused.open()
        await store.loadSummary(client: client(refused), key: chosen)
        #expect(refused.wasAsked == false, "a report was asked for while the chosen save was not yet imported")
        #expect(store.shownKey == key())
        #expect(store.showsUpdating(for: chosen))
        #expect(store.heldCatalog(for: chosen) == (try catalog()))

        // The new save's import landed (a new import, the new save's id): still updating, before and while it is asked
        let next = key(saveId: "save-b")
        #expect(store.showsUpdating(for: next))
        #expect(store.heldCatalog(for: next) == (try catalog()))
        let gate = GatedTransport(try RoutedTransport.json("getFrontOffice"))
        let load = Task { await store.loadSummary(client: client(gate), key: next, catalog: nil) }
        await gate.waitUntilAsked()
        #expect(store.shownKey == key())
        #expect(store.heldCatalog(for: next) == (try catalog()))
        #expect(store.showsUpdating(for: next))
        gate.open()
        await load.value
        // The new save's report landed: the whole window moves to it together, and it is no longer updating
        #expect(store.shownKey == next)
        #expect(store.heldCatalog(for: next) == nil)
        #expect(store.showsUpdating(for: next) == false)
        // A new import of the same save: held too until its report lands; a rebuild of the same import is not
        var rebuilt = next
        rebuilt.reportStamp = "another-build"
        #expect(store.heldCatalog(for: rebuilt) == nil)
        // The new report's catalog is its own, once it arrives (never the old save's)
        #expect(store.shownCatalog == nil)
        await store.keep(catalog: try catalog(), for: next)
        #expect(store.shownCatalog == (try catalog()))
        #expect(store.heldCatalog(for: key(saveId: "save-b", importStamp: "2040-07-03T00:00:00.000Z")) == (try catalog()))
    }

    @Test("another save is never only a build moving, and only a save chosen over the same import waits for it (N6 polish review)")
    func saveMovesAreNotBuildMoves() {
        let a = key(reportStamp: "one")
        var build = a
        build.reportStamp = "two"
        #expect(FrontOfficeStore.onlyTheBuildMoved(a, build))
        #expect(!FrontOfficeStore.onlyTheBuildMoved(a, key(saveId: "save-b", reportStamp: "two")))
        #expect(!FrontOfficeStore.onlyTheBuildMoved(a, key(saveId: nil, reportStamp: "two")))
        // A save chosen, its import not landed: the key names no save over the shown report's import
        #expect(FrontOfficeStore.awaitsTheChosenSave(shown: a, key: key(saveId: nil)))
        // Its import landed, a restore, nothing shown for a save, or nothing shown: asked as usual
        #expect(!FrontOfficeStore.awaitsTheChosenSave(shown: a, key: key(saveId: nil, importStamp: "2040-07-03T00:00:00.000Z")))
        #expect(!FrontOfficeStore.awaitsTheChosenSave(shown: a, key: key(saveId: nil, restores: 1)))
        #expect(!FrontOfficeStore.awaitsTheChosenSave(shown: key(saveId: nil), key: key(saveId: nil)))
        #expect(!FrontOfficeStore.awaitsTheChosenSave(shown: nil, key: key(saveId: nil)))
    }

    @Test("the report on screen takes its own club's catalog even where it cannot be kept, so a later switch holds the window together (N6 polish review)")
    func shownCatalogWithoutKeeping() async throws {
        // Nowhere to keep
        let unkept = FrontOfficeStore(kept: nil, contract: "digest-a")
        await unkept.loadSummary(client: client(try transport()), key: key())
        await unkept.keep(catalog: try catalog(), for: key())
        #expect(unkept.shownCatalog == (try catalog()))
        #expect(unkept.heldCatalog(for: key(saveId: "save-b")) == (try catalog()))
        // No save id served: nothing kept, but the report is drawn with its catalog
        let kept = KeptReports(folder: try scratchFolder("kept"))
        let noSave = FrontOfficeStore(kept: kept, contract: "digest-a")
        await noSave.loadSummary(client: client(try transport()), key: key(saveId: nil))
        await noSave.keep(catalog: try catalog(), for: key(saveId: nil))
        #expect(noSave.shownCatalog == (try catalog()))
        #expect(await kept.readLast() == nil)
        // Another club's catalog is never the report's
        let other = FrontOfficeStore(kept: nil, contract: "digest-a")
        await other.loadSummary(client: client(try transport()), key: key())
        var clubTwo = try catalog()
        clubTwo.club?.teamId = 2
        await other.keep(catalog: clubTwo, for: key())
        #expect(other.shownCatalog == nil)
    }

    @Test("the club card of the report kept last goes once the settings are answered, unless they confirm its save and club (N6 polish review)")
    func settleWaitingKept() async throws {
        let kept = KeptReports(folder: try scratchFolder("kept"))
        let first = FrontOfficeStore(kept: kept, contract: "digest-a")
        await first.loadSummary(client: client(try transport()), key: key())
        await first.keep(catalog: try catalog(), for: key())
        func waiting() async throws -> FrontOfficeStore {
            let store = FrontOfficeStore(kept: kept, contract: "digest-a")
            for _ in 0..<200 where store.waitingKept == nil { try await Task.sleep(for: .milliseconds(5)) }
            #expect(store.waitingKept != nil)
            return store
        }
        // The settings failed: no key, and the card goes
        let failed = try await waiting()
        failed.settleWaitingKept(for: nil)
        #expect(failed.waitingKept == nil)
        // Another save's key: it goes
        let another = try await waiting()
        another.settleWaitingKept(for: key(saveId: "save-b"))
        #expect(another.waitingKept == nil)
        // Its own save and club: it stays, until the report itself is shown
        let own = try await waiting()
        own.settleWaitingKept(for: key())
        #expect(own.waitingKept != nil)
        // Answered before the kept report was even read: it is never drawn afterwards for a key that is not its own
        let early = FrontOfficeStore(kept: kept, contract: "digest-a")
        early.settleWaitingKept(for: nil)
        try await Task.sleep(for: .milliseconds(200))
        #expect(early.waitingKept == nil)
    }

    @Test("at launch the report kept last is read before its key is confirmed, for its club card only, and dropped for another key (N6 polish)")
    func waitingKept() async throws {
        let kept = KeptReports(folder: try scratchFolder("kept"))
        let first = FrontOfficeStore(kept: kept, contract: "digest-a")
        await first.loadSummary(client: client(try transport()), key: key())
        await first.keep(catalog: try catalog(), for: key())
        let second = FrontOfficeStore(kept: kept, contract: "digest-a")
        for _ in 0..<200 where second.waitingKept == nil { try await Task.sleep(for: .milliseconds(5)) }
        #expect(second.waitingKept?.kept.catalog == (try catalog()))
        // Never the report on screen before its key is confirmed
        #expect(second.summary == nil)
        let gate = GatedTransport(try RoutedTransport.json("getFrontOffice"))
        let load = Task { await second.loadSummary(client: client(gate), key: key(saveId: "save-b")) }
        await gate.waitUntilAsked()
        #expect(second.waitingKept == nil)
        #expect(second.summary == nil)
        gate.open()
        await load.value
    }

    @Test("a load the view cancelled (the key moved) records no problem and keeps what is shown")
    func cancelledLoad() async throws {
        let kept = KeptReports(folder: try scratchFolder("kept"))
        let store = FrontOfficeStore(kept: kept, contract: "digest-a")
        await store.loadSummary(client: client(try transport()), key: key())
        let shown = try #require(store.summary)
        let gate = GatedTransport(try RoutedTransport.json("getFrontOffice"))
        let load = Task { await store.loadSummary(client: client(gate), key: key(restores: 1)) }
        await gate.waitUntilAsked()
        load.cancel()
        gate.open()
        await load.value
        #expect(store.summaryProblem == nil)
        #expect(store.summary == shown)
    }

    @Test("a store with nowhere to keep reads and writes nothing")
    func nowhere() async throws {
        let store = FrontOfficeStore()
        await store.loadSummary(client: client(try transport()), key: key())
        #expect(store.summary != nil)
        #expect(store.summaryIsKept == false)
        await store.keep(catalog: try catalog(), for: key())
    }
}
