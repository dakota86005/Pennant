import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

// Scouting's views (N12 Track B, D-072): the Draft Board and Player Search. Each draws its served payload and nothing
// more: the served order, words, tones, grades with their OSA mark, tokens and sort keys.

extension AppModel {
    func scoutingUpdating(_ name: String) -> Bool { scouting.updating(name, for: storeKey) }
}

// MARK: Draft Board

/// The Draft Board: before OOTP publishes the class, its one sentence and the calendar; once it has, the staff's board as
/// a native table in its stated order (our scouts' grades now and ceiling, the OSA mark where it applies), its served
/// filters, and beneath it the chosen prospect's read, or the staff's short lists.
public struct DraftBoardView: View {
    @Environment(AppModel.self) private var model
    /// The choice of each served filter, by the filter's id (the first choice keeps every row).
    @State private var filters: [String: Int] = [:]

    public init() {}

    public var body: some View {
        let store = model.scouting
        OfficeState(payload: store.draftBoard, problem: store.problems["draftBoard"]) { view in
            let refreshing = model.scoutingUpdating("draftBoard")
            if view.published, !view.board.rows.isEmpty {
                OfficeTablePane(view.board, id: "draftBoard.board", name: view.title.display, only: kept(view), detailShare: 0.36) {
                    VStack(alignment: .leading, spacing: 12) {
                        OfficeHead(title: view.title, lede: view.lede, refreshing: refreshing)
                        if let summary = view.summary { ClaimLine(summary) }
                        ViewThatFits(in: .horizontal) {
                            HStack(alignment: .firstTextBaseline, spacing: 12) { filterMenus(view) }
                            VStack(alignment: .leading, spacing: 8) { filterMenus(view) }
                        }
                    }
                } notes: {
                    ForEach(Array(view.shortLists.enumerated()), id: \.offset) { _, block in OfficeBlock(block) }
                    if let leftOut = view.leftOut {
                        Text(verbatim: leftOut.display).font(.callout).foregroundStyle(.readableSecondary).help(detail: leftOut.hint)
                    }
                }
            } else {
                OfficePage {
                    OfficeHead(title: view.title, lede: view.lede, refreshing: refreshing)
                    if let notShown = view.notShown ?? view.empty ?? view.board.empty {
                        Text(verbatim: notShown.display).font(.title3).help(detail: notShown.hint)
                            .accessibilityIdentifier("draftBoard.notShown")
                    }
                    if let summary = view.summary { ClaimLine(summary) }
                    if let calendar = view.calendar, !calendar.rows.isEmpty { CalendarGrid(table: calendar) }
                    if let leftOut = view.leftOut {
                        Text(verbatim: leftOut.display).font(.callout).foregroundStyle(.readableSecondary).help(detail: leftOut.hint)
                    }
                }
            }
        }
        .task(id: model.storeKey) { await store.loadDraftBoard(client: model.client, key: model.storeKey) }
    }

    @ViewBuilder
    private func filterMenus(_ view: Components.Schemas.ScoutingDraftBoardView) -> some View {
        ForEach(view.filters, id: \.id) { filter in
            let current = min(filters[filter.id] ?? 0, max(filter.choices.count - 1, 0))
            OfficeChoiceMenu(
                LocalizedStringKey(filter.title.display),
                choices: filter.choices.enumerated().map { ($0.element.text.display, $0.element.text.hint, $0.offset == current) },
                id: "draftBoard.filter.\(filter.id)"
            ) { filters[filter.id] = $0 }
        }
    }

    /// The rows every chosen filter keeps (each served with its rows); nil when no filter narrows the board.
    private func kept(_ view: Components.Schemas.ScoutingDraftBoardView) -> Set<String>? {
        var kept: Set<String>?
        for filter in view.filters {
            let index = filters[filter.id] ?? 0
            guard index > 0, filter.choices.indices.contains(index) else { continue }
            let rows = Set(filter.choices[index].rows)
            kept = kept.map { $0.intersection(rows) } ?? rows
        }
        return kept
    }
}

/// A short served table drawn as a grid on a page (the draft's calendar: a few lines, never a scrolling table inside a
/// page): each column's title over its cells.
private struct CalendarGrid: View {
    let table: Components.Schemas.OfficeTable

