import FeatureCore
import PennantKit
import SwiftUI

/// Front Office (SWIFTUI_REBUILD.md section 3.5). The Morning Report shows the served desk and department cards (N4);
/// the other views are structural placeholders until their milestones build them.
public enum FrontOfficeDepartment: DepartmentModule {
    public static let id: DeptID = "frontOffice"
    public static let title: LocalizedStringResource = "Front Office"
    public static let symbol = "building.2"
    public static let order = 1
    public static let views: [DepartmentViewDescriptor] = [
        DepartmentViewDescriptor(id: "morningReport", title: "Morning Report", symbol: "sun.horizon", keywords: ["today", "summary", "record", "desk"]) {
            MorningReportView()
        },
        .placeholder(id: "storylines", title: "Storylines", symbol: "text.book.closed", keywords: ["stories", "ai"]),
        .placeholder(id: "briefing", title: "GM Briefing", symbol: "doc.richtext", keywords: ["briefing", "ai"]),
    ]
}
