import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI
import UniformTypeIdentifiers

/// The Setup window (SWIFTUI_REBUILD.md section 3.1; "As built at N6 (Stage B2)"): on a first run it asks the server to
/// set up by itself and, when one save clearly stands out, only follows its import; otherwise it finds the save, imports
/// it and picks the club when the save does not name it. `status` is the app's served status, which the event stream
/// keeps current; each change is passed to the model so it can follow the import. The window closes itself when the
/// club is saved or taken from the save.
public struct SetupView: View {
    @Bindable var model: SetupModel
    let status: Components.Schemas.ServerStatus?
    /// The model's count of ended runs when this window's view appeared: only a run ending after it closes the window.
    @State private var completionsAtOpen: Int?

    /// The window's size.
    public static let size = CGSize(width: 640, height: 560)

    public init(model: SetupModel, status: Components.Schemas.ServerStatus?) {
        self.model = model
        self.status = status
    }

    /// A run ended after this window's view appeared.
    private var shouldClose: Bool {
        guard let opened = completionsAtOpen else { return false }
        return model.completions > opened
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            StepHeader(step: model.step, clubWasAsked: model.clubWasAsked)
                .padding([.horizontal, .top], 20)
                .padding(.bottom, 12)
            Divider()
            Group {
                switch model.step {
                case .findSave: FindSaveStep(model: model, status: status)
                case .importing: ImportStep(model: model, status: status)
                case .pickClub: PickClubStep(model: model)
                // Closing: the step the GM last saw, never an empty club step when the club was taken from the save
                case .done: if model.clubWasAsked { PickClubStep(model: model) } else { ImportStep(model: model, status: status) }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .background(.background)
        .task { await model.begin(status: status) }
        .onChange(of: status, initial: true) { _, next in
            Task { await model.observe(next) }
        }
        .onChange(of: model.step, initial: true) { _, step in
            #if DEBUG
            // A development build given a capture folder draws this window at each step (the window only, by the app)
            AfterNextFrame.run { DevWindowCapture.capture("setup-\(step)", title: "Set Up Pennant") }
            #endif
        }
        // Closes when a run ends while the window is open (the club saved or taken from the save), counted by the
        // model rather than read from the step's change, which a run ending within a frame of the window opening could
        // pass by; the model outlives the window, so a window opened on a finished model is not closed at once (the
        // scene starts it again at the saves). The close is this window's own, applied once it is on screen
        // (`WindowCloser`): a scene-wide dismiss asked while the window was still opening could be dropped (M7).
        .background(WindowCloser(close: shouldClose))
        .onAppear { if completionsAtOpen == nil { completionsAtOpen = model.completions } }
        // A container, so the window's id does not replace its controls' own (the Save Club button's, in the inset)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("setup")
    }
}

/// Where the GM is among the three steps; the current one is marked by a filled symbol and its weight, not by
/// colour alone.
private struct StepHeader: View {
    let step: SetupModel.Step
    /// Whether the GM was asked the club: when it was taken from the save, the club step is never the current one.
    var clubWasAsked = true

    var body: some View {
        HStack(spacing: 16) {
            item("Find the Save", symbol: "1.circle", current: step == .findSave, done: step != .findSave)
            item("Import", symbol: "2.circle", current: step == .importing || (step == .done && !clubWasAsked), done: step == .pickClub || step == .done)
            item("Pick the Club", symbol: "3.circle", current: step == .pickClub || (step == .done && clubWasAsked), done: step == .done)
        }
        .font(.callout)
    }

    private func item(_ title: LocalizedStringKey, symbol: String, current: Bool, done: Bool) -> some View {
        Label {
            Text(title).fontWeight(current ? .semibold : .regular)
        } icon: {
            Image(systemName: done ? "checkmark.circle.fill" : (current ? symbol + ".fill" : symbol))
        }
        .foregroundStyle(current ? Color.primary : Color.readableSecondary)
        .accessibilityAddTraits(current ? .isSelected : [])
    }
}

// MARK: Find the save

private struct FindSaveStep: View {
    @Bindable var model: SetupModel
    let status: Components.Schemas.ServerStatus?
    @State private var choosingFolder = false

    /// Nothing is chosen while an import runs: the server would refuse it, and the window says why.
    private var importing: Bool { status?.importing == true }

    /// Why the server picked nothing: the automatic setup's answer on a first run, else the list's.
    private var noPick: Components.Schemas.Claim? {
        model.discovery?.noPick?.claim ?? (model.automatic?.outcome.value1 == .nothingStandsOut ? model.automatic?.why : nil)
    }

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
            // Why nothing was chosen by itself, and how to switch the export on, in the server's words
            if let noPick {
                Section {
                    ServedClaimLine(noPick)
                        .accessibilityIdentifier("setup.noPick")
                    if let help = model.discovery?.exportHelp {
                        ServedClaimLine(help)
                            .accessibilityIdentifier("setup.exportHelp")
                    }
                }
            } else if let help = model.discovery?.exportHelp {
                Section { ServedClaimLine(help).accessibilityIdentifier("setup.exportHelp") }
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
                        .foregroundStyle(.readableSecondary)
                } else {
                    SaveList(saves: model.saves, pick: { model.isPick($0) ? model.pickClaim : nil }, disabled: model.busy || importing) { save in
                        Task { await model.choose(save, status: status) }
                    }
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
                    SaveList(saves: choices, pick: { _ in nil }, disabled: model.busy || importing) { save in
                        Task { await model.choose(save, status: status) }
                    }
                }
                if let problem = model.folderProblem {
                    ProblemLine(problem)
                }
            } header: {
                Text("Or choose a folder")
            }
            if !model.locations.isEmpty {
                // Where Pennant looked, by the served names of the places OOTP keeps saves; each folder is in its hover.
                // Folded away until the GM opens it: the saves are what the step is about
                Section {
                    DisclosureGroup {
                        ForEach(model.locations, id: \.path) { location in
                            Label {
                                Text(verbatim: location.label)
                            } icon: {
                                Image(systemName: location.exists ? "checkmark.circle" : "xmark.circle")
                                    .accessibilityLabel(location.exists ? Text("Found") : Text("Not found"))
                            }
                            .help(Text(verbatim: location.path))
                        }
                    } label: {
                        Text("Where Pennant looked")
                    }
                    .accessibilityIdentifier("setup.searched")
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
            if model.busy {
                HStack {
                    ProgressView().controlSize(.small)
                    Spacer()
                }
                .padding(12)
                .background(.bar)
            }
        }
    }
}

/// Saves as served, most recently played first: each one's name, when it was last played (or why it can't be used),
/// and the served name of where it is. The save the server picked as clearly standing out carries its served line, and
/// its basis on hover. Choosing one is one click; a save with no export files cannot be chosen.
private struct SaveList: View {
    let saves: [Components.Schemas.SaveInfo]
    let pick: (Components.Schemas.SaveInfo) -> Components.Schemas.Claim?
    let disabled: Bool
    let choose: (Components.Schemas.SaveInfo) -> Void

