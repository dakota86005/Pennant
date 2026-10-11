import Foundation
import Observation
import OpenAPIRuntime
import PennantAPI

/// The Staff room (N13, D-074): who can be asked (`GET /api/v2/staff-room/:org`), each conversation as the server keeps
/// it per club (`…/conversation?with=`), a question answered as a stream (`POST …/ask`), Stop and Start over. Every word
/// is the server's: the store holds what was served, the answer streaming in (`StaffRoomAnswer`), and why a question
/// was not taken, in the server's sentence. The AI decides nothing; nothing here reads its text.
@Observable @MainActor
public final class StaffRoomStore {
    public typealias Conversation = Components.Schemas.StaffRoomConversation

    public private(set) var view: Components.Schemas.StaffRoomView?
    public private(set) var viewProblem: RequestProblem?
    /// Each conversation as last read, by who it is with (`analyst`, `room`).
    public private(set) var conversations: [String: Conversation] = [:]
    public private(set) var conversationProblems: [String: RequestProblem] = [:]
    /// The answer streaming now, or the last one until the conversation read after it lands, per conversation.
    public private(set) var answers: [String: StaffRoomAnswer] = [:]
    /// How the last answer failed, in the server's words, until the next question (the partial answer is kept in the
    /// conversation); per conversation.
    public private(set) var failures: [String: Components.Schemas.StaffRoomFailedEvent] = [:]
    /// Why a question or Start over was refused (no question, AI off, already answering), in the server's sentence.
    public private(set) var askProblems: [String: RequestProblem] = [:]
    /// The served "Started over with …" line, until the next question.
    public private(set) var startedOver: [String: Components.Schemas.Cell] = [:]

    private var tasks: [String: Task<Void, Never>] = [:]
    private var loadedViewKey: AppModel.StoreKey?
    private var loadedKeysRevision = 0
    private var askedViewKey: AppModel.StoreKey?
    private var conversationKeys: [String: AppModel.StoreKey] = [:]
    private var following = FollowedKey()
    /// The question under way in each conversation, by its number: the stream, its end and the read after it act only
    /// while their question is still this one (Stop, or another question, moves it on; review N13B, H1 and M1).
    private var asking: [String: Int] = [:]
    private var asked = 0
    private let log: @MainActor (String) -> Void

    public init(log: @escaping @MainActor (String) -> Void = { _ in }) {
        self.log = log
    }

    /// Whether an answer is streaming in this conversation.
    public func isAnswering(_ with: String) -> Bool { answers[with]?.outcome.isRunning ?? false }

    /// Follows the app's key: another save or club drops everything at once (another club's conversation is never
    /// drawn), stopping any answer under way; a new import or Front Office build of the same club keeps it, and an
    /// answer under way goes on. Returns false for a key the store has moved past (a stale call, which does nothing).
    @discardableResult
    public func follow(_ key: AppModel.StoreKey?) -> Bool {
        guard let key else { return false }
        switch following.follow(key) {
        case .older: return false
        case .first, .same, .newer: return true
        case .otherScope: break
        }
        for task in tasks.values { task.cancel() }
        tasks = [:]
        asking = [:]
        view = nil
        viewProblem = nil
        conversations = [:]
        conversationProblems = [:]
        answers = [:]
        failures = [:]
        askProblems = [:]
        startedOver = [:]
        loadedViewKey = nil
        conversationKeys = [:]
        return true
    }

    // MARK: Reading

    /// Who can be asked, once per key and AI keys' revision (a key added or removed turns AI on or off).
    public func loadView(client: Client?, key: AppModel.StoreKey?, keysRevision: Int) async {
        guard let client, let key, follow(key) else { return }
        if loadedViewKey == key, loadedKeysRevision == keysRevision { return }
        askedViewKey = key
        do {
            switch try await client.getStaffRoom(path: .init(org: FrontOfficeStore.org(key))) {
            case .ok(let answer):
                let served = try answer.body.json
                guard askedViewKey == key else { return }
                view = served
                viewProblem = nil
                loadedViewKey = key
                loadedKeysRevision = keysRevision
            case .notFound(let refused):
                viewProblem = .served(try refused.body.json.error)
            case .undocumented(let code, let payload):
                viewProblem = await .undocumented(code, body: payload.body, operation: "getStaffRoom", fromV2: true)
            }
        } catch {
            guard !RequestProblem.isCancellation(error) else { return }
            let problem = RequestProblem.from(error)
            viewProblem = problem
            if let detail = problem.detail { log("could not read the Staff room: \(detail)") }
        }
    }

