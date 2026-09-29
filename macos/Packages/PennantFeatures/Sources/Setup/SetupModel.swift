import Foundation
import Observation
import OpenAPIRuntime
import PennantAPI
import PennantKit

/// The Setup window's steps (SWIFTUI_REBUILD.md sections 3.1 and 3.4, "As built at N6 (Stage B2)"): find the save,
/// choose it (`POST /api/config`, which starts an import), follow the import from the served status until it lands,
/// then pick the club when the save does not name it, and save it (`POST /api/settings`).
///
/// **The zero-question first run (D-063).** With no save chosen, the window first asks the server to set up by itself
/// (`POST /api/v2/setup/automatic`): when one save clearly stands out the server chooses and imports it, and takes the
/// club from it when its export names exactly one club the human manages; the window then only follows the import and
/// closes, and the GM is asked nothing. When nothing stands out, the window shows the server's reason and the saves it
/// found, most recently played first (`GET /api/v2/saves`), with how to switch the export on when the save played last
/// has none; choosing one is one click. Every choice made here (a save in the list, a folder, "played since") asks the
/// server to take the club from the save the same way (`club: fromSave`); several human clubs, or none named, bring the
/// club question.
///
/// Every sentence it holds is the server's (`error` from a refusal, `why` when a chosen save's import did not start,
/// the status's `importNote` when an import failed, stopped partway or has no export, the automatic setup's and the
/// club's lines); a request that failed otherwise is a `RequestProblem` kind, its raw detail logged. It never decides
/// which save or club is right: the server picks only when one clearly stands out, and the GM does otherwise.
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
    /// `GET /api/v2/saves`: the saves found, most recently played first, the one that clearly stands out with its reason,
    /// or why none does, and how to switch the export on when the save played last has none.
    public private(set) var discovery: Components.Schemas.SaveDiscovery?
    /// What the first run's automatic setup answered (`POST /api/v2/setup/automatic`): the save it chose and why, or
    /// why none; nil until asked, and when it was not asked (a save chosen, or a development build on the real home).
    public private(set) var automatic: Components.Schemas.AutomaticSetup?
    /// The club as the server took it from the chosen save (the automatic setup's, or a choice's with `club: fromSave`):
    /// decided, or why the GM is asked; nil before a save is chosen here.
    public private(set) var club: Components.Schemas.SetupClub?
    /// The saves found, most recently played first (the discovery's).
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
    /// The club the server could not settle for the save chosen here (its human manages several clubs or none, or the
    /// export doesn't say), from the moment the save is chosen until the GM saves a club (or a later choice settles
    /// it). The main window holds its report meanwhile, whether or not this window is open (N6 Stage B2 review, M4).
    public private(set) var clubQuestion: Components.Schemas.SetupClub?
    /// The save and the import the club question belongs to, to come back to it (`resumeClubQuestion`).
    private var clubQuestionSave: Components.Schemas.SaveInfo?
    private var clubQuestionStamp: String?

    /// Whether the club was asked on the way to `.done` (the GM picked it); false when it was taken from the save or kept,
    /// so the finished window shows the import it followed, never an empty club step (N6 polish).
    public private(set) var clubWasAsked = false

    /// Whether the main window holds its report: the served club is not decided for the save chosen here, or the club
    /// is being asked. Never a judgment of Swift's: only what the server answered about the club.
    public var holdsReport: Bool { clubQuestion != nil || step == .pickClub }

    private var startStamp: String?
    private var sawImportRunning = false
    private var began = false
    private let client: @MainActor () -> Client?
    private let onClubSaved: @MainActor () async -> Void
    private let log: @MainActor (String) -> Void
    private let setsUpAutomatically: Bool

    /// - Parameters:
    ///   - client: the running server's client (nil while it is down).
    ///   - onClubSaved: runs after the club is saved (or taken from the save), before the window closes (the app
    ///     re-reads its settings).
    ///   - log: where a failed request's raw detail goes (the server's log).
    ///   - setsUpAutomatically: whether a first run asks the server to choose the save that clearly stands out
    ///     (`ServerConfiguration.findsSavesAutomatically`).
    public init(
        client: @escaping @MainActor () -> Client?,
        onClubSaved: @escaping @MainActor () async -> Void = {},
        log: @escaping @MainActor (String) -> Void = { _ in },
        setsUpAutomatically: Bool = true
    ) {
        self.client = client
        self.onClubSaved = onClubSaved
        self.log = log
        self.setsUpAutomatically = setsUpAutomatically
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

    /// Back to the first step (Club ▸ Import Export…, Settings ▸ Choose Another Save…, or Choose Another Save here).
    public func restart() {
        step = .findSave
        clubWasAsked = false
        folderChoices = nil
        folderProblem = nil
        importProblem = nil
        progress = nil
        chosen = nil
        club = nil
        clubProblem = nil
        busy = false
    }

    /// The window appeared: on a first run (no save chosen) the server is asked to set up by itself first, and the
    /// saves are listed only if it did not; otherwise the saves are listed. Once per window's model.
    public func begin(status: Components.Schemas.ServerStatus?) async {
        guard !began else { return }
        began = true
        if setsUpAutomatically, status?.configured == false, status?.importing != true {
            await setUpAutomatically(status: status)
        }
        if step == .findSave, !savesLoaded { await load() }
    }

    /// `POST /api/v2/setup/automatic`: the save that clearly stands out is chosen and imported by the server (the window
    /// follows the import, asking nothing), or the server says why none does (the window shows it with the list). A
    /// failed request is logged and the list shown, as before.
    public func setUpAutomatically(status: Components.Schemas.ServerStatus?) async {
        guard let client = client() else { return }
        busy = true
        defer { busy = false }
        let answer: Components.Schemas.AutomaticSetup
        do {
            answer = try await client.setUpAutomatically().ok.body.json
        } catch {
            _ = problem(error, "setting up by itself")
            return
        }
        automatic = answer
        guard answer.outcome.value1 == .started, let save = answer.save else { return }
        club = answer.club
        startStamp = status?.lastImport?.finishedAt
        noteClub(answer.club, for: save)
        chosen = save
        progress = nil
        importProblem = nil
        sawImportRunning = false
        step = .importing
        await readStatus(client)
    }

    /// Reads the saves the server found (most recently played first, the pick or why none, the export's help) and where
    /// it looked. A failed read is a problem with Try Again, never "none found".
    public func load() async {
        guard let client = client() else {
            loadProblem = .notRunning
            return
        }
        loadProblem = nil
        do {
            let found = try await client.getSaveDiscovery().ok.body.json
            discovery = found
            saves = found.saves
            locations = found.searched
        } catch {
            loadProblem = problem(error, "reading the saves")
        }
        savesLoaded = true
    }

    /// The saves as the list shows them: the discovery's, most recently played first.
    public var pickClaim: Components.Schemas.Claim? { discovery?.pick?.claim }

    /// Whether a save is the one the server picked as clearly standing out.
    public func isPick(_ save: Components.Schemas.SaveInfo) -> Bool {
        guard let id = save.id, let pick = discovery?.pick else { return false }
        return pick.saveId == id
    }

    /// Checks the folder the GM typed or picked (`POST /api/resolve-folder`): an export or a save is chosen at once; a
    /// folder of saves lists them; anything else shows the server's sentence. Nothing while a request is under way.
    public func useFolder(status: Components.Schemas.ServerStatus?) async {
        let path = folderPath.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !busy, !path.isEmpty, status?.importing != true else { return }
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

    /// "Played since" (and "the save you were using has gone"): the GM clicked the switch in the main window, so the
    /// window starts on that save's import at once, through the same choice as the list (`choose`). Never called without
    /// the GM's click.
    public func switchTo(_ save: Components.Schemas.SaveInfo, status: Components.Schemas.ServerStatus?) async {
        began = true
        restart()
        await choose(save, status: status)
        // Refused (an import running, a folder gone): the list, with the server's sentence
        if step == .findSave, !savesLoaded { await load() }
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
            // The club is taken from the save when it names one, as the first run does
            let request = Components.Schemas.ConfigRequest(csvDir: save.csvDir, saveName: save.name, club: .init(value1: .fromSave, value2: "fromSave"))
            switch try await client.setSave(body: .json(request)) {
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
        club = accepted.club
        noteClub(accepted.club, for: save)
        automatic = nil
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

    /// The import landed: with the club taken from the save there is nothing to ask (the app reads its settings again
    /// and the window closes); otherwise the club question.
    private func importLanded() async {
        progress = nil
        if club?.decided == true {
            clubWasAsked = false
            await onClubSaved()
            step = .done
            return
        }
        clubWasAsked = true
        step = .pickClub
        await loadClubs()
    }

    // MARK: Pick the club

    /// Reads the clubs and preselects the served current club when the save's human manages it (else the first he
    /// manages). A failed read is a problem with Try Again, never an empty list.
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
        // The served club is preselected only when it is one this save's human manages: a club chosen before may be
        // another league's id (N6 Stage B2 review, H1)
        selectedClub = clubs.first { $0.teamId == served && $0.isHuman }?.teamId ?? clubs.first?.teamId
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
        clubQuestion = nil
        clubQuestionSave = nil
        clubQuestionStamp = nil
        await onClubSaved()
        step = .done
    }

    /// Remembers what the server answered about the club for a save chosen here: a club it could not settle holds the
    /// report until the GM answers; a settled one (taken from the save, or the GM's kept) lets it go.
    private func noteClub(_ served: Components.Schemas.SetupClub?, for save: Components.Schemas.SaveInfo) {
        if let served, !served.decided {
            clubQuestion = served
            clubQuestionSave = save
            clubQuestionStamp = startStamp
        } else {
            clubQuestion = nil
            clubQuestionSave = nil
            clubQuestionStamp = nil
        }
    }

    /// Back to the club question (the main window's "Choose Your Club…", Set Up Pennant…, Import Export…): the window
    /// was closed, or went back to the saves, while the club was still owed. It follows the owed save's import again
    /// from the served status: the club question once it has landed, the import's own problem if it did not.
    public func resumeClubQuestion(status: Components.Schemas.ServerStatus?) async {
        guard let question = clubQuestion, step != .pickClub, step != .importing else { return }
        began = true
        folderChoices = nil
        folderProblem = nil
        importProblem = nil
        progress = nil
        automatic = nil
        chosen = clubQuestionSave
        club = question
        startStamp = clubQuestionStamp
        sawImportRunning = false
        step = .importing
        await observe(status, fresh: true)
    }

    /// The window appears again after it closed itself (the club saved): it starts at the saves, at once, and the list
    /// is read again. Returns whether it started again.
    @discardableResult
    public func reopen() -> Bool {
        guard step == .done else { return false }
        restart()
        return true
    }

    #if DEBUG
    /// A model at a given step, for `#Preview`s and snapshots.
    public static func preview(
        step: Step,
        discovery: Components.Schemas.SaveDiscovery? = nil,
        automatic: Components.Schemas.AutomaticSetup? = nil,
        club: Components.Schemas.SetupClub? = nil,
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
        model.began = true
        model.step = step
        model.discovery = discovery
        model.automatic = automatic
        model.club = club
        model.saves = discovery?.saves ?? saves
        model.savesLoaded = true
        model.loadProblem = loadProblem
        model.locations = discovery?.searched ?? locations
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
