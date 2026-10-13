import Foundation
import Observation

/// What the app's updater does (N14 Stage B, D-076). The app target drives it with Sparkle's
/// `SPUStandardUpdaterController`; PennantKit, its tests and the views never link Sparkle, so nothing here can reach the
/// network.
@MainActor
public protocol UpdaterDriving: AnyObject {
    /// Whether Sparkle checks by itself. Off until the GM says yes to Sparkle's own question (consent first).
    var automaticallyChecks: Bool { get set }
    /// When the last check finished, if one ever has.
    var lastCheck: Date? { get }
    /// Whether a check can start now (not while one is running).
    var canCheck: Bool { get }
    /// A check the GM asked for, with Sparkle's own window.
    func checkForUpdates()
    /// Called on the main actor whenever one of the values above changes.
    var onChange: (@MainActor () -> Void)? { get set }
}

/// The updater as Settings ▸ Updates and the app menu's Check for Updates… see it. A build without a feed (every Debug
/// build, and a Release build missing its feed or key) has no updater: it never checks, and says so.
@MainActor
@Observable
public final class Updates {
    public enum Availability: Equatable, Sendable {
        /// Sparkle runs: Release builds with the feed and the committed public key.
        case available
        /// This build never checks (Debug, or no feed or key in its Info.plist).
        case offInThisBuild
    }

    public let availability: Availability
    public private(set) var automaticallyChecks = false
    public private(set) var lastCheck: Date?
    public private(set) var canCheck = false
    @ObservationIgnored private let driver: (any UpdaterDriving)?

    /// `nil`: this build has no updater.
    public init(driver: (any UpdaterDriving)?) {
        self.driver = driver
        availability = driver == nil ? .offInThisBuild : .available
        refresh()
        driver?.onChange = { [weak self] in self?.refresh() }
    }

    /// A build that never checks.
    public static func off() -> Updates { Updates(driver: nil) }

    public func setAutomaticallyChecks(_ on: Bool) {
        guard let driver else { return }
        driver.automaticallyChecks = on
        refresh()
    }

    /// Check for Updates…: does nothing in a build without an updater, or while a check is running.
    public func checkNow() {
        guard let driver, driver.canCheck else { return }
        driver.checkForUpdates()
        refresh()
    }

    /// Reads the updater's values again (Sparkle changes them on its own: its permission question, a finished check).
    public func refresh() {
        automaticallyChecks = driver?.automaticallyChecks ?? false
        lastCheck = driver?.lastCheck
        canCheck = driver?.canCheck ?? false
    }

    /// Whether an Info.plist names the feed (an https `SUFeedURL`) and a public key (`SUPublicEDKey`), both of which
    /// `embed-server.sh` writes into Release builds only. Without both Sparkle refuses to start and shows an error, so
    /// the app makes no updater at all.
    public nonisolated static func feedConfigured(_ info: [String: Any]?) -> Bool {
        guard let feed = info?["SUFeedURL"] as? String, let url = URL(string: feed), url.scheme == "https",
              let key = info?["SUPublicEDKey"] as? String, !key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else { return false }
        return true
    }
}

/// An updater that never leaves the process: the UI tests (`-PennantTestUpdater memory`) and the package tests. A check
/// records the time and nothing else.
@MainActor
public final class MemoryUpdater: UpdaterDriving {
    public var automaticallyChecks: Bool { didSet { onChange?() } }
    public private(set) var lastCheck: Date?
    public var canCheck = true
    public private(set) var checks = 0
    public var onChange: (@MainActor () -> Void)?
    private let now: () -> Date

    public init(automaticallyChecks: Bool = false, lastCheck: Date? = nil, now: @escaping () -> Date = { .now }) {
        self.automaticallyChecks = automaticallyChecks
        self.lastCheck = lastCheck
        self.now = now
    }

    public func checkForUpdates() {
        checks += 1
        lastCheck = now()
        onChange?()
    }
}
