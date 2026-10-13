import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI
import UniformTypeIdentifiers

/// Settings (SWIFTUI_REBUILD.md section 3.1): General (the OOTP save and its import, its rating history, the club, the
/// transaction log's save folder, the data status, the data folder and its backup), Appearance, and AI (each provider's key status, read
/// only until N13). Updates arrive with N14. Every value shown is served; the labels are structural.
public struct SettingsView: View {
    @Environment(AppRouting.self) private var routing
    @Environment(AppModel.self) private var model

    /// Each tab's size: the window takes the selected tab's.
    public static let width: CGFloat = 620
    /// A tab's height. Appearance grows with what it lists: each theme on offer past the first two, and each refused
    /// pack (a line with its sentence), up to a height that still fits a small screen, past which the form scrolls.
    public static func height(_ tab: AppRouting.SettingsTab, themes: Int = 0, refusedPacks: Int = 0) -> CGFloat {
        switch tab {
        case .general: 620
        case .appearance: min(appearanceMax, 560 + 24 * CGFloat(max(0, themes - 2)) + 44 * CGFloat(max(0, refusedPacks)))
        case .ai: 460
        }
    }

    /// The tallest Appearance grows.
    public static let appearanceMax: CGFloat = 820

    public init() {}

    public var body: some View {
        @Bindable var routing = routing
        TabView(selection: $routing.settingsTab) {
            Tab("General", systemImage: "gearshape", value: AppRouting.SettingsTab.general) {
                GeneralSettings().frame(width: Self.width, height: Self.height(.general))
            }
            Tab("Appearance", systemImage: "circle.lefthalf.filled", value: AppRouting.SettingsTab.appearance) {
                AppearanceSettings().frame(width: Self.width, height: Self.height(
                    .appearance, themes: model.themeChoices?.choices.count ?? 0, refusedPacks: model.themeChoices?.refused.count ?? 0
                ))
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
                RatingHistorySection()
                    .id("history")
                clubSection
                OutsideTheWindowSection()
                transactionLogSection
                DataStatusSection(dataStatus: model.dataStatus)
                    .id("dataStatus")
                dataFolderSection
            }
            .formStyle(.grouped)
            // Nothing is focused when the window opens (the first focusable piece was the rating history's sentence, drawn
            // with a focus ring for no reason; N6 polish); Tab still moves through every control
            .background(ClearsInitialFocus())
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
                Button(model.status?.configured == true ? "Choose Another Save…" : "Choose Save…") {
                    routing.requestSetup()
                    openWindow(id: SceneID.setup)
                }
                .disabled(!can.importExport)
                .accessibilityIdentifier("settings.chooseSave")
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
                .foregroundStyle(.readableSecondary)
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
                        .foregroundStyle(.readableSecondary)
                }
                if let clubProblem { ProblemLine(clubProblem) }
            } header: {
                Text("Club")
            } footer: {
                Text("Automatic follows the club you manage in the save.")
                    .foregroundStyle(.readableSecondary)
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
                .foregroundStyle(.readableSecondary)
        }
        .fileImporter(isPresented: $choosingSaveFolder, allowedContentTypes: [.folder]) { result in
            if case .success(let url) = result { saveFolder = url.path(percentEncoded: false) }
        }
        // The folder in use as served (named here, else found for the chosen save), so the field is never empty while
        // the server knows it (N6 polish: it was, after a switch)
        .onChange(of: model.status?.saveFolder, initial: true) { _, served in
            if let served, !served.isEmpty { saveFolder = served }
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

/// This save's rating history (D-064; N6, Stage B2): the served sentence about it, the questions the server asks (the
/// same as the main window's notice), the carry-overs in force, each with Undo (confirmed once, in the server's words),
/// and the other histories the GM may carry over, each with its served basis. Every answer posts the GM's choice and
/// redraws from the server's reply; a refusal shows the server's sentence here, never an alert. Nothing is carried over
/// without a click, and every carry-over can be undone.
struct RatingHistorySection: View {
    @Environment(AppModel.self) private var model
    @State private var problem: RequestProblem?
    @State private var busy = false
    @State private var confirmingUndo: Components.Schemas.RatingHistoryCarryOver?
    @State private var candidatesShown: Bool

    /// - Parameter candidatesShown: whether the other histories start unfolded (a snapshot shows them).
    init(candidatesShown: Bool = false) {
        _candidatesShown = State(initialValue: candidatesShown)
    }

    var body: some View {
        Section {
            if let history = model.ratingHistory {
                ServedClaimLine(history.status)
                    .accessibilityIdentifier("settings.history.status")
                if let warning = history.warning {
                    ServedClaimLine(warning, font: .callout)
                }
                ForEach(history.offers, id: \.id) { offer in
                    VStack(alignment: .leading, spacing: 8) {
                        ServedClaimLine(offer.question)
                        HStack {
                            Spacer()
                            Button { answer(offer.id, .fresh) } label: { Text(verbatim: offer.freshText) }
                            Button { answer(offer.id, .adopt) } label: { Text(verbatim: offer.adoptText) }
                                .accessibilityIdentifier("settings.history.adopt")
                        }
                        .controlSize(.small)
                    }
                    .accessibilityElement(children: .contain)
                    .accessibilityIdentifier("settings.history.offer")
                }
                ForEach(history.carriedOver, id: \.id) { carry in
                    HStack(alignment: .firstTextBaseline) {
                        ServedClaimLine(carry.text, font: .callout)
                        Spacer(minLength: 8)
                        Button("Undo") { confirmingUndo = carry }
                            .controlSize(.small)
                            .accessibilityIdentifier("settings.history.undo")
                    }
                }
                if !history.candidates.isEmpty {
                    DisclosureGroup(isExpanded: $candidatesShown) {
                        ForEach(history.candidates, id: \.id) { candidate in
                            HStack(alignment: .firstTextBaseline) {
                                ServedClaimLine(candidate.label, font: .callout)
                                Spacer(minLength: 8)
                                Button("Carry Over") { answer(candidate.id, .adopt) }
                                    .controlSize(.small)
                                    .accessibilityIdentifier("settings.history.carryOver")
                            }
                        }
                    } label: {
                        Text("Other Saves' Histories")
                    }
                    .accessibilityIdentifier("settings.history.candidates")
                }
                if let problem {
                    ProblemLine(problem)
                        .accessibilityIdentifier("settings.history.problem")
                }
            } else if let failure = model.ratingHistoryProblem {
                ProblemLine(failure)
                Button("Try Again") { Task { await model.loadRatingHistory() } }
            } else {
                ProgressView().controlSize(.small)
            }
        } header: {
            Text("Rating history")
        }
        .disabled(busy)
        .confirmationDialog("Undo the carry-over?", isPresented: Binding(get: { confirmingUndo != nil }, set: { if !$0 { confirmingUndo = nil } }), presenting: confirmingUndo) { carry in
            Button("Undo Carry-Over", role: .destructive) { answer(carry.id, .undo) }
        } message: { carry in
            Text(verbatim: carry.undoQuestion)
        }
        .task { await model.loadRatingHistory() }
        .accessibilityIdentifier("settings.history")
    }

    private func answer(_ id: String, _ choice: Components.Schemas.RatingHistoryChoice.ChoicePayload.Value1Payload) {
        busy = true
        Task {
            defer { busy = false }
            do {
                try await model.answerRatingHistory(id, choice: choice)
                problem = nil
            } catch {
                problem = RequestProblem.from(error)
            }
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
                // The reasons, where the save was found and what the log reader said: the basis, one click away
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    ToneSymbol(tone: status.headline.tone)
                    ClaimText(status.headline, edge: .trailing) {
                        Text(verbatim: status.headline.text).font(.headline).multilineTextAlignment(.leading)
                    }
                    .accessibilityIdentifier("settings.dataStatus.headline")
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
                            .foregroundStyle(row.cells.value.tone?.value1 == .unknown ? Color.readableSecondary : Color.primary)
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

/// System, Light or Dark (the served `theme`, applied to every window once the server has saved it), and the club's
/// colours: whether to draw team colours at all (the served `useTeamColors`), and which theme the current club wears,
/// its own colours or an installed theme pack, each with a preview in its own colours (D-062).
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
            ThemeSettings()
        }
        .formStyle(.grouped)
    }
}

/// The club's theme: team colours on or off, and the theme the current club wears, chosen from its served choices.
struct ThemeSettings: View {
    @Environment(AppModel.self) private var model
    @State private var problem: RequestProblem?
    @State private var loadProblem: RequestProblem?

    var body: some View {
        let useTeamColors = model.settings?.settings.useTeamColors ?? true
        Section {
            Toggle("Use Team Colors", isOn: Binding(
                get: { useTeamColors },
                set: { on in
                    Task {
                        do {
                            try await model.saveSettings(.init(useTeamColors: on))
                            problem = nil
                        } catch {
                            problem = RequestProblem.from(error)
                        }
                    }
                }
            ))
            .disabled(model.settings == nil)
            .accessibilityIdentifier("settings.useTeamColors")
            if let choices = model.themeChoices {
                Picker("Theme", selection: Binding(
                    get: { choices.active },
                    set: { id in
                        Task {
                            do {
                                try await model.chooseTheme(id)
                                problem = nil
                            } catch {
                                problem = RequestProblem.from(error)
                            }
                        }
                    }
                )) {
                    ForEach(choices.choices, id: \.id) { pack in
                        ThemeChoiceLabel(pack: pack).tag(pack.id)
                    }
                }
                .pickerStyle(.radioGroup)
                .disabled(!useTeamColors)
                .accessibilityIdentifier("settings.theme")
                if let active = choices.choices.first(where: { $0.id == choices.active }) {
                    ThemePreview(pack: active, useTeamColors: useTeamColors)
                }
                if let unavailable = choices.unavailable {
                    ProblemLine(served: unavailable.display, detail: unavailable.hint)
                }
                ForEach(choices.refused, id: \.folder) { refused in
                    LabeledContent {
                        Text(verbatim: refused.problem.display)
                            .foregroundStyle(.readableSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    } label: {
                        Label { Text(verbatim: refused.folder) } icon: { Image(systemName: "exclamationmark.triangle") }
                    }
                    .help(Text(verbatim: refused.details.joined(separator: "\n")))
                    .accessibilityIdentifier("settings.theme.refused.\(refused.folder)")
                }
                LabeledContent("Theme Packs Folder") {
                    HStack {
                        Text(verbatim: choices.folder)
                            .font(.callout)
                            .foregroundStyle(.readableSecondary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                            .textSelection(.enabled)
                            .help(Text(verbatim: choices.folder))
                        if FileManager.default.fileExists(atPath: choices.folder) {
                            Button("Show in Finder") {
                                NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: choices.folder, isDirectory: true)])
                            }
                            .controlSize(.small)
                        }
                    }
                }
            } else if let loadProblem {
                ProblemLine(loadProblem)
            } else {
                ProgressView().controlSize(.small)
            }
            if let problem { ProblemLine(problem) }
        } header: {
            Text("Team Colors")
        }
        .task(id: model.storeKey) {
            do {
                try await model.loadThemeChoices()
                loadProblem = nil
            } catch {
                loadProblem = RequestProblem.from(error)
            }
        }
    }
}

/// A theme on offer: a swatch of its masthead's colours and its served name (the colour is never the only signal).
struct ThemeChoiceLabel: View {
    let pack: Components.Schemas.ThemePack
    @Environment(\.colorScheme) private var colorScheme
    @EffectiveContrast private var contrast

