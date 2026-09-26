import FeatureCore
import PennantAPI
import PennantKit
import SwiftUI
import UniformTypeIdentifiers

/// Settings (SWIFTUI_REBUILD.md section 3.1): General (the OOTP save and its import, the club, the transaction log's
/// save folder, the data status, the data folder and its backup), Appearance, and AI (each provider's key status, read
/// only until N13). Updates arrive with N14. Every value shown is served; the labels are structural.
public struct SettingsView: View {
    @Environment(AppRouting.self) private var routing
    @Environment(AppModel.self) private var model

    /// Each tab's size: the window takes the selected tab's.
    public static let width: CGFloat = 620
    public static func height(_ tab: AppRouting.SettingsTab) -> CGFloat {
        switch tab {
        case .general: 620
        case .appearance: 200
        case .ai: 460
        }
    }

    public init() {}

    public var body: some View {
        @Bindable var routing = routing
        TabView(selection: $routing.settingsTab) {
            Tab("General", systemImage: "gearshape", value: AppRouting.SettingsTab.general) {
                GeneralSettings().frame(width: Self.width, height: Self.height(.general))
            }
            Tab("Appearance", systemImage: "circle.lefthalf.filled", value: AppRouting.SettingsTab.appearance) {
                AppearanceSettings().frame(width: Self.width, height: Self.height(.appearance))
            }
            Tab("AI", systemImage: "sparkles", value: AppRouting.SettingsTab.ai) {
                AISettings().frame(width: Self.width, height: Self.height(.ai))
            }
        }
        .onChange(of: AppAppearance.served(model.settings), initial: true) { _, theme in
            AppAppearance.apply(theme)
        }
    }
}

// MARK: General

struct GeneralSettings: View {
    @Environment(AppModel.self) private var model
    @Environment(AppRouting.self) private var routing
    @Environment(\.openWindow) private var openWindow
    @State private var confirmingRestore = false
    @State private var restoreOutcome: RestoreOutcome?
    @State private var clubProblem: RequestProblem?
    @State private var saveFolder = ""
    @State private var saveFolderProblem: RequestProblem?
    @State private var choosingSaveFolder = false

    enum RestoreOutcome: Equatable {
        case restored(String)
        case failed(detail: String)
    }

    private var can: CommandAvailability { .of(model, window: nil) }

    var body: some View {
        ScrollViewReader { proxy in
            Form {
                saveSection
                clubSection
                transactionLogSection
                DataStatusSection(dataStatus: model.dataStatus)
                    .id("dataStatus")
                dataFolderSection
            }
            .formStyle(.grouped)
            .onChange(of: routing.revealDataStatus, initial: true) { _, reveal in
                guard reveal else { return }
                withAnimation { proxy.scrollTo("dataStatus", anchor: .top) }
                routing.revealDataStatus = false
            }
        }
        .accessibilityIdentifier("settings.general")
    }

    /// The save Pennant imports: its name and export folder, the import, and the way to choose another.
    private var saveSection: some View {
        Section {
            LabeledContent("Name") {
                if let name = model.status?.saveName { Text(verbatim: name) } else { Text("None chosen") }
            }
            if let folder = model.status?.csvDir {
                LabeledContent("Export") {
                    Text(verbatim: folder).textSelection(.enabled).lineLimit(2).truncationMode(.middle)
                }
            }
            if model.isImporting {
                ImportProgressView(progress: model.importProgress)
            }
            if let problem = model.importRequestProblem {
                ProblemLine(problem)
            } else if let note = model.importNote {
                ProblemLine(served: note.text, detail: note.detail)
            }
            HStack {
                Button("Choose Save…") {
                    routing.requestSetup()
                    openWindow(id: SceneID.setup)
                }
                .disabled(!can.importExport)
                Spacer()
                Button("Import Now") {
                    Task { await model.startImport() }
                }
                .disabled(!can.refreshData)
                .accessibilityIdentifier("settings.importNow")
            }
        } header: {
            Text("OOTP save")
        } footer: {
            Text("Pennant reads the save's export each time it imports.")
                .foregroundStyle(.secondary)
        }
    }

