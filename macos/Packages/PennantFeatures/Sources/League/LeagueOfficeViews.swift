import Charts
import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

// League Office's views (N12 Track B, D-072): Standings, Leaders, Org Comparison, Franchise History and Us vs Them.
// Each draws its served payload and nothing more: the served order, words, tones and sort keys; the view's choices are
// sent back exactly as served. Every table is a `TablePane` (the head at its height, the table filling the rest).

extension AppModel {
    func leagueOfficeUpdating(_ name: String) -> Bool { leagueOffice.updating(name, for: storeKey) }
}

/// A head with its served figures and lines beneath the title, and the view's choices on one line.
private struct HeadStack<Choices: View, Extra: View>: View {
    let title: Components.Schemas.Cell
    let lede: Components.Schemas.Claim
    let refreshing: Bool
    @ViewBuilder let choices: () -> Choices
    @ViewBuilder let extra: () -> Extra

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            OfficeHead(title: title, lede: lede, refreshing: refreshing)
            extra()
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .firstTextBaseline, spacing: 12) { choices() }
                VStack(alignment: .leading, spacing: 8) { choices() }
            }
        }
    }
}

/// A view's served sentence when it has nothing to show, on the content colour.
private struct EmptyPage: View {
    let title: Components.Schemas.Cell
    let lede: Components.Schemas.Claim
    let empty: Components.Schemas.Cell?
    let refreshing: Bool

    var body: some View {
        OfficePage {
            OfficeHead(title: title, lede: lede, refreshing: refreshing)
            if let empty { Text(verbatim: empty.display).foregroundStyle(.readableSecondary).help(detail: empty.hint) }
        }
    }
}

// MARK: Standings

/// Standings: every club of the league in one native table with its division, as the React page shows the league (the
/// served "All divisions", what the view opens on), or one division at a time, chosen above it; our place in the race as
/// facts in the head, and, beneath the table, the staff's rough read of the season (the odds and the posture, D-060: only
/// here, with their basis, never the headline).
public struct StandingsView: View {
    @Environment(AppModel.self) private var model
    @State private var chosen: String?

    public init() {}

    public var body: some View {
        let store = model.leagueOffice
        OfficeState(payload: store.standings, problem: store.problems["standings"]) { view in
            // The whole league first (served), then each division under its sub-league's name
            let sections = (view.all.map { [(group: String?.none, division: $0)] } ?? [])
                + view.groups.flatMap { group in group.divisions.map { (group: Optional(group.title.display), division: $0) } }
            let shownId = chosen ?? sections.first?.division.id
            if let shown = sections.first(where: { $0.division.id == shownId })?.division ?? sections.first?.division {
                OfficeTablePane(shown.table, id: "standings.\(shown.id)", name: shown.title.display, detailShare: 0.42) {
                    HeadStack(title: view.title, lede: view.lede, refreshing: model.leagueOfficeUpdating("standings")) {
                        ChoicePopover(
                            Text("Division"),
                            current: Text(verbatim: shown.title.display),
                            choices: sections.map { .init(verbatim: $0.division.title.display, hint: $0.group, selected: $0.division.id == shown.id) },
                            id: "standings.division"
                        ) { chosen = sections[$0].division.id }
                        if let summary = shown.summary {
                            Text(verbatim: summary.display).foregroundStyle(.readableSecondary).help(detail: summary.hint)
                        }
                    } extra: {
                        if !view.race.isEmpty {
                            // Our place in the race as figures: each its words and its served value
                            OfficeFigures(view.race).accessibilityIdentifier("standings.race")
                        }
                    }
                } notes: {
                    if let read = view.staffRead {
                        StaffReadCard(read: read)
                    } else if let why = view.staffReadWhy {
                        Text(verbatim: why.display).font(.callout).foregroundStyle(.readableSecondary).help(detail: why.hint)
                            .accessibilityIdentifier("standings.staffReadWhy")
                    }
                    ClaimLine(view.note, font: .callout)
                    if let note = shown.note { ClaimLine(note, font: .callout) }
                }
                .id(shown.id)
            } else {
                EmptyPage(title: view.title, lede: view.lede, empty: view.empty, refreshing: model.leagueOfficeUpdating("standings"))
            }
        }
        .task(id: model.storeKey) { await store.loadStandings(client: model.client, key: model.storeKey) }
    }
}

