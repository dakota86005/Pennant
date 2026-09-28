import Observation
import PennantAPI
import PennantKit

/// What the app's windows ask of each other: which step the Setup window opens on, which Settings tab shows, and
/// whether Setup has already been opened for a save-less server this launch (so closing it is respected). One per
/// app, in the environment of every scene.
@Observable @MainActor
public final class AppRouting {
    public enum SettingsTab: String, Hashable, Sendable, CaseIterable {
        case general, appearance, ai
    }

    public enum SetupStart: Hashable, Sendable {
        /// Find the save (first run, and Club ▸ Import Export…).
        case findSave
    }

    public var settingsTab: SettingsTab = .general
    /// Club ▸ Data Status: General scrolls to the data status once.
    public var revealDataStatus = false
    /// Bumped each time something asks the Setup window to start again at the save step.
    public private(set) var setupRequest = 0
    /// Setup was opened automatically this launch.
    public private(set) var setupOpenedAutomatically = false

    public init() {}

    /// Club ▸ Import Export…: the Setup window, at the save step.
    public func requestSetup() { setupRequest += 1 }

    /// Bumped each time the GM clicks a "played since" switch: the Setup window takes `pendingSwitch` and starts on it.
    public private(set) var switchRequest = 0
    /// The save the GM clicked to switch to, until the Setup window takes it.
    public private(set) var pendingSwitch: Components.Schemas.SaveInfo?

    /// "Switch to …" in the main window's notice: the Setup window chooses that save and follows its import (only ever
    /// on the GM's click).
    public func requestSwitch(to save: Components.Schemas.SaveInfo) {
        pendingSwitch = save
        switchRequest += 1
    }

    /// The save to switch to, once: the Setup window takes it when it starts on it.
    public func takeSwitch() -> Components.Schemas.SaveInfo? {
        defer { pendingSwitch = nil }
        return pendingSwitch
    }

    /// Whether the main window should open Setup now: the server is up with no save chosen, and Setup has not been
    /// opened for that yet this launch. Answering true records that it was.
    public func shouldOpenSetupAutomatically(needsSetup: Bool) -> Bool {
        guard needsSetup, !setupOpenedAutomatically else { return false }
        setupOpenedAutomatically = true
        return true
    }

    /// Club ▸ Data Status: Settings, on General, at the data status.
    public func showDataStatus() {
        settingsTab = .general
        revealDataStatus = true
    }
}

/// Which menu commands can act (SWIFTUI_REBUILD.md section 3.6), from the app's state and the key window. Commands
/// read it; the tests check it.
public struct CommandAvailability: Equatable, Sendable {
    public var refreshData: Bool
    public var importExport: Bool
    public var dataStatus: Bool
    public var goToDepartment: Bool
    public var back: Bool
    public var forward: Bool
    public var inspector: Bool
    /// View ▸ Find Anything… (⌘K): a key main window whose server is ready.
    public var findAnything: Bool

    /// - Parameters:
    ///   - serverReady: the server is up and answering.
    ///   - configured: a save is chosen (served `configured`).
    ///   - importing: an import is under way (served `importing`).
    ///   - window: the key main window, if a main window is key.
    public nonisolated init(serverReady: Bool, configured: Bool, importing: Bool, window: (canGoBack: Bool, canGoForward: Bool)?) {
        refreshData = serverReady && configured && !importing
        importExport = serverReady && !importing
        dataStatus = true
        goToDepartment = window != nil && serverReady
        back = serverReady && (window?.canGoBack ?? false)
        forward = serverReady && (window?.canGoForward ?? false)
        inspector = window != nil && serverReady
        findAnything = window != nil && serverReady
    }

    /// For the app's model and the key window.
    public static func of(_ model: AppModel, window: MainWindowModel?) -> CommandAvailability {
        CommandAvailability(
            serverReady: model.isReady,
            configured: model.status?.configured ?? false,
            importing: model.isImporting,
            window: window.map { (canGoBack: $0.canGoBack, canGoForward: $0.canGoForward) }
        )
    }
}
