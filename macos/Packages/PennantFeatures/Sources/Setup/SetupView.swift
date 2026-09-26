import FeatureCore
import PennantAPI
import PennantKit
import SwiftUI
import UniformTypeIdentifiers

/// The Setup window (SWIFTUI_REBUILD.md section 3.1): find the save, import it, pick the club. `status` is the app's
/// served status, which the event stream keeps current; each change is passed to the model so it can follow the
/// import. The window closes itself when the club is saved.
public struct SetupView: View {
    @Bindable var model: SetupModel
    let status: Components.Schemas.ServerStatus?
    @Environment(\.dismissWindow) private var dismissWindow

    /// The window's size.
    public static let size = CGSize(width: 640, height: 560)

    public init(model: SetupModel, status: Components.Schemas.ServerStatus?) {
        self.model = model
        self.status = status
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            StepHeader(step: model.step)
                .padding([.horizontal, .top], 20)
                .padding(.bottom, 12)
            Divider()
            Group {
                switch model.step {
                case .findSave: FindSaveStep(model: model, status: status)
                case .importing: ImportStep(model: model, status: status)
                case .pickClub, .done: PickClubStep(model: model)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .background(.background)
        .task { if !model.savesLoaded { await model.load() } }
        .onChange(of: status, initial: true) { _, next in
            Task { await model.observe(next) }
        }
        .onChange(of: model.step) { _, step in
            if step == .done { dismissWindow(id: SceneID.setup) }
        }
        // A container, so the window's id does not replace its controls' own (the Save Club button's, in the inset)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("setup")
    }
}

/// Where the GM is among the three steps; the current one is marked by a filled symbol and its weight, not by
/// colour alone.
private struct StepHeader: View {
    let step: SetupModel.Step

    var body: some View {
        HStack(spacing: 16) {
            item("Find the Save", symbol: "1.circle", current: step == .findSave, done: step != .findSave)
            item("Import", symbol: "2.circle", current: step == .importing, done: step == .pickClub || step == .done)
            item("Pick the Club", symbol: "3.circle", current: step == .pickClub || step == .done, done: step == .done)
        }
        .font(.callout)
    }

    private func item(_ title: LocalizedStringKey, symbol: String, current: Bool, done: Bool) -> some View {
        Label {
            Text(title).fontWeight(current ? .semibold : .regular)
        } icon: {
            Image(systemName: done ? "checkmark.circle.fill" : (current ? symbol + ".fill" : symbol))
        }
        .foregroundStyle(current ? .primary : .secondary)
        .accessibilityAddTraits(current ? .isSelected : [])
    }
}

// MARK: Find the save

private struct FindSaveStep: View {
    @Bindable var model: SetupModel
    let status: Components.Schemas.ServerStatus?
    @State private var selected: String?
    @State private var choosingFolder = false

    /// Nothing is chosen while an import runs: the server would refuse it, and the window says why.
    private var importing: Bool { status?.importing == true }

    var body: some View {
        Form {
            if importing {
                Section {
                    Label {
                        Text("An import is running. Choose a save when it has finished.")
                    } icon: {
                        Image(systemName: "hourglass")
                    }
                    ImportProgressView(progress: status?.importProgress)
                }
            }
            Section("Saves Pennant found") {
                if let problem = model.loadProblem {
                    ProblemLine(problem)
                    Button("Try Again") { Task { await model.load() } }
                        .accessibilityIdentifier("setup.reload")
                } else if !model.savesLoaded {
                    ProgressView()
                } else if model.saves.isEmpty {
                    Text("None found")
                        .foregroundStyle(.secondary)
                } else {
                    SaveList(saves: model.saves, selected: $selected)
                }
            }
            Section {
                TextField("Folder", text: $model.folderPath, prompt: Text("The save's folder, or the folder that holds your saves"))
                    .labelsHidden()
                    .onSubmit { Task { await model.useFolder(status: status) } }
                    .accessibilityIdentifier("setup.folderPath")
                HStack {
                    Button("Choose…") { choosingFolder = true }
                        .accessibilityIdentifier("setup.chooseFolder")
                    Spacer()
                    Button("Use This Folder") { Task { await model.useFolder(status: status) } }
                        .disabled(model.folderPath.trimmingCharacters(in: .whitespaces).isEmpty || model.busy || importing)
                        .accessibilityIdentifier("setup.useFolder")
                }
                if let choices = model.folderChoices {
                    SaveList(saves: choices, selected: $selected)
                }
                if let problem = model.folderProblem {
                    ProblemLine(problem)
                }
            } header: {
                Text("Or choose a folder")
            }
            if !model.locations.isEmpty {
                Section("Where Pennant looked") {
                    ForEach(model.locations, id: \.path) { location in
                        LabeledContent {
                            Text(verbatim: location.path)
                                .textSelection(.enabled)
                                .foregroundStyle(.secondary)
                        } label: {
                            Label {
                                Text(verbatim: location.label)
                            } icon: {
                                Image(systemName: location.exists ? "checkmark.circle" : "xmark.circle")
                                    .accessibilityLabel(location.exists ? Text("Found") : Text("Not found"))
                            }
                        }
                    }
                }
            }
        }
        .formStyle(.grouped)
        .fileImporter(isPresented: $choosingFolder, allowedContentTypes: [.folder]) { result in
            if case .success(let url) = result {
                model.folderPath = url.path(percentEncoded: false)
                Task { await model.useFolder(status: status) }
            }
        }
        .safeAreaInset(edge: .bottom) {
            HStack {
                if model.busy { ProgressView().controlSize(.small) }
                Spacer()
                Button("Use This Save") {
                    if let save = (model.saves + (model.folderChoices ?? [])).first(where: { $0.lgPath == selected }) {
                        Task { await model.choose(save, status: status) }
                    }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(selected == nil || model.busy || importing)
                .accessibilityIdentifier("setup.useSave")
            }
            .padding(16)
            .background(.bar)
        }
    }
}

/// Saves as served: name, when their export was written, and how many export files there are. A save with no
/// export files cannot be chosen.
private struct SaveList: View {
    static let chosenSymbol = "largecircle.fill.circle"
    static let unchosenSymbol = "circle"
    let saves: [Components.Schemas.SaveInfo]
    @Binding var selected: String?

    var body: some View {
        ForEach(saves, id: \.lgPath) { save in
            Button {
                selected = save.lgPath
            } label: {
                HStack {
                    Image(systemName: selected == save.lgPath ? Self.chosenSymbol : Self.unchosenSymbol)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(verbatim: save.name).font(.headline)
                        if let written = save.csvLastModifiedText {
                            Text(verbatim: written).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    Spacer()
                    HStack(spacing: 4) {
                        Text("Export files")
                        Text(save.csvCount, format: .number).monospacedDigit()
                    }
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .accessibilityElement(children: .combine)
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .disabled(save.csvCount == 0)
            .accessibilityAddTraits(selected == save.lgPath ? .isSelected : [])
            .accessibilityIdentifier("setup.save.\(save.name)")
        }
    }
}

// MARK: Import

private struct ImportStep: View {
    let model: SetupModel
    let status: Components.Schemas.ServerStatus?

    var body: some View {
        Form {
            Section {
                if let chosen = model.chosen {
                    LabeledContent("Save") { Text(verbatim: chosen.name) }
                    LabeledContent("Export folder") {
                        Text(verbatim: chosen.csvDir).textSelection(.enabled).lineLimit(2).truncationMode(.middle)
                    }
                }
                if let problem = model.importProblem {
                    switch problem {
                    case .served(let text, let detail): ProblemLine(served: text, detail: detail)
                    case .request(let request): ProblemLine(request)
                    case .notStarted: ProblemLine(Text("The import did not start"))
                    case .unexplained: ProblemLine(Text("The import did not finish"))
                    }
                    HStack {
                        Button("Choose Another Save") { model.restart() }
                        Spacer()
                        Button("Try Again") { Task { await model.retryImport(status: status) } }
                            .keyboardShortcut(.defaultAction)
                            .disabled(model.busy || status?.importing == true)
                            .accessibilityIdentifier("setup.retryImport")
                    }
                } else {
                    ImportProgressView(progress: model.progress)
                }
            } header: {
                Text("Importing the export")
            }
        }
        .formStyle(.grouped)
        .accessibilityIdentifier("setup.importing")
    }
}

// MARK: Pick the club

private struct PickClubStep: View {
    @Bindable var model: SetupModel

    var body: some View {
        Form {
            Section("Your club") {
                if model.clubs.isEmpty, let problem = model.clubProblem {
                    ProblemLine(problem)
                    HStack {
                        Button("Choose Another Save") { model.restart() }
                        Spacer()
                        Button("Try Again") { Task { await model.loadClubs() } }
                            .accessibilityIdentifier("setup.reloadClubs")
                    }
                } else {
                    Picker("Club", selection: $model.selectedClub) {
                        ForEach(model.clubs, id: \.teamId) { club in
                            HStack {
                                Text(verbatim: club.label)
                                if club.isHuman {
                                    Text("Managed by you in this save").foregroundStyle(.secondary)
                                }
                            }
                            .tag(Optional(club.teamId))
                        }
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                    .accessibilityIdentifier("setup.clubs")
                    if let problem = model.clubProblem {
                        ProblemLine(problem)
                    }
                }
            }
        }
        .formStyle(.grouped)
        .safeAreaInset(edge: .bottom) {
            HStack {
                if model.busy { ProgressView().controlSize(.small) }
                Spacer()
                Button("Save Club") { Task { await model.saveClub() } }
                    .keyboardShortcut(.defaultAction)
                    .disabled(model.selectedClub == nil || model.busy)
                    .accessibilityIdentifier("setup.saveClub")
            }
            .padding(16)
            .background(.bar)
        }
    }
}

#if DEBUG
#Preview("Setup: find the save") {
    SetupView(
        model: .preview(step: .findSave, saves: [
            .init(name: "Test League", lgPath: "/tmp/Test League.lg", csvDir: "/tmp/Test League.lg/import_export/csv", csvCount: 71, csvLastModified: "2040-07-01T12:00:00.000Z"),
        ]),
        status: nil
    )
    .frame(width: SetupView.size.width, height: SetupView.size.height)
}

#Preview("Setup: importing") {
    SetupView(
        model: .preview(step: .importing, progress: .init(
            table: "players", fileIndex: 12, files: 71, rows: 50_000, phase: .init(value1: .writing),
            words: .init(phase: "Writing the league", table: "Players", display: "Writing players · 12 of 71")
        )),
        status: nil
    )
    .frame(width: SetupView.size.width, height: SetupView.size.height)
}
#endif
