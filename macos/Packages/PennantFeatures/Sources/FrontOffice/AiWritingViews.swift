import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

// Storylines and the GM Briefing (N13, D-074; SWIFTUI_REBUILD.md section 3.5's Front Office row, and the Morning
// Report's collapsed item 8): the writing as served, where it stands (never written, writing, written, failed; when,
// from which export, and the "older" line), the write button in its served words, and the marking that it is the AI's.
// Read again when the server's `job` event says the writing ended; never polled. With AI off, one calm served line,
// and anything written before stays readable.

/// Storylines: each story's category, the AI's own headline and its body.
public struct StorylinesView: View {
    @Environment(AppModel.self) private var model

    public init() {}

    public var body: some View {
        let store = model.writing
        OfficeState(payload: store.storylines, problem: store.storylines == nil ? store.problems[.storylines] : nil) { view in
            OfficePage {
                WritingHead(title: view.title, lede: view.lede, status: AiWritingStore.writingStatus(view), piece: .storylines)
                ForEach(Array(view.stories.enumerated()), id: \.offset) { _, story in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(verbatim: story.category.uppercased())
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.readableSecondary)
                        Text(verbatim: story.headline)
                            .font(.system(size: 22, weight: .semibold, design: .serif))
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityAddTraits(.isHeader)
                        AiTextView(story.body)
                    }
                    .frame(maxWidth: 720, alignment: .leading)
                    .accessibilityElement(children: .contain)
                }
                if let written = view.written { AiMarking(written) }
            }
        }
        .task(id: WritingTask(key: model.storeKey, keysRevision: model.keysRevision)) { await model.loadWriting(.storylines) }
    }
}

/// The GM Briefing: its sections by the AI's own headings.
public struct BriefingView: View {
    @Environment(AppModel.self) private var model

    public init() {}

    public var body: some View {
        let store = model.writing
        OfficeState(payload: store.briefing, problem: store.briefing == nil ? store.problems[.briefing] : nil) { view in
            OfficePage {
                WritingHead(title: view.title, lede: view.lede, status: AiWritingStore.writingStatus(view), piece: .briefing)
                BriefingSections(sections: view.sections)
                if let written = view.written { AiMarking(written) }
            }
        }
        .task(id: WritingTask(key: model.storeKey, keysRevision: model.keysRevision)) { await model.loadWriting(.briefing) }
    }
}

/// The briefing's sections, each under the AI's own heading.
struct BriefingSections: View {
    let sections: [Components.Schemas.BriefingSection]

    var body: some View {
        ForEach(Array(sections.enumerated()), id: \.offset) { _, section in
            VStack(alignment: .leading, spacing: 6) {
                if let heading = section.heading {
                    Text(verbatim: heading).font(.headline).accessibilityAddTraits(.isHeader)
                }
                AiTextView(section.body)
            }
            .frame(maxWidth: 720, alignment: .leading)
        }
    }
}

struct WritingTask: Hashable {
    var key: AppModel.StoreKey?
    var keysRevision: Int
}

/// The head of a piece of AI writing: the served title and lede, then where it stands.
struct WritingHead: View {
    let title: Components.Schemas.Cell
    let lede: Components.Schemas.Cell
    let status: Components.Schemas.AiWritingStatus
    let piece: AiWritingStore.Piece

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(verbatim: title.display)
                .font(.system(size: 30, weight: .bold, design: .serif))
                .accessibilityAddTraits(.isHeader)
            Text(verbatim: lede.display).font(.title3).foregroundStyle(.primary).fixedSize(horizontal: false, vertical: true)
            WritingStatusView(status: status, piece: piece)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Where a piece stands, as served: AI off (one calm line), the status (when and from which export, writing now, not
/// written yet, or the failure with its reason in the basis), the "older" line, another model's notice, and the write
/// button in its served words, enabled as served. A request the server refused says its sentence.
struct WritingStatusView: View {
    let status: Components.Schemas.AiWritingStatus
    let piece: AiWritingStore.Piece
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let off = status.ai.off {
                AiClaimLine(off).accessibilityIdentifier("\(piece.rawValue).aiOff")
            }
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                if status.state.value1 == .writing { ProgressView().controlSize(.small).accessibilityHidden(true) }
                AiClaimLine(status.status).accessibilityIdentifier("\(piece.rawValue).status")
            }
            if let older = status.older { AiClaimLine(older) }
            if let notice = status.notice {
                Text(verbatim: notice.display).font(.caption).foregroundStyle(.readableSecondary).help(detail: notice.hint)
            }
            Button {
                Task { await model.writeAgain(piece) }
            } label: {
                Label { Text(verbatim: status.write.display) } icon: { Image(systemName: "sparkles") }
            }
            .disabled(!status.canWrite || model.writing.requesting.contains(piece))
            .help(detail: status.write.hint)
            .accessibilityIdentifier("\(piece.rawValue).write")
            if let problem = model.writing.problems[piece] { ProblemLine(problem) }
        }
    }
}

/// The GM Briefing on the Morning Report (section 3.4, item 8): collapsed, its served title as the label; opened, where
/// it stands and its sections, read when first opened.
struct BriefingDisclosure: View {
    @Environment(AppModel.self) private var model
    @State private var expanded = false

    var body: some View {
        DisclosureGroup(isExpanded: $expanded) {
            VStack(alignment: .leading, spacing: 14) {
                if let view = model.writing.briefing {
                    WritingStatusView(status: AiWritingStore.writingStatus(view), piece: .briefing)
                    BriefingSections(sections: view.sections)
                    if let written = view.written { AiMarking(written) }
                } else if let problem = model.writing.problems[.briefing] {
                    ProblemLine(problem)
                } else {
                    ProgressView().controlSize(.small).accessibilityLabel(Text("Loading"))
                }
            }
            .padding(.top, 8)
            .task(id: WritingTask(key: model.storeKey, keysRevision: model.keysRevision)) { await model.loadWriting(.briefing) }
        } label: {
            Text(verbatim: model.writing.briefing?.title.display ?? String(localized: "GM Briefing"))
                .font(.title3.weight(.semibold))
                .accessibilityAddTraits(.isHeader)
        }
        .accessibilityIdentifier("morningReport.briefing")
    }
}
