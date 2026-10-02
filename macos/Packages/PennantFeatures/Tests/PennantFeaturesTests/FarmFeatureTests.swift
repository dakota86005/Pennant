import AppKit
@testable import Farm
@testable import FeatureCore
import Foundation
import PennantAPI
import PennantDesign
import PennantKit
@testable import Shell
import SwiftUI
import Testing

/// Farm & Development in the Mac app (N10; BEHAVIOR_CASES.md "Pennant for Mac", `FarmFeatureTests`): the views draw what
/// is served and nothing else. Routes carry what a view opens on; the tables sort by served keys, unknown last, and keep
/// the served order until the GM sorts; every farm payload the server captured decodes.
@MainActor
@Suite("Farm & Development")
struct FarmFeatureTests {
    let registry = DepartmentRegistry(allDepartments)

    @Test("every farm view is built: none is a placeholder")
    func viewsBuilt() throws {
        let farm = try #require(registry.department("farm"))
        #expect(farm.views.map(\.id) == ["report", "organization", "affiliates", "assignments", "prospects", "developmentTracking", "decision"])
    }

    @Test("a served decision opens the department's Decision on its key; a view's key is what it opens on")
    func routesCarryTheirKey() throws {
        let decision = Components.Schemas.Target(kind: .init(value1: .decision), department: .init(value1: .farm), key: "1104")
        #expect(route(decision) == AppRoute(department: "farm", view: "decision", key: "1104"))
        let affiliate = Components.Schemas.Target(kind: .init(value1: .view), department: .init(value1: .farm), view: "affiliates", key: "7")
        #expect(route(affiliate) == AppRoute(department: "farm", view: "affiliates", key: "7"))
        let plain = Components.Schemas.Target(kind: .init(value1: .view), department: .init(value1: .farm), view: "organization")
        #expect(route(plain) == AppRoute(department: "farm", view: "organization"))
        // The registry knows the view whatever it opens on
        #expect(registry.contains(AppRoute(department: "farm", view: "decision", key: "1104")))
    }

    @Test("the sidebar selects the view a player's decision is open in; choosing its row shows the view with nothing open")
    func sidebarSelection() {
        let window = MainWindowModel(registry: registry)
        window.go(to: AppRoute(department: "farm", view: "decision", key: "1104"))
        #expect(window.selection == AppRoute(department: "farm", view: "decision"))
        #expect(window.route.key == "1104")
        // N8's convention: a row goes to its view with nothing open, and Back returns to the player
        window.selection = AppRoute(department: "farm", view: "decision")
        #expect(window.route == AppRoute(department: "farm", view: "decision"))
        window.goBack()
        #expect(window.route.key == "1104")
        window.selection = AppRoute(department: "farm", view: "assignments")
        #expect(window.route == AppRoute(department: "farm", view: "assignments"))
        #expect(window.canGoBack)
    }

    @Test("a column sorts by the served key with the unknown last both ways; with no sort the served order stands")
    func servedSort() {
        struct Row { let id: String; let key: SortKey? }
        let rows = [Row(id: "a", key: .number(3)), Row(id: "b", key: nil), Row(id: "c", key: .number(1)), Row(id: "d", key: .number(2))]
        let up = ServedColumnSort<Row>("k", order: .forward) { $0.key }
        let down = ServedColumnSort<Row>("k", order: .reverse) { $0.key }
        #expect(ServedRows.sorted(rows, by: [up]).map(\.id) == ["c", "d", "a", "b"])
        #expect(ServedRows.sorted(rows, by: [down]).map(\.id) == ["a", "d", "c", "b"])
        #expect(ServedRows.sorted(rows, by: []).map(\.id) == ["a", "b", "c", "d"])
    }

    @Test("every farm payload the server captured decodes")
    func fixturesDecode() throws {
        _ = try #require(PreviewFixtures.decode(Components.Schemas.FarmOrganizationView.self, "getFarmOrganization"))
        _ = try #require(PreviewFixtures.decode(Components.Schemas.FarmAffiliatesView.self, "getFarmAffiliates"))
        let assignments = try #require(PreviewFixtures.decode(Components.Schemas.FarmAssignmentsView.self, "getFarmAssignments"))
        _ = try #require(PreviewFixtures.decode(Components.Schemas.FarmDecisionView.self, "getFarmDecision"))
        _ = try #require(PreviewFixtures.decode(Components.Schemas.FarmProspectsView.self, "getFarmProspects"))
        _ = try #require(PreviewFixtures.decode(Components.Schemas.FarmDevelopmentView.self, "getFarmDevelopment"))
        _ = try #require(PreviewFixtures.decode(Components.Schemas.FarmDevelopmentDetail.self, "getFarmDevelopmentDetail"))
        let cascade = try #require(PreviewFixtures.farmFixture(Components.Schemas.FarmDecisionView.self, "decision-cascade"))
        _ = try #require(PreviewFixtures.farmFixture(Components.Schemas.FarmProspectsView.self, "prospects-meetings"))
        _ = try #require(PreviewFixtures.farmFixture(Components.Schemas.FarmDevelopmentView.self, "development-tracked"))
        // The stakes column carries no sort key: the server's rule, drawn as a column the GM cannot sort (D-050)
        for row in assignments.rows { #expect(row.sort.stakes == nil) }
        // A cascade's hole is information: served neutral, never bad
        let chain = try #require(cascade.consequence?.cascade)
        #expect(chain.steps.count == 2)
        #expect(!chain.unresolved.isEmpty)
        #expect(chain.unresolved.allSatisfy { Tone($0.tone) != .bad })
        #expect(Tone(chain.stop.tone) != .bad)
    }

    @Test("a farm item on the desk opens where the farm answers it, through its served open, labelled by its kind")
    func deskItemOpensDecision() throws {
        let report = try #require(PreviewFixtures.decode(Components.Schemas.DepartmentReport.self, "getDepartmentReport-farm"))
        let items = report.toDecide.items + report.watching.items
        #expect(!items.isEmpty)
        for item in items {
            let r = try #require(route(item.open), "\(item.key) opens nothing")
            #expect(r.department == "farm")
            #expect(registry.contains(r))
            if item.open?.kind.value1 == .decision {
                #expect(r.view == "decision" && r.key != nil)
                #expect(openLabel(item.open) == "Open Decision")
            } else {
                #expect(openLabel(item.open) == "Open")
            }
        }
    }

    @Test("the store says a payload is updating only when a newer key is asked")
    func stale() {
        let store = FarmStore.preview(organization: PreviewFixtures.decode(Components.Schemas.FarmOrganizationView.self, "getFarmOrganization"))
        #expect(!store.isStale("organization", for: nil))
        #expect(store.isStale("organization", for: AppModel.StoreKey(importStamp: "x", club: nil, restores: 0)))
        let key = AppModel.StoreKey(importStamp: "x", club: nil, restores: 0)
        let current = FarmStore.preview(organization: PreviewFixtures.decode(Components.Schemas.FarmOrganizationView.self, "getFarmOrganization"), key: key)
        #expect(!current.isStale("organization", for: key))
    }
}
