import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

/// Schedule & Game Plans (N9): the season's games in a native table (the served filters: the full season, still to
/// play, played), opening on the next game, and the chosen game's plan beneath it in its own pane, as Mail shows a
/// message under its list: their starter, our card against his hand, how our hitters have fared against him and his
/// club, and their dangerous bats. A plan is read when its game is chosen (the next games' are ready on the server).
/// Opened from Tonight or a game on the desk, it opens on that game.
struct ScheduleView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.currentRoute) private var currentRoute
    @State private var filter: Int?
    @State private var section = 0
    @State private var selection: ServedRow.ID?

    var body: some View {
        let store = model.clubhouse
        ViewState(payload: store.schedule, problem: store.problems["schedule"]) { view in
            let opened = currentRoute?.key.map { "game-\($0)" }
            let initial = opened ?? view.nextRow
            let sections = [view.games] + (view.headToHead.map { [$0] } ?? [])
            let index = min(section, sections.count - 1)
            let shown = sections[index]
            let isGames = shown.id == view.games.id
            // Opened on the games still to play (the next one first), or on the filter that holds the game it was opened
            // on (a game just played is at the top of Played, the latest first): the game is in view with no scrolling
            let opensOn = opened.flatMap { id in [1, 2].first { view.filters.indices.contains($0) && view.filters[$0].rows.contains(id) } }
                ?? [1, 2].first { view.filters.indices.contains($0) && !view.filters[$0].rows.isEmpty } ?? 0
            let chosen = min(filter ?? opensOn, max(view.filters.count - 1, 0))
            let byId = Dictionary(shown.table.rows.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
            let table = Components.Schemas.MlbTable(
                columns: shown.table.columns,
                // The filter's rows in its own served order
                rows: isGames && view.filters.indices.contains(chosen) ? view.filters[chosen].rows.compactMap { byId[$0] } : shown.table.rows,
                empty: shown.table.empty
            )
            TablePane(detailShare: isGames ? 0.5 : 0.3) {
                VStack(alignment: .leading, spacing: 12) {
                    ViewHead(title: Text(verbatim: view.title.display), lede: view.lede, yardsticks: nil, refreshing: model.clubhouseUpdating("schedule"))
                    FiguresStrip(figures: view.record)
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        if sections.count > 1 {
                            SectionChoice(titles: sections.map(\.title.display), selection: $section, id: "schedule.sections")
                        }
                        if isGames, view.filters.count > 1 {
                            SectionChoice(titles: view.filters.map(\.text.display), selection: Binding(get: { chosen }, set: { filter = $0 }), id: "schedule.filters")
                        }
                    }
                    SectionSummary(summary: shown.summary)
                    if let empty = view.empty { Text(verbatim: empty.display).foregroundStyle(.readableSecondary) }
                }
            } table: {
                ServedTable(table, id: "schedule.\(shown.id)", name: shown.title.display, selection: $selection)
                    .id("\(index)-\(chosen)")
            } detail: {
                VStack(alignment: .leading, spacing: 14) {
                    if isGames, let row = selection.flatMap(gameId) {
                        GamePlanPane(game: row)
                    } else if isGames {
                        Text(verbatim: view.choose.display).font(.callout).foregroundStyle(.readableSecondary)
                    }
                    ClaimLine(view.note, font: .callout)
                }
            }
            .onAppear { if selection == nil { selection = initial } }
            .onChange(of: opened) { _, next in if let next { selection = next; section = 0; filter = nil } }
        }
        .task(id: model.storeKey) { await store.loadSchedule(client: model.client, key: model.storeKey) }
    }

    private func gameId(_ row: String) -> Int? {
        row.hasPrefix("game-") ? Int(row.dropFirst(5)) : nil
    }
}

private struct PlanTask: Hashable {
    let key: AppModel.StoreKey?
    let game: Int
}

/// One game's plan, beneath the schedule: read when the game is chosen.
struct GamePlanPane: View {
    let game: Int
    @Environment(AppModel.self) private var model

    var body: some View {
        let store = model.clubhouse
        let name = ClubhouseStore.planName(game)
        Group {
            if let problem = store.problems[name] {
                ProblemLine(problem)
            } else if let plan = store.plans[game] {
                GamePlanContent(plan: plan, refreshing: model.clubhouseUpdating(name))
            } else {
                ProgressView { Text("Loading") }.controlSize(.small)
            }
        }
        .task(id: PlanTask(key: model.storeKey, game: game)) { await store.loadPlan(game, client: model.client, key: model.storeKey) }
    }
}

/// A plan's served words: the game, their starter, what is missing, our card, and its sections as short grids that
/// stack on a narrow column (never a `Table` inside the pane's scroll view).
struct GamePlanContent: View {
    let plan: Components.Schemas.MlbGamePlanView
    var refreshing = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(verbatim: plan.game.display).font(.title3.weight(.semibold)).accessibilityAddTraits(.isHeader)
                if refreshing { ProgressView { Text("Refreshing") }.controlSize(.small) }
            }
            LineView(line: plan.starter)
            if let missing = plan.missing {
                Text(verbatim: missing.display).font(.callout).foregroundStyle(.readableSecondary).fixedSize(horizontal: false, vertical: true)
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 250), spacing: 14, alignment: .top)], alignment: .leading, spacing: 14) {
                Card { BlockView(plan.card) }
                ForEach(plan.sections, id: \.id) { section in
                    Card { PlanSection(section: section) }
                }
            }
            // Named for VoiceOver (the audit found a lazy grid's container unnamed)
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text("Game Plan"))
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("schedule.plan")
    }
}

/// A plan's section: its served title and its rows as lines of cells, in the served order.
struct PlanSection: View {
    let section: MlbTableSection

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(verbatim: section.title.display).font(.headline).help(detail: section.title.hint).accessibilityAddTraits(.isHeader)
            if section.table.rows.isEmpty, let empty = section.table.empty {
                Text(verbatim: empty.display).font(.callout).foregroundStyle(.readableSecondary)
            }
            Grid(alignment: .leading, horizontalSpacing: 10, verticalSpacing: 4) {
                ForEach(section.table.rows, id: \.id) { row in
                    GridRow {
                        ForEach(section.table.columns, id: \.id) { column in
                            if let cell = row.cells.additionalProperties[column.id] {
                                if column.id == "player", let player = row.player {
                                    PlayerNameText(player: player, font: .callout.weight(.medium))
                                } else {
                                    CellText(cell).font(.callout).monospacedDigit()
                                        .gridColumnAlignment(column.numeric ? .trailing : .leading)
                                }
                            }
                        }
                    }
                    // A row that names a player keeps his name its own element (a button that opens his club)
                    .accessibilityElement(children: .contain)
                }
            }
        }
    }
}
