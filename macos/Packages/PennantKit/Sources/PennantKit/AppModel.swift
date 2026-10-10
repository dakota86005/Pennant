import Darwin
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
    /// The notices the GM dismissed in the main window, per save (kept in the app's own caches folder).
    public let notices: NoticeMemory

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
    /// Moves whenever the server's AI keys may have changed: a server (re)started reads the Keychain anew, and
    /// `updateKeys()` hands it new ones. Whatever says whether AI is on (the Trade Desk) reads again when it moves.
    public private(set) var keysRevision = 0
    /// The desk and follow steps on the windows' undo managers (`Attention.swift`), and the save and club they were made
    /// for: taken off when either moves (M7).
    @ObservationIgnored var undoSteps: [UndoRegistration] = []
    @ObservationIgnored var undoScope: UndoScope?
    /// The Front Office's desk, cards and department reports (`FrontOfficeStore`), loaded on `storeKey`.
    public private(set) var frontOffice: FrontOfficeStore
    /// What the GM follows (`FollowingStore`, N7): the sidebar's Following section, loaded on `storeKey` and the served
    /// follow stamp.
    public private(set) var following: FollowingStore
    /// Around the league (`LeagueStore`, N7): the full wire, each club's report for its window, and search.
    public private(set) var league: LeagueStore
    /// Farm & Development's views (`FarmStore`, N10), loaded on `storeKey`.
    public private(set) var farm: FarmStore
    /// Major League Ops' views and decisions (`MajorLeagueStore`, N8), loaded on `storeKey`.
    public private(set) var majorLeague: MajorLeagueStore
    /// Major League Ops' clubhouse tools (`ClubhouseStore`, N9), loaded on `storeKey`.
    public private(set) var clubhouse: ClubhouseStore
    /// Finance's and Medical's views (`OfficeStore`, N12), loaded on `storeKey`.
    public private(set) var office: OfficeStore
    /// League Office's views (`LeagueOfficeStore`, N12 Track B), loaded on `storeKey`.
    public private(set) var leagueOffice: LeagueOfficeStore
    /// Scouting's views (`ScoutingStore`, N12 Track B), loaded on `storeKey`.
    public private(set) var scouting: ScoutingStore
    /// The player windows and Compare (N11): each player's dossier, the GM's notes, comparisons.
    public private(set) var players: PlayerStore
    /// Trades (`TradesStore`, N12 Track C): the Trade Desk, the deal on the builder and the optional AI desk.
    public private(set) var trades: TradesStore
    /// Philosophy & Staff (`PhilosophyStore`, N12 Track C): the philosophy editor and Coaching Staff.
    public private(set) var philosophy: PhilosophyStore
    /// The Staff room (`StaffRoomStore`, N13): who can be asked, the conversations, an answer streaming in.
    public private(set) var staffRoom: StaffRoomStore
    /// Storylines and the GM Briefing (`AiWritingStore`, N13), read again when the server's `job` event says one ended.
    public private(set) var writing: AiWritingStore
    /// Where the AI keys are kept (N13): the app's own Keychain items, or memory in tests. The server is handed them on
    /// stdin at its start and again after each change (`saveKey`, `removeKey`); the server never keeps them.
    public nonisolated let keyStore: any KeyStore
    /// The club question still open for the chosen save, as the server last said on the status or the settings (N7,
    /// D-063's club question): while it is set the window holds the report and asks, across a relaunch. Nil when none.
    public private(set) var clubOwed: Components.Schemas.ClubOwed?
    /// Runs when a new import's "since the last export" is ready for the club the app follows (`changes-ready`): the
    /// app target posts the served notification when it isn't frontmost. Nil does nothing.
    public var onChangesReady: (@MainActor (Components.Schemas.ChangesReadyEvent) -> Void)?
    /// Another save (or a newer OOTP version's) played since the chosen one, as the server last said (`/api/status`
    /// and the `save-played-elsewhere` event; D-063): the sentence, the switch's label and the save. Nil when none.
    /// The app shows it (N6, Stage B2); Pennant never switches by itself.
    public private(set) var savePlayedElsewhere: Components.Schemas.SavePlayedElsewhere?
    /// `GET /api/v2/rating-history` (D-064): this save's history in words, the questions to ask (an earlier save whose
    /// folder has gone, or this folder's own history set aside), the other histories the GM may carry over and the
    /// carry-overs in force. Read with the rest after each import; every answer redraws it from the server's reply.
    public private(set) var ratingHistory: Components.Schemas.RatingHistoryView?
    /// Why the rating history could not be read; nil when it was.
    public private(set) var ratingHistoryProblem: RequestProblem?
    /// When the first Morning Report's frame was drawn, as milliseconds after the process started (after the model was
    /// made if the process's start cannot be read), and whether it was the kept payload or a fresh one (the launch
    /// budget, SWIFTUI_REBUILD.md "The speed budgets"); nil until then.
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
    /// - Parameter keys: where the AI keys are kept; by default this app's Keychain items (`KeychainKeyStore` for the
    ///   bundle id), or memory when a controller is given (tests never touch the Keychain).
    public init(
        configuration: ServerConfiguration,
        controller: ServerController? = nil,
        keptReports: KeptReports? = nil,
        keys: (any KeyStore)? = nil,
        makeClient: @escaping @Sendable (ServerConnection) -> Client = { PennantClient.make(port: $0.port, token: $0.token) }
    ) {
        self.configuration = configuration
        let keyStore: any KeyStore = keys ?? (controller == nil
            ? KeychainKeyStore(service: KeychainKeyStore.service(forBundleID: Bundle.main.bundleIdentifier))
            : MemoryKeyStore())
        self.keyStore = keyStore
        let controller = controller ?? ServerController(configuration: configuration, keySource: keyStore)
        self.controller = controller
        self.backups = controller.backups
        self.makeClient = makeClient
        notices = NoticeMemory(folder: configuration.cachesFolder)
        let log = controller.log
        frontOffice = FrontOfficeStore(
            kept: keptReports ?? KeptReports(folder: configuration.cachesFolder.appending(path: "front-office", directoryHint: .isDirectory)),
            contract: contractDigest
        ) { line in log.write(line, source: "app") }
        following = FollowingStore { line in log.write(line, source: "app") }
        league = LeagueStore { line in log.write(line, source: "app") }
        farm = FarmStore { line in log.write(line, source: "app") }
        majorLeague = MajorLeagueStore { line in log.write(line, source: "app") }
        clubhouse = ClubhouseStore { line in log.write(line, source: "app") }
        office = OfficeStore { line in log.write(line, source: "app") }
        leagueOffice = LeagueOfficeStore { line in log.write(line, source: "app") }
        scouting = ScoutingStore { line in log.write(line, source: "app") }
        players = PlayerStore { line in log.write(line, source: "app") }
        trades = TradesStore { line in log.write(line, source: "app") }
        philosophy = PhilosophyStore { line in log.write(line, source: "app") }
        staffRoom = StaffRoomStore { line in log.write(line, source: "app") }
        writing = AiWritingStore { line in log.write(line, source: "app") }
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
        frontOffice: FrontOfficeStore? = nil,
        ratingHistory: Components.Schemas.RatingHistoryView? = nil,
        savePlayedElsewhere: Components.Schemas.SavePlayedElsewhere? = nil,
        following: FollowingStore? = nil,
        league: LeagueStore? = nil,
        farm: FarmStore? = nil,
        majorLeague: MajorLeagueStore? = nil,
        clubhouse: ClubhouseStore? = nil,
        players: PlayerStore? = nil,
        office: OfficeStore? = nil,
        leagueOffice: LeagueOfficeStore? = nil,
        scouting: ScoutingStore? = nil,
        trades: TradesStore? = nil,
        philosophy: PhilosophyStore? = nil,
        staffRoom: StaffRoomStore? = nil,
        writing: AiWritingStore? = nil
    ) -> AppModel {
        let model = AppModel(configuration: configuration, keys: MemoryKeyStore())
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
        model.ratingHistory = ratingHistory
        model.savePlayedElsewhere = savePlayedElsewhere ?? model.status?.savePlayedElsewhere
        if let following { model.following = following }
        if let league { model.league = league }
        if let farm { model.farm = farm }
        if let majorLeague {
            model.majorLeague = majorLeague
            majorLeague.previewAdopt(model.storeKey)
        }
        if let clubhouse {
            model.clubhouse = clubhouse
            clubhouse.previewAdopt(model.storeKey)
        }
        if let players { model.players = players }
        if let office {
            model.office = office
            office.previewAdopt(model.storeKey)
        }
        if let leagueOffice {
            model.leagueOffice = leagueOffice
            leagueOffice.previewAdopt(model.storeKey)
        }
        if let scouting {
            model.scouting = scouting
            scouting.previewAdopt(model.storeKey)
        }
        if let trades { model.trades = trades }
        if let philosophy { model.philosophy = philosophy }
        if let staffRoom { model.staffRoom = staffRoom }
        if let writing { model.writing = writing }
        model.clubOwed = model.status?.clubOwed ?? settings?.clubOwed
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
    /// The catalog's entry for the current club: its palette, logo and record, as served. Until the catalog arrives, the
    /// entry the shown Morning Report was kept with (the same club's), so a kept report is drawn in the club's colours
    /// at once, as the live one is (N6 B1 review M5).
    public var catalogClub: Components.Schemas.CatalogClub? {
        // A switch under way: the report on screen is another save's or club's, and its club is drawn with it
        if let held = heldCatalog { return held.club }
        guard let id = club?.ref.id else {
            // Before the club is served (a launch): the club the report kept last is for, for its card and colours only
            return settings == nil ? frontOffice.waitingKept?.kept.catalog?.club : nil
        }
        if let catalog { return catalog.clubs.first { $0.teamId == id } }
        return (frontOffice.keptCatalog ?? frontOffice.waitingKept?.kept.catalog)?.club.flatMap { $0.teamId == id ? $0 : nil }
    }

    /// The catalog the report on screen was drawn with, while that report is another save's or club's than the key's
    /// (a switch, until the new save's report lands): the club card, the colours and the report stay together, and the
    /// report says it is updating (N6 polish: the real-save check saw the new save's club card over the old save's
    /// department cards). Nil otherwise.
    public var heldCatalog: KeptReports.Catalog? { frontOffice.heldCatalog(for: storeKey) }

    /// What the sidebar's club card draws: the club (its served name, how it was chosen, its record), from the same place
    /// as the colours and the report (`catalogClub`); at launch, before the club is served, the club the report kept last
    /// is for, so the card is there from the first frame (N6 polish); nil with no club.
    public struct ClubCard: Equatable, Sendable {
        public var name: String
        public var source: CurrentClub.Source?
        public var record: Components.Schemas.Cell?
        /// The served club is not in this save's club list (a configured club from another save).
        public var notInSave: Bool
    }

    public var clubCard: ClubCard? {
        // The club question is open (N7): the card claims no club until the GM answers it
        if clubOwed != nil { return nil }
        if let held = heldCatalog, let club = held.club {
            return ClubCard(name: club.name, source: CurrentClub.Source.from(servedWord: held.clubSource), record: club.record, notInSave: false)
        }
        if let club {
            guard let org = club.org else { return ClubCard(name: "", source: club.source, record: nil, notInSave: true) }
            return ClubCard(name: org.label, source: club.source, record: catalogClub?.record, notInSave: false)
        }
        guard settings == nil, let waiting = frontOffice.waitingKept?.kept.catalog, let kept = waiting.club else { return nil }
        return ClubCard(name: kept.name, source: CurrentClub.Source.from(servedWord: waiting.clubSource), record: kept.record, notInSave: false)
    }
    /// The catalog's phrases (the legends, the missing-value line); the kept ones until the catalog arrives.
    public var phrases: Components.Schemas.CatalogPhrases? {
        catalog?.phrases ?? frontOffice.keptCatalog?.phrases ?? frontOffice.waitingKept?.kept.catalog?.phrases
    }
    /// What a kept Morning Report is drawn with next launch: the club's catalog entry, the phrases and the report's
    /// served name, as the live catalog serves them now; nil until the catalog is here.
    var keptCatalogNow: KeptReports.Catalog? {
        guard let catalog, let id = club?.ref.id, let entry = catalog.clubs.first(where: { $0.teamId == id }) else { return nil }
        let name = catalog.departments.first { ($0.id.value1?.rawValue ?? $0.id.value2) == "frontOffice" }?.views.first { $0.id == "morningReport" }?.name
        return KeptReports.Catalog(club: entry, phrases: catalog.phrases, viewName: name, clubSource: club?.source.servedWord)
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
        // Started already, before the windows were built: the updates begin with where it has got to
        if !startedEarly { await controller.start() }
    }

    private var startedEarly = false

    /// Starts the server at once, off the main actor, before the app's windows are built (the app delegate's making;
    /// N6 polish: the launch budget, where the start waited about half a second for the window); `start()` then only
    /// follows it. Does nothing once started or shutting down.
    public func startEarly() {
        guard !started, !startedEarly, !shuttingDown else { return }
        startedEarly = true
        let controller = controller
        let makeClient = makeClient
        // The settings and the clubs (the store key) are asked the moment the server is confirmed, off the main actor,
        // while the window is still being built: the first `reloadAll` takes their answers (N6 polish: the key was
        // asked only once the window was up, and then waited behind the server's start-up work)
        firstKeyAnswers = Task.detached(priority: .userInitiated) {
            let updates = await controller.stateUpdates()
            for await state in updates {
                if let connection = state.connection {
                    let client = makeClient(connection)
                    async let settings = Self.attempt { try await client.getSettings().ok.body.json }
                    async let orgs = Self.attempt { try await client.listOrgs().ok.body.json }
                    return FirstKeyAnswers(pid: connection.pid, settings: await settings, orgs: await orgs)
                }
                switch state {
                case .failed, .locked, .stopped, .stopping: return nil
                case .idle, .starting, .ready, .restarting: continue
                }
            }
            return nil
        }
        Task.detached(priority: .userInitiated) { await controller.start() }
    }

    /// The settings and the clubs asked the moment the server was first confirmed (`startEarly`), for the first key.
    struct FirstKeyAnswers: Sendable {
        var pid: Int32
        var settings: Result<Components.Schemas.SettingsResponse, any Error>
        var orgs: Result<[Components.Schemas.Org], any Error>
    }
    private var firstKeyAnswers: Task<FirstKeyAnswers?, Never>?

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
        if case .success = result {
            restoreCount += 1
            // The folder now holds another state of the save: no report kept from before it is drawn
            await frontOffice.forgetKept()
        }
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
        await frontOffice.loadSummary(client: client, key: storeKey, catalog: keptCatalogNow)
        await frontOffice.keep(catalog: keptCatalogNow, for: storeKey)
    }

    /// Loads one department's report for the current key.
    public func loadReport(_ department: DeptID) async {
        await frontOffice.loadReport(department.rawValue, client: client, key: storeKey)
    }

    /// Fetches the evidence trail behind an item, on demand.
    public func loadTrail(_ evidence: String) async {
        await frontOffice.loadTrail(evidence, client: client, key: storeKey)
    }

    /// Loads one of Major League Ops' views for the current key (N8).
    public func loadMajorLeague(_ view: MajorLeagueStore.View) async {
        await majorLeague.load(view, client: client, key: storeKey)
    }

    /// Opens one Major League Ops decision for the current key: built by the server on its first open.
    public func loadDecision(_ query: MajorLeagueStore.DecisionQuery) async {
        await majorLeague.loadDecision(query, client: client, key: storeKey)
    }

    // MARK: Rating history (D-064): the GM decides, and nothing is lost for good

    /// Reads this save's rating history (`GET /api/v2/rating-history`). A failed read keeps what was shown and says so.
    public func loadRatingHistory() async {
        guard let client else { return }
        do {
            ratingHistory = try await client.getRatingHistory().ok.body.json
            ratingHistoryProblem = nil
        } catch {
            let problem = RequestProblem.from(error)
            if let detail = problem.detail { logProblem("could not read the rating history: \(detail)") }
            ratingHistoryProblem = problem
        }
    }

    /// The GM's answer to a rating-history question, or a carry-over or undo from Settings
    /// (`POST /api/v2/rating-history/choice`): the view is redrawn from the server's reply, and the data status (its
    /// sentence about this save's history) is read again. A carry-over and an undo change what the reports read: the
    /// server builds the Front Office again and says so (`front-office-updated`), which reloads the report. Throws the
    /// server's sentence when it refuses (an answer that no longer fits), or the kind of failure.
    public func answerRatingHistory(_ offerId: String, choice: Components.Schemas.RatingHistoryChoice.ChoicePayload.Value1Payload) async throws(RequestProblem) {
        guard let client else { throw .notRunning }
        let problem: RequestProblem
        do {
            switch try await client.answerRatingHistoryOffer(body: .json(.init(offerId: offerId, choice: .init(value1: choice, value2: choice.rawValue)))) {
            case .ok(let answer):
                ratingHistory = try answer.body.json
                ratingHistoryProblem = nil
                if let words = try? await client.getDataStatusWords().ok.body.json { dataStatus = words }
                return
            case .badRequest(let refused):
                problem = .served(try refused.body.json.error)
            case .undocumented(let code, let payload):
                problem = await .undocumented(code, body: payload.body, operation: "answerRatingHistoryOffer", fromV2: true)
            }
        } catch {
            problem = .from(error)
        }
        if let detail = problem.detail { logProblem("could not answer the rating-history question: \(detail)") }
        throw problem
    }

    /// Writes a line to the server's log (a raw error a window shows only as a kind).
    public func logProblem(_ line: String) {
        controller.log.write(line, source: "app")
    }

    // MARK: Following the server

    /// Milliseconds since the model was made.
    private var sinceLaunchMs: Int { Int((ContinuousClock.now - launched) / .milliseconds(1)) }

    /// When this process started, as the kernel records it (the launch as the Dock, Finder or a test began it): the
    /// launch budget is measured from here, not from the model's making (N6 B1 review M9). Nil if it cannot be read.
    public nonisolated static let processStarted: Date? = {
        var info = kinfo_proc()
        var size = MemoryLayout<kinfo_proc>.stride
        var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
        guard sysctl(&mib, u_int(mib.count), &info, &size, nil, 0) == 0, size > 0 else { return nil }
        let start = info.kp_proc.p_un.__p_starttime
        return Date(timeIntervalSince1970: TimeInterval(start.tv_sec) + TimeInterval(start.tv_usec) / 1_000_000)
    }()

    /// Milliseconds since this process started; nil if its start cannot be read.
    private var sinceProcessStartMs: Int? { Self.processStarted.map { Int(Date().timeIntervalSince($0) * 1000) } }

    /// "N ms after launch (M ms after the process started)": both clocks, for the log.
    private var launchClock: String {
        "\(sinceLaunchMs) ms after launch" + (sinceProcessStartMs.map { " (\($0) ms after the process started)" } ?? "")
    }
    private var loggedReady = false
    private var loggedKey = false

    private func apply(_ state: ServerState) {
        // A server that (re)started (a new connection) read the Keychain's keys afresh
        if let connection = state.connection, connection != serverState.connection { keysRevision += 1 }
        serverState = state
        if state.connection != nil, !loggedReady {
            loggedReady = true
            controller.log.write("server ready \(launchClock)", source: "app")
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
        // The settings and the clubs (the store key) are asked for first, before anything else this turn: the window's
        // shell is already built (N6, Stage B2), so the kept report waits only on the server's answer
        Task { await reloadAll() }
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
        case .job(let job):
            // Storylines or the briefing finished (or started) writing for the club the app shows: read it again, no
            // polling (N13)
            guard club?.ref.id == job.orgId, let piece = AiWritingStore.Piece(rawValue: job.kind) else { return }
            await writing.load(piece, client: client, key: storeKey, keysRevision: keysRevision, force: true)
        case nil:
            break
        case .deskChanged(let changed):
            // A status changed (another window, an import that resolved items, a change served with no desk): the desk is
            // read again when its stamp is not the one shown, for the club the app shows
            guard club?.ref.id == changed.orgId else { return }
            await frontOffice.reloadDesk(stamp: changed.deskStamp, client: client, key: storeKey)
            await frontOffice.keep(catalog: keptCatalogNow, for: storeKey)
        case .followingChanged(let changed):
            guard changed.followStamp != following.following?.followStamp else { return }
            await following.load(client: client, key: storeKey, stamp: changed.followStamp)
            // Following orders the wire (followed first): the summary is composed again on the same build
            await frontOffice.refreshQuietly(client: client, key: storeKey)
        case .changesReady(let ready):
            // Only for the club the app shows; the words are the server's
            guard club?.ref.id == ready.orgId else { return }
            onChangesReady?(ready)
        }
    }

    /// The Morning Report's first frame was drawn this launch (the view calls it once the frame is committed): the time
    /// since the process started (the launch budget's measure) and since the model was made, and whether it was the
    /// kept payload. Once a launch; a later call changes nothing.
    public func noteMorningReportDrawn(kept: Bool) {
        guard firstMorningReport == nil else { return }
        firstMorningReport = (sinceProcessStartMs ?? sinceLaunchMs, kept)
        let how = ["fresh from the server", "from the kept payload"][kept ? 1 : 0]
        controller.log.write("first Morning Report drawn \(launchClock), \(how)", source: "app")
    }

    /// One of the launch's own steps (the app delegate made, the launch finished, the window's first appearance), with
    /// its time from the process's start, for the log: where the launch budget goes. Each step is logged once.
    public func noteLaunchStep(_ step: String) {
        guard !loggedSteps.contains(step) else { return }
        loggedSteps.insert(step)
        controller.log.write("launch: \(step) \(launchClock)", source: "app")
    }
    private var loggedSteps: Set<String> = []

    private var loggedUpdating = false
    /// The Morning Report's kicker says "Updating" (the kept report, or a fresh one on its way): logged once a launch,
    /// so the launch test can tell it was drawn however briefly.
    public func noteMorningReportUpdating() {
        guard !loggedUpdating else { return }
        loggedUpdating = true
        controller.log.write("the Morning Report said Updating \(launchClock)", source: "app")
    }

    private func apply(status next: Components.Schemas.ServerStatus, reload: Bool) {
        status = next
        settleUndoScope()
        clubOwed = next.clubOwed
        savePlayedElsewhere = next.savePlayedElsewhere
        if let served = next.reportStamp, served != reportStamp { reportStamp = served }
        majorLeague.follow(storeKey)
        clubhouse.follow(storeKey)
        office.follow(storeKey)
        leagueOffice.follow(storeKey)
        scouting.follow(storeKey)
        trades.follow(storeKey)
        philosophy.follow(storeKey)
        staffRoom.follow(storeKey)
        writing.follow(storeKey)
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
        // The settings and the clubs (the store key) first and alone, asked off the main actor so they leave at once even
        // while the window is busy drawing, and answered before the data status and the catalog are asked (N6 polish:
        // the launch budget; the four at once reached the server in any order)
        let settingsAnswer: Result<Components.Schemas.SettingsResponse, any Error>
        let orgsAnswer: Result<[Components.Schemas.Org], any Error>
        // The first time, the answers asked when the server was confirmed (this server's, not a restarted one's)
        let early = await firstKeyAnswers?.value
        firstKeyAnswers = nil
        if let early, early.pid == serverState.connection?.pid {
            (settingsAnswer, orgsAnswer) = (early.settings, early.orgs)
        } else {
            (settingsAnswer, orgsAnswer) = await Task.detached(priority: .userInitiated) {
                async let settings = Self.attempt { try await client.getSettings().ok.body.json }
                async let orgs = Self.attempt { try await client.listOrgs().ok.body.json }
                return await (settings, orgs)
            }.value
        }
        var nextSettings = settings
        var nextOrgs = orgs
        switch settingsAnswer {
        case .success(let answer): nextSettings = answer
        case .failure(let error): note(error, reading: "settings")
        }
        switch orgsAnswer {
        case .success(let answer): nextOrgs = answer
        case .failure(let error): note(error, reading: "clubs")
        }
        orgs = nextOrgs
        club = CurrentClub.from(served: nextSettings?.organization, orgs: nextOrgs)
        settleUndoScope()
        settings = nextSettings
        // The settings are the fresher word on the club question when they were just read (a club saved clears it)
        if case .success(let answer) = settingsAnswer { clubOwed = answer.clubOwed }
        // Answered, whether or not they succeeded: the club card of the report kept last stays only for the key's own
        // save and club (N6 polish review: a failed answer left it drawn for a club never confirmed)
        frontOffice.settleWaitingKept(for: storeKey)
        // Another save or club: Major League Ops drops what it holds at once (never another club's view)
        majorLeague.follow(storeKey)
        clubhouse.follow(storeKey)
        office.follow(storeKey)
        leagueOffice.follow(storeKey)
        scouting.follow(storeKey)
        trades.follow(storeKey)
        philosophy.follow(storeKey)
        staffRoom.follow(storeKey)
        writing.follow(storeKey)
        if storeKey != nil, !loggedKey {
            loggedKey = true
            controller.log.write("store key known \(launchClock)", source: "app")
        }
        async let dataStatusAnswer = client.getDataStatusWords()
        async let catalogAnswer = client.getCatalog()
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
        // This save's rating history: after an import it may have a question to ask (D-064)
        await loadRatingHistory()
        // The report shown is kept with the catalog it is drawn with, once both are here
        await frontOffice.keep(catalog: keptCatalogNow, for: storeKey)
    }

    /// An answer or its error, off the main actor.
    private nonisolated static func attempt<T: Sendable>(_ body: @Sendable () async throws -> T) async -> Result<T, any Error> {
        do { return .success(try await body()) } catch { return .failure(error) }
    }

    private func note(_ error: any Error, reading what: String) {
        lastRequestError = "\(what): \(RequestProblem.logLine(error))"
        controller.log.write("could not read the \(what): \(RequestProblem.logLine(error))", source: "app")
    }
}

extension AppModel {
    /// Hands the running server the Keychain's keys again (Settings, N13), and says the AI's state may have changed.
    public func updateKeys() async {
        await serverController.updateKeys()
        keysRevision += 1
    }

    /// Keeps a provider's key (the Keychain, in the app's own item) and hands the running server the new set, with no
    /// restart. The key is never logged or shown again.
    public func saveKey(_ key: String, for provider: String) async throws(KeyStoreFailure) {
        let trimmed = key.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        do {
            try await keyStore.save(trimmed, for: provider)
        } catch {
            controller.log.write("could not keep the \(provider) key: \(error.description)", source: "app")
            throw error
        }
        await updateKeys()
    }

    /// Removes a provider's key and hands the running server the set without it.
    public func removeKey(_ provider: String) async throws(KeyStoreFailure) {
        do {
            try await keyStore.remove(provider)
        } catch {
            controller.log.write("could not remove the \(provider) key: \(error.description)", source: "app")
            throw error
        }
        await updateKeys()
    }
}
