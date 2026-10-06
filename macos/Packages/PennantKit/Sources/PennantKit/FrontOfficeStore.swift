import Foundation
import Observation
import OpenAPIRuntime
import PennantAPI

/// The Front Office's served payloads (SWIFTUI_REBUILD.md sections 3.4, 3.5 and 6): the Morning Report's desk and
/// department cards (`GET /api/v2/front-office/:org`), each department's report (`/departments/:org/:dept`) and, on
/// demand, the evidence trail behind an item (`/claims/:key`).
///
/// Keyed on `AppModel.storeKey`, like every department store: a new import, a club change or a restore moves the key,
/// and the views reload on it (`.task(id:)`). The store keeps its last good payload while a reload runs, and each
/// payload says which import it was built from (`importStamp`): one whose stamp is not the key's is kept but never
/// taken as current (`isCurrent`), so the view says it is refreshing until the key catches up. It decides nothing:
/// every sentence and order is the server's.
///
/// At launch (N6, Stage B1) the Morning Report the app last received for the key's save and club is read from the
/// app's own caches (`KeptReports`) and shown at once, with the club's catalog entry it was kept with, said to be
/// updating, while the server's fresh one is fetched and swapped in place. A fresh payload is kept for the next launch
/// once it is current for its key and the catalog it is drawn with is in hand (`keep`).
@Observable @MainActor
public final class FrontOfficeStore {
    /// The Morning Report's desk and cards, as last served.
    public private(set) var summary: Components.Schemas.FrontOfficeSummary?
    /// Why the last summary request failed; nil when it did not.
    public private(set) var summaryProblem: RequestProblem?
    /// The shown summary is the one kept from an earlier launch, not yet replaced by the server's (the view says it
    /// is updating; the payload's own served kicker says how current it is).
    public private(set) var summaryIsKept = false
    /// The catalog entry the kept summary was kept with (the club's theme and name, the phrases): drawn until the live
    /// catalog arrives (`AppModel.catalogClub`, `AppModel.phrases`). Nil when nothing kept was read.
    public private(set) var keptCatalog: KeptReports.Catalog?
    /// The report kept last (the one the index names), read at launch before the save and club are confirmed: never
    /// shown as a report until they are (`summary`), but its club card is drawn at once, so the window's first frame
    /// already has it (N6 polish: the relaunch's layout jump). Nil once a report is shown or another key is confirmed,
    /// or with nothing kept.
    public private(set) var waitingKept: (key: KeptReports.Key, kept: KeptReports.Kept)?
    /// The key the report on screen is for (the kept one's, or the fresh one's), and the catalog it is drawn with: while
    /// the app's key has moved to another save or club (a switch under way), the window keeps drawing that report's
    /// club with it, so the whole window moves to the new save together when its report lands (N6 polish).
    public private(set) var shownKey: AppModel.StoreKey?
    public private(set) var shownCatalog: KeptReports.Catalog?
    /// The catalog the report on screen is drawn with, while that report is another save's, club's or import's than the
    /// key's (a switch or an import under way, until the new report lands): the window moves to the new one together,
    /// tied to one import; nil otherwise (`AppModel.heldCatalog`).
    public func heldCatalog(for key: AppModel.StoreKey?) -> KeptReports.Catalog? {
        shownIsAnothers(key) ? shownCatalog : nil
    }

    /// The report on screen is another save's, club's or import's than the key names: a save chosen and not yet
    /// imported (the key names no save while the served data is still the old save's), an import or a switch under way.
    /// The report is drawn as updating until the key's own lands (N6 polish review).
    func shownIsAnothers(_ key: AppModel.StoreKey?) -> Bool {
        guard let key, summary != nil, let shown = shownKey else { return false }
        return shown.saveId != key.saveId || shown.club != key.club || shown.importStamp != key.importStamp
    }

    /// Each department's report, as last served, by department id.
    public private(set) var reports: [String: Components.Schemas.DepartmentReport] = [:]
    public private(set) var reportProblems: [String: RequestProblem] = [:]
    /// Evidence trails fetched on demand, by evidence key (dropped when the key moves).
    public private(set) var trails: [String: Components.Schemas.ClaimTrail] = [:]
    public private(set) var trailProblems: [String: RequestProblem] = [:]
    /// Counts the times an import landed while a report from an earlier import was shown and the fresh one replaced it
    /// in place (never the kept report's replacement at launch): the view says "Updated to …" for a moment on each.
    public private(set) var importLandings = 0
    /// Requests under way.
    public private(set) var loadingSummary = false
    public private(set) var loadingReports: Set<String> = []
    public private(set) var loadingTrails: Set<String> = []

