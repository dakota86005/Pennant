import Charts
import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

// Payroll & Budget (N12): committed money by season in Swift Charts, against the club's budget as a rule, with what the
// seasons the club still controls could cost beside each bar as a range (never stacked on it: projected money is never
// committed, D-052); every season's words and room beneath the chart; who comes off the books and who stays; the budget
// the GM expects next season; and every contract, season by season, as a native table (the toolbar's second choice).

/// What Payroll shows: the seasons and the money, or every contract as a table.
enum PayrollMode: String, CaseIterable, Identifiable {
    case seasons, contracts
    var id: String { rawValue }
    var title: LocalizedStringResource {
        switch self {
        case .seasons: "Seasons"
        case .contracts: "Every Contract"
        }
    }
}

struct PayrollView: View {
    @Environment(AppModel.self) private var model
    @SceneStorage("payroll.mode") private var mode: PayrollMode = .seasons

    var body: some View {
        let store = model.office
        OfficeState(payload: store.payroll, problem: store.problems[OfficeStore.View.payrollBudget.rawValue]) { view in
            Group {
                switch mode {
                case .seasons: PayrollSeasonsPage(view: view, refreshing: model.officeUpdating(.payrollBudget), mode: $mode)
                case .contracts:
                    OfficeTablePane(view.contracts, id: "payroll.contracts", name: view.title.display, detailShare: 0.3) {
                        VStack(alignment: .leading, spacing: 10) {
                            OfficeHead(title: view.title, byline: view.byline, parts: view.bylineParts, lede: view.lede, freshness: view.freshness,
                                       refreshing: model.officeUpdating(.payrollBudget))
                            PayrollModePicker(mode: $mode)
                        }
                    } notes: {
                        EmptyView()
                    }
                }
            }
        }
        .task(id: model.storeKey) { await model.loadOffice() }
    }
}

/// Seasons or every contract: a segmented control in the view's head (in the toolbar it was crowded out at a narrow
/// width, beside the app's search and the inspector's buttons).
struct PayrollModePicker: View {
    @Binding var mode: PayrollMode

    var body: some View {
        Picker(selection: $mode) {
            ForEach(PayrollMode.allCases) { m in Text(m.title).tag(m) }
        } label: {
            Text("Show")
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .fixedSize()
        .accessibilityIdentifier("payroll.mode")
    }
}

/// The seasons and the money, as one page.
struct PayrollSeasonsPage: View {
    let view: Components.Schemas.FinancePayrollView
    let refreshing: Bool
    var mode: Binding<PayrollMode>? = nil

    var body: some View {
        // The head stays put above the page, as a TablePane's does: never under the toolbar's scroll edge
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 10) {
                OfficeHead(title: view.title, byline: view.byline, parts: view.bylineParts, lede: view.lede, freshness: view.freshness, refreshing: refreshing)
                if let mode { PayrollModePicker(mode: mode) }
            }
            .padding(.horizontal, 28).padding(.top, 16).padding(.bottom, 10)
            .frame(maxWidth: 1100, alignment: .leading)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                OfficeFigures(view.cards)
                VStack(alignment: .leading, spacing: 6) {
                    if let price = view.price { ClaimLine(price, font: .callout) }
                    if let costs = view.costs { ClaimLine(costs, font: .callout) }
                    if let history = view.priceHistory { ClaimLine(history, font: .callout) }
                }
                PayrollChart(view: view)
                PayrollSeasonsGrid(seasons: view.seasons)
                if let edges = view.edges { ClaimLine(edges, font: .callout) }
                BudgetEntry(entry: view.nextSeasonBudget)
                ForEach(view.sections, id: \.id) { section in
                    VStack(alignment: .leading, spacing: 8) {
                        ClaimText(section.explain, edge: .bottom) {
                            Text(verbatim: section.title.display).font(.headline)
                        }
                        OfficeTableGrid(table: section.table)
                    }
                    .accessibilityElement(children: .contain)
                    .accessibilityIdentifier("payroll.section.\(section.id)")
                }
                ClaimLine(view.deadMoney, font: .callout)
                }
                .padding(.horizontal, 28).padding(.vertical, 20)
                .frame(maxWidth: 1100, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color.readablePage)
    }
}

