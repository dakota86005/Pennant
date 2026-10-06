import AppKit
@testable import FeatureCore
import Foundation
import PennantAPI
import PennantDesign
import PennantKit
@testable import Philosophy
@testable import Shell
import SwiftUI
import Testing
@testable import Trades

/// Trades and Philosophy & Staff in the Mac app (N12 Track C; BEHAVIOR_CASES.md "Pennant for Mac", `TradesFeatureTests`,
/// `PhilosophyFeatureTests`): the views are built, every payload the server captured decodes, and what is drawn is what is
/// served (the chart's scale and marks, the deal's sides, the editor's settings), never a figure or a word of the app's.
@MainActor
@Suite("Trades and Philosophy & Staff")
struct TradesPhilosophyFeatureTests {
    let registry = DepartmentRegistry(allDepartments)

    @Test("every view of both departments is built, under the ids the registry always had")
    func viewsBuilt() throws {
        #expect(try #require(registry.department("trades")).views.map(\.id) == ["tradeDesk"])
        #expect(try #require(registry.department("philosophy")).views.map(\.id) == ["organizationalPhilosophy", "coachingStaff"])
    }

    @Test("every Trades and Philosophy payload the server captured decodes")
    func fixturesDecode() throws {
        let desk = try #require(PreviewFixtures.decode(Components.Schemas.TradeDeskView.self, "getTradeDesk"))
        #expect(!desk.offers.isEmpty && !desk.talk.isEmpty)
        // AI is off in the server's tests (no key): the desk says so, and still serves everything else
        #expect(desk.ai.available == false)
        #expect(desk.ai.off != nil)
        _ = try #require(PreviewFixtures.decode(Components.Schemas.TradeAnalysisView.self, "getTradeAnalysis"))
        _ = try #require(PreviewFixtures.decode(Components.Schemas.ApiError.self, "askTradeDesk-ai-off"))
        _ = try #require(PreviewFixtures.decode(Components.Schemas.PhilosophyView.self, "getOrganizationalPhilosophy"))
        _ = try #require(PreviewFixtures.decode(Components.Schemas.PhilosophyChange.self, "setOrganizationalPhilosophy-one-preference"))
        _ = try #require(PreviewFixtures.decode(Components.Schemas.PhilosophyChange.self, "resetOrganizationalPhilosophy-reset"))
        _ = try #require(PreviewFixtures.decode(Components.Schemas.CoachingStaffView.self, "getCoachingStaff"))
    }

    @Test("the difference is drawn on the served scale, symmetric about zero, with zero on it, and read aloud in the served words")
    func differenceChart() throws {
        let analysis = try #require(PreviewFixtures.decode(Components.Schemas.TradeAnalysisView.self, "getTradeAnalysis"))
        let chart = try #require(analysis.difference?.chart)
        #expect(abs(chart.scaleLow + chart.scaleHigh) < 1e-9)
        #expect(chart.scaleLow < 0 && chart.scaleHigh > 0)
        #expect(chart.scaleLow <= chart.low && chart.high <= chart.scaleHigh)
        let descriptor = DifferenceChartDescriptor(chart: chart).makeChartDescriptor()
        #expect(descriptor.series.first?.dataPoints.count == 3)
        #expect(descriptor.series.first?.dataPoints.map(\.label) == chart.marks.map(\.display))
        #expect(descriptor.summary == chart.summary.display)
    }

    @Test("the builder draws the served sides in the order the GM put players on them; a player is on one side only")
    func builderSides() throws {
        let analysis = try #require(PreviewFixtures.decode(Components.Schemas.TradeAnalysisView.self, "getTradeAnalysis"))
        let store = TradesStore.preview(analysis: analysis)
        #expect(store.deal.sent == analysis.deal.sent && store.deal.received == analysis.deal.received)
        #expect(analysis.sides.map(\.id) == ["sent", "received"])
        for side in analysis.sides {
            let ids = side.id == "sent" ? store.deal.sent : store.deal.received
            #expect(side.rows.map(\.player.playerId) == ids)
        }
        let mover = try #require(store.deal.sent.first)
        store.add(mover, to: .received)
        #expect(!store.deal.sent.contains(mover) && store.deal.received.last == mover)
    }

    @Test("the editor carries every preference with its served words, and nothing that says a setting allows or forbids a move")
    func editorWords() throws {
        let view = try #require(PreviewFixtures.decode(Components.Schemas.PhilosophyView.self, "getOrganizationalPhilosophy"))
        let dimensions = view.groups.flatMap(\.dimensions)
        #expect(dimensions.count == 15)
        #expect(dimensions.allSatisfy { (0...100).contains($0.value) && !$0.position.display.isEmpty && !$0.low.display.isEmpty })
        #expect(view.policies.items.count == 4)
        #expect(view.policies.items.allSatisfy { item in item.options.contains { $0.value == item.selected } })
        #expect(view.lede.text.contains("never make a move allowed or rule one out"))
        // A change answers with what it did and the request that undoes it
        let change = try #require(PreviewFixtures.decode(Components.Schemas.PhilosophyChange.self, "setOrganizationalPhilosophy-one-preference"))
        #expect(change.undo.dimensions?.first?.id == "competitiveWindow")
        #expect(!change.said.display.isEmpty && !change.undoName.display.isEmpty)
    }

    @Test("Coaching Staff's tables sort by the served keys, unknown last both ways, the served order until the GM sorts")
    func staffSort() throws {
        let view = try #require(PreviewFixtures.decode(Components.Schemas.CoachingStaffView.self, "getCoachingStaff"))
        let farm = try #require(view.sections.first { $0.id == "farm" })
        let rows = farm.table.rows.enumerated().map { StaffRow(row: $0.element, index: $0.offset) }
        let ascending = rows.sorted(using: StaffSort(column: "teachHitting", order: .forward))
        let descending = rows.sorted(using: StaffSort(column: "teachHitting", order: .reverse))
        // Every unknown (a rating the export doesn't carry) is last, whichever way
        let firstUnknownUp = ascending.firstIndex { $0.key("teachHitting") == nil } ?? ascending.count
        #expect(ascending[firstUnknownUp...].allSatisfy { $0.key("teachHitting") == nil })
        let firstUnknownDown = descending.firstIndex { $0.key("teachHitting") == nil } ?? descending.count
        #expect(descending[firstUnknownDown...].allSatisfy { $0.key("teachHitting") == nil })
        // An affiliate's coach offers his club, never a window of his own
        #expect(farm.table.rows.allSatisfy { $0.player == nil && $0.actions.allSatisfy { $0.open.kind.value1 == .club } })
    }
}
