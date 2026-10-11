import Foundation
import HTTPTypes
import OpenAPIRuntime
import PennantAPI
import Testing
@testable import PennantKit

/// A transport whose answers to the Staff room's question stream only as the test feeds them, one stream per question;
/// the conversation read fails (an answer the build did not expect), so the live answer stays in place to be looked at.
final class FedTransport: ClientTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var _streams: [AsyncStream<ArraySlice<UInt8>>.Continuation] = []
    private var _ended: Set<Int> = []
    private var _paths: [String] = []

    /// How many questions have arrived.
    var asks: Int { lock.withLock { _streams.count } }
    /// The questions whose stream the app stopped reading (called off), by number.
    var ended: Set<Int> { lock.withLock { _ended } }
    var paths: [String] { lock.withLock { _paths } }

    func feed(_ ask: Int, _ text: String) {
        let stream = lock.withLock { _streams[ask] }
        stream.yield(ArraySlice(Array(text.utf8)))
    }

    func finish(_ ask: Int) {
        let stream = lock.withLock { _streams[ask] }
        stream.finish()
    }

    func send(_ request: HTTPRequest, body _: HTTPBody?, baseURL _: URL, operationID _: String) async throws
        -> (HTTPResponse, HTTPBody?)
    {
        let path = request.path ?? ""
        lock.withLock { _paths.append(path) }
        guard request.method == .post, path.hasSuffix("/ask") else {
            return (HTTPResponse(status: .internalServerError), nil)
        }
        let (stream, continuation) = AsyncStream<ArraySlice<UInt8>>.makeStream()
        let number = lock.withLock {
            _streams.append(continuation)
            return _streams.count - 1
        }
        continuation.onTermination = { [weak self] _ in
            guard let self else { return }
            self.lock.withLock { _ = self._ended.insert(number) }
        }
        var response = HTTPResponse(status: .ok)
        response.headerFields[.contentType] = "text/event-stream; charset=utf-8"
        return (response, HTTPBody(stream, length: .unknown, iterationBehavior: .single))
    }
}

