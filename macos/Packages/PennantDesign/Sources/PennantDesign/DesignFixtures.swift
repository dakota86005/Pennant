#if DEBUG
import PennantAPI
import SwiftUI

/// Made-up data for the components' previews and the snapshot tests (SWIFTUI_REBUILD.md section 8): a 30-club league
/// in July 2041, the Bay City Admirals. Nothing here is from a save, and nothing here reaches the running app: the
/// slots it fills (the scoreboard, the chips, the places, the roster diagram, the wire) are drawn in the app only once
/// the server serves them (N6). The shapes are what the server will serve, in the design's words.
public enum DesignFixtures {
    static let source = Components.Schemas.BasisSource(department: .init(value1: .majorLeague), specialist: "Player Value", gameDate: "2041-7-13")

    public static func basis(
        _ because: [(String, String)], from: String = "The export, through July 13", called: Components.Schemas.Certainty = .init(value1: .fact),
        unknown: [String] = [], wouldChange: [String] = [], lean: Components.Schemas.Lean? = nil, stamp: String? = nil
    ) -> Components.Schemas.Basis {
        .init(
            because: because.map { .init(label: $0.0, value: $0.1) },
            source: .init(department: .init(value1: .frontOffice), specialist: from, gameDate: "2041-7-13"),
            unknown: unknown, wouldChange: wouldChange, lean: lean, certainty: called, stamp: stamp
        )
    }

    public static func claim(_ text: String, hint: String? = nil, value: String? = nil, tone: Components.Schemas.Tone = .init(value1: .neutral), basis: Components.Schemas.Basis, links: [Components.Schemas.Target] = []) -> Components.Schemas.Claim {
        .init(text: text, hint: hint, value: value.map { .init(n: nil, unit: .init(value1: .count), display: $0) }, tone: tone, basis: basis, links: links)
    }

    /// A sentence the server would serve, written into a preview or a snapshot (never the running app).
    public static func served(_ text: String) -> String { text }

    static let policy = Components.Schemas.Certainty(value1: .policy)
    static let mlbView = Components.Schemas.Target(kind: .init(value1: .view), department: .init(value1: .majorLeague), view: "report")

    // MARK: The masthead

    public static let kicker: [String?] = ["Bay City Admirals", "July 14, 2041", "Through July 13"]
    public static let lede = "Second in the East, two and a half back. The bullpen has slipped to 29th over the last fifteen; the deadline is seventeen days out."
    public static let ledeHint = "Written by the server from the facts on this page; every figure in it is below with its basis"

    public static let scoreboard = Scoreboard(
        record: claim("Won 48, lost 41", hint: "Won 48, lost 41, through July 13", value: "48–41",
                      basis: basis([("Games played", "89"), ("At home", "27–19"), ("On the road", "21–22"), ("In the division", "18–14")], from: "Standings in the export")),
        recordLine: "2nd in the East · 2½ back",
        runs: claim("Runs scored less runs allowed", hint: "Runs scored less runs allowed, this season", value: "+37",
                    basis: basis([("Runs scored", "412 · 4.63 a game"), ("Runs allowed", "375 · 4.21 a game"), ("Last 20 games", "+19")], from: "Team totals in the export")),
        runsLine: "412 scored · 375 allowed",
        trend: [18, 21, 19, 24, 26, 25, 29, 27, 31, 30, 33, 32, 36, 34, 38, 41, 39, 40, 38, 37],
        lastFive: [.win, .loss, .win, .win, .loss],
        lastFiveLine: "Lost 1 · last five 3–2",
        tonight: TonightGame(when: "Tonight · 7:05", matchup: "vs Northport Kings", starters: "R. Castillo 7–4 · 3.21 · J. Whitmore 9–3 · 2.88",
                             hint: "Open Game Day: tonight's lineups, the probable starters and the bullpen's availability"),
        deadline: DeadlineNote(count: "17 days", text: "to the deadline · July 31")
    )

    public static let chips: [Chip] = [
        Chip(id: "new", symbol: "plus.circle", text: "3 new on your desk", hint: "Items raised since the last export"),
        Chip(id: "resolved", symbol: "checkmark.circle", text: "2 resolved", hint: "Items that closed since the last export"),
        Chip(id: "moved", symbol: "arrow.left.arrow.right.circle", text: "1 moved", hint: "An item whose urgency changed"),
        Chip(id: "results", symbol: "calendar", text: "This week 4–2", hint: "Results since the last export"),
    ]

