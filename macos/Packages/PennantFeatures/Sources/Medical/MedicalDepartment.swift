import FeatureCore
import PennantKit
import SwiftUI

/// Medical (SWIFTUI_REBUILD.md section 3.5). Its report is the served department report (N4); the
/// other views are structural placeholders until their milestones build them.
public enum MedicalDepartment: DepartmentModule {
    public static let id: DeptID = "medical"
    public static let title: LocalizedStringResource = "Medical"
    public static let symbol = "cross.case"
    public static let order = 7
    public static let views: [DepartmentViewDescriptor] = [
        DepartmentViewDescriptor(id: "report", title: "Report", symbol: "list.bullet.clipboard", keywords: ["health"]) {
            DepartmentReportView(department: id)
        },
        .placeholder(id: "injuryReport", title: "Injury Report", symbol: "bandage", keywords: ["injuries", "injured list"]),
    ]
}
