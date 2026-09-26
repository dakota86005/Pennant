import Foundation
import HTTPTypes
import OpenAPIRuntime
import Testing
@testable import PennantAPI

/// The generated client holds the contract's promises in Swift (D-056, SWIFTUI_REBUILD.md section 4.3): the token rides
/// on every request, the event stream decodes, a newer server's event or code never throws, and a game date stays a
/// string. The payloads below are written the way the server writes them (`server/serverEvents.ts`).

/// A transport that answers every request with one canned response and remembers what it was asked.
private final class CannedTransport: ClientTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var _requests: [HTTPRequest] = []
    private let contentType: String
    private let body: String

    init(contentType: String, body: String) {
        self.contentType = contentType
        self.body = body
    }

    var requests: [HTTPRequest] { lock.withLock { _requests } }

    func send(_ request: HTTPRequest, body _: HTTPBody?, baseURL _: URL, operationID _: String) async throws
        -> (HTTPResponse, HTTPBody?)
    {
        lock.withLock { _requests.append(request) }
        var response = HTTPResponse(status: .ok)
        response.headerFields[.contentType] = contentType
        return (response, HTTPBody(body))
    }
}

private let token = String(repeating: "k", count: 64)

private func client(_ transport: CannedTransport) -> Client {
    Client(
        serverURL: URL(string: "http://127.0.0.1:5178")!,
        transport: transport,
        middlewares: [BearerTokenMiddleware(token: token)]
    )
}

private let status = """
    {"app":{"name":"Pennant","version":"0.1.0","projectUrl":"https://example.invalid/p","upstreamUrl":"https://example.invalid/u"},\
    "csvExportedAt":null,"configured":true,"saveName":"Test League","csvDir":"/tmp/csv","csvDirExists":true,"importing":false,\
    "importProgress":null,"lastImport":{"tables":2,"rows":3,"startedAt":"2026-09-25T12:00:00.000Z","finishedAt":"2026-09-25T12:00:01.000Z",\
    "files":[{"table":"players","rows":3}]},"lastError":null,"importInterruptedSince":null,"hasData":true,"exportPending":null,\
    "logoToken":"abc","ratingScaleMax":80}
    """

/// Server-sent events as the server writes them: `event: <type>` and `data: <json>`, a keep-alive comment between.
private func sse(_ events: [(String, String)]) -> String {
    events.map { "event: \($0.0)\ndata: \($0.1)\n\n" }.joined(separator: ": keep-alive\n\n")
}

private func decodedEvents(from body: String) async throws -> [Components.Schemas.ServerEvent] {
    let transport = CannedTransport(contentType: "text/event-stream; charset=utf-8", body: body)
    let response = try await client(transport).streamEvents()
    let stream = try response.ok.body.textEventStream
        .asDecodedServerSentEventsWithJSONData(of: Components.Schemas.ServerEvent.self)
    var events: [Components.Schemas.ServerEvent] = []
    for try await event in stream {
        if let data = event.data { events.append(data) }
    }
    return events
}

/// The payloads the real server sent on the synthetic save, captured by `tests/contract.test.ts` (`contract/fixtures/`).
private let fixtures = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    .appending(path: "contract/fixtures")

private func fixture(_ name: String) throws -> String {
    try String(contentsOf: fixtures.appending(path: name), encoding: .utf8)
}

private func jsonClient(_ name: String) throws -> Client {
    client(CannedTransport(contentType: "application/json", body: try fixture("responses/\(name).json")))
}

@Suite("PennantAPI")
struct PennantAPITests {
    @Test("the middleware puts the bearer token on every request")
    func bearerToken() async throws {
        let transport = CannedTransport(contentType: "application/json", body: status)
        let response = try await client(transport).getStatus()
        #expect(try response.ok.body.json.saveName == "Test League")
        #expect(transport.requests.count == 1)
        #expect(transport.requests.first?.headerFields[.authorization] == "Bearer \(token)")
    }

    @Test("the middleware sets the header itself, replacing any other")
    func middlewareReplaces() async throws {
        var request = HTTPRequest(method: .get, scheme: "http", authority: "127.0.0.1", path: "/api/status")
        request.headerFields[.authorization] = "Bearer stale"
        let middleware = BearerTokenMiddleware(token: "fresh-token")
        let (response, _) = try await middleware.intercept(
            request, body: nil, baseURL: URL(string: "http://127.0.0.1")!, operationID: "getStatus"
        ) { sent, _, _ in
            #expect(sent.headerFields[values: .authorization] == ["Bearer fresh-token"])
            return (HTTPResponse(status: .ok), nil)
        }
        #expect(response.status == .ok)
    }

