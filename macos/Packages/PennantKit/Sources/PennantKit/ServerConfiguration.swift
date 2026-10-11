import Foundation

/// Where the server and its data are, and how it is started (SWIFTUI_REBUILD.md sections 5.2, 5.3 and 7).
public struct ServerConfiguration: Sendable, Equatable {
    /// The pinned Node binary, `Contents/Helpers/pennant-server`.
    public var nodeExecutable: URL
    /// `Contents/Resources/server/`: `server.cjs`, the refit workers, `package.json` and `node_modules`.
    public var serverRoot: URL
    /// The data folder the server reads and writes (shared with the Electron app, D-049).
    public var dataFolder: URL
    /// Where `server.log` is written.
    public var logFolder: URL
    /// `CFBundleShortVersionString`, which the server reports as its version.
    public var appVersion: String
    /// Other variables for the child (a development run may add `OOTP_FO_DB_READONLY`). Never a secret: those
    /// travel on stdin.
    public var extraEnvironment: [String: String]
    /// Whether this data folder was chosen on purpose. Always true in a release build; false for a development
    /// build given neither a scratch folder nor the explicit opt-in to the real one, which then starts no server.
    public var dataFolderChosen: Bool
    /// The app's own caches (the Morning Report kept across launches, `KeptReports`): the bundle's caches folder in a
    /// release build; never the data folder. Beside the log folder when none is given (a test's scratch).
    public var cachesFolder: URL
    /// Whether a first run may choose and import the save that clearly stands out by itself
    /// (`POST /api/v2/setup/automatic`, D-063). Always in a release build. A development build does it only on a pretend
    /// home (`PENNANT_DEV_HOME`), so a Debug build on a scratch data folder never imports the developer's own save by
    /// itself; it still lists the saves it finds, as before.
    public var findsSavesAutomatically: Bool

    public init(
        nodeExecutable: URL,
        serverRoot: URL,
        dataFolder: URL,
        logFolder: URL,
        appVersion: String,
        extraEnvironment: [String: String] = [:],
        dataFolderChosen: Bool = true,
        cachesFolder: URL? = nil,
        findsSavesAutomatically: Bool = true
    ) {
        self.findsSavesAutomatically = findsSavesAutomatically
        self.nodeExecutable = nodeExecutable
        self.serverRoot = serverRoot
        self.dataFolder = dataFolder
        self.logFolder = logFolder
        self.appVersion = appVersion
        self.extraEnvironment = extraEnvironment
        self.dataFolderChosen = dataFolderChosen
        self.cachesFolder = cachesFolder ?? logFolder.deletingLastPathComponent().appending(path: "caches", directoryHint: .isDirectory)
    }

    /// The release data folder: `~/Library/Application Support/ootp-front-office` (the D-049 hold on the name).
    public static var releaseDataFolder: URL {
        URL.applicationSupportDirectory.appending(path: "ootp-front-office", directoryHint: .isDirectory)
    }

    /// The release log folder: `~/Library/Logs/Pennant`.
    public static var releaseLogFolder: URL {
        URL.libraryDirectory.appending(path: "Logs/Pennant", directoryHint: .isDirectory)
    }

    /// The app's own caches folder for a bundle: `~/Library/Caches/<bundle id>`.
    public static func releaseCachesFolder(for bundle: Bundle) -> URL {
        (FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first ?? FileManager.default.temporaryDirectory)
            .appending(path: bundle.bundleIdentifier ?? "Pennant", directoryHint: .isDirectory)
    }

    /// The server inside an app bundle, with the given data and log folders.
    public static func bundled(
        in bundle: Bundle,
        dataFolder: URL = releaseDataFolder,
        logFolder: URL = releaseLogFolder,
        extraEnvironment: [String: String] = [:],
        cachesFolder: URL? = nil
    ) -> ServerConfiguration {
        let contents = bundle.bundleURL.appending(path: "Contents", directoryHint: .isDirectory)
        return ServerConfiguration(
            nodeExecutable: contents.appending(path: "Helpers/pennant-server"),
            serverRoot: contents.appending(path: "Resources/server", directoryHint: .isDirectory),
            dataFolder: dataFolder,
            logFolder: logFolder,
            appVersion: bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown",
            extraEnvironment: extraEnvironment,
            cachesFolder: cachesFolder ?? releaseCachesFolder(for: bundle)
        )
    }

    /// The bundled entry point.
    public var entry: URL { serverRoot.appending(path: "server.cjs") }

    /// The server's log file.
    public var logFile: URL { logFolder.appending(path: "server.log") }

