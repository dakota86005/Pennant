#if DEBUG
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

    public static var configuration: ServerConfiguration {
        .bundled(in: .main, dataFolder: URL(fileURLWithPath: "/tmp/ootp-fo-test", isDirectory: true))
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

    public static var providers: Components.Schemas.ProvidersResponse? {
        decode(Components.Schemas.ProvidersResponse.self, "getProviders")
    }

    /// A model with the server ready and the captured payloads.
    @MainActor
    public static func ready(
        configured: Bool = true,
        useTeamColors: Bool = true,
        importRequestProblem: RequestProblem? = nil
    ) -> AppModel {
        let status = status(configured: configured)
        let state: ServerState = status.map {
            .ready(ServerConnection(port: 5178, token: String(repeating: "p", count: 64), pid: 1, status: $0))
        } ?? .starting
        return .preview(
            configuration: configuration,
            state: state,
            status: status,
            settings: decode(Components.Schemas.SettingsResponse.self, "getSettings").map {
                var settings = $0
                settings.settings.useTeamColors = useTeamColors
                return settings
            },
            orgs: orgs,
            dataStatus: dataStatus(configured: configured),
            catalog: catalog,
            importRequestProblem: importRequestProblem
        )
    }

    /// A model in a server state other than ready.
    @MainActor
    public static func state(_ state: ServerState) -> AppModel {
        .preview(configuration: configuration, state: state)
    }
}
#endif