    // MARK: How we win and lose

    public static let placeLines: [PlaceDimension.Group: String] = [
        .strength: "Top fifth of the league", .weakness: "Bottom fifth", .tooEarly: "Fewer than 20 games",
    ]

    static func dimension(_ id: String, _ name: String, _ symbol: String, place: Int?, tiedWith: Int = 0, recent: Int?, placeText: String, recentText: String, group: PlaceDimension.Group, hint: String, because: [(String, String)], called: String, unknown: [String] = [], wouldChange: [String] = [], lean: Components.Schemas.Lean? = nil) -> PlaceDimension {
        PlaceDimension(
            id: id, name: name, symbol: symbol, place: place, of: 30, tiedWith: tiedWith, recentPlace: recent,
            placeText: placeText, recentText: recentText, group: group,
            claim: claim(placeText, hint: hint, basis: basis(because, from: "Team totals in the export", called: policy, unknown: unknown, wouldChange: wouldChange, lean: lean, stamp: called), links: [mlbView])
        )
    }

    public static let dimensions: [PlaceDimension] = [
        dimension("scoring", "Scoring runs", "figure.baseball", place: 6, recent: 9, placeText: "6th of 30", recentText: "Last 15: 9th", group: .strength,
                  hint: "Runs scored a game against the other 29 clubs", because: [("Runs a game", "4.63 · 6th"), ("League average", "4.31"), ("Last 15 games", "4.20 · 9th")],
                  called: "Top fifth is a strength, bottom fifth a weakness (a stated line); below 20 games it reads too early."),
        dimension("onbase", "Getting on base", "figure.walk", place: 4, recent: 3, placeText: "4th of 30", recentText: "Last 15: 3rd", group: .strength,
                  hint: "Team on-base percentage against the other 29 clubs", because: [("On-base", ".338 · 4th"), ("Walks a game", "3.6 · 2nd"), ("Last 15 games", ".344 · 3rd")],
                  called: "Top fifth is a strength (a stated line)."),
        dimension("baserunning", "Baserunning", "figure.run", place: 5, recent: 4, placeText: "5th of 30", recentText: "Last 15: 4th", group: .strength,
                  hint: "Extra bases taken and steals against the other 29 clubs", because: [("Steals", "68 of 96 · 71%"), ("Extra bases taken", "45% · 5th"), ("Last 15 games", "4th")],
                  called: "Top fifth is a strength (a stated line)."),
        dimension("power", "Hitting for power", "bolt", place: 28, recent: 26, placeText: "28th of 30", recentText: "Last 15: 26th", group: .weakness,
                  hint: "Team slugging against the other 29 clubs", because: [("Slugging", ".371 · 28th"), ("Home runs", "74 · 27th"), ("Last 15 games", ".384 · 26th")],
                  called: "Bottom fifth is a weakness (a stated line, 25th of 30 and below).",
                  unknown: ["Park effects aren't in the export, so this is raw slugging."], wouldChange: ["A power bat at 1B or DH is the one change that moves this place this season."],
                  lean: .init(neutral: "28th of 30, the same place", why: ["Our philosophy leans to contact, so a power bat is weighed lightly."])),
        dimension("bullpen", "Bullpen", "phone.arrow.up.right", place: 26, tiedWith: 2, recent: 29, placeText: "T-26th of 30", recentText: "Last 15: 29th", group: .weakness,
                  hint: "Relievers' runs allowed against the other 29 clubs", because: [("Relievers' ERA", "4.71 · tied 26th with two clubs"), ("Leads lost after the 7th", "11 · 25th"), ("Last 15 games", "5.60 · 29th")],
                  called: "Bottom fifth is a weakness (a stated line).", wouldChange: ["Holloway's return from rehab on Friday adds one high-leverage arm."]),
        dimension("preventing", "Preventing runs", "shield", place: 11, recent: 22, placeText: "11th of 30", recentText: "Last 15: 22nd", group: .rest,
                  hint: "Runs allowed a game against the other 29 clubs", because: [("Runs allowed a game", "4.21 · 11th"), ("Last 15 games", "4.93 · 22nd")],
                  called: "Top fifth is a strength, bottom fifth a weakness (a stated line).", wouldChange: ["Two starts from a healthy Okafor would put the last 15 back near the season."]),
        dimension("rotation", "Rotation", "arrow.trianglehead.2.clockwise", place: 9, tiedWith: 1, recent: 12, placeText: "T-9th of 30", recentText: "Last 15: 12th", group: .rest,
                  hint: "Starters' runs allowed a start against the other 29 clubs", because: [("Starters' ERA", "3.88 · tied 9th with one club"), ("Innings a start", "5.7 · 8th"), ("Last 15 games", "4.22 · 12th")],
                  called: "Ties share the place; both clubs are named in the evidence."),
        dimension("defense", "Turning balls into outs", "hand.raised", place: 14, recent: nil, placeText: "14th of 30", recentText: "Last 15: too few", group: .rest,
                  hint: "Defensive efficiency against the other 29 clubs", because: [("Defensive efficiency", ".701 · 14th"), ("Errors", "48 · 16th")],
                  called: "The middle of the league: neither a strength nor a weakness.", unknown: ["Too few balls in play over the last 15 games to call a recent place."]),
    ]

