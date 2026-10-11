import AppIntents
import FeatureCore
import PennantKit
import Shell
import SwiftUI

// Shortcuts and Spotlight (SWIFTUI_REBUILD.md section 6; N14, Stage A, D-075). Every intent opens or shows what the app
// already shows, the way its menus do; none decides anything or acts on OOTP (D-001). Their titles and parameter names
// are structural labels in the String Catalog.

/// Opens a player's window (Spotlight opens a player found there through this).
struct OpenPlayerIntent: OpenIntent {
    static let title: LocalizedStringResource = "Open Player"
    static let description = IntentDescription("Opens the player's window in Pennant.")

    @Parameter(title: "Player")
    var target: PlayerEntity

    @MainActor
    func perform() async throws -> some IntentResult {
        IntentRouter.shared.open(.player(target.id))
        return .result()
    }
}

/// Opens a club's window (Spotlight opens a club found there through this).
struct OpenClubIntent: OpenIntent {
    static let title: LocalizedStringResource = "Open Club"
    static let description = IntentDescription("Opens the club's window in Pennant.")

    @Parameter(title: "Club")
    var target: ClubEntity

    @MainActor
    func perform() async throws -> some IntentResult {
        IntentRouter.shared.open(.club(target.id))
        return .result()
    }
}

/// Brings Pennant forward on the Morning Report.
struct OpenMorningReportIntent: AppIntent {
    static let title: LocalizedStringResource = "Open the Morning Report"
    static let description = IntentDescription("Opens Pennant on the Morning Report.")
    static let openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        IntentRouter.shared.open(.morningReport)
        return .result()
    }
}

/// Opens the Staff room asking about a player, as Player ▸ Ask Staff About Him does: the server words the question, and
/// the room asks only while AI is on (otherwise it shows the server's line saying AI is off, and asks nothing).
struct AskStaffAboutPlayerIntent: AppIntent {
    static let title: LocalizedStringResource = "Ask Staff About a Player"
    static let description = IntentDescription("Opens the Staff room asking about the player. Needs AI to be on.")
    static let openAppWhenRun = true

    @Parameter(title: "Player")
    var player: PlayerEntity

    @MainActor
    func perform() async throws -> some IntentResult {
        IntentRouter.shared.open(.askStaff(player.id))
        return .result()
    }
}

/// Reads the save's export again, as Club ▸ Refresh Data does: an import of what is already on disk. It writes nothing to
/// OOTP and changes nothing in the save.
struct RefreshDataIntent: AppIntent {
    static let title: LocalizedStringResource = "Refresh Data"
    static let description = IntentDescription("Reads the save's latest export again.")
    static let openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        await IntentRouter.shared.refresh()
        return .result()
    }
}

/// The App Shortcuts Pennant offers in Shortcuts and Spotlight.
struct PennantShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: OpenPlayerIntent(), phrases: ["Open \(\.$target) in \(.applicationName)"], shortTitle: "Open Player", systemImageName: "person.crop.square")
        AppShortcut(intent: OpenClubIntent(), phrases: ["Open \(\.$target) in \(.applicationName)"], shortTitle: "Open Club", systemImageName: "shield")
        AppShortcut(intent: OpenMorningReportIntent(), phrases: ["Open the Morning Report in \(.applicationName)"], shortTitle: "Morning Report", systemImageName: "newspaper")
        AppShortcut(intent: AskStaffAboutPlayerIntent(), phrases: ["Ask \(.applicationName) staff about \(\.$player)"], shortTitle: "Ask Staff", systemImageName: "person.2.wave.2")
        AppShortcut(intent: RefreshDataIntent(), phrases: ["Refresh \(.applicationName)"], shortTitle: "Refresh Data", systemImageName: "arrow.clockwise")
    }
}
