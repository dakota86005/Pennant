import FeatureCore
import PennantKit
import SwiftUI

/// Farm & Development (SWIFTUI_REBUILD.md section 3.5; N10): the served report, then the farm's views, each a served
/// payload (`/api/v2/views/:org/farm/…`) drawn natively. Decision opens on a player (the route's key).
public enum FarmDepartment: DepartmentModule {
    public static let id: DeptID = "farm"
    public static let title: LocalizedStringResource = "Farm & Development"
    public static let symbol = "leaf"
    public static let order = 3
    public static let views: [DepartmentViewDescriptor] = [
        DepartmentViewDescriptor(id: "report", title: "Report", symbol: "list.bullet.clipboard", keywords: ["minors"]) {
            DepartmentReportView(department: id)
        },
        DepartmentViewDescriptor(id: "organization", title: "Organization", symbol: "building.columns", keywords: ["system", "depth"]) {
            FarmOrganizationView()
        },
        DepartmentViewDescriptor(id: "affiliates", title: "Affiliates", symbol: "map", keywords: ["levels", "AAA", "AA"]) {
            FarmAffiliatesView()
        },
        DepartmentViewDescriptor(id: "assignments", title: "Assignments", symbol: "arrow.left.arrow.right", keywords: ["promotions", "placement"]) {
            FarmAssignmentsView()
        },
        DepartmentViewDescriptor(id: "prospects", title: "Prospects", symbol: "star", keywords: ["top prospects"]) {
            FarmProspectsView()
        },
        DepartmentViewDescriptor(id: "developmentTracking", title: "Development Tracking", symbol: "chart.bar.xaxis", keywords: ["development", "progress"]) {
            FarmDevelopmentView()
        },
        DepartmentViewDescriptor(id: "decision", title: "Decision", symbol: "checkmark.seal", keywords: ["moves"]) {
            FarmDecisionView()
        },
    ]
}
