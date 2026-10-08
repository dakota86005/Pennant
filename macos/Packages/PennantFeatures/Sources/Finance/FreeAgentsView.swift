import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

/// Free Agents (N12): who is available now, who reaches the market after this season and who might, each a native table
/// of his production and a season of it at this league's market (never an asking price or an offer). The lists are a
/// segmented control in the view's head (a button and popover where it is narrow); the served filters (pitchers or
/// position players, position, age, the club's thin spots) are choices beneath it, and a name the window's search field,
/// scoped to the view. Opens on
/// the list the server serves first. His tools carry the OSA mark when they are OSA's view (D-067). A chosen row's facts
/// and claims are read when he is chosen: the lists carry only what the table shows.
struct FreeAgentsView: View {
    @Environment(AppModel.self) private var model
    @State private var list: String?
    @State private var chosen: [String: String] = [:]
    /// The window's one search field, scoped to this view while it is shown (as Finder's searches the folder shown).
    @Environment(\.windowSearch) private var search

    var body: some View {
        let store = model.office
        OfficeState(payload: store.freeAgents, problem: store.problems[OfficeStore.View.freeAgents.rawValue]) { view in
            let current = view.lists.first { $0.id == (list ?? view.opensOn) } ?? view.lists[0]
            let kept = officeRowsKept(current.table, filters: current.filters, chosen: chosen, search: search?.text ?? "")
            OfficeTablePane(
                current.table, id: "freeAgents.\(current.id)", name: current.title.display, only: kept,
                detailOf: { row in
                    guard let id = row.player?.playerId, let detail = store.freeAgentDetails[id] else { return row }
                    var full = row
                    full.facts = detail.facts
                    full.claims = detail.claims
                    return full
                },
                chose: { rowId in
                    guard let id = current.table.rows.first(where: { $0.id == rowId })?.player?.playerId else { return }
                    Task { await model.loadFreeAgentDetail(id) }
                }
            ) {
                VStack(alignment: .leading, spacing: 8) {
                    OfficeHead(title: view.title, byline: view.byline, parts: view.bylineParts, lede: view.lede, freshness: view.freshness,
                               refreshing: model.officeUpdating(.freeAgents))
                    if let needs = view.needs {
                        ClaimText(needs, edge: .bottom) {
                            Text(verbatim: needs.text).font(.callout).lineLimit(2)
                        }
                        .accessibilityIdentifier("freeAgents.needs")
                    }
                    ListChoice(lists: view.lists, current: current.id) { list = $0; chosen = [:] }
                    OfficeFilterChoices(groups: current.filters, chosen: $chosen, id: "freeAgents.filter")
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        ClaimText(current.explain, edge: .bottom) {
                            Text(verbatim: current.explain.text).font(.headline)
                        }
                        if let note = current.note {
                            Text(verbatim: note.display).font(.callout).foregroundStyle(.readableSecondary).help(detail: note.hint)
                        }
                        ShownCount(shown: kept?.count ?? current.table.rows.count, of: current.table.rows.count)
                    }
                }
            } notes: {
                VStack(alignment: .leading, spacing: 12) {
                    if let order = current.order { Text(verbatim: order.display).font(.callout).foregroundStyle(.readableSecondary) }
                    OfficeFigures(view.cards)
                    if let price = view.price { ClaimLine(price, font: .callout) }
                }
            }
        }
        .onAppear { search?.scope = "Find a Player" }
        .onDisappear { search?.unscope() }
        .task(id: model.storeKey) { await model.loadOffice() }
    }
}

/// The three lists as a segmented control where there is room; where there is not, the one way Pennant offers one choice
/// among a few (`PopUpChoice`): the pop-up button naming the list shown, its menu the three. Each list's count beside its
/// served title.
struct ListChoice: View {
    let lists: [Components.Schemas.FinanceFreeAgentList]
    let current: String
    let choose: (String) -> Void

    var body: some View {
        ViewThatFits(in: .horizontal) {
            Picker(selection: Binding(get: { current }, set: { choose($0) })) {
                ForEach(lists, id: \.id) { list in
                    Text("\(list.title.display) (\(list.count))").tag(list.id)
                }
            } label: {
                Text("Which players")
            }
            .labelsHidden()
            .pickerStyle(.segmented)
            .fixedSize()
            .accessibilityIdentifier("freeAgents.list")
            PopUpChoice(
                title: "Which players",
                choices: lists.map { .init(String(localized: "\($0.title.display) (\($0.count))"), selected: $0.id == current) },
                id: "freeAgents.list"
            ) { index in
                choose(lists[index].id)
            }
            .fixedSize()
        }
    }
}
