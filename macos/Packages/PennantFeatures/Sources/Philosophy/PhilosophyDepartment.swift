import FeatureCore
import PennantKit
import SwiftUI

/// Philosophy & Staff (SWIFTUI_REBUILD.md section 3.5; N12 Track C, D-073): the Organizational Philosophy editor (a native
/// grouped form writing through the server, ⌘Z undoing) and Coaching Staff (a native table), each a served payload.
public enum PhilosophyDepartment: DepartmentModule {
    public static let id: DeptID = "philosophy"
    public static let title: LocalizedStringResource = "Philosophy & Staff"
    public static let symbol = "slider.horizontal.3"
    public static let order = 9
    public static let views: [DepartmentViewDescriptor] = [
        DepartmentViewDescriptor(id: "organizationalPhilosophy", title: "Organizational Philosophy", symbol: "scope", keywords: ["philosophy", "preferences"]) {
            OrganizationalPhilosophyView()
        },
        DepartmentViewDescriptor(id: "coachingStaff", title: "Coaching Staff", symbol: "person.3.sequence", keywords: ["coaches", "staff"]) {
            CoachingStaffView()
        },
    ]
}
