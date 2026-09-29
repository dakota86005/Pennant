import AppKit
import PennantAPI
import PennantKit
import UserNotifications

/// What Pennant says outside its windows (SWIFTUI_REBUILD.md sections 3.6 and 6, N7): a notification with the server's
/// words when a new export has been read ("New export read · 3 new on your desk"), only while the app is not frontmost,
/// and the served count of open desk items on the Dock icon. Permission to notify is asked the first time there is
/// something to say, never at launch; Settings ▸ General turns either off (`AppPreferences`, the app's own defaults).
@MainActor
final class OutsideTheWindow {
    private let model: AppModel
    private let defaults: UserDefaults

    init(model: AppModel, defaults: UserDefaults = .standard) {
        self.model = model
        self.defaults = defaults
    }

    /// Follows the served count for the badge and hands the notification its words when changes are ready.
    func start() {
        model.onChangesReady = { [weak self] ready in self?.changesReady(ready) }
        followBadge()
        // Turning the badge off in Settings takes it away at once
        NotificationCenter.default.addObserver(forName: UserDefaults.didChangeNotification, object: defaults, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.applyBadge() }
        }
    }

    // MARK: The Dock badge

    private func followBadge() {
        withObservationTracking {
            applyBadge()
        } onChange: { [weak self] in
            Task { @MainActor in self?.followBadge() }
        }
    }

    /// The served count of open desk items, or none (nothing served, none open, or the badge turned off).
    private func applyBadge() {
        let count = model.openDeskCount
        let label = AppPreferences.showsDockBadge(defaults) ? count.flatMap { $0 > 0 ? String($0) : nil } : nil
        if NSApp.dockTile.badgeLabel != label { NSApp.dockTile.badgeLabel = label }
    }

    // MARK: The notification

    private func changesReady(_ ready: Components.Schemas.ChangesReadyEvent) {
        guard AppPreferences.notifiesNewExport(defaults), !NSApp.isActive else { return }
        Task { await post(title: ready.title, text: ready.text, id: ready.reportStamp) }
    }

    /// Asks once, the first time there is something to say; the system remembers the answer.
    private func post(title: String, text: String, id: String) async {
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        switch settings.authorizationStatus {
        case .notDetermined:
            guard (try? await center.requestAuthorization(options: [.alert, .badge])) == true else { return }
        case .denied:
            return
        default:
            break
        }
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = text
        try? await center.add(UNNotificationRequest(identifier: "changes-ready.\(id)", content: content, trigger: nil))
    }
}