/// Committed salary by season as bars, the projected range beside each (hatched, never stacked), and each season's served
/// budget as a rule across its column: today's for this season, the budget the GM expects across the following seasons
/// only. One image element with its audio graph and the served summary.
struct PayrollChart: View {
    let view: Components.Schemas.FinancePayrollView
    @Environment(\.theme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @EffectiveContrast private var contrast

    private var accent: Color {
        let palette = theme.palette(colorScheme: colorScheme, contrast: contrast)
        return palette.isNeutral ? Color.accentColor : palette.accent
    }

    var body: some View {
        Chart {
            ForEach(view.seasons, id: \.season) { season in
                BarMark(
                    x: .value("Season", String(season.season)),
                    y: .value("Committed", season.committed),
                    width: .ratio(0.5)
                )
                .foregroundStyle(accent)
                .position(by: .value("Money", "Committed"))
                if let p = season.projected {
                    BarMark(
                        x: .value("Season", String(season.season)),
                        yStart: .value("Could be", p.low),
                        yEnd: .value("Could be", p.high),
                        width: .ratio(0.5)
                    )
                    .foregroundStyle(accent.opacity(0.25))
                    .position(by: .value("Money", "Projected"))
                    .annotation(position: .overlay) {
                        Rectangle().strokeBorder(accent, style: StrokeStyle(lineWidth: 1, dash: [3, 2]))
                    }
                }
            }
            // Each season's served budget as a short rule across its own column: today's for this season (and for the
            // later ones while no other is entered), the budget the GM expects across the following seasons only
            ForEach(Array(view.seasons.enumerated()), id: \.element.season) { index, season in
                if let budget = season.budget {
                    let expected = index > 0 && view.expectedBudget?.amount == budget
                    RectangleMark(
                        x: .value("Season", String(season.season)),
                        y: .value("Budget", budget),
                        width: .ratio(0.9),
                        height: .fixed(expected ? 1.5 : 2)
                    )
                    .foregroundStyle(Color.primary.opacity(expected ? 0.5 : 0.7))
                    .annotation(position: expected ? .bottom : .top, alignment: .leading) {
                        if index == 0 {
                            Text(verbatim: view.budget.label.display).font(.caption).foregroundStyle(.readableSecondary)
                        } else if expected, index == 1, let label = view.expectedBudget?.label {
                            Text(verbatim: label.display).font(.caption).foregroundStyle(.readableSecondary)
                        }
                    }
                }
            }
        }
        .chartYAxis {
            AxisMarks { value in
                AxisGridLine()
                AxisValueLabel {
                    if let dollars = value.as(Double.self) {
                        Text(dollars, format: .currency(code: "USD").notation(.compactName).precision(.fractionLength(0)))
                    }
                }
            }
        }
        .chartLegend(.hidden)
        .frame(height: 240)
        .accessibilityElement(children: .ignore)
        .accessibilityAddTraits(.isImage)
        .accessibilityLabel(Text("Committed salary by season"))
        .accessibilityValue(Text(verbatim: view.chartSummary.display))
        .accessibilityChartDescriptor(PayrollDescriptor(view: view))
        .accessibilityIdentifier("payroll.chart")
    }
}

/// A dollar figure on an audio graph's axis, as the chart's own axis prints it ("$150M"): a number, never a served label.
func audioGraphDollars(_ value: Double) -> String {
    value.formatted(.currency(code: "USD").notation(.compactName).precision(.fractionLength(0...1)))
}

/// The payroll chart's audio graph: each season across, the committed money up, the projected range as a second series
/// (its low edge, the high edge beside it), the budget a gridline, and the served sentence as the summary.
struct PayrollDescriptor: AXChartDescriptorRepresentable {
    let view: Components.Schemas.FinancePayrollView

    func makeChartDescriptor() -> AXChartDescriptor {
        let seasons = view.seasons.map { String($0.season) }
        let x = AXCategoricalDataAxisDescriptor(title: String(localized: "Season"), categoryOrder: seasons)
        let high = max(view.seasons.map { max($0.committed, $0.projected?.high ?? 0, $0.budget ?? 0) }.max() ?? 1, view.budget.amount ?? 0, 1)
        let y = AXNumericDataAxisDescriptor(
            title: String(localized: "Committed"),
            range: 0...high,
            gridlinePositions: view.budget.amount.map { [$0] } ?? [],
            valueDescriptionProvider: audioGraphDollars
        )
        let committed = AXDataSeriesDescriptor(
            name: String(localized: "Committed"),
            isContinuous: false,
            dataPoints: view.seasons.map { AXDataPoint(x: String($0.season), y: $0.committed, additionalValues: [], label: $0.claim.text) }
        )
        let projected = AXDataSeriesDescriptor(
            name: String(localized: "Could Come on Top"),
            isContinuous: false,
            dataPoints: view.seasons.compactMap { season in
                guard let p = season.projected else { return nil }
                return AXDataPoint(x: String(season.season), y: p.low, additionalValues: [.number(p.high)], label: season.projectedCell?.display)
            }
        )
        return AXChartDescriptor(title: String(localized: "Committed salary by season"), summary: view.chartSummary.display,
                                 xAxis: x, yAxis: y, additionalAxes: [], series: projected.dataPoints.isEmpty ? [committed] : [committed, projected])
    }
}

/// Each season's committed money, players, what could come on top and the room: a grid where there is room, a card per
/// season where there is not. A season's line opens everything about it.
struct PayrollSeasonsGrid: View {
    let seasons: [Components.Schemas.FinancePayrollSeason]

