import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

/// League Office ▸ Club Reports: every major-league club the catalog serves, each with its served record, opening its
/// report in its own window (a click on Open, a double-click or Return on its name, or its context menu), and draggable
/// onto Following.
public struct ClubReportsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openWindow) private var openWindow

    public init() {}

    public var body: some View {
        MastheadScrollView {
            ClubMagazineMasthead(kicker: [], headline: headline) { EmptyView() }
        } content: {
            VStack(alignment: .leading, spacing: 12) {
                if let clubs = model.catalog?.clubs, !clubs.isEmpty {
                    RowGroup {
                        ForEach(Array(clubs.enumerated()), id: \.element.teamId) { index, club in
                            HStack(spacing: 12) {
                                SymbolTile(symbol: "building.2", tint: .accentColor)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(verbatim: club.name).font(.body.weight(.semibold))
                                        .clubName(id: club.teamId, name: club.name)
                                    Text(verbatim: club.record.display).font(.callout).monospacedDigit().foregroundStyle(.readableSecondary)
                                        .help(detail: club.record.hint)
                                }
                                Spacer()
                                if model.following.isFollowing(kind: "club", id: club.teamId) {
                                    Image(systemName: "star.fill").foregroundStyle(Tone.caution.color).accessibilityLabel(Text("Followed"))
                                }
                                Button("Open") { openWindow(value: ClubRef(id: club.teamId)) }
                                    .controlSize(.small)
                                    .accessibilityIdentifier("clubReports.open.\(club.teamId)")
                            }
                            .padding(.vertical, 8)
                            if index < clubs.count - 1 { Divider() }
                        }
                    }
                } else {
                    ProgressView { Text("Loading") }
                }
            }
            .padding(.horizontal, 28).padding(.vertical, 24)
            .frame(maxWidth: 760, alignment: .leading)
        }
        .task(id: model.storeKey) { await model.loadFollowing() }
    }

    private var headline: Text {
        model.servedViewName(department: "league", view: "clubReports").map { Text(verbatim: $0) } ?? Text("Club Reports")
    }
}
