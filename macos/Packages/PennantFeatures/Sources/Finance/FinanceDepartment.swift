import FeatureCore
import PennantKit
import SwiftUI

/// Finance (SWIFTUI_REBUILD.md section 3.5; N12, D-071). Its report is the served department report (N4); Payroll &
/// Budget, Contracts, Free Agents and the Horizon Board are served views, read together by `OfficeStore`.
public enum FinanceDepartment: DepartmentModule {
    public static let id: DeptID = "finance"
    public static let title: LocalizedStringResource = "Finance"
    public static let symbol = "dollarsign.circle"
    public static let order = 6
    public static let views: [DepartmentViewDescriptor] = [
        DepartmentViewDescriptor(id: "report", title: "Report", symbol: "list.bullet.clipboard", keywords: ["money"]) {
            DepartmentReportView(department: id)
        },
        DepartmentViewDescriptor(id: "payrollBudget", title: "Payroll & Budget", symbol: "banknote", keywords: ["payroll", "budget"]) {
            PayrollView()
        },
        DepartmentViewDescriptor(id: "contracts", title: "Contracts", symbol: "doc.text", keywords: ["salaries"]) {
            ContractsView()
        },
        DepartmentViewDescriptor(id: "freeAgents", title: "Free Agents", symbol: "person.badge.plus", keywords: ["free agency", "signings"]) {
            FreeAgentsView()
        },
        DepartmentViewDescriptor(id: "horizonBoard", title: "Horizon Board", symbol: "calendar.day.timeline.left", keywords: ["control", "future seasons"]) {
            HorizonBoardView()
        },
    ]
}

extension AppModel {
    /// Whether a Finance or Medical view is drawn as updating (being read again, or read for an earlier key).
    func officeUpdating(_ view: OfficeStore.View) -> Bool { office.updating(view, for: storeKey) }
}
