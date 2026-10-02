import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

/// Decision (N8): with a need open (the route's key, from a desk item, the inbox or a view's action), the decision in
/// the GM's order; with none, the open needs as the department groups them and the what-if, each opening its decision.
struct DecisionView: View {
    @Environment(\.currentRoute) private var route

    var body: some View {
        if let need = route?.key {
            OpenDecision(need: need).id(need)
        } else {
            DecisionInbox()
        }
    }
}

/// The open needs, grouped and ordered as served, each opening its decision; the what-if beneath.
struct DecisionInbox: View {
    @Environment(AppModel.self) private var model
    @Environment(\.routeOpener) private var opener

    var body: some View {
        let store = model.majorLeague
        ViewState(payload: store.overview, problem: store.problems[.overview]) { overview in
            Page {
                ViewHead(title: model.servedViewName(department: "majorLeague", view: "decision").map { Text(verbatim: $0) } ?? Text("Decision"), lede: overview.lede, yardsticks: nil)
                if let empty = overview.inboxEmpty {
                    Text(verbatim: empty.display).foregroundStyle(.readableSecondary).help(detail: empty.hint)
                }
                ForEach(Array(overview.inbox.enumerated()), id: \.offset) { _, group in
                    NeedGroupView(group: group)
                }
                WhatIfPicker(whatIf: overview.whatIf)
            }
        }
        .loadsMajorLeague(.overview)
        .accessibilityIdentifier("majorLeague.decisionInbox")
    }
}

struct NeedGroupView: View {
    let group: Components.Schemas.MlbNeedGroup
    @State private var expanded: Bool
    @Environment(\.routeOpener) private var opener

    init(group: Components.Schemas.MlbNeedGroup) {
        self.group = group
        _expanded = State(initialValue: !group.collapsed)
    }

