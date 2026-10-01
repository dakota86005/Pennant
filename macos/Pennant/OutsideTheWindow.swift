import AppKit
import PennantAPI
import PennantKit
import UserNotifications

/// What Pennant says outside its windows (SWIFTUI_REBUILD.md sections 3.6 and 6, N7): a notification with the server's
/// words when a new export has been read ("New export read · 3 new on your desk"), only while the app is not frontmost,
/// and the served count of open desk items on the Dock icon (none while the club question is open). Permission to notify
/// is asked only with Pennant in front, never at launch and never from the background (L4): when the GM turns the
/// Settings switch on, or at the first new export read while Pennant is frontmost. Settings ▸ General turns either off
/// (`AppPreferences`, the app's own defaults).
@MainActor
final class OutsideTheWindow {
    private let model: AppModel
    private let defaults: UserDefaults
    /// The Settings switch as last seen, so turning it on is told from its other changes.
    private var notifies: Bool

    init(model: AppModel, defaults: UserDefaults = .standard) {
        self.model = model
        self.defaults = defaults
        notifies = AppPreferences.notifiesNewExport(defaults)
    }

    /// Follows the served count for the badge and hands the notification its words when changes are ready.
    func start() {
        model.onChangesReady = { [weak self] ready in self?.changesReady(ready) }
        followBadge()
        // Turning the badge off in Settings takes it away at once; turning notifications on asks, with Pennant in front
        NotificationCenter.default.addObserver(forName: UserDefaults.didChangeNotification, object: defaults, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.preferencesChanged() }
        }
    }

    private func preferencesChanged() {
        applyBadge()
        let now = AppPreferences.notifiesNewExport(defaults)
        defer { notifies = now }
        if now, !notifies { askWhileFrontmost() }
    }

    // MARK: The Dock badge

    private func followBadge() {
        withObservationTracking {
            applyBadge()
        } onChange: { [weak self] in
            Task { @MainActor in self?.followBadge() }
        }
    }

    /// The served count of open desk items, or none (nothing served, none open, the badge turned off, or the club question
    /// open: the desk counted is then another club's or none, L4).
    private func applyBadge() {
        let count = model.clubOwed == nil ? model.openDeskCount : nil
        let label = AppPreferences.showsDockBadge(defaults) ? count.flatMap { $0 > 0 ? String($0) : nil } : nil
        if NSApp.dockTile.badgeLabel != label { NSApp.dockTile.badgeLabel = label }
    }

    // MARK: The notification

    private func changesReady(_ ready: Components.Schemas.ChangesReadyEvent) {
        guard AppPreferences.notifiesNewExport(defaults) else { return }
        // In front, the window says it; the first export read there is when Pennant asks to notify next time
        if NSApp.isActive {
            askWhileFrontmost()
            return
        }
        Task { await post(title: ready.title, text: ready.text, id: ready.reportStamp) }
    }

    /// Asks permission to notify, once (the system remembers the answer), and only with Pennant frontmost.
    private func askWhileFrontmost() {
        guard NSApp.isActive else { return }
        Task {
            let center = UNUserNotificationCenter.current()
            guard await center.notificationSettings().authorizationStatus == .notDetermined, NSApp.isActive else { return }
            // Alerts only: the Dock's count is the app's own badge, not a notification's
            _ = try? await center.requestAuthorization(options: [.alert])
        }
    }

    /// Posts only when permission was given: from the background Pennant never asks.
    private func post(title: String, text: String, id: String) async {
        let center = UNUserNotificationCenter.current()
        switch await center.notificationSettings().authorizationStatus {
        case .authorized, .provisional: break
        default: return
        }
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = text
        try? await center.add(UNNotificationRequest(identifier: "changes-ready.\(id)", content: content, trigger: nil))
    }
}
