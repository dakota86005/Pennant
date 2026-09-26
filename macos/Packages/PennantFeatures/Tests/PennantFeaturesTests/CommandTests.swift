import FeatureCore
import Foundation
import PennantAPI
import PennantKit
import Shell
import Testing

@Suite("Which commands can act")
struct CommandAvailabilityTests {
    @Test("Refresh Data needs a ready server, a chosen save and no import under way")
    func refresh() {
        #expect(CommandAvailability(serverReady: true, configured: true, importing: false, window: nil).refreshData)
        #expect(!CommandAvailability(serverReady: false, configured: true, importing: false, window: nil).refreshData)
        #expect(!CommandAvailability(serverReady: true, configured: false, importing: false, window: nil).refreshData)
        #expect(!CommandAvailability(serverReady: true, configured: true, importing: true, window: nil).refreshData)
    }

    @Test("Import Export… needs a ready server with no import under way; Data Status is always there")
    func club() {
        #expect(CommandAvailability(serverReady: true, configured: false, importing: false, window: nil).importExport)
        #expect(!CommandAvailability(serverReady: true, configured: true, importing: true, window: nil).importExport)
        #expect(!CommandAvailability(serverReady: false, configured: false, importing: false, window: nil).importExport)
        #expect(CommandAvailability(serverReady: false, configured: false, importing: false, window: nil).dataStatus)
    }

    @Test("Go, Back, Forward and the inspector act on a key main window whose server is ready")
    func window() {
        let none = CommandAvailability(serverReady: true, configured: true, importing: false, window: nil)
        #expect(!none.goToDepartment && !none.back && !none.forward && !none.inspector)
        let fresh = CommandAvailability(serverReady: true, configured: true, importing: false, window: (false, false))
        #expect(fresh.goToDepartment && fresh.inspector && !fresh.back && !fresh.forward)
        let moved = CommandAvailability(serverReady: true, configured: true, importing: false, window: (true, true))
        #expect(moved.back && moved.forward)
        let down = CommandAvailability(serverReady: false, configured: true, importing: false, window: (true, true))
        #expect(!down.goToDepartment && !down.back && !down.forward && !down.inspector)
    }

    @MainActor
    @Test("reads the app's model and the key window")
    func fromModel() {
        let registry = DepartmentRegistry(allDepartments)
        let window = MainWindowModel(registry: registry)
        window.go(toShortcut: 2)
        let ready = PreviewFixtures.ready(configured: true)
        let availability = CommandAvailability.of(ready, window: window)
        #expect(availability.refreshData && availability.back && !availability.forward)
        let unconfigured = CommandAvailability.of(PreviewFixtures.ready(configured: false), window: window)
        #expect(!unconfigured.refreshData && unconfigured.importExport)
        #expect(!CommandAvailability.of(PreviewFixtures.state(.starting), window: window).goToDepartment)
    }

    @MainActor
    @Test("Setup opens by itself once per launch, only when the server has no save")
    func setupOpensOnce() {
        let routing = AppRouting()
        #expect(!routing.shouldOpenSetupAutomatically(needsSetup: false))
        #expect(routing.shouldOpenSetupAutomatically(needsSetup: true))
        #expect(!routing.shouldOpenSetupAutomatically(needsSetup: true))
    }

    @MainActor
    @Test("Data Status opens General at the data status")
    func dataStatus() {
        let routing = AppRouting()
        routing.settingsTab = .ai
        routing.showDataStatus()
        #expect(routing.settingsTab == .general)
        #expect(routing.revealDataStatus)
    }
}

@Suite("The toolbar's subtitle")
struct SubtitleTests {
    @Test("is the server's own subtitle: the game date in words and the headline, never a date parsed here")
    func served() throws {
        let data = try Data(contentsOf: PreviewFixtures.responses.appending(path: "getDataStatusWords.json"))
        let status = try JSONDecoder().decode(Components.Schemas.DataStatusView.self, from: data)
        #expect(ServedText.subtitle(dataStatus: status) == "May 6, 2040 · No log")
        #expect(status.subtitleHint == "May 6, 2040 · Transaction history unavailable")
    }

    @Test("is nothing before the data status arrives")
    func none() {
        #expect(ServedText.subtitle(dataStatus: nil) == nil)
    }
}
