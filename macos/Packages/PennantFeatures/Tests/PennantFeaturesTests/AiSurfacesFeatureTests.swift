import AppKit
@testable import FeatureCore
import Foundation
@testable import FrontOffice
import PennantAPI
import PennantKit
@testable import Shell
import SwiftUI
import Testing

/// The AI surfaces on the Mac (N13, D-074), without drawing: the Front Office's Storylines and GM Briefing are built
/// views now, the preview model carries the captured AI payloads with AI off, and "Ask Staff About Him" hands the room
/// one player, once.
@MainActor
@Suite("The AI surfaces")
struct AiSurfacesFeatureTests {
    @Test("Storylines and the GM Briefing are the Front Office's own views, after the Morning Report and the Report")
    func frontOfficeViews() {
        let ids = FrontOfficeDepartment.views.map(\.id)
        #expect(ids == ["morningReport", "report", "storylines", "briefing"])
    }

    @Test("the preview model holds the captured AI surfaces, AI off in the server's words")
    func previewAiOff() throws {
        let model = PreviewFixtures.ready()
        let room = try #require(model.staffRoom.view)
        #expect(room.ai.available == false)
        #expect(room.ai.off?.text.isEmpty == false)
        #expect(room.staff.contains { $0.room })
        let storylines = try #require(model.writing.storylines)
        #expect(storylines.state.value1 == .never)
        #expect(storylines.canWrite == false)
        let briefing = try #require(model.writing.briefing)
        #expect(briefing.ai.off != nil)
        let keys = try #require(PreviewFixtures.aiKeys)
        #expect(keys.reenter.text.isEmpty == false)
        #expect(keys.providers.contains { $0.needsKey && $0.check != nil })
    }

    @Test("the written fixtures carry AI text with its links, each marked as the AI's")
    func written() throws {
        let storylines = try #require(PreviewFixtures.storylines(written: true))
        #expect(storylines.stories.isEmpty == false)
        #expect(storylines.written != nil)
        let briefing = try #require(PreviewFixtures.briefing(written: true))
        #expect(briefing.sections.isEmpty == false)
        let conversation = try #require(PreviewFixtures.staffConversation(written: true))
        let answer = try #require(conversation.messages.first { $0.answer != nil }?.answer)
        for link in answer.links {
            let url = try #require(URL(string: link.url))
            #expect(AiTextRendering.destination(of: url, in: answer.links) != nil)
        }
    }

    @Test("Ask Staff About Him hands the room one player, taken once")
    func router() {
        let router = StaffRoomRouter()
        var opened = 0
        router.ask(about: PlayerRef(id: 1000)) { opened += 1 }
        #expect(opened == 1)
        #expect(router.take() == PlayerRef(id: 1000))
        #expect(router.take() == nil)
    }
}