    var body: some View {
        ViewThatFits(in: .horizontal) {
            Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 18, verticalSpacing: 8) {
                ForEach(seasons, id: \.season) { season in
                    GridRow {
                        ClaimText(season.claim, edge: .trailing) {
                            Text(verbatim: String(season.season)).font(.headline).monospacedDigit()
                        }
                        CellText(season.committedCell).font(.headline).monospacedDigit()
                        CellText(season.playersCell, secondary: true)
                        if let projected = season.projectedCell { CellText(projected) } else { Text(verbatim: "") }
                        CellText(season.roomCell)
                    }
                }
            }
            VStack(alignment: .leading, spacing: 10) {
                ForEach(seasons, id: \.season) { season in
                    VStack(alignment: .leading, spacing: 2) {
                        ClaimText(season.claim, edge: .trailing) {
                            Text(verbatim: season.claim.text).font(.headline).monospacedDigit()
                        }
                        CellText(season.playersCell, secondary: true)
                        if let projected = season.projectedCell { CellText(projected) }
                        CellText(season.roomCell)
                    }
                }
            }
        }
        .font(.callout)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("payroll.seasons")
    }
}

/// The budget the GM expects next season: a field in millions, as the React page took it, saved on Return or when the
/// field loses focus; empty clears it. It shows the amount to the dollar, so saving it again never rounds it, and after a
/// change the served line says what it did; ⌘Z puts back what was there. A Pennant setting, never written to OOTP.
struct BudgetEntry: View {
    let entry: Components.Schemas.FinanceBudgetEntry
    @Environment(AppModel.self) private var model
    @Environment(\.undoManager) private var undoManager
    @State private var draft = ""
    @FocusState private var focused: Bool

    private var served: String { entry.amount.map(Self.millions) ?? "" }

    /// An amount in dollars as the field's millions, without losing a dollar: 123,456,700 is "123.4567", never "123.457".
    static func millions(_ amount: Double) -> String {
        let dollars = amount.rounded()
        let whole = Int64(dollars / 1_000_000)
        let rest = Int64(dollars) - whole * 1_000_000
        guard rest != 0 else { return String(whole) }
        var fraction = String(format: "%06lld", rest)
        while fraction.hasSuffix("0") { fraction.removeLast() }
        return "\(whole).\(fraction)"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(verbatim: entry.label.display)
                Text("$")
                TextField(text: $draft, prompt: entry.placeholder.map { Text(verbatim: String(Int($0))) }) {
                    Text(verbatim: entry.label.display)
                }
                .textFieldStyle(.roundedBorder)
                .frame(width: 96)
                .focused($focused)
                .onSubmit(save)
                .accessibilityIdentifier("payroll.budget")
                Text("million")
                if model.office.savingBudget { ProgressView().controlSize(.small) }
            }
            Text(verbatim: entry.help.display).font(.callout).foregroundStyle(.readableSecondary)
            if let done = model.office.budgetDone {
                Text(verbatim: done.display)
                    .font(.callout)
                    .foregroundStyle(.readableSecondary)
                    .help(detail: done.hint)
                    .accessibilityIdentifier("payroll.budgetDone")
            }
            if let problem = model.office.budgetProblem { ProblemLine(problem) }
        }
        .onAppear { draft = served }
        .onChange(of: entry.amount) { _, _ in if !focused { draft = served } }
        .onChange(of: focused) { _, now in if !now { save() } }
        .onChange(of: model.office.budgetDone) { _, done in
            if let done { AccessibilityNotification.Announcement(done.display).post() }
        }
    }

    private func save() {
        let trimmed = draft.trimmingCharacters(in: .whitespaces)
        let millions = Double(trimmed)
        let amount: Double? = trimmed.isEmpty ? nil : millions.map { ($0 * 1_000_000).rounded() }
        // Not a number: put back what is served (the server refuses only an amount it can't read)
        if !trimmed.isEmpty && millions == nil {
            draft = served
            return
        }
        guard amount != entry.amount else { return }
        Task { await model.setNextSeasonBudget(amount, undoManager: undoManager, actionName: String(localized: "Set Budget")) }
    }
}

/// A short served table drawn as a page's grid (N10's rule: never a `Table` inside a page's scroll view): its columns'
/// titles and each row's cells; a player's name opens his window.
struct OfficeTableGrid: View {
    let table: Components.Schemas.OfficeTable

    var body: some View {
        if table.rows.isEmpty {
            if let empty = table.empty { Text(verbatim: empty.display).foregroundStyle(.readableSecondary) }
        } else {
            Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 16, verticalSpacing: 5) {
                GridRow {
                    ForEach(table.columns, id: \.id) { column in
                        Text(verbatim: column.title.display).font(.caption.weight(.semibold)).foregroundStyle(.readableSecondary)
                    }
                }
                ForEach(table.rows, id: \.id) { row in
                    GridRow {
                        ForEach(table.columns, id: \.id) { column in
                            if let cell = row.cells.additionalProperties[column.id] {
                                if column.id == "player", let player = row.player {
                                    Text(verbatim: cell.display)
                                        .fontWeight(.medium)
                                        .playerName(id: player.playerId, name: player.name, opens: clubRef(opening: player.open))
                                } else if column.id == table.columns.last?.id, let claim = row.claims?.first {
                                    // The row's explanation (a projected cost's method, why a season is open) behind its last figure
                                    ClaimText(claim, edge: .trailing) { CellText(cell).monospacedDigit() }
                                } else {
                                    CellText(cell).monospacedDigit()
                                }
                            }
                        }
                    }
                }
            }
            .font(.callout)
        }
    }
}
