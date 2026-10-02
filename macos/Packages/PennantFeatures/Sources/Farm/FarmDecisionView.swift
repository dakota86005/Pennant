import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

/// Farm & Development ▸ Decision (N10): one player's assignment in the order a GM decides, every word served. Opened on a
/// player (the route's subject: a desk item, a row, a name); opened on its own, it lists the assignments in question to
/// choose from. The cascade is drawn as numbered steps on a rail that ends at its served stop; a hole it leaves open is
/// information in the content's own colours, never an error. Nothing here is a transaction.
public struct FarmDecisionView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.routeSubject) private var subject

    public init() {}

    public var body: some View {
        if let id = subject.flatMap(Int.init) {
            DecisionForPlayer(playerId: id)
        } else {
            DecisionIndex()
        }
    }
}

/// One player's Decision, read for the current key (ahead on the server for the desk's players and every assignment in
/// question; else on this request).
struct DecisionForPlayer: View {
    @Environment(AppModel.self) private var model
    let playerId: Int

    var body: some View {
        let farm = model.farm
        let name = "decision:\(playerId)"
        FarmLoading(payload: farm.decisions[playerId], problem: farm.decisions[playerId] == nil ? farm.problems[name] : nil) { view in
            FarmPage(
                view: "decision",
                head: .init(preparedBy: view.preparedBy, asOf: view.asOf),
                deck: nil,
                updating: farm.isStale(name, for: model.storeKey),
                problem: farm.decisions[playerId] != nil ? farm.problems[name] : nil,
                headline: view.name,
                deckText: view.line.display,
                decorate: { AnyView($0.farmPlayer(id: view.playerId, name: view.name, open: nil)) }
            ) {
                DecisionContent(view: view)
            }
        }
        .task(id: model.storeKey) { await model.loadFarmDecision(playerId) }
    }
}

/// Decision opened on its own: the assignments in question, to open one.
struct DecisionIndex: View {
    @Environment(AppModel.self) private var model
    @Environment(\.routeOpener) private var opener
    @State private var selection: Set<String> = []

    var body: some View {
        let farm = model.farm
        FarmLoading(payload: farm.assignments, problem: farm.assignments == nil ? farm.problems["assignments"] : nil) { view in
            let rows = view.rows.filter(\.inQuestion)
            VStack(alignment: .leading, spacing: 0) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Choose a player to decide on").font(.title3.weight(.semibold)).accessibilityAddTraits(.isHeader)
                    Text(verbatim: view.order.display).font(.callout).foregroundStyle(.readableSecondary).help(detail: view.order.hint)
                }
                .padding(.horizontal, 16).padding(.vertical, 12)
                Table(of: Components.Schemas.FarmAssignmentRow.self, selection: $selection) {
                    TableColumn("Player") { CellText($0.cells.player).fontWeight(.medium) }
                    TableColumn("Club") { CellText($0.cells.club) }
                    TableColumn("Conclusion") { CellText($0.cells.conclusion) }
                } rows: {
                    ForEach(rows) { row in TableRow(row).draggable(PlayerRef(id: row.playerId)) }
                }
                .contextMenu(forSelectionType: String.self) { ids in
                    if let row = rows.first(where: { ids.contains($0.id) }) {
                        FarmPlayerMenu(id: row.playerId, name: row.cells.player.display, open: row.open)
                    }
                } primaryAction: { ids in
                    if let row = rows.first(where: { ids.contains($0.id) }) { openServed(row.open, with: opener) }
                }
                .overlay {
                    if rows.isEmpty {
                        Text(verbatim: view.emptyInQuestion.display).foregroundStyle(.readableSecondary).multilineTextAlignment(.center).padding(40)
                    }
                }
                .accessibilityIdentifier("farm.decision.index")
            }
        }
        .loadsFarm()
    }
}

struct DecisionContent: View {
    let view: Components.Schemas.FarmDecisionView
    @Environment(\.routeOpener) private var opener

