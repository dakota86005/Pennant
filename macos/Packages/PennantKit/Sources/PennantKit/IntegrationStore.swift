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
    private let log: @MainActor (String) -> Void

    /// Each new glance, as the snapshot the widget reads (the app writes it to the App Group and asks the widget to reload).
    public var onSnapshot: (@MainActor (GlanceSnapshot) -> Void)?
    /// Each new list for Spotlight (the app indexes exactly it).
    public var onSpotlight: (@MainActor (Components.Schemas.SpotlightList) -> Void)?

    struct GlanceKey: Equatable {
        var key: AppModel.StoreKey
        var deskStamp: String?
    }

    public init(log: @escaping @MainActor (String) -> Void = { _ in }) {
        self.log = log
    }

    #if DEBUG
    /// A store holding a served glance and list without a server, for `#Preview`s and snapshots.
    public static func preview(glance: Components.Schemas.Glance?, spotlight: Components.Schemas.SpotlightList? = nil) -> IntegrationStore {
        let store = IntegrationStore()
        store.glance = glance
        store.spotlight = spotlight
        return store
    }
    #endif

    /// Reads the glance (once per key and desk stamp) and Spotlight's list (once per key), and hands each on.
    /// - Parameters:
    ///   - deskStamp: the desk's served stamp as last seen (the Front Office's), so a status change reads the glance again.
    ///   - colors: the club card's served colours for the snapshot; nil for the neutral ones.
    public func load(
        client: Client?, key: AppModel.StoreKey?, deskStamp: String?, colors: GlanceSnapshot.Colors?, now: Date = Date()
    ) async {
        guard let client, let key else { return }
        let glanceKey = GlanceKey(key: key, deskStamp: deskStamp)
        if glanceAsked != glanceKey {
            glanceAsked = glanceKey
            if let served = await read("getGlance", { try await client.getGlance(path: .init(org: FrontOfficeStore.org(key))) }) {
                guard glanceAsked == glanceKey else { return }
                glance = served
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

    /// A player or club as Shortcuts and Spotlight show it: its id, and its name and line as served.
    public struct EntityLine: Sendable, Equatable {
        public let id: Int
        public let name: String
        public let line: String

        public init(id: Int, name: String, line: String) {
            self.id = id
            self.name = name
            self.line = line
        }
    }

    /// The served results as entities, in the order served; a result whose id is not a whole number (a view, the
    /// search's "All in Player Search") is no entity.
    public nonisolated static func entityLines(_ results: [Components.Schemas.SearchResult]) -> [EntityLine] {
        results.compactMap { result in Int(result.id).map { EntityLine(id: $0, name: result.title, line: result.line) } }
    }

    /// The served results of one kind.
    public nonisolated static func entityLines(_ results: [Components.Schemas.SearchResult], kind: EntityKind) -> [EntityLine] {
        entityLines(results.filter { ($0.kind.value1?.rawValue ?? $0.kind.value2) == kind.rawValue })
    }

    /// The entities for these ids, in the order asked, from the served list. An id the list does not hold (a player
    /// found in the search outside our organization, or a list not read yet) keeps its id with no words: what opens him
    /// is his id, and his window reads the rest from the server.
    public func entities(for ids: [Int], kind: EntityKind) -> [EntityLine] {
        let served = suggested(kind)
        return ids.map { id in served.first { $0.id == id } ?? EntityLine(id: id, name: "", line: "") }
    }

    /// The served list's players or clubs, in its order (by name): Shortcuts' suggestions.
    public func suggested(_ kind: EntityKind) -> [EntityLine] {
        guard let spotlight else { return [] }
        return Self.entityLines(kind == .player ? spotlight.players : spotlight.clubs)
    }

    /// The served search's players or clubs for what was typed (`GET /api/v2/search?q=`), in the order served; none when
    /// the server is not there or the read failed (logged by kind, never the words typed).
    public func search(_ text: String, kind: EntityKind, client: Client?) async -> [EntityLine] {
        guard let client, !text.trimmingCharacters(in: .whitespaces).isEmpty else { return [] }
        do {
            let answer = try await client.search(query: .init(q: text)).ok.body.json
            return answer.groups.flatMap { Self.entityLines($0.results, kind: kind) }
        } catch {
            if !RequestProblem.isCancellation(error) { log("could not search for Shortcuts: \(RequestProblem.logLine(error))") }
            return []
        }
    }
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
