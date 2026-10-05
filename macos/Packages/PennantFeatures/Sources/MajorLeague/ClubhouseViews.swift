import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

// Major League Ops' clubhouse tools (N9; SWIFTUI_REBUILD.md section 9; D-069): Lineup, Pitching Availability, 40-Man &
// Options and Rosters, each a served payload drawn with N8's pieces (a `TablePane` with a native `Table` over the served
// columns, the selected row's served detail beneath). Every word, tone, order and sort key is the server's; a choice the
// GM makes asks the server again, exactly as the choice was served.

typealias MlbTableSection = Components.Schemas.MlbTableSection

extension AppModel {
    /// Whether a clubhouse tool is drawn as updating (being read again, or built for an earlier key).
    func clubhouseUpdating(_ name: String) -> Bool { clubhouse.updating(name, for: storeKey) }
}

/// A view's served sections as a segmented choice (Bullpen | Rotation, Hitters | Pitchers).
struct SectionChoice: View {
    let titles: [String]
    @Binding var selection: Int
    let id: String

    var body: some View {
        Picker(selection: $selection) {
            ForEach(Array(titles.enumerated()), id: \.offset) { index, title in Text(verbatim: title).tag(index) }
        } label: {
            Text("Section")
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .fixedSize()
        .accessibilityIdentifier(id)
    }
}

/// Served figures: in a row of box figures where there is room, a list of their lines where there is not.
struct FiguresStrip: View {
    let figures: [Components.Schemas.Claim]

    var body: some View {
        if !figures.isEmpty {
            ViewThatFits(in: .horizontal) {
                ReportFigures(figures: figures)
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(Array(figures.enumerated()), id: \.offset) { _, figure in
                        ClaimText(figure) {
                            HStack(alignment: .firstTextBaseline, spacing: 6) {
                                Text(verbatim: figure.text).foregroundStyle(.readableSecondary)
                                Text(verbatim: figure.value?.display ?? "").font(.headline).monospacedDigit()
                            }
                        }
                    }
                }
            }
        }
    }
}

/// A section's served summary line, in its tone.
struct SectionSummary: View {
    let summary: MlbCell?

    var body: some View {
        if let summary {
            Label { Text(verbatim: summary.display) } icon: { ToneMark(served: summary.tone) }
                .font(.callout)
                .help(detail: summary.hint)
        }
    }
}

/// A served choice among several (one of the organization's clubs): a button that opens the choices in a popover,
/// each a button (N8's what-if pattern: a pop-up `Picker` was found by the audit with no action to press).
struct ChoicePopover: View {
    let current: String
    let choices: [(text: String, hint: String?, selected: Bool)]
    let id: String
    let choose: (Int) -> Void
    @State private var open = false

    var body: some View {
        Button {
            open = true
        } label: {
            Label { Text(verbatim: current) } icon: { Image(systemName: "chevron.down") }
                .labelStyle(.titleAndIcon)
        }
        .popover(isPresented: $open, arrowEdge: .bottom) {
            ScrollView {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(Array(choices.enumerated()), id: \.offset) { index, choice in
                        Button {
                            open = false
                            choose(index)
                        } label: {
                            HStack(spacing: 6) {
                                Image(systemName: "checkmark").opacity(choice.selected ? 1 : 0).accessibilityHidden(true)
                                Text(verbatim: choice.text)
                                if let hint = choice.hint { Text(verbatim: hint).foregroundStyle(.readableSecondary) }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                        .padding(.horizontal, 10).padding(.vertical, 4)
                        .accessibilityAddTraits(choice.selected ? .isSelected : [])
                        .accessibilityIdentifier("\(id).\(index)")
                    }
                }
                .padding(.vertical, 6)
            }
            .frame(minWidth: 240, maxHeight: 360)
            .background(Color.readablePage)
        }
        .fixedSize()
        .accessibilityIdentifier(id)
    }
}

// MARK: Lineup

/// The view's ask and the window's key, as one task id: a new choice or a new import reads again.
private struct LineupTask: Hashable {
    let key: AppModel.StoreKey?
    let query: ClubhouseStore.LineupQuery?
}

/// Lineup: the staff's card for the next game. The GM's choices (the opposing hand, the ordering, what it is built from,
/// the DH) ask the server for that card; the card shown stays, drawn as updating, until it lands. Pennant never writes a
/// card to OOTP: it is the staff's view.
///
/// The choices are the window's toolbar, as Calendar's view choice and Finder's group and sort are (N9 review, M1): the
/// opposing hand, the one asked most, a segmented control; the rest a "Card" pull-down with each group inline, checked.
/// The head keeps the title, the lede and the staff's view in one line (its basis a click away), so at 900 pt the table
/// keeps its height; the next game and the card's notes are in the pane beneath the table.
struct LineupView: View {
    @Environment(AppModel.self) private var model
    @State private var query: ClubhouseStore.LineupQuery?

