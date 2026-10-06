import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

/// Free Agents (N12): who is available now, who reaches the market after this season and who might, each a native table
/// of his production and a season of it at this league's market (never an asking price or an offer). The lists are a
/// segmented control in the window's toolbar, as Calendar's view choice is; the served filters (pitchers or position
/// players, position, age, the club's thin spots) the toolbar's filter, a name the search field. Opens on the list the
/// server serves first. His tools carry the OSA mark when they are OSA's view (D-067).
struct FreeAgentsView: View {
    @Environment(AppModel.self) private var model
    @State private var list: String?
    @State private var chosen: [String: String] = [:]
    @State private var search = ""

    var body: some View {
        let store = model.office
        OfficeState(payload: store.freeAgents, problem: store.problems[OfficeStore.View.freeAgents.rawValue]) { view in
            let current = view.lists.first { $0.id == (list ?? view.opensOn) } ?? view.lists[0]
            let kept = officeRowsKept(current.table, filters: current.filters, chosen: chosen, search: search)
            OfficeTablePane(current.table, id: "freeAgents.\(current.id)", name: current.title.display, kept: kept) {
                VStack(alignment: .leading, spacing: 8) {
                    OfficeHead(title: view.title.display, byline: view.byline, lede: view.lede, freshness: view.freshness,
                               refreshing: model.officeUpdating(.freeAgents))
                    if let needs = view.needs {
                        ClaimText(needs, edge: .bottom) {
                            Text(verbatim: needs.text).font(.callout).lineLimit(2)
                        }
                        .accessibilityIdentifier("freeAgents.needs")
                    }
                    ListChoice(lists: view.lists, current: current.id) { list = $0; chosen = [:] }
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
            .toolbar {
                ToolbarItemGroup(placement: .primaryAction) {
                    OfficeFilterButton(groups: current.filters, chosen: $chosen, id: "freeAgents.filter")
                }
            }
        }
        .searchable(text: $search, placement: .toolbar, prompt: Text("Find a player"))
        .task(id: model.storeKey) { await model.loadOffice() }
    }
}

/// The three lists as a segmented control where there is room, a pop-up menu where there is not; each list's count beside
/// its served title.
struct ListChoice: View {
    let lists: [Components.Schemas.FinanceFreeAgentList]
    let current: String
    let choose: (String) -> Void

    var body: some View {
        let binding = Binding(get: { current }, set: { choose($0) })
        ViewThatFits(in: .horizontal) {
            picker(binding).pickerStyle(.segmented).fixedSize()
            picker(binding).pickerStyle(.menu).fixedSize()
        }
        .accessibilityIdentifier("freeAgents.list")
    }

    private func picker(_ binding: Binding<String>) -> some View {
        Picker(selection: binding) {
            ForEach(lists, id: \.id) { list in
                Text("\(list.title.display) (\(list.count))").tag(list.id)
            }
        } label: {
            Text("Which players")
        }
        .labelsHidden()
    }
}