    private var summaryKey: AppModel.StoreKey?
    private var reportKeys: [String: AppModel.StoreKey] = [:]
    /// The key each resource was last asked for: an answer to an older question is dropped when it arrives late.
    private var summaryAsked: AppModel.StoreKey?
    private var reportAsked: [String: AppModel.StoreKey] = [:]
    private var trailsKey: AppModel.StoreKey?
    /// Writes a raw failure to the server's log (the window shows only its kind).
    private let log: @MainActor (String) -> Void
    /// Where the Morning Report is kept across launches; nil keeps nothing (a preview).
    private let kept: KeptReports?
    /// The contract this build was generated from (`contractDigest`), part of every kept payload's key.
    private let contract: String

    /// The payload kept last, read at the store's making (the launch) off the main actor, so it is decoded when the key
    /// is known; nil with nowhere to keep. Only the index's one file is decoded.
    private let preloaded: Task<(key: KeptReports.Key, kept: KeptReports.Kept)?, Never>?
    /// When the store was made, for the launch's log line.
    private let made = ContinuousClock.now
    /// Orders the writes of kept payloads: a later one always wins (`KeptReports.write`).
    private var keepSequence: UInt64 = 0
    /// What was last kept (its key, its build and the catalog), so the same payload is not written twice.
    private var lastKept: (key: KeptReports.Key, stamp: String, catalog: KeptReports.Catalog)?

    public init(kept: KeptReports? = nil, contract: String = contractDigest, log: @escaping @MainActor (String) -> Void = { _ in }) {
        self.kept = kept
        self.contract = contract
        self.log = log
        let preloaded = kept.map { kept in Task.detached(priority: .userInitiated) { await kept.readLast() } }
        self.preloaded = preloaded
        if let preloaded {
            Task { [weak self] in
                let last = await preloaded.value
                guard let self, self.summary == nil, self.shownKey == nil else { return }
                // Read after the settings were answered: drawn only for the key's own save and club
                if let settled = self.settledFor, last?.key != settled { return }
                self.waitingKept = last
            }
        }
    }

    /// A save was chosen and its import has not landed: the report on screen is a save's, and the key names no save
    /// while its import is still the one that report was built from.
    nonisolated static func awaitsTheChosenSave(shown: AppModel.StoreKey?, key: AppModel.StoreKey) -> Bool {
        guard let shown, shown.saveId != nil else { return false }
        return key.saveId == nil && key.importStamp == shown.importStamp && key.restores == shown.restores
    }

    /// What a kept payload is for, from a store key: the save the imported data came from and the club the app shows;
    /// nil while either is not known (nothing kept is read or written then).
    nonisolated static func keptKey(_ key: AppModel.StoreKey, contract: String) -> KeptReports.Key? {
        guard let saveId = key.saveId, !saveId.isEmpty, let club = key.club else { return nil }
        return KeptReports.Key(saveId: saveId, clubId: club.id, contract: contract)
    }

    #if DEBUG
    /// Development builds only: `PENNANT_DEV_HOLD_FRESH_MS` holds the fresh Morning Report back that long after the kept
    /// one is shown (to see and capture the kept report while it waits; the synthetic league answers too fast to).
    nonisolated static let devHoldFresh: Duration? = ProcessInfo.processInfo.environment["PENNANT_DEV_HOLD_FRESH_MS"]
        .flatMap(Int.init).map { .milliseconds($0) }
    #endif

    /// Whether the view says the report is updating: the kept one is shown, a fresh one is on its way, or the shown one
    /// is not the key's (another save's, club's or import's: from the moment another save is chosen until its report
    /// lands); never while the last request failed (the problem line says so instead, and "Updating" would otherwise stay
    /// on for good).
    public func showsUpdating(for key: AppModel.StoreKey?) -> Bool {
        guard summary != nil, summaryProblem == nil else { return false }
        return summaryIsKept || loadingSummary || shownIsAnothers(key) || !summaryIsCurrent(for: key)
    }