    /// The club the app is about: Automatic (the club the save's human manages, the server's rule) or one chosen here.
    /// Automatic is the explicit `clubChoice` the server takes, never a null the client cannot send.
    @ViewBuilder
    private var clubSection: some View {
        if !model.orgs.isEmpty {
            Section {
                Picker("Your club", selection: Binding(
                    get: { model.club?.source == .configured ? model.club?.ref.id : nil },
                    set: { id in
                        Task {
                            do {
                                if let id {
                                    try await model.saveSettings(.init(defaultOrgId: id))
                                } else {
                                    try await model.chooseClubAutomatically()
                                }
                                clubProblem = nil
                            } catch {
                                clubProblem = RequestProblem.from(error)
                            }
                        }
                    }
                )) {
                    // Automatic follows the club the save's human manages; with none, it would leave the app with no club
                    if (model.settings?.organization?.humanClubs ?? 0) > 0 {
                        Text("Automatic").tag(Int?.none)
                        Divider()
                    }
                    ForEach(model.orgs, id: \.teamId) { org in
                        Text(verbatim: org.label).tag(Optional(org.teamId))
                    }
                }
                .accessibilityIdentifier("settings.club")
                if let note = model.settings?.organization?.note {
                    Label { Text(verbatim: note) } icon: { Image(systemName: "info.circle") }
                        .foregroundStyle(.secondary)
                }
                if let clubProblem { ProblemLine(clubProblem) }
            } header: {
                Text("Club")
            } footer: {
                Text("Automatic follows the club you manage in the save.")
                    .foregroundStyle(.secondary)
            }
        }
    }

    /// The save's own folder, where OOTP keeps the transaction log: found from the export, or named here by hand.
    private var transactionLogSection: some View {
        Section {
            TextField("Save folder", text: $saveFolder, prompt: Text("The save's folder, ending in .lg"))
                .labelsHidden()
                .accessibilityIdentifier("settings.saveFolder")
            HStack {
                Button("Choose…") { choosingSaveFolder = true }
                Button("Find Automatically") { Task { await setSaveFolder("") } }
                    .disabled(!model.isReady)
                Spacer()
                Button("Use This Folder") { Task { await setSaveFolder(saveFolder) } }
                    .disabled(saveFolder.trimmingCharacters(in: .whitespaces).isEmpty || !model.isReady)
            }
            if let saveFolderProblem { ProblemLine(saveFolderProblem) }
        } header: {
            Text("Transaction log")
        } footer: {
            Text("Pennant reads the transaction log from the save's folder, which it finds from the export. Name the folder here only if it isn't found.")
                .foregroundStyle(.secondary)
        }
        .fileImporter(isPresented: $choosingSaveFolder, allowedContentTypes: [.folder]) { result in
            if case .success(let url) = result { saveFolder = url.path(percentEncoded: false) }
        }
    }

