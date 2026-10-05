import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

/// The player window's sections, in the served dossier's order (structural names in the String Catalog).
public enum PlayerTab: String, CaseIterable, Codable, Hashable, Sendable {
    case overview, ratings, value, contract, history, notes
}

/// One player's dossier in his own window (`WindowGroup("Player", for: PlayerRef.self)`; SWIFTUI_REBUILD.md section 3.1,
/// N11): the header (who he is, where he plays, his deal, his value and his scouted tools), then the sections as tabs, as
/// Music's Get Info window shows an album's (a document window of one subject with several kinds of detail). Opened or
/// brought forward from his name anywhere, restored at relaunch (its value is his id). Everything drawn is served.
public struct PlayerWindowView: View {
    struct LoadKey: Hashable {
        let key: AppModel.StoreKey?
        let stamp: String?
    }

    let playerId: Int
    @Environment(AppModel.self) private var model
    @Environment(\.openWindow) private var openWindow
    @Environment(\.undoManager) private var undoManager
    @SceneStorage("player.tab") private var tab: PlayerTab = .overview

    public init(playerId: Int) {
        self.playerId = playerId
    }

    public var body: some View {
        let store = model.players
        let dossier = store.dossiers[playerId]
        Group {
            if let dossier {
                VStack(spacing: 0) {
                    PlayerHeader(dossier: dossier, updating: model.storeKey != nil && !store.isCurrent(playerId, for: model.storeKey), problem: store.problems[playerId])
                    Divider()
                    TabView(selection: $tab) {
                        Tab("Overview", systemImage: "person.text.rectangle", value: PlayerTab.overview) { PlayerOverviewTab(dossier: dossier) }
                        Tab("Ratings", systemImage: "chart.bar", value: PlayerTab.ratings) { PlayerRatingsTab(dossier: dossier) }
                        Tab("Value", systemImage: "chart.line.uptrend.xyaxis", value: PlayerTab.value) { PlayerValueTab(dossier: dossier) }
                        Tab("Contract & Rights", systemImage: "signature", value: PlayerTab.contract) { PlayerContractTab(dossier: dossier) }
                        Tab("History", systemImage: "clock", value: PlayerTab.history) { PlayerHistoryTab(dossier: dossier) }
                        Tab("Notes", systemImage: "note.text", value: PlayerTab.notes) { PlayerNotesTab(playerId: playerId) }
                    }
                    .accessibilityIdentifier("player.tabs")
                }
                .navigationTitle(Text(verbatim: dossier.name))
                // Kept as the window's title (VoiceOver, the Window menu) but not drawn in the toolbar, as the club
                // window: the header names him, and the system's title failed the contrast audit on GitHub's runner
                .toolbar(removing: .title)
            } else if let problem = store.problems[playerId] {
                ProblemLine(problem).padding().frame(maxWidth: .infinity, maxHeight: .infinity)
                    .accessibilityIdentifier("player.problem")
            } else if !model.isReady {
                ProgressView { Text("Starting…") }.frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ProgressView { Text("Loading") }.frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(minWidth: 520, minHeight: 440)
        .background(Color.readablePage)
        .background(WindowContainerLabels(["Player", "Player Window"]))
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                if let club = dossier?.header.clubOpen?.teamId {
                    Button { openWindow(value: ClubRef(id: club)) } label: { Label("Open His Club", systemImage: "building.2") }
                        .help(Text("Open His Club"))
                        .accessibilityIdentifier("player.openClub")
                }
                Button { CompareRouter.shared.compare([PlayerRef(id: playerId)]) { openWindow(value: $0) } } label: {
                    Label("Compare", systemImage: "rectangle.split.2x1")
                }
                .help(Text("Compare"))
                .accessibilityIdentifier("player.compare")
                let following = model.following.isFollowing(kind: "player", id: playerId)
                Button { model.toggleFollow(kind: "player", id: playerId, undoManager: undoManager) } label: {
                    Label(following ? "Unfollow" : "Follow", systemImage: following ? "star.fill" : "star")
                }
                .help(following ? Text("Unfollow") : Text("Follow"))
                .accessibilityIdentifier("player.follow")
            }
        }
        .environment(\.theme, model.theme)
        .focusedSceneValue(\.player, PlayerRef(id: playerId))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("player.window.\(playerId)")
        .task(id: LoadKey(key: model.storeKey, stamp: model.following.following?.followStamp)) {
            await model.loadFollowing()
            await model.loadPlayer(playerId)
        }
    }
}