    /// A dimension too early to call: the strip with no place, the served sentence in its stead.
    public static let tooEarly = dimension("clutch", "Late and close", "clock", place: nil, recent: nil, placeText: "Too early", recentText: "Fewer than 20 games", group: .tooEarly,
                                           hint: "One-run and extra-inning games; too few so far", because: [("One-run games", "14")], called: "Below 20 games it reads too early (a stated line).")

    // MARK: The roster

    static func position(_ id: String, _ holder: String, value: (Double, Double, Double)?, placeText: String, behind: String, farmNext: String?, control: ControlTerm, need: Bool) -> RosterPosition {
        let range = value.map { ValueRange(low: $0.0, likely: $0.1, high: $0.2, text: "$\(fmt($0.1))M · could be $\(fmt($0.0))M to $\(fmt($0.2))M", short: "$\(fmt($0.1))M") }
        let valueText = range?.short ?? "Not valued"
        return RosterPosition(
            id: id, holder: holder, value: range, valueText: valueText, placeText: placeText, behind: behind, farmNext: farmNext, control: control, need: need,
            claim: claim(holder, hint: range.map { "Worth beyond what he's paid: \($0.text)" } ?? "Not valued yet: his contract terms aren't in the export",
                         basis: basis([
                             ("Worth this season", range?.text ?? "Not valued yet: his contract terms aren't in the export"),
                             ("At \(id) in the league", placeText),
                             ("Behind him", behind),
                             ("Farm's next man", farmNext ?? "Nobody in the upper minors at \(id)"),
                             ("Control", control.text),
                         ], from: "Player Value, Player Rights, the farm's next man", called: .init(value1: .calibrated),
                         unknown: range == nil ? ["His contract terms are not in the export, so he isn't valued."] : [],
                         wouldChange: ["A new scouting export moves the range.", "An injury longer than 15 days narrows what this season can return."],
                         stamp: "The range is what our scouts' ratings and his own record support; the most likely value is marked."), links: [mlbView])
        )
    }

    static func fmt(_ v: Double) -> String { v == v.rounded() ? String(Int(v)) : String(format: "%.1f", v) }