    /// Whether a payload was built from what the key names: the same import, the same club, and (once the server has
    /// kept a build) the same build. The server always builds from its current inputs; a payload read just before the app
    /// heard of a change is kept, and shown as refreshing, never as current.
    public nonisolated static func isCurrent(importStamp: String?, reportStamp: String?, orgId: Int?, for key: AppModel.StoreKey?) -> Bool {
        guard let key else { return false }
        guard (importStamp ?? "") == key.importStamp else { return false }
        if let club = key.club, let orgId, club.id != orgId { return false }
        return key.reportStamp.isEmpty || reportStamp == key.reportStamp
    }

    /// Two keys that differ in nothing but the server's build stamp (the same save, import, club and restores).
    nonisolated static func onlyTheBuildMoved(_ a: AppModel.StoreKey, _ b: AppModel.StoreKey) -> Bool {
        a.saveId == b.saveId && a.importStamp == b.importStamp && a.club == b.club && a.restores == b.restores
    }

    /// The club a request names: the served current club's id, or `automatic` (the server resolves it the same way).
    public nonisolated static func org(_ key: AppModel.StoreKey) -> String {
        key.club.map { String($0.id) } ?? "automatic"
    }

    /// The shown summary was built from what the key names: its import, club and build (`isCurrent`), for the key's save
    /// (the payload names no save: the key it was shown for does).
    public func summaryIsCurrent(for key: AppModel.StoreKey?) -> Bool {
        guard let summary, !shownIsAnothers(key) else { return false }
        return Self.isCurrent(importStamp: summary.importStamp, reportStamp: summary.reportStamp, orgId: summary.orgId, for: key)
    }

    public func reportIsCurrent(_ department: String, for key: AppModel.StoreKey?) -> Bool {
        guard let report = reports[department], let loaded = reportKeys[department] else { return false }
        // A report names no club: it is the loaded key's club that must be the key's
        return loaded.club == key?.club
            && Self.isCurrent(importStamp: report.importStamp, reportStamp: report.reportStamp, orgId: nil, for: key)
    }

    // MARK: Loading

    /// Loads the desk and cards for the key, once per key; nothing without a server or a key. With nothing shown yet,
    /// the payload kept from an earlier launch for the key's save and club is shown first, as updating.
    public func loadSummary(client: Client?, key: AppModel.StoreKey?, catalog: KeptReports.Catalog? = nil) async {
        guard let client, let key, summaryKey != key || summary == nil else { return }
        // Only the build stamp moved, to the build the store already has (read just before the event): nothing to ask
        if let loaded = summaryKey, Self.onlyTheBuildMoved(loaded, key), summary?.reportStamp == key.reportStamp {
            summaryKey = key
            return
        }
        // Another save chosen and not yet imported: the key names no save, and the server still serves the old save's
        // import, so there is nothing new to ask. The old report stays on screen, as updating, with its own club, until
        // the new save's import lands and moves the key (N6 polish review: a report fetched now was taken as current,
        // and "Updating" went off before the new save's report came)
        if Self.awaitsTheChosenSave(shown: shownKey, key: key), summary != nil {
            summaryKey = key
            return
        }
        summaryAsked = key
        loadingSummary = true
        defer { if summaryAsked == key { loadingSummary = false } }
        let keptKey = Self.keptKey(key, contract: contract)
        if summary == nil, let kept, let keptKey {
            // Read and decoded at launch, off the main actor (the index's one file); another key's is read now, off it
            let last = await preloaded?.value
            // The report kept last is another save's or club's: its club card is dropped, and it is never shown
            if last?.key != keptKey { waitingKept = nil }
            let stored = last?.key == keptKey ? last?.kept : await kept.read(keptKey)
            guard summaryAsked == key else { return }
            if let stored, summary == nil {
                summary = stored.summary
                keptCatalog = stored.catalog
                summaryIsKept = true
                shownKey = key
                shownCatalog = stored.catalog
                waitingKept = nil
                log("showing the kept Morning Report \(Int((ContinuousClock.now - made) / .milliseconds(1))) ms after the store was made")
            }
        }
        #if DEBUG
        // A development build can hold the fresh answer back while the kept one is shown, to see and capture it waiting
        if summaryIsKept, let hold = Self.devHoldFresh {
            try? await Task.sleep(for: hold)
            guard summaryAsked == key, !Task.isCancelled else { return }
        }
        #endif
        var served: Components.Schemas.FrontOfficeSummary?
        var problem: RequestProblem?
        do {
            switch try await client.getFrontOffice(path: .init(org: Self.org(key))) {
            case .ok(let answer):
                served = try answer.body.json
            case .notFound(let refused):
                problem = .served(try refused.body.json.error)
            case .undocumented(let code, let payload):
                problem = await .undocumented(code, body: payload.body, operation: "getFrontOffice", fromV2: true)
            }
        } catch {
            problem = .from(error)
        }
        // The view's task was cancelled (the key moved, and a load for the new key follows): no answer, no problem
        guard summaryAsked == key, !Task.isCancelled else { return }
        if served == nil { waitingKept = nil }
        if let served {
            if summaryIsKept {
                log("the fresh Morning Report replaced the kept one \(Int((ContinuousClock.now - made) / .milliseconds(1))) ms after the store was made")
            }
            // An import landed while a live report of an earlier import was on the screen
            let landed = summary != nil && !summaryIsKept && summary?.importStamp != served.importStamp
            summary = served
            summaryKey = key
            summaryIsKept = false
            // The whole window moves to this report's save and club together (the club card, the colours, the report)
            shownKey = key
            // Its own club's catalog, or none until it arrives (`keep`): never the report before it's
            shownCatalog = catalog?.club?.teamId == served.orgId ? catalog : nil
            waitingKept = nil
            if landed { importLandings += 1 }
        }
        summaryProblem = problem
        if let detail = problem?.detail { log("could not read the Front Office: \(detail)") }
    }

