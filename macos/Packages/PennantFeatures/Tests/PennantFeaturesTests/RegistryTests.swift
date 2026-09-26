import FeatureCore
import Foundation
import Farm
import Finance
import FrontOffice
import League
import MajorLeague
import Medical
import PennantKit
import Philosophy
import Scouting
import Shell
import Testing
import Trades

/// The departments the app target assembles (`macos/Pennant/Registry.swift` lists the same modules).
let allDepartments: [any DepartmentModule.Type] = [
    FrontOfficeDepartment.self, MajorLeagueDepartment.self, FarmDepartment.self, ScoutingDepartment.self,
    TradesDepartment.self, FinanceDepartment.self, MedicalDepartment.self, LeagueDepartment.self,
    PhilosophyDepartment.self,
]

func text(_ resource: LocalizedStringResource) -> String { String(localized: resource) }

@Suite("The department registry")
struct RegistryTests {
    let registry = DepartmentRegistry(allDepartments)

    @Test("is sound: unique department ids, orders and view ids, and no department without views")
    func sound() {
        #expect(registry.problems == [])
        #expect(Set(registry.departments.map(\.id)).count == 9)
    }

    @Test("orders the departments by their order, whatever order the app lists them in")
    func ordered() {
        let shuffled = DepartmentRegistry(allDepartments.reversed())
        #expect(shuffled.departments.map(\.id) == registry.departments.map(\.id))
        #expect(registry.departments.map(\.order) == registry.departments.map(\.order).sorted())
    }

    @Test("maps ⌘1 to ⌘9 onto the departments in order, each to its first view")
    func shortcuts() {
        let expected: [(Int, DeptID, String)] = [
            (1, "frontOffice", "morningReport"), (2, "majorLeague", "report"), (3, "farm", "report"),
            (4, "scouting", "draftBoard"), (5, "trades", "tradeDesk"), (6, "finance", "report"),
            (7, "medical", "report"), (8, "league", "wire"), (9, "philosophy", "organizationalPhilosophy"),
        ]
        for (number, department, view) in expected {
            #expect(registry.route(forShortcut: number) == AppRoute(department: department, view: view))
        }
        #expect(registry.route(forShortcut: 0) == nil)
        #expect(registry.route(forShortcut: 10) == nil)
        #expect(registry.shortcutDepartments.map(\.number) == Array(1...9))
    }

    /// SWIFTUI_REBUILD.md section 3.5, department by department.
    nonisolated static let section35: [(DeptID, String, [String])] = [
        ("frontOffice", "Front Office", ["Morning Report", "Storylines", "GM Briefing"]),
        ("majorLeague", "Major League Ops", [
            "Report", "Position Players", "Pitching Staff", "Bench & Backups", "Decision", "Lineup",
            "Pitching Availability", "Schedule & Game Plans", "Depth Chart", "40-Man & Options", "Rosters",
            "Season Trends",
        ]),
        ("farm", "Farm & Development", [
            "Report", "Organization", "Affiliates", "Assignments", "Prospects", "Development Tracking", "Decision",
        ]),
        ("scouting", "Scouting", ["Draft Board", "Player Search"]),
        ("trades", "Trades", ["Trade Desk"]),
        ("finance", "Finance", ["Report", "Payroll & Budget", "Contracts", "Free Agents", "Horizon Board"]),
        ("medical", "Medical", ["Report", "Injury Report"]),
        ("league", "League Office", [
            "Wire", "Club Reports", "Us vs Them", "Standings", "Leaders", "Org Comparison", "Franchise History",
        ]),
        ("philosophy", "Philosophy & Staff", ["Organizational Philosophy", "Coaching Staff"]),
    ]

    @Test("has every department and view section 3.5 lists, in its order", arguments: section35)
    func section35Present(_ entry: (DeptID, String, [String])) throws {
        let department = try #require(registry.department(entry.0))
        #expect(text(department.title) == entry.1)
        #expect(department.views.map { text($0.title) } == entry.2)
        for view in department.views {
            #expect(!view.symbol.isEmpty)
            #expect(registry.contains(department.route(to: view)))
        }
    }

    @Test("lists section 3.5's departments and nothing else")
    func onlySection35() {
        #expect(registry.departments.map(\.id) == Self.section35.map(\.0))
    }

    @Test("resolves a route this build does not know to the default")
    func resolvesUnknown() {
        #expect(registry.defaultRoute == AppRoute(department: "frontOffice", view: "morningReport"))
        #expect(registry.resolve(AppRoute(department: "majorLeague", view: "noSuchView")) == registry.defaultRoute)
        #expect(registry.resolve(AppRoute(department: "stadium", view: "report")) == registry.defaultRoute)
        let known = AppRoute(department: "farm", view: "prospects")
        #expect(registry.resolve(known) == known)
    }

    @Test("reports duplicates")
    func reportsDuplicates() {
        let doubled = DepartmentRegistry([FrontOfficeDepartment.self, FrontOfficeDepartment.self])
        #expect(doubled.problems.contains("duplicate department id frontOffice"))
        #expect(doubled.problems.contains("duplicate order 1"))
    }

    @MainActor
    @Test("draws no badge before the desk arrives")
    func noBadges() {
        let model = AppModel.preview(configuration: .bundled(in: .main), state: .idle)
        #expect(registry.departments.allSatisfy { $0.badge(from: model) == nil })
    }

    @MainActor
    @Test("badges a department with the count its served card has to decide; none for nothing, unread or no report yet")
    func servedBadges() throws {
        let model = PreviewFixtures.ready()
        let cards = try #require(model.frontOffice.summary?.departments)
        for department in registry.departments {
            let card = cards.first { $0.department.rawValue == department.id.rawValue }
            let expected = card?.toDecide.flatMap { $0 > 0 ? $0 : nil }
            #expect(department.badge(from: model) == expected, "\(department.id.rawValue)")
        }
        // The captured save's farm has items to decide; Scouting has no report yet, so no count
        #expect(registry.department("farm")?.badge(from: model) ?? 0 > 0)
        #expect(registry.department("scouting")?.badge(from: model) == nil)
    }
}
