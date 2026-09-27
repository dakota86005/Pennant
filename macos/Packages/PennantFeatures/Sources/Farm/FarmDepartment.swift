import FeatureCore
import PennantKit
import SwiftUI

/// Farm & Development (SWIFTUI_REBUILD.md section 3.5). Its report is the served department report (N4); the
/// other views are structural placeholders until their milestones build them.
public enum FarmDepartment: DepartmentModule {
    public static let id: DeptID = "farm"
    public static let title: LocalizedStringResource = "Farm & Development"
    public static let symbol = "leaf"
    public static let order = 3
    public static let views: [DepartmentViewDescriptor] = [
        DepartmentViewDescriptor(id: "report", title: "Report", symbol: "list.bullet.clipboard", keywords: ["minors"]) {
            DepartmentReportView(department: id)
        },
        .placeholder(id: "organization", title: "Organization", symbol: "building.columns", keywords: ["system"]),
        .placeholder(id: "affiliates", title: "Affiliates", symbol: "map", keywords: ["levels", "AAA", "AA"]),
        .placeholder(id: "assignments", title: "Assignments", symbol: "arrow.left.arrow.right", keywords: ["promotions", "placement"]),
        .placeholder(id: "prospects", title: "Prospects", symbol: "star", keywords: ["top prospects"]),
        .placeholder(id: "developmentTracking", title: "Development Tracking", symbol: "chart.bar.xaxis", keywords: ["development", "progress"]),
        .placeholder(id: "decision", title: "Decision", symbol: "checkmark.seal", keywords: ["moves"]),
    ]
}
