import Foundation
import HTTPTypes
import OpenAPIRuntime

/// Adds the per-launch token to every request (`Authorization: Bearer <token>`).
///
/// The app makes the token, hands it to the sidecar on stdin, and gives it to this middleware; the server refuses an
/// `/api` request without it (SWIFTUI_REBUILD.md section 5.1).
public struct BearerTokenMiddleware: ClientMiddleware {
    private let token: String

    public init(token: String) {
        self.token = token
    }

    public func intercept(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String,
        next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        var request = request
        request.headerFields[.authorization] = "Bearer \(token)"
        return try await next(request, body, baseURL)
    }
}
