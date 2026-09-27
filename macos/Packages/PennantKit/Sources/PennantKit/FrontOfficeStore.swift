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
/// app's own caches (`KeptReports`) and shown at once, said to be updating, while the server's fresh one is fetched
/// and swapped in place; every fresh payload is kept for the next launch.
@Observable @MainActor
public final class FrontOfficeStore {
    /// The Morning Report's desk and cards, as last served.
    public private(set) var summary: Components.Schemas.FrontOfficeSummary?
    /// Why the last summary request failed; nil when it did not.
    public private(set) var summaryProblem: RequestProblem?
    /// The shown summary is the one kept from an earlier launch, not yet replaced by the server's (the view says it
    /// is updating; the payload's own served kicker says how current it is).
    public private(set) var summaryIsKept = false
    /// Each department's report, as last served, by department id.
    public private(set) var reports: [String: Components.Schemas.DepartmentReport] = [:]
    public private(set) var reportProblems: [String: RequestProblem] = [:]
    /// Evidence trails fetched on demand, by evidence key (dropped when the key moves).
    public private(set) var trails: [String: Components.Schemas.ClaimTrail] = [:]
    public private(set) var trailProblems: [String: RequestProblem] = [:]
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
    /// The contract this build was made against, part of every kept payload's key.
    private let contractVersion: String

    /// Every payload kept in the folder, read at the store's making (the launch) off the main actor, so the one for
    /// the key is in hand when the key is known; nil with nowhere to keep.
    private let preloaded: Task<[KeptReports.Key: Components.Schemas.FrontOfficeSummary], Never>?
    /// When the store was made, for the launch's log line.
    private let made = ContinuousClock.now

    public init(kept: KeptReports? = nil, contractVersion: String = "", log: @escaping @MainActor (String) -> Void = { _ in }) {
        self.kept = kept
        self.contractVersion = contractVersion
        self.log = log
        preloaded = kept.map { kept in Task.detached(priority: .userInitiated) { kept.readAll() } }
    }

    /// What a kept payload is for, from a store key: the save the status names and the club the app shows; nil while
    /// either is not known (nothing kept is read or written then).
    nonisolated static func keptKey(_ key: AppModel.StoreKey, contractVersion: String) -> KeptReports.Key? {
        guard let saveId = key.saveId, !saveId.isEmpty, let club = key.club else { return nil }
        return KeptReports.Key(saveId: saveId, clubId: club.id, contractVersion: contractVersion)
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
    public func loadSummary(client: Client?, key: AppModel.StoreKey?) async {
        guard let client, let key, summaryKey != key || summary == nil else { return }
        // Only the build stamp moved, to the build the store already has (read just before the event): nothing to ask
        if let loaded = summaryKey, Self.onlyTheBuildMoved(loaded, key), summary?.reportStamp == key.reportStamp {
            summaryKey = key
            return
        }
        summaryAsked = key
        loadingSummary = true
        defer { if summaryAsked == key { loadingSummary = false } }
        let keptKey = Self.keptKey(key, contractVersion: contractVersion)
        if summary == nil, let preloaded, let keptKey {
            // Read and decoded at launch, off the main actor; shown only if nothing arrived meanwhile
            let stored = await preloaded.value[keptKey]
            guard summaryAsked == key else { return }
            if let stored, summary == nil {
                summary = stored
                summaryIsKept = true
                log("showing the kept Morning Report \(Int((ContinuousClock.now - made) / .milliseconds(1))) ms after the store was made")
            }
        }
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
        if let served {
            summary = served
            summaryKey = key
            summaryIsKept = false
            // Kept for the next launch, atomically, off the main actor; a write that fails is logged and costs nothing
            if let kept, let keptKey {
                let log = log
                Task.detached(priority: .utility) {
                    do { try kept.write(served, for: keptKey) } catch { await log("could not keep the Morning Report: \(error)") }
                }
            }
        }
        summaryProblem = problem
        if let detail = problem?.detail { log("could not read the Front Office: \(detail)") }
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