    /// Keeps the shown payload for the next launch with the catalog it is drawn with, when it is the server's (not the
    /// kept one), current for the key (the same import, club and build: never another save's report under this save's
    /// id) and not kept already. Awaited: it returns once the file is written (off the main actor, in the order asked).
    /// A write that fails is logged and costs nothing. The app calls it when a fresh payload lands and when the catalog
    /// arrives or changes.
    public func keep(catalog: KeptReports.Catalog?, for key: AppModel.StoreKey?) async {
        guard let key, let summary, !summaryIsKept, let catalog, let club = catalog.club, club.teamId == summary.orgId,
              summaryIsCurrent(for: key)
        else { return }
        // The report on screen is drawn with its own club's catalog from now on, whether or not it can be kept (no save
        // id served, nowhere to keep): a later import or switch holds the window together with it (N6 polish review)
        shownCatalog = catalog
        guard let kept, let keptKey = Self.keptKey(key, contract: contract), summary.orgId == keptKey.clubId else { return }
        let stamp = "\(summary.importStamp ?? "")|\(summary.reportStamp)|\(summary.deskStamp)"
        if let last = lastKept, last.key == keptKey, last.stamp == stamp, last.catalog == catalog { return }
        lastKept = (keptKey, stamp, catalog)
        keepSequence += 1
        do {
            try await kept.write(summary, catalog: catalog, for: keptKey, sequence: keepSequence)
        } catch {
            lastKept = nil
            log("could not keep the Morning Report: \(error)")
        }
    }

    /// The settings have been answered (the launch's first key): the club card of the report kept last is drawn no longer
    /// unless its save and club are the key's own (the report itself then follows, `loadSummary`). A settings request
    /// that failed leaves no key, so the card goes: never a club that was not confirmed (N6 polish review).
    public func settleWaitingKept(for key: AppModel.StoreKey?) {
        let confirmed = key.flatMap { Self.keptKey($0, contract: contract) }
        settledFor = .some(confirmed)
        if let waiting = waitingKept, waiting.key != confirmed { waitingKept = nil }
    }
    /// The kept key the settings confirmed (`.some(nil)`: none), once they are answered; nil before.
    private var settledFor: KeptReports.Key??

    /// Forgets every kept payload (a data-folder restore).
    public func forgetKept() async {
        lastKept = nil
        await kept?.removeAll()
    }

