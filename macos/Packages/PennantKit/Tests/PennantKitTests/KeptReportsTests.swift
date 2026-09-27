import Foundation
import HTTPTypes
import OpenAPIRuntime
import PennantAPI
@testable import PennantKit
import Testing

/// The Morning Report kept across launches (N6, Stage B1; SWIFTUI_REBUILD.md "The Mac stage's first items", 3): read
/// only for the save, club and contract it was written under, written atomically after a successful decode, dropped
/// silently when it no longer decodes, and never in the data folder. Every test uses a scratch folder.
@Suite("The kept Morning Report")
struct KeptReportsTests {
    private func summary() throws -> Components.Schemas.FrontOfficeSummary {
        try JSONDecoder().decode(Components.Schemas.FrontOfficeSummary.self, from: fixtureData("responses/getFrontOffice.json"))
    }

    private let key = KeptReports.Key(saveId: "abc123", clubId: 1, contractVersion: "0.1.0")

    @Test("writes a served payload and reads it back for the same save, club and contract")
    func roundTrip() throws {
        let kept = KeptReports(folder: try scratchFolder("kept"))
        #expect(kept.read(key) == nil)
        let served = try summary()
        try kept.write(served, for: key)
        #expect(kept.read(key) == served)
        #expect(FileManager.default.fileExists(atPath: kept.file(for: key).path))
        // Nothing temporary is left beside it
        let files = try FileManager.default.contentsOfDirectory(atPath: kept.folder.path)
        #expect(files == [kept.file(for: key).lastPathComponent])
    }

    @Test("a payload from another save, another club or another contract is never read")
    func otherKeys() throws {
        let kept = KeptReports(folder: try scratchFolder("kept"))
        try kept.write(try summary(), for: key)
        #expect(kept.read(KeptReports.Key(saveId: "other", clubId: 1, contractVersion: "0.1.0")) == nil)
        #expect(kept.read(KeptReports.Key(saveId: "abc123", clubId: 2, contractVersion: "0.1.0")) == nil)
        #expect(kept.read(KeptReports.Key(saveId: "abc123", clubId: 1, contractVersion: "0.2.0")) == nil)
        // The read on another contract dropped the file (an older contract's payload is never drawn again)
        #expect(FileManager.default.fileExists(atPath: kept.file(for: key).path) == false)
        #expect(kept.read(key) == nil)
    }

    @Test("a file that no longer decodes is dropped silently, and not tried again")
    func malformed() throws {
        let kept = KeptReports(folder: try scratchFolder("kept"))
        try FileManager.default.createDirectory(at: kept.folder, withIntermediateDirectories: true)
        let file = kept.file(for: key)
        try Data("{\"format\":1,\"saveId\":\"abc123\",\"clubId\":1,\"contractVersion\":\"0.1.0\",\"summary\":{\"desk\":null}}".utf8).write(to: file)
        #expect(kept.read(key) == nil)
        #expect(FileManager.default.fileExists(atPath: file.path) == false)
        // Another layout of the file is another build's: dropped too
        try Data("{\"format\":0,\"saveId\":\"abc123\",\"clubId\":1,\"contractVersion\":\"0.1.0\",\"summary\":{}}".utf8).write(to: file)
        #expect(kept.read(key) == nil)
        #expect(FileManager.default.fileExists(atPath: file.path) == false)
    }

    @Test("every kept payload is read at once by its key; a stray or malformed file is not one of them")
    func readAll() throws {
        let kept = KeptReports(folder: try scratchFolder("kept"))
        #expect(kept.readAll().isEmpty)
        let served = try summary()
        let other = KeptReports.Key(saveId: "other", clubId: 3, contractVersion: "0.1.0")
        try kept.write(served, for: key)
        try kept.write(served, for: other)
        // A file under a name its key does not give, and one that does not decode
        try Data(try Data(contentsOf: kept.file(for: key))).write(to: kept.folder.appending(path: "stray-9.json"))
        try Data("{".utf8).write(to: kept.folder.appending(path: "bad-1.json"))
        let all = kept.readAll()
        #expect(Set(all.keys) == [key, other])
        #expect(all[key] == served)
        #expect(FileManager.default.fileExists(atPath: kept.folder.appending(path: "bad-1.json").path) == false)
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
}

/// The store shows the kept payload first, as updating, then the server's, and keeps every fresh one.
@Suite("The store and the kept Morning Report")
@MainActor
struct KeptSummaryStoreTests {
    private let club = ClubRef(id: 1)
    private func key(saveId: String? = "save-a", restores: Int = 0) -> AppModel.StoreKey {
        AppModel.StoreKey(importStamp: "", club: club, restores: restores, saveId: saveId)
    }