    var body: some View {
        Grid(alignment: .leading, horizontalSpacing: 18, verticalSpacing: 6) {
            GridRow {
                ForEach(table.columns, id: \.id) { column in
                    Text(verbatim: column.title.display).font(.callout.weight(.semibold)).foregroundStyle(.readableSecondary)
                        .help(detail: column.title.hint)
                }
            }
            ForEach(table.rows, id: \.id) { row in
                GridRow {
                    ForEach(table.columns, id: \.id) { column in
                        if let cell = row.cells.additionalProperties[column.id] { OfficeCell(cell) } else { Text(verbatim: "") }
                    }
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("draftBoard.calendar")
    }
}

// MARK: Player Search

/// A served token as the search field holds it.
struct SearchToken: Identifiable, Hashable {
    let id: String
    let kind: String
    let text: String

    init(_ served: Components.Schemas.ScoutingSearchToken) {
        id = served.id
        kind = served.kind
        text = served.text.display
    }
}

/// Player Search: the toolbar's search field, with the served tokens (a position, a level, a club, an age, a hand, free
/// agents) suggested as the GM types and kept as tokens; batters or pitchers chosen above the results; the results a
/// native table whose rows open their players and compare several. Asked again a moment after the GM stops typing.
public struct PlayerSearchView: View {
    @Environment(AppModel.self) private var model
    /// The palette's "in Player Search" result opens the view on the words typed there (its route's `key`).
    @Environment(\.currentRoute) private var currentRoute
    @State private var text = ""
    @State private var tokens: [SearchToken] = []
    /// Batters or pitchers: the served group choice's value, sent with the field's tokens (nil: as the server opens).
    @State private var group: String?
    @State private var asked = ScoutingStore.SearchQuery()

    public init() {}

    public var body: some View {
        let store = model.scouting
        let query = ScoutingStore.SearchQuery(q: text, tokens: tokens.map(\.id) + (group.map { [$0] } ?? [])).normalized
        let held = store.search(query) ?? store.lastSearch
        OfficeState(payload: held, problem: store.problems[ScoutingStore.searchName(asked)]) { view in
            let refreshing = model.scoutingUpdating(ScoutingStore.searchName(asked)) || store.search(query) == nil
            OfficeTablePane(view.results, id: "playerSearch.results.\(groupId(view))", name: view.title.display, detailShare: 0.26) {
                VStack(alignment: .leading, spacing: 12) {
                    OfficeHead(title: view.title, lede: view.lede, refreshing: refreshing)
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        if !view.group.choices.isEmpty {
                            Picker(selection: groupBinding(view)) {
                                ForEach(view.group.choices, id: \.value) { Text(verbatim: $0.text.display).tag($0.value) }
                            } label: {
                                Text(verbatim: view.group.title.display)
                            }
                            .pickerStyle(.segmented)
                            .labelsHidden()
                            .fixedSize()
                            .accessibilityIdentifier("playerSearch.group")
                        }
                        Text(verbatim: view.count.display).foregroundStyle(.readableSecondary).help(detail: view.count.hint)
                            .accessibilityIdentifier("playerSearch.count")
                    }
                }
            } notes: {
                if view.results.rows.isEmpty, let empty = view.empty {
                    Text(verbatim: empty.display).foregroundStyle(.readableSecondary).help(detail: empty.hint)
                }
            }
            .searchable(text: $text, tokens: $tokens, placement: .toolbar, prompt: Text("Name, position, level, club…")) { token in
                Text(verbatim: token.text)
            }
            .searchSuggestions {
                ForEach(suggestions(view), id: \.id) { token in
                    Text(verbatim: token.text).searchCompletion(token)
                }
            }
            .onChange(of: tokens) { _, now in tokens = Self.oneOfEachKind(now) }
        }
        .onChange(of: currentRoute?.key, initial: true) { _, key in
            if let key, !key.isEmpty { text = key }
        }
        .task(id: SearchTask(key: model.storeKey, query: query)) {
            // A moment after the typing stops (a token or a group is asked at once); a newer ask calls this one off
            if query.q != asked.q { try? await Task.sleep(for: .milliseconds(250)) }
            guard !Task.isCancelled else { return }
            asked = query
            await store.loadSearch(query, client: model.client, key: model.storeKey)
        }
    }

    /// The tokens the field suggests for what is typed: the served tokens whose words contain it, not already chosen.
    private func suggestions(_ view: Components.Schemas.ScoutingPlayerSearchView) -> [SearchToken] {
        let typed = text.trimmingCharacters(in: .whitespaces)
        guard !typed.isEmpty else { return [] }
        let chosen = Set(tokens.map(\.id))
        return view.kinds.flatMap(\.tokens).map(SearchToken.init)
            .filter { !chosen.contains($0.id) && $0.text.localizedCaseInsensitiveContains(typed) }
            .prefix(12).map { $0 }
    }

    /// The tokens kept: one of each served kind, the latest chosen replacing an earlier one.
    static func oneOfEachKind(_ tokens: [SearchToken]) -> [SearchToken] {
        var seen = Set<String>()
        let kept = tokens.reversed().filter { seen.insert($0.kind).inserted }.reversed().map { $0 }
        return kept.count == tokens.count ? tokens : kept
    }

    private func groupId(_ view: Components.Schemas.ScoutingPlayerSearchView) -> String {
        view.group.choices.first(where: \.selected)?.value ?? "all"
    }

    /// Batters or pitchers: the served group's choice, sent back as served.
    private func groupBinding(_ view: Components.Schemas.ScoutingPlayerSearchView) -> Binding<String> {
        Binding { groupId(view) } set: { group = $0 }
    }
}

private struct SearchTask: Hashable {
    let key: AppModel.StoreKey?
    let query: ScoutingStore.SearchQuery
}
