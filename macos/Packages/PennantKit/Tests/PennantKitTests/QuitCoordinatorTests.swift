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

/// Spins the main run loop (only its sources and blocks, never the main dispatch queue, since this runs inside a
/// main-queue job) until the condition holds.
@MainActor
private func runMainLoop(until condition: () -> Bool, timeout: TimeInterval = 2) {
    let deadline = Date.now.addingTimeInterval(timeout)
    while !condition() && Date.now < deadline {
        _ = CFRunLoopRunInMode(.defaultMode, 0.02, true)
    }
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
