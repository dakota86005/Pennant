import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

// The Trade Desk (N12 Track C; SWIFTUI_REBUILD.md section 9; D-073): the builder (two sides, the difference), the AI desk
// when it is on, the offers in the inbox, the staff's trade talk and the league's fits, one page. Everything is the
// server's: the desk's payload and the deal it weighed. "Review" puts an offer's or a target's deal on the builder and
// brings it into view.

/// The deal on the builder and the window's key, as one task id: a change to either side or a new import weighs again.
private struct DealTask: Hashable {
    let key: AppModel.StoreKey?
    let deal: TradesStore.Deal
}

/// The desk is read again when the key moves, or when the AI keys may have changed (whether the AI desk is on).
private struct DeskTask: Hashable {
    let key: AppModel.StoreKey?
    let keysRevision: Int
}

struct TradeDeskView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let store = model.trades
        TradesState(payload: store.desk, problem: store.problems["desk"]) { desk in
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 26) {
                        DeskHead(desk: desk, refreshing: store.deskUpdating(for: model.storeKey))
                        BuilderSection(desk: desk).id("builder")
                        if !desk.offers.isEmpty {
                            OffersSection(desk: desk) { deal in review(deal, proxy: proxy) }
                        }
                        if !desk.talk.isEmpty {
                            TalkSection(desk: desk) { deal in review(deal, proxy: proxy) }
                        }
                        FitsSection(fits: desk.fits)
                    }
                    .padding(.horizontal, 28).padding(.vertical, 24)
                    .frame(maxWidth: 1100, alignment: .leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .background(Color.readablePage)
            }
        }
        .task(id: DeskTask(key: model.storeKey, keysRevision: model.keysRevision)) { await model.loadTradeDesk() }
        .task(id: DealTask(key: model.storeKey, deal: store.deal)) { await model.weighDeal() }
        .toolbar {
            ToolbarItem {
                Button {
                    CompareRouter.shared.compare((store.deal.sent + store.deal.received).map { PlayerRef(id: $0) }) { openWindow(value: $0) }
                } label: {
                    Label("Compare Players in the Deal", systemImage: "rectangle.split.2x1")
                }
                .disabled(store.deal.sent.count + store.deal.received.count < 2)
                .help(Text("Compare Players in the Deal"))
            }
            ToolbarItem {
                Button {
                    store.load(TradesStore.Deal())
                } label: {
                    Label("Clear Deal", systemImage: "xmark.bin")
                }
                .disabled(store.deal.isEmpty)
                .help(Text("Clear Deal"))
                .accessibilityIdentifier("trades.clear")
            }
        }
    }

    @Environment(\.openWindow) private var openWindow

    private func review(_ deal: Components.Schemas.TradeDeal, proxy: ScrollViewProxy) {
        model.trades.load(TradesStore.Deal(deal))
        withAnimation { proxy.scrollTo("builder", anchor: .top) }
    }
}

/// The desk's head: its served title, byline and lede, and how current the export is when that needs saying.
private struct DeskHead: View {
    let desk: Components.Schemas.TradeDeskView
    let refreshing: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(verbatim: desk.title.display)
                    .font(.system(size: 30, weight: .bold, design: .serif))
                    .accessibilityAddTraits(.isHeader)
                if refreshing { ProgressView { Text("Refreshing") }.controlSize(.small) }
            }
            ServedWords(desk.byline, quiet: true).font(.callout)
            ClaimText(desk.lede, edge: .bottom) {
                Text(verbatim: desk.lede.text).font(.title3).multilineTextAlignment(.leading)
            }
            if let freshness = desk.freshness { ClaimWords(freshness, font: .callout) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The builder: the two sides (side by side where there is room, one above the other where there is not), what the
/// server says while the deal can't be weighed, the difference, and the AI desk.
private struct BuilderSection: View {
    let desk: Components.Schemas.TradeDeskView
    @Environment(AppModel.self) private var model

    var body: some View {
        let store = model.trades
        let analysis = store.analysis
        let pending = store.weighing(for: model.storeKey)
        let sides = analysis?.sides ?? []
        let sent = TradeSideView(side: .sent, title: desk.sides.sent, served: sides.first { $0.id == "sent" }, pending: pending, emptyWords: desk.emptyDeal)
        let received = TradeSideView(side: .received, title: desk.sides.received, served: sides.first { $0.id == "received" }, pending: pending, emptyWords: desk.emptyDeal)
        VStack(alignment: .leading, spacing: 14) {
            ViewThatFits(in: .horizontal) {
                // Side by side where each side gets a readable column (its ideal width, not its longest line's)
                HStack(alignment: .top, spacing: 12) {
                    sent.frame(minWidth: 300, idealWidth: 340, maxWidth: .infinity)
                    Image(systemName: "arrow.left.arrow.right")
                        .font(.title3)
                        .foregroundStyle(.readableSecondary)
                        .padding(.top, 18)
                        .accessibilityHidden(true)
                    received.frame(minWidth: 300, idealWidth: 340, maxWidth: .infinity)
                }
                VStack(alignment: .leading, spacing: 12) {
                    sent
                    received
                }
            }
            if let problem = store.problems["analysis"] {
                ProblemLine(problem)
            } else if let analysis, !pending {
                if let status = analysis.status {
                    ServedWords(status, quiet: true).accessibilityIdentifier("trades.status")
                } else if let difference = analysis.difference {
                    DifferenceView(analysis: analysis, difference: difference)
                }
            } else if store.deal.isComplete {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text(verbatim: desk.builder.weighing.display).foregroundStyle(.readableSecondary)
                }
            }
            AIDeskView(ai: desk.ai)
        }
    }
}