    public static let positions: [RosterPosition] = [
        position("C", "M. Okafor", value: (4, 8, 11), placeText: "12th of 30", behind: "Nobody healthy", farmNext: "L. Moreau · not yet", control: .seasons(3, text: "Through 2043"), need: true),
        position("1B", "D. Whitfield", value: (1, 5, 9), placeText: "19th of 30", behind: "S. Petrov", farmNext: nil, control: .seasons(2, text: "Through 2042"), need: false),
        position("2B", "T. Brennan", value: (9, 14, 21), placeText: "5th of 30", behind: "A. Delgado", farmNext: "H. Sato · about a year", control: .clock("Arbitration this winter"), need: false),
        position("3B", "K. Nakamura", value: (6, 11, 15), placeText: "8th of 30", behind: "S. Petrov", farmNext: "I. Novak · not yet", control: .seasons(4, text: "Through 2044"), need: false),
        position("SS", "J. Alvarez", value: (15, 22, 30), placeText: "2nd of 30", behind: "A. Delgado", farmNext: "P. Quinlan · about a year", control: .seasons(6, text: "Through 2046"), need: false),
        position("LF", "C. Ashford", value: (2, 6, 10), placeText: "16th of 30", behind: "B. Holloway", farmNext: "N. Barros · ready now", control: .clock("Free agent after this season"), need: false),
        position("CF", "E. Lindqvist", value: (10, 16, 24), placeText: "4th of 30", behind: "C. Ashford", farmNext: nil, control: .seasons(5, text: "Through 2045"), need: false),
        position("RF", "F. Ortega", value: (3, 7, 12), placeText: "15th of 30", behind: "B. Holloway", farmNext: "V. Reyes · about a year", control: .seasons(2, text: "Through 2042"), need: false),
        position("DH", "G. Maddox", value: nil, placeText: "Not placed yet", behind: "D. Whitfield", farmNext: "O. Hughes · ready now", control: .seasons(1, text: "Through 2041"), need: true),
    ]

    static func pitcher(_ id: String, _ role: String, _ name: String, _ line: String, value: (Double, Double, Double)?, note: String?) -> StaffPitcher {
        let range = value.map { ValueRange(low: $0.0, likely: $0.1, high: $0.2, text: "$\(fmt($0.1))M · could be $\(fmt($0.0))M to $\(fmt($0.2))M", short: "$\(fmt($0.1))M") }
        return StaffPitcher(id: id, role: role, name: name, line: line, value: range, note: note,
                            hint: range.map { "Worth beyond what he's paid: \($0.text)" } ?? "Not valued yet: the export lacks his contract")
    }

    public static let rotation: [StaffPitcher] = [
        pitcher("sp1", "SP1", "R. Castillo", "7–4 · 3.21", value: (12, 18, 25), note: "Tonight"),
        pitcher("sp2", "SP2", "W. Tanaka", "8–5 · 3.64", value: (8, 13, 19), note: nil),
        pitcher("sp3", "SP3", "Z. Kowalski", "5–6 · 4.10", value: (2, 6, 10), note: nil),
        pitcher("sp4", "SP4", "P. Quinlan", "6–3 · 3.95", value: (4, 8, 12), note: nil),
        pitcher("sp5", "SP5", "E. Vance", "3–7 · 5.02", value: (-3, 0, 3), note: "Day-to-day"),
    ]

    public static let bullpen: [StaffPitcher] = [
        pitcher("cl", "CL", "S. Petrov", "21 saves · 2.70", value: (5, 9, 13), note: nil),
        pitcher("su1", "SU", "B. Holloway", "3.38", value: nil, note: "Rehab ends Friday"),
        pitcher("su2", "SU", "A. Delgado", "4.85", value: nil, note: "Option clock · 5 days"),
        pitcher("mr1", "MR", "O. Hughes", "4.40", value: nil, note: nil),
        pitcher("mr2", "MR", "N. Barros", "5.12", value: nil, note: nil),
        pitcher("mr3", "MR", "L. Moreau", "4.91", value: nil, note: nil),
        pitcher("lr", "LR", "I. Novak", "5.30", value: nil, note: nil),
    ]

    // MARK: The wire

    public static let wire: [WireItem] = [
        WireItem(id: "w1", club: "Northport Kings", abbreviation: "NK", followed: true, text: "claimed RHP Danny Ruiz off waivers from Cascade.", when: "Yesterday"),
        WireItem(id: "w2", club: "Delta City Herons", abbreviation: "DC", followed: true, text: "signed 3B Wes Farrow to a two-year extension.", when: "Yesterday"),
        WireItem(id: "w3", club: "Sunbelt Rays", abbreviation: "SR", followed: false, text: "traded C Luis Peña to Harbor for two prospects.", when: "July 12"),
        WireItem(id: "w4", club: "Cascade Loggers", abbreviation: "CL", followed: false, text: "released 1B Ty Gorman.", when: "July 12"),
    ]

    // MARK: The palette

