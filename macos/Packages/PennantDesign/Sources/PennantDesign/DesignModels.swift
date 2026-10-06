import PennantAPI

// What the data graphics draw (SWIFTUI_REBUILD.md section 3.7, "Design language"): the shapes the Morning Report's
// scoreboard, place strips, roster diagram, chips and wire take. Every sentence in them is the caller's (served, or a
// fixture in a preview or snapshot); the views add only structural labels. Until N6 serves each slot, nothing in the
// running app makes one of these: the server's payloads are read through the generated types, and an adapter maps
// them here when they arrive. The field names follow the served data each slot needs (SWIFTUI_REBUILD.md section 3.4,
// "What the design's slots need from the server").

/// A value with its range, in the unit the server serves it in: on the roster map Player Value's expected wins this
/// season, the rest of it once under way ("Most likely 2.1 wins · could be 0.8 to 3.4"), never dollars; the most
/// likely value marked in the range (the range drawn is where he lands four times in five).
nonisolated public struct ValueRange: Sendable, Hashable {
    public var low: Double
    /// The most likely value; nil when none is served (no mark is drawn, never a midpoint).
    public var likely: Double?
    public var high: Double
    /// The range as served ("Most likely 2.1 wins · could be 0.8 to 3.4").
    public var text: String
    /// The most likely value as served ("2.1 wins").
    public var short: String

    public init(low: Double, likely: Double?, high: Double, text: String, short: String) {
        self.low = low
        self.likely = likely
        self.high = high
        self.text = text
        self.short = short
    }
}

/// The scale a diagram's range bars share, served with the diagram (its ends, in the values' own unit), so every bar on
/// it reads against the same line. Swift holds no scale of its own: until the server serves one, there is no diagram.
nonisolated public struct ValueScale: Sendable, Hashable {
    public var low: Double
    public var high: Double

    /// A scale is its two ends, low below high; anything else is no scale.
    public init?(low: Double, high: Double) {
        guard low.isFinite, high.isFinite, low < high else { return nil }
        self.low = low
        self.high = high
    }

    /// Where a value sits along the scale, 0 at `low` and 1 at `high` (outside 0...1 for a value off the scale, which
    /// the bar clips rather than moving it).
    public func position(of value: Double) -> Double {
        (value - low) / (high - low)
    }
}

/// One dimension of "How we win and lose": a stated league place among the clubs that have the figure.
nonisolated public struct PlaceDimension: Identifiable, Sendable, Hashable {
    /// Where the server puts a dimension: a strength (the top fifth, a stated line), a weakness (the bottom fifth),
    /// the rest, too early to call (below the stated sample), or not placed (the export lacks the club's figure:
    /// drawn quieter, and never as a weakness).
    public enum Group: String, Sendable, Hashable, CaseIterable {
        case strength, weakness, rest, tooEarly, notPlaced
    }

    /// A group's heading as served: its title ("Strengths") and the policy line beside it ("Top fifth of the league"),
    /// each with its help tag; no line where the title says it all ("The rest").
    public struct Heading: Sendable, Hashable {
        public var title: String
        public var titleHint: String?
        public var line: String?
        public var lineHint: String?

        public init(title: String, titleHint: String? = nil, line: String? = nil, lineHint: String? = nil) {
            self.title = title
            self.titleHint = titleHint
            self.line = line
            self.lineHint = lineHint
        }
    }

    public var id: String
    public var name: String
    public var symbol: String
    /// The place among `of` clubs; nil when it is too early to call.
    public var place: Int?
    /// The clubs the strip shows, as served (0 draws an empty track and no dots).
    public var of: Int
    /// Where the stated lines fall, as served: a place at or above `strengthThrough` is a strength, at or below
    /// `weaknessFrom` a weakness; nil in a league too small to have a top or bottom fifth (no shading).
    public var strengthThrough: Int?
    public var weaknessFrom: Int?
    /// How many other clubs share the place.
    public var tiedWith: Int
    /// The place over the recent window; nil when the sample is too small to call.
    public var recentPlace: Int?
    /// The place as served ("T-26th of 30", "Too early").
    public var placeText: String
    /// The recent place as served ("Last 15: 9th", "Last 15: too few").
    public var recentText: String
    public var group: Group
    public var claim: Components.Schemas.Claim
    /// The figure behind the place, as served ("4.63 runs a game · league middle 4.31"), with its help tag: the name's
    /// hover. Nil when not served (a fixture).
    public var detail: String?
    public var detailHint: String?
    /// Why there is no recent place, as served; nil when there is one (the recent reading's hover).
    public var recentWhy: String?

    public init(
        id: String, name: String, symbol: String, place: Int?, of: Int, strengthThrough: Int? = nil, weaknessFrom: Int? = nil,
        tiedWith: Int, recentPlace: Int?, placeText: String, recentText: String, group: Group, claim: Components.Schemas.Claim,
        detail: String? = nil, detailHint: String? = nil, recentWhy: String? = nil
    ) {
        self.detail = detail
        self.detailHint = detailHint
        self.recentWhy = recentWhy
        self.id = id
        self.name = name
        self.symbol = symbol
        self.place = place
        self.of = of
        self.strengthThrough = strengthThrough
        self.weaknessFrom = weaknessFrom
        self.tiedWith = tiedWith
        self.recentPlace = recentPlace
        self.placeText = placeText
        self.recentText = recentText
        self.group = group
        self.claim = claim
    }
}