    /// Loads one department's report for the key, once per key.
    public func loadReport(_ department: String, client: Client?, key: AppModel.StoreKey?) async {
        let restatus = reportKeys[department] == key && reports[department] != nil && attentionStale.contains(department)
        guard let client, let key, reportKeys[department] != key || reports[department] == nil || restatus else { return }
        if !restatus, let loaded = reportKeys[department], Self.onlyTheBuildMoved(loaded, key), reports[department]?.reportStamp == key.reportStamp {
            reportKeys[department] = key
            return
        }
        reportAsked[department] = key
        // Only the statuses changed: the report is read again quietly, with what it shows kept in place
        if !restatus { loadingReports.insert(department) }
        defer { if reportAsked[department] == key { loadingReports.remove(department) } }
        var served: Components.Schemas.DepartmentReport?
        var problem: RequestProblem?
        do {
            switch try await client.getDepartmentReport(path: .init(org: Self.org(key), dept: department)) {
            case .ok(let answer):
                served = try answer.body.json
            case .notFound(let refused):
                problem = .served(try refused.body.json.error)
            case .undocumented(let code, let payload):
                problem = await .undocumented(code, body: payload.body, operation: "getDepartmentReport", fromV2: true)
            }
        } catch {
            problem = .from(error)
        }
        guard reportAsked[department] == key, !Task.isCancelled else { return }
        if let served {
            reports[department] = served
            reportKeys[department] = key
            attentionStale.remove(department)
        }
        reportProblems[department] = problem
        if let detail = problem?.detail { log("could not read the \(department) report: \(detail)") }
    }

    /// Fetches the evidence trail behind an item, once per key (the server builds it on demand; it can take a moment).
    public func loadTrail(_ evidence: String, client: Client?, key: AppModel.StoreKey?) async {
        guard let client, let key else { return }
        if trailsKey != key {
            trails = [:]
            trailProblems = [:]
            trailsKey = key
        }
        guard trails[evidence] == nil, !loadingTrails.contains(evidence) else { return }
        loadingTrails.insert(evidence)
        defer { loadingTrails.remove(evidence) }
        var served: Components.Schemas.ClaimTrail?
        var problem: RequestProblem?
        do {
            switch try await client.getClaimTrail(path: .init(key: evidence)) {
            case .ok(let answer):
                served = try answer.body.json
            case .notFound(let refused):
                problem = .served(try refused.body.json.error)
            case .undocumented(let code, let payload):
                problem = await .undocumented(code, body: payload.body, operation: "getClaimTrail", fromV2: true)
            }
        } catch {
            problem = .from(error)
        }
        // The key moved while it was fetched: an earlier build's trail is never kept as the current one's
        guard trailsKey == key, !Task.isCancelled else { return }
        if let served { trails[evidence] = served }
        trailProblems[evidence] = problem
        if let detail = problem?.detail { log("could not read an evidence trail: \(detail)") }
    }

    // MARK: The desk's statuses (N7, Stage B; D-058)

    /// The GM's last status change here in the server's words ("Marked reviewed", "Back on your desk"), with a moment
    /// that moves on each, so the view can say it for a moment and VoiceOver announces it; nil before any.
    public private(set) var deskDone: (text: String, moment: Int)?
    /// Why the last status change was refused, in the server's sentence (or the kind of failure); nil when it was not.
    public private(set) var deskProblem: RequestProblem?
    /// The items whose status is being sent.
    public private(set) var deskBusy: Set<String> = []
    /// Moves each time the statuses change (the GM's own change, or the `desk-changed` event's): the reports' items carry
    /// their status too, so a report view reloads on it (the key alone does not move).
    public private(set) var attentionRevision = 0
    private var deskMoments = 0

    /// Puts the served desk in the summary shown when it is the same club's and build's (a status never changes the
    /// build: the server composes it on the kept one). The reports are asked again on the next look, since their items
    /// carry the statuses too. A desk from another build is left: that build's summary follows the key.
    public func apply(deskView view: Components.Schemas.DeskView) {
        guard var shown = summary, shown.orgId == view.orgId, shown.reportStamp == view.reportStamp,
              shown.importStamp == view.importStamp else { return }
        shown.desk = view.desk
        shown.deskStamp = view.deskStamp
        summary = shown
        attentionStale = Set(reports.keys)
        attentionRevision += 1
    }

    /// The reports shown before the statuses last changed: asked again quietly (no "Refreshing") on the next look.
    private var attentionStale: Set<String> = []

    /// Every request that answers with a desk (a status change, the desk read again, the summary read quietly) is
    /// numbered when sent, and the number of the newest answer put in place is kept per key: an answer to an older
    /// request never goes over a newer one (M2).
    private var deskSequence = 0
    private var deskApplied: (key: AppModel.StoreKey, sequence: Int)?

    private func nextDeskSequence() -> Int {
        deskSequence += 1
        return deskSequence
    }

    /// Whether the answer to request `sequence` for `key` may go in place (no newer one for the key went first), and if
    /// so, it is now the newest.
    private func claimDesk(_ sequence: Int, key: AppModel.StoreKey) -> Bool {
        if let applied = deskApplied, applied.key == key, applied.sequence > sequence { return false }
        deskApplied = (key, sequence)
        return true
    }

