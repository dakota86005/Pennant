import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

/// The quiet notices above the main window's content (SWIFTUI_REBUILD.md section 3.4, "As built at N6 (Stage B2)"):
/// another save played since the chosen one (or the chosen one gone), a rating-history question, and the import the GM
/// asked for that did not start. Each says the server's sentence, offers the server's action as its one button (two for
/// a question: its two served answers), and can be dismissed; a dismissed notice stays hidden until its key changes,
/// remembered per save (`NoticeMemory`). Nothing here switches a save or joins two histories by itself: only a click.
struct NoticeStack: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let save = NoticeMemory.save(model.status)
        VStack(spacing: 0) {
            if let played = model.savePlayedElsewhere, !model.notices.isDismissed(NoticeMemory.key(played), save: save) {
                PlayedSinceNotice(notice: played) { model.notices.dismiss(NoticeMemory.key(played), save: save) }
                    #if DEBUG
                    .onAppear { AfterNextFrame.run { DevWindowCapture.capture("notice-played-since") } }
                    #endif
            }
            // One question at a time: the first the server asks and the GM hasn't set aside
            if let offer = model.ratingHistory?.offers.first(where: { !model.notices.isDismissed(NoticeMemory.key($0), save: save) }) {
                HistoryQuestionNotice(offer: offer) { model.notices.dismiss(NoticeMemory.key(offer), save: save) }
                    .id(offer.id)
            }
            ImportRequestBanner()
        }
    }
}

/// One notice: a symbol, the served sentence (its help tag on hover), the actions, and a dismiss control. Opaque, on the
/// window's own background with a rule beneath, so it reads the same over any masthead.
struct NoticeStrip<Message: View, Actions: View>: View {
    let symbol: String
    let identifier: String
    let dismiss: () -> Void
    @ViewBuilder let message: () -> Message
    @ViewBuilder let actions: () -> Actions

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: symbol)
                .font(.title3)
                .foregroundStyle(.readableSecondary)
                .accessibilityHidden(true)
            message()
                .frame(maxWidth: .infinity, alignment: .leading)
            actions()
                .controlSize(.small)
            Button(action: dismiss) {
                Label("Dismiss", systemImage: "xmark")
                    .labelStyle(.iconOnly)
            }
            .buttonStyle(.borderless)
            .help(Text("Dismiss"))
            .accessibilityIdentifier("\(identifier).dismiss")
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 9)
        .frame(maxWidth: .infinity)
        .background(Color(nsColor: .windowBackgroundColor))
        .overlay(alignment: .bottom) { Divider() }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(identifier)
    }
}

/// "You've played "RIGHTS-EXP" since this save …" (or "Pennant can't find the save it was using …", or a save in a newer
/// OOTP): the served sentence, its hint on hover, and the served switch as the one button. The switch goes through the
/// Setup window's choice of a save and its import; the report then follows the new save.
struct PlayedSinceNotice: View {
    @Environment(AppModel.self) private var model
    @Environment(AppRouting.self) private var routing
    @Environment(\.openWindow) private var openWindow
    let notice: Components.Schemas.SavePlayedElsewhere
    let dismiss: () -> Void

    var body: some View {
        NoticeStrip(symbol: symbol, identifier: "notice.playedSince", dismiss: dismiss) {
            // Wraps to a few lines without a fixed size: a height that depends on the width would feed back into the
            // split view's minimum size
            Text(verbatim: notice.text)
                .lineLimit(3)
                .help(Text(verbatim: notice.hint))
                .accessibilityIdentifier("notice.playedSince.text")
        } actions: {
            Button {
                routing.requestSwitch(to: notice.save)
                openWindow(id: SceneID.setup)
            } label: {
                Text(verbatim: notice.actionText)
            }
            .disabled(model.isImporting)
            .accessibilityIdentifier("notice.playedSince.switch")
        }
    }

    private var symbol: String {
        switch notice.kind.value1 {
        case .chosenMissing: "questionmark.folder"
        case .newerOotp: "arrow.up.circle"
        case .otherSave, nil: "clock.arrow.circlepath"
        }
    }
}

/// A rating-history question (D-064): the served question (its basis a click away), and its two served answers. A
/// refusal shows the server's sentence in the notice, never an alert. The answer redraws from the server's reply.
struct HistoryQuestionNotice: View {
    @Environment(AppModel.self) private var model
    let offer: Components.Schemas.RatingHistoryOffer
    let dismiss: () -> Void
    @State private var problem: RequestProblem?
    @State private var busy = false

    var body: some View {
        NoticeStrip(symbol: "clock.badge.questionmark", identifier: "notice.history", dismiss: dismiss) {
            VStack(alignment: .leading, spacing: 4) {
                ClaimText(offer.question, edge: .bottom) {
                    Text(verbatim: offer.question.text)
                        .multilineTextAlignment(.leading)
                        .lineLimit(3)
                }
                .accessibilityIdentifier("notice.history.question")
                if let problem { ProblemLine(problem) }
            }
        } actions: {
            HStack(spacing: 8) {
                Button { answer(.fresh) } label: { Text(verbatim: offer.freshText) }
                    .accessibilityIdentifier("notice.history.fresh")
                Button { answer(.adopt) } label: { Text(verbatim: offer.adoptText) }
                    .accessibilityIdentifier("notice.history.adopt")
            }
            .disabled(busy)
        }
    }

    private func answer(_ choice: Components.Schemas.RatingHistoryChoice.ChoicePayload.Value1Payload) {
        busy = true
        Task {
            defer { busy = false }
            do {
                try await model.answerRatingHistory(offer.id, choice: choice)
                problem = nil
            } catch {
                problem = RequestProblem.from(error)
            }
        }
    }
}
