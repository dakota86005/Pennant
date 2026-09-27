import FeatureCore
import PennantKit
import SwiftUI

/// Finance (SWIFTUI_REBUILD.md section 3.5). Its report is the served department report (N4); the
/// other views are structural placeholders until their milestones build them.
public enum FinanceDepartment: DepartmentModule {
    public static let id: DeptID = "finance"
    public static let title: LocalizedStringResource = "Finance"
    public static let symbol = "dollarsign.circle"
    public static let order = 6
    public static let views: [DepartmentViewDescriptor] = [
        DepartmentViewDescriptor(id: "report", title: "Report", symbol: "list.bullet.clipboard", keywords: ["money"]) {
            DepartmentReportView(department: id)
        },
        .placeholder(id: "payrollBudget", title: "Payroll & Budget", symbol: "banknote", keywords: ["payroll", "budget"]),
        .placeholder(id: "contracts", title: "Contracts", symbol: "doc.text", keywords: ["salaries"]),
        .placeholder(id: "freeAgents", title: "Free Agents", symbol: "person.badge.plus", keywords: ["free agency", "signings"]),
        .placeholder(id: "horizonBoard", title: "Horizon Board", symbol: "calendar.day.timeline.left", keywords: ["control", "future seasons"]),
    ]
}
