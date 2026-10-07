import FeatureCore
import PennantKit
import SwiftUI

/// League Office (SWIFTUI_REBUILD.md section 3.5). The wire and the club reports are served (N7); Us vs Them, Standings,
/// Leaders, Org Comparison and Franchise History at N12 (Track B, D-072).
public enum LeagueDepartment: DepartmentModule {
    public static let id: DeptID = "league"
    public static let title: LocalizedStringResource = "League Office"
    public static let symbol = "globe"
    public static let order = 8
    public static let views: [DepartmentViewDescriptor] = [
        DepartmentViewDescriptor(id: "wire", title: "Wire", symbol: "antenna.radiowaves.left.and.right", keywords: ["transactions", "news"]) {
            WireView()
        },
        DepartmentViewDescriptor(id: "clubReports", title: "Club Reports", symbol: "building.2", keywords: ["other clubs", "opponents"]) {
            ClubReportsView()
        },
        DepartmentViewDescriptor(id: "usVsThem", title: "Us vs Them", symbol: "arrow.left.and.right.square", keywords: ["compare", "opponent"]) {
            UsVsThemView()
        },
        DepartmentViewDescriptor(id: "standings", title: "Standings", symbol: "trophy", keywords: ["division", "odds", "posture"]) {
            StandingsView()
        },
        DepartmentViewDescriptor(id: "leaders", title: "Leaders", symbol: "medal", keywords: ["leaderboards"]) {
            LeadersView()
        },
        DepartmentViewDescriptor(id: "orgComparison", title: "Org Comparison", symbol: "chart.bar", keywords: ["organizations"]) {
            OrgComparisonView()
        },
        DepartmentViewDescriptor(id: "franchiseHistory", title: "Franchise History", symbol: "clock.arrow.circlepath", keywords: ["history", "seasons"]) {
            FranchiseHistoryView()
        },
    ]
}