    var body: some View {
        let palette = Theme(served: pack, useTeamColors: true).palette(colorScheme: colorScheme, contrast: contrast)
        HStack(spacing: 8) {
            LinearGradient(colors: palette.masthead.count == 1 ? palette.masthead + palette.masthead : palette.masthead,
                           startPoint: .leading, endPoint: .trailing)
                .frame(width: 28, height: 14)
                .clipShape(.capsule)
                .overlay { Capsule().strokeBorder(.separator, lineWidth: 0.5) }
                .accessibilityHidden(true)
            Text(verbatim: pack.name)
        }
    }
}

/// A live preview of a theme in the window's appearance: the Morning Report's masthead as the window sets it
/// (`ClubMagazineMasthead`: the club's served name and the pack's in the kicker, the view's served name, the served
/// record, the pack's art past the text) drawn at the width the window gives it and scaled down to fit, and the club
/// card, drawn by the same components the window uses.
struct ThemePreview: View {
    @Environment(AppModel.self) private var model
    let pack: Components.Schemas.ThemePack
    let useTeamColors: Bool
    @State private var logo: Image?
    @State private var mastheadHeight: CGFloat = 0

    /// The width the masthead is laid out at (a report's, so the art has its room past the text) and the scale it is
    /// shown at in Settings.
    static let mastheadWidth: CGFloat = 900
    static let scale: CGFloat = 0.6

