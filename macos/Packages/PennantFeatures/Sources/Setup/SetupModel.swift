import Foundation
import Observation
import OpenAPIRuntime
import PennantAPI
import PennantKit

/// The Setup window's steps (SWIFTUI_REBUILD.md section 3.1), as React's first run does them: find the save (the saves
/// the server found, where it looked, or a folder the GM picks), choose it (`POST /api/config`, which starts an
/// import), follow the import from the served status until it lands, then pick the club (the clubs as served, the one
/// the save's human manages first) and save it (`POST /api/settings`).
///
/// Every sentence it holds is the server's (`error` from a refusal, `why` when a chosen save's import did not start,
/// the status's `importNote` when an import failed, stopped partway or has no export); a request that failed otherwise
/// is a `RequestProblem` kind, its raw detail logged. It never decides which save or club is right: the GM does.
///
/// The import has landed only when the served last import's finish time moves past the one before the save was
/// chosen. An import that stops without that (an error, or an interruption the server reports) is a problem with Try
/// Again, never a reason to go on to the club.
@Observable @MainActor
public final class SetupModel {
    public enum Step: Hashable, Sendable {
        case findSave
        case importing
        case pickClub
        /// The club is saved; the window closes.
        case done
    }

    /// Why an import did not land.
    public enum ImportProblem: Hashable, Sendable {
        /// The server's sentence (the status's `importNote`, the chosen save's `why`, or a refusal's `error`), with the
        /// raw message behind it when the server sent one.
        case served(String, detail: String? = nil)
        /// The save was chosen but its import did not start, and the server said nothing about why (an older server):
        /// a structural line.
        case notStarted
        /// The import ended with no new import and the server said nothing about why (an older server): a structural
        /// line.
        case unexplained
        /// The request itself failed.
        case request(RequestProblem)
    }

    public private(set) var step: Step = .findSave
    /// `/api/saves`: the saves found in the usual places.
    public private(set) var saves: [Components.Schemas.SaveInfo] = []
    public private(set) var savesLoaded = false
    /// Reading the saves or where the server looked failed.
    public private(set) var loadProblem: RequestProblem?
    /// `/api/search-locations`: where the server looked.
    public private(set) var locations: [Components.Schemas.SearchLocation] = []
    /// A folder the GM typed or picked.
    public var folderPath = ""
    /// The saves inside the picked folder, when it holds several.
    public private(set) var folderChoices: [Components.Schemas.SaveInfo]?
    /// Why the picked folder or the chosen save could not be used.
    public private(set) var folderProblem: RequestProblem?
    /// The save being imported.
    public private(set) var chosen: Components.Schemas.SaveInfo?
    /// The import's progress as served.
    public private(set) var progress: Components.Schemas.ImportProgress?
    public private(set) var importProblem: ImportProblem?
    /// `/api/orgs`, the club the save's human manages first.
    public private(set) var clubs: [Components.Schemas.Org] = []
    public var selectedClub: Int?
    /// Reading the clubs or saving the club failed.
    public private(set) var clubProblem: RequestProblem?
    /// A request is under way.
    public private(set) var busy = false

    private var startStamp: String?
    private var sawImportRunning = false
    private let client: @MainActor () -> Client?
    private let onClubSaved: @MainActor () async -> Void
    private let log: @MainActor (String) -> Void

    /// - Parameters:
    ///   - client: the running server's client (nil while it is down).
    ///   - onClubSaved: runs after the club is saved, before the window closes (the app re-reads its settings).
    ///   - log: where a failed request's raw detail goes (the server's log).
    public init(
        client: @escaping @MainActor () -> Client?,
        onClubSaved: @escaping @MainActor () async -> Void = {},
        log: @escaping @MainActor (String) -> Void = { _ in }
    ) {
        self.client = client
        self.onClubSaved = onClubSaved
        self.log = log
    }

    /// A failed request as a kind, with its raw detail logged.
    private func problem(_ error: any Error, _ what: String) -> RequestProblem {
        let problem = RequestProblem.from(error)
        if let detail = problem.detail { log("setup: \(what): \(detail)") }
        return problem
    }

    private func undocumented(_ code: Int, _ what: String, body: HTTPBody? = nil) async -> RequestProblem {
        // Setup's requests are all reused routes: an undocumented answer's text is never shown as the server's sentence
        let problem = await RequestProblem.undocumented(code, body: body, operation: what, fromV2: false)
        if let detail = problem.detail { log("setup: \(detail)") }
        return problem
    }

    // MARK: Find the save

