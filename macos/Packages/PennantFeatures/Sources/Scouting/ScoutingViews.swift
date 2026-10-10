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
/// a native table in its stated order (our scouts' grades now and ceiling, the OSA mark where it applies): its top 300 at
/// first, every prospect a served filter keeps or "Show all" asks for; and beneath it the chosen prospect's reasons for
/// his read (read when he is chosen), or the staff's short lists.
public struct DraftBoardView: View {
    @Environment(AppModel.self) private var model
    /// The board asked for: the served filters' keys and whether every prospect.
    @State private var asked = ScoutingStore.BoardQuery()
    /// The prospect chosen on the board, by his player id: his reasons are read then.
    @State private var chosen: Int?

    public init() {}

    public var body: some View {
        let store = model.scouting
        let held = store.board(asked) ?? store.lastBoard
        OfficeState(payload: held, problem: store.problems[ScoutingStore.boardName(asked)]) { view in
            let refreshing = model.scoutingUpdating(ScoutingStore.boardName(asked)) || store.board(asked) == nil
            if view.published, !view.board.rows.isEmpty || view.query.position != "all" || view.query.school != "all" {
                OfficeTablePane(
                    view.board,
                    id: "draftBoard.board",
                    name: view.title.display,
                    detailShare: 0.36,
                    detailOf: { row in
                        // The row's reasons, read when it was chosen
                        guard let id = row.player?.playerId, let read = store.prospects[id], read.row == row.id else { return row }
                        var shown = row
                        shown.detail = read.detail
                        return shown
                    },
                    chose: { id in chosen = view.board.rows.first { $0.id == id }?.player?.playerId }
                ) {
                    VStack(alignment: .leading, spacing: 12) {
                        OfficeHead(title: view.title, lede: view.lede, refreshing: refreshing)
                        if let summary = view.summary { ClaimLine(summary) }
                        ViewThatFits(in: .horizontal) {
                            HStack(alignment: .firstTextBaseline, spacing: 12) { controls(view) }
                            VStack(alignment: .leading, spacing: 8) { controls(view) }
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
        .task(id: BoardTask(key: model.storeKey, query: asked)) { await store.loadDraftBoard(asked, client: model.client, key: model.storeKey) }
        .task(id: ProspectTask(key: model.storeKey, player: chosen)) {
            if let chosen { await store.loadProspect(chosen, client: model.client, key: model.storeKey) }
        }
        .onChange(of: StoreIdentity(model.storeKey)) {
            asked = ScoutingStore.BoardQuery()
            chosen = nil
        }
    }

    /// The served filters (each choice sent back by its key) and, while only the top of the board is shown, its count and
    /// "Show all".
    @ViewBuilder
    private func controls(_ view: Components.Schemas.ScoutingDraftBoardView) -> some View {
        ForEach(view.filters, id: \.id) { filter in
            PopUpChoice(
                verbatim: filter.title.display,
                choices: filter.choices.enumerated().map { .init($0.element.text.display, hint: $0.element.text.hint, selected: $0.offset == (filter.choices.firstIndex(where: \.selected) ?? 0)) },
                id: "draftBoard.filter.\(filter.id)"
            ) { index in
                let value = filter.choices[index].value
                if filter.id == "position" { asked.position = value } else if filter.id == "school" { asked.school = value }
            }
        }
        if let count = view.count {
            Text(verbatim: count.display).foregroundStyle(.readableSecondary).help(detail: count.hint)
                .accessibilityIdentifier("draftBoard.count")
        }
        if let more = view.more {
            Button { asked.all = true } label: { Text(verbatim: more.text.display) }
                .help(detail: more.text.hint)
                .accessibilityIdentifier("draftBoard.more")
        }
    }
}

private struct BoardTask: Hashable {
    let key: AppModel.StoreKey?
    let query: ScoutingStore.BoardQuery
}

private struct ProspectTask: Hashable {
    let key: AppModel.StoreKey?
    let player: Int?
}

/// A store key's save and club, without its stamps: what changes the choices a view can make.
private struct StoreIdentity: Equatable {
    let saveId: String?
    let club: ClubRef?

    init(_ key: AppModel.StoreKey?) {
        saveId = key?.saveId
        club = key?.club
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

/// Player Search: the window's own search field, scoped to Player Search while it is shown (as Finder's search scopes
/// to the folder shown), with the served tokens (a position, a level, a club, an age, a hand, free agents) suggested as
/// the GM types and kept as tokens, one of each kind; batters or pitchers chosen above the results; the results a native
/// table whose rows open their players and compare several. Asked again a moment after the GM stops typing. A column
/// clicked sorts every match on the server (the React page's whole-league sort), and the next 300 are a click away,
/// appended in the served order.
public struct PlayerSearchView: View {
    @Environment(AppModel.self) private var model
    /// The palette's "in Player Search" result opens the view on the words typed there (its route's `key`).
    @Environment(\.currentRoute) private var currentRoute
    /// The window's search field; nil outside a main window (a snapshot), where the view shows what it opens on.
    @Environment(\.windowSearch) private var search
    /// Batters or pitchers: the served group choice's value, sent with the field's tokens (nil: as the server opens).
    @State private var group: String?
    /// The column the server sorts every match by, as the table's header chose it (nil: its own order).
    @State private var sort: OfficeSort?
    @State private var asked = ScoutingStore.SearchQuery()

    public init() {}

    private var text: String { search?.text ?? "" }
    private var tokens: [ScopedSearchToken] { search?.tokens ?? [] }

    public var body: some View {
        let store = model.scouting
        let query = ScoutingStore.SearchQuery(
            q: text,
            tokens: tokens.map(\.id) + (group.map { [$0] } ?? []),
            sort: sort?.column,
            dir: sort?.order == .forward ? "asc" : "desc"
        ).normalized
        let held = store.search(query) ?? store.lastSearch
        OfficeState(payload: held, problem: store.problems[ScoutingStore.searchName(asked)]) { view in
            let refreshing = model.scoutingUpdating(ScoutingStore.searchName(asked)) || store.search(query) == nil
            // Every page read, as one table in the served order; the latest page's count and what asks for more
            let results = store.search(query).flatMap { _ in store.searchResults(query) } ?? view.results
            let latest = store.search(query).flatMap { _ in store.lastPage(query) } ?? view
            OfficeTablePane(results, id: "playerSearch.results.\(groupId(view))", name: view.title.display, detailShare: 0.26, serverSort: $sort) {
                VStack(alignment: .leading, spacing: 12) {
                    OfficeHead(title: view.title, lede: view.lede, refreshing: refreshing)
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        if !view.group.choices.isEmpty {
                            Picker(selection: Binding { groupId(view) } set: { group = $0 }) {
                                ForEach(view.group.choices, id: \.value) { Text(verbatim: $0.text.display).tag($0.value) }
                            } label: {
                                Text(verbatim: view.group.title.display)
                            }
                            .pickerStyle(.segmented)
                            .labelsHidden()
                            .fixedSize()
                            .accessibilityIdentifier("playerSearch.group")
                        }
                        Text(verbatim: latest.count.display).foregroundStyle(.readableSecondary).help(detail: latest.count.hint)
                            .accessibilityIdentifier("playerSearch.count")
                        if let more = latest.more, let offset = Int(more.value) {
                            Button {
                                Task { await store.loadMore(query, offset: offset, client: model.client, key: model.storeKey) }
                            } label: {
                                Text(verbatim: more.text.display)
                            }
                            .help(detail: more.text.hint)
                            .disabled(store.loading.contains { $0.hasSuffix("@\(offset)") })
                            .accessibilityIdentifier("playerSearch.more")
                        }
                    }
                }
            } notes: {
                if view.results.rows.isEmpty, let empty = view.empty {
                    Text(verbatim: empty.display).foregroundStyle(.readableSecondary).help(detail: empty.hint)
                }
            }
            .onChange(of: groupId(view)) { sort = nil }
            .onChange(of: Suggesting(text: text, tokens: tokens.map(\.id), offered: view.kinds.count), initial: true) {
                search?.suggested = Self.suggestions(view, typed: text, chosen: tokens)
            }
        }
        .onAppear { search?.scope = "Search Players" }
        .onDisappear { search?.unscope() }
        .onChange(of: tokens) { _, now in
            let kept = Self.oneOfEachKind(now)
            if kept != now { search?.tokens = kept }
        }
        .onChange(of: currentRoute?.key, initial: true) { _, key in
            if let key, !key.isEmpty { search?.text = key }
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
    static func suggestions(_ view: Components.Schemas.ScoutingPlayerSearchView, typed: String, chosen: [ScopedSearchToken]) -> [ScopedSearchToken] {
        let typed = typed.trimmingCharacters(in: .whitespaces)
        guard !typed.isEmpty else { return [] }
        let ids = Set(chosen.map(\.id))
        return view.kinds.flatMap(\.tokens).map { ScopedSearchToken(id: $0.id, kind: $0.kind, text: $0.text.display) }
            .filter { !ids.contains($0.id) && $0.text.localizedCaseInsensitiveContains(typed) }
            .prefix(12).map { $0 }
    }

    /// The tokens kept: one of each served kind, the latest chosen replacing an earlier one.
    static func oneOfEachKind(_ tokens: [ScopedSearchToken]) -> [ScopedSearchToken] {
        var seen = Set<String>()
        let kept = tokens.reversed().filter { seen.insert($0.kind).inserted }.reversed().map { $0 }
        return kept.count == tokens.count ? tokens : kept
    }

    private func groupId(_ view: Components.Schemas.ScoutingPlayerSearchView) -> String {
        view.group.choices.first(where: \.selected)?.value ?? "all"
    }
}

private struct Suggesting: Equatable {
    let text: String
    let tokens: [String]
    let offered: Int
}

private struct SearchTask: Hashable {
    let key: AppModel.StoreKey?
    let query: ScoutingStore.SearchQuery
}
