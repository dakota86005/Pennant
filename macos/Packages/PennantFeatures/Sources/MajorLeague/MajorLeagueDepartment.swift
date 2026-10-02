import FeatureCore
import PennantKit
import SwiftUI

/// Major League Ops (SWIFTUI_REBUILD.md section 3.5). Its report is the served department report (N4); the
/// other views are structural placeholders until their milestones build them.
public enum MajorLeagueDepartment: DepartmentModule {
    public static let id: DeptID = "majorLeague"
    public static let title: LocalizedStringResource = "Major League Ops"
    public static let symbol = "baseball"
    public static let order = 2
    public static let views: [DepartmentViewDescriptor] = [
        DepartmentViewDescriptor(id: "report", title: "Report", symbol: "list.bullet.clipboard", keywords: ["mlb"]) {
            DepartmentReportView(department: id)
        },
        .placeholder(id: "positionPlayers", title: "Position Players", symbol: "person.3", keywords: ["hitters", "batters"]),
        .placeholder(id: "pitchingStaff", title: "Pitching Staff", symbol: "figure.baseball", keywords: ["pitchers", "rotation", "bullpen"]),
        .placeholder(id: "benchBackups", title: "Bench & Backups", symbol: "chair", keywords: ["bench", "backups"]),
        .placeholder(id: "decision", title: "Decision", symbol: "checkmark.seal", keywords: ["moves", "roster"]),
        .placeholder(id: "lineup", title: "Lineup", symbol: "list.number", keywords: ["batting order"]),
        .placeholder(id: "pitchingAvailability", title: "Pitching Availability", symbol: "calendar.badge.clock", keywords: ["rest", "bullpen"]),
        .placeholder(id: "scheduleGamePlans", title: "Schedule & Game Plans", symbol: "calendar", keywords: ["games", "opponents"]),
        .placeholder(id: "depthChart", title: "Depth Chart", symbol: "square.grid.3x3", keywords: ["positions"]),
        .placeholder(id: "fortyManOptions", title: "40-Man & Options", symbol: "person.crop.rectangle.stack", keywords: ["40-man", "options", "roster"]),
        .placeholder(id: "rosters", title: "Rosters", symbol: "person.text.rectangle", keywords: ["roster"]),
        .placeholder(id: "seasonTrends", title: "Season Trends", symbol: "chart.line.uptrend.xyaxis", keywords: ["trends"]),
    ]
}