/// How long the club controls a player, as Player Rights answers it: seasons through a year, or a clock.
nonisolated public enum ControlTerm: Sendable, Hashable {
    /// Under control for `seasons` more seasons, counting this one ("Through 2043"); nil when the server gives no count
    /// (drawn hatched, as not known: never as no seasons).
    case seasons(Int?, text: String)
    /// A clock ("Arbitration this winter", "Free agent after this season").
    case clock(String)
    /// Not known: the export lacks what it takes.
    case unknown(String)

    public var text: String {
        switch self {
        case .seasons(_, let text), .clock(let text), .unknown(let text): text
        }
    }
}

/// A served line with its help tag (a `Cell`'s words), where a slot shows a sentence the server wrote.
nonisolated public struct ServedLine: Identifiable, Sendable, Hashable {
    public var id: String
    public var text: String
    public var hint: String?

    public init(id: String, text: String, hint: String? = nil) {
        self.id = id
        self.text = text
        self.hint = hint
    }
}

/// How a node's holder was chosen, as served: the regular the club's game log shows (the most starts there lately),
/// or the man listed there where the log is silent (said on the plate).
nonisolated public enum HolderRule: String, Sendable, Hashable {
    case starts, listed
}

/// Player Development's readiness of the farm's next man against the bar it asks for, as served (two served
/// numbers on the served scale they are read on, never a share of a whole): drawn in the node's popover, beside the
/// served words and the served line that labels the two.
nonisolated public struct FarmBar: Sendable, Hashable {
    public var readiness: Int
    public var required: Int
    /// The scale both are read on, as served (0 to 100): a man past his bar is past the line, not a full bar.
    public var scaleLow: Int
    public var scaleHigh: Int
    /// "Readiness 41 · his bar 55", as served, with how the two are read in its hint.
    public var line: String
    public var lineHint: String?
    /// "Ready for a look", "Not ready yet", as served, with Player Development's reasons in its hint.
    public var text: String
    public var hint: String?

    public init(readiness: Int, required: Int, scaleLow: Int, scaleHigh: Int, line: String, lineHint: String? = nil, text: String, hint: String? = nil) {
        self.readiness = readiness
        self.required = required
        self.scaleLow = scaleLow
        self.scaleHigh = scaleHigh
        self.line = line
        self.lineHint = lineHint
        self.text = text
        self.hint = hint
    }

    /// Where a served number sits along the served scale, 0 at its low end and 1 at its high end (clipped to it).
    public func position(of value: Int) -> Double {
        guard scaleHigh > scaleLow else { return 0 }
        return min(1, max(0, Double(value - scaleLow) / Double(scaleHigh - scaleLow)))
    }
}

