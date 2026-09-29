import Observation
import PennantAPI
import PennantKit
import Setup

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
    /// A request to start again that the Setup window has not taken yet (it may open only after the request is made).
    private var setupRequestPending = false
    /// Bumped each time the main window asks the Setup window back to the club question ("Choose Your Club…").
    public private(set) var clubRequest = 0
    private var clubRequestPending = false
    /// Setup was opened automatically this launch.
    public private(set) var setupOpenedAutomatically = false
    /// The Setup window's model, made once and kept for the app's life (N6 Stage B2 review, M4): closing the window
    /// keeps what it was asking, and opening it again comes back to it.
    public private(set) var setup: SetupModel?

    public init() {}

    /// The Setup window's model: the one kept, or `make`'s, kept from now on.
    public func setupModel(_ make: () -> SetupModel) -> SetupModel {
        if let setup { return setup }
        let made = make()
        setup = made
        return made
    }

    /// Club ▸ Import Export…: the Setup window, at the save step (or at the club question while a club is owed).
    public func requestSetup() {
        setupRequestPending = true
        setupRequest += 1
    }

    /// The request to start again, once: the Setup window takes it when it appears or while it is open.
    public func takeSetupRequest() -> Bool {
        defer { setupRequestPending = false }
        return setupRequestPending
    }

    /// The main window's "Choose Your Club…": the Setup window, back at the club question.
    public func requestClubQuestion() {
        clubRequestPending = true
        clubRequest += 1
    }

    /// The request to come back to the club question, once.
    public func takeClubRequest() -> Bool {
        defer { clubRequestPending = false }
        return clubRequestPending
    }

    /// The club is owed for the save chosen in Setup (the server said it isn't decided, or the club is being asked): the
    /// main window draws no report until the GM saves one, whether the Setup window is open or not, so no report is drawn
    /// before its club is confirmed. Read from the kept model, never timed by the window's appearance.
    public var awaitingClub: Bool { setup?.holdsReport ?? false }

    /// What the server said about the owed club ("You manage 2 clubs in this save, so Pennant will ask which to
    /// follow."), for the main window's held view; nil when none is owed or none was served.
    public var owedClubText: String? { setup?.clubQuestion?.text }

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