    /// The launch: `pennant-server server.cjs`, with only the variables the server needs. The app's own
    /// environment is not passed on, so a provider key set in a shell cannot outrank the Keychain's.
    public func launchSpec(inheriting parent: [String: String] = ProcessInfo.processInfo.environment) -> LaunchSpec {
        var environment: [String: String] = [:]
        for name in ["HOME", "USER", "LOGNAME", "TMPDIR", "LANG", "LC_ALL"] {
            if let value = parent[name] { environment[name] = value }
        }
        environment["PATH"] = "/usr/bin:/bin:/usr/sbin:/sbin"
        environment.merge(extraEnvironment) { _, extra in extra }
        environment["OOTP_FO_DATA_DIR"] = dataFolder.plainPath
        environment["OOTP_FO_APP_ROOT"] = serverRoot.plainPath
        environment["OOTP_FO_APP_VERSION"] = appVersion
        environment["OOTP_FO_BIND"] = "127.0.0.1"
        environment["OOTP_FO_EMBEDDED"] = "1"
        return LaunchSpec(
            executable: nodeExecutable,
            arguments: [entry.plainPath],
            environment: environment,
            currentDirectory: serverRoot
        )
    }
}

extension URL {
    /// The file path without percent-encoding or a trailing slash, as a child process expects it.
    public var plainPath: String {
        let path = standardizedFileURL.path(percentEncoded: false)
        return path.count > 1 && path.hasSuffix("/") ? String(path.dropLast()) : path
    }
}

#if DEBUG
extension ServerConfiguration {
    /// A development build's folders (review S5): never the real data folder unless someone chose it.
    /// - `PENNANT_DEV_DATA_DIR=<folder>` or `-PennantDevDataFolder <folder>`: that scratch folder, with the log in
    ///   `PENNANT_DEV_LOG_DIR` / `-PennantDevLogFolder`, else `logs/` inside it, and the app's own caches (the kept
    ///   Morning Report) in `PENNANT_DEV_CACHES_DIR` / `-PennantDevCachesFolder`, else the Debug bundle's own caches
    ///   folder; `OOTP_FO_DB_READONLY` is passed on. `PENNANT_DEV_HOME` / `-PennantDevHome <folder>` is the home the
    ///   server looks for OOTP saves in (a pretend one), and only then does a first run choose a save by itself.
    /// - `PENNANT_DEV_USE_REAL_DATA=1` or `-PennantUseRealDataFolder YES`: the release folders, on purpose.
    /// - Neither: the release paths are named but `dataFolderChosen` is false, so no server starts and nothing is
    ///   written there; the log goes to a temporary folder.
    /// Compiled only into Debug builds; a release build always uses `bundled(in:)`'s release folders.
    public static func development(
        in bundle: Bundle,
        environment: [String: String],
        defaults: UserDefaults
    ) -> ServerConfiguration {
        func folder(_ path: String) -> URL {
            URL(fileURLWithPath: (path as NSString).expandingTildeInPath, isDirectory: true)
        }
        func text(_ variable: String, _ key: String) -> String? {
            let value = environment[variable] ?? defaults.string(forKey: key)
            return value?.isEmpty == false ? value : nil
        }
        if let data = text("PENNANT_DEV_DATA_DIR", "PennantDevDataFolder") {
            let dataFolder = folder(data)
            let logs = text("PENNANT_DEV_LOG_DIR", "PennantDevLogFolder").map(folder)
                ?? dataFolder.appending(path: "logs", directoryHint: .isDirectory)
            var extra: [String: String] = [:]
            if let readOnly = environment["OOTP_FO_DB_READONLY"] { extra["OOTP_FO_DB_READONLY"] = readOnly }
            // A stand-in AI provider on this Mac for the UI tests (N13: `macos/scripts/fake-ai-provider.mjs`, an
            // OpenAI-compatible server the local provider is pointed at); never a real provider, never a key
            if let fake = text("PENNANT_DEV_LOCAL_AI_URL", "PennantDevLocalAIURL") { extra["OLLAMA_BASE_URL"] = fake }
            // A pretend home for the server to find saves in (the UI tests' and the captures' pretend OOTP saves)
            let home = text("PENNANT_DEV_HOME", "PennantDevHome").map(folder)
            if let home { extra["HOME"] = home.plainPath }
            let caches = text("PENNANT_DEV_CACHES_DIR", "PennantDevCachesFolder").map(folder)
            var configuration = ServerConfiguration.bundled(in: bundle, dataFolder: dataFolder, logFolder: logs, extraEnvironment: extra, cachesFolder: caches)
            configuration.findsSavesAutomatically = home != nil
            return configuration
        }
        if environment["PENNANT_DEV_USE_REAL_DATA"] == "1" || defaults.bool(forKey: "PennantUseRealDataFolder") {
            return .bundled(in: bundle)
        }
        var unchosen = ServerConfiguration.bundled(
            in: bundle,
            logFolder: FileManager.default.temporaryDirectory.appending(path: "Pennant Dev logs", directoryHint: .isDirectory)
        )
        unchosen.dataFolderChosen = false
        return unchosen
    }
}
#endif