/// One position on the roster diagram: the holder, what he is worth, his place, who is behind him.
nonisolated public struct RosterPosition: Identifiable, Sendable, Hashable {
    /// The position ("C", "1B", "DH").
    public var id: String
    public var holder: String
    public var value: ValueRange?
    /// The value as served ("2.1 wins", "Not valued").
    public var valueText: String
    /// The place as served ("12th of 30", "Not placed").
    public var placeText: String
    /// Who is behind him, as served.
    public var behind: String
    /// The farm's next man with his readiness, as served; nil when there is nobody with a read.
    public var farmNext: String?
    public var control: ControlTerm
    /// Major League Ops raised a need here.
    public var need: Bool
    public var claim: Components.Schemas.Claim
    /// The position's served name ("Catcher"); empty when not served.
    public var name: String
    /// How his place reads against the other clubs' holders, as served ("Clearly ahead of 4 · not separable from
    /// 22"), with the help tag saying how clubs are told apart; nil when not served.
    public var overlapText: String?
    public var overlapHint: String?
    /// How the holder was chosen; nil with nobody there, or when not served.
    public var holderRule: HolderRule?
    /// The farm's next man's readiness against its bar; nil when either is not known, or not served.
    public var farmBar: FarmBar?
    /// What his control means and how it is read, as served (the pips' hover); nil when not served.
    public var controlHint: String?

    public init(
        id: String, holder: String, value: ValueRange?, valueText: String, placeText: String, behind: String,
        farmNext: String?, control: ControlTerm, need: Bool, claim: Components.Schemas.Claim,
        name: String = "", overlapText: String? = nil, overlapHint: String? = nil, holderRule: HolderRule? = nil, farmBar: FarmBar? = nil,
        controlHint: String? = nil
    ) {
        self.controlHint = controlHint
        self.id = id
        self.holder = holder
        self.value = value
        self.valueText = valueText
        self.placeText = placeText
        self.behind = behind
        self.farmNext = farmNext
        self.control = control
        self.need = need
        self.claim = claim
        self.name = name
        self.overlapText = overlapText
        self.overlapHint = overlapHint
        self.holderRule = holderRule
        self.farmBar = farmBar
    }
}

/// One pitcher in the rotation or the bullpen beside the diagram.
nonisolated public struct StaffPitcher: Identifiable, Sendable, Hashable {
    public var id: String
    /// "SP1", "CL", "SU", as served.
    public var role: String
    public var name: String
    /// His line, as served ("7–4 · 3.21").
    public var line: String
    public var value: ValueRange?
    /// A note, as served ("Tonight", "Rehab ends Friday"); nil when none.
    public var note: String?
    /// The help tag: what the range says, or why he is not valued.
    public var hint: String
    /// Major League Ops raised a need naming him.
    public var need: Bool
    /// The pitcher with his basis; nil when not served (a fixture).
    public var claim: Components.Schemas.Claim?

    public init(id: String, role: String, name: String, line: String, value: ValueRange?, note: String?, hint: String, need: Bool = false, claim: Components.Schemas.Claim? = nil) {
        self.id = id
        self.role = role
        self.name = name
        self.line = line
        self.value = value
        self.note = note
        self.hint = hint
        self.need = need
        self.claim = claim
    }
}

/// A chip in "since the last export".
nonisolated public struct Chip: Identifiable, Sendable, Hashable {
    public var id: String
    public var symbol: String
    public var text: String
    public var hint: String
    /// Whether it opens its items (a chip that counts none, "None moved", is drawn as words, not a control).
    public var opens: Bool

    public init(id: String, symbol: String, text: String, hint: String, opens: Bool = true) {
        self.id = id
        self.symbol = symbol
        self.text = text
        self.hint = hint
        self.opens = opens
    }
}