    private func client(_ transport: any ClientTransport) -> Client {
        PennantClient.make(port: 5178, token: String(repeating: "t", count: 64), transport: transport)
    }

    private func transport() throws -> RoutedTransport {
        RoutedTransport(["/api/v2/front-office/1": try RoutedTransport.json("getFrontOffice")])
    }

    @Test("the first load keeps the served payload; the next launch shows it at once, as updating, then swaps in the fresh one")
    func keptAcrossLaunches() async throws {
        let kept = KeptReports(folder: try scratchFolder("kept"))
        let first = FrontOfficeStore(kept: kept, contractVersion: "0.1.0")
        await first.loadSummary(client: client(try transport()), key: key())
        #expect(first.summary != nil)
        #expect(first.summaryIsKept == false)
        let keptKey = try #require(FrontOfficeStore.keptKey(key(), contractVersion: "0.1.0"))
        #expect(await eventually { kept.read(keptKey) != nil })

        // The next launch: the server's answer waits, and the kept payload is shown meanwhile
        let gate = GatedTransport(try RoutedTransport.json("getFrontOffice"))
        let second = FrontOfficeStore(kept: kept, contractVersion: "0.1.0")
        let load = Task { await second.loadSummary(client: client(gate), key: key()) }
        await gate.waitUntilAsked()
        #expect(second.summary != nil)
        #expect(second.summaryIsKept)
        #expect(second.loadingSummary)
        gate.open()
        await load.value
        #expect(second.summary != nil)
        #expect(second.summaryIsKept == false)
        #expect(second.loadingSummary == false)
    }

    @Test("nothing kept is shown for another save, another club, another contract, or with no save id")
    func neverAnothers() async throws {
        let kept = KeptReports(folder: try scratchFolder("kept"))
        let first = FrontOfficeStore(kept: kept, contractVersion: "0.1.0")
        await first.loadSummary(client: client(try transport()), key: key())
        let keptKey = try #require(FrontOfficeStore.keptKey(key(), contractVersion: "0.1.0"))
        #expect(await eventually { kept.read(keptKey) != nil })
        for (label, store, storeKey) in [
            ("another save", FrontOfficeStore(kept: kept, contractVersion: "0.1.0"), key(saveId: "save-b")),
            ("another contract", FrontOfficeStore(kept: kept, contractVersion: "0.2.0"), key()),
            ("no save id", FrontOfficeStore(kept: kept, contractVersion: "0.1.0"), key(saveId: nil)),
            ("another club", FrontOfficeStore(kept: kept, contractVersion: "0.1.0"), AppModel.StoreKey(importStamp: "", club: ClubRef(id: 2), restores: 0, saveId: "save-a")),
        ] {
            let gate = GatedTransport(try RoutedTransport.json("getFrontOffice"))
            let load = Task { await store.loadSummary(client: client(gate), key: storeKey) }
            await gate.waitUntilAsked()
            #expect(store.summary == nil, "\(label)")
            #expect(store.summaryIsKept == false, "\(label)")
            gate.open()
            await load.value
        }
        #expect(FrontOfficeStore.keptKey(key(saveId: nil), contractVersion: "0.1.0") == nil)
        #expect(FrontOfficeStore.keptKey(AppModel.StoreKey(importStamp: "", club: nil, restores: 0, saveId: "save-a"), contractVersion: "0.1.0") == nil)
    }

    @Test("a load the view cancelled (the key moved) records no problem and keeps what is shown")
    func cancelledLoad() async throws {
        let kept = KeptReports(folder: try scratchFolder("kept"))
        let store = FrontOfficeStore(kept: kept, contractVersion: "0.1.0")
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
    }
}
