import FeatureCore
import Foundation
@testable import MajorLeague
import PennantAPI
import PennantKit
@testable import Shell
import Testing

/// Major League Ops drawn as served (N8; BEHAVIOR_CASES.md "Pennant for Mac", `MajorLeagueFeatureTests`): the tables sort
/// only by the served keys with an unknown last whichever way, every row has a cell for every served column, a decision
/// target opens Decision with its need, and a choice is sent back exactly as served.
@MainActor
@Suite("Major League Ops, drawn")
struct MajorLeagueFeatureTests {
    let store = PreviewFixtures.majorLeague

    private func row(_ id: String, _ key: Double?, at index: Int) -> ServedRow {
        let sort = Components.Schemas.MlbRow.SortPayload(additionalProperties: [
            "estimate": key.map { .init(value1: $0, value2: nil) },
        ])
        let cells = Components.Schemas.MlbRow.CellsPayload(additionalProperties: ["estimate": .init(display: key.map { String(Int($0)) } ?? "Not known")])
        return ServedRow(row: .init(id: id, cells: cells, sort: sort, detail: [], actions: []), index: index)
    }

    @Test("sorts by the served key with an unknown last whichever way, and ties keep the served order")
    func unknownLast() {
        let rows = [row("a", 40, at: 0), row("b", nil, at: 1), row("c", 70, at: 2), row("d", 40, at: 3)]
        #expect(ServedSort(column: "estimate", order: .forward).sorted(rows).map(\.id) == ["a", "d", "c", "b"])
        #expect(ServedSort(column: "estimate", order: .reverse).sorted(rows).map(\.id) == ["c", "a", "d", "b"])
        #expect(ServedSort(column: "estimate").compare(rows[1], rows[0]) == .orderedDescending)
        #expect(ServedSort(column: "estimate", order: .reverse).compare(rows[1], rows[2]) == .orderedDescending)
    }

    @Test("every served table has a cell and a sort key for every served column")
    func everyColumnServed() throws {
        let tables = [store.positionPlayers?.lineup, store.bench?.bench].compactMap { $0 }
            + (store.pitchingStaff?.sections.map(\.table) ?? [])
            + store.decisions.values.flatMap { $0.candidates?.groups.map(\.table) ?? [] }
        #expect(!tables.isEmpty)
        for table in tables {
            let columns = Set(table.columns.map(\.id))
            for row in table.rows {
                #expect(Set(row.cells.additionalProperties.keys) == columns)
                #expect(Set(row.sort.additionalProperties.keys) == columns)
            }
        }
    }

    @Test("a decision target opens Decision with the need open, and the sidebar selects Decision itself")
    func decisionRoute() throws {
        let need = try #require(store.overview?.inbox.first?.needs.first)
        let opened = try #require(route(need.open))
        #expect(opened == AppRoute(department: "majorLeague", view: "decision", key: need.needId))
        let window = MainWindowModel(registry: DepartmentRegistry(allDepartments))
        window.go(to: opened)
        #expect(window.route.key == need.needId)
        #expect(window.selection == AppRoute(department: "majorLeague", view: "decision"))
        // Selecting Decision in the sidebar goes to the list of open needs
        window.selection = AppRoute(department: "majorLeague", view: "decision")
        #expect(window.route.key == nil)
        window.goBack()
        #expect(window.route.key == need.needId)
    }

    @Test("a served choice is asked exactly as served")
    func choiceAsServed() throws {
        let decision = try #require(store.decisions.values.first)
        let choices = [decision.duration, decision.assignment, decision.roleChoice].compactMap { $0 }.flatMap(\.choices)
        #expect(!choices.isEmpty)
        for choice in choices {
            let query = MajorLeagueStore.DecisionQuery(choice.query)
            #expect(query.need == choice.query.need && query.role == choice.query.role && query.context == choice.query.context && query.days == choice.query.days)
        }
    }

    @Test("the views every report item and glance opens are in the registry")
    func opensKnownViews() throws {
        let registry = DepartmentRegistry(allDepartments)
        for glance in store.overview?.glances ?? [] {
            #expect(registry.contains(try #require(route(glance.open))))
        }
        #expect(registry.contains(AppRoute(department: "majorLeague", view: "benchBackups")))
    }
}
