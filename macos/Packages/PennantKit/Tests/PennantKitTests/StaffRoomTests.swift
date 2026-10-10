import Foundation
import Security
import OpenAPIRuntime
import PennantAPI
import Testing
@testable import PennantKit

/// The Staff room's answer stream as the app reads it (N13, D-074): in order, exactly one end and nothing after it, an
/// unknown event skipped, a dropped connection a failure with what arrived kept; the server's links and no others.
@Suite("The Staff room")
@MainActor
struct StaffRoomTests {
    private func readings(_ sse: String) async throws -> [StaffRoomEventReading] {
        var seen: [StaffRoomEventReading] = []
        try await StaffRoomStream.read(HTTPBody(sse)) { seen.append($0) }
        return seen
    }

    private func answer(_ sse: String) async throws -> StaffRoomAnswer {
        var answer = StaffRoomAnswer()
        try await StaffRoomStream.read(HTTPBody(sse)) { answer.apply($0) }
        answer.end(stopped: false)
        return answer
    }

    private func event(_ type: String, _ json: String) -> String { "event: \(type)\ndata: \(json)\n\n" }

    @Test("the captured stream: started, the speaker, a step, the deltas, the final text, done, and the read stops there")
    func capturedOrder() async throws {
        let sse = try String(decoding: fixtureData("staff-room.sse"), as: UTF8.self)
        let seen = try await readings(sse)
        let kinds = seen.map { reading -> String in
            if case .known(let kind) = reading { "\(kind)".components(separatedBy: "(").first ?? "" } else { "other" }
        }
        #expect(kinds == ["started", "speaker", "lookingUp", "text", "text", "text", "answered", "done"])
        let answer = try await answer(sse)
        #expect(answer.question?.typed == "How is P 1000 doing?")
        #expect(answer.answering == ["analyst"])
        #expect(answer.messages.count == 1)
        let live = try #require(answer.messages.first)
        #expect(live.streamed == "**The read**\n• **P 1000** is hitting.\n• Nothing to change yet.")
        #expect(live.lookedUp.map(\.display) == ["Reading a player card"])
        #expect(live.final?.answer?.links.first?.url == "pennant://player/1000")
        #expect(answer.answeredCount == 1)
        guard case .done(let done) = answer.outcome else { Issue.record("done"); return }
        #expect(done.conversationStamp == "cstamp")
    }

