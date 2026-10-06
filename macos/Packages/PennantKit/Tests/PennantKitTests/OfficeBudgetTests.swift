import Foundation
import HTTPTypes
import OpenAPIRuntime
import PennantAPI
@testable import PennantKit
import Testing

/// The budget the GM expects next season (N12 review, M2): the change says what it did in the server's words, and ⌘Z
/// sends the request the server served to put back what was there, its redo the GM's own amount again.
@Suite("The budget the GM expects next season")
@MainActor
struct OfficeBudgetTests {
    private static let put = "PUT /api/v2/views/1/finance/payrollBudget/nextSeasonBudget"

    private func transport() throws -> RoutedTransport {
        RoutedTransport([
            "/api/status": try RoutedTransport.json("getStatus"),
            "/api/settings": try RoutedTransport.json("getSettings"),
            "/api/orgs": try RoutedTransport.json("listOrgs"),
            "/api/v2/data-status": try RoutedTransport.json("getDataStatusWords"),
            "/api/v2/catalog": try RoutedTransport.json("getCatalog"),
            "/api/v2/views/1/finance/payrollBudget": try RoutedTransport.json("getFinancePayroll"),
            "/api/v2/views/1/finance/horizonBoard": try RoutedTransport.json("getFinanceHorizon"),
            Self.put: try RoutedTransport.json("setFinanceBudget-set"),
        ])
    }

    private func readyModel(_ transport: RoutedTransport) throws -> AppModel {
        let configuration = try fakeConfiguration()
        let status = try fixtureStatus()
        let controller = ServerController(
            configuration: configuration, launcher: FakeLauncher { process, _ in process.ready() }, keySource: NoKeys(),
            probe: { _, _ in status }, timing: fastTiming
        )
        return AppModel(configuration: configuration, controller: controller, keptReports: KeptReports(folder: try scratchFolder("office-budget"))) { connection in
            PennantClient.make(port: connection.port, token: connection.token, transport: transport)
        }
    }

    private func sentAmount(_ transport: RoutedTransport) -> Double? {
        guard let sent = transport.body(Self.put),
              let json = try? JSONSerialization.jsonObject(with: sent) as? [String: Any] else { return nil }
        return (json["amount"] as? NSNumber)?.doubleValue
    }

    @Test("the change says what it did, and Undo sends the served request, Redo the GM's amount again")
    func budgetUndo() async throws {
        let transport = try transport()
        let model = try readyModel(transport)
        await model.start()
        #expect(await eventually { model.storeKey?.club != nil })
        let undoManager = UndoManager()
        undoManager.groupsByEvent = false
        undoManager.beginUndoGrouping()
        let change = await model.setNextSeasonBudget(150_000_000, undoManager: undoManager, actionName: "Set Budget")
        undoManager.endUndoGrouping()
        #expect(change?.undo.amount == 0)
        #expect(sentAmount(transport) == 150_000_000)
        #expect(model.office.budgetDone?.display == "Next season's budget set to $150M; was today's budget held flat")
        #expect(undoManager.canUndo)
        #expect(undoManager.undoActionName == "Set Budget")
        undoManager.undo()
        #expect(await eventually { self.sentAmount(transport) == 0 })
        #expect(undoManager.canRedo)
        undoManager.redo()
        #expect(await eventually { self.sentAmount(transport) == 150_000_000 })
        #expect(undoManager.canUndo)
        await model.shutdown()
    }

    @Test("a refused budget registers no undo and says why in the server's sentence")
    func budgetRefused() async throws {
        let transport = try transport()
        transport.answer(Self.put, with: try RoutedTransport.json("setFinanceBudget-not-an-amount"), status: 400)
        let model = try readyModel(transport)
        await model.start()
        #expect(await eventually { model.storeKey?.club != nil })
        let undoManager = UndoManager()
        // Ungrouped and no group open: a step registered here would raise, so nothing registered is the only way through
        undoManager.groupsByEvent = false
        let change = await model.setNextSeasonBudget(1e13, undoManager: undoManager, actionName: "Set Budget")
        #expect(change == nil)
        #expect(!undoManager.canUndo)
        #expect(model.office.budgetDone == nil)
        if case .served(let words) = model.office.budgetProblem { #expect(words.contains("$10 billion")) } else { Issue.record("not refused in the server's words") }
        await model.shutdown()
    }
}