    /// Back to the first step (Club ▸ Import Export…, or Choose Another Save).
    public func restart() {
        step = .findSave
        folderChoices = nil
        folderProblem = nil
        importProblem = nil
        progress = nil
        chosen = nil
        clubProblem = nil
        busy = false
    }

    /// Reads the saves the server found and where it looked. A failed read is a problem with Try Again, never "none
    /// found".
    public func load() async {
        guard let client = client() else {
            loadProblem = .notRunning
            return
        }
        loadProblem = nil
        async let savesAnswer = client.listSaves()
        async let locationsAnswer = client.getSearchLocations()
        do {
            saves = try await savesAnswer.ok.body.json
        } catch {
            loadProblem = problem(error, "reading the saves")
        }
        do {
            locations = try await locationsAnswer.ok.body.json.locations
        } catch {
            if loadProblem == nil { loadProblem = problem(error, "reading where the server looked") }
        }
        savesLoaded = true
    }

    /// Checks the folder the GM typed or picked (`POST /api/resolve-folder`): an export or a save is chosen at once; a
    /// folder of saves lists them; anything else shows the server's sentence.
    public func useFolder(status: Components.Schemas.ServerStatus?) async {
        let path = folderPath.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !path.isEmpty, status?.importing != true else { return }
        guard let client = client() else {
            folderProblem = .notRunning
            return
        }
        busy = true
        folderProblem = nil
        folderChoices = nil
        defer { busy = false }
        let result: Components.Schemas.ResolveResult
        do {
            switch try await client.resolveFolder(body: .json(.init(path: path))) {
            case .ok(let ok): result = try ok.body.json
            case .badRequest(let refused): result = try refused.body.json
            case .undocumented(let code, let payload):
                folderProblem = await undocumented(code, "resolveFolder", body: payload.body)
                return
            }
        } catch {
            folderProblem = problem(error, "checking the folder")
            return
        }
        if result.ok, let csvDir = result.csvDir {
            let save = Components.Schemas.SaveInfo(
                name: result.saveName ?? URL(fileURLWithPath: path).lastPathComponent,
                lgPath: path,
                csvDir: csvDir,
                csvCount: result.csvCount ?? 0,
                csvLastModified: nil,
                csvLastModifiedText: nil
            )
            busy = false
            await choose(save, status: status)
        } else if let saves = result.saves, !saves.isEmpty {
            folderChoices = saves
        } else if let error = result.error {
            folderProblem = .served(error)
        } else {
            folderProblem = await undocumented(200, "resolveFolder without a save or a sentence")
        }
    }

    /// Chooses a save (`POST /api/config`); the server starts importing it, and the window follows the import. Nothing
    /// is asked while an import is running (the server would refuse it too).
    public func choose(_ save: Components.Schemas.SaveInfo, status: Components.Schemas.ServerStatus?) async {
        guard status?.importing != true else { return }
        guard let client = client() else {
            folderProblem = .notRunning
            return
        }
        busy = true
        folderProblem = nil
        defer { busy = false }
        startStamp = status?.lastImport?.finishedAt
        let accepted: Components.Schemas.ConfigAccepted
        do {
            switch try await client.setSave(body: .json(.init(csvDir: save.csvDir, saveName: save.name))) {
            case .ok(let ok):
                accepted = try ok.body.json
            case .badRequest(let refused):
                folderProblem = .served(try refused.body.json.error)
                return
            case .conflict(let refused):
                folderProblem = .served(try refused.body.json.error)
                return
            case .undocumented(let code, let payload):
                folderProblem = await undocumented(code, "setSave", body: payload.body)
                return
            }
        } catch {
            folderProblem = problem(error, "choosing the save")
            return
        }
        chosen = save
        progress = nil
        importProblem = nil
        sawImportRunning = false
        step = .importing
        // The save is chosen, but its import did not start: the server says why
        guard accepted.importStarted else {
            importProblem = accepted.why.map { .served($0) } ?? .notStarted
            return
        }
        await readStatus(client)
    }

    // MARK: The import

    /// Follows the import from a served status. The window passes each status the event stream brings (and the one it
    /// has when it appears); the model also reads one straight after asking (`fresh`). A status that is not fresh and
    /// comes before the import was seen running may be older than the request, so it only counts when it shows the
    /// import landed.
    public func observe(_ status: Components.Schemas.ServerStatus?, fresh: Bool = false) async {
        guard step == .importing, importProblem == nil, let status else { return }
        if status.importing {
            sawImportRunning = true
            if let next = status.importProgress { progress = next }
            return
        }
        let stamp = status.lastImport?.finishedAt
        if let stamp, stamp != startStamp, status.importInterruptedSince == nil {
            await importLanded()
            return
        }
        // Not importing, and no new import: it failed, stopped partway, or never began; the server says which
        guard sawImportRunning || fresh else { return }
        if let note = status.importNote {
            importProblem = .served(note.text, detail: note.detail)
            if let detail = note.detail { log("setup: the import did not finish: \(detail)") }
        } else {
            importProblem = .unexplained
        }
        progress = nil
    }

