import Foundation
import PennantAPI
import PennantGlance
@testable import PennantKit
import Testing

/// The glance the widget reads (N14, Stage A; BEHAVIOR_CASES.md "Pennant for Mac", the N14 rows): written whole from the
/// served glance, read back as written, and nothing written or read where no App Group can be reached.
@Suite("The glance snapshot: written and read")
struct GlanceSnapshotTests {
    private func servedGlance() throws -> Components.Schemas.Glance {
        try JSONDecoder().decode(Components.Schemas.Glance.self, from: fixtureData("responses/getGlance.json"))
    }

    @Test("the snapshot holds the served words and figures, nothing added")
    func snapshotOfServed() throws {
        let glance = try servedGlance()
        let at = Date(timeIntervalSince1970: 1_800_000_000)
        let snapshot = IntegrationStore.snapshot(of: glance, colors: nil, at: at)
        #expect(snapshot.writtenAt == at)
        #expect(snapshot.club == glance.club?.display)
        #expect(snapshot.asOf == glance.asOf.display)
        #expect(snapshot.record?.display == glance.record?.value?.display)
        #expect(snapshot.record?.spoken == glance.record?.text)
        #expect(snapshot.nextGame?.when == glance.nextGame?.when.display)
        #expect(snapshot.nextGame?.matchup == glance.nextGame?.matchup.display)
        #expect(snapshot.desk.count == glance.desk.count)
        #expect(snapshot.desk.line == glance.desk.line.display)
        #expect(snapshot.desk.top.map(\.headline) == glance.desk.top.map(\.headline.text))
        #expect(snapshot.desk.top.map(\.department) == glance.desk.top.map(\.department.display))
        #expect(snapshot.missing == glance.missing.map(\.display))
        #expect(snapshot.colors == nil)
    }

    @Test("the club card's colours come from the served theme, and none with team colours off")
    func colorsFromTheme() throws {
        let catalog = try JSONDecoder().decode(Components.Schemas.Catalog.self, from: fixtureData("responses/getCatalog.json"))
        let pack = try #require(catalog.clubs.first?.theme)
        let colors = try #require(IntegrationStore.colors(of: pack, useTeamColors: true))
        #expect(colors.light == .init(background: pack.tokens.light.card, text: pack.tokens.light.cardText))
        #expect(colors.darkIncreasedContrast == .init(background: pack.tokens.darkIncreasedContrast.card, text: pack.tokens.darkIncreasedContrast.cardText))
        #expect(IntegrationStore.colors(of: pack, useTeamColors: false) == nil)
        #expect(IntegrationStore.colors(of: nil, useTeamColors: true) == nil)
    }

    @Test("written whole and read back as written; replaced by the next")
    func roundTrip() throws {
        let folder = try scratchFolder("glance")
        defer { try? FileManager.default.removeItem(at: folder) }
        let store = GlanceSnapshotStore(folder: folder.appending(path: "group", directoryHint: .isDirectory))
        #expect(store.read() == nil)
        let first = IntegrationStore.snapshot(of: try servedGlance(), colors: nil, at: Date(timeIntervalSince1970: 1_800_000_000))
        #expect(try store.write(first))
        #expect(store.read() == first)
        var second = first
        second.desk.count = 0
        second.desk.line = "Nothing to decide"
        second.writtenAt = first.writtenAt.addingTimeInterval(60)
        try store.write(second)
        #expect(store.read() == second)
        // Nothing but the file itself is left beside it
        let left = try FileManager.default.contentsOfDirectory(atPath: store.folder!.path)
        #expect(left == [GlanceSnapshotStore.fileName])
        store.remove()
        #expect(store.read() == nil)
    }

    @Test("a file that is not a snapshot, or of a later format, is not read")
    func unreadable() throws {
        let folder = try scratchFolder("glance-bad")
        defer { try? FileManager.default.removeItem(at: folder) }
        let store = GlanceSnapshotStore(folder: folder)
        try Data("{ not json".utf8).write(to: store.file!)
        #expect(store.read() == nil)
        var later = IntegrationStore.snapshot(of: try servedGlance(), colors: nil, at: Date())
        later.version = GlanceSnapshot.currentVersion + 1
        try store.write(later)
        #expect(store.read() == nil)
    }