    var body: some View {
        VStack(alignment: .leading, spacing: 26) {
            // Who he is and where things stand
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 10) {
                    ClaimText(view.conclusion, edge: .bottom) { Pill(view.conclusion.text, tone: Tone(view.conclusion.tone)) }
                    ClaimText(view.stakes, edge: .bottom) {
                        Text(verbatim: view.stakes.text).font(.callout).foregroundStyle(.readableSecondary)
                    }
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("farm.decision.head")

            NumberedSection(number: 1, title: "Why his assignment is being reviewed") {
                ServedLines(lines: view.why)
            }
            NumberedSection(number: 2, title: "What Player Development says") {
                ServedClaimLine(view.verdict)
                if !view.verdictParts.isEmpty {
                    Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 4) {
                        ForEach(view.verdictParts, id: \.id) { row in
                            GridRow(alignment: .firstTextBaseline) {
                                Text(verbatim: row.cells.label.display).foregroundStyle(.readableSecondary)
                                CellText(row.cells.value).fontWeight(.semibold)
                                Text(verbatim: row.cells.why.display).foregroundStyle(.readableSecondary).fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                    .font(.callout)
                }
                if !view.stakesReasons.isEmpty {
                    LabeledLines(title: "Developmental stakes", lines: view.stakesReasons)
                }
                Fold {
                    FactGrid(rows: view.results)
                } label: {
                    Text("His results, against his league and park-adjusted")
                }
            }
            NumberedSection(number: 3, title: "Other defensible assignments", note: view.alternativesNote) {
                if let empty = view.alternativesEmpty {
                    Text(verbatim: empty.display).foregroundStyle(.readableSecondary).fixedSize(horizontal: false, vertical: true)
                }
                ForEach(view.alternatives, id: \.id) { alt in
                    AlternativeRow(row: alt)
                }
            }
            NumberedSection(number: 4, title: "What he is getting where he is", note: view.opportunityNote) {
                if let line = view.opportunity { CellText(line).fixedSize(horizontal: false, vertical: true) }
                if !view.work.isEmpty {
                    Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 4) {
                        ForEach(view.work, id: \.id) { row in
                            GridRow(alignment: .firstTextBaseline) {
                                Text(verbatim: row.cells.read.display).fontWeight(.semibold)
                                CellText(row.cells.level)
                                Text(verbatim: row.cells.why.display).foregroundStyle(.readableSecondary).fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                    .font(.callout)
                }
                if let missing = view.workMissing { UnknownLine(cell: missing) }
                if let change = view.roleChange { CellText(change).fixedSize(horizontal: false, vertical: true) }
                if let ahead = view.ahead { CellText(ahead).fixedSize(horizontal: false, vertical: true) }
                if !view.aheadPlayers.isEmpty {
                    HStack(spacing: 12) {
                        ForEach(view.aheadPlayers, id: \.playerId) { FarmPlayerName(player: $0).font(.callout) }
                    }
                }
                if let gone = view.gone { CellText(gone, secondary: true).fixedSize(horizontal: false, vertical: true) }
            }
            NumberedSection(number: 5, title: "What follows if he moves", note: view.consequenceNote) {
                if let problem = view.consequenceProblem { UnknownLine(cell: problem) }
                if let consequence = view.consequence { ConsequenceView(consequence: consequence) }
            }
            if let retention = view.retention {
                NumberedSection(number: 6, title: "His case for a roster spot", note: retention.note) {
                    Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 6) {
                        ForEach(retention.rows, id: \.id) { row in
                            GridRow(alignment: .firstTextBaseline) {
                                Text(verbatim: row.cells.label.display).fontWeight(.semibold)
                                CellText(row.cells.value)
                                Text(verbatim: row.cells.why.display).foregroundStyle(.readableSecondary).fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                    .font(.callout)
                    ServedLines(lines: retention.guardrails, font: .callout)
                }
            }
            NumberedSection(number: view.retention == nil ? 6 : 7, title: "What is uncertain") {
                if let empty = view.uncertainEmpty { Text(verbatim: empty.display).foregroundStyle(.readableSecondary) }
                ForEach(Array(view.uncertain.enumerated()), id: \.offset) { _, line in UnknownLine(cell: line) }
                if !view.wouldSettle.isEmpty { LabeledLines(title: "What would settle it", lines: view.wouldSettle) }
            }
            NumberedSection(number: view.retention == nil ? 7 : 8, title: "What remains your decision") {
                ServedLines(lines: view.yours)
                Fold {
                    Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 4) {
                        ForEach(view.owners, id: \.id) { row in
                            GridRow(alignment: .firstTextBaseline) {
                                Text(verbatim: row.cells.label.display)
                                Text(verbatim: row.cells.value.display).fontWeight(.semibold)
                                Text(verbatim: row.cells.why.display).foregroundStyle(.readableSecondary).fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                    .font(.callout)
                } label: {
                    Text("Who decided what")
                }
            }
        }
        .accessibilityIdentifier("farm.decision.\(view.playerId)")
    }
}

/// A numbered section of the Decision: the number, a structural title, a served note, the content.
struct NumberedSection<Content: View>: View {
    let number: Int
    let title: LocalizedStringResource
    var note: Components.Schemas.Cell?
    @ViewBuilder let content: () -> Content

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            Text(verbatim: String(number))
                .font(.title3.weight(.bold)).monospacedDigit()
                .frame(width: 28, height: 28)
                .background(Color.secondary.opacity(0.15), in: .circle)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 8) {
                Text(title).font(.title3.weight(.semibold)).accessibilityAddTraits(.isHeader)
                if let note {
                    Text(verbatim: note.display).font(.callout).foregroundStyle(.readableSecondary).fixedSize(horizontal: false, vertical: true)
                }
                content()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }
}

/// Labels and values, two columns.
struct FactGrid: View {
    let rows: [Components.Schemas.FarmFactRow]

    var body: some View {
        Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 4) {
            ForEach(rows, id: \.id) { row in
                GridRow(alignment: .firstTextBaseline) {
                    Text(verbatim: row.cells.label.display).foregroundStyle(.readableSecondary)
                    CellText(row.cells.value).fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .font(.callout)
    }
}

/// Another assignment, as Player Development judged it and the club leans on it, and whether he would play there.
struct AlternativeRow: View {
    let row: Components.Schemas.FarmAlternativeRow

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(verbatim: row.cells.assignment.display).fontWeight(.semibold)
                Pill(row.cells.development.display, tone: Tone(row.cells.development.tone))
                CellText(row.cells.philosophy, secondary: true)
            }
            CellText(row.cells.play).font(.callout).fixedSize(horizontal: false, vertical: true)
            if !row.notes.isEmpty { ServedLines(lines: row.notes, font: .callout) }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}

/// What follows if he moves: the served summary, the club with and without him, whose time changes, who could take the
/// job, then the chain.
struct ConsequenceView: View {
    let consequence: Components.Schemas.FarmConsequenceView

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ServedClaimLine(consequence.summary, font: .body.weight(.semibold))
            if !consequence.impact.isEmpty { FactGrid(rows: consequence.impact) }
            if !consequence.playingTime.isEmpty {
                LabeledLines(title: "Whose playing time changes", lines: consequence.playingTime)
            }
            if !consequence.replacements.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Who could take the job").font(.callout.weight(.semibold))
                    ForEach(consequence.replacements, id: \.playerId) { r in
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Pill(r.judgment.display, tone: Tone(r.judgment.tone))
                            Text(verbatim: r.name).fontWeight(.medium).farmPlayer(id: r.playerId, name: r.name, open: r.open)
                            CellText(r.from, secondary: true)
                            if let pref = r.preference { CellText(pref, secondary: true) }
                        }
                        .font(.callout)
                    }
                }
            }
            if let cascade = consequence.cascade { CascadeChain(cascade: cascade) }
            if !consequence.measured.isEmpty { LabeledLines(title: "How this was measured", lines: consequence.measured) }
        }
    }
}

/// The cascade: a numbered step for each move on a rail, each with Player Development's judgment of that exact move,
/// ending at the served stop. A hole the chain leaves open is said beneath it as information (D-045).
struct CascadeChain: View {
    let cascade: Components.Schemas.FarmCascadeView

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("The chain").font(.headline).padding(.bottom, 8).accessibilityAddTraits(.isHeader)
            if let none = cascade.noSteps { Text(verbatim: none.display).foregroundStyle(.readableSecondary).padding(.bottom, 8) }
            ForEach(cascade.steps, id: \.index) { step in
                CascadeStepRow(step: step)
            }
            // The stop: where the chain ends, and why
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Image(systemName: "stop.circle.fill").foregroundStyle(.readableSecondary).frame(width: 28).accessibilityHidden(true)
                ClaimText(cascade.stop, edge: .trailing) {
                    Text(verbatim: cascade.stop.text).fontWeight(.semibold).fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(.vertical, 6)
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("farm.cascade.stop")
            if !cascade.unresolved.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("What the chain leaves open").font(.callout.weight(.semibold))
                    ForEach(Array(cascade.unresolved.enumerated()), id: \.offset) { _, hole in
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            Image(systemName: "info.circle").foregroundStyle(.readableSecondary).accessibilityHidden(true)
                            Text(verbatim: hole.display).fixedSize(horizontal: false, vertical: true)
                        }
                        .font(.callout)
                    }
                    if let note = cascade.unresolvedNote {
                        Text(verbatim: note.display).font(.callout).foregroundStyle(.readableSecondary).fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(12)
                .background(Color.secondary.opacity(0.08), in: .rect(cornerRadius: 10))
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("farm.cascade.open")
            }
            if let sure = cascade.howSure { UnknownLine(cell: sure).font(.callout).padding(.top, 6) }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("farm.cascade")
    }
}

/// One step on the cascade's rail.
struct CascadeStepRow: View {
    let step: Components.Schemas.FarmCascadeStepView

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(spacing: 0) {
                Text(verbatim: String(step.index))
                    .font(.callout.weight(.bold)).monospacedDigit()
                    .frame(width: 24, height: 24)
                    .background(Color.secondary.opacity(0.15), in: .circle)
                Rectangle().fill(Color.secondary.opacity(0.4)).frame(width: 2).frame(maxHeight: .infinity)
            }
            .frame(width: 28)
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Pill(step.judgment.display, tone: Tone(step.judgment.tone))
                    Text(verbatim: step.vacancy.display).fontWeight(.semibold)
                }
                if let candidate = step.candidate {
                    HStack(spacing: 8) {
                        FarmPlayerName(player: candidate)
                        if let pref = step.preference { CellText(pref, secondary: true) }
                    }
                }
                if let none = step.noCandidate { Text(verbatim: none.display).foregroundStyle(.readableSecondary) }
                if let alternatives = step.alternatives { CellText(alternatives, secondary: true).font(.callout).fixedSize(horizontal: false, vertical: true) }
                ServedLines(lines: step.consequences, font: .callout)
                if !step.notes.isEmpty {
                    ForEach(Array(step.notes.enumerated()), id: \.offset) { _, note in
                        Text(verbatim: note.display).font(.callout).foregroundStyle(.readableSecondary).fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            .padding(.bottom, 14)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Step \(step.index)"))
        .accessibilityIdentifier("farm.cascade.step.\(step.index)")
    }
}