    /// Try Again after a failed import (`POST /api/import`).
    public func retryImport(status: Components.Schemas.ServerStatus?) async {
        guard status?.importing != true else { return }
        guard let client = client() else {
            importProblem = .request(.notRunning)
            return
        }
        busy = true
        defer { busy = false }
        startStamp = status?.lastImport?.finishedAt
        sawImportRunning = false
        progress = nil
        do {
            switch try await client.startImport() {
            case .ok:
                importProblem = nil
            case .badRequest(let refused):
                importProblem = .served(try refused.body.json.error)
                return
            case .conflict(let refused):
                importProblem = .served(try refused.body.json.error)
                return
            case .undocumented(let code, let payload):
                importProblem = .request(await undocumented(code, "startImport", body: payload.body))
                return
            }
        } catch {
            importProblem = .request(problem(error, "starting the import"))
            return
        }
        await readStatus(client)
    }

    private func readStatus(_ client: Client) async {
        do {
            await observe(try await client.getStatus().ok.body.json, fresh: true)
        } catch {
            // The event stream still brings the import's news
            log("setup: reading the status: \(String(describing: error))")
        }
    }

    private func importLanded() async {
        progress = nil
        step = .pickClub
        await loadClubs()
    }

    // MARK: Pick the club

    /// Reads the clubs and preselects the served current club (else the one the save's human manages). A failed read is
    /// a problem with Try Again, never an empty list.
    public func loadClubs() async {
        guard let client = client() else {
            clubProblem = .notRunning
            return
        }
        clubProblem = nil
        async let orgsAnswer = client.listOrgs()
        async let settingsAnswer = client.getSettings()
        let orgs: [Components.Schemas.Org]
        do {
            orgs = try await orgsAnswer.ok.body.json
        } catch {
            clubProblem = problem(error, "reading the clubs")
            _ = try? await settingsAnswer
            return
        }
        let served = (try? await settingsAnswer.ok.body.json)?.organization?.id
        clubs = orgs.filter(\.isHuman) + orgs.filter { !$0.isHuman }
        selectedClub = clubs.first { $0.teamId == served }?.teamId ?? clubs.first?.teamId
    }

    /// Saves the chosen club (`POST /api/settings`), then closes the window. When the save's human manages exactly one
    /// club and that is the one chosen, it is saved as Automatic (`clubChoice`), so the app follows him if he takes
    /// another job in the save. With several human clubs, Automatic would follow only the first, so any choice there
    /// (and any other club) is saved by its id.
    public func saveClub() async {
        guard let club = selectedClub else { return }
        let human = clubs.filter(\.isHuman)
        let automatic = human.count == 1 && human.first?.teamId == club
        guard let client = client() else {
            clubProblem = .notRunning
            return
        }
        busy = true
        clubProblem = nil
        defer { busy = false }
        do {
            _ = try await client.saveSettings(body: .json(automatic ? .init(clubChoice: .automatic) : .init(defaultOrgId: club))).ok
        } catch {
            clubProblem = problem(error, "saving the club")
            return
        }
        await onClubSaved()
        step = .done
    }

    #if DEBUG
    /// A model at a given step, for `#Preview`s and snapshots.
    public static func preview(
        step: Step,
        saves: [Components.Schemas.SaveInfo] = [],
        locations: [Components.Schemas.SearchLocation] = [],
        loadProblem: RequestProblem? = nil,
        folderProblem: RequestProblem? = nil,
        chosen: Components.Schemas.SaveInfo? = nil,
        progress: Components.Schemas.ImportProgress? = nil,
        importProblem: ImportProblem? = nil,
        clubs: [Components.Schemas.Org] = [],
        clubProblem: RequestProblem? = nil
    ) -> SetupModel {
        let model = SetupModel(client: { nil })
        model.step = step
        model.saves = saves
        model.savesLoaded = true
        model.loadProblem = loadProblem
        model.locations = locations
        model.folderProblem = folderProblem
        model.chosen = chosen
        model.progress = progress
        model.importProblem = importProblem
        model.clubs = clubs.filter(\.isHuman) + clubs.filter { !$0.isHuman }
        model.selectedClub = model.clubs.first?.teamId
        model.clubProblem = clubProblem
        return model
    }
    #endif
}