    var body: some View {
        DisclosureGroup(isExpanded: $expanded) {
            RowGroup {
                ForEach(Array(group.needs.enumerated()), id: \.element.needId) { index, need in
                    let target = route(need.open)
                    Button {
                        if let target { opener?.open(target) }
                    } label: {
                        VStack(alignment: .leading, spacing: 3) {
                            HStack(spacing: 6) {
                                CellText(need.badge)
                                Text(verbatim: need.kind.display).font(.callout).foregroundStyle(.readableSecondary)
                            }
                            Text(verbatim: need.title.display).font(.body.weight(.semibold))
                            Text(verbatim: need.summary.display).font(.callout).foregroundStyle(.readableSecondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .padding(.vertical, 8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .accessibilityElement(children: .combine)
                    .accessibilityAddTraits(.isButton)
                    .accessibilityIdentifier("need.\(need.needId)")
                    if index < group.needs.count - 1 { Divider() }
                }
            }
            .padding(.top, 6)
        } label: {
            Text(verbatim: group.title.display).font(.headline).help(detail: group.title.hint)
        }
    }
}

/// One decision, as served, in the GM's order: the problem, why it was flagged, the evidence, the staff's read and
/// call, the ways to respond followed through, every candidate, and the roster mechanics. The GM's choices (a
/// what-if's duration, the assignment to judge, the role for an open spot) are the served ones, sent back as served.
struct OpenDecision: View {
    let need: String
    @Environment(AppModel.self) private var model
    @State private var query: MajorLeagueStore.DecisionQuery
    /// The decision this view last showed (for any of this need's choices), kept while a new choice is read and said to
    /// be refreshing; tracked here rather than guessed from the store's first entry (the N8 review).
    @State private var lastShown: Components.Schemas.MlbDecisionView?

    init(need: String) {
        self.need = need
        _query = State(initialValue: MajorLeagueStore.DecisionQuery(need: need))
    }

    var body: some View {
        let store = model.majorLeague
        let current = store.decisions[query]
        let shown = current ?? lastShownForThisClub
        ViewState(payload: shown, problem: store.decisionProblems[query]) { decision in
            DecisionContent(
                decision: decision,
                refreshing: store.loadingDecisions.contains(query) || current == nil || model.storeKey.map { !store.isCurrent(decision, for: $0) } ?? false
            ) { choice in
                query = MajorLeagueStore.DecisionQuery(choice.query)
            }
        }
        .onChange(of: current, initial: true) { _, served in
            if let served { lastShown = served }
        }
        .task(id: TaskKey(key: model.storeKey, query: query)) { await model.loadDecision(query) }
        .accessibilityIdentifier("majorLeague.decision")
    }

    /// The last decision shown, only while it is the current club's (another club's is never drawn, M1).
    private var lastShownForThisClub: Components.Schemas.MlbDecisionView? {
        guard let lastShown, let key = model.storeKey else { return nil }
        if let club = key.club, club.id != lastShown.orgId { return nil }
        return lastShown
    }

    private struct TaskKey: Hashable {
        let key: AppModel.StoreKey?
        let query: MajorLeagueStore.DecisionQuery
    }
}

struct DecisionContent: View {
    let decision: Components.Schemas.MlbDecisionView
    let refreshing: Bool
    let choose: (Components.Schemas.MlbChoice) -> Void
    /// The decision as a document, or its candidates in their tables (which never sit inside the document's scroll view:
    /// the N8 crash, see `TablePane`): Show Candidates in the document and Show Decision above the tables move between
    /// them.
    @State private var part: Part = .decision

    enum Part: Hashable { case decision, candidates }

    private var tables: Components.Schemas.MlbCandidates? {
        guard let candidates = decision.candidates, !candidates.groups.isEmpty else { return nil }
        return candidates
    }

    var body: some View {
        Group {
            switch part {
            case .candidates where tables != nil:
                CandidatesPane(candidates: tables!) { part = .decision }
            default:
                document
            }
        }
        .background(Color.readablePage)
        // A container, so the decision's identifier does not replace its parts' own
        .accessibilityElement(children: .contain)
    }

    private var document: some View {
        Page {
            header
            if let duration = decision.duration { ChoicesView(choices: duration, choose: choose, id: "duration") }
            section(nil) { BlockView(decision.problem) }
            if let why = decision.why { WhyView(why: why) }
            if let picture = decision.picture { PictureView(picture: picture) }
            if let read = decision.read { section(nil) { BlockView(read) } }
            if let call = decision.call { CallView(call: call) }
            if let assignment = decision.assignment { ChoicesView(choices: assignment, choose: choose, id: "assignment") }
            if let responses = decision.responses { ResponsesView(responses: responses) }
            if let role = decision.roleChoice { ChoicesView(choices: role, choose: choose, id: "role") }
            if let candidates = decision.candidates { CandidatesSummary(candidates: candidates) { part = .candidates } }
            if let mechanics = decision.mechanics { MechanicsView(mechanics: mechanics) }
            Text(verbatim: decision.footnote.display).font(.callout).foregroundStyle(.readableSecondary)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Kicker(decision.kicker.display).foregroundStyle(.readableSecondary)
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                ClaimText(decision.headline, edge: .bottom) {
                    Text(verbatim: decision.headline.text)
                        .font(.system(size: 28, weight: .bold, design: .serif))
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if refreshing { ProgressView { Text("Refreshing") }.controlSize(.small) }
            }
            HStack(spacing: 6) {
                ForEach(Array(decision.badges.enumerated()), id: \.offset) { _, badge in
                    if Tone(badge.tone) == .neutral { Pill(badge.display, tone: .neutral) } else { CellText(badge) }
                }
            }
            ForEach(Array(decision.notes.enumerated()), id: \.offset) { _, note in
                Label { Text(verbatim: note.display) } icon: { Image(systemName: "flag").foregroundStyle(.readableSecondary) }
                    .font(.callout).foregroundStyle(.readableSecondary)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("decision.header")
    }

    @ViewBuilder
    private func section(_ title: String?, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if let title { MagazineSection(title: Text(verbatim: title)) }
            content()
        }
    }
}

/// The served choices: a segmented control when there are a few, a menu when there are more; the served one selected.
struct ChoicesView: View {
    let choices: Components.Schemas.MlbChoices
    let choose: (Components.Schemas.MlbChoice) -> Void
    let id: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(verbatim: choices.title.display).font(.headline)
            let selected = choices.choices.firstIndex { $0.selected }
            Picker(selection: Binding(get: { selected ?? -1 }, set: { index in
                if choices.choices.indices.contains(index) { choose(choices.choices[index]) }
            })) {
                ForEach(Array(choices.choices.enumerated()), id: \.offset) { index, choice in
                    Text(verbatim: choice.text.display).tag(index)
                }
            } label: {
                Text(verbatim: choices.title.display)
            }
            .labelsHidden()
            .modifier(ChoiceStyle(count: choices.choices.count))
            .fixedSize()
            .accessibilityIdentifier("choices.\(id)")
            if let note = choices.note {
                Text(verbatim: note.display).font(.callout).foregroundStyle(.readableSecondary).fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

private struct ChoiceStyle: ViewModifier {
    let count: Int
    func body(content: Content) -> some View {
        if count <= 4 { content.pickerStyle(.segmented) } else { content.pickerStyle(.menu) }
    }
}

/// Why it was flagged: the reading (its parts a click away), where he stands against his role's line, and the sections.
struct WhyView: View {
    let why: Components.Schemas.MlbWhy

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            MagazineSection(title: Text(verbatim: why.title.display))
            ClaimLine(why.claim)
            if let gauge = why.gauge { GaugeView(gauge: gauge) }
            ForEach(Array(why.blocks.enumerated()), id: \.offset) { _, block in BlockView(block) }
        }
    }
}

/// His working estimate against the role's lines on one 0 to 100 scale: the zones under the served lines, the typical
/// mark and his. Geometry only; every number and word is served.
struct GaugeView: View {
    let gauge: Components.Schemas.MlbGauge

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            GeometryReader { proxy in
                let w = proxy.size.width
                let x = { (v: Double) in CGFloat(max(0, min(100, v)) / 100) * w }
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.readableChipFill).frame(height: 10)
                    Rectangle().fill(Tone.bad.color.opacity(0.45)).frame(width: x(gauge.deepFloor), height: 10)
                    Rectangle().fill(Tone.caution.color.opacity(0.35)).frame(width: max(0, x(gauge.floor) - x(gauge.deepFloor)), height: 10)
                        .offset(x: x(gauge.deepFloor))
                    Rectangle().fill(Color.readableSecondary).frame(width: 2, height: 18).offset(x: x(gauge.typical) - 1)
                    Circle().fill(Color.primary).frame(width: 12, height: 12).offset(x: x(gauge.estimate) - 6)
                }
                .frame(height: 18)
                .overlay(alignment: .topLeading) {
                    Text(verbatim: gauge.typicalLabel.display).font(.caption).foregroundStyle(.readableSecondary)
                        .fixedSize().offset(x: min(max(0, x(gauge.typical) - 30), w - 70), y: 20)
                }
                .overlay(alignment: .topLeading) {
                    Text(verbatim: gauge.estimateLabel.display).font(.caption.weight(.semibold))
                        .fixedSize().offset(x: min(max(0, x(gauge.estimate) - 20), w - 60), y: -16)
                }
            }
            .frame(height: 40)
            .padding(.top, 14)
            Text(verbatim: gauge.key.display).font(.callout).foregroundStyle(.readableSecondary)
        }
        .frame(maxWidth: 520, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: gauge.spoken))
        .accessibilityIdentifier("decision.gauge")
    }
}

