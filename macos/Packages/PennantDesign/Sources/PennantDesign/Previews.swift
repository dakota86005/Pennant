#if DEBUG
import PennantAPI
import SwiftUI

// The design language's previews (SWIFTUI_REBUILD.md section 3.7), fed by `DesignFixtures` (made-up data), in the
// example pack's colours. Light and dark come from the canvas; Increase Contrast and Reduce Transparency from the
// environment values the app's own pieces read (`forcesIncreasedContrast`, `forcesReduceTransparency`).

extension Theme {
    /// A theme from the repository's example pack (`docs/theme-packs/sunset-series`), for previews.
    public static let preview: Theme = {
        let light = Components.Schemas.ThemeTokens(
            mastheadTop: "#fbf1ec", masthead: ["#7a1020", "#b3361a"], mastheadText: "#ffffff", mastheadSecondaryText: "#ffe3d6",
            accent: "#a8321c", accentText: "#ffffff", tint: "#a8321c", tintText: "#ffffff", card: "#7a1020", cardText: "#ffffff"
        )
        let dark = Components.Schemas.ThemeTokens(
            mastheadTop: "#1c0b0a", masthead: ["#5e0c1a", "#a33017"], mastheadText: "#ffffff", mastheadSecondaryText: "#ffd9c7",
            accent: "#ff8a65", accentText: "#1c0b0a", tint: "#ff8a65", tintText: "#1c0b0a", card: "#5e0c1a", cardText: "#ffffff"
        )
        let pack = Components.Schemas.ThemePack(
            id: "sunset-series", name: "Sunset Series", kind: .init(value1: .installed), version: "1.0", teamId: nil,
            tokens: .init(light: light, dark: dark, lightIncreasedContrast: light, darkIncreasedContrast: dark), logo: nil, art: nil
        )
        return Theme(served: pack, useTeamColors: true)
    }()
}

private struct PreviewFrame<Content: View>: View {
    var increasedContrast = false
    var reduceTransparency = false
    @ViewBuilder let content: () -> Content

    var body: some View {
        content()
            .padding(24)
            .background(.background)
            .environment(\.theme, .preview)
            .environment(\.forcesIncreasedContrast, increasedContrast)
            .environment(\.forcesReduceTransparency, reduceTransparency)
    }
}

#Preview("Magazine masthead") {
    let s = DesignFixtures.scoreboard
    PreviewFrame {
        MagazineMasthead(kicker: DesignFixtures.kicker, headline: Text(verbatim: DesignFixtures.served("Morning Report")), deck: DesignFixtures.lede, deckHint: DesignFixtures.ledeHint) {
            HStack(alignment: .bottom, spacing: 22) {
                ClaimText(s.record) { BoxFigure(value: s.record.value?.display ?? "", label: s.recordLine) }
                BoxRule()
                if let runs = s.runs, let line = s.runsLine {
                    ClaimText(runs) { BoxFigure(value: runs.value?.display ?? "", label: line) }
                }
                BoxRule()
                if let five = s.lastFive, let line = s.lastFiveLine {
                    VStack(alignment: .leading, spacing: 5) {
                        LastFiveDots(results: five, label: line)
                        Kicker(line, size: .small)
                    }
                }
            }
        } control: {
            if let tonight = s.tonight { TonightControl(tonight: tonight, deadline: s.deadline) {} }
        }
    }
    .frame(width: 1160)
}

#Preview("Sections, chips and figures") {
    PreviewFrame {
        VStack(alignment: .leading, spacing: 24) {
            ChipRow(label: Text(verbatim: DesignFixtures.served("Since the last export")), chips: DesignFixtures.chips)
            MagazineSection(kicker: Text(verbatim: DesignFixtures.served("The club")), title: Text(verbatim: DesignFixtures.served("How we win and lose")), trailing: "Through July 13 · 89 games")
            HStack(spacing: 8) {
                ForEach(DesignFixtures.departmentCard.figures.indices, id: \.self) { i in
                    MetricTile(Figure(DesignFixtures.departmentCard.figures[i], id: "f\(i)"))
                }
            }
            HStack(spacing: 14) {
                Pill("Urgent", tone: .bad); Pill("Needs attention", tone: .caution); Pill("Noted", tone: .neutral)
                InlineBar(fraction: 0.62, text: "62%")
                Ring(fraction: 39 / 40)
            }
            GroupHeader(Text(verbatim: DesignFixtures.served("Rotation")), note: "Five starters", trailing: "5")
            Sparkline(values: DesignFixtures.scoreboard.trend ?? [], label: "Run differential over the last 20 games").frame(width: 200)
        }
    }
    .frame(width: 900)
}

