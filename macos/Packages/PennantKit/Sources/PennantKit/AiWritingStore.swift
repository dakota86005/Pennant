import Foundation
import Observation
import OpenAPIRuntime
import PennantAPI

/// Storylines and the GM Briefing (N13, D-074): the writing as served (`GET /api/v2/storylines/:org`,
/// `/api/v2/briefing/:org`), with where it stands (never written, writing, written, failed), and a new one asked for
/// (`POST`, which answers at once, writing). The server's `job` event says when the writing ends; the store reads the
/// piece again then, and never polls. Every word is the server's; the AI decides nothing.
@Observable @MainActor
public final class AiWritingStore {
    /// The two pieces of AI writing, by the job kind the server names them with (`storylines`, `briefing`).
    public enum Piece: String, Sendable, CaseIterable {
        case storylines
        case briefing
    }

    public private(set) var storylines: Components.Schemas.StorylinesView?
    public private(set) var briefing: Components.Schemas.BriefingView?
    /// Why a read or a request to write failed, in the server's sentence when it said one; per piece.
    public private(set) var problems: [Piece: RequestProblem] = [:]
    /// A request to write is on its way.
    public private(set) var requesting: Set<Piece> = []

    private var loadedKeys: [Piece: AppModel.StoreKey] = [:]
    private var loadedRevisions: [Piece: Int] = [:]
    private var followedKey: AppModel.StoreKey?
    private let log: @MainActor (String) -> Void

    public init(log: @escaping @MainActor (String) -> Void = { _ in }) {
        self.log = log
    }

    /// The piece's status as served (whichever piece), for the views that draw either.
    public func status(_ piece: Piece) -> Components.Schemas.AiWritingStatus? {
        switch piece {
        case .storylines: storylines.map(Self.status)
        case .briefing: briefing.map(Self.status)
        }
    }

    /// Another save or club drops both at once.
    public func follow(_ key: AppModel.StoreKey?) {
        guard let key else { return }
        defer { followedKey = key }
        guard let last = followedKey, last.saveId != key.saveId || last.club != key.club else { return }
        storylines = nil
        briefing = nil
        problems = [:]
        loadedKeys = [:]
        loadedRevisions = [:]
    }

    /// A piece for the key, once per key and AI keys' revision; again when `force` (the job ended).
    public func load(_ piece: Piece, client: Client?, key: AppModel.StoreKey?, keysRevision: Int, force: Bool = false) async {
        guard let client, let key else { return }
        follow(key)
        if !force, loadedKeys[piece] == key, loadedRevisions[piece] == keysRevision { return }
        let org = FrontOfficeStore.org(key)
        do {
            switch piece {
            case .storylines:
                switch try await client.getStorylines(path: .init(org: org)) {
                case .ok(let answer):
                    let served = try answer.body.json
                    guard followedKey == key else { return }
                    storylines = served
                    loaded(piece, key: key, revision: keysRevision)
                case .notFound(let refused):
                    problems[piece] = .served(try refused.body.json.error)
                case .undocumented(let code, let payload):
                    problems[piece] = await .undocumented(code, body: payload.body, operation: "getStorylines", fromV2: true)
                }
            case .briefing:
                switch try await client.getBriefing(path: .init(org: org)) {
                case .ok(let answer):
                    let served = try answer.body.json
                    guard followedKey == key else { return }
                    briefing = served
                    loaded(piece, key: key, revision: keysRevision)
                case .notFound(let refused):
                    problems[piece] = .served(try refused.body.json.error)
                case .undocumented(let code, let payload):
                    problems[piece] = await .undocumented(code, body: payload.body, operation: "getBriefing", fromV2: true)
                }
            }
        } catch {
            guard !RequestProblem.isCancellation(error) else { return }
            let problem = RequestProblem.from(error)
            problems[piece] = problem
            if let detail = problem.detail { log("could not read the \(piece.rawValue): \(detail)") }
        }
    }

    /// Asks for a new piece; the server answers at once with it writing (or why it can't, in its sentence).
    public func write(_ piece: Piece, client: Client?, key: AppModel.StoreKey?) async {
        guard let client, let key, !requesting.contains(piece) else { return }
        follow(key)
        requesting.insert(piece)
        defer { requesting.remove(piece) }
        let org = FrontOfficeStore.org(key)
        do {
            let problem: RequestProblem
            switch piece {
            case .storylines:
                switch try await client.writeStorylines(path: .init(org: org)) {
                case .ok(let answer):
                    let served = try answer.body.json
                    guard followedKey == key else { return }
                    storylines = served
                    problems[piece] = nil
                    return
                case .notFound(let refused): problem = .served(try refused.body.json.error)
                case .conflict(let refused): problem = .served(try refused.body.json.error)
                case .undocumented(let code, let payload):
                    problem = await .undocumented(code, body: payload.body, operation: "writeStorylines", fromV2: true)
                }
            case .briefing:
                switch try await client.writeBriefing(path: .init(org: org)) {
                case .ok(let answer):
                    let served = try answer.body.json
                    guard followedKey == key else { return }
                    briefing = served
                    problems[piece] = nil
                    return
                case .notFound(let refused): problem = .served(try refused.body.json.error)
                case .conflict(let refused): problem = .served(try refused.body.json.error)
                case .undocumented(let code, let payload):
                    problem = await .undocumented(code, body: payload.body, operation: "writeBriefing", fromV2: true)
                }
            }
            problems[piece] = problem
        } catch {
            guard !RequestProblem.isCancellation(error) else { return }
            let problem = RequestProblem.from(error)
            problems[piece] = problem
            if let detail = problem.detail { log("could not ask for the \(piece.rawValue): \(detail)") }
        }
    }

    private func loaded(_ piece: Piece, key: AppModel.StoreKey, revision: Int) {
        loadedKeys[piece] = key
        loadedRevisions[piece] = revision
        problems[piece] = nil
    }

    /// The status fields every piece of writing carries.
    static func status(_ view: Components.Schemas.StorylinesView) -> Components.Schemas.AiWritingStatus {
        .init(
            state: view.state, status: view.status, older: view.older, write: view.write, canWrite: view.canWrite,
            notice: view.notice, written: view.written, ai: view.ai, writingStamp: view.writingStamp
        )
    }

    static func status(_ view: Components.Schemas.BriefingView) -> Components.Schemas.AiWritingStatus {
        .init(
            state: view.state, status: view.status, older: view.older, write: view.write, canWrite: view.canWrite,
            notice: view.notice, written: view.written, ai: view.ai, writingStamp: view.writingStamp
        )
    }

    #if DEBUG
    /// A store holding served payloads, for `#Preview`s and snapshots.
    public static func preview(
        storylines: Components.Schemas.StorylinesView? = nil,
        briefing: Components.Schemas.BriefingView? = nil
    ) -> AiWritingStore {
        let store = AiWritingStore()
        store.storylines = storylines
        store.briefing = briefing
        return store
    }
    #endif
}

extension AppModel {
    /// A piece of AI writing for the current key.
    public func loadWriting(_ piece: AiWritingStore.Piece) async {
        await writing.load(piece, client: client, key: storeKey, keysRevision: keysRevision)
    }

    /// Asks for a new piece of AI writing.
    public func writeAgain(_ piece: AiWritingStore.Piece) async {
        await writing.write(piece, client: client, key: storeKey)
    }
}
