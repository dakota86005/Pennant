import Foundation
import OpenAPIRuntime
import PennantAPI
import Testing
@testable import PennantKit

/// The event client on the events the real server streamed (`contract/fixtures/events.sse`), and on the three
/// readings: known events pass, an unknown type is ignored, a known type that did not decode is reported.
@Suite("The event client")
struct EventClientTests {
    private func client(_ transport: RoutedTransport) -> Client {
        PennantClient.make(port: 51_000, token: String(repeating: "t", count: 64), transport: transport)
    }

    @Test("the captured stream passes every event on as known, after connecting")
    func capturedStream() async throws {
        let sse = try String(decoding: fixtureData("events.sse"), as: UTF8.self)
        let transport = RoutedTransport(["/api/v2/events": RoutedTransport.sse(sse)])
        let collected = SignalLog()
        try await EventClient(client: client(transport)).readOnce { collected.append($0) }
        let signals = collected.signals
        #expect(signals.first == .connected)
        let types = signals.compactMap { signal -> String? in
            if case .event(let event) = signal { event.typeName } else { nil }
        }
        // The one progress step goes unless the finish was already waiting beside it (then it was overtaken)
        #expect(types.filter { $0 != "import-progress" } == ["hello", "import-started", "import-finished", "job"])
        #expect(types.filter { $0 == "import-progress" }.count <= 1)
        #expect(types.firstIndex(of: "import-progress").map { $0 == 2 } ?? true)
        #expect(signals.contains { if case .malformed = $0 { true } else { false } } == false)
    }

    @Test("while the app is busy, an import's progress a later import event overtook is dropped, and nothing else")
    func overtakenProgress() async throws {
        let sse = try String(decoding: fixtureData("events.sse"), as: UTF8.self)
        let blocks = sse.components(separatedBy: "\n\n").filter { !$0.isEmpty }
        let progress = try #require(blocks.first { $0.hasPrefix("event: import-progress") })
        // A busy import: forty progress steps between the start and the finish
        let stream = blocks.flatMap { $0 == progress ? Array(repeating: progress, count: 40) : [$0] }.joined(separator: "\n\n") + "\n\n"
        let transport = RoutedTransport(["/api/v2/events": RoutedTransport.sse(stream)])
        let collected = SignalLog()
        try await EventClient(client: client(transport)).readOnce { signal in
            collected.append(signal)
            // The app busy with each signal (drawing, say), while the stream keeps arriving
            try? await Task.sleep(for: .milliseconds(150))
        }
        let types = collected.signals.compactMap { signal -> String? in
            if case .event(let event) = signal { event.typeName } else { nil }
        }
        #expect(types.first == "hello")
        #expect(types.suffix(2) == ["import-finished", "job"])
        #expect(types.contains("import-started"))
        #expect(types.filter { $0 == "import-progress" }.count < 40)
    }

