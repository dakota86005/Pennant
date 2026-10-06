import AppKit
import Foundation
import Testing
@testable import PennantKit

final class Flag: @unchecked Sendable {
    private let lock = NSLock()
    private var _value: Bool?
    var value: Bool? { lock.withLock { _value } }
    func set(_ value: Bool = true) { lock.withLock { _value = value } }
}

final class OrderLog: @unchecked Sendable {
    private let lock = NSLock()
    private var _all: [String] = []
    var all: [String] { lock.withLock { _all } }
    func add(_ step: String) { lock.withLock { _all.append(step) } }
}

/// Keeps a continuation that is never resumed (a send that never answers), so it is never reported as leaked.
private extension Never {
    nonisolated(unsafe) static var held: [UnsafeContinuation<Void, Never>] = []
    private static let lock = NSLock()
    static func hold(_ continuation: UnsafeContinuation<Void, Never>) { lock.withLock { held.append(continuation) } }
}

/// Spins the main run loop (only its sources and blocks, never the main dispatch queue, since this runs inside a
/// main-queue job) until the condition holds.
@MainActor
private func runMainLoop(until condition: () -> Bool, timeout: TimeInterval = 2) {
    let deadline = Date.now.addingTimeInterval(timeout)
    while !condition() && Date.now < deadline {
        _ = CFRunLoopRunInMode(.defaultMode, 0.02, true)
    }
}

/// The main run loop spun a little at a time until the condition holds, the main actor let go between turns, so tests
/// that wait on deadlines never hold the main actor from other suites running beside them.
@MainActor
private func pumpMainLoop(until condition: () -> Bool, timeout: TimeInterval) async {
    let deadline = Date.now.addingTimeInterval(timeout)
    while !condition() && Date.now < deadline {
        spinOnce()
        try? await Task.sleep(for: .milliseconds(10))
    }
}

/// One short turn of the main run loop (its sources and blocks).
@MainActor
private func spinOnce() {
    _ = CFRunLoopRunInMode(.defaultMode, 0.005, true)
}

/// Quitting works from any caller without the main dispatch queue being free (review S4).
@Suite("Quitting", .serialized)
@MainActor
struct QuitCoordinatorTests {
    @Test("the stop runs, and the reply arrives, while the main queue is busy with the very job that asked")
    func independentOfMainQueue() {
        let stopped = Flag()
        let replied = Flag()
        let prepared = Flag()
        let quit = QuitCoordinator(prepare: { prepared.set() }) {
            try? await Task.sleep(for: .milliseconds(20))
            stopped.set()
        }
        #expect(quit.shouldTerminate { ok in replied.set(ok) } == .terminateLater)
        #expect(prepared.value == true)
        // Hold the main thread without yielding: the stop must not need it
        let deadline = Date.now.addingTimeInterval(2)
        while stopped.value == nil && Date.now < deadline { usleep(1_000) }
        #expect(stopped.value == true)
        // The reply comes through the main run loop, from inside this main-queue job
        runMainLoop { replied.value != nil }
        #expect(replied.value == true)
    }

    @Test("the last words (the notes not kept yet) reach the server before it stops, without the main queue")
    func lastWordsFirst() {
        let order = OrderLog()
        let replied = Flag()
        let quit = QuitCoordinator(prepare: {}, lastWords: {
            { try? await Task.sleep(for: .milliseconds(20)); order.add("notes") }
        }) { order.add("stop") }
        #expect(quit.shouldTerminate { replied.set($0) } == .terminateLater)
        let deadline = Date.now.addingTimeInterval(2)
        while order.all.count < 2 && Date.now < deadline { usleep(1_000) }
        #expect(order.all == ["notes", "stop"])
        runMainLoop { replied.value != nil }
        #expect(replied.value == true)
    }

    @Test("asked again while the quit is under way, it is cancelled; asked again after the reply, it quits at once (PR #58)")
    func askedAgain() {
        let replied = Flag()
        let lines = OrderLog()
        let quit = QuitCoordinator(prepare: {}, log: { lines.add($0) }) {
            try? await Task.sleep(for: .milliseconds(20))
        }
        #expect(quit.shouldTerminate { replied.set($0) } == .terminateLater)
        #expect(quit.shouldTerminate { _ in Issue.record("a second reply") } == .terminateCancel)
        runMainLoop { replied.value != nil }
        #expect(replied.value == true)
        #expect(quit.replied)
        // AppKit asking again on its way out: the quit is already decided, so it is never cancelled now
        #expect(quit.shouldTerminate { _ in Issue.record("no reply is owed") } == .terminateNow)
        #expect(lines.all.contains("quit: asked again after the reply; quitting now"))
    }