    var body: some View {
        ForEach(saves, id: \.lgPath) { save in
            let picked = pick(save)
            if save.csvCount == 0 {
                // Nothing to import yet: shown in full (its served sentence says why), never a dimmed control
                row(save, picked: picked, choosable: false)
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("setup.save.\(save.name)")
            } else {
                Button { choose(save) } label: { row(save, picked: picked, choosable: true) }
                    .buttonStyle(.plain)
                    .disabled(disabled)
                    // The pick's served basis, or the save's served facts, on hover
                    .help(Text(verbatim: picked?.hoverText ?? [save.lastPlayedText, save.location, save.csvLastModifiedText].compactMap { $0 }.joined(separator: "\n")))
                    .accessibilityHint(Text("Uses this save"))
                    .accessibilityIdentifier("setup.save.\(save.name)")
            }
        }
    }

    private func row(_ save: Components.Schemas.SaveInfo, picked: Components.Schemas.Claim?, choosable: Bool) -> some View {
                HStack(alignment: .center, spacing: 10) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(verbatim: save.name).font(.headline)
                        if let picked {
                            HStack(alignment: .firstTextBaseline, spacing: 5) {
                                ToneSymbol(tone: picked.tone)
                                Text(verbatim: picked.text).font(.callout)
                            }
                        } else if let played = save.lastPlayedText {
                            Text("Last played \(played)").font(.callout)
                        }
                        if let note = save.exportNote {
                            Text(verbatim: note).font(.callout).fixedSize(horizontal: false, vertical: true)
                        }
                        if let location = save.location {
                            Text(verbatim: location).font(.caption).foregroundStyle(.readableSecondary)
                        }
                    }
                    Spacer(minLength: 8)
                    Image(systemName: "chevron.forward")
                        .foregroundStyle(.readableSecondary)
                        .opacity(choosable ? 1 : 0)
                        .accessibilityHidden(true)
                }
                .contentShape(.rect)
    }
}