    var body: some View {
        let club = model.catalogClub
        VStack(alignment: .leading, spacing: 10) {
            ClubMagazineMasthead(
                kicker: [pack.name],
                headline: model.servedViewName(department: "frontOffice", view: "morningReport").map { Text(verbatim: $0) } ?? Text("Morning Report")
            ) {
                if let record = club?.record {
                    BoxFigure(value: record.display, label: "")
                        .help(record.hint.map { Text(verbatim: $0) } ?? Text(verbatim: record.display))
                }
            }
            .environment(\.mastheadTopInset, 0)
            .frame(width: Self.mastheadWidth)
            .fixedSize(horizontal: false, vertical: true)
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { mastheadHeight = $0 }
            .scaleEffect(Self.scale, anchor: .topLeading)
            .frame(width: Self.mastheadWidth * Self.scale, height: mastheadHeight * Self.scale, alignment: .topLeading)
            .clipShape(.rect(cornerRadius: 10))
            if let club {
                ClubCard(name: club.name, detail: nil, record: club.record.display, recordHint: club.record.hint, logo: logo)
                    .frame(width: 260)
            }
        }
        .environment(\.theme, Theme(served: pack, useTeamColors: useTeamColors))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("settings.theme.preview")
        .task(id: pack.logo) { logo = await ServedImages.image(pack.logo, model: model) }
    }
}

// MARK: AI

/// Each AI provider and its key, as served (`GET /api/v2/ai/keys`, N13): whether a key is set and where from, what it
/// is used for and where to get one, in the server's words. A key is typed into a secure field, checked with its own
/// provider (`POST /api/v2/ai/keys/check`, the outcome in words), kept in this app's own Keychain item and handed to the
/// running server on stdin with no restart; after that it is never shown again (the served status says it is set, with
/// at most its last four characters). Removing it deletes the item and hands the set over again. Beside each provider,
/// the served line for where its kept items stand (`KeyStanding`): "enter it again" for a key this copy may not read
/// without asking, "another copy kept a key here" once the GM removed his own beside another copy's item, "a newer key
/// elsewhere". A failed save, removal or hand-over is the server's sentence, its system status only in the help tag and
/// the log (review N13B, L5, L6, M4). Never logged, never in an error.
struct AISettings: View {
    @Environment(AppModel.self) private var model
    @State private var keys: Components.Schemas.AiKeysView?
    @State private var problem: RequestProblem?
    @State private var standing = KeyStanding()
    @State private var attempt = 0
    private let preloaded: Components.Schemas.AiKeysView?

