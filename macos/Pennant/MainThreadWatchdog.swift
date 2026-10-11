#if DEBUG
import Darwin
import Foundation

/// A Debug build launched by the UI tests (`-PennantTestLogKeys YES`) says in the app's log when its main thread stops
/// answering, and where it is (PR #60: on GitHub's macOS 26 runner the app's main thread stayed busy for minutes after
/// Payroll & Budget opened in a 900-point window, and XCTest could only say "main thread busy for 30.0s"). A thread of
/// its own pings the main queue each half second; after 5 s without an answer it writes the main thread's stack twice:
/// at once, from a signal the main thread itself takes (`backtrace_symbols_fd`), and from `/usr/bin/sample`, into
/// `hang-*.log` beside the app's log (kept with each UI test's logs by `test.sh`). Once per process. A shorter stall of
/// 2 s or more keeps the stacks taken from 1.5 s on, as `hang-stall-<n>.log` (`captureStall`).
///
/// Whose time the 2 to 4 s stalls are (PR #63's run, read again with these stacks on run 38079051437): the test's, not
/// the GM's. In Player Search's full-page audit every stall holds XCTest's own work on the app's main thread: its
/// in-process queries (`XCTPerformOnMainRunLoop`, `XCElementSnapshot children`) or the accessibility hierarchy it copies
/// (`_XCopyHierarchy`), with the table's row views made and put away for them (`NSTableRowData`); they line up with
/// the test's "Get number of matches" and audit steps. The launch stalls (Compare, the club owed after Setup) are the
/// first Morning Report's first frame on a fresh runner: Metal compiling its render pipelines with no shader cache, then
/// SwiftUI's first layout. No stack holds a frame of Pennant's own code. Nonisolated: its
/// timer runs on a queue of its own (the app target's default isolation is the main actor, whose check would stop it).
nonisolated final class MainThreadWatchdog: @unchecked Sendable {
    private let log: @Sendable (String) -> Void
    private let folder: URL
    private let queue = DispatchQueue(label: "pennant.watchdog", qos: .utility)
    private let lock = NSLock()
    private var sent: Date?
    private var reported = false
    private var timer: (any DispatchSourceTimer)?
    private let main = pthread_self()
    /// A shorter stall's stacks (1.5 s and more), only on the watchdog's queue: the open file, how many stacks it holds,
    /// and how many stalls were kept.
    private var stallFile: Int32 = -1
    private var stallStacks = 0
    private var stallsKept = 0

    /// Made on the main thread (it notes the main thread's own id).
    init(folder: URL, log: @escaping @Sendable (String) -> Void) {
        self.folder = folder
        self.log = log
    }

    func start() {
        // The stack's room made now, never first inside the signal handler
        _ = watchdogFrames
        // Runs on the main thread, interrupting whatever it was doing: its stack, to the open file (none: nothing)
        signal(SIGUSR2) { _ in
            let fd = watchdogDescriptor
            guard fd >= 0 else { return }
            backtrace_symbols_fd(watchdogFrames, backtrace(watchdogFrames, 512), fd)
        }
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + 1, repeating: .milliseconds(500))
        timer.setEventHandler { [weak self] in self?.tick() }
        timer.resume()
        self.timer = timer
        log("watchdog: watching the main thread (a stack is written after 5 s without an answer, and kept from a stall of 2 s)")
    }

    private func tick() {
        let now = Date()
        let waited: TimeInterval? = lock.withLock {
            guard let sent else {
                self.sent = now
                return nil
            }
            return now.timeIntervalSince(sent)
        }
        guard let waited else {
            DispatchQueue.main.async { [self] in answered() }
            return
        }
        if waited >= 5, lock.withLock({ !reported }) {
            lock.withLock { reported = true }
            report(waited)
        } else if waited >= 1.5, waited < 5 {
            captureStall(waited)
        }
    }

    private func answered() {
        let late = lock.withLock { () -> TimeInterval? in
            defer { sent = nil }
            return sent.map { Date().timeIntervalSince($0) }
        }
        if let late, late >= 2 { log(String(format: "watchdog: the main thread answered after %.1f s", late)) }
        if let late { queue.async { [self] in endStall(late) } }
    }

    /// A stall shorter than the 5 s report's: from 1.5 s without an answer, the main thread's stack each half second (at
    /// most 6), into `hang-stall.tmp`. Kept as `hang-stall-<n>.log` if the answer came after 2 s or more (at most 10 per
    /// process), else removed (`endStall`). Each stack is the thread's own, from the signal, as the 5 s report's is.
    private func captureStall(_ waited: TimeInterval) {
        guard stallsKept < 10, stallStacks < 6 else { return }
        if stallFile < 0 {
            let path = folder.appending(path: "hang-stall.tmp").path(percentEncoded: false)
            _ = FileManager.default.createFile(atPath: path, contents: nil)
            stallFile = open(path, O_WRONLY | O_TRUNC)
            guard stallFile >= 0 else { return }
        }
        stallStacks += 1
        let head = String(format: "--- stack %d, %.1f s without an answer\n", stallStacks, waited)
        _ = head.withCString { write(stallFile, $0, strlen($0)) }
        watchdogDescriptor = stallFile
        pthread_kill(main, SIGUSR2)
        Thread.sleep(forTimeInterval: 0.2)
        watchdogDescriptor = -1
    }

    /// The stall is over: its stacks kept, and their first in the app's log, if it lasted 2 s or more.
    private func endStall(_ late: TimeInterval) {
        guard stallFile >= 0 else { return }
        close(stallFile)
        stallFile = -1
        stallStacks = 0
        let file = folder.appending(path: "hang-stall.tmp")
        guard late >= 2 else {
            try? FileManager.default.removeItem(at: file)
            return
        }
        stallsKept += 1
        let kept = folder.appending(path: "hang-stall-\(stallsKept).log")
        try? FileManager.default.removeItem(at: kept)
        try? FileManager.default.moveItem(at: file, to: kept)
        log(String(format: "watchdog: the stacks of the %.1f s stall are in hang-stall-%d.log; its first follows", late, stallsKept))
        let text = (try? String(contentsOf: kept, encoding: .utf8)) ?? ""
        for line in text.split(separator: "\n").dropFirst().prefix(while: { !$0.hasPrefix("---") }).prefix(80) {
            log("watchdog: stall \(stallsKept) " + line.split(separator: " ", omittingEmptySubsequences: true).joined(separator: " "))
        }
    }

    /// The main thread's stack, from a signal it takes itself, then from `sample`; their heads in the app's log.
    private func report(_ waited: TimeInterval) {
        log(String(format: "watchdog: the main thread has not answered for %.1f s; its stack follows (hang-backtrace.log, hang-sample.log)", waited))
        let backtraceFile = folder.appending(path: "hang-backtrace.log")
        let path = backtraceFile.path(percentEncoded: false)
        _ = FileManager.default.createFile(atPath: path, contents: nil)
        let fd = open(path, O_WRONLY | O_TRUNC)
        if fd >= 0 {
            watchdogDescriptor = fd
            pthread_kill(main, SIGUSR2)
            Thread.sleep(forTimeInterval: 1)
            watchdogDescriptor = -1
            close(fd)
            let text = (try? String(contentsOf: backtraceFile, encoding: .utf8)) ?? ""
            for line in text.split(separator: "\n").prefix(80) {
                log("watchdog: main " + line.split(separator: " ", omittingEmptySubsequences: true).joined(separator: " "))
            }
        }
        let out = folder.appending(path: "hang-sample.log")
        let process = Process()
        process.executableURL = URL(filePath: "/usr/bin/sample")
        process.arguments = [String(ProcessInfo.processInfo.processIdentifier), "3", "-file", out.path(percentEncoded: false)]
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        do {
            try process.run()
            process.waitUntilExit()
            log("watchdog: sample ended with status \(process.terminationStatus)")
        } catch {
            log("watchdog: sample could not start (\((error as NSError).domain) \((error as NSError).code))")
        }
        // The main thread's hot path: each frame of its call graph seen in at least 90% of its samples, outermost first
        let sampled = (try? String(contentsOf: out, encoding: .utf8)) ?? ""
        var total: Int?
        var logged = 0
        for line in sampled.split(separator: "\n") {
            // A frame's line is drawn as its depth in "+ ! : |" marks, then its count of samples
            let words = line.drop { " +!:|".contains($0) }.split(separator: " ", omittingEmptySubsequences: true)
            guard let first = words.first, let count = Int(first) else { continue }
            if words.count > 1, words[1].hasPrefix("Thread_") {
                if total != nil { break }
                if line.contains("com.apple.main-thread") { total = count }
                continue
            }
            guard let total, count * 10 >= total * 9, logged < 300 else { continue }
            logged += 1
            log("watchdog: hot " + words.joined(separator: " "))
        }
    }
}

/// The open file the main thread writes its own stack to, while the watchdog asks for it (-1 otherwise).
nonisolated(unsafe) private var watchdogDescriptor: Int32 = -1
/// Room for the stack, made before any signal (nothing is allocated inside the handler).
nonisolated(unsafe) private let watchdogFrames = UnsafeMutablePointer<UnsafeMutableRawPointer?>.allocate(capacity: 512)

#endif
