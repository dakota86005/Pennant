import Foundation
import Observation
import OpenAPIRuntime
import PennantAPI

/// The app's shared state (SWIFTUI_REBUILD.md section 6): the server's state, its status, the current club, how
/// current the data is, and the import under way. Every fact here is the server's, read through the generated
/// client or pushed on the event stream; the model decides nothing about baseball.
///
/// Stores reload with `.task(id: model.importStamp)`, which changes only when a new import lands.
@Observable @MainActor
public final class AppModel {
    public let configuration: ServerConfiguration
    public let backups: BackupManager

    /// Where the server is in its life.
    public private(set) var serverState: ServerState = .idle
    /// The latest `/api/status`, kept current by the event stream.
    public private(set) var status: Components.Schemas.ServerStatus?
    /// `/api/settings`: the preferences, the key state and the data folder the server uses.
    public private(set) var settings: Components.Schemas.SettingsResponse?
    /// `/api/orgs`: the major-league clubs.
    public private(set) var orgs: [Components.Schemas.Org] = []
    /// The club the app is about, as the server resolved it (configured, else human-managed).
    public private(set) var club: CurrentClub?
    /// `/api/v2/data-status`: how current the save, the export and the log are, in the server's words.
    public private(set) var dataStatus: Components.Schemas.DataStatusView?
    /// `/api/v2/catalog`: the glossary, the stat catalog, each club's palette, logo and record, the departments and heads.
    public private(set) var catalog: Components.Schemas.Catalog?
    /// The last import's finish time as the server reported it; changes only when a new import lands.
    public private(set) var importStamp = ""
    /// Counts successful backup restores; part of `storeKey`, so stores reload after one.
    public private(set) var restoreCount = 0
    /// Whether the event stream is connected.
    public private(set) var eventStreamConnected = false
    /// The latest events of a known type that did not decode (each also re-read `/api/status`; at most
    /// `keptEventProblems`).
    public private(set) var eventProblems: [EventProblem] = []
    /// What the first-run backup did on the latest launch (the controller takes it before every launch; a failure
    /// is the server state `.failed(.backupFailed)`).
    public private(set) var backupOutcome: BackupManager.Outcome?
    /// Why the last import the GM asked for did not start (⌘R, Import Now); nil when it started or was dismissed.
    public private(set) var importRequestProblem: RequestProblem?
    /// The last request that failed, for the log.
    public private(set) var lastRequestError: String?
    /// The client for the running server; nil while it is not ready.
    public private(set) var client: Client?

    /// How many event problems are kept (the log has them all).
    public static let keptEventProblems = 20

    public struct EventProblem: Sendable, Equatable {
        public var type: String
        public var at: Date
    }

    private nonisolated let controller: ServerController
    /// The server's controller, for the quit path (`QuitCoordinator` stops it off the main actor).
    public nonisolated var serverController: ServerController { controller }
    private let makeClient: @Sendable (ServerConnection) -> Client
    private var stateTask: Task<Void, Never>?
    private var eventTask: Task<Void, Never>?
    private var started = false
    private var shuttingDown = false

    public init(
        configuration: ServerConfiguration,
        controller: ServerController? = nil,
        makeClient: @escaping @Sendable (ServerConnection) -> Client = { PennantClient.make(port: $0.port, token: $0.token) }
    ) {
        self.configuration = configuration
        let controller = controller ?? ServerController(configuration: configuration)
        self.controller = controller
        self.backups = controller.backups
        self.makeClient = makeClient
    }

    #if DEBUG
    /// A model holding served payloads without a server, for `#Preview`s (fed by `contract/fixtures/`).
    public static func preview(
        configuration: ServerConfiguration,
        state: ServerState,
        status: Components.Schemas.ServerStatus? = nil,
        settings: Components.Schemas.SettingsResponse? = nil,
        orgs: [Components.Schemas.Org] = [],
        dataStatus: Components.Schemas.DataStatusView? = nil,
        catalog: Components.Schemas.Catalog? = nil,
        importRequestProblem: RequestProblem? = nil
    ) -> AppModel {
        let model = AppModel(configuration: configuration)
        model.serverState = state
        model.status = status ?? state.connection?.status
        model.settings = settings
        model.orgs = orgs
        model.dataStatus = dataStatus
        model.catalog = catalog
        model.importRequestProblem = importRequestProblem
        model.club = CurrentClub.from(served: settings?.organization, orgs: orgs)
        return model
    }
    #endif

    // MARK: What stores reload on

    /// What a department store keys its data on (`.task(id: model.storeKey)`): the last import, the current club,
    /// and the restores. Any of them changing means the served data may have changed.
    public struct StoreKey: Hashable, Sendable {
        public var importStamp: String
        public var club: ClubRef?
        public var restores: Int
    }

    /// Nil until the server is ready and its settings (with the served club) are read, so a store loads once at
    /// launch rather than once for the first status and again when the club arrives.
    public var storeKey: StoreKey? {
        guard client != nil, settings != nil else { return nil }
        return StoreKey(importStamp: importStamp, club: club?.ref, restores: restoreCount)
    }