/// The header: his name and number, his line, his club (opens its window), the three tiles (his deal, his value, his
/// scouted tools), how current the data is, an injury, and the OSA mark when his grades are OSA's view. The name drags
/// as the player (onto Compare, Following, another window).
struct PlayerHeader: View {
    let dossier: Components.Schemas.PlayerDossierView
    let updating: Bool
    let problem: RequestProblem?
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        let h = dossier.header
        VStack(alignment: .leading, spacing: 10) {
            if let problem { ProblemLine(problem) }
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: 24) {
                    identity(h)
                    Spacer(minLength: 0)
                    tiles(h).fixedSize(horizontal: true, vertical: false)
                }
                // A narrow window: the tiles in one row that scrolls sideways, so the header stays short and the tabs keep
                // the room
                VStack(alignment: .leading, spacing: 12) {
                    identity(h)
                    ScrollView(.horizontal) {
                        HStack(alignment: .top, spacing: 10) {
                            ForEach(h.tiles, id: \.id) { PlayerTileView(tile: $0) }
                        }
                    }
                    .scrollBounceBehavior(.basedOnSize)
                }
            }
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                ClaimText(h.freshness, edge: .bottom) {
                    HStack(spacing: 4) {
                        ToneMark(served: h.freshness.tone).font(.caption)
                        Text(verbatim: h.freshness.text).font(.caption).foregroundStyle(.readableSecondary)
                    }
                }
                if updating { Text("Updating").font(.caption).foregroundStyle(.readableSecondary) }
            }
        }
        .padding(.horizontal, 24).padding(.top, 16).padding(.bottom, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.readablePage)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("player.header")
    }

    private func identity(_ h: Components.Schemas.PlayerHeaderView) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                if let number = h.number {
                    Text(verbatim: number.display).font(.title2.weight(.medium)).monospacedDigit().foregroundStyle(.readableSecondary)
                }
                Text(verbatim: h.name).font(.largeTitle.weight(.bold)).fixedSize(horizontal: false, vertical: true)
                    .draggable(PlayerRef(id: dossier.playerId)) {
                        Label { Text(verbatim: h.name) } icon: { Image(systemName: "person") }
                            .padding(6).background(.regularMaterial, in: .capsule)
                    }
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityIdentifier("player.name")
                if let fill = h.ratingsFill { RatingFillMark(fill) }
            }
            if let nickname = h.nickname {
                Text(verbatim: nickname).font(.callout.italic()).foregroundStyle(.readableSecondary)
            }
            Text(verbatim: h.line.display).font(.callout).fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 6) {
                if let club = h.clubOpen?.teamId {
                    Text(verbatim: h.club.display).font(.callout.weight(.medium))
                        .clubName(id: club, name: h.club.display)
                        .help(detail: h.club.hint)
                } else {
                    Text(verbatim: h.club.display).font(.callout.weight(.medium)).help(detail: h.club.hint)
                }
            }
            if let injury = h.injury {
                PlayerClaimLine(claim: injury, font: .callout)
            }
        }
        .frame(minWidth: 0, alignment: .leading)
    }

    private func tiles(_ h: Components.Schemas.PlayerHeaderView) -> some View {
        HStack(alignment: .top, spacing: 10) {
            ForEach(h.tiles, id: \.id) { PlayerTileView(tile: $0) }
        }
    }
}

/// A header tile: what it is (its hover says more), the figure with its basis a click away, and its lines.
struct PlayerTileView: View {
    let tile: Components.Schemas.PlayerTile
    @Environment(\.theme) private var theme
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(verbatim: tile.title.display).font(.caption.weight(.semibold)).foregroundStyle(.readableSecondary)
                .help(detail: tile.title.hint)
            ClaimText(tile.figure, edge: .bottom) {
                Text(verbatim: tile.figure.text).font(.headline).monospacedDigit().fixedSize(horizontal: false, vertical: true)
            }
            ForEach(Array(tile.lines.enumerated()), id: \.offset) { _, line in
                CellText(line, secondary: true).font(.caption).fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(10)
        .frame(minWidth: 150, maxWidth: 240, alignment: .leading)
        .background(Color.readableChipFill, in: .rect(cornerRadius: 10))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("player.tile.\(tile.id)")
    }
}
