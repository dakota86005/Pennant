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
    /// `/api/v2/theme-packs/:org`: the themes the current club can wear and the one it wears (Settings ▸ Appearance),
    /// read when Settings asks.
    public private(set) var themeChoices: Components.Schemas.ThemeChoices?
    /// The last import's finish time as the server reported it; changes only when a new import lands.
    public private(set) var importStamp = ""
    /// The server's current Front Office build for the club the app follows (`/api/status` and the
    /// `front-office-updated` event); part of `storeKey`, so the Front Office reloads when the server rebuilds.
    public private(set) var reportStamp = ""
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
    /// The Front Office's desk, cards and department reports (`FrontOfficeStore`), loaded on `storeKey`.
    public private(set) var frontOffice: FrontOfficeStore
    /// Another save (or a newer OOTP version's) played since the chosen one, as the server last said (`/api/status`
    /// and the `save-played-elsewhere` event; D-063): the sentence, the switch's label and the save. Nil when none.
    /// The app shows it (N6, Stage B2); Pennant never switches by itself.
    public private(set) var savePlayedElsewhere: Components.Schemas.SavePlayedElsewhere?
    /// When the first Morning Report was drawn, as milliseconds after the app's model was made, and whether it was
    /// the kept payload or a fresh one (the launch budget, SWIFTUI_REBUILD.md "The speed budgets"); nil until then.
    public private(set) var firstMorningReport: (afterMs: Int, kept: Bool)?

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
    /// When the model was made: the app's launch, as near as the app can time it.
    private let launched = ContinuousClock.now

    /// - Parameter keptReports: where the Morning Report is kept across launches; the configuration's caches folder
    ///   by default (the app's own, never the data folder). Tests give a scratch folder.
    public init(
        configuration: ServerConfiguration,
        controller: ServerController? = nil,
        keptReports: KeptReports? = nil,
        makeClient: @escaping @Sendable (ServerConnection) -> Client = { PennantClient.make(port: $0.port, token: $0.token) }
    ) {
        self.configuration = configuration
        let controller = controller ?? ServerController(configuration: configuration)
        self.controller = controller
        self.backups = controller.backups
        self.makeClient = makeClient
        let log = controller.log
        frontOffice = FrontOfficeStore(
            kept: keptReports ?? KeptReports(folder: configuration.cachesFolder.appending(path: "front-office", directoryHint: .isDirectory)),
            contractVersion: configuration.appVersion
        ) { line in log.write(line, source: "app") }
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
        themeChoices: Components.Schemas.ThemeChoices? = nil,
        importRequestProblem: RequestProblem? = nil,
        frontOffice: FrontOfficeStore? = nil
    ) -> AppModel {
        let model = AppModel(configuration: configuration)
        model.serverState = state
        model.status = status ?? state.connection?.status
        model.settings = settings
        model.orgs = orgs
        model.dataStatus = dataStatus
        model.catalog = catalog
        model.themeChoices = themeChoices
        model.importRequestProblem = importRequestProblem
        model.club = CurrentClub.from(served: settings?.organization, orgs: orgs)
        if let frontOffice { model.frontOffice = frontOffice }
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
        /// The server's current Front Office build (`reportStamp`), empty before one is kept: it moves whenever the
        /// server builds again without a new import (a settings change, a calibration, the live log).
        public var reportStamp: String
        /// The chosen save's id as the status serves it (D-063); nil with no save chosen. A payload kept across
        /// launches is read only for this save (`KeptReports`).
        public var saveId: String?

        public init(importStamp: String, club: ClubRef?, restores: Int, reportStamp: String = "", saveId: String? = nil) {
            self.importStamp = importStamp
            self.club = club
            self.restores = restores
            self.reportStamp = reportStamp
            self.saveId = saveId
        }
    }

    /// Nil until the server is ready and its settings (with the served club) are read, so a store loads once at
    /// launch rather than once for the first status and again when the club arrives.
    public var storeKey: StoreKey? {
        guard client != nil, settings != nil else { return nil }
        return StoreKey(importStamp: importStamp, club: club?.ref, restores: restoreCount, reportStamp: reportStamp, saveId: status?.saveId)
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

    /// The club a theme request is about: the current club, else the one the server follows.
    private var themeOrg: String { club.map { String($0.ref.id) } ?? "automatic" }

    /// Reads the themes the current club can wear (`GET /api/v2/theme-packs/:org`). Throws the server's sentence or a
    /// kind of failure; its raw detail goes to the log.
    public func loadThemeChoices() async throws(RequestProblem) {
        guard let client else { throw .notRunning }
        let problem: RequestProblem
        do {
            switch try await client.getThemeChoices(path: .init(org: themeOrg)) {
            case .ok(let answer):
                themeChoices = try answer.body.json
                return
            case .notFound(let refused):
                problem = .served(try refused.body.json.error)
            case .undocumented(let code, let payload):
                problem = await .undocumented(code, body: payload.body, operation: "getThemeChoices", fromV2: true)
            }
        } catch {
            problem = .from(error)
        }
        if let detail = problem.detail { logProblem("could not read the theme packs: \(detail)") }
        throw problem
    }

    /// Chooses the theme the current club wears (`POST /api/v2/theme-packs/:org`; `club-colors` for its own colours),
    /// then reads the catalog again, so every window wears it. Throws the server's sentence when it refuses.
    public func chooseTheme(_ packId: String) async throws(RequestProblem) {
        guard let client else { throw .notRunning }
        let problem: RequestProblem
        do {
            switch try await client.chooseTheme(path: .init(org: themeOrg), body: .json(.init(packId: packId))) {
            case .ok(let answer):
                themeChoices = try answer.body.json
                await reloadAll()
                return
            case .badRequest(let refused):
                problem = .served(try refused.body.json.error)
            case .notFound(let refused):
                problem = .served(try refused.body.json.error)
            case .undocumented(let code, let payload):
                problem = await .undocumented(code, body: payload.body, operation: "chooseTheme", fromV2: true)
            }
        } catch {
            problem = .from(error)
        }
        if let detail = problem.detail { logProblem("could not choose the theme: \(detail)") }
        throw problem
    }

    /// A served file the API names by path (a club's logo, `/api/logo/…`), fetched with the launch's token; nil when the
    /// server is not running or the file is not there.
    public func servedFile(_ path: String) async -> Data? {
        guard let connection = serverState.connection else { return nil }
        return await PennantClient.data(path: path, port: connection.port, token: connection.token)
    }

    /// Loads the Morning Report's desk and cards for the current key (a view calls it in `.task(id: storeKey)`).
    public func loadFrontOffice() async {
        await frontOffice.loadSummary(client: client, key: storeKey)
    }

    /// Loads one department's report for the current key.
    public func loadReport(_ department: DeptID) async {
        await frontOffice.loadReport(department.rawValue, client: client, key: storeKey)
    }

    /// Fetches the evidence trail behind an item, on demand.
    public func loadTrail(_ evidence: String) async {
        await frontOffice.loadTrail(evidence, client: client, key: storeKey)
    }

    /// Writes a line to the server's log (a raw error a window shows only as a kind).
    public func logProblem(_ line: String) {
        controller.log.write(line, source: "app")
    }

    // MARK: Following the server

    /// Milliseconds since the model was made (the launch, as near as the app can time it).
    private var sinceLaunchMs: Int { Int((ContinuousClock.now - launched) / .milliseconds(1)) }
    private var loggedReady = false
    private var loggedKey = false

    private func apply(_ state: ServerState) {
        serverState = state
        if state.connection != nil, !loggedReady {
            loggedReady = true
            controller.log.write("server ready \(sinceLaunchMs) ms after launch", source: "app")
        }
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
        // Each event by its shape (`ServerEvent.kind`), never by its position in the union
        switch event.kind {
        case .hello(let hello):
            apply(status: hello.status, reload: true)
        case .importStarted:
            importRequestProblem = nil
            status?.importing = true
            status?.importProgress = nil
            status?.lastError = nil
            status?.importNote = nil
        case .importProgress(let progress):
            status?.importing = true
            status?.importProgress = progress.progress
        case .importFinished(let finished):
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
        case .exportPending(let pending):
            status?.exportPending = pending.since
        case .frontOfficeUpdated(let updated):
            // A new Front Office build is kept: follow it only for the club the app shows (with no club known yet, the
            // next status read carries the stamp)
            if let shown = club?.ref.id, shown == updated.orgId { reportStamp = updated.reportStamp }
        case .savePlayedElsewhere(let played):
            // The minute's look changed what it says (first seen, another save, cleared): as the status would serve it
            savePlayedElsewhere = played.savePlayedElsewhere
            status?.savePlayedElsewhere = played.savePlayedElsewhere
        case .job, nil:
            // The storylines and briefing jobs arrive with N13
            break
        }
    }

    /// The Morning Report was drawn for the first time this launch: the time since the app's model was made, and
    /// whether it was the kept payload (the view says so once; a later call changes nothing).
    public func noteMorningReportDrawn(kept: Bool) {
        guard firstMorningReport == nil else { return }
        let ms = sinceLaunchMs
        firstMorningReport = (ms, kept)
        let how = ["fresh from the server", "from the kept payload"][kept ? 1 : 0]
        controller.log.write("first Morning Report drawn \(ms) ms after launch, \(how)", source: "app")
    }

    private func apply(status next: Components.Schemas.ServerStatus, reload: Bool) {
        status = next
        savePlayedElsewhere = next.savePlayedElsewhere
        if let served = next.reportStamp, served != reportStamp { reportStamp = served }
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

    /// Re-reads the settings, the clubs, the data status and the catalog, and resolves the current club again. The
    /// settings, the clubs and the club they resolve to land together, and first: `storeKey` never appears with the
    /// settings but before the club (a store would load twice, and another club's build could be followed), and it
    /// does not wait on the data status and the catalog, so the Morning Report kept from the last launch is drawn as
    /// soon as the club is known (N6, Stage B1: the launch budget).
    public func reloadAll() async {
        guard let client else { return }
        async let settingsAnswer = client.getSettings()
        async let orgsAnswer = client.listOrgs()
        async let dataStatusAnswer = client.getDataStatusWords()
        async let catalogAnswer = client.getCatalog()
        var nextSettings = settings
        var nextOrgs = orgs
        do {
            nextSettings = try await settingsAnswer.ok.body.json
        } catch {
            note(error, reading: "settings")
        }
        do {
            nextOrgs = try await orgsAnswer.ok.body.json
        } catch {
            note(error, reading: "clubs")
        }
        orgs = nextOrgs
        club = CurrentClub.from(served: nextSettings?.organization, orgs: nextOrgs)
        settings = nextSettings
        if storeKey != nil, !loggedKey {
            loggedKey = true
            controller.log.write("store key known \(sinceLaunchMs) ms after launch", source: "app")
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
    }

    private func note(_ error: any Error, reading what: String) {
        lastRequestError = "\(what): \(error)"
        controller.log.write("could not read the \(what): \(error)", source: "app")
    }
}
