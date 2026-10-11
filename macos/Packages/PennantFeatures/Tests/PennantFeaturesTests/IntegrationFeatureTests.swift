import AppKit
@testable import FeatureCore
import Foundation
import PennantAPI
import PennantKit
@testable import Shell
import SwiftUI
import Testing

/// Pennant outside its windows (N14, Stage A; BEHAVIOR_CASES.md "Pennant for Mac", the N14 rows): a view asked for from
/// outside the windows is taken once by the next main window; the menu bar extra's model holds the served glance; and the
/// entities Shortcuts and Spotlight show are the served players and clubs, in the order served.
@MainActor
@Suite("Pennant outside its windows: routing, the glance, the entities")
struct IntegrationFeatureTests {
    @Test("a view asked for with no main window open is taken once, by the next main window")
    func routeTakenOnce() {
        let routing = AppRouting()
        #expect(routing.takeRouteRequest() == nil)
        let route = AppRoute(department: DeptID(rawValue: "frontOffice"), view: "morningReport", key: nil)
        routing.requestRoute(route)
        #expect(routing.takeRouteRequest() == route)
        #expect(routing.takeRouteRequest() == nil)
    }

    @Test("the menu bar extra's model holds the served glance, its count and words as served")
    func glanceInModel() throws {
        let model = PreviewFixtures.ready()
        let served = try #require(PreviewFixtures.glance)
        #expect(model.integration.glance?.desk.count == served.desk.count)
        #expect(model.integration.glance?.desk.line.display == served.desk.line.display)
        #expect(model.integration.glance?.record?.value?.display == served.record?.value?.display)
    }

    @Test("entities by id are the served list's, in the order asked; an id it does not hold keeps only its id")
    func entitiesById() throws {
        let list = try #require(PreviewFixtures.spotlight)
        let store = IntegrationStore.preview(glance: nil, spotlight: list)
        let first = try #require(list.players.first), last = try #require(list.players.last)
        let resolved = store.entities(for: [Int(last.id)!, 999_999, Int(first.id)!], kind: .player)
        #expect(resolved.map(\.id) == [Int(last.id)!, 999_999, Int(first.id)!])
        #expect(resolved[0] == .init(id: Int(last.id)!, name: last.title, line: last.line))
        #expect(resolved[1] == .init(id: 999_999, name: "", line: ""))
        #expect(store.suggested(.club).map(\.name) == list.clubs.map(\.title))
    }

    @Test("a search's players and clubs become entities; its views and Player Search do not")
    func searchToEntities() throws {
        let answer = try #require(PreviewFixtures.decode(Components.Schemas.SearchAnswer.self, "search"))
        let results = answer.groups.flatMap(\.results)
        let clubs = IntegrationStore.entityLines(results, kind: .club)
        #expect(clubs.count == results.filter { $0.kind.value1 == .club }.count)
        let players = IntegrationStore.entityLines(results, kind: .player)
        #expect(players.allSatisfy { $0.id > 0 })
        #expect(IntegrationStore.entityLines(results, kind: .player).count <= results.filter { $0.kind.value1 == .player }.count)
    }
}

/// The menu bar extra's window for review (N14; SWIFTUI_REBUILD.md section 8), from the captured fixtures, light and
/// dark, into `build/macos-snapshots/` (`n14-*`). Skipped on CI.
@MainActor
@Suite("Pennant outside its windows: snapshots", .serialized, .enabled(if: ProcessInfo.processInfo.environment["CI"] == nil))
struct IntegrationSnapshotTests {
    static let folder = PreviewFixtures.repositoryRoot.appending(path: "build/macos-snapshots", directoryHint: .isDirectory)

    init() throws {
        try FileManager.default.createDirectory(at: Self.folder, withIntermediateDirectories: true)
    }

    @Test("the menu bar extra's window with the served glance", arguments: [false, true])
    func menuBarExtra(dark: Bool) throws {
        let view = MenuBarGlanceView {}.environment(PreviewFixtures.ready()).environment(AppRouting())
        _ = NSApplication.shared
        let size = CGSize(width: 300, height: 420)
        let host = NSHostingView(rootView: view.frame(width: size.width, height: size.height, alignment: .top))
        let window = NSWindow(contentRect: CGRect(origin: .zero, size: size), styleMask: [.borderless], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = host
        window.setFrameOrigin(NSPoint(x: -20_000, y: -20_000))
        window.orderFrontRegardless()
        for _ in 0..<40 { RunLoop.main.run(until: Date().addingTimeInterval(0.03)) }
        let rep = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
        host.cacheDisplay(in: host.bounds, to: rep)
        window.orderOut(nil)
        let png = try #require(rep.representation(using: .png, properties: [:]))
        try png.write(to: Self.folder.appending(path: "n14-menu-bar-extra-\(dark ? "dark" : "light").png"))
    }
}
