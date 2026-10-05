import AppKit
import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

/// The player window's sections, in the served dossier's order (structural names in the String Catalog).
public enum PlayerTab: String, CaseIterable, Codable, Hashable, Sendable {
    case overview, ratings, value, contract, history, notes

    /// The section's structural name (the String Catalog's).
    var name: LocalizedStringResource {
        switch self {
        case .overview: "Overview"
        case .ratings: "Ratings"
        case .value: "Value"
        case .contract: "Contract & Rights"
        case .history: "History"
        case .notes: "Notes"
        }
    }
}

/// One player's dossier in his own window (`WindowGroup("Player", for: PlayerRef.self)`; SWIFTUI_REBUILD.md section 3.1,
/// N11): the header (who he is, where he plays, his deal, his value and his scouted tools), then the sections chosen with
/// a segmented control above them, as Music's Get Info window shows an album's (a document window of one subject with
/// several kinds of detail). Opened or brought forward from his name anywhere, restored at relaunch (its value is his id).
/// Everything drawn is served.
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

    /// Below this width the header's tiles move into the Overview (a layout width, not a judgment).
    static let compactWidth: CGFloat = 820

    public var body: some View {
        let store = model.players
        let dossier = store.dossiers[playerId]
        Group {
            if let dossier {
                // A narrow window keeps the header to his name and line, and his tiles open the Overview instead
                GeometryReader { proxy in
                let compact = proxy.size.width < Self.compactWidth
                VStack(spacing: 0) {
                    PlayerHeader(dossier: dossier, compact: compact, updating: model.storeKey != nil && !store.isCurrent(playerId, for: model.storeKey), problem: store.problems[playerId])
                    Divider()
                    SectionChoice(tab: $tab)
                    Divider()
                    Group {
                        switch tab {
                        case .overview: PlayerOverviewTab(dossier: dossier, tiles: compact)
                        case .ratings: PlayerRatingsTab(dossier: dossier)
                        case .value: PlayerValueTab(dossier: dossier)
                        case .contract: PlayerContractTab(dossier: dossier)
                        case .history: PlayerHistoryTab(dossier: dossier)
                        case .notes: PlayerNotesTab(playerId: playerId)
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                }
                .frame(width: proxy.size.width, height: proxy.size.height, alignment: .topLeading)
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
        #if DEBUG
        // A Debug build's narrow-window test sizes this window (`-PennantDebugPlayerWindowSize 520x480`)
        .background(DebugWindowSizer(key: "PennantDebugPlayerWindowSize"))
        #endif
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
    var compact = false
    let updating: Bool
    let problem: RequestProblem?
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        let h = dossier.header
        VStack(alignment: .leading, spacing: 10) {
            if let problem { ProblemLine(problem) }
            if compact {
                identity(h)
            } else {
                HStack(alignment: .top, spacing: 24) {
                    identity(h)
                    Spacer(minLength: 0)
                    tiles(h)
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
            // Words on the tile's fill are the primary colour: the audit measures a secondary grey there as too faint
            Text(verbatim: tile.title.display).font(.caption.weight(.semibold))
                .help(detail: tile.title.hint)
            ClaimText(tile.figure, edge: .bottom) {
                Text(verbatim: tile.figure.text).font(.headline).monospacedDigit().fixedSize(horizontal: false, vertical: true)
            }
            ForEach(Array(tile.lines.enumerated()), id: \.offset) { _, line in
                FillWords(line).font(.caption)
            }
        }
        .padding(10)
        .frame(minWidth: 150, maxWidth: 260, alignment: .leading)
        // An outline on the page rather than a fill: the audit can't read words on a tinted fill as their pixels read
        .background(Color.readablePage, in: .rect(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Color.primary.opacity(0.18)))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: tile.title.display))
        .accessibilityIdentifier("player.tile.\(tile.id)")
    }
}

#if DEBUG
/// Sizes the window it is in once, from a launch argument (`WxH`), for a Debug build's tests and captures; never larger
/// than its screen's visible frame, and wholly on it (the main window's own sizing does the same, PR #54).
struct DebugWindowSizer: NSViewRepresentable {
    let key: String

    /// Placed against the screen's trailing edge (a Compare window beside the main one, for a drop in a test).
    var trailing = false

    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        guard let size = UserDefaults.standard.string(forKey: key)?.split(separator: "x").compactMap({ Double($0) }), size.count == 2 else { return view }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            guard let window = view.window else { return }
            var frame = CGRect(origin: window.frame.origin, size: CGSize(width: size[0], height: size[1]))
            if let visible = (window.screen ?? NSScreen.main)?.visibleFrame {
                frame.size = CGSize(width: min(frame.width, visible.width), height: min(frame.height, visible.height))
                frame.origin.y = window.frame.maxY - frame.height
                frame.origin.x = trailing ? visible.maxX - frame.width : min(max(frame.minX, visible.minX), visible.maxX - frame.width)
                frame.origin.y = min(max(frame.minY, visible.minY), visible.maxY - frame.height)
            }
            window.setFrame(frame, display: true)
        }
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {}
}
#endif

/// The sections' control: a segmented control centred above them, its names where the window has room for them and the
/// sections' symbols where it does not (each still named for VoiceOver and in its help tag).
struct SectionChoice: View {
    @Binding var tab: PlayerTab

    private static let sections: [(PlayerTab, LocalizedStringResource, String)] = [
        (.overview, "Overview", "person.text.rectangle"), (.ratings, "Ratings", "chart.bar"), (.value, "Value", "chart.line.uptrend.xyaxis"),
        (.contract, "Contract & Rights", "signature"), (.history, "History", "clock"), (.notes, "Notes", "note.text"),
    ]

    var body: some View {
        ViewThatFits(in: .horizontal) {
            picker(iconsOnly: false)
            picker(iconsOnly: true)
        }
        .padding(.horizontal, 16).padding(.vertical, 8)
        .frame(maxWidth: .infinity)
        .background(Color.readablePage)
    }

    private func picker(iconsOnly: Bool) -> some View {
        Picker(selection: $tab) {
            ForEach(Self.sections, id: \.0) { section in
                Group {
                    if iconsOnly {
                        Label { Text(section.1) } icon: { Image(systemName: section.2) }.labelStyle(.iconOnly)
                    } else {
                        Text(section.1)
                    }
                }
                .help(Text(section.1))
                .tag(section.0)
            }
        } label: {
            Text("Section")
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .fixedSize()
        .accessibilityIdentifier("player.sections")
    }
}