    public static let paletteEntries: [PaletteEntry] = [
        PaletteEntry(id: "frontOffice.morningReport", group: "Front Office", symbol: "sun.horizon", title: "Morning Report", line: "Front Office", keywords: ["today", "desk"], shortcut: "⌘1"),
        PaletteEntry(id: "frontOffice.report", group: "Front Office", symbol: "list.bullet.clipboard", title: "Report", line: "Front Office · the whole desk"),
        PaletteEntry(id: "majorLeague.report", group: "Major League Ops", symbol: "list.bullet.clipboard", title: "Report", line: "Major League Ops", shortcut: "⌘2"),
        PaletteEntry(id: "majorLeague.benchCoverage", group: "Major League Ops", symbol: "chair", title: "Bench & Backups", line: "Major League Ops", keywords: ["bench", "backups", "catcher"]),
        PaletteEntry(id: "command.refresh", group: "Commands", symbol: "arrow.clockwise", title: "Refresh Data", line: "Import the export again", shortcut: "⌘R"),
        PaletteEntry(id: "command.inspector", group: "Commands", symbol: "sidebar.trailing", title: "Show Inspector", shortcut: "⌥⌘I"),
    ]

    // MARK: A desk item and a department card, in the served shapes

    public static let deskItem = Components.Schemas.FoItem(
        key: "majorLeague:need:catchers", department: .init(value1: .majorLeague),
        raisedBy: .init(display: "Raised by Rafael Dunn, bench coach", hint: "From the club's staff in the save"),
        severity: .init(value1: .critical), neutralSeverity: .init(value1: .critical),
        urgency: claim("Urgent", tone: .init(value1: .bad), basis: basis([("Major League Ops said", "Urgent"), ("With no philosophy and no season", "Urgent"), ("On the desk", "Urgent")], from: "The desk", called: policy, stamp: "Urgent: a position with one healthy player and no defensible call-up (a policy line).")),
        headline: claim("Short of healthy catchers: Mendez is out three to four weeks and Okafor is the only one on the 40.", hint: "Urgent · Major League Ops", tone: .init(value1: .bad),
                        basis: basis([("Catchers on the 40", "2, one on the injured list"), ("Mendez", "Strained oblique · 3–4 weeks"), ("Nearest on the farm", "L. Moreau (AA) · not yet")], from: "Major League Ops · needs from the current export", called: policy,
                                     unknown: ["The league's waiver rules aren't in the export; what a claim costs is not known."], wouldChange: ["A claim or a trade for a catcher clears it.", "Mendez back sooner than four weeks."]), links: [mlbView]),
        detail: nil, due: .init(display: "5 days left"), dueInDays: 5, evidence: "majorLeague:need:catchers", count: 1
    )

    public static let departmentCard = Components.Schemas.DepartmentCard(
        department: .init(value1: .majorLeague), name: "Major League Ops", status: .init(value1: .ready),
        preparedBy: .init(display: "Prepared by Rafael Dunn, bench coach", hint: "From the club's staff in the save"),
        summary: claim("Two to decide, four to watch.", tone: .init(value1: .caution), basis: basis([("To decide", "2"), ("To watch", "4")], from: "Major League Ops' roster review")),
        figures: [
            .init(text: "Active", hint: "Players on the active roster today", value: .init(n: 26, unit: .init(value1: .count), whole: 26, display: "26 of 26"), tone: .init(value1: .neutral), basis: basis([("Players", "26"), ("Limit", "26")]), links: []),
            .init(text: "40-man", hint: "Players on the 40-man roster", value: .init(n: 39, unit: .init(value1: .count), whole: 40, display: "39 of 40"), tone: .init(value1: .neutral), basis: basis([("Players", "39"), ("Limit", "40")]), links: []),
            .init(text: "Injured", hint: "Players on the injured list", value: .init(n: 3, unit: .init(value1: .count), display: "3"), tone: .init(value1: .neutral), basis: basis([("On the injured list", "3")]), links: []),
        ],
        top: [deskItem], toDecide: 2, watching: 4, open: mlbView, memo: nil
    )

    public static let notYetCard = Components.Schemas.DepartmentCard(
        department: .init(value1: .scouting), name: "Scouting", status: .init(value1: .notYet),
        preparedBy: .init(display: "No report yet"),
        summary: claim("No report yet.", hint: "This department reports when its views are built", basis: basis([], from: "The Front Office")),
        figures: [], top: [], toDecide: nil, watching: nil, open: nil, memo: nil
    )
}
#endif
