import Foundation
import Observation
import OpenAPIRuntime
import PennantAPI
import PennantGlance

/// Pennant outside its windows (N14, Stage A, D-075): the glance the menu bar extra draws and the widget is written
/// (`GET /api/v2/glance/:org`), and the list Spotlight is given (`GET /api/v2/spotlight/:org`). Both are read on the
/// store key, the glance again when the desk's stamp moves (the GM marked an item), and handed on as served: the glance
/// as a `GlanceSnapshot` for the App Group, the list to whoever indexes it. Nothing here chooses who or what matters.
@Observable @MainActor
public final class IntegrationStore {
    /// The glance as last served.
    public private(set) var glance: Components.Schemas.Glance?
    /// Spotlight's list as last served.
    public private(set) var spotlight: Components.Schemas.SpotlightList?
    /// Why the last read failed; nil when it did not.
    public private(set) var problem: RequestProblem?

    /// The key and desk stamp the glance was read for, and the key the list was read for.
    private var glanceAsked: GlanceKey?
    private var spotlightAsked: AppModel.StoreKey?
    /// The key the list held was read for: its save names the entities made from it.
    private var listKey: AppModel.StoreKey?
    /// The save of the key last loaded: an entity id of another save's resolves to nothing.
    private var currentSave: String?
    /// The players and clubs the served search last gave Shortcuts, by entity id, so one picked there resolves.
    private var searched: [String: EntityLine] = [:]
    /// Whose glance and list are held: the save (as served, when known) and the club.
    private var holder: Holder?
    /// Whether what Pennant left outside its windows has been removed since anything was last handed on.
    private var cleared = false
    private let log: @MainActor (String) -> Void

    /// Each new glance, as the snapshot the widget reads (the app writes it to the App Group and asks the widget to reload).
    public var onSnapshot: (@MainActor (GlanceSnapshot) -> Void)?
    /// Each new list for Spotlight (the app indexes exactly it, as `suggested` gives it).
    public var onSpotlight: (@MainActor (Components.Schemas.SpotlightList) -> Void)?
    /// What Pennant left outside its windows is to go: the widget's snapshot and Spotlight's entries (`settle`).
    public var onClear: (@MainActor () -> Void)?

    struct GlanceKey: Equatable {
        var key: AppModel.StoreKey
        var deskStamp: String?
    }

    /// The save and club a glance and a list belong to.
    struct Holder: Equatable {
        var save: String?
        var club: Int?

        /// Another save or club. A save not known on one side (the status serves its id only once it has looked at the
        /// save) is no change of save.
        func isOther(than other: Holder) -> Bool {
            club != other.club || (save != nil && other.save != nil && save != other.save)
        }
    }

    /// What `settle` found.
    public enum Settled: Equatable, Sendable {
        /// Nothing to read yet: the server or its settings are not in.
        case waiting
        /// No save is set, or the club question is open: what was outside the windows is removed, nothing is read.
        case cleared
        /// Read for this key (`load`), after removing what another save or club left, when it did.
        case load
    }

    public init(log: @escaping @MainActor (String) -> Void = { _ in }) {
        self.log = log
    }

    #if DEBUG
    /// A store holding a served glance and list without a server, for `#Preview`s and snapshots; the list read for
    /// `save`.
    public static func preview(
        glance: Components.Schemas.Glance?, spotlight: Components.Schemas.SpotlightList? = nil, save: String? = "preview"
    ) -> IntegrationStore {
        let store = IntegrationStore()
        store.glance = glance
        store.spotlight = spotlight
        let key = AppModel.StoreKey(importStamp: "preview", club: nil, restores: 0, saveId: save)
        store.listKey = spotlight == nil ? nil : key
        store.currentSave = save
        store.holder = Holder(save: save, club: nil)
        return store
    }
    #endif

    /// Follows the app's state before a load (review N14A, M3): with the club question open or no save set, and on a
    /// key naming another save or club than the one held, what Pennant left outside its windows (the widget's snapshot,
    /// Spotlight's entries) is removed through `onClear`, once, and the store forgets its glance, list and entities.
    /// - Parameters:
    ///   - configured: whether a save is set, as the status serves it; nil before the status is read.
    ///   - owed: whether the club question is open.
    public func settle(key: AppModel.StoreKey?, configured: Bool?, owed: Bool) -> Settled {
        if owed || configured == false {
            clear()
            return .cleared
        }
        guard let key else { return .waiting }
        let now = Holder(save: key.saveId, club: key.club?.id)
        if let held = holder, held.isOther(than: now) { clear() }
        holder = Holder(save: now.save ?? holder?.save, club: now.club)
        return .load
    }

    /// Forgets the glance, the list and the entities, and asks for what is outside the windows to be removed, once
    /// until something is handed on again.
    private func clear() {
        glance = nil
        spotlight = nil
        problem = nil
        glanceAsked = nil
        spotlightAsked = nil
        listKey = nil
        searched = [:]
        holder = nil
        guard !cleared else { return }
        cleared = true
        onClear?()
    }

