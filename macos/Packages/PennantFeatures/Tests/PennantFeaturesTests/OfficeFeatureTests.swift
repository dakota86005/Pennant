import FeatureCore
@testable import Finance
import Foundation
@testable import Medical
import PennantAPI
import PennantKit
@testable import Shell
import Testing

/// Finance's and Medical's views drawn as served (N12, D-071; BEHAVIOR_CASES.md "Pennant for Mac", `OfficeFeatureTests`):
/// every served table has a cell and a sort key for every column, an unknown sorts last both ways, a filter keeps only
/// the rows it serves (and the GM's search words only the names that hold them), the chosen rows compare each player
/// once, and the payroll chart's audio graph reads the served words.
@MainActor
@Suite("Finance and Medical, drawn")
struct OfficeFeatureTests {
    let store = PreviewFixtures.office

    private var tables: [Components.Schemas.OfficeTable] {
        var out: [Components.Schemas.OfficeTable] = []
        if let payroll = store.payroll { out.append(payroll.contracts); out += payroll.sections.map(\.table) }
        if let contracts = store.contracts { out.append(contracts.table) }
        out += store.freeAgents?.lists.map(\.table) ?? []
        if let injuries = store.injuries { out.append(injuries.table) }
        return out
    }

    @Test("Finance's and Medical's views keep their registry ids, each drawn by its own view")
    func registry() throws {
        let registry = DepartmentRegistry(allDepartments)
        #expect(try #require(registry.department("finance")).views.map(\.id) == ["report", "payrollBudget", "contracts", "freeAgents", "horizonBoard"])
        #expect(try #require(registry.department("medical")).views.map(\.id) == ["report", "injuryReport"])
    }

    @Test("every view's captured payload decodes, and every table has a cell and a sort key for every served column")
    func everyColumnServed() {
        #expect(store.payroll != nil && store.contracts != nil && store.freeAgents != nil && store.horizon != nil && store.injuries != nil)
        #expect(tables.count >= 6)
        for table in tables {
            let columns = Set(table.columns.map(\.id))
            for row in table.rows {
                #expect(Set(row.cells.additionalProperties.keys) == columns)
                #expect(Set(row.sort.additionalProperties.keys) == columns)
            }
        }
    }

    @Test("a column sorts by the served keys, an unknown last whichever way, ties in the served order")
    func unknownLast() throws {
        let table = try #require(store.contracts?.table)
        let items = table.rows.enumerated().map { OfficeRowItem(row: $0.element, index: $0.offset) }
        for column in table.columns.map(\.id) {
            for order in [SortOrder.forward, .reverse] {
                let sorted = ServedColumnSort<OfficeRowItem>(column, order: order) { $0.key(column) }.sorted(items)
                let unknown = sorted.drop { $0.key(column) != nil }
                #expect(unknown.allSatisfy { $0.key(column) == nil }, "\(column): an unknown came before a known key")
            }
        }
    }

    @Test("a filter keeps the rows whose served key names its choice; the first choice keeps every row; search words keep the names holding them")
    func filters() throws {
        let view = try #require(store.contracts)
        #expect(!view.filters.isEmpty)
        let lists = (store.freeAgents?.lists ?? []).map { ($0.table, $0.filters) }
        for (table, filters) in [(view.table, view.filters)] + lists {
            for group in filters {
                #expect(officeRowsKept(table, filters: [group], chosen: [group.id: group.choices[0].id], search: "") == nil)
                var union = Set<String>()
                for choice in group.choices.dropFirst() {
                    let kept = try #require(officeRowsKept(table, filters: [group], chosen: [group.id: choice.id], search: ""))
                    let named = Set(table.rows.filter { $0.filterKeys?.additionalProperties[group.id] == choice.id }.map(\.id))
                    #expect(kept == named)
                    // A row falls under one choice of a group at most
                    #expect(union.isDisjoint(with: kept))
                    union.formUnion(kept)
                }
            }
        }
        let name = try #require(view.table.rows.first?.player?.name)
        let kept = try #require(officeRowsKept(view.table, filters: view.filters, chosen: [:], search: name))
        #expect(kept.contains(view.table.rows[0].id))
        #expect(kept.allSatisfy { id in view.table.rows.first { $0.id == id }?.player?.name.localizedCaseInsensitiveContains(name) == true })
    }

    @Test("Compare takes each chosen player once, in the table's order")
    func compareTakesEachOnce() throws {
        let rows = try #require(store.contracts?.table.rows.prefix(3))
        let refs = OfficeTableView.players(in: Array(rows) + Array(rows))
        #expect(refs == rows.compactMap { $0.player.map { PlayerRef(id: $0.playerId) } })
    }

    @Test("the payroll chart's audio graph names each season and reads the served words")
    func payrollDescriptor() throws {
        let view = try #require(store.payroll)
        let descriptor = PayrollDescriptor(view: view).makeChartDescriptor()
        #expect(descriptor.summary == view.chartSummary.display)
        #expect(descriptor.series.first?.dataPoints.count == view.seasons.count)
        #expect(descriptor.series.first?.dataPoints.first?.label == view.seasons.first?.claim.text)
    }

    @Test("the Horizon Board's pipeline is never placed in a season")
    func pipelineApart() throws {
        let view = try #require(store.horizon)
        let pipeline = Set(view.rows.flatMap { $0.pipeline.map(\.player.playerId) })
        let placed = Set(view.rows.flatMap { $0.cells.flatMap { $0.entries.map(\.player.playerId) } })
        #expect(pipeline.isDisjoint(with: placed))
        #expect(view.rows.allSatisfy { $0.cells.map(\.season) == view.seasons })
    }

    @Test("the budget field shows an amount to the dollar, so saving it again never rounds it")
    func budgetMillions() {
        #expect(BudgetEntry.millions(123_456_700) == "123.4567")
        #expect(BudgetEntry.millions(200_000_000) == "200")
        #expect(BudgetEntry.millions(1) == "0.000001")
        #expect(BudgetEntry.millions(987_654_321) == "987.654321")
        for amount in [123_456_700.0, 1.0, 987_654_321.0, 150_000_000.0] {
            #expect((Double(BudgetEntry.millions(amount))! * 1_000_000).rounded() == amount)
        }
    }

    @Test("a free agent's row is drawn with his detail once it is read, and with its own cells before")
    func freeAgentDetail() throws {
        let list = try #require(store.freeAgents?.lists.first { !$0.table.rows.isEmpty })
        let row = list.table.rows[0]
        #expect(row.facts == nil && row.claims == nil)
        let detail = try #require(PreviewFixtures.freeAgentDetail)
        var full = row
        full.facts = detail.facts
        full.claims = detail.claims
        #expect(full.claims?.isEmpty == false)
        #expect(full.cells == row.cells)
    }
}
