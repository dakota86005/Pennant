import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

/// Loads one of Major League Ops' views for the window's key, and again when the key moves.
private struct LoadsMajorLeague: ViewModifier {
    @Environment(AppModel.self) private var model
    let view: MajorLeagueStore.View

    func body(content: Content) -> some View {
        content.task(id: model.storeKey) { await model.loadMajorLeague(view) }
    }
}

extension View {
    func loadsMajorLeague(_ view: MajorLeagueStore.View) -> some View { modifier(LoadsMajorLeague(view: view)) }
}

extension AppModel {
    /// Whether a view is drawn as updating: it is being read again, or what is shown was built for an earlier import or
    /// build than the key names (its own stamps, `MajorLeagueStore.isCurrent`). Another club's is never shown at all:
    /// the store drops it when the save or club changes (the N8 review, M1).
    func majorLeagueUpdating(_ view: MajorLeagueStore.View) -> Bool {
        // With no key yet (the server not ready, or a preview), nothing can be stale: only a read under way says so
        guard let key = storeKey else { return majorLeague.loading.contains(view) }
        return majorLeague.loading.contains(view) || !majorLeague.isCurrent(view, for: key)
    }
}

// MARK: The report

/// The department's report (N4's anatomy: masthead, figures, to decide, watching, what changed, what we can't see, the
/// memo slot), with the department's companion beneath: the staff's views at a glance, how the philosophy leans, and the
/// what-if. Every item that is a need opens its decision.
struct MajorLeagueReportView: View {
    var body: some View {
        DepartmentReportView(department: MajorLeagueDepartment.id) {
            ReportCompanion()
        }
    }
}

/// The report's companion, as served (`MlbOverviewView`).
struct ReportCompanion: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        // A stack that is always there, so its read starts even while nothing is drawn yet
        VStack(alignment: .leading, spacing: 0) {
            if let problem = model.majorLeague.problems[.overview] {
                ProblemLine(problem)
            } else if let overview = model.majorLeague.overview {
                VStack(alignment: .leading, spacing: 22) {
                    if model.majorLeagueUpdating(.overview) { ProgressView { Text("Refreshing") }.controlSize(.small) }
                    if let fresh = overview.freshness {
                        Label { Text(verbatim: fresh.display) } icon: { ToneMark(served: fresh.tone) }
                            .help(detail: fresh.hint)
                    }
                    Glances(glances: overview.glances)
                    if let philosophy = overview.philosophy { ClaimLine(philosophy, font: .callout) }
                    WhatIfPicker(whatIf: overview.whatIf)
                }
            } else {
                ProgressView { Text("Loading") }.controlSize(.small)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .loadsMajorLeague(.overview)
    }
}

/// The staff's views at a glance: each card's served title, count and lines, opening its view.
struct Glances: View {
    let glances: [Components.Schemas.MlbGlance]
    @Environment(\.routeOpener) private var opener

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            MagazineSection(title: Text("The Staff at a Glance"))
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: 12) { cards }
                VStack(alignment: .leading, spacing: 12) { cards }
            }
        }
    }

    @ViewBuilder private var cards: some View {
        ForEach(Array(glances.enumerated()), id: \.offset) { _, glance in
            let target = route(glance.open)
            Button {
                if let target { opener?.open(target) }
            } label: {
                Card {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(alignment: .firstTextBaseline) {
                            Text(verbatim: glance.title.display).font(.headline)
                            Spacer(minLength: 8)
                            if let count = glance.count, count > 0 {
                                Text(verbatim: String(count)).font(.headline).monospacedDigit()
                                    .padding(.horizontal, 7).padding(.vertical, 1)
                                    .background(Color.readableChipFill, in: .capsule)
                                    .accessibilityLabel(Text(verbatim: glance.countLabel?.display ?? String(count)))
                            }
                        }
                        ForEach(Array(glance.lines.enumerated()), id: \.offset) { _, line in
                            Text(verbatim: line.display).font(.callout)
                                .foregroundStyle(Tone(line.tone) == .unknown ? Color.readableSecondary : Color.primary)
                                .help(detail: line.hint)
                        }
                    }
                    .frame(minWidth: 220, alignment: .leading)
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .disabled(target.map { opener?.canOpen($0) != true } ?? true)
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isButton)
            .accessibilityIdentifier("glance.\(glance.open.view ?? "")")
        }
    }
}

/// "Ask a what-if": the served players, each opening the scenario's decision (it is a scenario, not a current problem).
struct WhatIfPicker: View {
    let whatIf: Components.Schemas.MlbOverviewView.WhatIfPayload
    @Environment(\.routeOpener) private var opener

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            MagazineSection(title: Text(verbatim: whatIf.title.display))
            // The shared choice pop-up (PennantDesign): the served players, each choosing his scenario; none is current
            ChoicePopover(
                Text(verbatim: whatIf.title.display),
                current: Text(verbatim: whatIf.prompt.display),
                choices: whatIf.players.map { choice in
                    .init(
                        verbatim: choice.role.map { "\(choice.player.name) · \($0.display)" } ?? choice.player.name,
                        identifier: "whatIf.player.\(choice.player.playerId)"
                    )
                },
                id: "whatIf"
            ) { index in
                if let target = route(whatIf.players[index].open) { opener?.open(target) }
            }
            .fixedSize()
            .disabled(whatIf.players.isEmpty)
            Text(verbatim: whatIf.note.display).font(.callout).foregroundStyle(.readableSecondary)
        }
    }
}

// MARK: Position players