/// The staff's rough read of the season: the odds and the posture, each a claim with its basis, what it rests on and
/// what it leaves out. Drawn as a card beneath the table, never above the standings.
private struct StaffReadCard: View {
    let read: Components.Schemas.LeagueStaffRead

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: 8) {
                Text(verbatim: read.title.display).font(.headline).help(detail: read.title.hint).accessibilityAddTraits(.isHeader)
                ClaimLine(read.odds)
                ClaimLine(read.posture)
                if !read.reasons.isEmpty {
                    VStack(alignment: .leading, spacing: 3) {
                        ForEach(Array(read.reasons.enumerated()), id: \.offset) { _, reason in
                            Text(verbatim: reason.display).font(.callout).help(detail: reason.hint)
                        }
                    }
                }
                Text(verbatim: read.caveat.display).font(.callout).foregroundStyle(.readableSecondary).help(detail: read.caveat.hint)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("standings.staffRead")
    }
}

// MARK: Leaders

/// Leaders: batting or pitching, one category at a time, the league's top ten as a native table whose rows open their
/// players (and compare several).
public struct LeadersView: View {
    @Environment(AppModel.self) private var model
    @State private var group = 0
    @State private var category: [Int: Int] = [:]

    public init() {}

    public var body: some View {
        let store = model.leagueOffice
        OfficeState(payload: store.leaders, problem: store.problems["leaders"]) { view in
            let groupIndex = min(group, max(view.groups.count - 1, 0))
            if view.groups.indices.contains(groupIndex), !view.groups[groupIndex].sections.isEmpty {
                let sections = view.groups[groupIndex].sections
                let index = min(category[groupIndex] ?? 0, sections.count - 1)
                let shown = sections[index]
                OfficeTablePane(shown.table, id: "leaders.\(shown.id)", name: shown.title.display, detailShare: 0.3) {
                    HeadStack(title: view.title, lede: view.lede, refreshing: model.leagueOfficeUpdating("leaders")) {
                        if view.groups.count > 1 {
                            OfficeSectionPicker(titles: view.groups.map(\.title.display), selection: $group, id: "leaders.groups")
                        }
                        ChoicePopover(
                            Text("Category"),
                            current: Text(verbatim: shown.title.display),
                            choices: sections.enumerated().map { .init(verbatim: $0.element.title.display, hint: $0.element.title.hint, selected: $0.offset == index) },
                            id: "leaders.category"
                        ) { category[groupIndex] = $0 }
                    } extra: {
                        if let season = view.season { Text(verbatim: season.display).foregroundStyle(.readableSecondary).help(detail: season.hint) }
                    }
                } notes: {
                    if let qualifier = view.qualifier { ClaimLine(qualifier, font: .callout) }
                    if let note = shown.note { ClaimLine(note, font: .callout) }
                }
                .id(shown.id)
            } else {
                EmptyPage(title: view.title, lede: view.lede, empty: view.empty, refreshing: model.leagueOfficeUpdating("leaders"))
            }
        }
        .task(id: model.storeKey) { await store.loadLeaders(client: model.client, key: model.storeKey) }
    }
}

// MARK: Org Comparison

/// Org Comparison: our organization's figures (each a range with the league's middle), then every club of the league in
/// a native table, ours marked; a club's row shows its ranges and who is not counted, and opens the club.
public struct OrgComparisonView: View {
    @Environment(AppModel.self) private var model

    public init() {}

    public var body: some View {
        let store = model.leagueOffice
        OfficeState(payload: store.orgComparison, problem: store.problems["orgComparison"]) { view in
            if view.clubs.rows.isEmpty, view.empty != nil {
                EmptyPage(title: view.title, lede: view.lede, empty: view.empty, refreshing: model.leagueOfficeUpdating("orgComparison"))
            } else {
                OfficeTablePane(view.clubs, id: "orgComparison.clubs", name: view.title.display, detailShare: 0.38) {
                    HeadStack(title: view.title, lede: view.lede, refreshing: model.leagueOfficeUpdating("orgComparison")) {
                        if let freshness = view.freshness { ClaimLine(freshness, font: .callout) }
                    } extra: {
                        OfficeFigures(view.figures)
                    }
                } notes: {
                    ClaimLine(view.note, font: .callout)
                }
            }
        }
        .task(id: model.storeKey) { await store.loadOrgComparison(client: model.client, key: model.storeKey) }
    }
}

