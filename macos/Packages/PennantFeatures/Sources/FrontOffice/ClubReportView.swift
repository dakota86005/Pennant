import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

/// Any club's report, in its own window (`WindowGroup(for: ClubRef.self)`; SWIFTUI_REBUILD.md section 3.1, D-059): the
/// Morning Report's masthead, "how they win and lose", roster map and staff for that club, from the same reader and
/// words as ours, plus what our scouts see of them, the record against us, the next series with us, their moves and
/// their injured list, each part the export could not give said in the server's sentence. It wears the club's own served
/// theme, else the neutral one. Nothing here is computed: every word and number is served.
public struct ClubReportView: View {
    let teamId: Int
    @Environment(AppModel.self) private var model
    @Environment(\.undoManager) private var undoManager

    public init(teamId: Int) {
        self.teamId = teamId
    }

    /// The club's own theme where the catalog serves one, else neutral (team colours off, or no pack served).
    public static func theme(for teamId: Int, model: AppModel) -> Theme {
        let pack = model.catalog?.clubs.first { $0.teamId == teamId }?.theme
        return Theme(served: pack, useTeamColors: model.settings?.settings.useTeamColors ?? true)
    }

    public var body: some View {
        let league = model.league
        Group {
            if let report = league.clubs[teamId] {
                MastheadScrollView {
                    ClubReportMasthead(report: report)
                } content: {
                    VStack(alignment: .leading, spacing: 12) {
                        if let problem = league.clubProblems[teamId] { ProblemLine(problem) }
                        ClubReportPage(report: report)
                    }
                    .padding(.horizontal, 28).padding(.top, 24).padding(.bottom, 12)
                }
                .navigationTitle(Text(verbatim: report.club))
            } else if let problem = league.clubProblems[teamId] {
                // The server's sentence (a club owed, a club not in this save), where the report would be
                ProblemLine(problem).padding().frame(maxWidth: .infinity, maxHeight: .infinity)
                    .accessibilityIdentifier("club.problem")
            } else if !model.isReady {
                ProgressView { Text("Starting…") }.frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ProgressView { Text("Loading") }.frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(minWidth: 760, minHeight: 520)
        .background(.background)
        // AppKit's containers above the report, named for VoiceOver (the audit)
        .background(WindowContainerLabels(["Club Report", "Club Window"]))
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                let following = model.following.isFollowing(kind: "club", id: teamId)
                Button {
                    model.toggleFollow(kind: "club", id: teamId, undoManager: undoManager)
                } label: {
                    Label(following ? "Unfollow" : "Follow", systemImage: following ? "star.fill" : "star")
                }
                .help(following ? Text("Unfollow") : Text("Follow"))
                .disabled(league.clubs[teamId]?.ours ?? false)
                .accessibilityIdentifier("club.follow")
            }
        }
        .environment(\.theme, Self.theme(for: teamId, model: model))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("club.window.\(teamId)")
        .task(id: model.storeKey) {
            await model.loadClub(teamId)
            await model.loadFollowing()
        }
    }
}

/// The club's masthead: its season's served kicker (the league's day, how current), its name as the headline, the lede
/// as the deck and the box score (record and place, runs, the last five), each part the export could not give said
/// where it would be.
struct ClubReportMasthead: View {
    let report: Components.Schemas.ClubReport

    var body: some View {
        let design = MorningReportDesign(club: report)
        ClubMagazineMasthead(
            club: .some(nil),
            kicker: design.kicker ?? [report.asOf.display],
            kickerHint: design.kickerHint ?? report.asOf.hint,
            kickerStatus: report.ours ? String(localized: "Your club") : nil,
            headline: Text(verbatim: report.club),
            deck: design.ledeClaim
        ) {
            if let scoreboard = design.scoreboard {
                ScoreboardFigures(scoreboard: scoreboard)
            } else {
                MissingLines(design.mastheadMissing)
            }
        }
        .clubName(id: report.teamId, name: report.club)
    }
}

/// The club's page: what our scouts see and the record against us lead; then how they win and lose and the roster map
/// with the staff; beside them the next series with us, their moves and their injured list.
struct ClubReportPage: View {
    let report: Components.Schemas.ClubReport
    @Environment(AppModel.self) private var model
    @Environment(\.contentWidth) private var contentWidth

