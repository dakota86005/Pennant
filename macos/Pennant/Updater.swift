import Foundation
import PennantKit
import Sparkle

/// Pennant's updater (N14 Stage B, D-076): Sparkle 2's standard controller, reading the appcast at `SUFeedURL` and
/// accepting only an update signed with the owner's EdDSA key (`SUPublicEDKey`), both written into Release builds only
/// by `embed-server.sh`.
///
/// - **Consent first.** The Info.plist sets no `SUEnableAutomaticChecks`, so automatic checks are off until the GM
///   answers Sparkle's own question (asked at the second launch) or turns on Settings ▸ Updates' switch. Nothing is
///   downloaded or installed by itself (`SUAllowsAutomaticUpdates` is off).
/// - **Debug builds never check**: they have no feed and no key, so no updater is made at all (`Updates.off()`), and a
///   Release build missing either makes none too, rather than Sparkle's start-up error. The UI tests use an updater in
///   memory (`-PennantTestUpdater memory`), so no test reaches the network.
/// - **No Keychain.** With EdDSA, Sparkle's framework reads and writes no Keychain item (D-076 records the check of the
///   linked framework); a later Sparkle that did would go through `KeychainItems.exclusively` (D-074).
@MainActor
enum AppUpdater {
    static func make(bundle: Bundle = .main, defaults: UserDefaults = .standard) -> Updates {
        #if DEBUG
        if defaults.string(forKey: "PennantTestUpdater") == "memory" { return Updates(driver: MemoryUpdater()) }
        return .off()
        #else
        guard Updates.feedConfigured(bundle.infoDictionary) else { return .off() }
        return Updates(driver: SparkleUpdater())
        #endif
    }
}

/// Sparkle's standard controller behind `UpdaterDriving`: its own windows, its own permission question, its own
/// schedule. Its values are observed (KVO), so Settings shows a check Sparkle made or a question the GM answered; and
/// since Sparkle documents only some of them as observable (not `lastUpdateCheckDate`), the end of every update cycle
/// (`SPUUpdaterDelegate`) reads them all again too.
/// Compiled in every build, so CI's Debug builds check it too; only a Release build with a feed makes one.
@MainActor
final class SparkleUpdater: UpdaterDriving {
    /// Held here: the controller keeps its delegate weakly.
    private let cycles = UpdateCycles()
    private let controller: SPUStandardUpdaterController
    private var observations: [NSKeyValueObservation] = []
    var onChange: (@MainActor () -> Void)?

    init() {
        controller = SPUStandardUpdaterController(startingUpdater: true, updaterDelegate: cycles, userDriverDelegate: nil)
        cycles.finished = { [weak self] in self?.onChange?() }
        let updater = controller.updater
        let changed: @Sendable () -> Void = { [weak self] in
            Task { @MainActor in self?.onChange?() }
        }
        observations = [
            updater.observe(\.automaticallyChecksForUpdates) { _, _ in changed() },
            updater.observe(\.canCheckForUpdates) { _, _ in changed() },
            updater.observe(\.lastUpdateCheckDate) { _, _ in changed() },
        ]
    }

    var automaticallyChecks: Bool {
        get { controller.updater.automaticallyChecksForUpdates }
        set { controller.updater.automaticallyChecksForUpdates = newValue }
    }

    var lastCheck: Date? { controller.updater.lastUpdateCheckDate }
    var canCheck: Bool { controller.updater.canCheckForUpdates }

    func checkForUpdates() {
        controller.checkForUpdates(nil)
    }
}

/// Sparkle's word that an update cycle ended (a check by hand or on schedule, with an update or none, or an error), when
/// its last check time may have changed.
@MainActor
private final class UpdateCycles: NSObject, SPUUpdaterDelegate {
    var finished: (() -> Void)?

    func updater(_ updater: SPUUpdater, didFinishUpdateCycleFor updateCheck: SPUUpdateCheck, error: (any Error)?) {
        finished?()
    }
}
