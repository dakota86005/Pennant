import Foundation
import PennantAPI

/// Where the server is in its life, as the app shows it.
public enum ServerState: Sendable, Equatable {
    /// Not started yet.
    case idle
    /// Launched; waiting for `PENNANT_READY` and the status check.
    case starting
    /// Listening, and `/api/status` answered.
    case ready(ServerConnection)
    /// It stopped unexpectedly and starts again after `after`.
    case restarting(attempt: Int, after: Duration)
    /// It could not be started, or stopped too often; Try Again starts it afresh.
    case failed(ServerFailure)
    /// Another copy of Pennant holds the data folder (exit code 3). Not retried: that copy has to quit first.
    /// `message` is the server's own sentence, naming the holder.
    case locked(message: String?)
    /// A clean stop is under way.
    case stopping
    /// Stopped on request.
    case stopped

    public var connection: ServerConnection? {
        if case .ready(let connection) = self { connection } else { nil }
    }
}

/// A server that is up: where it listens, the token for this launch, and the status that confirmed it.
public struct ServerConnection: Sendable, Equatable {
    public let port: Int
    public let token: String
    public let pid: Int32
    public let status: Components.Schemas.ServerStatus

    public init(port: Int, token: String, pid: Int32, status: Components.Schemas.ServerStatus) {
        self.port = port
        self.token = token
        self.pid = pid
        self.status = status
    }

    public var baseURL: URL { PennantClient.baseURL(port: port) }
}

/// Why the server is not running. The app turns `kind` into a structural title; `serverMessage` is the server's own
/// sentence (its `PENNANT_FAILED` line) and is shown as it is; `detail` goes to the log.
public struct ServerFailure: Sendable, Equatable {
    public enum Kind: Sendable, Equatable {
        /// The bundle has no server (a build that skipped staging it).
        case notInstalled
        /// The process could not be started at all.
        case couldNotLaunch
        /// The server did not accept the handshake (exit code 2).
        case handshake
        /// A development build was given no data folder (neither a scratch folder nor the opt-in to the real one), so
        /// no server was started.
        case noDataFolderChosen
        /// The first-run backup could not be taken, so no server was started on the folder (section 7.5). `detail`
        /// holds the error.
        case backupFailed
        /// The server said why it could not start (`PENNANT_FAILED`, exit code 1). Not retried: its reason does not
        /// go away by waiting.
        case startFailed
        /// No `PENNANT_READY` within the ready timeout.
        case notReady
        /// Ready, but `/api/status` did not answer.
        case statusCheck
        /// Too many crashes inside the restart window.
        case crashedRepeatedly
    }

    public var kind: Kind
    public var serverMessage: String?
    public var detail: String?

    public init(kind: Kind, serverMessage: String? = nil, detail: String? = nil) {
        self.kind = kind
        self.serverMessage = serverMessage
        self.detail = detail
    }
}

/// The waits the controller uses. The defaults are SWIFTUI_REBUILD.md section 5.3's; tests shorten them.
public struct ServerTiming: Sendable, Equatable {
    public var readyTimeout: Duration
    public var stopGrace: Duration
    public var statusAttempts: Int
    public var statusRetryDelay: Duration
    public var restart: RestartPolicy

    public init(
        readyTimeout: Duration = .seconds(30),
        stopGrace: Duration = .seconds(5),
        statusAttempts: Int = 3,
        statusRetryDelay: Duration = .milliseconds(500),
        restart: RestartPolicy = RestartPolicy()
    ) {
        self.readyTimeout = readyTimeout
        self.stopGrace = stopGrace
        self.statusAttempts = statusAttempts
        self.statusRetryDelay = statusRetryDelay
        self.restart = restart
    }
}

/// Asks a server that said it is ready for its status.
public typealias StatusProbe = @Sendable (_ port: Int, _ token: String) async throws -> Components.Schemas.ServerStatus

/// The live probe: `GET /api/status` through the generated client.
public let liveStatusProbe: StatusProbe = { port, token in
    try await PennantClient.make(port: port, token: token).getStatus().ok.body.json
}