    /// Where Pennant keeps its own data, and the backup it took before it first ran there.
    private var dataFolderSection: some View {
        Section("Data folder") {
            LabeledContent("Location") {
                Text(verbatim: model.dataFolderPath).textSelection(.enabled).lineLimit(2).truncationMode(.middle)
            }
            LabeledContent("Backup taken") {
                if let record = model.backups.record() {
                    Text(record.createdAt, format: .dateTime.year().month().day().hour().minute())
                } else {
                    Text("None yet")
                }
            }
            HStack {
                Button("Show in Finder") {
                    NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: model.dataFolderPath)])
                }
                Spacer()
                Button("Restore Backup…") { confirmingRestore = true }
                    .disabled(model.backups.record() == nil || model.isImporting)
                    .accessibilityIdentifier("settings.restoreBackup")
            }
            if let restoreOutcome {
                switch restoreOutcome {
                case .restored(let folder):
                    LabeledContent("Replaced files kept in") { Text(verbatim: folder).textSelection(.enabled) }
                case .failed(let detail):
                    ProblemLine(Text("The backup could not be restored"))
                        .help(detail: detail)
                }
            }
        }
        .confirmationDialog("Restore the backup?", isPresented: $confirmingRestore) {
            Button("Restore Backup", role: .destructive) {
                Task {
                    do {
                        let aside = try await model.restoreBackup()
                        restoreOutcome = .restored(aside.path(percentEncoded: false))
                    } catch {
                        model.logProblem("could not restore the backup: \(error)")
                        restoreOutcome = .failed(detail: String(describing: error))
                    }
                }
            }
        } message: {
            Text("Pennant stops its server, puts back the files it copied before it first ran on this folder, and starts again. The files it replaces are kept in the backups folder.")
        }
    }

    /// `POST /api/save-source`: the save's `.lg` folder named by hand; empty returns to finding it automatically.
    private func setSaveFolder(_ path: String) async {
        guard let client = model.client else {
            saveFolderProblem = .notRunning
            return
        }
        saveFolderProblem = nil
        do {
            switch try await client.setSaveSource(body: .json(.init(lgPath: path.trimmingCharacters(in: .whitespaces)))) {
            case .ok:
                await model.reloadAll()
            case .badRequest(let refused):
                saveFolderProblem = .served(try refused.body.json.error)
            case .undocumented(let code, let payload):
                saveFolderProblem = await .undocumented(code, body: payload.body, operation: "setSaveSource", fromV2: false)
            }
        } catch {
            let problem = RequestProblem.from(error)
            if let detail = problem.detail { model.logProblem("could not set the save folder: \(detail)") }
            saveFolderProblem = problem
        }
    }
}

/// The data status as the server words it (`/api/v2/data-status`): the headline with a symbol for its tone and its
/// basis one click away (the reasons are the breakdown, not the face), each source's line (why the log is unavailable in
/// its help tag), the dates and places (a missing one saying why), and what to do. Every word is served; the labels are
/// the served row labels.
struct DataStatusSection: View {
    let dataStatus: Components.Schemas.DataStatusView?

    var body: some View {
        Section("Data status") {
            if let status = dataStatus {
                HStack {
                    Label {
                        Text(verbatim: status.headline.text).font(.headline)
                    } icon: {
                        ToneSymbol(tone: status.headline.tone)
                    }
                    .help(detail: status.headline.hint)
                    Spacer()
                    // The reasons, where the save was found and what the log reader said: the breakdown, one click away
                    BasisButton(basis: status.headline.basis)
                }
                if let action = status.action {
                    Label { Text(verbatim: action.display) } icon: { Image(systemName: "arrow.forward.circle") }
                }
                ForEach(status.sources, id: \.id) { row in
                    LabeledContent {
                        Label {
                            Text(verbatim: row.cells.state.display)
                        } icon: {
                            ToneSymbol(tone: row.cells.state.tone)
                        }
                        .labelStyle(.titleAndIcon)
                        .help(detail: row.cells.state.hint)
                    } label: {
                        Text(verbatim: row.cells.source.display)
                    }
                }
                ForEach(status.facts, id: \.id) { row in
                    LabeledContent {
                        Text(verbatim: row.cells.value.display)
                            .foregroundStyle(row.cells.value.tone?.value1 == .unknown ? .secondary : .primary)
                            .textSelection(.enabled)
                            .lineLimit(2)
                            .truncationMode(.middle)
                            .help(detail: row.cells.value.hint)
                    } label: {
                        Text(verbatim: row.cells.label.display)
                    }
                }
            } else {
                ProgressView()
            }
        }
        .accessibilityIdentifier("settings.dataStatus")
    }

}

// MARK: Appearance

/// System, Light or Dark: the served `theme`, applied to every window once the server has saved it.
struct AppearanceSettings: View {
    @Environment(AppModel.self) private var model
    @State private var problem: RequestProblem?