#Preview("Place strips") {
    PreviewFrame {
        PlaceStrips(DesignFixtures.dimensions + [DesignFixtures.tooEarly], lines: DesignFixtures.placeLines, legend: DesignFixtures.placeLegend)
    }
    .frame(width: 1000)
}

#Preview("Roster diagram (V2)") {
    PreviewFrame {
        VStack(alignment: .leading, spacing: 12) {
            RosterDiagram(DesignFixtures.positions, scale: DesignFixtures.valueScale).frame(height: 540)
            RosterLegend(DesignFixtures.rosterLegend)
            HStack(alignment: .top, spacing: 24) {
                Card { StaffColumn(title: Text(verbatim: DesignFixtures.served("Rotation")), pitchers: DesignFixtures.rotation, scale: DesignFixtures.valueScale) }
                Card { StaffColumn(title: Text(verbatim: DesignFixtures.served("Bullpen")), pitchers: DesignFixtures.bullpen, scale: DesignFixtures.valueScale) }
            }
        }
    }
    .frame(width: 1100)
}

#Preview("Desk, department tiles and the wire") {
    PreviewFrame {
        HStack(alignment: .top, spacing: 24) {
            RowGroup {
                DeskRow(DesignFixtures.deskItem, compact: true)
                Divider()
                DeskRow(DesignFixtures.deskItem, compact: true)
            }
            .frame(width: 420)
            VStack(spacing: 12) {
                DepartmentTile(DesignFixtures.departmentCard, symbol: "baseball", open: {})
                RowGroup {
                    DepartmentPlaceholderRow(DesignFixtures.notYetCard, symbol: "binoculars")
                    Divider()
                    DepartmentPlaceholderRow(DesignFixtures.notYetCard, symbol: "arrow.left.arrow.right")
                }
            }
            .frame(width: 400)
            RowGroup {
                ForEach(DesignFixtures.wire) { item in
                    WireRow(item)
                    if item.id != DesignFixtures.wire.last?.id { Divider() }
                }
            }
            .frame(width: 420)
        }
    }
}

#Preview("Basis popover and evidence") {
    PreviewFrame {
        HStack(alignment: .top, spacing: 24) {
            BasisPopover(claim: DesignFixtures.dimensions[3].claim)
                .background(.background, in: .rect(cornerRadius: 12))
            EvidenceView(claim: DesignFixtures.positions[0].claim).frame(width: 320, height: 520)
                .background(.background.secondary)
        }
        .environment(\.claimActions, ClaimActions(pin: { _ in }, detach: { _ in }, canOpen: { _ in true }, open: { _ in }, departmentName: { _ in "Major League Ops" }))
    }
}

#Preview("Command palette") {
    @Previewable @State var query = "rep"
    PreviewFrame {
        CommandPalette(entries: DesignFixtures.paletteEntries, query: $query, open: { _ in }, dismiss: {})
    }
}

#Preview("Increase Contrast, Reduce Transparency") {
    PreviewFrame(increasedContrast: true, reduceTransparency: true) {
        VStack(alignment: .leading, spacing: 16) {
            ChipRow(label: Text(verbatim: DesignFixtures.served("Since the last export")), chips: DesignFixtures.chips)
            Card { DeskRow(DesignFixtures.deskItem) }
            PlaceRow(DesignFixtures.dimensions[0])
            if let tonight = DesignFixtures.scoreboard.tonight {
                TonightControl(tonight: tonight, deadline: DesignFixtures.scoreboard.deadline) {}
            }
        }
    }
    .frame(width: 900)
}

#Preview("Aurora art") {
    AuroraArt(dark: false).frame(width: 1200, height: 400).background(Color(red: 0.06, green: 0.3, blue: 0.36))
}
#endif