    /// Changes one item's status (`PUT /api/v2/desk/:org`) and returns the server's answer (with the request that undoes
    /// it), or nil when it was refused or failed (`deskProblem` says why, in the server's words). The answer's desk is
    /// put in place at once; when the server serves none (the Front Office being built again), the `desk-changed` event
    /// that follows reads it (`reloadDesk`).
    @discardableResult
    public func setDeskStatus(_ update: Components.Schemas.DeskUpdate, client: Client?, key: AppModel.StoreKey?) async -> Components.Schemas.DeskChange? {
        guard let client, let key else {
            deskProblem = .notRunning
            return nil
        }
        deskBusy.insert(update.key)
        defer { deskBusy.remove(update.key) }
        let sequence = nextDeskSequence()
        var problem: RequestProblem?
        var change: Components.Schemas.DeskChange?
        do {
            switch try await client.setDeskStatus(path: .init(org: Self.org(key)), body: .json(update)) {
            case .ok(let answer): change = try answer.body.json
            case .badRequest(let refused): problem = .served(try refused.body.json.error)
            case .notFound(let refused): problem = .served(try refused.body.json.error)
            case .undocumented(let code, let payload):
                problem = await .undocumented(code, body: payload.body, operation: "setDeskStatus", fromV2: true)
            }
        } catch {
            problem = .from(error)
        }
        deskProblem = problem
        if let detail = problem?.detail { log("could not change a desk status: \(detail)") }
        guard let change else { return nil }
        deskMoments += 1
        deskDone = (change.done.display, deskMoments)
        if let view = change.view {
            if claimDesk(sequence, key: key) { apply(deskView: view) }
        } else {
            attentionStale = Set(reports.keys)
            attentionRevision += 1
        }
        return change
    }

    /// Clears the last refusal (the GM dismissed it).
    public func dismissDeskProblem() { deskProblem = nil }

    /// Reads the desk again (`GET /api/v2/desk/:org`) when the served stamp is not the one shown: the `desk-changed` event
    /// (another window's change, an import that resolved items, a change whose answer served no desk).
    public func reloadDesk(stamp: String?, client: Client?, key: AppModel.StoreKey?) async {
        guard let client, let key, summary != nil else { return }
        if let stamp, stamp == summary?.deskStamp { return }
        let sequence = nextDeskSequence()
        do {
            let view = try await client.getDesk(path: .init(org: Self.org(key))).ok.body.json
            if claimDesk(sequence, key: key) { apply(deskView: view) }
        } catch {
            log("could not read the desk again: \(RequestProblem.logLine(error))")
        }
    }

    /// Reads the summary again in place, without saying "Updating" (a follow reorders the wire: the server composes the
    /// summary again on the same build). Nothing when no summary is shown or the key moved meanwhile. When the desk
    /// moved while it was asked (a status changed, the desk was read again), the desk shown stays, with its stamp (M2).
    public func refreshQuietly(client: Client?, key: AppModel.StoreKey?) async {
        guard let client, let key, summary != nil, summaryKey == key else { return }
        let sequence = nextDeskSequence()
        let deskStampAsked = summary?.deskStamp
        guard var served = try? await client.getFrontOffice(path: .init(org: Self.org(key))).ok.body.json,
              summaryKey == key, let shown = summary, served.orgId == shown.orgId, served.reportStamp == shown.reportStamp else { return }
        if shown.deskStamp != deskStampAsked || !claimDesk(sequence, key: key) {
            served.desk = shown.desk
            served.deskStamp = shown.deskStamp
        }
        summary = served
    }

    #if DEBUG
    /// A store holding served payloads, for `#Preview`s and snapshots (fed by `contract/fixtures/`).
    public static func preview(
        summary: Components.Schemas.FrontOfficeSummary?,
        reports: [String: Components.Schemas.DepartmentReport] = [:],
        trails: [String: Components.Schemas.ClaimTrail] = [:],
        key: AppModel.StoreKey?
    ) -> FrontOfficeStore {
        let store = FrontOfficeStore()
        store.summary = summary
        store.summaryKey = key
        store.shownKey = key
        store.reports = reports
        for department in reports.keys { store.reportKeys[department] = key }
        store.trails = trails
        store.trailsKey = key
        return store
    }
    #endif
}