    /// One conversation, once per key (again when `force`: after an answer, Stop or a change elsewhere).
    public func loadConversation(_ with: String, client: Client?, key: AppModel.StoreKey?, force: Bool = false) async {
        guard let client, let key, follow(key) else { return }
        if !force, conversationKeys[with] == key, conversations[with] != nil { return }
        do {
            switch try await client.getStaffConversation(path: .init(org: FrontOfficeStore.org(key)), query: .init(with: with)) {
            case .ok(let answer):
                let served = try answer.body.json
                guard following.key == key else { return }
                conversations[with] = served
                conversationKeys[with] = key
                conversationProblems[with] = nil
                // The kept conversation now holds what streamed: the live copy goes, unless another answer has started,
                // or a stopped answer's words are not in it yet (the server keeps them when it sees the app stop
                // listening, which can come after this read): they stay on screen until a read holds them
                if let live = answers[with], !live.outcome.isRunning, !Self.awaitsKeeping(live, in: served) { answers[with] = nil }
            case .notFound(let refused):
                conversationProblems[with] = .served(try refused.body.json.error)
            case .undocumented(let code, let payload):
                conversationProblems[with] = await .undocumented(code, body: payload.body, operation: "getStaffConversation", fromV2: true)
            }
        } catch {
            guard !RequestProblem.isCancellation(error) else { return }
            let problem = RequestProblem.from(error)
            conversationProblems[with] = problem
            if let detail = problem.detail { log("could not read a Staff room conversation: \(detail)") }
        }
    }

    /// Whether a stopped answer has words the conversation read does not hold yet.
    static func awaitsKeeping(_ live: StaffRoomAnswer, in conversation: Conversation) -> Bool {
        guard live.outcome == .stopped else { return false }
        let kept = Set(conversation.messages.map(\.id))
        return live.messages.contains { !$0.streamed.isEmpty && !kept.contains($0.id) }
    }

    // MARK: Asking

    /// What to ask: the GM's words as typed, or a player dragged in (the server words that question).
    public enum Question: Sendable, Equatable {
        case typed(String)
        case about(playerId: Int)
    }