    // MARK: Derived from the served status

    public var isImporting: Bool { status?.importing ?? false }
    public var importProgress: Components.Schemas.ImportProgress? { status?.importProgress }
    public var lastImport: Components.Schemas.ImportResult? { status?.lastImport }
    /// Why the import is not where it should be, in the server's words (a failure, an interruption, a missing export).
    public var importNote: Components.Schemas.ImportNote? { status?.importNote }
    /// The catalog's entry for the current club: its palette, logo and record, as served.
    public var catalogClub: Components.Schemas.CatalogClub? {
        guard let id = club?.ref.id else { return nil }
        return catalog?.clubs.first { $0.teamId == id }
    }
    /// When OOTP wrote the export that is imported (as served).
    public var exportedAt: String? { status?.csvExportedAt }
    /// Since when a fresh export has waited to be imported (as served).
    public var exportPendingSince: String? { status?.exportPending }
    /// The server is up and has no save chosen: the Setup window's cue (SWIFTUI_REBUILD.md section 3.1).
    public var needsSetup: Bool {
        guard serverState.connection != nil, let status else { return false }
        return !status.configured
    }
    /// The server is up and answered its status check.
    public var isReady: Bool { serverState.connection != nil }
    /// The server's log file, for Show Log.
    public var logFile: URL { configuration.logFile }
    /// The data folder the server reports, else the one it was started on.
    public var dataFolderPath: String { settings?.dataDir ?? configuration.dataFolder.plainPath }

    // MARK: Life

    /// Starts the server and follows it. The controller takes the first-run backup before every launch. Safe to
    /// call more than once; does nothing once a shutdown has begun.
    public func start() async {
        guard !started, !shuttingDown else { return }
        started = true
        let updates = await controller.stateUpdates()
        stateTask = Task { [weak self] in
            for await state in updates {
                guard let self else { return }
                self.apply(state)
                self.backupOutcome = await self.controller.backupOutcome
            }
        }
        await controller.start()
    }

    /// Try Again after a failure or a locked data folder (the backup is retried first, by the controller).
    public func tryAgain() async {
        guard !shuttingDown else { return }
        await controller.tryAgain()
    }

    /// The quit has begun: nothing starts a server from now on, and the event stream closes.
    public func beginShutdown() {
        shuttingDown = true
        eventTask?.cancel()
        eventTask = nil
    }

    /// Stops the server cleanly. Nothing starts a server afterwards. (The app's quit goes through `QuitCoordinator`,
    /// which does not depend on the main queue.)
    public func shutdown() async {
        beginShutdown()
        await controller.stop()
        apply(await controller.state)
    }

    /// Settings ▸ Restore backup: stop the server, put the first-run backup back, start it again. Returns the folder
    /// where the replaced files were put aside. The restore is all or nothing (`BackupManager.restore`): when it
    /// throws, the folder is as it was, so the server is started on it again either way. A successful restore moves
    /// `restoreCount`, so stores reload even though no import happened.
    @discardableResult
    public func restoreBackup() async throws -> URL {
        eventTask?.cancel()
        eventTask = nil
        await controller.stop()
        let backups = backups
        let result = await Task.detached(priority: .userInitiated) { Result { try backups.restore() } }.value
        if case .success = result { restoreCount += 1 }
        if !shuttingDown { await controller.start() }
        return try result.get()
    }

    // MARK: Asking the server to do something

    /// Club ▸ Refresh Data and Settings ▸ Import Now (React's `hardRefresh`): starts an import of the configured save's
    /// export. Progress arrives on the event stream, and when the import lands `importStamp` moves, so every store
    /// reloads. Returns nil when the import started, else why not: the server's own sentence when it refused (no save
    /// chosen, the export folder missing, an import already running), `.notRunning` without a server, or the kind of
    /// failure. The problem is also kept in `importRequestProblem`, so every window can show it.
    @discardableResult
    public func startImport() async -> RequestProblem? {
        let problem = await requestImport()
        importRequestProblem = problem
        if let detail = problem?.detail { logProblem("could not start an import: \(detail)") }
        return problem
    }

    private func requestImport() async -> RequestProblem? {
        guard let client else { return .notRunning }
        do {
            switch try await client.startImport() {
            case .ok:
                status?.importing = true
                return nil
            case .badRequest(let refused):
                return .served(try refused.body.json.error)
            case .conflict(let refused):
                return .served(try refused.body.json.error)
            case .undocumented(let code, let payload):
                return await .undocumented(code, body: payload.body, operation: "startImport", fromV2: false)
            }
        } catch {
            return .from(error)
        }
    }

    /// Clears the last import request's problem (the GM dismissed it).
    public func dismissImportRequestProblem() { importRequestProblem = nil }

