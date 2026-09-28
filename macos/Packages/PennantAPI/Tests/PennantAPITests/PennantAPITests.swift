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

    @Test("an event stream with known events decodes, each to its own shape, read by type and never by position")
    func knownEvents() async throws {
        let events = try await decodedEvents(from: sse([
            ("hello", #"{"type":"hello","status":\#(status)}"#),
            ("import-started", #"{"type":"import-started","startedAt":"2026-09-25T12:00:00.000Z"}"#),
            ("import-progress", #"{"type":"import-progress","progress":{"table":"players","fileIndex":1,"files":70,"rows":1200,"phase":"writing","words":{"phase":"Writing the league","table":"Players","display":"Writing players · 1 of 70"}}}"#),
            ("import-finished", #"{"type":"import-finished","lastImport":null,"error":"No .csv files"}"#),
            ("export-pending", #"{"type":"export-pending","since":"2026-09-25T12:05:00.000Z"}"#),
            ("job", #"{"type":"job","kind":"storylines","orgId":1,"status":{"state":"running","startedAt":"2026-09-25T12:06:00.000Z","finishedAt":null,"error":null}}"#),
            ("front-office-updated", #"{"type":"front-office-updated","orgId":1,"reportStamp":"r2"}"#),
            ("save-played-elsewhere", #"{"type":"save-played-elsewhere","savePlayedElsewhere":null}"#),
        ]))
        #expect(events.count == 8)
        guard case .hello(let hello) = events[0].kind else { Issue.record("hello"); return }
        #expect(hello.status.saveName == "Test League")
        #expect(hello.status.lastImport?.files.first?.table == "players")
        #expect(events[0].hello?.status.saveName == "Test League")
        guard case .importStarted(let started) = events[1].kind else { Issue.record("import-started"); return }
        #expect(started.startedAt == "2026-09-25T12:00:00.000Z")
        guard case .importProgress(let progress) = events[2].kind else { Issue.record("import-progress"); return }
        #expect(progress.progress.phase.value1 == .writing)
        guard case .importFinished(let finished) = events[3].kind else { Issue.record("import-finished"); return }
        #expect(finished.lastImport == nil)
        #expect(finished.error == "No .csv files")
        guard case .exportPending(let pending) = events[4].kind else { Issue.record("export-pending"); return }
        #expect(pending.since == "2026-09-25T12:05:00.000Z")
        guard case .job(let job) = events[5].kind else { Issue.record("job"); return }
        #expect(job.status.state.value1 == .running)
        guard case .frontOfficeUpdated(let updated) = events[6].kind else { Issue.record("front-office-updated"); return }
        #expect(updated.reportStamp == "r2")
        guard case .savePlayedElsewhere(let played) = events[7].kind else { Issue.record("save-played-elsewhere"); return }
        #expect(played.savePlayedElsewhere == nil)
        // Every event also reads as its bare type, which is what a client switches on
        #expect(events.map(\.typeName) == ["hello", "import-started", "import-progress", "import-finished", "export-pending", "job", "front-office-updated", "save-played-elsewhere"])
        // Each event decodes to its own shape only: a hello is not an export-pending
        #expect(events[0].hello != nil && events[4].hello == nil)
    }

    @Test("an event type this build does not know decodes as unknown, and the stream goes on")
    func unknownEvent() async throws {
        let events = try await decodedEvents(from: sse([
            ("desk-changed", #"{"type":"desk-changed","count":3,"items":[{"id":"x"}]}"#),
            ("export-pending", #"{"type":"export-pending","since":"2026-09-25T12:05:00.000Z"}"#),
        ]))
        #expect(events.count == 2)
        let unknown = events[0]
        #expect(unknown.typeName == "desk-changed")
        #expect(unknown.kind == nil)
        guard case .exportPending(let pending) = events[1].kind else { Issue.record("export-pending"); return }
        #expect(pending.since == "2026-09-25T12:05:00.000Z")
    }

    @Test("an enum code this build does not know decodes as its string, never an error")
    func unknownEnumValue() throws {
        let progress = try JSONDecoder().decode(
            Components.Schemas.ImportProgress.self,
            from: Data(#"{"table":"players","fileIndex":1,"files":2,"rows":3,"phase":"verifying","words":{"phase":"Writing the league","table":"Players","display":"Writing players · 1 of 70"},"addedLater":true}"#.utf8)
        )
        #expect(progress.phase.value1 == nil)
        #expect(progress.phase.value2 == "verifying")
        // A known code still reads as the known case
        let known = try JSONDecoder().decode(
            Components.Schemas.ImportProgress.self,
            from: Data(#"{"table":"players","fileIndex":1,"files":2,"rows":3,"phase":"indexing","words":{"phase":"Writing the league","table":"Players","display":"Writing players · 1 of 70"}}"#.utf8)
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

    @Test("a served Claim decodes with its basis: the line, its tone, what is not known, no lean, how it is called")
    func servedClaim() async throws {
        let view = try await jsonClient("getDataStatusWords").getDataStatusWords().ok.body.json
        let claim = view.headline
        #expect(claim.text == "Transaction history unavailable")
        #expect(claim.tone.value1 == .caution)
        #expect(claim.hint?.count ?? 0 <= 75)
        #expect(claim.basis.certainty.value1 == .fact)
        #expect(claim.basis.source.department.value1 == .frontOffice)
        #expect(claim.basis.source.gameDate == "2040-05-06")
        #expect(claim.basis.unknown.isEmpty == false)
        #expect(claim.basis.lean == nil)
        #expect(Array(claim.basis.because.map(\.label).prefix(6)) == ["League data", "Transactions", "OOTP save", "Ratings", "Roster evidence", "How the save was found"])
        #expect(claim.links.isEmpty)
        // A row's sort keys: a string and a number, each read as served
        let league = try #require(view.sources.first)
        #expect(league.sort.source?.value2 == "League data")
        #expect(league.sort.state?.value1 == -2)
        #expect(league.cells.state.tone?.value1 == .caution)
        // A missing value is its sentence, and its sort key is unknown
        let imported = try #require(view.facts.first { $0.id == "imported" })
        #expect(imported.cells.value.display == "Not imported yet")
        #expect(imported.sort.value?.value1 == nil && imported.sort.value?.value2 == nil)
        #expect(view.gameDate.served == "2040-05-06")
        #expect(view.gameDate.display == "May 6, 2040")
    }

    @Test("the catalog decodes: glossary, stats, each club's palette and record, the departments and their heads")
    func catalog() async throws {
        let catalog = try await jsonClient("getCatalog").getCatalog().ok.body.json
        #expect(catalog.glossary.contains { $0.display == "OPS+" })
        #expect(catalog.stats.contains { $0.key == "era" && $0.lowerIsBetter && $0.format.value1 == .dec2 })
        let club = try #require(catalog.clubs.first { $0.isHuman == true })
        #expect(club.palette.dark.accent.hasPrefix("#"))
        #expect(club.record.display == "15–15")
        #expect(club.logo == nil)
        #expect(catalog.departments.map(\.id.value1) == [.frontOffice, .majorLeague, .farm, .scouting, .trades, .finance, .medical, .league, .philosophy])
        let medical = try #require(catalog.departments.first { $0.id.value1 == .medical })
        #expect(medical.head?.role == "Team Doctor")
        #expect(medical.preparedBy.display.hasPrefix("Prepared by "))
        #expect(catalog.departments.first { $0.id.value1 == .farm }?.head == nil)
        #expect(catalog.phrases.missingValue.display == "Not known yet")
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
        let notStarted = try decoder.decode(Components.Schemas.ConfigAccepted.self, from: Data(try fixture("responses/setSave-no-export.json").utf8))
        #expect(notStarted.importStarted == false && notStarted.why != nil)
        #expect(try decoder.decode(Components.Schemas.SettingsSaved.self, from: Data(try fixture("responses/saveSettings-automatic.json").utf8)).settings.defaultOrgId == nil)
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
        guard case .job(let job) = events[4].kind else { Issue.record("job"); return }
        #expect(job.status.state.value1 == .done)
        let orgID: Int = job.orgId
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
        #expect(hello.hello?.status.saveName == "Test League")
        #expect(events[1].reading == .unknown(type: "desk-changed"))
        #expect(events[2].reading == .malformed(type: "hello"))
        #expect(events[2].hello == nil && events[2].kind == nil)
        #expect(events[3].reading == .malformed(type: "import-progress"))
    }

    @Test("the reading knows every event shape the generated union has")
    func readingCoversEveryShape() {
        let names = Components.Schemas.ServerEvent.knownTypeNames
        #expect(names.count == Components.Schemas.ServerEvent.shapeCount)
        #expect(names == ["hello", "import-started", "import-progress", "import-finished", "export-pending", "job", "front-office-updated", "save-played-elsewhere"])
    }

    /// The union holds its members by position, so a new member moves every later one (N3.5 B2 review, item 1): the
    /// accessor reads each by its type. This fails when the generated union gains a shape the accessor has no case for,
    /// and when a shape's position no longer reads as its own kind.
    @Test("the typed accessor covers every shape, whatever its position in the union")
    func typedAccessorCoversEveryShape() async throws {
        #expect(Set(Components.Schemas.ServerEvent.Kind.typeNames) == Components.Schemas.ServerEvent.knownTypeNames)
        #expect(Components.Schemas.ServerEvent.Kind.typeNames.count == Components.Schemas.ServerEvent.shapeCount)
        // Each member set by position reads as its own kind: a shifted member would read as another's
        let event = Components.Schemas.ServerEvent(value5: .init(_type: .exportPending, since: "2026-09-25T12:05:00.000Z"))
        guard case .exportPending(let pending) = event.kind else { Issue.record("value5 is export-pending"); return }
        #expect(pending.since == "2026-09-25T12:05:00.000Z")
        let mirror = Mirror(reflecting: Components.Schemas.ServerEvent())
        #expect(mirror.children.count == Components.Schemas.ServerEvent.shapeCount + 1)
    }

    @Test("the fixtures the save-finding stage and the rating history added decode (N3.5 B2, D-064)")
    func saveFindingFixtures() async throws {
        let discovery = try await jsonClient("getSaveDiscovery").getSaveDiscovery().ok.body.json
        #expect(discovery.saves.count >= 1)
        let saves = try await jsonClient("listSaves").listSaves().ok.body.json
        let first = try #require(saves.first)
        #expect(first.id?.isEmpty == false)
        #expect(first.hasExport != nil)
        #expect(first.ootpVersion == 27)
        let status = try await jsonClient("getStatus").getStatus().ok.body.json
        #expect(status.savePlayedElsewhere == nil)
        #expect(status.saveId == nil)
        let configured = try await jsonClient("getStatus-configured").getStatus().ok.body.json
        // Chosen but not imported: the imported data is not that save's, so no id is served (N6 B1 review M4)
        #expect(configured.configured && configured.saveId == nil)
        let decoder = JSONDecoder()
        let nothing = try decoder.decode(Components.Schemas.AutomaticSetup.self, from: Data(try fixture("responses/setUpAutomatically-nothing-stands-out.json").utf8))
        #expect(nothing.outcome.value1 == .nothingStandsOut)
        for name in ["getRatingHistory", "getRatingHistory-offer"] {
            _ = try decoder.decode(Components.Schemas.RatingHistoryView.self, from: Data(try fixture("responses/\(name).json").utf8))
        }
        for name in ["answerRatingHistoryOffer-adopt", "answerRatingHistoryOffer-undo"] {
            _ = try decoder.decode(Components.Schemas.RatingHistoryView.self, from: Data(try fixture("responses/\(name).json").utf8))
        }
        // An answer the server refuses (no choice, nothing to answer) is its sentence
        for name in ["answerRatingHistoryOffer-no-choice", "answerRatingHistoryOffer-nothing-to-answer"] {
            #expect(try decoder.decode(Components.Schemas.ApiError.self, from: Data(try fixture("responses/\(name).json").utf8)).error.isEmpty == false)
        }
        // The event the minute's look sends when another save has been played since (N6, Stage B1)
        let events = try await decodedEvents(from: try fixture("events-save-played-elsewhere.sse"))
        #expect(events.count == 1)
        guard case .savePlayedElsewhere(let played) = events[0].kind else { Issue.record("save-played-elsewhere"); return }
        let notice = try #require(played.savePlayedElsewhere)
        #expect(notice.kind.value1 == .otherSave)
        #expect(notice.actionText == "Switch to Played Since")
        #expect(notice.save.id == "saveid")
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
