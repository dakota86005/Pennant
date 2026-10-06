import FeatureCore
import PennantKit
import SwiftUI

/// Trades (SWIFTUI_REBUILD.md section 3.5; N12 Track C, D-073): the Trade Desk, a served payload drawn natively (the
/// builder with its drop targets and the difference in Swift Charts, the inbox's offers and trade talk, the league's fits).
public enum TradesDepartment: DepartmentModule {
    public static let id: DeptID = "trades"
    public static let title: LocalizedStringResource = "Trades"
    public static let symbol = "arrow.left.arrow.right.circle"
    public static let order = 5
    public static let views: [DepartmentViewDescriptor] = [
        DepartmentViewDescriptor(id: "tradeDesk", title: "Trade Desk", symbol: "arrow.triangle.swap", keywords: ["offers", "builder", "analysis", "league fits"]) {
            TradeDeskView()
        },
    ]
}