// MARK: Import

private struct ImportStep: View {
    let model: SetupModel
    let status: Components.Schemas.ServerStatus?

    var body: some View {
        Form {
            Section {
                // The save the server chose by itself, and why, in its words (its basis a click away)
                if let automatic = model.automatic, automatic.outcome.value1 == .started {
                    Text(verbatim: automatic.text).font(.headline)
                        .accessibilityIdentifier("setup.automatic")
                    if let why = automatic.why {
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            ToneSymbol(tone: why.tone)
                            ClaimText(why, font: .callout)
                        }
                    }
                }
                // The save, unless the server's line above already names it; its export folder is in the hover
                if let chosen = model.chosen, model.automatic?.outcome.value1 != .started {
                    LabeledContent("Save") { Text(verbatim: chosen.name) }
                        .help(Text(verbatim: chosen.csvDir))
                }
                if let club = model.club {
                    Label { Text(verbatim: club.text) } icon: { Image(systemName: club.decided ? "person.crop.circle.badge.checkmark" : "person.crop.circle.badge.questionmark") }
                        .accessibilityIdentifier("setup.club")
                }
                if let problem = model.importProblem {
                    switch problem {
                    case .served(let text, let detail): ProblemLine(served: text, detail: detail)
                    case .request(let request): ProblemLine(request)
                    case .notStarted: ProblemLine(Text("The import did not start"))
                    case .unexplained: ProblemLine(Text("The import did not finish"))
                    }
                    HStack {
                        Button("Choose Another Save") {
                            model.restart()
                            Task { await model.load() }
                        }
                        Spacer()
                        Button("Try Again") { Task { await model.retryImport(status: status) } }
                            .keyboardShortcut(.defaultAction)
                            .disabled(model.busy || status?.importing == true)
                            .accessibilityIdentifier("setup.retryImport")
                    }
                } else if model.step == .done {
                    // Landed: the window is closing, with the club taken from the save
                    ProgressView(value: 1, total: 1) { Text("Imported") }
                        .accessibilityIdentifier("import.progress")
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
                // Why the club is asked, in the server's words ("You manage 2 clubs in this save, …")
                if let club = model.club, !club.decided {
                    Text(verbatim: club.text).accessibilityIdentifier("setup.club")
                }
                if model.clubs.isEmpty, let problem = model.clubProblem {
                    ProblemLine(problem)
                    HStack {
                        Button("Choose Another Save") {
                            model.restart()
                            Task { await model.load() }
                        }
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
                                    Text("Managed by you in this save").foregroundStyle(.readableSecondary)
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
                // Another save instead: the club is owed only for the save chosen
                Button("Choose Another Save") {
                    model.restart()
                    Task { await model.load() }
                }
                .disabled(model.busy)
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