/// The role's picture: each man's lenses as bars on the served 0 to 100 scale (an unknown is its served words, no bar),
/// and the lines about him; the man under review set apart.
struct PictureView: View {
    let picture: Components.Schemas.MlbPicture

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            MagazineSection(title: Text(verbatim: picture.title.display))
            if let note = picture.note { Text(verbatim: note.display).font(.callout).foregroundStyle(.readableSecondary) }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 280), spacing: 12, alignment: .top)], alignment: .leading, spacing: 12) {
                ForEach(Array(picture.people.enumerated()), id: \.offset) { _, person in
                    Card {
                        VStack(alignment: .leading, spacing: 6) {
                            HStack(alignment: .firstTextBaseline, spacing: 6) {
                                if person.subject { Image(systemName: "scope").foregroundStyle(.readableSecondary).accessibilityHidden(true) }
                                PlayerNameText(player: person.player)
                                Text(verbatim: person.status.display).font(.callout).foregroundStyle(.readableSecondary)
                            }
                            ForEach(Array(person.lenses.enumerated()), id: \.offset) { _, lens in LensBar(lens: lens) }
                            ForEach(Array(person.lines.enumerated()), id: \.offset) { _, line in LineView(line: line) }
                        }
                    }
                    .accessibilityElement(children: .contain)
                }
            }
            DisclosureGroup {
                Text(verbatim: picture.basisNote.display).font(.callout).foregroundStyle(.readableSecondary).fixedSize(horizontal: false, vertical: true)
            } label: {
                Text("What This Comparison Is").font(.callout)
            }
        }
    }
}