/// Starts, watches, restarts and stops the sidecar (SWIFTUI_REBUILD.md section 5.3):
/// 1. spawn `pennant-server server.cjs` with the data folder, the app root, the version, the bind address and the
///    embedded flag; write the handshake (a fresh token, the Keychain's keys) and keep stdin open; wait for
///    `PENNANT_READY`; confirm with `GET /api/status`;
/// 2. on a crash, restart after 1, 2, 4 … 30 s, and stop after five crashes in two minutes; a locked data folder
///    (exit code 3) is shown and not retried;
/// 3. on quit, SIGTERM, then SIGKILL if it has not stopped within the grace period;
/// 4. every line the server writes goes to the log.
public actor ServerController {
    public nonisolated let configuration: ServerConfiguration
    public nonisolated let log: ServerLog
    /// The data folder's first-run backup, which gates every launch.
    public nonisolated let backups: BackupManager
    /// What the first-run backup did on the latest launch.
    public private(set) var backupOutcome: BackupManager.Outcome?
    private let launcher: any SidecarLauncher
    private let keySource: any KeySource
    private let probe: StatusProbe
    private let timing: ServerTiming
    private var policy: RestartPolicy

    public private(set) var state: ServerState = .idle
    private var watchers: [UUID: AsyncStream<ServerState>.Continuation] = [:]

    private enum Phase {
        case none
        case awaitingReady(token: String)
        case confirming
        case running(since: ContinuousClock.Instant)
    }

    /// Each launch gets a number; a callback from an older launch is ignored.
    private var generation = 0
    private var process: (any SidecarProcess)?
    private var phase: Phase = .none
    private var lastFailure: SidecarFailure?
    /// A failure decided before the process ended (no ready line in time, the status check failed): shown when it
    /// exits instead of restarting.
    private var pendingFailure: ServerFailure?
    private var stopRequested = false
    private var readyTimeoutTask: Task<Void, Never>?
    private var confirmTask: Task<Void, Never>?
    private var restartTask: Task<Void, Never>?

    public init(
        configuration: ServerConfiguration,
        launcher: any SidecarLauncher = FoundationSidecarLauncher(),
        keySource: any KeySource = KeychainKeyStore(service: KeychainKeyStore.service(forBundleID: Bundle.main.bundleIdentifier)),
        probe: @escaping StatusProbe = liveStatusProbe,
        timing: ServerTiming = ServerTiming(),
        log: ServerLog? = nil
    ) {
        // Writing to the stdin of a server that has just died must fail as an error, not end the app
        signal(SIGPIPE, SIG_IGN)
        self.configuration = configuration
        self.launcher = launcher
        self.keySource = keySource
        self.probe = probe
        self.timing = timing
        self.policy = timing.restart
        self.log = log ?? ServerLog(folder: configuration.logFolder)
        self.backups = BackupManager(dataFolder: configuration.dataFolder)
    }

    // MARK: Watching

    /// The current state, then every change.
    public func stateUpdates() -> AsyncStream<ServerState> {
        let (stream, continuation) = AsyncStream.makeStream(of: ServerState.self)
        let id = UUID()
        watchers[id] = continuation
        continuation.yield(state)
        continuation.onTermination = { [weak self] _ in
            Task { await self?.removeWatcher(id) }
        }
        return stream
    }

    private func removeWatcher(_ id: UUID) {
        watchers[id] = nil
    }

    private func set(_ next: ServerState) {
        state = next
        for watcher in watchers.values { watcher.yield(next) }
    }

    // MARK: Starting and stopping

    /// Starts the server unless it is already starting or running.
    public func start() async {
        switch state {
        case .idle, .stopped, .failed, .locked:
            policy.reset()
            await launch()
        case .starting, .ready, .restarting, .stopping:
            return
        }
    }

    /// Try Again after a failure or a locked folder: forgets earlier crashes and starts afresh.
    public func tryAgain() async {
        restartTask?.cancel()
        switch state {
        case .failed, .locked, .stopped, .idle, .restarting:
            policy.reset()
            await launch()
        case .starting, .ready, .stopping:
            return
        }
    }

    /// Stops the server: SIGTERM, then SIGKILL if it is still running after the grace period. Returns once it
    /// has ended.
    public func stop() async {
        restartTask?.cancel()
        readyTimeoutTask?.cancel()
        confirmTask?.cancel()
        guard let child = process else {
            if case .idle = state { return }
            // A launch still preparing (reading the keys) finds its number stale and does not spawn
            generation += 1
            set(.stopped)
            return
        }
        stopRequested = true
        // A server being stopped is never confirmed: a probe that answers now finds no phase to publish from
        phase = .none
        set(.stopping)
        log.write("stopping process \(child.pid)", source: "app")
        child.terminate()
        let ended = await Self.exits(child, within: timing.stopGrace)
        if !ended {
            log.write("process \(child.pid) did not stop within \(timing.stopGrace); killing it", source: "app")
            child.kill()
            _ = await child.waitForExit()
        }
        // The exit is handled here; the watcher for this launch is now stale
        if process === child {
            generation += 1
            process = nil
            phase = .none
            set(.stopped)
        }
    }

    /// Hands new keys to the running server without a restart (Settings, N13).
    public func updateKeys() async {
        let keys = await keySource.keys()
        guard let child = process else { return }
        do {
            try child.send(SidecarProtocol.keysLine(keys: keys))
        } catch {
            log.write("could not hand over the keys: \(error)", source: "app")
        }
    }

    private static func exits(_ child: any SidecarProcess, within grace: Duration) async -> Bool {
        await withTaskGroup(of: Bool.self) { group in
            group.addTask { await child.waitForExit() != nil }
            group.addTask {
                try? await Task.sleep(for: grace)
                return false
            }
            let first = await group.next() ?? false
            group.cancelAll()
            return first
        }
    }

    /// " (N ms after the process started)", for the launch's log lines (the launch budget), or nothing when the process's
    /// start cannot be read.
    nonisolated static var sinceProcessStart: String {
        AppModel.processStarted.map { " (\(Int(Date().timeIntervalSince($0) * 1000)) ms after the process started)" } ?? ""
    }

    private func launch() async {
        restartTask?.cancel()
        generation += 1
        let launchNumber = generation
        lastFailure = nil
        pendingFailure = nil
        stopRequested = false
        phase = .none
        set(.starting)

        // A development build with no chosen folder never touches one
        guard configuration.dataFolderChosen else {
            log.write("no data folder chosen for this development build; not starting", source: "app")
            set(.failed(ServerFailure(kind: .noDataFolderChosen)))
            return
        }

        let manager = FileManager.default
        guard manager.isExecutableFile(atPath: configuration.nodeExecutable.plainPath),
              manager.fileExists(atPath: configuration.entry.plainPath) else {
            log.write("no server in the app bundle at \(configuration.serverRoot.plainPath)", source: "app")
            set(.failed(ServerFailure(kind: .notInstalled)))
            return
        }
        // The first-run backup, before any server starts on the folder (section 7.5). Every launch passes here (the
        // first start, Try Again from any state, a restart, a start after a restore), so none can skip it.
        guard await firstRunBackupAllowsLaunch(launch: launchNumber) else { return }
        guard launchNumber == generation, !stopRequested else { return }

        // The keys first, off the main thread and before anything is spawned: a slow Keychain delays the start,
        // never the handshake's 30 s
        let keys = await keySource.keys()
        guard launchNumber == generation, !stopRequested else { return }
        try? manager.createDirectory(at: configuration.dataFolder, withIntermediateDirectories: true)

        let token = SidecarProtocol.makeToken()
        let child: any SidecarProcess
        do {
            child = try launcher.launch(configuration.launchSpec())
        } catch {
            log.write("could not start the server: \(error)", source: "app")
            set(.failed(ServerFailure(kind: .couldNotLaunch, detail: String(describing: error))))
            return
        }
        process = child
        phase = .awaitingReady(token: token)
        log.write("started process \(child.pid) on \(configuration.dataFolder.plainPath)\(Self.sinceProcessStart)", source: "app")
        do {
            try child.send(SidecarProtocol.handshakeLine(token: token, keys: keys))
        } catch {
            // It has already gone; its exit is handled below
            log.write("could not write the handshake: \(error)", source: "app")
        }

        let log = log
        let reader = Task {
            for await line in child.outputLines { self.received(line, launch: launchNumber) }
        }
        Task.detached {
            for await line in child.errorLines { log.write(line, source: "server:stderr") }
        }
        Task {
            let exit = await child.waitForExit()
            // The last lines (a PENNANT_FAILED) are read before the exit is judged
            await reader.value
            if let exit { self.exited(exit, launch: launchNumber) }
        }
        let readyTimeout = timing.readyTimeout
        readyTimeoutTask = Task {
            try? await Task.sleep(for: readyTimeout)
            if !Task.isCancelled { self.readyTimedOut(launch: launchNumber) }
        }
    }

    /// Takes the first-run backup unless it is recorded, off the actor and the main thread. A folder another server
    /// holds is shown as locked without starting one; a backup that fails is a failure. Either way nothing spawns.
    private func firstRunBackupAllowsLaunch(launch launchNumber: Int) async -> Bool {
        let backups = backups
        let result = await Task.detached(priority: .userInitiated) { Result { try backups.backUpIfFirstRun() } }.value
        guard launchNumber == generation, !stopRequested else { return false }
        switch result {
        case .success(let outcome):
            backupOutcome = outcome
            switch outcome {
            case .backedUp(let record):
                let what = record.files.isEmpty ? "nothing (none of the files exist yet)" : record.files.joined(separator: ", ")
                log.write("first-run backup: \(what) to backups/\(record.folder)", source: "app")
                return true
            case .alreadyDone:
                return true
            case .folderInUse:
                log.write("the data folder is in use and has no first-run backup yet; not starting", source: "app")
                set(.locked(message: nil))
                return false
            }
        case .failure(let error):
            log.write("the first-run backup failed: \(error); not starting", source: "app")
            set(.failed(ServerFailure(kind: .backupFailed, detail: String(describing: error))))
            return false
        }
    }

    // MARK: What the process says

    private func received(_ line: String, launch launchNumber: Int) {
        guard launchNumber == generation else { return }
        log.write(line)
        switch SidecarProtocol.parse(line: line) {
        case .ready(let ready):
            guard case .awaitingReady(let token) = phase else { return }
            readyTimeoutTask?.cancel()
            log.write("the ready line arrived\(Self.sinceProcessStart)", source: "app")
            phase = .confirming
            confirmTask = Task { await self.confirm(ready, token: token, launch: launchNumber) }
        case .failed(let failure):
            lastFailure = failure
        case .log:
            break
        }
    }

    private func confirm(_ ready: SidecarReady, token: String, launch launchNumber: Int) async {
        var lastError: (any Error)?
        for attempt in 1...max(timing.statusAttempts, 1) {
            do {
                let status = try await probe(ready.port, token)
                guard launchNumber == generation, !stopRequested, case .confirming = phase, let child = process else { return }
                phase = .running(since: .now)
                log.write("ready on port \(ready.port)\(Self.sinceProcessStart)", source: "app")
                set(.ready(ServerConnection(port: ready.port, token: token, pid: child.pid, status: status)))
                return
            } catch {
                lastError = error
                if Task.isCancelled { return }
                if attempt < timing.statusAttempts { try? await Task.sleep(for: timing.statusRetryDelay) }
            }
        }
        guard launchNumber == generation, let child = process else { return }
        let detail = lastError.map { String(describing: $0) }
        guard case .confirming = phase, !stopRequested else { return }
        log.write("the status check failed: \(detail ?? "no answer")", source: "app")
        pendingFailure = ServerFailure(kind: .statusCheck, detail: detail)
        phase = .none
        endUnresponsive(child)
    }

    private func readyTimedOut(launch launchNumber: Int) {
        guard launchNumber == generation, case .awaitingReady = phase, let child = process else { return }
        log.write("no ready line within \(timing.readyTimeout)", source: "app")
        pendingFailure = ServerFailure(kind: .notReady)
        // Judged unusable: a ready line in the grace period finds no phase to be confirmed from
        phase = .none
        endUnresponsive(child)
    }

    /// SIGTERM, then SIGKILL after the grace period, for a server that will not be used. Callers clear `phase` first,
    /// so nothing the process says while it ends can make it ready.
    private func endUnresponsive(_ child: any SidecarProcess) {
        child.terminate()
        let grace = timing.stopGrace
        Task.detached {
            let ended = await Self.exits(child, within: grace)
            if !ended { child.kill() }
        }
    }

    private func exited(_ exit: ProcessExit, launch launchNumber: Int) {
        guard launchNumber == generation else { return }
        readyTimeoutTask?.cancel()
        confirmTask?.cancel()
        let runningSince: ContinuousClock.Instant? = if case .running(let since) = phase { since } else { nil }
        process = nil
        phase = .none
        let ending = SidecarExit(exit)
        log.write("process ended: \(ending)", source: "app")

        if stopRequested {
            set(.stopped)
            return
        }
        if let pendingFailure {
            set(.failed(pendingFailure))
            return
        }
        if ending == .locked || lastFailure?.isLocked == true {
            set(.locked(message: lastFailure?.message))
            return
        }
        if ending == .noHandshake {
            set(.failed(ServerFailure(kind: .handshake, serverMessage: lastFailure?.message)))
            return
        }
        if ending == .couldNotStart, let failure = lastFailure {
            log.write("the server could not start (\(failure.reason)); not retrying", source: "app")
            set(.failed(ServerFailure(kind: .startFailed, serverMessage: failure.message)))
            return
        }
        let now = ContinuousClock.now
        switch policy.recordCrash(at: now, upFor: runningSince.map { now - $0 }) {
        case .giveUp(let crashes):
            log.write("stopped after \(crashes) crashes inside \(policy.window)", source: "app")
            set(.failed(ServerFailure(kind: .crashedRepeatedly, serverMessage: lastFailure?.message)))
        case .restart(let delay, let attempt):
            log.write("restarting in \(delay) (attempt \(attempt))", source: "app")
            set(.restarting(attempt: attempt, after: delay))
            restartTask = Task {
                try? await Task.sleep(for: delay)
                if !Task.isCancelled { await self.restartAfterWait(launch: launchNumber) }
            }
        }
    }

    private func restartAfterWait(launch launchNumber: Int) async {
        guard launchNumber == generation, case .restarting = state else { return }
        await launch()
    }
}