    /// Asks one person or the room; the answer streams into `answers[with]`. Refused at once (with nothing sent) while
    /// an answer is streaming in that conversation; the server's refusals arrive as its sentence in `askProblems`.
    /// Returns whether the question was sent.
    @discardableResult
    public func ask(_ question: Question, with: String, members: [String]?, client: Client?, key: AppModel.StoreKey?) -> Bool {
        guard let client, let key, !isAnswering(with) else { return false }
        if case .typed(let words) = question, words.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return false }
        guard follow(key) else { return false }
        asked += 1
        let ask = asked
        asking[with] = ask
        askProblems[with] = nil
        failures[with] = nil
        startedOver[with] = nil
        answers[with] = StaffRoomAnswer()
        let body: Components.Schemas.StaffRoomAsk = switch question {
        case .typed(let words): .init(with: with, question: words, members: members)
        case .about(let id): .init(with: with, about: .init(playerId: id), members: members)
        }
        tasks[with] = Task { [weak self] in
            await self?.stream(body, with: with, ask: ask, client: client, key: key)
        }
        return true
    }

    /// Stops the answer streaming in a conversation: it ends at once here, and what had arrived is kept on the server
    /// (the conversation is read again).
    public func stop(_ with: String, client: Client?, key: AppModel.StoreKey?) {
        guard isAnswering(with) else { return }
        answers[with]?.end(stopped: true)
        tasks[with]?.cancel()
        tasks[with] = nil
        // The stopped question's task ends on its own: nothing it does after this reaches the next question's answer
        asking[with] = nil
        Task { await loadConversation(with, client: client, key: key, force: true) }
    }

    /// Whether a question is still the one under way in its conversation, for the club and save it was asked about.
    private func isCurrent(_ ask: Int, with: String, scope: AppModel.StoreKey.Scope) -> Bool {
        asking[with] == ask && following.key?.scope == scope
    }

    private func stream(_ body: Components.Schemas.StaffRoomAsk, with: String, ask: Int, client: Client, key: AppModel.StoreKey) async {
        let org = FrontOfficeStore.org(key)
        let scope = key.scope
        do {
            let problem: RequestProblem
            switch try await client.askStaffRoom(path: .init(org: org), body: .json(body)) {
            case .ok(let answer):
                try await StaffRoomStream.read(try answer.body.textEventStream) { [weak self] reading in
                    guard let self, self.isCurrent(ask, with: with, scope: scope) else { return }
                    self.answers[with]?.apply(reading)
                    if case .malformed(let type) = reading { self.log("a Staff room event of type \(type) did not decode") }
                }
                guard isCurrent(ask, with: with, scope: scope) else { return }
                end(with, stopped: Task.isCancelled)
                await readAfterAnswer(with, client: client, scope: scope)
                return
            case .badRequest(let refused): problem = .served(try refused.body.json.error)
            case .notFound(let refused): problem = .served(try refused.body.json.error)
            case .conflict(let refused): problem = .served(try refused.body.json.error)
            case .undocumented(let code, let payload):
                problem = await .undocumented(code, body: payload.body, operation: "askStaffRoom", fromV2: true)
            }
            guard isCurrent(ask, with: with, scope: scope) else { return }
            // Refused before anything was asked: nothing streamed, the question stays the GM's to send again
            answers[with] = nil
            askProblems[with] = problem
            tasks[with] = nil
            asking[with] = nil
        } catch {
            guard isCurrent(ask, with: with, scope: scope) else { return }
            let stopped = RequestProblem.isCancellation(error) || Task.isCancelled
            if !stopped {
                let problem = RequestProblem.from(error)
                askProblems[with] = problem
                if let detail = problem.detail { log("the Staff room's answer stopped: \(detail)") }
            }
            end(with, stopped: stopped)
            await readAfterAnswer(with, client: client, scope: scope)
        }
    }

    /// The conversation read again once an answer ends, under the key followed now (a new import or build may have
    /// come while it streamed), never the one the question was asked under.
    private func readAfterAnswer(_ with: String, client: Client, scope: AppModel.StoreKey.Scope) async {
        guard let key = following.key, key.scope == scope else { return }
        await loadConversation(with, client: client, key: key, force: true)
    }

    private func end(_ with: String, stopped: Bool) {
        answers[with]?.end(stopped: stopped)
        switch answers[with]?.outcome {
        case .failed(let failed)?:
            failures[with] = failed
        case .dropped?:
            // Ended with neither `done` nor `failed` (the connection dropped, the server stopped): a failure, said as one,
            // with what had arrived kept on screen until the conversation is read again
            if askProblems[with] == nil { askProblems[with] = .unreachable(detail: "the answer stream ended before its last event") }
        default:
            break
        }
        tasks[with] = nil
        asking[with] = nil
    }

    /// Starts the conversation over (the server empties it, as the React chat's Start over does). Refused while it is
    /// answering, in the server's sentence.
    public func startOver(_ with: String, client: Client?, key: AppModel.StoreKey?) async {
        guard let client, let key, !isAnswering(with), follow(key) else { return }
        do {
            let problem: RequestProblem
            switch try await client.clearStaffConversation(path: .init(org: FrontOfficeStore.org(key)), query: .init(with: with)) {
            case .ok(let answer):
                let cleared = try answer.body.json
                guard following.key?.scope == key.scope else { return }
                conversations[with] = cleared.conversation
                conversationKeys[with] = key
                answers[with] = nil
                failures[with] = nil
                askProblems[with] = nil
                startedOver[with] = cleared.done
                return
            case .notFound(let refused): problem = .served(try refused.body.json.error)
            case .conflict(let refused): problem = .served(try refused.body.json.error)
            case .undocumented(let code, let payload):
                problem = await .undocumented(code, body: payload.body, operation: "clearStaffConversation", fromV2: true)
            }
            askProblems[with] = problem
        } catch {
            guard !RequestProblem.isCancellation(error) else { return }
            let problem = RequestProblem.from(error)
            askProblems[with] = problem
            if let detail = problem.detail { log("could not start the conversation over: \(detail)") }
        }
    }

    /// Waits for the answer streaming in a conversation to end (tests).
    public func settle(_ with: String) async {
        await tasks[with]?.value
    }

    #if DEBUG
    /// A store holding served payloads, for `#Preview`s and snapshots.
    public static func preview(
        view: Components.Schemas.StaffRoomView?,
        conversations: [Conversation] = [],
        answer: StaffRoomAnswer? = nil,
        failure: Components.Schemas.StaffRoomFailedEvent? = nil,
        askProblem: RequestProblem? = nil
    ) -> StaffRoomStore {
        let store = StaffRoomStore()
        store.view = view
        for conversation in conversations { store.conversations[conversation.with] = conversation }
        if let with = conversations.first?.with {
            store.answers[with] = answer
            store.failures[with] = failure
            store.askProblems[with] = askProblem
        }
        return store
    }
    #endif
}

extension AppModel {
    /// The Staff room for the current key (who can be asked, and whether AI is on).
    public func loadStaffRoom() async {
        await staffRoom.loadView(client: client, key: storeKey, keysRevision: keysRevision)
    }

    /// One conversation for the current key.
    public func loadStaffConversation(_ with: String, force: Bool = false) async {
        await staffRoom.loadConversation(with, client: client, key: storeKey, force: force)
    }

    /// Asks the Staff room; the answer streams in.
    @discardableResult
    public func askStaff(_ question: StaffRoomStore.Question, with: String, members: [String]?) -> Bool {
        staffRoom.ask(question, with: with, members: members, client: client, key: storeKey)
    }

    /// Stops the answer streaming in a conversation.
    public func stopStaff(_ with: String) {
        staffRoom.stop(with, client: client, key: storeKey)
    }

    /// Starts a conversation over.
    public func startStaffOver(_ with: String) async {
        await staffRoom.startOver(with, client: client, key: storeKey)
    }
}