    var body: some View {
        let store = model.clubhouse
        let name = ClubhouseStore.lineupName(query)
        let shown = store.lineup(query) ?? store.lineup(nil)
        ViewState(payload: shown, problem: store.problems[name]) { view in
            ServedTablePane(view.order, id: "lineup.order", name: view.title.display, detailShare: 0.38) {
                LineupHead(view: view, refreshing: model.clubhouseUpdating(name) || store.lineup(query) == nil)
            } notes: {
                LineupNotes(view: view) { query = .init($0) }
            }
        }
        .toolbar {
            if let shown { LineupChoices(view: shown) { query = .init($0) } }
        }
        .task(id: LineupTask(key: model.storeKey, query: query)) {
            await store.loadLineup(query, client: model.client, key: model.storeKey)
        }
    }
}

/// The card's head: the title, the lede and the staff's view of the card in one line, its basis a click away.
struct LineupHead: View {
    let view: Components.Schemas.MlbLineupView
    let refreshing: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ViewHead(title: Text(verbatim: view.title.display), lede: view.lede, yardsticks: nil, refreshing: refreshing)
            if let headline = view.headline {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    ToneMark(served: headline.tone)
                    ClaimText(headline, edge: .trailing) {
                        Text(verbatim: headline.text).font(.headline).lineLimit(1).truncationMode(.tail)
                    }
                }
                .help(detail: headline.text)
                .accessibilityIdentifier("lineup.headline")
            }
            if let empty = view.empty { Text(verbatim: empty.display).foregroundStyle(.readableSecondary) }
        }
    }
}

/// The GM's choices in the window's toolbar: the opposing hand as a segmented control, the other groups in the "Card"
/// pull-down, each inline with its choice checked. Choosing one asks the server for that card.
struct LineupChoices: ToolbarContent {
    let view: Components.Schemas.MlbLineupView
    let choose: (Components.Schemas.MlbLineupQuery) -> Void

    var body: some ToolbarContent {
        ToolbarItemGroup(placement: .primaryAction) {
            if let hand = view.choices.first {
                ChoicePicker(group: hand, id: "lineup.choice.0", choose: choose).pickerStyle(.segmented)
            }
            if view.choices.count > 1 {
                Menu {
                    ForEach(Array(view.choices.enumerated().dropFirst()), id: \.offset) { index, group in
                        ChoicePicker(group: group, id: "lineup.choice.\(index)", choose: choose).pickerStyle(.inline)
                    }
                } label: {
                    Label("Card", systemImage: "slider.horizontal.3")
                }
                .help(Text("Card"))
                .accessibilityIdentifier("lineup.card")
            }
        }
    }
}

/// One group of served choices as a picker (its style the caller's): choosing one asks for its card.
struct ChoicePicker: View {
    let group: Components.Schemas.MlbLineupChoices
    let id: String
    let choose: (Components.Schemas.MlbLineupQuery) -> Void

