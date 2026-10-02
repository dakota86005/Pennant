import FeatureCore
import PennantKit
import SwiftUI

/// Major League Ops (SWIFTUI_REBUILD.md section 3.5): the bench coach's department. Its report (N4's anatomy, with the
/// staff at a glance and the what-if beneath), Position players, Pitching staff, Bench & Backups and Decision are drawn
/// from the served views (N8); the clubhouse tools are structural placeholders until N9 builds them.
public enum MajorLeagueDepartment: DepartmentModule {
    public static let id: DeptID = "majorLeague"
    public static let title: LocalizedStringResource = "Major League Ops"
    public static let symbol = "baseball"
    public static let order = 2
    public static let views: [DepartmentViewDescriptor] = [
        DepartmentViewDescriptor(id: "report", title: "Report", symbol: "list.bullet.clipboard", keywords: ["mlb"]) {
            MajorLeagueReportView()
        },
        DepartmentViewDescriptor(id: "positionPlayers", title: "Position Players", symbol: "person.3", keywords: ["hitters", "batters", "lineup"]) {
            PositionPlayersView()
        },
        DepartmentViewDescriptor(id: "pitchingStaff", title: "Pitching Staff", symbol: "figure.baseball", keywords: ["pitchers", "rotation", "bullpen"]) {
            PitchingStaffView()
        },
        DepartmentViewDescriptor(id: "benchBackups", title: "Bench & Backups", symbol: "chair", keywords: ["bench", "backups"]) {
            BenchBackupsView()
        },
        DepartmentViewDescriptor(id: "decision", title: "Decision", symbol: "checkmark.seal", keywords: ["moves", "roster", "what if"]) {
            DecisionView()
        },
        .placeholder(id: "lineup", title: "Lineup", symbol: "list.number", keywords: ["batting order"]),
        .placeholder(id: "pitchingAvailability", title: "Pitching Availability", symbol: "calendar.badge.clock", keywords: ["rest", "bullpen"]),
        .placeholder(id: "scheduleGamePlans", title: "Schedule & Game Plans", symbol: "calendar", keywords: ["games", "opponents"]),
        .placeholder(id: "depthChart", title: "Depth Chart", symbol: "square.grid.3x3", keywords: ["positions"]),
        .placeholder(id: "fortyManOptions", title: "40-Man & Options", symbol: "person.crop.rectangle.stack", keywords: ["40-man", "options", "roster"]),
        .placeholder(id: "rosters", title: "Rosters", symbol: "person.text.rectangle", keywords: ["roster"]),
        .placeholder(id: "seasonTrends", title: "Season Trends", symbol: "chart.line.uptrend.xyaxis", keywords: ["trends"]),
    ]
}
