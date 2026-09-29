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
        guard let key, summary != nil, let shown = shownKey,
              shown.saveId != key.saveId || shown.club != key.club || shown.importStamp != key.importStamp
        else { return nil }
        return shownCatalog
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
                self.waitingKept = last
            }
        }
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
    /// is not the key's; never while the last request failed (the problem line says so instead, and "Updating" would
    /// otherwise stay on for good).
    public func showsUpdating(for key: AppModel.StoreKey?) -> Bool {
        guard summary != nil, summaryProblem == nil else { return false }
        return summaryIsKept || loadingSummary || !summaryIsCurrent(for: key)
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

    /// Two keys that differ in nothing but the server's build stamp.
    nonisolated static func onlyTheBuildMoved(_ a: AppModel.StoreKey, _ b: AppModel.StoreKey) -> Bool {
        a.importStamp == b.importStamp && a.club == b.club && a.restores == b.restores
    }

    /// The club a request names: the served current club's id, or `automatic` (the server resolves it the same way).
    public nonisolated static func org(_ key: AppModel.StoreKey) -> String {
        key.club.map { String($0.id) } ?? "automatic"
    }

    public func summaryIsCurrent(for key: AppModel.StoreKey?) -> Bool {
        guard let summary else { return false }
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
        summaryAsked = key
        loadingSummary = true
        defer { if summaryAsked == key { loadingSummary = false } }
        let keptKey = Self.keptKey(key, contract: contract)
        if summary == nil, let kept, let keptKey {
            // Read and decoded at launch, off the main actor (the index's one file); another key's is read now, off it
            let last = await preloaded?.value
            // The report laid out hidden is another save's or club's: dropped, never shown
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
        guard let kept, let key, let summary, !summaryIsKept, let catalog, catalog.club != nil,
              let keptKey = Self.keptKey(key, contract: contract),
              summary.orgId == keptKey.clubId,
              Self.isCurrent(importStamp: summary.importStamp, reportStamp: summary.reportStamp, orgId: summary.orgId, for: key)
        else { return }
        // The report on screen is drawn with this catalog from now on
        shownCatalog = catalog
        let stamp = "\(summary.importStamp ?? "")|\(summary.reportStamp)"
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

    /// Forgets every kept payload (a data-folder restore).
    public func forgetKept() async {
        lastKept = nil
        await kept?.removeAll()
    }

    /// Loads one department's report for the key, once per key.
    public func loadReport(_ department: String, client: Client?, key: AppModel.StoreKey?) async {
        guard let client, let key, reportKeys[department] != key || reports[department] == nil else { return }
        if let loaded = reportKeys[department], Self.onlyTheBuildMoved(loaded, key), reports[department]?.reportStamp == key.reportStamp {
            reportKeys[department] = key
            return
        }
        reportAsked[department] = key
        loadingReports.insert(department)
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
        store.reports = reports
        for department in reports.keys { store.reportKeys[department] = key }
        store.trails = trails
        store.trailsKey = key
        return store
    }
    #endif
}