    @Test("once the quit is answered yes, an app AppKit has not ended within the grace ends itself, and says so (PR #58)")
    func endsItselfAfterTheGrace() {
        let replied = Flag()
        let ended = Flag()
        let lines = OrderLog()
        let quit = QuitCoordinator(prepare: {}, exitGrace: .milliseconds(50), forceExit: { ended.set() }, log: { lines.add($0) }) {}
        #expect(quit.shouldTerminate { lines.add("the reply reached AppKit"); replied.set($0) } == .terminateLater)
        runMainLoop { replied.value != nil }
        #expect(replied.value == true)
        let deadline = Date.now.addingTimeInterval(2)
        while ended.value == nil && Date.now < deadline { usleep(1_000) }
        #expect(ended.value == true)
        #expect(lines.all.contains("quit: replied yes"))
        #expect(lines.all.contains { $0.hasPrefix("quit: if AppKit has not ended the app") })
        // The net is set before the reply goes out: AppKit ends the app inside the reply, so nothing after it would run
        let net = lines.all.firstIndex { $0.hasPrefix("quit: if AppKit") }
        let sent = lines.all.firstIndex(of: "the reply reached AppKit")
        #expect(net != nil && sent != nil && net! < sent!)
    }

    @Test("a note send that never answers does not hold the quit: the server is stopped and the reply goes out by the deadline")
    func lastWordsNeverAnswer() async {
        let order = OrderLog()
        let replied = Flag()
        let lines = OrderLog()
        let quit = QuitCoordinator(prepare: {}, lastWords: {
            // A send that never answers and ignores being cancelled
            { await withUnsafeContinuation { (held: UnsafeContinuation<Void, Never>) in Never.hold(held) } }
        }, lastWordsDeadline: .milliseconds(100), log: { lines.add($0) }) { order.add("stop") }
        let asked = Date.now
        #expect(quit.shouldTerminate { replied.set($0) } == .terminateLater)
        await pumpMainLoop(until: { replied.value != nil }, timeout: 3)
        #expect(replied.value == true)
        #expect(Date.now.timeIntervalSince(asked) < 2)
        #expect(order.all == ["stop"])
        #expect(lines.all.contains { $0.contains("quitting without them") })
    }

    @Test("a stop that never ends does not hold the quit: the reply goes out at the reply deadline")
    func stopNeverEnds() async {
        let replies = OrderLog()
        let quit = QuitCoordinator(prepare: {}, replyDeadline: .milliseconds(200)) {
            await withUnsafeContinuation { (held: UnsafeContinuation<Void, Never>) in Never.hold(held) }
        }
        let asked = Date.now
        #expect(quit.shouldTerminate { replies.add("\($0)") } == .terminateLater)
        await pumpMainLoop(until: { !replies.all.isEmpty }, timeout: 3)
        #expect(replies.all == ["true"])
        #expect(Date.now.timeIntervalSince(asked) < 2)
    }

    @Test("a stop that ends after the reply deadline does not reply a second time")
    func repliesOnce() async {
        let replies = OrderLog()
        let stopped = Flag()
        let quit = QuitCoordinator(prepare: {}, replyDeadline: .milliseconds(100)) {
            try? await Task.sleep(for: .milliseconds(300))
            stopped.set()
        }
        #expect(quit.shouldTerminate { replies.add("\($0)") } == .terminateLater)
        await pumpMainLoop(until: { stopped.value != nil }, timeout: 3)
        // Whatever the stop's end scheduled has run
        await pumpMainLoop(until: { false }, timeout: 0.1)
        #expect(stopped.value == true)
        #expect(replies.all == ["true"])
    }

    @Test("a second request while a reply is owed is cancelled, not waited on twice")
    func reentrant() {
        let quit = QuitCoordinator(prepare: {}) { try? await Task.sleep(for: .milliseconds(50)) }
        let replied = Flag()
        #expect(quit.shouldTerminate { replied.set($0) } == .terminateLater)
        #expect(quit.shouldTerminate { _ in Issue.record("a second reply") } == .terminateCancel)
        runMainLoop { replied.value != nil }
        #expect(replied.value == true)
    }

    @Test("asking to quit from a main-queue job or another thread reaches the main run loop")
    func requestQuit() async {
        let fromHere = Flag()
        QuitCoordinator.requestQuit { fromHere.set() }
        runMainLoop { fromHere.value != nil }
        #expect(fromHere.value == true)

        let fromThread = Flag()
        await Task.detached { QuitCoordinator.requestQuit { fromThread.set() } }.value
        runMainLoop { fromThread.value != nil }
        #expect(fromThread.value == true)
    }

    @Test("the app model's stop path goes through the controller, off the main actor")
    func stopsTheServer() async throws {
        let configuration = try fakeConfiguration()
        let status = try fixtureStatus()
        let launcher = FakeLauncher { process, _ in process.ready() }
        let controller = ServerController(configuration: configuration, launcher: launcher, keySource: NoKeys(), probe: { _, _ in status }, timing: fastTiming)
        let model = AppModel(configuration: configuration, controller: controller)
        await model.start()
        #expect(await eventually { model.serverState.connection != nil })
        let replied = Flag()
        let quit = QuitCoordinator(prepare: { model.beginShutdown() }) { [controller = model.serverController] in await controller.stop() }
        #expect(quit.shouldTerminate { replied.set($0) } == .terminateLater)
        runMainLoop(until: { replied.value != nil }, timeout: 5)
        #expect(replied.value == true)
        #expect(await controller.state == .stopped)
        #expect(launcher.launched.first?.terminations == 1)
        await model.start()
        #expect(launcher.launched.count == 1)
    }
}
