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
        Group {
            if let overview = model.majorLeague.overview {
                VStack(alignment: .leading, spacing: 22) {
                    if let fresh = overview.freshness {
                        Label { Text(verbatim: fresh.display) } icon: { ToneMark(served: fresh.tone) }
                            .help(detail: fresh.hint)
                    }
                    Glances(glances: overview.glances)
                    if let philosophy = overview.philosophy { ClaimLine(philosophy, font: .callout) }
                    WhatIfPicker(whatIf: overview.whatIf)
                }
            } else if let problem = model.majorLeague.problems[.overview] {
                ProblemLine(problem)
            }
        }
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
                                    .accessibilityLabel(Text(verbatim: String(count)))
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
            Menu {
                ForEach(whatIf.players, id: \.player.playerId) { choice in
                    Button {
                        if let target = route(choice.open) { opener?.open(target) }
                    } label: {
                        Text(verbatim: choice.role.map { "\(choice.player.name) · \($0.display)" } ?? choice.player.name)
                    }
                }
            } label: {
                Text(verbatim: whatIf.prompt.display)
            }
            .fixedSize()
            .disabled(whatIf.players.isEmpty)
            .accessibilityIdentifier("whatIf")
            Text(verbatim: whatIf.note.display).font(.callout).foregroundStyle(.readableSecondary)
        }
    }
}

// MARK: Position players

/// Position players: the lineup as usage shows it, each regular read against the standard for his job; select a row
/// for what a scout would say.
struct PositionPlayersView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let store = model.majorLeague
        ViewState(payload: store.positionPlayers, problem: store.problems[.positionPlayers]) { view in
            Page {
                ViewHead(title: Text(verbatim: view.title.display), lede: view.lede, yardsticks: view.yardsticks, refreshing: store.loading.contains(.positionPlayers))
                TableWithDetail(table: view.lineup, id: "lineup")
                if let note = view.basisNote {
                    Text(verbatim: note.display).font(.callout).foregroundStyle(.readableSecondary).help(detail: note.hint)
                }
            }
        }
        .loadsMajorLeague(.positionPlayers)
        .accessibilityIdentifier("majorLeague.positionPlayers")
    }
}

// MARK: Pitching staff

/// Pitching staff: the rotation and the bullpen, each its served table; the pen's notes on how it is used above its
/// table and the served note on how a reliever's role is read beneath. The sections are chosen with a segmented control.
struct PitchingStaffView: View {
    @Environment(AppModel.self) private var model
    @State private var section = 0

    var body: some View {
        let store = model.majorLeague
        ViewState(payload: store.pitchingStaff, problem: store.problems[.pitchingStaff]) { view in
            Page {
                ViewHead(title: Text(verbatim: view.title.display), lede: view.lede, yardsticks: view.yardsticks, refreshing: store.loading.contains(.pitchingStaff))
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
                    let shown = view.sections[min(section, view.sections.count - 1)]
                    StaffSectionView(section: shown, id: "pitching.\(min(section, view.sections.count - 1))")
                        .id(section)
                }
            }
        }
        .loadsMajorLeague(.pitchingStaff)
        .accessibilityIdentifier("majorLeague.pitchingStaff")
    }
}

struct StaffSectionView: View {
    let section: Components.Schemas.MlbStaffSection
    let id: String

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
            TableWithDetail(table: section.table, id: id)
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

/// Bench & Backups: what the bench is for (each job, who does it and how well, and the decision that looks for a backup
/// where nobody does), then the bench itself.
struct BenchBackupsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.routeOpener) private var opener

    var body: some View {
        let store = model.majorLeague
        ViewState(payload: store.bench, problem: store.problems[.benchBackups]) { view in
            Page {
                ViewHead(title: Text(verbatim: view.title.display), lede: view.lede, yardsticks: view.yardsticks, refreshing: store.loading.contains(.benchBackups))
                if let empty = view.empty {
                    Text(verbatim: empty.display).foregroundStyle(.readableSecondary)
                }
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
                }
                TableWithDetail(table: view.bench, id: "bench")
                ForEach(Array(view.findings.enumerated()), id: \.offset) { _, finding in
                    Label { Text(verbatim: finding.display) } icon: { Image(systemName: "flag").foregroundStyle(.readableSecondary) }
                        .font(.callout)
                }
                if let hands = view.hands { Text(verbatim: hands.display).font(.callout).foregroundStyle(.readableSecondary) }
            }
        }
        .loadsMajorLeague(.benchBackups)
        .accessibilityIdentifier("majorLeague.benchBackups")
    }
}