    /// Reads the glance (once per key and desk stamp) and Spotlight's list (once per key), and hands each on.
    /// - Parameters:
    ///   - deskStamp: the desk's served stamp as last seen (the Front Office's), so a status change reads the glance again.
    ///   - colors: the club card's served colours for the snapshot; nil for the neutral ones.
    public func load(
        client: Client?, key: AppModel.StoreKey?, deskStamp: String?, colors: GlanceSnapshot.Colors?, now: Date = Date()
    ) async {
        guard let client, let key else { return }
        currentSave = key.saveId
        let glanceKey = GlanceKey(key: key, deskStamp: deskStamp)
        if glanceAsked != glanceKey {
            glanceAsked = glanceKey
            if let served = await read("getGlance", { try await client.getGlance(path: .init(org: FrontOfficeStore.org(key))) }) {
                guard glanceAsked == glanceKey else { return }
                glance = served
                cleared = false
                onSnapshot?(Self.snapshot(of: served, colors: colors, at: now))
            } else if glanceAsked == glanceKey {
                // Read again next time rather than keep a key that was never answered
                glanceAsked = nil
            }
        }
        if spotlightAsked != key {
            spotlightAsked = key
            if let served = await read("getSpotlightList", { try await client.getSpotlightList(path: .init(org: FrontOfficeStore.org(key))) }) {
                guard spotlightAsked == key else { return }
                spotlight = served
                listKey = key
                searched = [:]
                cleared = false
                onSpotlight?(served)
            } else if spotlightAsked == key {
                spotlightAsked = nil
            }
        }
    }

    /// One read in the contract's shape: the payload, or nil with the problem kept and logged (a cancelled read is a
    /// non-event).
    private func read<Output: Sendable>(_ operation: String, _ call: () async throws -> Output) async -> Output.Payload?
    where Output: IntegrationAnswer {
        do {
            switch try await call().answer {
            case .ok(let payload):
                problem = nil
                return payload
            case .refused(let sentence):
                problem = .served(sentence)
            case .undocumented(let code, let body):
                problem = await .undocumented(code, body: body, operation: operation, fromV2: true)
            }
        } catch {
            if RequestProblem.isCancellation(error) || Task.isCancelled { return nil }
            problem = .from(error)
            log("could not read \(operation): \(RequestProblem.logLine(error))")
            return nil
        }
        if let problem { log("could not read \(operation): \(problem.detail ?? "a served refusal")") }
        return nil
    }

    /// The snapshot of a served glance: its words and figures as served, nothing added.
    public nonisolated static func snapshot(
        of glance: Components.Schemas.Glance, colors: GlanceSnapshot.Colors?, at now: Date
    ) -> GlanceSnapshot {
        GlanceSnapshot(
            writtenAt: now,
            club: glance.club?.display,
            asOf: glance.asOf.display,
            record: glance.record.map { .init(display: $0.value?.display ?? $0.text, spoken: $0.text) },
            nextGame: glance.nextGame.map { .init(when: $0.when.display, matchup: $0.matchup.display) },
            missing: glance.missing.map(\.display),
            desk: .init(
                count: glance.desk.count,
                line: glance.desk.line.display,
                top: glance.desk.top.map { .init(headline: $0.headline.text, department: $0.department.display) }
            ),
            colors: colors
        )
    }

    /// The club card's colours in a served theme, for the snapshot; nil when team colours are off or none is served.
    public nonisolated static func colors(of pack: Components.Schemas.ThemePack?, useTeamColors: Bool) -> GlanceSnapshot.Colors? {
        guard useTeamColors, let tokens = pack?.tokens else { return nil }
        func pair(_ t: Components.Schemas.ThemeTokens) -> GlanceSnapshot.Pair { .init(background: t.card, text: t.cardText) }
        return .init(
            light: pair(tokens.light), dark: pair(tokens.dark),
            lightIncreasedContrast: pair(tokens.lightIncreasedContrast), darkIncreasedContrast: pair(tokens.darkIncreasedContrast)
        )
    }
}

// MARK: Players and clubs for Shortcuts and Spotlight

extension IntegrationStore {
    /// Which kind of entity.
    public enum EntityKind: String, Sendable {
        case player, club
    }

    /// A player or club as Shortcuts and Spotlight show it: its entity id (`entityID`: the save's and its own), its own
    /// id (a `PlayerRef`'s or `ClubRef`'s), and its name and line as served.
    public struct EntityLine: Sendable, Equatable {
        public let id: String
        public let number: Int
        public let name: String
        public let line: String

        public init(save: String?, number: Int, name: String, line: String) {
            id = IntegrationStore.entityID(save: save, number: number)
            self.number = number
            self.name = name
            self.line = line
        }
    }

