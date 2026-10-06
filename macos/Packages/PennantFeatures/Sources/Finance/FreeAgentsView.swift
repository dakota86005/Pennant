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
                    OfficeHead(title: view.title.display, byline: view.byline, parts: view.bylineParts, lede: view.lede, freshness: view.freshness,
                               refreshing: model.officeUpdating(.freeAgents))
                    if let needs = view.needs {
                        ClaimText(needs, edge: .bottom) {
                            Text(verbatim: needs.text).font(.callout).lineLimit(2)
                        }
                        .accessibilityIdentifier("freeAgents.needs")
                    }
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: 12) {
                            ListChoice(lists: view.lists, current: current.id) { list = $0; chosen = [:] }
                            OfficeFindField(text: $search, id: "freeAgents.find")
                        }
                        VStack(alignment: .leading, spacing: 6) {
                            ListChoice(lists: view.lists, current: current.id) { list = $0; chosen = [:] }
                            OfficeFindField(text: $search, id: "freeAgents.find")
                        }
                    }
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
        .task(id: model.storeKey) { await model.loadOffice() }
    }
}

/// The three lists as a segmented control where there is room; where there is not, a button naming the list shown that
/// opens the three in a popover, each a button (N8's choice pattern: a pop-up menu was found by the audit with no action
/// to press). Each list's count beside its served title.
struct ListChoice: View {
    let lists: [Components.Schemas.FinanceFreeAgentList]
    let current: String
    let choose: (String) -> Void
    @State private var open = false

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
            narrow
        }
    }

    private var narrow: some View {
        let shown = lists.first { $0.id == current }
        let title = shown?.title.display ?? ""
        let count = shown?.count ?? 0
        return Button { open = true } label: {
            Label {
                Text("\(title) (\(count))")
            } icon: {
                Image(systemName: "chevron.down")
            }
            .labelStyle(.titleAndIcon)
        }
        .accessibilityLabel(Text("Which players"))
        .accessibilityValue(Text(verbatim: title))
        .accessibilityIdentifier("freeAgents.list")
        .popover(isPresented: $open, arrowEdge: .bottom) {
            VStack(alignment: .leading, spacing: 2) {
                ForEach(Array(lists.enumerated()), id: \.element.id) { index, list in
                    Button {
                        open = false
                        choose(list.id)
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "checkmark").opacity(list.id == current ? 1 : 0).accessibilityHidden(true)
                            Text("\(list.title.display) (\(list.count))")
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .padding(.horizontal, 10).padding(.vertical, 4)
                    .accessibilityAddTraits(list.id == current ? .isSelected : [])
                    .accessibilityIdentifier("freeAgents.list.\(index)")
                }
            }
            .padding(.vertical, 6)
            .frame(minWidth: 240, alignment: .leading)
            .background(Color.readablePage)
        }
        .fixedSize()
    }
}
