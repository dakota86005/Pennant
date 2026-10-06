import FeatureCore
import Foundation
@testable import MajorLeague
import PennantAPI
import PennantKit
@testable import Shell
import Testing

/// Major League Ops' clubhouse tools drawn as served (N9; BEHAVIOR_CASES.md "Pennant for Mac", `ClubhouseFeatureTests`):
/// every served table has a cell and a sort key for every column, a column served hidden starts hidden, a desk item and
/// Tonight open the tool on what they are about, a choice is asked exactly as served, and a chart's audio graph leaves
/// out a point the server has no value for.
@MainActor
@Suite("Major League Ops' clubhouse tools, drawn")
struct ClubhouseFeatureTests {
    let store = PreviewFixtures.clubhouse

    private var tables: [Components.Schemas.MlbTable] {
        var out: [Components.Schemas.MlbTable] = []
        if let lineup = store.lineup(nil) { out.append(lineup.order) }
        out += store.pitching?.sections.map(\.table) ?? []
        if let schedule = store.schedule { out.append(schedule.games.table); if let h = schedule.headToHead { out.append(h.table) } }
        out += store.plans.values.flatMap { $0.sections.map(\.table) }
        out += store.fortyMan?.sections.map(\.table) ?? []
        out += store.roster(nil)?.sections.map(\.table) ?? []
        return out
    }

    @Test("every served table has a cell and a sort key for every served column")
    func everyColumnServed() {
        #expect(tables.count >= 8)
        for table in tables {
            let columns = Set(table.columns.map(\.id))
            for row in table.rows {
                #expect(Set(row.cells.additionalProperties.keys) == columns)
                #expect(Set(row.sort.additionalProperties.keys) == columns)
            }
        }
    }

    @Test("a roster's usual season lines are shown and the rest start hidden, to be shown from the table's columns")
    func hiddenColumns() throws {
        let hitters = try #require(store.roster(nil)?.sections.first { $0.id == "hitters" })
        let shown = hitters.table.columns.filter { $0.hidden != true }.map(\.id)
        #expect(shown.contains("stat.ops") && shown.contains("stat.war") && shown.contains("scouted"))
        #expect(hitters.table.columns.first { $0.id == "stat.ab" }?.hidden == true)
    }

    @Test("a 40-man item opens 40-Man & Options on its player, and Tonight opens the schedule on its game")
    func deskRoutes() throws {
        let decode = { (json: String) in try JSONDecoder().decode(Components.Schemas.Target.self, from: Data(json.utf8)) }
        let player = try decode(#"{"kind":"view","department":"majorLeague","view":"fortyManOptions","key":"412"}"#)
        let window = MainWindowModel(registry: DepartmentRegistry(allDepartments))
        window.go(to: try #require(route(player)))
        #expect(window.route == AppRoute(department: "majorLeague", view: "fortyManOptions", key: "412"))
        #expect(window.selection == AppRoute(department: "majorLeague", view: "fortyManOptions"))
        let game = try decode(#"{"kind":"view","department":"majorLeague","view":"scheduleGamePlans","key":"61"}"#)
        #expect(route(game) == AppRoute(department: "majorLeague", view: "scheduleGamePlans", key: "61"))
        #expect(openLabel(game) == "Open")
    }

    @Test("every Major League Ops view is in the registry, in the department's order")
    func noPlaceholders() throws {
        let registry = DepartmentRegistry(allDepartments)
        let views = try #require(registry.departments.first { $0.id == "majorLeague" }).views
        #expect(views.map(\.id) == [
            "report", "positionPlayers", "pitchingStaff", "benchBackups", "decision", "lineup", "pitchingAvailability",
            "scheduleGamePlans", "depthChart", "fortyManOptions", "rosters", "seasonTrends",
        ])
    }

    @Test("a lineup choice is asked exactly as served")
    func choiceAsServed() throws {
        let lineup = try #require(store.lineup(nil))
        let choices = lineup.choices.flatMap(\.choices)
        #expect(choices.count >= 8)
        for choice in choices {
            let query = ClubhouseStore.LineupQuery(choice.query)
            #expect(query.vs == choice.query.vs && query.style == choice.query.style && query.dh == choice.query.dh && query.sort == choice.query.sort)
        }
        // Exactly one choice of each group is the card shown
        for group in lineup.choices { #expect(group.choices.filter(\.selected).count == 1) }
    }

    @Test("a chart's audio graph is the served points and summary, leaving out a point with no value")
    func chartDescriptor() throws {
        let chart = try #require(store.trends?.charts.first { $0.id == "scoring" })
        let descriptor = TrendDescriptor(chart: chart).makeChartDescriptor()
        #expect(descriptor.summary == chart.summary)
        #expect(descriptor.series.count == chart.series.count)
        for (served, drawn) in zip(chart.series, descriptor.series) {
            #expect(drawn.dataPoints.count == served.points.filter { $0.value != nil }.count)
            #expect(drawn.dataPoints.count < served.points.count)
        }
    }

    @Test("the schedule opens on the next game, which has its plan ready")
    func scheduleOpensOnNextGame() throws {
        let schedule = try #require(store.schedule)
        let next = try #require(schedule.nextRow)
        #expect(schedule.games.table.rows.contains { $0.id == next })
        let plan = try #require(store.plans.values.first)
        #expect(plan.rowId == next)
    }
}