    @Test("with no App Group to reach, nothing is written or read, and nothing fails")
    func noContainer() throws {
        let store = GlanceSnapshotStore(folder: nil)
        #expect(try store.write(IntegrationStore.snapshot(of: try servedGlance(), colors: nil, at: Date())) == false)
        #expect(store.read() == nil)
        store.remove()
    }

    @Test("the App Group is used only when it is named and this process is entitled to it")
    func appGroupGate() {
        #expect(AppGroup.identifier(from: "6T7RV2A4DQ.group.com.dakotawise.pennant") == "6T7RV2A4DQ.group.com.dakotawise.pennant")
        #expect(AppGroup.identifier(from: "$(PENNANT_APP_GROUP)") == nil)
        #expect(AppGroup.identifier(from: "") == nil)
        #expect(AppGroup.identifier(from: nil) == nil)
        // Named but not entitled (an unsigned build): no container, so no group folder is touched
        #expect(AppGroup.container(identifier: "6T7RV2A4DQ.group.com.dakotawise.pennant.dev", entitled: []) == nil)
        #expect(AppGroup.container(identifier: nil, entitled: ["6T7RV2A4DQ.group.com.dakotawise.pennant.dev"]) == nil)
        // The test runner carries no group: the real one is never reached from a test
        #expect(!AppGroup.entitledGroups().contains { $0.hasSuffix("group.com.dakotawise.pennant") || $0.hasSuffix("group.com.dakotawise.pennant.dev") })
    }
}

/// The widget's timeline (N14, Stage A): what it shows now, and when a snapshot turns out of date.
@Suite("The widget's timeline")
struct GlanceTimelineTests {
    private func snapshot(writtenAt: Date) -> GlanceSnapshot {
        GlanceSnapshot(
            writtenAt: writtenAt, club: "Club 1 N", asOf: "Through May 5, 2040", record: .init(display: "15–15", spoken: "Won 15, lost 15"),
            nextGame: nil, missing: [], desk: .init(count: 2, line: "2 to decide", top: []), colors: nil
        )
    }

    @Test("no snapshot: one entry saying there is none")
    func none() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let entries = GlanceTimeline.entries(for: nil, at: now)
        #expect(entries.count == 1)
        #expect(entries[0].date == now)
        #expect(entries[0].state == .none)
    }

    @Test("a fresh snapshot: current now, out of date a day after it was written")
    func fresh() {
        let written = Date(timeIntervalSince1970: 1_800_000_000)
        let now = written.addingTimeInterval(3600)
        let s = snapshot(writtenAt: written)
        let entries = GlanceTimeline.entries(for: s, at: now)
        #expect(entries.map(\.state) == [.current(s), .outOfDate(s)])
        #expect(entries[1].date == written.addingTimeInterval(GlanceTimeline.outOfDateAfter))
    }

    @Test("an old snapshot: drawn with its words, marked out of date, and nothing further")
    func old() {
        let written = Date(timeIntervalSince1970: 1_800_000_000)
        let s = snapshot(writtenAt: written)
        let entries = GlanceTimeline.entries(for: s, at: written.addingTimeInterval(GlanceTimeline.outOfDateAfter))
        #expect(entries.map(\.state) == [.outOfDate(s)])
        #expect(GlanceTimeline.state(of: s, at: written.addingTimeInterval(GlanceTimeline.outOfDateAfter - 1)) == .current(s))
    }

    @Test("a snapshot from a clock set ahead is current, and turns a day after it says")
    func future() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let s = snapshot(writtenAt: now.addingTimeInterval(600))
        let entries = GlanceTimeline.entries(for: s, at: now)
        #expect(entries.map(\.state) == [.current(s), .outOfDate(s)])
        #expect(entries[1].date > now)
    }
}