// MARK: The AI desk (optional, D-001)

/// The AI desk: with AI off, the server's line saying so (everything else on the desk works without it); with AI on, a
/// button to ask for the desk's read of the deal on the builder, its answers marked as the AI's own words, and a field to
/// ask a follow-up. It explains Pennant's figures; it decides nothing.
private struct AIDeskView: View {
    let ai: Components.Schemas.TradeDeskAI
    @Environment(AppModel.self) private var model
    @State private var draft = ""

    var body: some View {
        let store = model.trades
        VStack(alignment: .leading, spacing: 10) {
            if let off = ai.off {
                ClaimWords(off, font: .callout, quiet: true)
                    .accessibilityIdentifier("trades.ai.off")
            } else {
                HStack(spacing: 10) {
                    Button {
                        Task { await model.askTradeDesk(nil) }
                    } label: {
                        Label { Text(verbatim: ai.ask.display) } icon: { Image(systemName: "bubble.left.and.text.bubble.right") }
                    }
                    .disabled(!store.deal.isComplete || store.asking)
                    .accessibilityIdentifier("trades.ai.ask")
                    if store.asking { ProgressView().controlSize(.small).accessibilityLabel(Text("Thinking")) }
                }
                ClaimWords(ai.note, font: .caption, quiet: true)
                if let problem = store.askProblem { ProblemLine(problem) }
                ForEach(store.turns) { turn in
                    if let question = turn.question {
                        Text(verbatim: question)
                            .font(.callout.italic())
                            .frame(maxWidth: .infinity, alignment: .trailing)
                            .textSelection(.enabled)
                    }
                    if let answer = turn.answer { AnswerView(answer: answer) }
                }
                if !store.turns.isEmpty {
                    HStack {
                        TextField(text: $draft, prompt: Text(verbatim: ai.followUp.display)) {
                            Text("Follow-Up Question")
                        }
                        .textFieldStyle(.roundedBorder)
                        .onSubmit(send)
                        .disabled(store.asking)
                        Button("Send", action: send)
                            .disabled(store.asking || draft.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("trades.ai")
    }

    private func send() {
        let question = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !question.isEmpty else { return }
        draft = ""
        Task {
            // Put the question back rather than lose what was typed, when the desk couldn't answer
            if !(await model.askTradeDesk(question)) { draft = question }
        }
    }
}

/// One answer from the AI desk: who said it, its paragraphs as written, a notice when another model answered, and the
/// served line saying it is the AI's explanation of the figures above.
private struct AnswerView: View {
    let answer: Components.Schemas.TradeAnswer

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ServedWords(answer.voice, quiet: true).font(.caption.weight(.semibold))
            ForEach(Array(answer.lines.enumerated()), id: \.offset) { _, line in
                Text(verbatim: line.text)
                    .font(line.heading ? .headline : .body)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
            }
            if let notice = answer.notice { ServedWords(notice, quiet: true).font(.caption) }
            ClaimWords(answer.about, font: .caption, quiet: true)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .leading) { Rectangle().fill(Color.accentColor.opacity(0.5)).frame(width: 3) }
        .accessibilityElement(children: .contain)
    }
}

// MARK: The inbox and the league

/// A player named on a card: his name (his window, Compare, Follow, a drag onto the builder) and his line.
private struct CardPlayer: View {
    let player: Components.Schemas.TradeDeskPlayer

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            TradePlayerName(player: player.player, font: .callout.weight(.semibold))
            ServedWords(player.line, quiet: true).font(.caption)
        }
    }
}

/// Offers on the table: each offer in the OOTP inbox with both sides, the analyser's reading of it, and Review.
private struct OffersSection: View {
    let desk: Components.Schemas.TradeDeskView
    let review: (Components.Schemas.TradeDeal) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Offers on the Table").font(.title2.weight(.semibold)).accessibilityAddTraits(.isHeader)
            ClaimWords(desk.offersNote, font: .callout, quiet: true)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 300), spacing: 12, alignment: .top)], alignment: .leading, spacing: 12) {
                ForEach(desk.offers, id: \.id) { offer in
                    Card {
                        VStack(alignment: .leading, spacing: 6) {
                            HStack(spacing: 10) {
                                ServedWords(offer.date, quiet: true)
                                ServedWords(offer.from, quiet: true)
                            }
                            .font(.caption)
                            ServedWords(offer.subject).font(.headline)
                            Text("They send").font(.caption.weight(.semibold)).foregroundStyle(.readableSecondary)
                            ForEach(offer.theySend, id: \.player.playerId) { CardPlayer(player: $0) }
                            Text("You send").font(.caption.weight(.semibold)).foregroundStyle(.readableSecondary)
                            ForEach(offer.weSend, id: \.player.playerId) { CardPlayer(player: $0) }
                            ClaimWords(offer.reading, font: .callout)
                            Button { review(offer.deal) } label: { Text(verbatim: offer.review.display) }
                                .help(detail: offer.review.hint)
                                .accessibilityIdentifier("trades.offer.review")
                        }
                    }
                    .accessibilityElement(children: .contain)
                }
            }
        }
        .accessibilityIdentifier("trades.offers")
    }
}