    var body: some View {
        let design = MorningReportDesign(club: report)
        let twoColumns = contentWidth >= MorningReportPage.twoColumns
        if twoColumns {
            HStack(alignment: .top, spacing: 40) {
                lead(design).frame(maxWidth: .infinity, alignment: .leading)
                side.frame(width: 340)
            }
        } else {
            VStack(alignment: .leading, spacing: 36) {
                lead(design)
                side
            }
        }
    }

    @ViewBuilder
    private func lead(_ design: MorningReportDesign) -> some View {
        VStack(alignment: .leading, spacing: 36) {
            VStack(alignment: .leading, spacing: 8) {
                MagazineSection(kicker: Text("Scouting"), title: Text("What our scouts see"))
                ClaimLine(report.scouting, font: .title3)
                    .accessibilityIdentifier("club.scouting")
            }
            if let dimensions = design.dimensions {
                VStack(alignment: .leading, spacing: 8) {
                    MagazineSection(kicker: Text("The club"), title: Text("How they win and lose"), trailing: design.placesNote, trailingHint: design.placesNoteHint)
                    if let unavailable = design.placesUnavailable {
                        ProblemLine(served: unavailable.text, detail: unavailable.hint)
                    }
                    PlaceStrips(dimensions, headings: design.placeHeadings, legend: design.placeLegend, wide: false)
                }
            }
            if let positions = design.positions {
                VStack(alignment: .leading, spacing: 12) {
                    MagazineSection(kicker: Text("The roster"), title: Text("Who they have"))
                    if let unavailable = design.rosterUnavailable {
                        ProblemLine(served: unavailable.text, detail: unavailable.hint)
                    }
                    if let scale = design.valueScale {
                        RosterDiagram(positions, scale: scale).frame(height: 540)
                        if let legend = model.phrases?.rosterLegend { RosterLegend(legend, notes: design.rosterNotes) }
                        HStack(alignment: .top, spacing: 24) {
                            Card { StaffColumn(title: Text("Rotation"), pitchers: design.rotation, scale: scale, needs: design.rotationNeeds) }
                            Card { StaffColumn(title: Text("Bullpen"), pitchers: design.bullpen, scale: scale, needs: design.bullpenNeeds) }
                        }
                    } else {
                        ForEach(design.rosterNotes) { note in
                            Text(verbatim: note.text).foregroundStyle(.readableSecondary).help(Text(verbatim: note.hint ?? note.text))
                        }
                    }
                }
            }
        }
    }

    private var side: some View {
        VStack(alignment: .leading, spacing: 36) {
            VStack(alignment: .leading, spacing: 8) {
                MagazineSection(kicker: Text("Against us"), title: Text("Head to Head"))
                if let headToHead = report.headToHead { ClaimLine(headToHead).accessibilityIdentifier("club.headToHead") }
                if let next = report.nextSeries {
                    ClaimLine(next).accessibilityIdentifier("club.nextSeries")
                } else if let note = report.nextSeriesNote {
                    Text(verbatim: note.display).foregroundStyle(.readableSecondary).help(detail: note.hint)
                        .accessibilityIdentifier("club.nextSeries")
                }
            }
            VStack(alignment: .leading, spacing: 8) {
                MagazineSection(kicker: Text("The wire"), title: Text("Moves"))
                if let note = report.movesNote {
                    Text(verbatim: note.display).foregroundStyle(.readableSecondary).help(detail: note.hint)
                }
                let moves = MorningReportDesign.wire(report.moves)
                if !moves.isEmpty {
                    RowGroup {
                        ForEach(moves) { item in
                            WireRow(item) { name in
                                if let id = item.clubId { name.clubName(id: id, name: item.club) } else { name }
                            }
                            if item.id != moves.last?.id { Divider() }
                        }
                    }
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("club.moves")
            VStack(alignment: .leading, spacing: 8) {
                MagazineSection(kicker: Text("Medical"), title: Text("Injuries"))
                if let note = report.injuriesNote {
                    Text(verbatim: note.display).foregroundStyle(.readableSecondary).help(detail: note.hint)
                }
                if !report.injuries.isEmpty {
                    RowGroup {
                        ForEach(Array(report.injuries.enumerated()), id: \.element.playerId) { index, injury in
                            ClaimLine(injury.line, font: .callout)
                                .padding(.vertical, 7)
                                .playerName(id: injury.playerId, name: nil, opens: ClubRef(id: report.teamId))
                            if index < report.injuries.count - 1 { Divider() }
                        }
                    }
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("club.injuries")
        }
    }
}
