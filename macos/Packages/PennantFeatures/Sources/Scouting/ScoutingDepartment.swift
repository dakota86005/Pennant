import FeatureCore
import PennantKit
import SwiftUI

/// Scouting (SWIFTUI_REBUILD.md section 3.5): the Draft Board and Player Search, built at N12 (Track B, D-072).
public enum ScoutingDepartment: DepartmentModule {
    public static let id: DeptID = "scouting"
    public static let title: LocalizedStringResource = "Scouting"
    public static let symbol = "binoculars"
    public static let order = 4
    public static let views: [DepartmentViewDescriptor] = [
        DepartmentViewDescriptor(id: "draftBoard", title: "Draft Board", symbol: "list.star", keywords: ["draft", "amateur"]) {
            DraftBoardView()
        },
        DepartmentViewDescriptor(id: "playerSearch", title: "Player Search", symbol: "magnifyingglass", keywords: ["find", "players"]) {
            PlayerSearchView()
        },
    ]
}