/// Trade talk in the inbox: each target the staff raised, his value at a glance, his control and pay, and Review.
private struct TalkSection: View {
    let desk: Components.Schemas.TradeDeskView
    let review: (Components.Schemas.TradeDeal) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Trade Talk in Your Inbox").font(.title2.weight(.semibold)).accessibilityAddTraits(.isHeader)
            ClaimWords(desk.talkNote, font: .callout, quiet: true)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 300), spacing: 12, alignment: .top)], alignment: .leading, spacing: 12) {
                ForEach(desk.talk, id: \.id) { item in
                    Card {
                        VStack(alignment: .leading, spacing: 6) {
                            ServedWords(item.date, quiet: true).font(.caption)
                            ServedWords(item.subject).font(.headline)
                            CardPlayer(player: item.player)
                            ClaimWords(item.value, font: .callout)
                            ServedWords(item.control, quiet: true).font(.callout)
                            Button { review(item.deal) } label: { Text(verbatim: item.review.display) }
                                .help(detail: item.review.hint)
                                .accessibilityIdentifier("trades.talk.review")
                        }
                    }
                    .accessibilityElement(children: .contain)
                }
            }
        }
        .accessibilityIdentifier("trades.talk")
    }
}

/// Fits around the league: the club's weakest spots by expected wins, then each club with a match either way, its players
/// named (each opens his window and drags onto the builder) with his expected wins.
private struct FitsSection: View {
    let fits: Components.Schemas.TradeFitsView

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Trade Fits Around the League").font(.title2.weight(.semibold)).accessibilityAddTraits(.isHeader)
            if let weakest = fits.weakest { ClaimWords(weakest, font: .callout) }
            if let empty = fits.empty { ServedWords(empty, quiet: true) }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 300), spacing: 12, alignment: .top)], alignment: .leading, spacing: 12) {
                ForEach(fits.clubs, id: \.teamId) { club in
                    Card {
                        VStack(alignment: .leading, spacing: 6) {
                            HStack(alignment: .firstTextBaseline) {
                                Text(verbatim: club.club.display)
                                    .font(.headline)
                                    .clubName(id: club.teamId, name: club.club.display)
                                Spacer()
                                ServedWords(club.matches, quiet: true).font(.caption)
                            }
                            ForEach(Array((club.theyNeed + club.theyOffer).enumerated()), id: \.offset) { _, line in
                                VStack(alignment: .leading, spacing: 3) {
                                    ServedWords(line.text).font(.callout)
                                    ForEach(line.players, id: \.player.player.playerId) { entry in
                                        HStack(spacing: 6) {
                                            TradePlayerName(player: entry.player.player, font: .callout.weight(.medium))
                                            ServedWords(entry.wins, quiet: true).font(.caption)
                                        }
                                        .padding(.leading, 12)
                                    }
                                }
                            }
                        }
                    }
                    .accessibilityElement(children: .contain)
                }
            }
        }
        .accessibilityIdentifier("trades.fits")
    }
}
