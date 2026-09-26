import Foundation
import OpenAPIRuntime
import Testing
@testable import PennantKit

/// What a window says when a request fails (review S2): the server's sentence only where the server writes one (a `/v2`
/// route's `ApiError`); a reused route's undocumented answer, whose `error` is a raw exception message, is a failure kind
/// with the text kept for the log and the help tag.
@Suite("A failed request's words")
struct RequestProblemTests {
    @Test("a /v2 route's undocumented answer shows the server's sentence")
    func v2Sentence() async {
        let body = HTTPBody(#"{"error":"Pennant couldn't put this together. The details are in the server log.","detail":"no such table: x"}"#)
        let problem = await RequestProblem.undocumented(500, body: body, operation: "getCatalog", fromV2: true)
        #expect(problem == .served("Pennant couldn't put this together. The details are in the server log."))
    }

    @Test("a reused route's raw 500 message is never shown as a sentence; it stays in the detail")
    func legacyRaw() async {
        let body = HTTPBody(#"{"error":"EACCES: permission denied, open '/Users/x/config.json'"}"#)
        let problem = await RequestProblem.undocumented(500, body: body, operation: "setSave", fromV2: false)
        guard case .failed(let detail) = problem else {
            Issue.record("expected a failure kind, got \(problem)")
            return
        }
        #expect(detail.contains("EACCES"))
        #expect(detail.contains("setSave"))
    }

    @Test("an answer with no readable body is a failure kind either way")
    func noBody() async {
        for fromV2 in [true, false] {
            let problem = await RequestProblem.undocumented(502, body: HTTPBody("<html>"), operation: "getCatalog", fromV2: fromV2)
            guard case .failed = problem else {
                Issue.record("expected a failure kind")
                continue
            }
        }
    }
}
