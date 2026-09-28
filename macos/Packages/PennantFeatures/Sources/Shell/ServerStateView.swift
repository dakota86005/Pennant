import PennantAPI
import PennantKit
import SwiftUI

/// The main window's content while the server is not ready (SWIFTUI_REBUILD.md section 5.3): starting, restarting,
/// stopping, failed (with the server's own sentence when it gave one), the data folder in use, the backup that could
/// not be taken, and a Debug build given no data folder. Each failure offers Show Log and Try Again.
public struct ServerStateView: View {
    @Environment(AppModel.self) private var model

    public init() {}

    public var body: some View {
        Group {
            switch model.serverState {
            case .idle, .starting:
                WaitingView(title: "Starting…")
            case .restarting:
                WaitingView(title: "Restarting…")
            case .stopping, .stopped:
                WaitingView(title: "Stopping…")
            case .ready:
                WaitingView(title: "Starting…")
            case .failed(let failure) where failure.kind == .noDataFolderChosen:
                ContentUnavailableView {
                    Label(failure.kind.title, systemImage: "folder.badge.questionmark")
                } description: {
                    Text("Set PENNANT_DEV_DATA_DIR (or -PennantDevDataFolder) to a scratch folder, or choose the real folder on purpose with PENNANT_DEV_USE_REAL_DATA=1 (or -PennantUseRealDataFolder YES).")
                }
                .accessibilityIdentifier("server.noDataFolder")
            case .failed(let failure):
                ServerProblemView(
                    title: failure.kind.title,
                    symbol: failure.kind == .backupFailed ? "externaldrive.badge.exclamationmark" : "exclamationmark.triangle",
                    serverMessage: failure.serverMessage ?? (failure.kind == .backupFailed ? failure.detail : nil)
                )
            case .locked(let message):
                ServerProblemView(title: "The data folder is in use", symbol: "lock", serverMessage: message)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.background)
    }
}

extension ServerFailure.Kind {
    /// A structural title for each way the server can fail to run; the reason itself is the server's sentence.
    public var title: LocalizedStringKey {
        switch self {
        case .notInstalled: "The server is missing from this build"
        case .couldNotLaunch, .handshake, .startFailed: "The server could not be started"
        case .notReady: "The server did not start in time"
        case .statusCheck: "The server did not answer"
        case .crashedRepeatedly: "The server keeps stopping"
        case .backupFailed: "The data folder could not be backed up"
        case .noDataFolderChosen: "No data folder chosen for this development build"
        }
    }
}

/// The view's place while the server starts, inside the shell (the window's shell is built before the server is ready).
struct StartingView: View {
    var body: some View {
        WaitingView(title: "Starting…")
    }
}

private struct WaitingView: View {
    let title: LocalizedStringKey

    var body: some View {
        VStack(spacing: 12) {
            ProgressView()
                .controlSize(.large)
            Text(title)
                .font(.title3)
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("server.waiting")
    }
}

/// Failed or locked: what happened, the server's own words when it said any, the data folder, and the two ways on.
private struct ServerProblemView: View {
    @Environment(AppModel.self) private var model
    let title: LocalizedStringKey
    let symbol: String
    let serverMessage: String?

    var body: some View {
        ContentUnavailableView {
            Label(title, systemImage: symbol)
        } description: {
            VStack(spacing: 8) {
                if let serverMessage, !serverMessage.isEmpty {
                    Text(verbatim: serverMessage)
                }
                LabeledContent("Data folder") {
                    Text(verbatim: model.configuration.dataFolder.plainPath)
                        .textSelection(.enabled)
                }
                .font(.callout)
            }
        } actions: {
            HStack {
                Button("Show Log") {
                    NSWorkspace.shared.open(model.logFile)
                }
                Button("Try Again") {
                    Task { await model.tryAgain() }
                }
                .keyboardShortcut(.defaultAction)
            }
        }
        .accessibilityIdentifier("server.problem")
    }
}
