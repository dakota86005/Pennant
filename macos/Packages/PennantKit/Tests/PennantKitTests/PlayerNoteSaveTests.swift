import Foundation
import HTTPTypes
import OpenAPIRuntime
import PennantAPI
import Testing
@testable import PennantKit

/// Answers the note routes by a script: each `PUT` may be held, fail or be called off; every body sent is kept in order.
private final class NoteTransport: ClientTransport, @unchecked Sendable {
    enum Outcome { case answer, cancel, fail }
    private let lock = NSLock()
    private var _sent: [String] = []
    private var _outcome: Outcome = .answer
    private var _hold: Duration?

    var sent: [String] { lock.withLock { _sent } }
    func next(_ outcome: Outcome, hold: Duration? = nil) { lock.withLock { _outcome = outcome; _hold = hold } }

    func send(_ request: HTTPRequest, body: HTTPBody?, baseURL _: URL, operationID _: String) async throws -> (HTTPResponse, HTTPBody?) {
        var text = ""
        if let body, let data = try? await Data(collecting: body, upTo: 1 << 20),
           let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            text = object["note"] as? String ?? ""
        }
        let (outcome, hold) = lock.withLock {
            if request.method == .put { _sent.append(text) }
            if request.method == .delete { _sent.append("<undo>") }
            return (_outcome, _hold)
        }
        if let hold { try? await Task.sleep(for: hold) }
        switch outcome {
        case .cancel: throw URLError(.cancelled)
        case .fail: throw URLError(.cannotConnectToHost)
        case .answer: break
        }
        var object = try #require(try JSONSerialization.jsonObject(with: fixtureData("responses/setPlayerNote-changed.json")) as? [String: Any])
        var notes = try #require(object["notes"] as? [String: Any])
        notes["note"] = text
        object["notes"] = notes
        var response = HTTPResponse(status: .ok)
        response.headerFields[.contentType] = "application/json"
        return (response, HTTPBody(try JSONSerialization.data(withJSONObject: object)))
    }
}

@MainActor
private final class Lines {
    var all: [String] = []
}

/// The GM's note (review H1 and H2, N11): his words never reach the app's log, a request called off is a non-event, and
/// what he typed is saved whatever happens to the view he typed it in.
@Suite("The GM's note as he types it", .serialized)
@MainActor
struct PlayerNoteSaveTests {
    private let secret = "Tipping his changeup out of the stretch"

    private func client(_ transport: any ClientTransport) -> Client {
        PennantClient.make(port: 5178, token: String(repeating: "t", count: 64), transport: transport)
    }

    @Test("a save called off logs nothing and says nothing")
    func cancelledSave() async {
        let lines = Lines()
        let store = PlayerStore { lines.all.append($0) }
        let transport = NoteTransport()
        transport.next(.cancel)
        let change = await store.setNote(1019, secret, client: client(transport))
        #expect(change == nil)
        #expect(store.noteProblems[1019] == nil)
        #expect(lines.all.isEmpty)
    }

    @Test("a save that fails is said and logged by its operation, never with the note's words")
    func failedSave() async {
        let lines = Lines()
        let store = PlayerStore { lines.all.append($0) }
        let transport = NoteTransport()
        transport.next(.fail)
        _ = await store.setNote(1019, secret, client: client(transport))
        #expect(store.noteProblems[1019] != nil)
        #expect(!lines.all.isEmpty)
        for line in lines.all {
            #expect(!line.contains("changeup"))
            #expect(line.contains("setPlayerNote"))
        }
        let detail = store.noteProblems[1019]?.detail ?? ""
        #expect(detail.contains("setPlayerNote"))
        #expect(detail.contains("changeup") == false)
    }

    @Test("an error's log line names the operation and the cause's domain and code, never the input")
    func logLine() {
        let error = ClientError(
            operationID: "setPlayerNote", operationInput: secret, request: nil, requestBody: nil, baseURL: nil,
            response: nil, responseBody: nil, causeDescription: secret, underlyingError: URLError(.timedOut)
        )
        let line = RequestProblem.logLine(error)
        #expect(line.contains("setPlayerNote"))
        #expect(line.contains(NSURLErrorDomain))
        #expect(!line.contains("changeup"))
        #expect(RequestProblem.isCancellation(ClientError(
            operationID: "x", operationInput: "", request: nil, requestBody: nil, baseURL: nil, response: nil,
            responseBody: nil, causeDescription: "", underlyingError: URLError(.cancelled)
        )))
        #expect(!RequestProblem.isCancellation(error))
    }

    @Test("typed and flushed at once (a section switch, a closed window): saved without the wait")
    func flushNow() async {
        let store = PlayerStore()
        store.noteDelay = .seconds(60)
        let transport = NoteTransport()
        let c = client(transport)
        store.type(1019, "Ready for the late innings") { id in await store.flush(id, client: c) }
        #expect(store.drafts[1019] == "Ready for the late innings")
        await store.flush(1019, client: c)
        #expect(transport.sent == ["Ready for the late innings"])
        #expect(store.drafts[1019] == nil)
        #expect(store.noteText(1019) == "Ready for the late innings")
    }

    @Test("a key typed while a save is under way never cancels it: both reach the server, the latest last")
    func keystrokeDuringSave() async {
        let store = PlayerStore()
        store.noteDelay = .milliseconds(10)
        let transport = NoteTransport()
        transport.next(.answer, hold: .milliseconds(500))
        let c = client(transport)
        let save: @MainActor (Int) async -> Void = { id in await store.flush(id, client: c) }
        store.type(1019, "Ready") { await save($0) }
        // The first save is under way, held by the server: waited for by what the server has seen, not a fixed time
        // (a loaded CI machine took longer than 60 ms to send it, PR #58)
        let deadline = ContinuousClock.now + .seconds(10)
        while transport.sent.isEmpty && ContinuousClock.now < deadline { try? await Task.sleep(for: .milliseconds(5)) }
        #expect(transport.sent == ["Ready"])
        store.type(1019, "Ready for the late innings") { await save($0) }
        await store.flush(1019, client: c)
        #expect(transport.sent == ["Ready", "Ready for the late innings"])
        #expect(store.drafts[1019] == nil)
        #expect(store.noteText(1019) == "Ready for the late innings")
    }

    @Test("a save that fails keeps the draft for the next flush")
    func failedKeepsDraft() async {
        let store = PlayerStore()
        store.noteDelay = .seconds(60)
        let transport = NoteTransport()
        transport.next(.fail)
        let c = client(transport)
        store.type(1019, secret) { _ in }
        await store.flush(1019, client: c)
        #expect(store.drafts[1019] == secret)
        transport.next(.answer)
        await store.flush(1019, client: c)
        #expect(store.drafts[1019] == nil)
        #expect(transport.sent == [secret, secret])
    }

    @Test("the quit's last words send what was typed and not kept, off the main actor")
    func lastSaves() async {
        let store = PlayerStore()
        store.noteDelay = .seconds(60)
        let transport = NoteTransport()
        store.type(1019, secret) { _ in }
        let send = store.lastSaves(client: client(transport))
        await Task.detached { await send() }.value
        #expect(transport.sent == [secret])
        // Nothing typed: nothing sent
        let quiet = PlayerStore()
        let other = NoteTransport()
        await Task.detached { [send = quiet.lastSaves(client: client(other))] in await send() }.value
        #expect(other.sent.isEmpty)
    }
}