struct LensBar: View {
    let lens: Components.Schemas.MlbLens

    var body: some View {
        HStack(spacing: 8) {
            Text(verbatim: lens.label.display).font(.callout).frame(width: 70, alignment: .leading)
            if let value = lens.value {
                GeometryReader { proxy in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Color.readableChipFill)
                        Capsule().fill(Color.readableSecondary).frame(width: proxy.size.width * CGFloat(max(0, min(100, value)) / 100))
                    }
                }
                .frame(height: 6)
                .accessibilityHidden(true)
            } else {
                Spacer(minLength: 0)
            }
            Text(verbatim: lens.display.display).font(.callout).monospacedDigit()
                .foregroundStyle(lens.value == nil ? Color.readableSecondary : Color.primary)
                .frame(width: 92, alignment: .trailing)
        }
        .accessibilityElement(children: .combine)
    }
}

/// The staff's call: its stance and confidence, the headline (its rubric, and any lean, a click away), its sections.
struct CallView: View {
    let call: Components.Schemas.MlbCall

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 8) {
                    Text(verbatim: call.title.display).font(.headline).accessibilityAddTraits(.isHeader)
                    CellText(call.stance)
                    Text(verbatim: call.confidence.display).font(.callout).foregroundStyle(.readableSecondary)
                }
                ClaimLine(call.headline, font: .title3.weight(.semibold))
                ForEach(Array(call.blocks.enumerated()), id: \.offset) { _, block in BlockView(block) }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("decision.call")
    }
}

/// The ways to respond, each followed through to what it does: its title, how certain its path is, its sections.
struct ResponsesView: View {
    let responses: Components.Schemas.MlbResponses

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            MagazineSection(title: Text(verbatim: responses.title.display))
            if let order = responses.order { Text(verbatim: order.display).font(.callout).foregroundStyle(.readableSecondary) }
            ForEach(Array(responses.plans.enumerated()), id: \.offset) { _, plan in
                Card {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Text(verbatim: plan.title.display).font(.headline)
                            CellText(plan.pathState)
                        }
                        ForEach(Array(plan.blocks.enumerated()), id: \.offset) { _, block in BlockView(block) }
                    }
                }
                .accessibilityElement(children: .contain)
            }
        }
        .accessibilityIdentifier("decision.responses")
    }
}

/// Every candidate, as the document says it: the groups Major League Ops gave them, each with how many, and the way to
/// their tables.
struct CandidatesSummary: View {
    let candidates: Components.Schemas.MlbCandidates
    let show: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            MagazineSection(title: Text(verbatim: candidates.title.display), trailing: String(candidates.count))
            if let empty = candidates.empty { Text(verbatim: empty.display).foregroundStyle(.readableSecondary) }
            ForEach(Array(candidates.groups.enumerated()), id: \.offset) { _, group in
                HStack(spacing: 6) {
                    Text(verbatim: group.title.display).font(.headline)
                    Text(verbatim: String(group.table.rows.count)).font(.callout).foregroundStyle(.readableSecondary).monospacedDigit()
                }
                .accessibilityElement(children: .combine)
            }
            if !candidates.groups.isEmpty {
                Button("Show Candidates", systemImage: "tablecells", action: show)
                    .accessibilityIdentifier("decision.showCandidates")
            }
            ForEach(Array(candidates.notConsidered.enumerated()), id: \.offset) { _, line in
                Text(verbatim: line.display).font(.callout).foregroundStyle(.readableSecondary)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("decision.candidates")
    }
}