    var body: some View {
        let selected = group.choices.firstIndex(where: \.selected) ?? 0
        Picker(selection: Binding(get: { selected }, set: { index in
            if group.choices.indices.contains(index), index != selected { choose(group.choices[index].query) }
        })) {
            ForEach(Array(group.choices.enumerated()), id: \.offset) { index, choice in
                Text(verbatim: choice.text.display).help(detail: choice.text.hint).tag(index)
            }
        } label: {
            Text(verbatim: group.title.display)
        }
        .help(detail: group.title.display)
        .accessibilityIdentifier(id)
    }
}

/// Beneath the card: the next game (and the card against its starter's hand), the card's notes, the bench, who is
/// unavailable and who the scouts haven't graded.
struct LineupNotes: View {
    let view: Components.Schemas.MlbLineupView
    let choose: (Components.Schemas.MlbLineupQuery) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if view.tonight != nil || view.againstTonight != nil {
                Card {
                    VStack(alignment: .leading, spacing: 8) {
                        if let tonight = view.tonight { BlockView(tonight) }
                        if let against = view.againstTonight {
                            Button { choose(against.query) } label: {
                                Label { Text(verbatim: against.text.display) } icon: { Image(systemName: "arrow.triangle.2.circlepath") }
                            }
                            .help(detail: against.text.hint)
                            .accessibilityIdentifier("lineup.againstTonight")
                        }
                    }
                }
            }
            ForEach(Array(view.notes.enumerated()), id: \.offset) { _, note in ClaimLine(note, font: .callout) }
            ForEach(Array([view.bench, view.unavailable, view.notScouted].compactMap { $0 }.enumerated()), id: \.offset) { _, block in
                BlockView(block)
            }
        }
    }
}

// MARK: Pitching Availability

/// Pitching Availability: who can pitch tonight. The bullpen as a rest calendar (each of the last five days' pitches,
/// the last three days' load, tonight's availability in its served tone: rested, limited or down), the rotation and the
/// starting depth, each its own section; the selected arm's outing beneath.
struct PitchingAvailabilityView: View {
    @Environment(AppModel.self) private var model
    @State private var section = 0

    var body: some View {
        let store = model.clubhouse
        ViewState(payload: store.pitching, problem: store.problems["pitching"]) { view in
            let index = min(section, max(view.sections.count - 1, 0))
            let head = VStack(alignment: .leading, spacing: 12) {
                ViewHead(title: Text(verbatim: view.title.display), lede: view.lede, yardsticks: nil, refreshing: model.clubhouseUpdating("pitching"))
                if let through = view.through { Text(verbatim: through.display).font(.callout).foregroundStyle(.readableSecondary) }
                if view.sections.count > 1 {
                    SectionChoice(titles: view.sections.map(\.title.display), selection: $section, id: "pitchingAvailability.sections")
                }
                if view.sections.indices.contains(index) { SectionSummary(summary: view.sections[index].summary) }
                if let empty = view.empty { Text(verbatim: empty.display).foregroundStyle(.readableSecondary) }
            }
            if view.sections.indices.contains(index) {
                let shown = view.sections[index]
                ServedTablePane(shown.table, id: "pitchingAvailability.\(shown.id)", name: shown.title.display) {
                    head
                } notes: {
                    if let note = shown.note { ClaimLine(note, font: .callout) }
                }
                .id(index)
            } else {
                head.padding(.horizontal, 28).padding(.vertical, 20)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    .background(Color.readablePage)
            }
        }
        .task(id: model.storeKey) { await store.loadPitching(client: model.client, key: model.storeKey) }
    }
}

// MARK: 40-Man & Options