    @Test("a failure ends it with the partial answer kept, and nothing after the end changes it")
    func failureThenNothing() async throws {
        let sse = try String(decoding: fixtureData("staff-room.sse"), as: UTF8.self)
        // The second answer in the capture: the refused key, after half an answer
        let second = sse.components(separatedBy: "\n\n").filter { !$0.isEmpty }.drop { !$0.contains("And the bullpen?") }
        var answer = StaffRoomAnswer()
        try await StaffRoomStream.read(HTTPBody(second.joined(separator: "\n\n") + "\n\n")) { answer.apply($0) }
        guard case .failed(let failed) = answer.outcome else { Issue.record("failed"); return }
        #expect(failed.reason.value1 == .keyRefused)
        #expect(answer.messages.first?.final?.answer?.markdown.isEmpty == false)
        // A late event (it never should come) is ignored
        let late = try await readings(event("text", #"{"type":"text","messageId":"x","delta":"late"}"#))
        for reading in late { #expect(answer.apply(reading) == false) }
        #expect(answer.afterTheEnd == 1)
        #expect(answer.messages.contains { $0.id == "x" } == false)
    }

    @Test("an unknown event is skipped and a malformed one noted; the stream goes on")
    func unknownAndMalformed() async throws {
        let answer = try await answer(
            event("a-later-event", #"{"type":"a-later-event","x":1}"#)
                + event("text", #"{"type":"text","messageId":"m1"}"#)
                + event("text", #"{"type":"text","messageId":"m1","delta":"Hi"}"#)
                + event("done", #"{"type":"done","count":null,"conversationStamp":"s"}"#)
        )
        #expect(answer.skipped == 1)
        #expect(answer.malformed == ["text"])
        #expect(answer.messages.first?.streamed == "Hi")
        guard case .done = answer.outcome else { Issue.record("done"); return }
    }

    @Test("a stream that ends with neither done nor failed is dropped, its deltas kept")
    func dropped() async throws {
        let answer = try await answer(
            event("speaker", #"{"type":"speaker","messageId":"m1","speaker":{"display":"Peter"}}"#)
                + event("text", #"{"type":"text","messageId":"m1","delta":"Half"}"#)
        )
        #expect(answer.outcome == .dropped)
        #expect(answer.messages.first?.streamed == "Half")
    }

    // MARK: The store

    private func store(_ answers: [String: (contentType: String, body: Data)], statuses: [String: Int] = [:]) -> (StaffRoomStore, Client, AppModel.StoreKey, RoutedTransport) {
        let transport = RoutedTransport(answers, statuses: statuses)
        let client = PennantClient.make(port: 51_000, token: String(repeating: "t", count: 64), transport: transport)
        let key = AppModel.StoreKey(importStamp: "i1", club: ClubRef(id: 1), restores: 0, saveId: "s")
        return (StaffRoomStore(), client, key, transport)
    }

    @Test("a dropped stream is a failure, said as one, and the conversation is read again")
    func storeDropped() async throws {
        let (store, client, key, transport) = store([
            "POST /api/v2/staff-room/1/ask": RoutedTransport.sse(event("text", #"{"type":"text","messageId":"m1","delta":"Half"}"#)),
            "/api/v2/staff-room/1/conversation": try RoutedTransport.json("getStaffConversation-written"),
        ])
        #expect(store.ask(.typed("How?"), with: "analyst", members: nil, client: client, key: key))
        await store.settle("analyst")
        #expect(store.askProblems["analyst"].map { if case .unreachable = $0 { true } else { false } } == true)
        #expect(store.conversations["analyst"] != nil)
        // The conversation read again holds what was kept: the live copy goes
        #expect(store.answers["analyst"] == nil)
        #expect(transport.paths.contains { $0.hasPrefix("/api/v2/staff-room/1/conversation") })
    }

    @Test("a refusal before the stream (AI off, already answering) is the server's sentence, and nothing streamed")
    func storeRefused() async throws {
        let (store, client, key, _) = store(
            ["POST /api/v2/staff-room/1/ask": try RoutedTransport.json("askStaffRoom-ai-off")],
            statuses: ["POST /api/v2/staff-room/1/ask": 409]
        )
        #expect(store.ask(.about(playerId: 1000), with: "analyst", members: nil, client: client, key: key))
        await store.settle("analyst")
        guard case .served(let sentence)? = store.askProblems["analyst"] else { Issue.record("served"); return }
        #expect(sentence.isEmpty == false)
        #expect(store.answers["analyst"] == nil)
        #expect(store.isAnswering("analyst") == false)
    }

    @Test("asking about a player sends his id, never a sentence of the app's")
    func askAbout() async throws {
        let (store, client, key, transport) = store([
            "POST /api/v2/staff-room/1/ask": RoutedTransport.sse(event("done", #"{"type":"done","count":null,"conversationStamp":"s"}"#)),
            "/api/v2/staff-room/1/conversation": try RoutedTransport.json("getStaffConversation"),
        ])
        store.ask(.about(playerId: 1000), with: "room", members: ["manager", "trainer"], client: client, key: key)
        await store.settle("room")
        let sent = try #require(transport.body("POST /api/v2/staff-room/1/ask"))
        let body = try JSONDecoder().decode(Components.Schemas.StaffRoomAsk.self, from: sent)
        #expect(body.about?.playerId == 1000)
        #expect(body.question == nil)
        #expect(body.members == ["manager", "trainer"])
        #expect(store.askProblems["room"] == nil)
    }

    // MARK: Links

    @Test("only the links the server listed survive; streamed text has none")
    func links() throws {
        let link = try JSONDecoder().decode(
            Components.Schemas.AiLink.self,
            from: Data(#"{"url":"pennant://player/1000","text":"P 1000","target":{"kind":"player","playerId":1000,"teamId":1}}"#.utf8)
        )
        let markdown = "**[P 1000](pennant://player/1000)** and [him](pennant://player/2000), [a site](https://example.com), [run](javascript:alert(1)), <https://example.org>"
        let text = AiTextRendering.attributed(markdown, links: [link])
        let kept = text.runs.compactMap(\.link).map(\.absoluteString)
        #expect(kept == ["pennant://player/1000"])
        #expect(String(text.characters).contains("a site"))
        #expect(AiTextRendering.streamed(markdown).runs.allSatisfy { $0.link == nil })
        #expect(AiTextRendering.destination(of: URL(string: "pennant://player/1000")!, in: [link]) == .player(id: 1000))
        #expect(AiTextRendering.destination(of: URL(string: "pennant://player/2000")!, in: [link]) == nil)
        #expect(AiTextRendering.destination(of: URL(string: "https://example.com")!, in: [link]) == nil)
        #expect(AiTextRendering.plain("**Bold** and *it*") == "Bold and it")
    }

    // MARK: Keys

    @Test("the Keychain items: kept, read back, replaced and removed, under a test service of its own")
    nonisolated func keychainItems() throws {
        let items = KeychainItems(service: "com.dakotawise.pennant.tests.\(UUID().uuidString)")
        defer { try? items.remove(account: "anthropic") }
        #expect(items.contents() == .init())
        try items.save("sk-test-one", account: "anthropic")
        #expect(items.contents().readable == ["anthropic": "sk-test-one"])
        try items.save("sk-test-two", account: "anthropic")
        #expect(items.contents().readable == ["anthropic": "sk-test-two"])
        try items.remove(account: "anthropic")
        #expect(items.contents() == .init())
        // Removing what is not there is not a failure
        try items.remove(account: "anthropic")
    }

    @Test("a provider's key is kept under its id, or a later generation beside another copy's item")
    func generations() {
        #expect(KeychainItems.parse("anthropic") == ("anthropic", 1))
        #expect(KeychainItems.parse("anthropic.2") == ("anthropic", 2))
        #expect(KeychainItems.parse("anthropic.x") == ("anthropic.x", 1))
        #expect(KeychainItems.account("openai", generation: 1) == "openai")
        #expect(KeychainItems.account("openai", generation: 3) == "openai.3")
        #expect(KeychainItems.belongsToAnother(errSecInvalidOwnerEdit))
        #expect(KeychainItems.belongsToAnother(errSecInteractionNotAllowed))
        #expect(!KeychainItems.belongsToAnother(errSecParam))
    }

    @Test("a service per bundle id: the release app keeps N3's name, a development build its own")
    func servicePerBundle() {
        #expect(KeychainKeyStore.service(forBundleID: "com.dakotawise.pennant") == KeychainKeyStore.service)
        #expect(KeychainKeyStore.service(forBundleID: "com.dakotawise.pennant.dev") == "com.dakotawise.pennant.dev.apikeys")
        #expect(KeychainKeyStore.service(forBundleID: nil) == KeychainKeyStore.service)
    }

    @Test("saving a key hands the running server the new set on stdin, with no restart; removing it hands the set without")
    func keysHandedOver() async throws {
        let keys = MemoryKeyStore()
        let launcher = FakeLauncher { process, _ in process.ready() }
        let status = try fixtureStatus()
        let configuration = try fakeConfiguration()
        let controller = ServerController(configuration: configuration, launcher: launcher, keySource: keys, probe: { _, _ in status }, timing: fastTiming)
        let model = AppModel(configuration: configuration, controller: controller, keys: keys) { connection in
            PennantClient.make(port: connection.port, token: connection.token, transport: RoutedTransport([:]))
        }
        await model.start()
        #expect(await eventually { model.serverState.connection != nil })
        let revision = model.keysRevision
        try await model.saveKey("  sk-ant-new  ", for: "anthropic")
        let process = try #require(launcher.launched.first)
        let last = try #require(process.sent.last.map { String(decoding: $0, as: UTF8.self) })
        #expect(last == #"{"keys":{"anthropic":"sk-ant-new"}}"# + "\n")
        #expect(model.keysRevision > revision)
        #expect(launcher.launched.count == 1)
        try await model.removeKey("anthropic")
        #expect(process.sent.last.map { String(decoding: $0, as: UTF8.self) } == #"{"keys":{}}"# + "\n")
        await model.shutdown()
    }
}
