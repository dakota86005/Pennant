#if DEBUG
import Darwin
import Foundation

/// A Debug build launched by the UI tests (`-PennantTestLogKeys YES`) says in the app's log when its main thread stops
/// answering, and where it is (PR #60: on GitHub's macOS 26 runner the app's main thread stayed busy for minutes after
/// Payroll & Budget opened in a 900-point window, and XCTest could only say "main thread busy for 30.0s"). A thread of
/// its own pings the main queue each half second; after 5 s without an answer it writes the main thread's stack twice:
/// at once, from a signal the main thread itself takes (`backtrace_symbols_fd`), and from `/usr/bin/sample`, into
/// `hang-*.log` beside the app's log (kept with each UI test's logs by `test.sh`). Once per process. Nonisolated: its
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

    /// Made on the main thread (it notes the main thread's own id).
    init(folder: URL, log: @escaping @Sendable (String) -> Void) {
        self.folder = folder
        self.log = log
    }

    func start() {
        // The stack's room made now, never first inside the signal handler
        _ = watchdogFrames
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + 1, repeating: .milliseconds(500))
        timer.setEventHandler { [weak self] in self?.tick() }
        timer.resume()
        self.timer = timer
        log("watchdog: watching the main thread (a stack is written after 5 s without an answer)")
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
        }
    }

    private func answered() {
        let late = lock.withLock { () -> TimeInterval? in
            defer { sent = nil }
            return sent.map { Date().timeIntervalSince($0) }
        }
        if let late, late >= 2 { log(String(format: "watchdog: the main thread answered after %.1f s", late)) }
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
            // Runs on the main thread, interrupting whatever it was doing: its stack, to the open file
            signal(SIGUSR2) { _ in
                let fd = watchdogDescriptor
                guard fd >= 0 else { return }
                backtrace_symbols_fd(watchdogFrames, backtrace(watchdogFrames, 512), fd)
            }
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