/// 40-Man & Options: the roster's counts against the league's limits, the players who need attention (a clock running,
/// an option note) and the 40-man, each player's options, Rule 5 standing and what Player Rights says can be done, with
/// every reason in the row's detail. Opened from a desk item, it shows that player.
struct FortyManView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.currentRoute) private var currentRoute
    @State private var section: Int?

    var body: some View {
        let store = model.clubhouse
        ViewState(payload: store.fortyMan, problem: store.problems["fortyMan"]) { view in
            let player = currentRoute?.key
            // A desk item's player: the section that lists him (needs attention first), and his row chosen
            let opened = player.flatMap { id in view.sections.firstIndex { $0.table.rows.contains { $0.id.hasSuffix("-\(id)") } } }
            // Otherwise the first section with anyone in it (nobody needing attention opens on the 40-man)
            let first = view.sections.firstIndex { !$0.table.rows.isEmpty } ?? 0
            let index = min(section ?? opened ?? first, max(view.sections.count - 1, 0))
            let head = VStack(alignment: .leading, spacing: 12) {
                ViewHead(title: Text(verbatim: view.title.display), lede: view.lede, yardsticks: nil, refreshing: model.clubhouseUpdating("fortyMan"))
                FiguresStrip(figures: view.figures)
                if view.sections.count > 1 {
                    SectionChoice(
                        titles: view.sections.map(\.title.display),
                        selection: Binding(get: { index }, set: { section = $0 }),
                        id: "fortyMan.sections"
                    )
                }
                if view.sections.indices.contains(index) { SectionSummary(summary: view.sections[index].summary) }
                if let empty = view.empty { Text(verbatim: empty.display).foregroundStyle(.readableSecondary) }
            }
            if view.sections.indices.contains(index) {
                let shown = view.sections[index]
                let selected = player.flatMap { id in shown.table.rows.first { $0.id.hasSuffix("-\(id)") }?.id }
                ServedTablePane(shown.table, id: "fortyMan.\(shown.id)", name: shown.title.display, detailShare: 0.45, selected: selected) {
                    head
                } notes: {
                    if let note = shown.note { ClaimLine(note, font: .callout) }
                }
                .id("\(index)-\(player ?? "")")
            } else {
                head.padding(.horizontal, 28).padding(.vertical, 20)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    .background(Color.readablePage)
            }
        }
        .task(id: model.storeKey) { await store.loadFortyMan(client: model.client, key: model.storeKey) }
    }
}

// MARK: Rosters

private struct RosterTask: Hashable {
    let key: AppModel.StoreKey?
    let team: Int?
}

/// Rosters: any of the organization's clubs, its hitters and its pitchers, with the scouts' grades and the season's
/// lines. The React page's column picker is the table's own: every season line is a column, the usual ones shown, the
/// rest shown or hidden from the table header's menu, and the window remembers which.
struct RostersView: View {
    @Environment(AppModel.self) private var model
    @State private var team: Int?
    @State private var section = 0

    var body: some View {
        let store = model.clubhouse
        let name = ClubhouseStore.rosterName(team)
        ViewState(payload: store.roster(team) ?? store.roster(nil), problem: store.problems[name]) { view in
            let index = min(section, max(view.sections.count - 1, 0))
            let clubs = view.clubs
            let current = clubs.first(where: \.selected)?.text.display ?? clubs.first?.text.display ?? ""
            let head = VStack(alignment: .leading, spacing: 12) {
                ViewHead(title: Text(verbatim: view.title.display), lede: view.lede, yardsticks: nil, refreshing: model.clubhouseUpdating(name) || store.roster(team) == nil)
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    if clubs.count > 1 {
                        ChoicePopover(
                            current: current,
                            choices: clubs.map { ($0.text.display, $0.text.hint, $0.selected) },
                            id: "rosters.club"
                        ) { team = clubs[$0].query.team }
                    }
                    if view.sections.count > 1 {
                        SectionChoice(titles: view.sections.map(\.title.display), selection: $section, id: "rosters.sections")
                    }
                }
                if let empty = view.empty { Text(verbatim: empty.display).foregroundStyle(.readableSecondary) }
            }
            if view.sections.indices.contains(index) {
                let shown = view.sections[index]
                ServedTablePane(shown.table, id: "rosters.\(shown.id)", name: shown.title.display) {
                    head
                } notes: {
                    if let note = shown.note { ClaimLine(note, font: .callout) }
                }
                .id("\(view.query.team)-\(index)")
            } else {
                head.padding(.horizontal, 28).padding(.vertical, 20)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    .background(Color.readablePage)
            }
        }
        .task(id: RosterTask(key: model.storeKey, team: team)) { await store.loadRoster(team, client: model.client, key: model.storeKey) }
    }
}
