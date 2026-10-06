import FeatureCore
import PennantKit
import SwiftUI

/// Medical (SWIFTUI_REBUILD.md section 3.5; N12, D-071). Its report is the served department report (N4); the Injury
/// Report is a served view, read with Finance's by `OfficeStore`.
public enum MedicalDepartment: DepartmentModule {
    public static let id: DeptID = "medical"
    public static let title: LocalizedStringResource = "Medical"
    public static let symbol = "cross.case"
    public static let order = 7
    public static let views: [DepartmentViewDescriptor] = [
        DepartmentViewDescriptor(id: "report", title: "Report", symbol: "list.bullet.clipboard", keywords: ["health"]) {
            DepartmentReportView(department: id)
        },
        DepartmentViewDescriptor(id: "injuryReport", title: "Injury Report", symbol: "bandage", keywords: ["injuries", "injured list"]) {
            InjuryReportView()
        },
    ]
}
