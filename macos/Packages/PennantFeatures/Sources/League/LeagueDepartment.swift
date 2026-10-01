import FeatureCore
import PennantKit
import SwiftUI

/// League Office (SWIFTUI_REBUILD.md section 3.5). The wire and the club reports are served (N7); the other views are
/// structural placeholders until their milestones build them.
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
        .placeholder(id: "usVsThem", title: "Us vs Them", symbol: "arrow.left.and.right.square", keywords: ["compare", "opponent"]),
        .placeholder(id: "standings", title: "Standings", symbol: "trophy", keywords: ["division", "odds", "posture"]),
        .placeholder(id: "leaders", title: "Leaders", symbol: "medal", keywords: ["leaderboards"]),
        .placeholder(id: "orgComparison", title: "Org Comparison", symbol: "chart.bar", keywords: ["organizations"]),
        .placeholder(id: "franchiseHistory", title: "Franchise History", symbol: "clock.arrow.circlepath", keywords: ["history", "seasons"]),
    ]
}