// MARK: Franchise History

/// Franchise History: the record (the club's figures and every season's wins as a chart, oldest first), every season as
/// a native table, and the GM's own seasons, chosen above.
public struct FranchiseHistoryView: View {
    @Environment(AppModel.self) private var model
    @SceneStorage("league.franchise.part") private var part = 0

    public init() {}

    public var body: some View {
        let store = model.leagueOffice
        OfficeState(payload: store.franchise, problem: store.problems["franchise"]) { view in
            let refreshing = model.leagueOfficeUpdating("franchise")
            let parts = partTitles(view)
            let shown = min(part, parts.count - 1)
            if view.seasons.table.rows.isEmpty {
                EmptyPage(title: view.title, lede: view.lede, empty: view.empty ?? view.seasons.table.empty, refreshing: refreshing)
            } else if shown == 1 {
                OfficeTablePane(view.seasons.table, id: "franchise.seasons", name: view.seasons.title.display, detailShare: 0.3) {
                    head(view, parts: parts, refreshing: refreshing)
                } notes: {
                    if let note = view.seasons.note { ClaimLine(note, font: .callout) }
                }
            } else if shown == 2, let tenure = view.tenure {
                OfficeTablePane(tenure.seasons.table, id: "franchise.tenure", name: tenure.title.display, detailShare: 0.3) {
                    VStack(alignment: .leading, spacing: 12) {
                        head(view, parts: parts, refreshing: refreshing)
                        Text(verbatim: tenure.lede.display).foregroundStyle(.readableSecondary).help(detail: tenure.lede.hint)
                        OfficeFigures(tenure.figures)
                    }
                } notes: {
                    if let note = tenure.seasons.note { ClaimLine(note, font: .callout) }
                }
            } else {
                OfficePage {
                    head(view, parts: parts, refreshing: refreshing)
                    OfficeFigures(view.figures)
                    if let chart = view.chart { SeasonRecordChart(chart: chart) }
                }
            }
        }
        .task(id: model.storeKey) { await store.loadFranchise(client: model.client, key: model.storeKey) }
    }

    private func partTitles(_ view: Components.Schemas.LeagueFranchiseView) -> [String] {
        [String(localized: "Record"), view.seasons.title.display] + (view.tenure.map { [$0.title.display] } ?? [])
    }

    private func head(_ view: Components.Schemas.LeagueFranchiseView, parts: [String], refreshing: Bool) -> some View {
        HeadStack(title: view.title, lede: view.lede, refreshing: refreshing) {
            OfficeSectionPicker(titles: parts, selection: $part, id: "franchise.part")
        } extra: {
            EmptyView()
        }
    }
}

/// The season record as Swift Charts: a bar per season, oldest first, its height the wins. Each way a season ended has a
/// fixed, checked colour (never the system accent) and a mark of its own, so colour is never the only signal: a title a
/// gold bar with a diamond above it, a playoff season a blue bar with a dot, a season that missed them a grey bar, and
/// a season whose ending the export doesn't record drawn hollow (D-018: never as a missed postseason). The legend is the
/// served words beside each mark; the chart is one image to VoiceOver with its served summary and a descriptor.
struct SeasonRecordChart: View {
    let chart: Components.Schemas.LeagueSeasonChart
    @State private var picked: String?