/// One entry on the league wire.
nonisolated public struct WireItem: Identifiable, Sendable, Hashable {
    public var id: String
    public var club: String
    /// The club's abbreviation, as served.
    public var abbreviation: String
    public var followed: Bool
    public var text: String
    /// When, as served ("Yesterday", "July 12").
    public var when: String
    /// What happened as a served claim, so its basis opens; nil draws the text alone (the fixtures).
    public var claim: Components.Schemas.Claim?
    /// The club's id, for its window and a drag; nil when not served.
    public var clubId: Int?

    public init(id: String, club: String, abbreviation: String, followed: Bool, text: String, when: String,
                claim: Components.Schemas.Claim? = nil, clubId: Int? = nil) {
        self.id = id
        self.club = club
        self.abbreviation = abbreviation
        self.followed = followed
        self.text = text
        self.when = when
        self.claim = claim
        self.clubId = clubId
    }
}

/// A game's result in the last five: a win, a loss, or a tie (a game the export records as level, which some leagues
/// allow).
nonisolated public enum GameResult: Sendable, Hashable {
    case win, loss, tie

    /// From a served letter ("W", "L", "T"); anything else is nil.
    public init?(served letter: String) {
        switch letter.uppercased() {
        case "W": self = .win
        case "L": self = .loss
        case "T": self = .tie
        default: return nil
        }
    }
}

/// Tonight's game, for the masthead's one control.
nonisolated public struct TonightGame: Sendable, Hashable {
    /// "Tonight · 7:05", as served.
    public var when: String
    /// "vs Northport Kings", as served.
    public var matchup: String
    /// Both starters on one line, as served.
    public var starters: String
    public var hint: String
    /// The game with its basis (the date, the start, the starters' source); nil when not served.
    public var claim: Components.Schemas.Claim?
    /// Where the control opens (the schedule and game plans until Game Day, N9); nil when not served.
    public var open: Components.Schemas.Target?

    public init(when: String, matchup: String, starters: String, hint: String, claim: Components.Schemas.Claim? = nil, open: Components.Schemas.Target? = nil) {
        self.when = when
        self.matchup = matchup
        self.starters = starters
        self.hint = hint
        self.claim = claim
        self.open = open
    }
}

/// The trade deadline, beside tonight's game.
nonisolated public struct DeadlineNote: Sendable, Hashable {
    /// "17 days", as served.
    public var count: String
    /// "to the deadline · July 31", as served.
    public var text: String
    /// The deadline with its basis (the league's own row); nil when not served.
    public var claim: Components.Schemas.Claim?

    public init(count: String, text: String, claim: Components.Schemas.Claim? = nil) {
        self.count = count
        self.text = text
        self.claim = claim
    }
}

/// The masthead's scoreboard (SWIFTUI_REBUILD.md section 3.4, item 1): objective facts only, no odds or posture (D-060).
nonisolated public struct Scoreboard: Sendable, Hashable {
    /// The record, with its basis; its `value.display` is what the figure shows.
    public var record: Components.Schemas.Claim
    /// The small-caps line under the record ("2nd in the East · 2½ back"), as served.
    public var recordLine: String
    /// The run differential, with its basis; nil when the export lacks it.
    public var runs: Components.Schemas.Claim?
    /// The line under it ("412 scored · 375 allowed"), as served.
    public var runsLine: String?
    /// The run differential's trend, oldest first, for the sparkline; nil when not served.
    public var trend: [Int]?
    /// The last five results, oldest first; nil when not served.
    public var lastFive: [GameResult]?
    /// "Lost 1 · last five 3–2", as served.
    public var lastFiveLine: String?
    public var tonight: TonightGame?
    public var deadline: DeadlineNote?
    /// The division place with its basis (the line under the record opens it); nil when not served.
    public var placeClaim: Components.Schemas.Claim?
    /// The streak, as served ("Won 3"); nil when not served.
    public var streak: String?
    public var streakHint: String?
    /// Each part of the box score the export cannot give, with its served sentence, shown where the part is not.
    public var missing: [ServedLine]

    public init(
        record: Components.Schemas.Claim, recordLine: String, runs: Components.Schemas.Claim? = nil, runsLine: String? = nil,
        trend: [Int]? = nil, lastFive: [GameResult]? = nil, lastFiveLine: String? = nil, tonight: TonightGame? = nil,
        deadline: DeadlineNote? = nil, placeClaim: Components.Schemas.Claim? = nil, streak: String? = nil, streakHint: String? = nil,
        missing: [ServedLine] = []
    ) {
        self.record = record
        self.recordLine = recordLine
        self.runs = runs
        self.runsLine = runsLine
        self.trend = trend
        self.lastFive = lastFive
        self.lastFiveLine = lastFiveLine
        self.tonight = tonight
        self.deadline = deadline
        self.placeClaim = placeClaim
        self.streak = streak
        self.streakHint = streakHint
        self.missing = missing
    }
}