/// Position players: the lineup as usage shows it, each regular read against the standard for his job; select a row
/// for what a scout would say. The table fills the column and scrolls by itself, the read beneath it (`TablePane`).
struct PositionPlayersView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let store = model.majorLeague
        ViewState(payload: store.positionPlayers, problem: store.problems[.positionPlayers]) { view in
            ServedTablePane(view.lineup, id: "lineup", name: view.title.display) {
                ViewHead(title: Text(verbatim: view.title.display), lede: view.lede, yardsticks: view.yardsticks, refreshing: model.majorLeagueUpdating(.positionPlayers))
            } notes: {
                if let note = view.basisNote {
                    Text(verbatim: note.display).font(.callout).foregroundStyle(.readableSecondary).help(detail: note.hint)
                }
            }
        }
        .loadsMajorLeague(.positionPlayers)
    }
}

// MARK: Pitching staff

/// Pitching staff: the rotation and the bullpen, each its served table; the pen's notes on how it is used and the served
/// note on how a reliever's role is read beneath the table, with the selected arm's read. The sections are chosen with a
/// segmented control.
struct PitchingStaffView: View {
    @Environment(AppModel.self) private var model
    @State private var section = 0

    var body: some View {
        let store = model.majorLeague
        ViewState(payload: store.pitchingStaff, problem: store.problems[.pitchingStaff]) { view in
            let index = min(section, max(view.sections.count - 1, 0))
            let head = VStack(alignment: .leading, spacing: 14) {
                ViewHead(title: Text(verbatim: view.title.display), lede: view.lede, yardsticks: view.yardsticks, refreshing: model.majorLeagueUpdating(.pitchingStaff))
                if let empty = view.empty {
                    Text(verbatim: empty.display).foregroundStyle(.readableSecondary)
                }
                if !view.sections.isEmpty {
                    Picker(selection: $section) {
                        ForEach(Array(view.sections.enumerated()), id: \.offset) { index, section in
                            Text(verbatim: section.title.display).tag(index)
                        }
                    } label: {
                        Text("Section")
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    .fixedSize()
                    .accessibilityIdentifier("pitching.sections")
                }
            }
            if view.sections.indices.contains(index) {
                let shown = view.sections[index]
                ServedTablePane(shown.table, id: "pitching.\(index)", name: shown.title.display) {
                    head
                } notes: {
                    StaffSectionNotes(section: shown)
                }
                .id(index)
            } else {
                head.padding(.horizontal, 28).padding(.vertical, 20)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    .background(Color.readablePage)
            }
        }
        .loadsMajorLeague(.pitchingStaff)
    }
}

/// A staff section's own notes, beneath its table: the findings on how the group is used, and the note on how a role is
/// read.
struct StaffSectionNotes: View {
    let section: Components.Schemas.MlbStaffSection

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if !section.findings.isEmpty {
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .top, spacing: 12) { findings }
                    VStack(alignment: .leading, spacing: 12) { findings }
                }
            } else if let empty = section.findingsEmpty {
                Text(verbatim: empty.display).font(.callout).foregroundStyle(.readableSecondary)
            }
            if let note = section.note { ClaimLine(note, font: .callout) }
        }
    }

    @ViewBuilder private var findings: some View {
        ForEach(Array(section.findings.enumerated()), id: \.offset) { _, finding in
            Card { BlockView(finding) }.frame(minWidth: 260)
        }
    }
}

// MARK: Bench & Backups

/// Bench & Backups: the bench itself in its table, and beneath it the selected player's read, then what the bench is for
/// (each job, who does it and how well, and the decision that looks for a backup where nobody does) and its findings.
/// The pane beneath takes more of the height here: the bench's jobs are half of what the view is for.
struct BenchBackupsView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let store = model.majorLeague
        ViewState(payload: store.bench, problem: store.problems[.benchBackups]) { view in
            ServedTablePane(view.bench, id: "bench", name: view.title.display, detailShare: 0.5) {
                VStack(alignment: .leading, spacing: 10) {
                    ViewHead(title: Text(verbatim: view.title.display), lede: view.lede, yardsticks: view.yardsticks, refreshing: model.majorLeagueUpdating(.benchBackups))
                    if let empty = view.empty {
                        Text(verbatim: empty.display).foregroundStyle(.readableSecondary)
                    }
                }
            } notes: {
                VStack(alignment: .leading, spacing: 12) {
                    if !view.functions.isEmpty {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 260), spacing: 12, alignment: .top)], alignment: .leading, spacing: 12) {
                            ForEach(view.functions, id: \.key) { function in
                                Card {
                                    VStack(alignment: .leading, spacing: 6) {
                                        HStack(alignment: .firstTextBaseline) {
                                            Text(verbatim: function.title.display).font(.headline)
                                            Spacer(minLength: 6)
                                            CellText(function.strength)
                                        }
                                        Text(verbatim: function.text.display).font(.callout).fixedSize(horizontal: false, vertical: true)
                                        ForEach(Array(function.by.enumerated()), id: \.offset) { _, line in LineView(line: line) }
                                        if let action = function.action { ActionButtons(actions: [action]) }
                                    }
                                }
                                .accessibilityElement(children: .contain)
                                .accessibilityIdentifier("bench.function.\(function.key)")
                            }
                        }
                        // The grid of jobs, named for VoiceOver (the audit found the lazy grid's container unnamed)
                        .accessibilityElement(children: .contain)
                        .accessibilityLabel(Text("Bench Jobs"))
                    }
                    ForEach(Array(view.findings.enumerated()), id: \.offset) { _, finding in
                        Label { Text(verbatim: finding.display) } icon: { Image(systemName: "flag").foregroundStyle(.readableSecondary) }
                            .font(.callout)
                    }
                    if let hands = view.hands { Text(verbatim: hands.display).font(.callout).foregroundStyle(.readableSecondary) }
                }
            }
        }
        .loadsMajorLeague(.benchBackups)
    }
}
