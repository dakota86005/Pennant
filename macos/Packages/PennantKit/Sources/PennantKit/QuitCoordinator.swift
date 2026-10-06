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
///   task (the controller is an actor), and the reply is delivered through the main run loop;
/// - **the quit always finishes**: the last words (the notes not kept yet) get `lastWordsDeadline` and are then given up,
///   and the reply goes out by `replyDeadline` whatever is still under way (PR #58 on GitHub's macOS 26 runner: a quit
///   left waiting kept the app running, and every test after it found the keyboard elsewhere).
/// Quit only through `requestQuit()`.
@MainActor
public final class QuitCoordinator {
    private let prepare: @MainActor () -> Void
    private let lastWords: @MainActor () -> @Sendable () async -> Void
    private let stop: @Sendable () async -> Void
    private let log: @Sendable (String) -> Void
    /// How long the last words may take before the quit goes on without them.
    let lastWordsDeadline: Duration
    /// How long AppKit waits for the reply at most: the server's stop has its own grace and kill within it.
    let replyDeadline: Duration
    /// A reply is owed to AppKit.
    public private(set) var replyPending = false

    /// `prepare` runs at once, on the main actor (the model stops starting things); `lastWords` is asked then, on the
    /// main actor, for what must reach the server before it stops (the notes typed and not saved yet), which is sent
    /// off the main actor, for `lastWordsDeadline` at most; `stop` then stops the server off the main actor. The reply
    /// goes out when the stop has ended, or at `replyDeadline`, whichever comes first; `log` says each step.
    public init(
        prepare: @escaping @MainActor () -> Void,
        lastWords: @escaping @MainActor () -> @Sendable () async -> Void = { {} },
        lastWordsDeadline: Duration = .seconds(2),
        replyDeadline: Duration = .seconds(12),
        log: @escaping @Sendable (String) -> Void = { _ in },
        stop: @escaping @Sendable () async -> Void
    ) {
        self.prepare = prepare
        self.lastWords = lastWords
        self.lastWordsDeadline = lastWordsDeadline
        self.replyDeadline = replyDeadline
        self.log = log
        self.stop = stop
    }

    /// Asks the app to quit, from anywhere. `terminate` is for tests; the app's is `NSApp.terminate(nil)`.
    public nonisolated static func requestQuit(
        _ terminate: @escaping @MainActor @Sendable () -> Void = { NSApp.terminate(nil) }
    ) {
        onMainRunLoop(terminate)
    }

    /// `applicationShouldTerminate`'s answer: send the last words (for `lastWordsDeadline` at most), stop the server,
    /// then reply; the reply goes out at `replyDeadline` if the stop has not ended by then, and only once. A second
    /// request while a reply is owed is cancelled (the first one is still under way).
    public func shouldTerminate(reply: @escaping @MainActor @Sendable (Bool) -> Void) -> NSApplication.TerminateReply {
        if replyPending { return .terminateCancel }
        replyPending = true
        log("quit: asked")
        let last = lastWords()
        prepare()
        let stop = stop, log = log, lastWordsDeadline = lastWordsDeadline, replyDeadline = replyDeadline
        let answer = Once()
        Task.detached(priority: .userInitiated) {
            if await Self.finishes(within: lastWordsDeadline, last) {
                log("quit: the last words are sent")
            } else {
                log("quit: the last words took longer than \(lastWordsDeadline); quitting without them")
            }
            await stop()
            log("quit: the server is stopped")
            if answer.claim() { Self.onMainRunLoop { reply(true) } }
        }
        Task.detached(priority: .userInitiated) {
            try? await Task.sleep(for: replyDeadline)
            guard answer.claim() else { return }
            log("quit: the stop took longer than \(replyDeadline); quitting anyway")
            Self.onMainRunLoop { reply(true) }
        }
        return .terminateLater
    }

    /// Runs `work` for `limit` at most: true when it ended in time. A send that never answers, and ignores being
    /// cancelled, is left behind (it is cancelled) rather than waited on, so this never waits longer than `limit`.
    nonisolated static func finishes(within limit: Duration, _ work: @escaping @Sendable () async -> Void) async -> Bool {
        let first = Once()
        return await withCheckedContinuation { (continuation: CheckedContinuation<Bool, Never>) in
            let job = Task.detached(priority: .userInitiated) {
                await work()
                if first.claim() { continuation.resume(returning: true) }
            }
            Task.detached(priority: .userInitiated) {
                try? await Task.sleep(for: limit)
                guard first.claim() else { return }
                job.cancel()
                continuation.resume(returning: false)
            }
        }
    }

    /// The first of several racing callers wins (`claim()` is true once).
    private final class Once: @unchecked Sendable {
        private let lock = NSLock()
        private var claimed = false
        func claim() -> Bool { lock.withLock { defer { claimed = true }; return !claimed } }
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
