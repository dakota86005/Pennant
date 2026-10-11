import AppKit
@testable import FeatureCore
import Foundation
@testable import FrontOffice
import PennantAPI
import PennantDesign
import PennantKit
@testable import Shell
import SwiftUI
import Testing

/// Pictures of the AI surfaces for review (N13; SWIFTUI_REBUILD.md section 8), from the captured fixtures, light and
/// dark, into `build/macos-snapshots/` (`ai-*`): the Staff room with AI off and with a kept conversation, an answer
/// streaming and a failure; Storylines and the GM Briefing, never written and written. Skipped on CI.
@MainActor
@Suite("AI surfaces snapshots", .serialized, .enabled(if: ProcessInfo.processInfo.environment["CI"] == nil))
struct AiSurfacesSnapshotTests {
    static let folder = PreviewFixtures.repositoryRoot.appending(path: "build/macos-snapshots", directoryHint: .isDirectory)

    init() throws {
        try FileManager.default.createDirectory(at: Self.folder, withIntermediateDirectories: true)
    }

    private func hosted(_ view: some View, model: AppModel = PreviewFixtures.ready()) -> some View {
        view.environment(model).environment(AppRouting())
    }

    @Test("the Staff room with AI off: the people, what the analyst is for, one calm served line", arguments: [false, true])
    func staffRoomAiOff(dark: Bool) throws {
        try draw(hosted(StaffRoomScene()), size: CGSize(width: 920, height: 700), dark: dark, name: "ai-staff-room-off")
    }

    @Test("the Staff room with a kept conversation, a refused key and its partial answer (AI on, from the fixtures)", arguments: [false, true])
    func staffRoomConversation(dark: Bool) throws {
        var view = try #require(PreviewFixtures.staffRoom)
        view.ai.available = true
        view.ai.off = nil
        let conversation = try #require(PreviewFixtures.staffConversation(written: true))
        let sse = try String(contentsOf: PreviewFixtures.repositoryRoot.appending(path: "contract/fixtures/staff-room.sse"), encoding: .utf8)
        let failed = try sse.components(separatedBy: "\n\n").first { $0.hasPrefix("event: failed") }.map { block in
            try JSONDecoder().decode(Components.Schemas.StaffRoomFailedEvent.self, from: Data(block.split(separator: "\n")[1].dropFirst(6).utf8))
        }
        let store = StaffRoomStore.preview(view: view, conversations: [conversation], failure: failed)
        try draw(hosted(StaffRoomScene(), model: PreviewFixtures.ready(staffRoom: store)), size: CGSize(width: 920, height: 700), dark: dark, name: "ai-staff-room-conversation")
    }

    @Test("Storylines and the GM Briefing, never written (AI off) and written", arguments: [false, true])
    func writing(dark: Bool) throws {
        try draw(hosted(StorylinesView()), size: CGSize(width: 900, height: 640), dark: dark, name: "ai-storylines-never")
        let written = AiWritingStore.preview(storylines: PreviewFixtures.storylines(written: true), briefing: PreviewFixtures.briefing(written: true))
        let model = PreviewFixtures.ready(writing: written)
        try draw(hosted(StorylinesView(), model: model), size: CGSize(width: 900, height: 900), dark: dark, name: "ai-storylines-written")
        try draw(hosted(BriefingView(), model: model), size: CGSize(width: 900, height: 900), dark: dark, name: "ai-briefing-written")
    }

    private func draw(_ view: some View, size: CGSize, dark: Bool, name: String) throws {
        _ = NSApplication.shared
        let host = NSHostingView(rootView: view.frame(width: size.width, height: size.height))
        let window = NSWindow(contentRect: CGRect(origin: .zero, size: size), styleMask: [.titled, .closable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = host
        window.setFrameOrigin(NSPoint(x: -20_000, y: -20_000))
        window.orderFrontRegardless()
        for _ in 0..<40 { RunLoop.main.run(until: Date().addingTimeInterval(0.03)) }
        let drawn = window.contentView?.superview ?? host
        let rep = try #require(drawn.bitmapImageRepForCachingDisplay(in: drawn.bounds))
        drawn.cacheDisplay(in: drawn.bounds, to: rep)
        window.orderOut(nil)
        let png = try #require(rep.representation(using: .png, properties: [:]))
        try png.write(to: Self.folder.appending(path: "\(name)-\(dark ? "dark" : "light").png"))
    }
}