    var body: some View {
        // Each season is a category of its own (its year as written), so every bar has its width whatever the span
        let labelled = Set(Self.labelled(chart))
        let axis = chart.axis.display
        // The hollow bar's wall, in wins: a fixed share of the tallest season
        let wall = Double(max(chart.points.map(\.wins).max() ?? 1, 1)) * 0.02
        VStack(alignment: .leading, spacing: 8) {
            Text(verbatim: chart.title.display).font(.headline).help(detail: chart.title.hint).accessibilityAddTraits(.isHeader)
            Chart(chart.points, id: \.year) { point in
                let year = String(point.year)
                if point.result == "unknown" {
                    // Hollow: the outline in the readable grey, the page inside it
                    BarMark(x: .value("Season", year), yStart: .value(axis, 0), yEnd: .value(axis, point.wins), width: .ratio(0.8))
                        .foregroundStyle(Color.readableSecondary)
                    if Double(point.wins) > wall * 2 {
                        BarMark(x: .value("Season", year), yStart: .value(axis, wall), yEnd: .value(axis, Double(point.wins) - wall), width: .ratio(0.5))
                            .foregroundStyle(Color.readablePage)
                    }
                } else {
                    BarMark(x: .value("Season", year), y: .value(axis, point.wins), width: .ratio(0.8))
                        .foregroundStyle(Self.fill(point.result))
                }
                if point.result == "title" {
                    PointMark(x: .value("Season", year), y: .value(axis, point.wins))
                        .symbol(.diamond).symbolSize(28).offset(y: -8)
                        .foregroundStyle(Color.readableChartTitle)
                } else if point.result == "playoffs" {
                    PointMark(x: .value("Season", year), y: .value(axis, point.wins))
                        .symbol(.circle).symbolSize(16).offset(y: -7)
                        .foregroundStyle(Color.readableChartPlayoffs)
                }
                if let picked, picked == year {
                    RuleMark(x: .value("Season", year))
                        .foregroundStyle(Color.readableSecondary.opacity(0.4))
                        .annotation(position: .top, overflowResolution: .init(x: .fit(to: .chart), y: .disabled)) {
                            // On a fixed, checked page, never a system background (macOS 26 draws them differently)
                            Text(verbatim: point.display).font(.callout).padding(6)
                                .background(Color.readablePage, in: RoundedRectangle(cornerRadius: 6))
                                .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Color.readableSecondary.opacity(0.35)))
                        }
                }
            }
            .chartXSelection(value: $picked)
            .chartXAxis {
                AxisMarks { value in
                    if let year = value.as(String.self), labelled.contains(year) {
                        AxisGridLine()
                        AxisValueLabel { Text(verbatim: year) }
                    }
                }
            }
            .chartLegend(.hidden)
            // Room above the bars for a season's words while it is pointed at, clear of the chart's title
            .padding(.top, 28)
            .frame(height: 248)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: chart.title.display))
            .accessibilityValue(Text(verbatim: chart.summary))
            .accessibilityChartDescriptor(SeasonChartDescriptor(chart: chart))
            .accessibilityIdentifier("franchise.chart")
            SeasonChartLegend(legend: chart.legend)
            ClaimLine(chart.caption, font: .callout)
        }
    }

    /// A result's fixed fill (the codes are structural; their words are served in the legend).
    static func fill(_ result: String) -> Color {
        switch result {
        case "title": .readableChartTitle
        case "playoffs": .readableChartPlayoffs
        default: .readableChartOther
        }
    }

    /// The years the axis names: every one on a short history, else a round year every few so about a dozen show.
    static func labelled(_ chart: Components.Schemas.LeagueSeasonChart) -> [String] {
        let years = chart.points.map(\.year)
        guard years.count > 12 else { return years.map(String.init) }
        let step = [5, 10, 20, 25, 50].first { years.count / $0 <= 12 } ?? 50
        return years.filter { $0 % step == 0 }.map(String.init)
    }
}

/// The chart's legend: each served result's words beside its own swatch and mark, as the bars draw them (a gold bar and
/// diamond, a blue bar and dot, a grey bar, a hollow bar), wrapping on a narrow window.
struct SeasonChartLegend: View {
    let legend: [Components.Schemas.LeagueChartLegend]

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 16) { entries }
            VStack(alignment: .leading, spacing: 4) { entries }
        }
        .font(.callout)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("franchise.legend")
    }

    private var entries: some View {
        ForEach(legend, id: \.result) { entry in
            HStack(spacing: 5) {
                swatch(entry.result)
                Text(verbatim: entry.text.display).foregroundStyle(.readableSecondary)
            }
            .help(detail: entry.text.hint)
        }
    }

    @ViewBuilder
    private func swatch(_ result: String) -> some View {
        ZStack {
            if result == "unknown" {
                RoundedRectangle(cornerRadius: 2).strokeBorder(Color.readableSecondary, lineWidth: 1.5)
            } else {
                RoundedRectangle(cornerRadius: 2).fill(SeasonRecordChart.fill(result))
            }
            if result == "title" {
                Image(systemName: "diamond.fill").font(.system(size: 6)).foregroundStyle(Color.readablePage)
            } else if result == "playoffs" {
                Circle().fill(Color.readablePage).frame(width: 4, height: 4)
            }
        }
        .frame(width: 12, height: 12)
        .accessibilityHidden(true)
    }
}

