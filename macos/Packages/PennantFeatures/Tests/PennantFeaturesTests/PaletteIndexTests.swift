import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import Shell
import Testing

/// What the ⌘K palette can open (SWIFTUI_REBUILD.md section 3.6): every view from the registry, under its
/// department's served name, with the Go menu's shortcut beside a department's first view, and the commands that can act.
@MainActor
@Suite("The palette's index")
struct PaletteIndexTests {
    let registry = DepartmentRegistry(allDepartments)

    @Test("lists every view the registry has, with the Go menu's shortcut beside each department's first view")
    func everyView() {
        let can = CommandAvailability(serverReady: true, configured: true, importing: false, window: (false, false))
        let index = PaletteIndex(registry: registry, catalog: nil, can: can, inspectorShown: false)
        let views = registry.departments.flatMap { department in department.views.map { "view.\(department.id.rawValue).\($0.id)" } }
        for id in views { #expect(index.entries.contains { $0.id == id }, Comment(rawValue: id)) }
        let morning = index.entries.first { $0.id == "view.frontOffice.morningReport" }
        #expect(morning?.shortcut == "⌘1")
        #expect(morning?.group == "Front Office")
        #expect(index.entries.first { $0.id == "view.majorLeague.report" }?.shortcut == "⌘2")
        #expect(index.entries.first { $0.id == "view.majorLeague.lineup" }?.shortcut == nil)
        #expect(index.action(for: morning!) == .route(AppRoute(department: "frontOffice", view: "morningReport")))
    }

    @Test("uses the served names when the catalog is there")
    func servedNames() {
        let catalog = PreviewFixtures.catalog
        let can = CommandAvailability(serverReady: true, configured: true, importing: false, window: (false, false))
        let index = PaletteIndex(registry: registry, catalog: catalog, can: can, inspectorShown: false)
        let served = catalog?.departments.first { $0.id.rawValue == "majorLeague" }
        #expect(served != nil)
        #expect(index.entries.first { $0.id == "view.majorLeague.report" }?.group == served?.name)
    }

    @Test("names a department by the catalog's served name wherever it is named, the registry's title only without one (review S8)")
    func departmentNames() throws {
        var catalog = try #require(PreviewFixtures.catalog)
        let index = try #require(catalog.departments.firstIndex { $0.id.rawValue == "majorLeague" })
        catalog.departments[index].name = "The Big Club"
        #expect(registry.name(of: "majorLeague", catalog: catalog) == "The Big Club")
        #expect(registry.name(of: "majorLeague", catalog: nil) == "Major League Ops")
        #expect(registry.name(of: "brandNew", catalog: catalog) == nil)
    }

    @Test("lists only the commands that can act now, the inspector's label following its state")
    func commands() {
        let fresh = CommandAvailability(serverReady: true, configured: true, importing: false, window: (false, false))
        var index = PaletteIndex(registry: registry, catalog: nil, can: fresh, inspectorShown: false)
        #expect(index.entries.contains { $0.id == "command.inspector" && $0.title == "Show Inspector" })
        #expect(index.entries.contains { $0.id == "command.refreshData" })
        #expect(!index.entries.contains { $0.id == "command.back" })
        let moved = CommandAvailability(serverReady: true, configured: true, importing: true, window: (true, true))
        index = PaletteIndex(registry: registry, catalog: nil, can: moved, inspectorShown: true)
        #expect(index.entries.contains { $0.id == "command.inspector" && $0.title == "Hide Inspector" })
        #expect(index.entries.contains { $0.id == "command.back" })
        #expect(!index.entries.contains { $0.id == "command.refreshData" })
        #expect(index.action(for: index.entries.first { $0.id == "command.back" }!) == .command(.back))
    }

    @Test("a query finds a view by its department and orders a matching title first")
    func query() {
        let can = CommandAvailability(serverReady: true, configured: true, importing: false, window: (false, false))
        let index = PaletteIndex(registry: registry, catalog: nil, can: can, inspectorShown: false)
        let major = PaletteEntry.matching("major", in: index.entries)
        #expect(!major.isEmpty)
        #expect(major.allSatisfy { $0.group == "Major League Ops" })
        #expect(PaletteEntry.matching("morn", in: index.entries).first?.id == "view.frontOffice.morningReport")
    }
}