    /// An entity's id: the save's served id and the player's or club's own, so a Spotlight entry or a shortcut kept from
    /// another save never opens this save's player of the same number (review N14A, M3). A save whose id is not served
    /// yet is "-".
    public nonisolated static func entityID(save: String?, number: Int) -> String {
        "\(save ?? "-"):\(number)"
    }

    /// The player's or club's own id in an entity id of this save's; nil for another save's, or for no entity id.
    public nonisolated static func number(in entityID: String, save: String?) -> Int? {
        guard let colon = entityID.lastIndex(of: ":"), entityID[..<colon] == (save ?? "-") else { return nil }
        return Int(entityID[entityID.index(after: colon)...])
    }

    /// The served results as entities of a save, in the order served; a result whose id is not a whole number (a view,
    /// the search's "All in Player Search") is no entity.
    public nonisolated static func entityLines(_ results: [Components.Schemas.SearchResult], save: String?) -> [EntityLine] {
        results.compactMap { result in
            Int(result.id).map { EntityLine(save: save, number: $0, name: result.title, line: result.line) }
        }
    }

    /// The served results of one kind.
    public nonisolated static func entityLines(
        _ results: [Components.Schemas.SearchResult], kind: EntityKind, save: String?
    ) -> [EntityLine] {
        entityLines(results.filter { ($0.kind.value1?.rawValue ?? $0.kind.value2) == kind.rawValue }, save: save)
    }

    /// The entities for these ids, in the order asked: those of the served list, or of the served search Shortcuts was
    /// last given. An id of another save's, or one neither holds, resolves to nothing, never to a nameless entity.
    public func entities(for ids: [String], kind: EntityKind) -> [EntityLine] {
        let listed = suggested(kind)
        return ids.compactMap { id in
            guard Self.number(in: id, save: currentSave) != nil else { return nil }
            return listed.first { $0.id == id } ?? searched[kindKey(kind, id)]
        }
    }

    /// The served list's players or clubs, in its order (by name): Shortcuts' suggestions, and what Spotlight is given.
    public func suggested(_ kind: EntityKind) -> [EntityLine] {
        guard let spotlight, let listKey else { return [] }
        return Self.entityLines(kind == .player ? spotlight.players : spotlight.clubs, save: listKey.saveId)
    }

    /// The list's identity for Spotlight: the save, the club, the import and the list's own import stamp and size. The
    /// indexer replaces Spotlight's entries only when it moves.
    public var indexStamp: String? {
        guard let spotlight, let listKey else { return nil }
        let parts = [
            listKey.saveId ?? "-", listKey.club.map { String($0.id) } ?? "-", listKey.importStamp, spotlight.importStamp ?? "-",
            String(spotlight.players.count), String(spotlight.clubs.count),
        ]
        return parts.joined(separator: "|")
    }

    /// The served search's players or clubs for what was typed (`GET /api/v2/search?q=`), in the order served; none when
    /// the server is not there or the read failed (logged by kind, never the words typed).
    public func search(_ text: String, kind: EntityKind, client: Client?) async -> [EntityLine] {
        guard let client, !text.trimmingCharacters(in: .whitespaces).isEmpty else { return [] }
        let save = currentSave
        do {
            let answer = try await client.search(query: .init(q: text)).ok.body.json
            let found = answer.groups.flatMap { Self.entityLines($0.results, kind: kind, save: save) }
            if save == currentSave { for line in found { searched[kindKey(kind, line.id)] = line } }
            return found
        } catch {
            if !RequestProblem.isCancellation(error) { log("could not search for Shortcuts: \(RequestProblem.logLine(error))") }
            return []
        }
    }

    private func kindKey(_ kind: EntityKind, _ id: String) -> String { "\(kind.rawValue)/\(id)" }
}

/// The two reads' answers, alike: a payload, the server's refusal, or a status the contract does not document.
protocol IntegrationAnswer: Sendable {
    associatedtype Payload: Sendable
    var answer: IntegrationOutcome<Payload> { get throws }
}

enum IntegrationOutcome<Payload: Sendable> {
    case ok(Payload)
    case refused(String)
    case undocumented(Int, HTTPBody?)
}

extension Operations.GetGlance.Output: IntegrationAnswer {
    var answer: IntegrationOutcome<Components.Schemas.Glance> {
        get throws {
            switch self {
            case .ok(let ok): .ok(try ok.body.json)
            case .notFound(let refused): .refused(try refused.body.json.error)
            case .undocumented(let code, let payload): .undocumented(code, payload.body)
            }
        }
    }
}

extension Operations.GetSpotlightList.Output: IntegrationAnswer {
    var answer: IntegrationOutcome<Components.Schemas.SpotlightList> {
        get throws {
            switch self {
            case .ok(let ok): .ok(try ok.body.json)
            case .notFound(let refused): .refused(try refused.body.json.error)
            case .undocumented(let code, let payload): .undocumented(code, payload.body)
            }
        }
    }
}
