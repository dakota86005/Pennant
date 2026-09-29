#if DEBUG
import AppKit
import FeatureCore
import Foundation
import PennantAPI
import PennantKit

/// Models for `#Preview`s and the snapshot tests, fed by the payloads the real server sent on the synthetic save
/// (`contract/fixtures/`), read where they are in the repository (SWIFTUI_REBUILD.md section 8). Debug builds only.
nonisolated public enum PreviewFixtures {
    /// The repository root, from this file's place in it (`macos/Packages/PennantFeatures/Sources/Shell/`).
    public static let repositoryRoot = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()

    public static let responses = repositoryRoot.appending(path: "contract/fixtures/responses")

    /// A captured response, decoded; nil when it is missing or no longer decodes.
    public static func decode<T: Decodable>(_ type: T.Type, _ name: String) -> T? {
        guard let data = try? Data(contentsOf: responses.appending(path: "\(name).json")) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }

    /// A caches folder of this run's own, in the temporary folder: a preview's or a snapshot's model never reads or
    /// writes a kept report another run (or another test process) left, and never the app's real caches.
    public static let cachesFolder = FileManager.default.temporaryDirectory
        .appending(path: "pennant-previews-\(ProcessInfo.processInfo.processIdentifier)-\(UUID().uuidString.prefix(8))", directoryHint: .isDirectory)

    public static var configuration: ServerConfiguration {
        .bundled(in: .main, dataFolder: URL(fileURLWithPath: "/tmp/ootp-fo-test", isDirectory: true), cachesFolder: cachesFolder)
    }

    /// The suffix of the responses captured with a save chosen.
    private static let chosen = "-configured"

    /// The captured status: of the chosen save (`getStatus-configured`), or of a server with none.
    public static func status(configured: Bool) -> Components.Schemas.ServerStatus? {
        decode(Components.Schemas.ServerStatus.self, "getStatus" + (configured ? Self.chosen : ""))
    }

    /// The captured data status in words, of the chosen save or of a server with none, so a preview never pairs one
    /// with the other.
    public static func dataStatus(configured: Bool) -> Components.Schemas.DataStatusView? {
        decode(Components.Schemas.DataStatusView.self, "getDataStatusWords" + (configured ? Self.chosen : ""))
    }

    /// The captured catalog (the synthetic save's clubs, records and departments).
    public static var catalog: Components.Schemas.Catalog? {
        decode(Components.Schemas.Catalog.self, "getCatalog")
    }

    public static var saves: [Components.Schemas.SaveInfo] {
        decode([Components.Schemas.SaveInfo].self, "listSaves") ?? []
    }

    public static var orgs: [Components.Schemas.Org] {
        decode([Components.Schemas.Org].self, "listOrgs") ?? []
    }

    /// The captured theme choices of the current club: its own colours and the repository's example pack.
    public static var themeChoices: Components.Schemas.ThemeChoices? {
        decode(Components.Schemas.ThemeChoices.self, "getThemeChoices")
    }

    /// The repository's example packs (`docs/theme-packs/<id>/pack.json`), read as the server would serve them once
    /// installed: every appearance's colours (the pack's own Increase Contrast ones, where it gives them), and its art
    /// at the path the server serves, kept in `ServedImages` so a preview draws it without a server. Only for a pack
    /// that gives all four appearances; the server makes the missing ones, which a fixture cannot.
    @MainActor
    public static func examplePack(_ id: String) -> Components.Schemas.ThemePack? {
        let folder = repositoryRoot.appending(path: "docs/theme-packs/\(id)")
        guard let data = try? Data(contentsOf: folder.appending(path: "pack.json")),
              let file = try? JSONDecoder().decode(ExamplePackFile.self, from: data),
              let lightIC = file.lightIncreasedContrast, let darkIC = file.darkIncreasedContrast
        else { return nil }
        var art: String?
        if let name = file.art, let image = NSImage(contentsOf: folder.appending(path: name)) {
            art = "/api/theme-packs/\(id)/\(name)"
            ServedImages.preload(art!, image: image)
        }
        return Components.Schemas.ThemePack(
            id: file.id, name: file.name, kind: .init(value1: .installed), version: file.version, teamId: nil,
            tokens: .init(light: file.light, dark: file.dark, lightIncreasedContrast: lightIC, darkIncreasedContrast: darkIC),
            logo: nil, art: art
        )
    }

    /// A pack's file, as the format has it (DEVELOPMENT.md "Making a theme pack").
    private struct ExamplePackFile: Decodable {
        var id: String
        var name: String
        var version: String
        var art: String?
        var light: Components.Schemas.ThemeTokens
        var dark: Components.Schemas.ThemeTokens
        var lightIncreasedContrast: Components.Schemas.ThemeTokens?
        var darkIncreasedContrast: Components.Schemas.ThemeTokens?
    }

    /// The catalog with the current club wearing a captured pack (`sunset-series`) or an example pack from the
    /// repository's docs, as the server serves it once chosen.
    @MainActor
    public static func catalog(wearing packID: String?, club teamID: Int?) -> Components.Schemas.Catalog? {
        guard var catalog, let packID, let teamID,
              let pack = themeChoices?.choices.first(where: { $0.id == packID }) ?? examplePack(packID)
        else { return catalog }
        catalog.clubs = catalog.clubs.map { club in
            var club = club
            if club.teamId == teamID { club.theme = pack }
            return club
        }
        return catalog
    }

    public static var providers: Components.Schemas.ProvidersResponse? {
        decode(Components.Schemas.ProvidersResponse.self, "getProviders")
    }

    /// The departments whose reports were captured (`getDepartmentReport-<id>`).
    public static let reportedDepartments = [
        "frontOffice", "majorLeague", "farm", "scouting", "trades", "finance", "medical", "league", "philosophy",
    ]

    /// The captured Front Office: the desk and cards, every department's report and an evidence trail.
    @MainActor
    public static var frontOffice: FrontOfficeStore {
        let reports = Dictionary(uniqueKeysWithValues: reportedDepartments.compactMap { id in
            decode(Components.Schemas.DepartmentReport.self, "getDepartmentReport-\(id)").map { (id, $0) }
        })
        let trail = decode(Components.Schemas.ClaimTrail.self, "getClaimTrail")
        return .preview(
            summary: decode(Components.Schemas.FrontOfficeSummary.self, "getFrontOffice"),
            reports: reports,
            trails: trail.map { [$0.key: $0] } ?? [:],
            key: nil
        )
    }

    // MARK: The GM's attention and the league (N7, Stage B)

    /// The captured Front Office after a second export: "since the last export" with its chips, an item set aside, the
    /// wire's top entries, and the department reports with what changed.
    @MainActor
    public static var frontOfficeSince: FrontOfficeStore {
        var reports = Dictionary(uniqueKeysWithValues: reportedDepartments.compactMap { id in
            decode(Components.Schemas.DepartmentReport.self, "getDepartmentReport-\(id)").map { (id, $0) }
        })
        if let since = decode(Components.Schemas.DepartmentReport.self, "getDepartmentReport-since-last-export") {
            reports[since.department.rawValue] = since
        }
        return .preview(summary: decode(Components.Schemas.FrontOfficeSummary.self, "getFrontOffice-since-last-export"), reports: reports, key: nil)
    }

    /// Following as captured: nothing followed yet with the division's rivals suggested (`getFollowing`), or with a club
    /// followed (`follow-club`'s view) and a player (`follow-player`'s); with a refusal's sentence when given.
    @MainActor
    public static func following(followed: Bool = false, refusal: RequestProblem? = nil) -> FollowingStore {
        guard followed else { return .preview(decode(Components.Schemas.Following.self, "getFollowing"), refusal: refusal) }
        var view = decode(Components.Schemas.FollowChange.self, "follow-club")?.view
        if let player = decode(Components.Schemas.FollowChange.self, "follow-player")?.view.players { view?.players = player }
        view?.empty = nil
        return .preview(view, refusal: refusal)
    }

    /// The captured wire and a rival's report (`getWire`, `getClubReport`).
    @MainActor
    public static var league: LeagueStore {
        .preview(wire: decode(Components.Schemas.Wire.self, "getWire"), clubs: decode(Components.Schemas.ClubReport.self, "getClubReport").map { [$0] } ?? [])
    }

    /// The captured search answer for "club".
    public static var search: Components.Schemas.SearchAnswer? {
        decode(Components.Schemas.SearchAnswer.self, "search")
    }

    // MARK: Finding the save and the rating history (N6, Stage B2)

    /// The captured discovery (`GET /api/v2/saves`: the pretend save, nothing picked, why).
    public static var discovery: Components.Schemas.SaveDiscovery? {
        decode(Components.Schemas.SaveDiscovery.self, "getSaveDiscovery")
    }

    /// The captured "nothing stands out" answer of the first run's automatic setup.
    public static var nothingStandsOut: Components.Schemas.AutomaticSetup? {
        decode(Components.Schemas.AutomaticSetup.self, "setUpAutomatically-nothing-stands-out")
    }

    /// The captured "played since" notice (the `save-played-elsewhere` event's payload).
    public static var playedElsewhere: Components.Schemas.SavePlayedElsewhere? {
        guard let text = try? String(contentsOf: repositoryRoot.appending(path: "contract/fixtures/events-save-played-elsewhere.sse"), encoding: .utf8),
              let line = text.split(separator: "\n").first(where: { $0.hasPrefix("data: ") })
        else { return nil }
        struct Event: Decodable { var savePlayedElsewhere: Components.Schemas.SavePlayedElsewhere? }
        return (try? JSONDecoder().decode(Event.self, from: Data(line.dropFirst(6).utf8)))?.savePlayedElsewhere
    }

    /// The captured rating history: `offer` (a save that moved, with its question and the picker), `adopt` (a
    /// carry-over in force, with the warning), or none to ask (`getRatingHistory`).
    public static func ratingHistory(_ name: String) -> Components.Schemas.RatingHistoryView? {
        let file: String
        switch name {
        case "": file = "getRatingHistory"
        case "adopt": file = "answerRatingHistoryOffer-adopt"
        default: file = "getRatingHistory-" + name
        }
        return decode(Components.Schemas.RatingHistoryView.self, file)
    }

    /// A model with the server ready and the captured payloads.
    @MainActor
    public static func ready(
        configured: Bool = true,
        useTeamColors: Bool = true,
        themePack: String? = nil,
        importRequestProblem: RequestProblem? = nil,
        ratingHistory: Components.Schemas.RatingHistoryView? = nil,
        savePlayedElsewhere: Components.Schemas.SavePlayedElsewhere? = nil,
        since: Bool = false,
        following: FollowingStore? = nil,
        clubOwed: Components.Schemas.ClubOwed? = nil
    ) -> AppModel {
        var status = status(configured: configured)
        if let clubOwed { status?.clubOwed = clubOwed }
        let settings = decode(Components.Schemas.SettingsResponse.self, "getSettings").map {
            var settings = $0
            settings.settings.useTeamColors = useTeamColors
            return settings
        }
        let state: ServerState = status.map {
            .ready(ServerConnection(port: 5178, token: String(repeating: "p", count: 64), pid: 1, status: $0))
        } ?? .starting
        return .preview(
            configuration: configuration,
            state: state,
            status: status,
            settings: settings,
            orgs: orgs,
            dataStatus: dataStatus(configured: configured),
            catalog: catalog(wearing: themePack, club: settings?.organization?.id),
            themeChoices: themeChoices.map {
                var choices = $0
                if let themePack {
                    choices.active = themePack
                    if !choices.choices.contains(where: { $0.id == themePack }), let pack = examplePack(themePack) {
                        choices.choices.append(pack)
                    }
                }
                return choices
            },
            importRequestProblem: importRequestProblem,
            frontOffice: configured ? (since ? frontOfficeSince : frontOffice) : nil,
            ratingHistory: ratingHistory ?? (configured ? Self.ratingHistory("") : nil),
            savePlayedElsewhere: savePlayedElsewhere,
            following: configured ? (following ?? Self.following()) : nil,
            league: configured ? league : nil
        )
    }

    /// A model in a server state other than ready.
    @MainActor
    public static func state(_ state: ServerState) -> AppModel {
        .preview(configuration: configuration, state: state)
    }
}
#endif
