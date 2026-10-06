import Foundation
import OpenAPIRuntime
import PennantAPI

/// What the event stream told the app.
public enum EventSignal: Sendable, Equatable {
    /// The stream opened (a `hello` follows).
    case connected
    /// An event this build knows, decoded.
    case event(Components.Schemas.ServerEvent)
    /// An event whose type this build knows but whose payload did not decode: report it and re-read
    /// `/api/status` (SWIFTUI_REBUILD.md section 4.3). Never ignored.
    case malformed(type: String)
    /// The stream ended or failed; the client reconnects after a pause.
    case disconnected
}

/// Listens to `GET /api/v2/events` (server-sent events) and reconnects when the stream drops while the server is
/// up. An event is a nudge to re-read, never a second source of truth: every connection opens with a `hello`
/// carrying the status, so a gap is closed by the next connection.
///
/// Known events are passed on; an event type this build has never heard of is ignored (a newer server may send
/// it); a known type that did not decode is passed on as `malformed`. A connection that fails or ends is logged
/// (`onError`) and retried after a wait that doubles from `reconnectDelay` up to `maxReconnectDelay` while connecting
/// keeps failing, and starts again from `reconnectDelay` after a connection that opened.
public struct EventClient: Sendable {
    public let client: Client
    public var reconnectDelay: Duration
    public var maxReconnectDelay: Duration
    /// Called for an unknown event type (for the log only).
    public var onUnknown: @Sendable (String) -> Void
    /// Called when a connection fails or ends (for the log only).
    public var onError: @Sendable (String) -> Void
    /// Waits between attempts: the clock's own sleep; a test hands its own to read the waits without waiting.
    public var sleep: @Sendable (Duration) async -> Void

    public init(
        client: Client,
        reconnectDelay: Duration = .seconds(1),
        maxReconnectDelay: Duration = .seconds(10),
        onUnknown: @escaping @Sendable (String) -> Void = { _ in },
        onError: @escaping @Sendable (String) -> Void = { _ in },
        sleep: @escaping @Sendable (Duration) async -> Void = { try? await Task.sleep(for: $0) }
    ) {
        self.client = client
        self.reconnectDelay = reconnectDelay
        self.maxReconnectDelay = maxReconnectDelay
        self.onUnknown = onUnknown
        self.onError = onError
        self.sleep = sleep
    }

    /// The wait before the next attempt after `failures` attempts in a row that did not connect (1-based).
    public func delay(afterFailures failures: Int) -> Duration {
        var delay = reconnectDelay
        for _ in 1..<max(failures, 1) {
            delay *= 2
            if delay >= maxReconnectDelay { return maxReconnectDelay }
        }
        return min(delay, maxReconnectDelay)
    }

    /// Reads one connection to its end, passing each event on. Throws what the connection threw.
    ///
    /// The stream is read as fast as it arrives, apart from passing events on: while the app is busy with one (on the
    /// main actor), the next ones wait in a queue, and an import's progress that a later import event has already
    /// overtaken is dropped (`superseded`), so a busy app never works through a backlog of stale progress before it
    /// hears that the import finished. Every other event is passed on, in order.
    public func readOnce(_ handle: (EventSignal) async -> Void) async throws {
        let response = try await client.streamEvents()
        let events = try response.ok.body.textEventStream
            .asDecodedServerSentEventsWithJSONData(of: Components.Schemas.ServerEvent.self)
        await handle(.connected)
        let queue = SignalQueue()
        let onUnknown = onUnknown
        let reader = Task {
            do {
                for try await message in events {
                    guard let event = message.data else { continue }
                    switch event.reading {
                    case .known:
                        await queue.append(.event(event))
                    case .unknown(let type):
                        onUnknown(type)
                    case .malformed(let type):
                        await queue.append(.malformed(type: type))
                    }
                }
                await queue.finish(nil)
            } catch {
                await queue.finish(error)
            }
        }
        try await withTaskCancellationHandler {
            while let batch = try await queue.drain() {
                for signal in Self.superseded(batch) {
                    if Task.isCancelled { return }
                    await handle(signal)
                }
            }
        } onCancel: {
            reader.cancel()
            Task { await queue.finish(CancellationError()) }
        }
    }

    /// The signals of a batch read while the app was busy, without an import's progress that a later import event in
    /// the batch overtook (a later progress, a new start, or the finish). Everything else stays, in order.
    public static func superseded(_ batch: [EventSignal]) -> [EventSignal] {
        func isImport(_ signal: EventSignal) -> Bool {
            guard case .event(let event) = signal else { return false }
            switch event.kind {
            case .importStarted, .importProgress, .importFinished: return true
            default: return false
            }
        }
        func isProgress(_ signal: EventSignal) -> Bool {
            guard case .event(let event) = signal, case .importProgress = event.kind else { return false }
            return true
        }
        return batch.enumerated().compactMap { index, signal in
            if isProgress(signal), batch[(index + 1)...].contains(where: isImport) { return nil }
            return signal
        }
    }

    /// Connects, reads, and connects again after a wait whenever the stream ends, until the task is cancelled (the
    /// app cancels it when the server stops; nothing is passed on after that).
    public func run(_ handle: (EventSignal) async -> Void) async {
        var failures = 0
        while !Task.isCancelled {
            var connected = false
            do {
                try await readOnce { signal in
                    if signal == .connected { connected = true }
                    await handle(signal)
                }
                if Task.isCancelled { return }
                onError("the event stream ended")
            } catch {
                if Task.isCancelled { return }
                onError("the event stream failed: \(RequestProblem.logLine(error))")
            }
            failures = connected ? 1 : failures + 1
            await handle(.disconnected)
            await sleep(delay(afterFailures: failures))
        }
    }
}

/// The signals read off one connection, waiting to be passed on: the reader appends as they arrive, and the app takes
/// all that are waiting at once.
actor SignalQueue {
    private var pending: [EventSignal] = []
    private var ended = false
    private var failure: (any Error)?
    private var waiter: CheckedContinuation<Void, Never>?

    func append(_ signal: EventSignal) {
        guard !ended else { return }
        pending.append(signal)
        wake()
    }

    /// The stream ended, or failed with `error`.
    func finish(_ error: (any Error)?) {
        guard !ended else { return }
        ended = true
        failure = error
        wake()
    }

    private func wake() {
        waiter?.resume()
        waiter = nil
    }

    /// Everything waiting, once something is; nil when the stream ended and everything was taken; throws what the
    /// stream failed with, after everything read before it was taken.
    func drain() async throws -> [EventSignal]? {
        while pending.isEmpty && !ended {
            await withCheckedContinuation { waiter = $0 }
        }
        if !pending.isEmpty {
            defer { pending = [] }
            return pending
        }
        if let failure { throw failure }
        return nil
    }
}