/// The answer under way belongs to its own question (review N13B, H1 and M1): a new Front Office build mid-answer, or
/// Stop then a quick question again, never leaves an answer running for ever or ends the new one.
@Suite("The Staff room's answer under way")
@MainActor
struct StaffRoomRaceTests {
    private func event(_ type: String, _ json: String) -> String { "event: \(type)\ndata: \(json)\n\n" }
    private var speaker: String { event("speaker", #"{"type":"speaker","messageId":"m1","speaker":{"display":"Peter"}}"#) }
    private func text(_ delta: String) -> String { event("text", #"{"type":"text","messageId":"m1","delta":"\#(delta)"}"#) }
    private var done: String { event("done", #"{"type":"done","count":null,"conversationStamp":"s"}"#) }

    private func setUp() -> (StaffRoomStore, Client, AppModel.StoreKey, FedTransport) {
        let transport = FedTransport()
        let client = PennantClient.make(port: 51_000, token: String(repeating: "t", count: 64), transport: transport)
        let key = AppModel.StoreKey(importStamp: "i1", club: ClubRef(id: 1), restores: 0, reportStamp: "r1", saveId: "s")
        return (StaffRoomStore(), client, key, transport)
    }

    @Test("a new Front Office build while answering: the answer still finishes, and the room can be asked again")
    func reportStampMovesMidAnswer() async throws {
        let (store, client, key, transport) = setUp()
        #expect(store.ask(.typed("How?"), with: "analyst", members: nil, client: client, key: key))
        #expect(await eventually { transport.asks == 1 })
        transport.feed(0, speaker + text("Half"))
        #expect(await eventually { store.answers["analyst"]?.messages.first?.streamed == "Half" })
        // The scene's `.task(id:)` reads again for the new key, as it does on every `frontOfficeUpdated`
        var moved = key
        moved.reportStamp = "r2"
        await store.loadConversation("analyst", client: client, key: moved)
        transport.feed(0, text(" and more") + done)
        transport.finish(0)
        await store.settle("analyst")
        guard case .done? = store.answers["analyst"]?.outcome else {
            Issue.record("the answer did not finish: \(String(describing: store.answers["analyst"]?.outcome))")
            return
        }
        #expect(store.answers["analyst"]?.messages.first?.streamed == "Half and more")
        #expect(store.isAnswering("analyst") == false)
        // The read after the answer was for the newer key, never the one the question was asked under: a stale key is
        // not followed again (asking under it is refused, as the scene only ever asks with the current one)
        #expect(store.ask(.typed("Again?"), with: "analyst", members: nil, client: client, key: moved))
        #expect(await eventually { transport.asks == 2 })
        transport.feed(1, done)
        transport.finish(1)
        await store.settle("analyst")
        guard case .done? = store.answers["analyst"]?.outcome else { Issue.record("the second answer did not finish"); return }
    }

    @Test("an older key is never followed again: a stale read is not sent")
    func olderKeyIgnored() async {
        let (store, client, key, transport) = setUp()
        var moved = key
        moved.reportStamp = "r2"
        await store.loadConversation("analyst", client: client, key: key)
        await store.loadConversation("analyst", client: client, key: moved)
        let sent = transport.paths.count
        await store.loadConversation("analyst", client: client, key: key, force: true)
        #expect(transport.paths.count == sent)
    }

    @Test("Stop, then the question asked again at once: the new answer is its own, never ended by the old one")
    func stopThenAskAgain() async throws {
        let (store, client, key, transport) = setUp()
        #expect(store.ask(.typed("First?"), with: "analyst", members: nil, client: client, key: key))
        #expect(await eventually { transport.asks == 1 })
        transport.feed(0, speaker + text("Old"))
        #expect(await eventually { store.answers["analyst"]?.messages.first?.streamed == "Old" })
        store.stop("analyst", client: client, key: key)
        #expect(store.ask(.typed("Second?"), with: "analyst", members: nil, client: client, key: key))
        // The stopped question's stream is called off, and its task runs to its end before the new answer streams
        #expect(await eventually { transport.ended.contains(0) })
        #expect(await eventually { transport.asks == 2 })
        for _ in 0..<50 { await Task.yield() }
        #expect(store.isAnswering("analyst"))
        transport.feed(1, speaker + text("New") + done)
        transport.finish(1)
        await store.settle("analyst")
        guard case .done? = store.answers["analyst"]?.outcome else {
            Issue.record("the new answer was ended: \(String(describing: store.answers["analyst"]?.outcome))")
            return
        }
        #expect(store.answers["analyst"]?.messages.first?.streamed == "New")
    }
}

/// Storylines and the briefing never turn back to a key they have moved past (review N13B, H1).
@Suite("AI writing's key")
@MainActor
struct AiWritingKeyTests {
    @Test("a read under an older key is not sent, and the newer key's piece stays")
    func olderKeyIgnored() async throws {
        let transport = RoutedTransport(["/api/v2/storylines/1": try RoutedTransport.json("getStorylines-written")])
        let client = PennantClient.make(port: 51_000, token: String(repeating: "t", count: 64), transport: transport)
        let key = AppModel.StoreKey(importStamp: "i1", club: ClubRef(id: 1), restores: 0, reportStamp: "r1", saveId: "s")
        var moved = key
        moved.reportStamp = "r2"
        let store = AiWritingStore()
        await store.load(.storylines, client: client, key: key, keysRevision: 0)
        await store.load(.storylines, client: client, key: moved, keysRevision: 0)
        let sent = transport.paths.count
        await store.load(.storylines, client: client, key: key, keysRevision: 0, force: true)
        await store.write(.storylines, client: client, key: key)
        #expect(transport.paths.count == sent)
        #expect(store.storylines != nil)
        // The newer key is still the one followed: its forced read goes out
        await store.load(.storylines, client: client, key: moved, keysRevision: 0, force: true)
        #expect(transport.paths.count == sent + 1)
    }
}
