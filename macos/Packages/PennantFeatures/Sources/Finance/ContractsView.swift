import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

/// Contracts (N12): what each deal costs, how long the club controls him and what he's worth, as a native table in a
/// `TablePane`. The served groups (free agents after this season, options, arbitration, ...) and all players or pitchers
/// are the toolbar's filter, the GM's search words find a name; the club's figures and the price of a win sit beneath the
/// table while no row is chosen, and a chosen row shows his seasons under control and what his figures rest on. Value
/// describes, never authorizes: no row says what to do (D-052).
struct ContractsView: View {
    @Environment(AppModel.self) private var model
    @State private var chosen: [String: String] = [:]
    @State private var search = ""

    var body: some View {
        let store = model.office
        OfficeState(payload: store.contracts, problem: store.problems[OfficeStore.View.contracts.rawValue]) { view in
            let kept = officeRowsKept(view.table, filters: view.filters, chosen: chosen, search: search)
            OfficeTablePane(view.table, id: "contracts", name: view.title.display, kept: kept) {
                VStack(alignment: .leading, spacing: 8) {
                    OfficeHead(title: view.title.display, byline: view.byline, lede: view.lede, freshness: view.freshness,
                               refreshing: model.officeUpdating(.contracts))
                    ShownCount(shown: kept?.count ?? view.table.rows.count, of: view.table.rows.count)
                }
            } notes: {
                VStack(alignment: .leading, spacing: 12) {
                    Text(verbatim: view.heading.display).font(.headline)
                    OfficeFigures(view.cards)
                    if let price = view.price { ClaimLine(price, font: .callout) }
                }
            }
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    OfficeFilterButton(groups: view.filters, chosen: $chosen, id: "contracts.filter")
                }
            }
        }
        .searchable(text: $search, placement: .toolbar, prompt: Text("Find a player"))
        .task(id: model.storeKey) { await model.loadOffice() }
    }
}

/// "12 of 31": how many rows the filters keep, when they keep fewer than all.
struct ShownCount: View {
    let shown: Int
    let of: Int

    var body: some View {
        if shown != of {
            Text("\(shown) of \(of)")
                .font(.callout)
                .foregroundStyle(.readableSecondary)
                .accessibilityIdentifier("office.shown")
        }
    }
}