/// Every candidate in his table, one group at a time (the groups Major League Ops gave them, in its order, the first one
/// served open chosen first): the table fills the column and the selected candidate's detail is beneath (`TablePane`).
struct CandidatesPane: View {
    let candidates: Components.Schemas.MlbCandidates
    /// Back to the decision's document (nil where the pane stands alone, in a preview).
    var showDecision: (() -> Void)?
    @State private var group: Int

    init(candidates: Components.Schemas.MlbCandidates, showDecision: (() -> Void)? = nil) {
        self.candidates = candidates
        self.showDecision = showDecision
        _group = State(initialValue: candidates.groups.firstIndex { !$0.collapsed } ?? 0)
    }

    var body: some View {
        let index = min(group, max(candidates.groups.count - 1, 0))
        if candidates.groups.indices.contains(index) {
            ServedTablePane(candidates.groups[index].table, id: "candidates.\(index)") {
                VStack(alignment: .leading, spacing: 10) {
                    if let showDecision {
                        Button("Show Decision", systemImage: "chevron.backward", action: showDecision)
                            .accessibilityIdentifier("candidates.showDecision")
                    }
                    MagazineSection(title: Text(verbatim: candidates.title.display), trailing: String(candidates.count))
                    if candidates.groups.count > 1 {
                        Picker(selection: $group) {
                            ForEach(Array(candidates.groups.enumerated()), id: \.offset) { index, group in
                                Text(verbatim: group.title.display).tag(index)
                            }
                        } label: {
                            Text("Group")
                        }
                        .labelsHidden()
                        .fixedSize()
                        .accessibilityIdentifier("candidates.group")
                    } else if let only = candidates.groups.first {
                        Text(verbatim: only.title.display).font(.headline)
                    }
                }
            } notes: {
                ForEach(Array(candidates.notConsidered.enumerated()), id: \.offset) { _, line in
                    Text(verbatim: line.display).font(.callout).foregroundStyle(.readableSecondary)
                }
            }
            .id(index)
            .accessibilityIdentifier("decision.candidateTables")
        }
    }
}

/// The roster mechanics: bringing a man back, the chain of moves, and every way to clear a spot by what it costs.
struct MechanicsView: View {
    let mechanics: Components.Schemas.MlbMechanics

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            MagazineSection(title: Text(verbatim: mechanics.title.display))
            ForEach(Array(mechanics.blocks.enumerated()), id: \.offset) { _, block in BlockView(block) }
            ForEach(Array(mechanics.constraints.enumerated()), id: \.offset) { _, constraint in
                VStack(alignment: .leading, spacing: 6) {
                    Text(verbatim: constraint.title.display).font(.headline)
                    Text(verbatim: constraint.note.display).font(.callout).foregroundStyle(.readableSecondary).fixedSize(horizontal: false, vertical: true)
                    ForEach(Array(constraint.flags.enumerated()), id: \.offset) { _, flag in CellText(flag) }
                    ForEach(Array(constraint.classes.enumerated()), id: \.offset) { _, kind in ClearingClassView(kind: kind) }
                }
            }
        }
        .accessibilityIdentifier("decision.mechanics")
    }
}

struct ClearingClassView: View {
    let kind: Components.Schemas.MlbConstraint.ClassesPayloadPayload
    @State private var expanded: Bool

    init(kind: Components.Schemas.MlbConstraint.ClassesPayloadPayload) {
        self.kind = kind
        _expanded = State(initialValue: !kind.collapsed)
    }

    var body: some View {
        DisclosureGroup(isExpanded: $expanded) {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 280), spacing: 12, alignment: .top)], alignment: .leading, spacing: 12) {
                ForEach(Array(kind.options.enumerated()), id: \.offset) { _, option in
                    Card { BlockView(option) }.accessibilityElement(children: .contain)
                }
            }
            .padding(.top, 6)
        } label: {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: kind.title.display).font(.body.weight(.semibold))
                Text(verbatim: kind.description.display).font(.callout).foregroundStyle(.readableSecondary)
            }
        }
    }
}
