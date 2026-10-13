#if DEBUG
import FeatureCore
import PennantKit
import SwiftUI

// The shell's previews, fed by `contract/fixtures/` (PreviewFixtures). The departments are not visible from here, so
// the previews use a registry of one sample department; the app's own registry is in `macos/Pennant/Registry.swift`.

private enum SampleDepartment: DepartmentModule {
    static let id: DeptID = "frontOffice"
    static let title: LocalizedStringResource = "Front Office"
    static let symbol = "building.2"
    static let order = 1
    static let views: [DepartmentViewDescriptor] = [
        .placeholder(id: "morningReport", title: "Morning Report", symbol: "sun.horizon"),
        .placeholder(id: "storylines", title: "Storylines", symbol: "text.book.closed"),
    ]
}

@MainActor private func sampleWindow(inspector: Bool = false) -> MainWindowModel {
    MainWindowModel(registry: DepartmentRegistry([SampleDepartment.self]), inspectorPresented: inspector)
}

#Preview("Main window") {
    MainWindowView(window: sampleWindow(inspector: true))
        .environment(PreviewFixtures.ready())
        .environment(AppRouting())
        .frame(width: 1280, height: 800)
}

#Preview("Main window, no save") {
    MainWindowView(window: sampleWindow())
        .environment(PreviewFixtures.ready(configured: false))
        .environment(AppRouting())
        .frame(width: 1280, height: 800)
}

#Preview("Sidebar") {
    SidebarView(window: sampleWindow())
        .environment(PreviewFixtures.ready())
        .frame(width: SidebarView.idealWidth, height: 600)
}

#Preview("Server locked") {
    ServerStateView()
        .environment(PreviewFixtures.state(.locked(message: "Another copy of Pennant is using this data folder.")))
        .frame(width: 900, height: 560)
}

#Preview("Server failed") {
    ServerStateView()
        .environment(PreviewFixtures.state(.failed(ServerFailure(kind: .startFailed, serverMessage: "The export folder could not be read."))))
        .frame(width: 900, height: 560)
}

#Preview("Settings") {
    SettingsView()
        .environment(PreviewFixtures.ready())
        .environment(AppRouting())
        .environment(Updates(driver: MemoryUpdater()))
}
#endif