/// VoiceOver's description of the season chart: every season's served words along the years.
struct SeasonChartDescriptor: AXChartDescriptorRepresentable {
    let chart: Components.Schemas.LeagueSeasonChart

    func makeChartDescriptor() -> AXChartDescriptor {
        let years = chart.points.map { Double($0.year) }
        let wins = chart.points.map { Double($0.wins) }
        let x = AXNumericDataAxisDescriptor(title: String(localized: "Season"), range: (years.min() ?? 0)...(years.max() ?? 1), gridlinePositions: []) {
            String(Int($0))
        }
        let y = AXNumericDataAxisDescriptor(title: chart.axis.display, range: 0...(max(wins.max() ?? 1, 1)), gridlinePositions: []) { String(Int($0)) }
        let series = AXDataSeriesDescriptor(name: chart.title.display, isContinuous: false, dataPoints: chart.points.map {
            AXDataPoint(x: Double($0.year), y: Double($0.wins), additionalValues: [], label: $0.display)
        })
        return AXChartDescriptor(title: chart.title.display, summary: chart.summary, xAxis: x, yAxis: y, additionalAxes: [], series: [series])
    }
}

// MARK: Us vs Them

/// Us vs Them: our club beside one other, as facts. The club is chosen above (the served choices, sent back as served),
/// their meetings this season beneath the head, and the season, at the plate and on the mound as tables.
public struct UsVsThemView: View {
    @Environment(AppModel.self) private var model
    @State private var team: Int?
    @State private var section = 0

    public init() {}

    public var body: some View {
        let store = model.leagueOffice
        let name = LeagueOfficeStore.usVsThemName(team)
        OfficeState(payload: store.usVsThem(team) ?? store.usVsThem(nil), problem: store.problems[name]) { view in
            let refreshing = model.leagueOfficeUpdating(name) || store.usVsThem(team) == nil
            let index = min(section, max(view.sections.count - 1, 0))
            if view.sections.indices.contains(index) {
                let shown = view.sections[index]
                OfficeTablePane(shown.table, id: "usVsThem.\(shown.id)", name: shown.title.display, detailShare: 0.34) {
                    HeadStack(title: view.title, lede: view.lede, refreshing: refreshing) {
                        let choices = view.opponents.choices
                        if !choices.isEmpty {
                            ChoicePopover(
                                Text(verbatim: view.opponents.title.display),
                                current: Text(verbatim: choices.first(where: \.selected)?.text.display ?? choices[0].text.display),
                                choices: choices.map { .init(verbatim: $0.text.display, hint: $0.text.hint, selected: $0.selected) },
                                id: "usVsThem.opponent"
                            ) {
                                team = Int(choices[$0].value)
                            }
                        }
                        if view.sections.count > 1 {
                            OfficeSectionPicker(titles: view.sections.map(\.title.display), selection: $section, id: "usVsThem.sections")
                        }
                    } extra: {
                        if let opened = view.opened, team == nil {
                            Text(verbatim: opened.display).font(.callout).foregroundStyle(.readableSecondary).help(detail: opened.hint)
                        }
                        if let headToHead = view.headToHead { ClaimLine(headToHead) }
                    }
                } notes: {
                    if let meetings = view.meetings { OfficeBlock(meetings) }
                    if let note = shown.note { ClaimLine(note, font: .callout) }
                    ClaimLine(view.note, font: .callout)
                }
                .id("\(view.query.team)-\(index)")
            } else {
                EmptyPage(title: view.title, lede: view.lede, empty: view.empty, refreshing: refreshing)
            }
        }
        .task(id: UsVsThemTask(key: model.storeKey, team: team)) { await store.loadUsVsThem(team, client: model.client, key: model.storeKey) }
        // Another save or club: the club chosen belonged to the last one, so the view opens on the server's choice again
        // (never asking the new one for a club it may not have)
        .onChange(of: StoreIdentity(model.storeKey)) { team = nil }
    }
}

/// A store key's save and club, without its stamps: what changes the clubs a view can choose among.
private struct StoreIdentity: Equatable {
    let saveId: String?
    let club: ClubRef?

    init(_ key: AppModel.StoreKey?) {
        saveId = key?.saveId
        club = key?.club
    }
}

private struct UsVsThemTask: Hashable {
    let key: AppModel.StoreKey?
    let team: Int?
}