    /// Saves preferences (`POST /api/settings`: the club the Setup window picked, the appearance); a field left nil
    /// keeps its value. The settings, the clubs and the current club are read again afterwards, so the served club
    /// (and with it `storeKey`) follows. Throws a `RequestProblem`; its raw detail goes to the log.
    public func saveSettings(_ update: Components.Schemas.SettingsUpdate) async throws(RequestProblem) {
        guard let client else { throw .notRunning }
        do {
            _ = try await client.saveSettings(body: .json(update)).ok
        } catch {
            let problem = RequestProblem.from(error)
            if let detail = problem.detail { logProblem("could not save the settings: \(detail)") }
            throw problem
        }
        await reloadAll()
    }

    /// Settings ▸ Club ▸ Automatic: forget the chosen club, so the app follows the club the save's human manages (the
    /// explicit `clubChoice` field; the generated client cannot send a null to clear `defaultOrgId`).
    public func chooseClubAutomatically() async throws(RequestProblem) {
        try await saveSettings(.init(clubChoice: .automatic))
    }

    /// A served file the API names by path (a club's logo, `/api/logo/…`), fetched with the launch's token; nil when the
    /// server is not running or the file is not there.
    public func servedFile(_ path: String) async -> Data? {
        guard let connection = serverState.connection else { return nil }
        return await PennantClient.data(path: path, port: connection.port, token: connection.token)
    }

    /// Writes a line to the server's log (a raw error a window shows only as a kind).
    public func logProblem(_ line: String) {
        controller.log.write(line, source: "app")
    }

    // MARK: Following the server

    private func apply(_ state: ServerState) {
        serverState = state
        guard let connection = state.connection else {
            eventTask?.cancel()
            eventTask = nil
            client = nil
            eventStreamConnected = false
            return
        }
        let client = makeClient(connection)
        self.client = client
        apply(status: connection.status, reload: false)
        eventTask?.cancel()
        let log = controller.log
        let events = EventClient(
            client: client,
            onUnknown: { type in log.write("ignored an event of a newer type: \(type)", source: "app") },
            onError: { problem in log.write(problem, source: "app") }
        )
        eventTask = Task { [weak self] in
            await events.run { signal in await self?.handle(signal) }
        }
        Task { await reloadAll() }
    }

    /// Applies one signal from the event stream.
    public func handle(_ signal: EventSignal) async {
        switch signal {
        case .connected:
            eventStreamConnected = true
        case .disconnected:
            eventStreamConnected = false
        case .malformed(let type):
            eventProblems.append(EventProblem(type: type, at: .now))
            eventProblems = Array(eventProblems.suffix(Self.keptEventProblems))
            controller.log.write("an event of type \(type) did not decode; re-reading the status", source: "app")
            await reloadStatus()
        case .event(let event):
            await apply(event)
        }
    }

    private func apply(_ event: Components.Schemas.ServerEvent) async {
        if let hello = event.value1 {
            apply(status: hello.status, reload: true)
        } else if event.value2 != nil {
            importRequestProblem = nil
            status?.importing = true
            status?.importProgress = nil
            status?.lastError = nil
            status?.importNote = nil
        } else if let progress = event.value3 {
            status?.importing = true
            status?.importProgress = progress.progress
        } else if let finished = event.value4 {
            if var next = status {
                next.importing = false
                next.importProgress = nil
                next.lastError = finished.error
                next.importNote = finished.note
                if let lastImport = finished.lastImport { next.lastImport = lastImport }
                apply(status: next, reload: true)
            }
            // The status says the rest (the export's time, a pending export)
            await reloadStatus()
        } else if let pending = event.value5 {
            status?.exportPending = pending.since
        }
        // `job` (value6): the storylines and briefing jobs arrive with N13
    }

    private func apply(status next: Components.Schemas.ServerStatus, reload: Bool) {
        status = next
        let stamp = next.lastImport?.finishedAt ?? ""
        guard stamp != importStamp else { return }
        importStamp = stamp
        if reload { Task { await reloadAll() } }
    }

    /// Re-reads `/api/status`.
    public func reloadStatus() async {
        guard let client else { return }
        do {
            apply(status: try await client.getStatus().ok.body.json, reload: true)
        } catch {
            note(error, reading: "status")
        }
    }

    /// Re-reads the settings, the clubs, the data status and the catalog, and resolves the current club again.
    public func reloadAll() async {
        guard let client else { return }
        async let settingsAnswer = client.getSettings()
        async let orgsAnswer = client.listOrgs()
        async let dataStatusAnswer = client.getDataStatusWords()
        async let catalogAnswer = client.getCatalog()
        do {
            settings = try await settingsAnswer.ok.body.json
        } catch {
            note(error, reading: "settings")
        }
        do {
            orgs = try await orgsAnswer.ok.body.json
        } catch {
            note(error, reading: "clubs")
        }
        do {
            dataStatus = try await dataStatusAnswer.ok.body.json
        } catch {
            note(error, reading: "data status")
        }
        do {
            catalog = try await catalogAnswer.ok.body.json
        } catch {
            note(error, reading: "catalog")
        }
        club = CurrentClub.from(served: settings?.organization, orgs: orgs)
    }

    private func note(_ error: any Error, reading what: String) {
        lastRequestError = "\(what): \(error)"
        controller.log.write("could not read the \(what): \(error)", source: "app")
    }
}
