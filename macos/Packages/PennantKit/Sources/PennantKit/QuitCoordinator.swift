import AppKit

/// The one way the app quits (review S4; SWIFTUI_REBUILD.md section 5.3, step 3).
///
/// `applicationShouldTerminate` answers `.terminateLater` and AppKit then waits, in a nested run loop, for the reply.
/// That loop cannot drain the main dispatch queue while it is itself inside a main-queue job, and every main-actor
/// `Task`, `.task`, `.onReceive` or `DispatchQueue.main` block is one. So:
/// - **asking to quit** (`requestQuit()`) never calls `NSApp.terminate` directly: it schedules it on the main run
///   loop, which also runs inside that nested loop, so it is safe from a `Task`, a main-queue block, a menu command or
///   another thread (the SIGTERM handler);
/// - **the stop and the reply** (`shouldTerminate`) do not need the main queue: the server is stopped on a detached
///   task (the controller is an actor), and the reply is delivered through the main run loop.
/// Quit only through `requestQuit()`.
@MainActor
public final class QuitCoordinator {
    private let prepare: @MainActor () -> Void
    private let lastWords: @MainActor () -> @Sendable () async -> Void
    private let stop: @Sendable () async -> Void
    /// A reply is owed to AppKit.
    public private(set) var replyPending = false

    /// `prepare` runs at once, on the main actor (the model stops starting things); `lastWords` is asked then, on the
    /// main actor, for what must reach the server before it stops (the notes typed and not saved yet), which is sent
    /// off the main actor; `stop` then stops the server off the main actor.
    public init(
        prepare: @escaping @MainActor () -> Void,
        lastWords: @escaping @MainActor () -> @Sendable () async -> Void = { {} },
        stop: @escaping @Sendable () async -> Void
    ) {
        self.prepare = prepare
        self.lastWords = lastWords
        self.stop = stop
    }

    /// Asks the app to quit, from anywhere. `terminate` is for tests; the app's is `NSApp.terminate(nil)`.
    public nonisolated static func requestQuit(
        _ terminate: @escaping @MainActor @Sendable () -> Void = { NSApp.terminate(nil) }
    ) {
        onMainRunLoop(terminate)
    }

    /// `applicationShouldTerminate`'s answer: stop the server, then reply. A second request while a reply is owed is
    /// cancelled (the first one is still under way).
    public func shouldTerminate(reply: @escaping @MainActor @Sendable (Bool) -> Void) -> NSApplication.TerminateReply {
        if replyPending { return .terminateCancel }
        replyPending = true
        let last = lastWords()
        prepare()
        let stop = stop
        Task.detached(priority: .userInitiated) {
            await last()
            await stop()
            Self.onMainRunLoop { reply(true) }
        }
        return .terminateLater
    }

    /// Runs `work` on the main thread from the main run loop (in its common modes, which include the nested loop
    /// `.terminateLater` waits in), not from the main dispatch queue.
    nonisolated static func onMainRunLoop(_ work: @escaping @MainActor @Sendable () -> Void) {
        let loop = CFRunLoopGetMain()
        CFRunLoopPerformBlock(loop, CFRunLoopMode.commonModes.rawValue) {
            MainActor.assumeIsolated { work() }
        }
        CFRunLoopWakeUp(loop)
    }
}