    @Test("dropping overtaken progress keeps every other signal, in order")
    func superseded() throws {
        let sse = try String(decoding: fixtureData("events.sse"), as: UTF8.self)
        let decoded = try sse.components(separatedBy: "\n\n").filter { !$0.isEmpty }.map { block -> EventSignal in
            let json = try #require(block.split(separator: "\n").first { $0.hasPrefix("data: ") }).dropFirst(6)
            return .event(try JSONDecoder().decode(Components.Schemas.ServerEvent.self, from: Data(json.utf8)))
        }
        // hello, started, progress, finished, job
        let progress = decoded[2]
        let names = { (signals: [EventSignal]) in
            signals.map { signal -> String in if case .event(let e) = signal { e.typeName ?? "?" } else { "\(signal)" } }
        }
        #expect(names(EventClient.superseded([decoded[0], decoded[1], progress, progress, decoded[3], decoded[4]]))
            == ["hello", "import-started", "import-finished", "job"])
        // The last progress with nothing after it stays: it is the latest word
        #expect(names(EventClient.superseded([decoded[1], progress, progress])) == ["import-started", "import-progress"])
        // A job or a hello after progress overtakes nothing
        #expect(names(EventClient.superseded([progress, decoded[4], .connected])).first == "import-progress")
        #expect(EventClient.superseded([.malformed(type: "import-progress"), progress]).first == .malformed(type: "import-progress"))
    }

    @Test("an unknown type is ignored, and a known one that did not decode is reported")
    func readings() async throws {
        let status = try String(decoding: fixtureData("responses/getStatus.json"), as: UTF8.self)
            .replacingOccurrences(of: "\n", with: "")
        let sse = [
            ("hello", #"{"type":"hello","status":\#(status)}"#),
            ("pennant-later", #"{"type":"pennant-later","count":3}"#),
            ("import-progress", #"{"type":"import-progress","progress":"half"}"#),
            ("export-pending", #"{"type":"export-pending","since":"2040-07-01T12:05:00.000Z"}"#),
        ].map { "event: \($0.0)\ndata: \($0.1)\n\n" }.joined(separator: ": keep-alive\n\n")
        let transport = RoutedTransport(["/api/v2/events": RoutedTransport.sse(sse)])
        let unknown = SignalLog()
        let events = EventClient(client: client(transport)) { unknown.appendUnknown($0) }
        let collected = SignalLog()
        try await events.readOnce { collected.append($0) }
        let signals = collected.signals
        #expect(signals.count == 4)
        #expect(signals[0] == .connected)
        guard case .event(let hello) = signals[1] else { Issue.record("hello"); return }
        #expect(hello.hello?.status.app.name == "Pennant")
        #expect(signals[2] == .malformed(type: "import-progress"))
        guard case .event(let pending) = signals[3] else { Issue.record("export-pending"); return }
        #expect({ if case .exportPending(let p) = pending.kind { p.since } else { nil } }() == "2040-07-01T12:05:00.000Z")
        #expect(unknown.unknownTypes == ["pennant-later"])
    }

    @Test("when the stream ends while the server is up, it reconnects")
    func reconnects() async throws {
        let sse = try String(decoding: fixtureData("events.sse"), as: UTF8.self)
        let transport = RoutedTransport(["/api/v2/events": RoutedTransport.sse(sse)])
        let collected = SignalLog()
        let events = EventClient(client: client(transport), reconnectDelay: .milliseconds(10))
        let task = Task { await events.run { collected.append($0) } }
        let reconnected = await eventually { transport.paths.count >= 3 }
        task.cancel()
        await task.value
        #expect(reconnected)
        #expect(collected.signals.filter { $0 == .connected }.count >= 2)
        #expect(collected.signals.contains(.disconnected))
    }

    @Test("a connection that fails is retried the same way")
    func retriesFailure() async throws {
        let transport = RoutedTransport([:])
        let collected = SignalLog()
        let events = EventClient(client: client(transport), reconnectDelay: .milliseconds(10))
        let task = Task { await events.run { collected.append($0) } }
        let retried = await eventually { transport.paths.count >= 3 }
        task.cancel()
        await task.value
        #expect(retried)
        #expect(collected.signals.contains(.connected) == false)
    }
}

/// Reconnecting with backoff, logged, and a clean stop (review N3); a bounded problem list (review N4).
@Suite("Reconnecting to the event stream")
struct EventReconnectTests {
    private func client(_ transport: RoutedTransport) -> Client {
        PennantClient.make(port: 51_000, token: String(repeating: "t", count: 64), transport: transport)
    }

    @Test("the wait doubles while connecting keeps failing, and stops at the cap")
    func schedule() {
        let events = EventClient(client: client(RoutedTransport([:])), reconnectDelay: .seconds(1), maxReconnectDelay: .seconds(10))
        #expect((1...6).map { events.delay(afterFailures: $0) } == [1, 2, 4, 8, 10, 10].map { Duration.seconds($0) })
    }

    @Test("failures are logged, and the attempts slow down")
    func failuresLoggedAndSlower() async {
        let problems = SignalLog()
        let transport = RoutedTransport([:])
        let waits = Waits(stopAfter: 6)
        let events = EventClient(
            client: client(transport), reconnectDelay: .milliseconds(1), maxReconnectDelay: .milliseconds(8),
            onError: { problems.appendUnknown($0) }, onWait: waits.record
        )
        await waits.run(events)
        // Each attempt failed, so each wait doubled to the cap: the sequence, not a count read off the wall clock
        #expect(waits.all == [1, 2, 4, 8, 8, 8].map { Duration.milliseconds($0) })
        #expect(transport.paths.count == 6)
        #expect(problems.unknownTypes.count == 6)
        #expect(problems.unknownTypes.allSatisfy { $0.contains("failed") })
    }

    @Test("a stream that opened and then ended starts the wait again from the first step")
    func resetsAfterConnecting() async throws {
        let sse = try String(decoding: fixtureData("events.sse"), as: UTF8.self)
        let transport = RoutedTransport(["/api/v2/events": RoutedTransport.sse(sse)])
        let problems = SignalLog()
        let waits = Waits(stopAfter: 7)
        let events = EventClient(
            client: client(transport), reconnectDelay: .milliseconds(1), maxReconnectDelay: .seconds(5),
            onError: { problems.appendUnknown($0) }, onWait: waits.record
        )
        await waits.run(events)
        // Always connecting, so never slowed: every wait is the first step
        #expect(waits.all == Array(repeating: Duration.milliseconds(1), count: 7))
        #expect(transport.paths.count == 7)
        #expect(problems.unknownTypes.count == 7)
        #expect(problems.unknownTypes.allSatisfy { $0 == "the event stream ended" })
    }

    @Test("cancelling (the server stopped) ends the loop at once, passing nothing more on")
    func cleanStop() async {
        let transport = RoutedTransport([:])
        let collected = SignalLog()
        let events = EventClient(client: client(transport), reconnectDelay: .seconds(30))
        let task = Task { await events.run { collected.append($0) } }
        #expect(await eventually { collected.signals.contains(.disconnected) })
        let count = collected.signals.count
        let cancelled = ContinuousClock.now
        task.cancel()
        await task.value
        #expect(ContinuousClock.now - cancelled < .seconds(1))
        #expect(collected.signals.count == count)
    }

    @Test("the app model keeps only the latest event problems")
    @MainActor
    func boundedProblems() async throws {
        let configuration = try fakeConfiguration()
        let model = AppModel(configuration: configuration)
        for n in 0..<(AppModel.keptEventProblems + 15) { await model.handle(.malformed(type: "type-\(n)")) }
        #expect(model.eventProblems.count == AppModel.keptEventProblems)
        #expect(model.eventProblems.last?.type == "type-\(AppModel.keptEventProblems + 14)")
    }
}

final class SignalLog: @unchecked Sendable {
    private let lock = NSLock()
    private var _signals: [EventSignal] = []
    private var _unknown: [String] = []
    var signals: [EventSignal] { lock.withLock { _signals } }
    var unknownTypes: [String] { lock.withLock { _unknown } }
    func append(_ signal: EventSignal) { lock.withLock { _signals.append(signal) } }
    func appendUnknown(_ type: String) { lock.withLock { _unknown.append(type) } }
}

/// The waits an event client announced, kept in order; after `stopAfter` of them the run is cancelled (the server
/// stopped), so a test reads the sequence of attempts and waits with only a few milliseconds of real time passing.
final class Waits: @unchecked Sendable {
    private let lock = NSLock()
    private var _all: [Duration] = []
    private var task: Task<Void, Never>?
    private var stopRequested = false
    private let stopAfter: Int

    init(stopAfter: Int) {
        self.stopAfter = stopAfter
    }

    var all: [Duration] { lock.withLock { _all } }

    var record: @Sendable (Duration) -> Void {
        { [self] duration in
            let toCancel: Task<Void, Never>? = lock.withLock {
                _all.append(duration)
                guard _all.count >= stopAfter else { return nil }
                stopRequested = true
                return task
            }
            toCancel?.cancel()
        }
    }

    /// Runs the client until the stop: the task is kept before any wait can ask for it, or cancelled at once if the
    /// stop came first.
    func run(_ events: EventClient) async {
        let running = Task { await events.run { _ in } }
        let stopNow = lock.withLock { task = running; return stopRequested }
        if stopNow { running.cancel() }
        await running.value
    }
}
