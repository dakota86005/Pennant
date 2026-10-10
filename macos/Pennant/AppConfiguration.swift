import Foundation
import PennantKit

/// Where this build's server and data are.
///
/// A release build always uses SWIFTUI_REBUILD.md section 5.3's folders: the data in
/// `~/Library/Application Support/ootp-front-office`, the log in `~/Library/Logs/Pennant`.
///
/// A Debug build (and the UI tests) must be told which data folder to use, so development never runs on the real one
/// by accident (`ServerConfiguration.development`):
/// - `PENNANT_DEV_DATA_DIR=<folder>` in the environment, or the launch argument `-PennantDevDataFolder <folder>`
///   (`PENNANT_DEV_LOG_DIR` / `-PennantDevLogFolder` for the log, default `logs/` inside it; `OOTP_FO_DB_READONLY=1`
///   is passed on to the server);
/// - or, deliberately, the real folder: `PENNANT_DEV_USE_REAL_DATA=1` or `-PennantUseRealDataFolder YES`.
/// With neither it starts no server and says so.
enum AppConfiguration {
    static func server(
        bundle: Bundle = .main,
        environment: [String: String] = ProcessInfo.processInfo.environment,
        defaults: UserDefaults = .standard
    ) -> ServerConfiguration {
        #if DEBUG
        return .development(in: bundle, environment: environment, defaults: defaults)
        #else
        return .bundled(in: bundle)
        #endif
    }

    /// Where the AI keys are kept (N13, D-074): this app's own Keychain items (`<bundle id>.apikeys`). A Debug build
    /// launched by the UI tests with `-PennantTestKeys memory` keeps them in memory, so a test never reads or writes the
    /// Keychain of the Mac it runs on.
    static func keyStore(bundle: Bundle = .main, defaults: UserDefaults = .standard) -> any KeyStore {
        #if DEBUG
        if defaults.string(forKey: "PennantTestKeys") == "memory" { return MemoryKeyStore() }
        #endif
        return KeychainKeyStore(service: KeychainKeyStore.service(forBundleID: bundle.bundleIdentifier))
    }
}