    var body: some View {
        Form {
            Section {
                Picker("Appearance", selection: Binding(
                    get: { AppAppearance.served(model.settings) ?? "system" },
                    set: { theme in
                        Task {
                            do {
                                try await model.saveSettings(.init(theme: .init(value1: .init(rawValue: theme), value2: theme)))
                                problem = nil
                                AppAppearance.apply(AppAppearance.served(model.settings))
                            } catch {
                                problem = RequestProblem.from(error)
                            }
                        }
                    }
                )) {
                    Text("System").tag("system")
                    Text("Light").tag("light")
                    Text("Dark").tag("dark")
                }
                .pickerStyle(.radioGroup)
                .disabled(model.settings == nil)
                .accessibilityIdentifier("settings.appearance")
                if let problem { ProblemLine(problem) }
            }
        }
        .formStyle(.grouped)
    }
}

// MARK: AI

/// Each AI provider and its key's status, as served (`/api/settings/providers`). Read only: adding or changing a key
/// arrives with the staff room (N13).
struct AISettings: View {
    @Environment(AppModel.self) private var model
    @State private var providers: Components.Schemas.ProvidersResponse?
    @State private var problem: RequestProblem?
    @State private var attempt = 0
    private let preloaded: Components.Schemas.ProvidersResponse?

    init(preloaded: Components.Schemas.ProvidersResponse? = nil) {
        self.preloaded = preloaded
    }

    var body: some View {
        Form {
            if let answer = providers ?? preloaded {
                Section("Providers") {
                    ForEach(answer.providers, id: \.label) { provider in
                        ProviderRow(
                            provider: provider,
                            key: answer.keys.status(for: provider.id),
                            inUse: model.settings?.settings.provider == provider.id
                        )
                    }
                }
                Section {
                    Text("Adding or changing a key arrives in a later build")
                        .foregroundStyle(.secondary)
                }
            } else if let problem {
                Section("Providers") {
                    ProblemLine(problem)
                    Button("Try Again") { attempt += 1 }
                }
            } else {
                ProgressView()
            }
        }
        .formStyle(.grouped)
        .task(id: TaskKey(store: model.storeKey, attempt: attempt)) { await load() }
        .accessibilityIdentifier("settings.ai")
    }

    private struct TaskKey: Hashable {
        var store: AppModel.StoreKey?
        var attempt: Int
    }

    private func load() async {
        guard preloaded == nil else { return }
        guard let client = model.client else {
            problem = .notRunning
            return
        }
        do {
            providers = try await client.getProviders().ok.body.json
            problem = nil
        } catch {
            let failure = RequestProblem.from(error)
            if let detail = failure.detail { model.logProblem("could not read the AI providers: \(detail)") }
            problem = failure
        }
    }
}

private struct ProviderRow: View {
    let provider: Components.Schemas.ProviderChoice
    let key: Components.Schemas.KeyStatus?
    let inUse: Bool

    var body: some View {
        LabeledContent {
            VStack(alignment: .trailing, spacing: 2) {
                keyLine
                Text(verbatim: provider.model).font(.caption).foregroundStyle(.secondary)
            }
        } label: {
            HStack(spacing: 6) {
                Text(verbatim: provider.label)
                if inUse {
                    Label("In use", systemImage: "checkmark.circle.fill")
                        .labelStyle(.titleAndIcon)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    @ViewBuilder
    private var keyLine: some View {
        if !provider.requiresKey {
            Text("No key needed")
        } else if let key, key.configured {
            HStack(spacing: 4) {
                if let hint = key.hint { Text(verbatim: hint).monospaced() }
                if let source = key.sourceText { Text(verbatim: source).foregroundStyle(.secondary) }
            }
        } else {
            Text("No key")
        }
    }
}

extension Components.Schemas.ProvidersResponse.KeysPayload {
    /// The key status for a provider id, or nil for a provider this build's contract does not list.
    func status(for id: Components.Schemas.ProviderId) -> Components.Schemas.KeyStatus? {
        switch id.value1 {
        case .anthropic: anthropic
        case .openai: openai
        case .gemini: gemini
        case .opencode: opencode
        case .ollama: ollama
        case nil: nil
        }
    }
}
