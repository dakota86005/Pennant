import Foundation
import OpenAPIRuntime
import PennantAPI

/// One question to the Staff room as it is answered (N13, D-074): the GM's question as the server kept it, then each
/// person's answer as it streams in (the deltas, the "looking up" steps, then the final text with its links, which
/// replaces what streamed), any notice, and how it ended. Built only from the served events, in order; exactly one
/// `done` or `failed` ends it, and nothing after that changes it. Holds no word of its own.
public struct StaffRoomAnswer: Sendable, Equatable {
    public typealias Message = Components.Schemas.StaffRoomMessage

    /// One person's answer while it streams.
    public struct Live: Sendable, Equatable, Identifiable {
        public let id: String
        public var speaker: Components.Schemas.Cell?
        /// The deltas so far, in the served subset (links come only with `final`).
        public var streamed: String
        public var lookedUp: [Components.Schemas.Cell]
        /// The message as kept, from `answered` (or a failure's partial): drawn instead of `streamed` once here.
        public var final: Message?
    }

    /// How the answer ended; `running` until the stream's last event.
    public enum Outcome: Sendable, Equatable {
        case running
        case done(Components.Schemas.StaffRoomDoneEvent)
        case failed(Components.Schemas.StaffRoomFailedEvent)
        /// The connection ended before a `done` or `failed` (the server stopped, the app stopped listening): what had
        /// arrived is kept on the server, and the conversation is read again.
        case dropped
        /// The GM stopped it.
        case stopped

        public var isRunning: Bool { self == .running }
    }

    public private(set) var question: Message?
    public private(set) var answering: [String] = []
    public private(set) var messages: [Live] = []
    public private(set) var notices: [Components.Schemas.Cell] = []
    public private(set) var outcome: Outcome = .running
    /// Events this build does not know, skipped (a newer server's).
    public private(set) var skipped = 0
    /// Known event types whose payload did not decode.
    public private(set) var malformed: [String] = []
    /// Events that came after the stream had ended, and were ignored.
    public private(set) var afterTheEnd = 0
    /// Counts the answers completed, so a view can announce each once.
    public private(set) var answeredCount = 0

    public init() {}

    /// The kept answer of the message just completed, for VoiceOver.
    public var lastAnswered: Message? { messages.last(where: { $0.final != nil })?.final }

    /// Applies one event read off the stream; false when it was ignored because the stream had already ended.
    @discardableResult
    public mutating func apply(_ reading: StaffRoomEventReading) -> Bool {
        guard outcome.isRunning else {
            afterTheEnd += 1
            return false
        }
        switch reading {
        case .unknown:
            skipped += 1
        case .malformed(let type):
            malformed.append(type)
        case .known(let kind):
            apply(kind)
        }
        return true
    }

    private mutating func apply(_ kind: Components.Schemas.StaffRoomEvent.Kind) {
        switch kind {
        case .started(let started):
            question = started.question
            answering = started.answering
        case .speaker(let speaker):
            update(speaker.messageId) { $0.speaker = speaker.speaker }
        case .lookingUp(let step):
            update(step.messageId) { $0.lookedUp.append(step.step) }
        case .text(let text):
            update(text.messageId) { $0.streamed += text.delta }
        case .notice(let notice):
            notices.append(notice.notice)
        case .answered(let answered):
            update(answered.message.id) { live in
                live.final = answered.message
                if live.speaker == nil { live.speaker = answered.message.speaker }
            }
            answeredCount += 1
        case .done(let done):
            outcome = .done(done)
        case .failed(let failed):
            if let partial = failed.partial {
                update(partial.id) { live in
                    live.final = partial
                    if live.speaker == nil { live.speaker = partial.speaker }
                }
            }
            outcome = .failed(failed)
        }
    }

    /// The connection ended: dropped unless a last event already came, or the GM stopped it.
    public mutating func end(stopped: Bool) {
        guard outcome.isRunning else { return }
        outcome = stopped ? .stopped : .dropped
    }

    private mutating func update(_ id: String, _ change: (inout Live) -> Void) {
        if let index = messages.firstIndex(where: { $0.id == id }) {
            change(&messages[index])
        } else {
            var live = Live(id: id, speaker: nil, streamed: "", lookedUp: [], final: nil)
            change(&live)
            messages.append(live)
        }
    }
}

/// Reads a Staff room answer stream (`text/event-stream`, each event's data a JSON `StaffRoomEvent`) to its end,
/// passing each event on as read. Stops reading after the last event (`done` or `failed`); throws what the connection
/// threw. A cancelled task (the GM stopped it) ends the read. The handler is synchronous on purpose: an async closure
/// called from a loop aborted the task allocator on macOS 26's runtime (PR #57); the read runs on its caller's actor.
public enum StaffRoomStream {
    public static func read(_ body: HTTPBody, _ handle: (StaffRoomEventReading) -> Void) async throws {
        let events = body.asDecodedServerSentEventsWithJSONData(of: Components.Schemas.StaffRoomEvent.self)
        for try await message in events {
            try Task.checkCancellation()
            guard let event = message.data else { continue }
            let reading = event.reading
            handle(reading)
            if case .known(let kind) = reading, kind.isTerminal { return }
        }
    }
}