    @Test("an event stream with known events decodes, each to its own shape")
    func knownEvents() async throws {
        let events = try await decodedEvents(from: sse([
            ("hello", #"{"type":"hello","status":\#(status)}"#),
            ("import-started", #"{"type":"import-started","startedAt":"2026-09-25T12:00:00.000Z"}"#),
            ("import-progress", #"{"type":"import-progress","progress":{"table":"players","fileIndex":1,"files":70,"rows":1200,"phase":"writing"}}"#),
            ("import-finished", #"{"type":"import-finished","lastImport":null,"error":"No .csv files"}"#),
            ("export-pending", #"{"type":"export-pending","since":"2026-09-25T12:05:00.000Z"}"#),
            ("job", #"{"type":"job","kind":"storylines","orgId":1,"status":{"state":"running","startedAt":"2026-09-25T12:06:00.000Z","finishedAt":null,"error":null}}"#),
        ]))
        #expect(events.count == 6)
        #expect(events[0].value1?.status.saveName == "Test League")
        #expect(events[0].value1?.status.lastImport?.files.first?.table == "players")
        #expect(events[1].value2?.startedAt == "2026-09-25T12:00:00.000Z")
        #expect(events[2].value3?.progress.phase.value1 == .writing)
        #expect(events[3].value4?.lastImport == nil)
        #expect(events[3].value4?.error == "No .csv files")
        #expect(events[4].value5?.since == "2026-09-25T12:05:00.000Z")
        #expect(events[5].value6?.status.state.value1 == .running)
        // Every event also reads as its bare type, which is what a client switches on
        #expect(events.map { $0.value7?._type } == ["hello", "import-started", "import-progress", "import-finished", "export-pending", "job"])
        // Each event decodes to its own shape only: a hello is not an export-pending
        #expect(events[0].value5 == nil && events[4].value1 == nil)
    }

    @Test("an event type this build does not know decodes as unknown, and the stream goes on")
    func unknownEvent() async throws {
        let events = try await decodedEvents(from: sse([
            ("desk-changed", #"{"type":"desk-changed","count":3,"items":[{"id":"x"}]}"#),
            ("export-pending", #"{"type":"export-pending","since":"2026-09-25T12:05:00.000Z"}"#),
        ]))
        #expect(events.count == 2)
        let unknown = events[0]
        #expect(unknown.value7?._type == "desk-changed")
        #expect(
            [unknown.value1 == nil, unknown.value2 == nil, unknown.value3 == nil, unknown.value4 == nil,
             unknown.value5 == nil, unknown.value6 == nil].allSatisfy { $0 }
        )
        #expect(events[1].value5?.since == "2026-09-25T12:05:00.000Z")
    }

    @Test("an enum code this build does not know decodes as its string, never an error")
    func unknownEnumValue() throws {
        let progress = try JSONDecoder().decode(
            Components.Schemas.ImportProgress.self,
            from: Data(#"{"table":"players","fileIndex":1,"files":2,"rows":3,"phase":"verifying","addedLater":true}"#.utf8)
        )
        #expect(progress.phase.value1 == nil)
        #expect(progress.phase.value2 == "verifying")
        // A known code still reads as the known case
        let known = try JSONDecoder().decode(
            Components.Schemas.ImportProgress.self,
            from: Data(#"{"table":"players","fileIndex":1,"files":2,"rows":3,"phase":"indexing"}"#.utf8)
        )
        #expect(known.phase.value1 == .indexing)
        // A nullable code reads null as nil and a new code as its string
        let keys = try JSONDecoder().decode(
            [Components.Schemas.KeyStatus].self,
            from: Data(#"""
                [{"configured":false,"source":null,"hint":null,"encrypted":false},
                 {"configured":true,"source":"cloud","hint":"1234","encrypted":true},
                 {"configured":true,"source":"keychain","hint":"9876","encrypted":true}]
                """#.utf8)
        )
        #expect(keys[0].source == nil)
        #expect(keys[1].source?.value1 == nil && keys[1].source?.value2 == "cloud")
        #expect(keys[2].source?.value1 == .keychain)
    }

    @Test("what the server sent on the synthetic save decodes through the generated client")
    func capturedResponses() async throws {
        #expect(try await jsonClient("getStatus").getStatus().ok.body.json.ratingScaleMax == 80)
        #expect(try await jsonClient("listSaves").listSaves().ok.body.json.first?.name == "Test League")
        let dataStatus = try await jsonClient("getDataStatus").getDataStatus().ok.body.json
        #expect(dataStatus.csv.currentDate == "2040-05-06")
        #expect(dataStatus.transactionLog.unavailableReason?.value1 == .saveNotFound)
        #expect(try await jsonClient("getSettings").getSettings().ok.body.json.settings.theme.value1 == .system)
        #expect(try await jsonClient("getProviders").getProviders().ok.body.json.providers.isEmpty == false)
        let orgs = try await jsonClient("listOrgs").listOrgs().ok.body.json
        let teamID: Int = try #require(orgs.first).teamId
        #expect(teamID > 0)
        #expect(orgs.contains { $0.isHuman })
        // The POST answers, decoded as the types the spec names for them
        let decoder = JSONDecoder()
        for name in ["resolveFolder-export", "resolveFolder-saves", "resolveFolder-no-folder"] {
            _ = try decoder.decode(Components.Schemas.ResolveResult.self, from: Data(try fixture("responses/\(name).json").utf8))
        }
        #expect(try decoder.decode(Components.Schemas.SaveSourceResult.self, from: Data(try fixture("responses/setSaveSource-cleared.json").utf8)).ok)
        for name in ["setSaveSource-not-a-save", "setSave-no-folder", "startImport-no-save"] {
            _ = try decoder.decode(Components.Schemas.ApiError.self, from: Data(try fixture("responses/\(name).json").utf8))
        }
    }

    @Test("the events the server streamed on the synthetic save decode, each to its own shape")
    func capturedEvents() async throws {
        let events = try await decodedEvents(from: try fixture("events.sse"))
        #expect(events.map(\.typeName) == ["hello", "import-started", "import-progress", "import-finished", "job"])
        for event in events {
            guard case .known = event.reading else {
                Issue.record("\(event.typeName ?? "?") did not read as known")
                continue
            }
        }
        #expect(events[4].value6?.status.state.value1 == .done)
        let orgID: Int? = events[4].value6?.orgId
        #expect(orgID == 1)
    }

    @Test("an event reads as known, unknown, or known but malformed, never malformed as unknown")
    func eventReading() async throws {
        let events = try await decodedEvents(from: sse([
            ("hello", #"{"type":"hello","status":\#(status)}"#),
            ("desk-changed", #"{"type":"desk-changed","count":3}"#),
            // A hello whose status lost a field this build requires
            ("hello", #"{"type":"hello","status":{"app":null}}"#),
            ("import-progress", #"{"type":"import-progress","progress":"half"}"#),
        ]))
        #expect(events.count == 4)
        guard case .known(let hello) = events[0].reading else { Issue.record("hello"); return }
        #expect(hello.value1?.status.saveName == "Test League")
        #expect(events[1].reading == .unknown(type: "desk-changed"))
        #expect(events[2].reading == .malformed(type: "hello"))
        #expect(events[2].value1 == nil)
        #expect(events[3].reading == .malformed(type: "import-progress"))
    }

    @Test("the reading knows every event shape the generated union has")
    func readingCoversEveryShape() {
        let names = Components.Schemas.ServerEvent.knownTypeNames
        #expect(names.count == Components.Schemas.ServerEvent.shapeCount)
        #expect(names == ["hello", "import-started", "import-progress", "import-finished", "export-pending", "job"])
    }

    @Test("a game date stays the string the server sent, unpadded")
    func gameDateIsAString() throws {
        let date: Components.Schemas.GameDate = "2026-5-9"
        #expect(type(of: date) == String.self)
        let coverage = try JSONDecoder().decode(
            Components.Schemas.LogCoverage.self,
            from: Data(#"""
                {"firstTransactionDate":"2026-3-26","lastTransactionDate":"2026-5-9","activityThrough":"2026-5-10",\#
                "coveredThrough":null,"season":2026}
                """#.utf8)
        )
        #expect(coverage.lastTransactionDate == "2026-5-9")
        #expect(coverage.activityThrough == "2026-5-10")
        #expect(coverage.coveredThrough == nil)
    }
}