/// A figure on a department tile or report: a served claim whose value is the figure and whose text is its label.
nonisolated public struct Figure: Identifiable, Sendable, Hashable {
    public var id: String
    public var claim: Components.Schemas.Claim
    /// A share of a whole (0...1) when the figure is a real "x of y"; drawn as a ring.
    public var fraction: Double?

    public init(id: String, claim: Components.Schemas.Claim, fraction: Double? = nil) {
        self.id = id
        self.claim = claim
        self.fraction = fraction
    }

    /// A served figure: its `value.display` is the figure, its `text` the label. A ring only when the server serves
    /// the whole it is a count of (`value.whole`, a real "x of y"); a range's `high` is the end of a range, never a
    /// whole, so a range draws no ring.
    public init(_ claim: Components.Schemas.Claim, id: String) {
        self.id = id
        self.claim = claim
        if let n = claim.value?.n, let whole = claim.value?.whole, whole > 0 {
            fraction = n / whole
        } else {
            fraction = nil
        }
    }
}

/// An entry the ⌘K palette can open: a department, a view, a command, and later a player or a club.
nonisolated public struct PaletteEntry: Identifiable, Sendable, Hashable {
    public var id: String
    /// The group it is listed under, as the registry or the server names it.
    public var group: String
    public var symbol: String
    public var title: String
    /// One line under the title; nil for none.
    public var line: String?
    /// The words the query matches besides the title (never shown).
    public var keywords: [String]
    /// A keyboard shortcut to show beside it ("⌘2"); nil for none.
    public var shortcut: String?
    /// The GM follows it (a served search result): a star beside it.
    public var followed: Bool
    /// Whether it opens anything (a served player with no club to open, a free agent, does not): drawn disabled.
    public var opens: Bool

    public init(id: String, group: String, symbol: String, title: String, line: String? = nil, keywords: [String] = [], shortcut: String? = nil, followed: Bool = false, opens: Bool = true) {
        self.id = id
        self.group = group
        self.symbol = symbol
        self.title = title
        self.line = line
        self.keywords = keywords
        self.shortcut = shortcut
        self.followed = followed
        self.opens = opens
    }

    /// Whether the query matches: every word of the query is a prefix of a word in the title, the group, the line or
    /// the keywords (case-insensitive). An empty query matches everything.
    public nonisolated func matches(_ query: String) -> Bool {
        let words = query.split(whereSeparator: \.isWhitespace).map { $0.lowercased() }
        guard !words.isEmpty else { return true }
        let haystack = ([title, group, line ?? ""] + keywords)
            .flatMap { $0.split(whereSeparator: { !$0.isLetter && !$0.isNumber }) }
            .map { $0.lowercased() }
        return words.allSatisfy { word in haystack.contains { $0.hasPrefix(word) } }
    }

    /// How well the query matches, for ordering: a title starting with the query first, then a title containing it,
    /// then the rest. Ties keep the given order.
    public nonisolated func rank(_ query: String) -> Int {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return 2 }
        let title = title.lowercased()
        if title.hasPrefix(q) { return 0 }
        if title.contains(q) { return 1 }
        return 2
    }

    /// The entries matching the query, best first, in their groups' given order within a rank.
    public nonisolated static func matching(_ query: String, in entries: [PaletteEntry]) -> [PaletteEntry] {
        entries.enumerated()
            .filter { $0.element.matches(query) }
            .sorted { a, b in
                let ra = a.element.rank(query), rb = b.element.rank(query)
                return ra != rb ? ra < rb : a.offset < b.offset
            }
            .map(\.element)
    }
}