    init(preloaded: Components.Schemas.AiKeysView? = nil) {
        self.preloaded = preloaded
    }

    var body: some View {
        Form {
            if let answer = keys ?? preloaded {
                Section {
                    Text(verbatim: answer.lede.display).foregroundStyle(.primary).fixedSize(horizontal: false, vertical: true)
                    if let off = answer.off { AiClaimLine(off).accessibilityIdentifier("settings.ai.off") }
                    AiClaimLine(answer._where)
                }
                ForEach(answer.providers, id: \.id) { row in
                    ProviderKeyRow(row: row, kept: Self.keptLine(row.id, standing: standing, answer: answer), lines: answer) {
                        attempt += 1
                    }
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
        .task(id: TaskKey(store: model.storeKey, keysRevision: model.keysRevision, attempt: attempt)) { await load() }
        .accessibilityIdentifier("settings.ai")
    }

    /// The served line for where a provider's kept items stand, if any.
    static func keptLine(_ id: String, standing: KeyStanding, answer: Components.Schemas.AiKeysView) -> (claim: Components.Schemas.Claim, name: String)? {
        if standing.anotherCopys.contains(id) { return (answer.otherCopy, "otherCopy") }
        if standing.unreadable.contains(id) { return (answer.reenter, "reenter") }
        if standing.newerElsewhere.contains(id) { return (answer.newerElsewhere, "newerElsewhere") }
        return nil
    }

    private struct TaskKey: Hashable {
        var store: AppModel.StoreKey?
        var keysRevision: Int
        var attempt: Int
    }

    private func load() async {
        guard preloaded == nil else { return }
        standing = await model.keyStore.standing()
        guard let client = model.client else {
            problem = .notRunning
            return
        }
        do {
            switch try await client.getAiKeys() {
            case .ok(let answer):
                keys = try answer.body.json
                problem = nil
            case .undocumented(let code, let payload):
                problem = await .undocumented(code, body: payload.body, operation: "getAiKeys", fromV2: true)
            }
        } catch {
            let failure = RequestProblem.from(error)
            if let detail = failure.detail { model.logProblem("could not read the AI keys: \(detail)") }
            problem = failure
        }
    }
}

/// One provider: its served name and status, what it is used for and where to get a key; for a provider that needs
/// one, a secure field, Check (its served words), Save and Remove.
private struct ProviderKeyRow: View {
    let row: Components.Schemas.AiProviderRow
    /// The served line for where this provider's kept items stand ("enter it again", another copy's, a newer one), and
    /// its name for the accessibility identifier.
    let kept: (claim: Components.Schemas.Claim, name: String)?
    /// The served lines for a failed save, removal or hand-over.
    let lines: Components.Schemas.AiKeysView
    let changed: () -> Void
    @Environment(AppModel.self) private var model
    @State private var entry = ""
    @State private var checked: Components.Schemas.AiKeyCheckAnswer?
    @State private var problem: RequestProblem?
    /// A save, removal or hand-over that failed: the served sentence, and the system's status for the help tag only.
    @State private var keyFailure: (claim: Components.Schemas.Claim, detail: String)?
    @State private var working = false

    var body: some View {
        Section {
            AiClaimLine(row.status, font: .body).accessibilityIdentifier("settings.ai.\(row.id).status")
            if let usedFor = row.usedFor {
                Text(verbatim: usedFor.display).font(.callout).foregroundStyle(.readableSecondary)
            }
            if let kept { AiClaimLine(kept.claim).accessibilityIdentifier("settings.ai.\(row.id).\(kept.name)") }
            if row.needsKey {
                // Return in the field saves this row's key: one field, one action, never a default button shared by
                // every row (review N13B, L5)
                SecureField(text: $entry, prompt: Text(verbatim: row.getOne?.display ?? "")) { Text("Key") }
                    .onSubmit { if canSave { Task { await save() } } }
                    .accessibilityIdentifier("settings.ai.\(row.id).key")
                HStack {
                    if let check = row.check {
                        Button { Task { await runCheck() } } label: { Text(verbatim: check.display) }
                            .disabled(working || (entry.isEmpty && !row.configured))
                            .accessibilityIdentifier("settings.ai.\(row.id).check")
                    }
                    Spacer()
                    if row.source?.value1 == .keychain {
                        Button("Remove", role: .destructive) { Task { await remove() } }
                            .disabled(working)
                            .accessibilityIdentifier("settings.ai.\(row.id).remove")
                    }
                    Button("Save") { Task { await save() } }
                        .disabled(!canSave)
                        .accessibilityIdentifier("settings.ai.\(row.id).save")
                }
                if let checked { AiClaimLine(checked.result).accessibilityIdentifier("settings.ai.\(row.id).checked") }
                if let problem { ProblemLine(problem) }
                if let keyFailure {
                    ProblemLine(served: keyFailure.claim.text, detail: [keyFailure.claim.hint, keyFailure.detail].compactMap(\.self).joined(separator: " · "))
                        .accessibilityIdentifier("settings.ai.\(row.id).failure")
                }
            }
        } header: {
            Text(verbatim: row.name.display)
        }
    }

    private var canSave: Bool { !working && !entry.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    private func runCheck() async {
        guard let client = model.client else { problem = .notRunning; return }
        working = true
        defer { working = false }
        let typed = entry.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            switch try await client.checkAiKey(body: .json(.init(provider: row.id, key: typed.isEmpty ? nil : typed))) {
            case .ok(let answer):
                checked = try answer.body.json
                problem = nil
            case .badRequest(let refused):
                checked = nil
                problem = .served(try refused.body.json.error)
            case .undocumented(let code, let payload):
                problem = await .undocumented(code, body: payload.body, operation: "checkAiKey", fromV2: true)
            }
        } catch {
            // `logLine` keeps the operation, the status and the error's domain and code: never the request, so never the key
            problem = RequestProblem.from(error)
        }
    }

    private func save() async {
        working = true
        defer { working = false }
        do {
            let handed = try await model.saveKey(entry, for: row.id)
            // Never shown again: the served status now says it is set
            entry = ""
            checked = nil
            problem = nil
            keyFailure = handed.failure.map { (lines.handOverFailed, $0) }
            changed()
        } catch {
            keyFailure = (lines.saveFailed, error.description)
        }
    }

    private func remove() async {
        working = true
        defer { working = false }
        do {
            let handed = try await model.removeKey(row.id)
            checked = nil
            problem = nil
            keyFailure = handed.failure.map { (lines.handOverFailed, $0) }
            changed()
        } catch {
            keyFailure = (lines.removeFailed, error.description)
        }
    }
}

/// Leaves nothing focused when its window first shows its content, as the system's own Settings windows open: AppKit
/// otherwise focuses the first focusable view and draws its ring. Keyboard focus still moves with Tab.
struct ClearsInitialFocus: NSViewRepresentable {
    func makeNSView(context: Context) -> Clearer { Clearer() }
    func updateNSView(_ view: Clearer, context: Context) {}

    final class Clearer: NSView {
        private weak var cleared: NSWindow?

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            guard let window, window !== cleared else { return }
            cleared = window
            // After AppKit has chosen its initial first responder for the window
            DispatchQueue.main.async { [weak window] in window?.makeFirstResponder(nil) }
        }
    }
}

/// What Pennant says outside its windows (N7): a notification when a new export has been read (only while Pennant is
/// not in front), and the desk's open count on the Dock icon. Both are on until turned off; kept in the app's own
/// defaults, never the data folder. N14: the menu bar extra (the record, the next game and the desk), off until turned on.
struct OutsideTheWindowSection: View {
    @AppStorage(AppPreferences.notifiesNewExportKey) private var notifies = true
    @AppStorage(AppPreferences.showsDockBadgeKey) private var badge = true
    @AppStorage(AppPreferences.showsMenuBarExtraKey) private var menuBar = false

    var body: some View {
        Section("Notifications") {
            Toggle("Notify When a New Export Is Read", isOn: $notifies)
                .accessibilityIdentifier("settings.notifies")
            Toggle("Show Open Desk Items on the Dock Icon", isOn: $badge)
                .accessibilityIdentifier("settings.dockBadge")
            Toggle("Show Pennant in the Menu Bar", isOn: $menuBar)
                .accessibilityIdentifier("settings.menuBarExtra")
        }
    }
}
