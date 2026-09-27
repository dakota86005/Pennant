import PennantAPI

// What the data graphics draw (SWIFTUI_REBUILD.md section 3.7, "Design language"): the shapes the Morning Report's
// scoreboard, place strips, roster diagram, chips and wire take. Every sentence in them is the caller's (served, or a
// fixture in a preview or snapshot); the views add only structural labels. Until N6 serves each slot, nothing in the
// running app makes one of these: the server's payloads are read through the generated types, and an adapter maps
// them here when they arrive. The field names follow the served data each slot needs (SWIFTUI_REBUILD.md section 3.4,
// "What the design's slots need from the server").

/// A value with its range ("what he's worth beyond what he's paid"): the most likely value marked in the range.
nonisolated public struct ValueRange: Sendable, Hashable {
    public var low: Double
    public var likely: Double
    public var high: Double
    /// The range as served ("$8M · could be $4M to $11M").
    public var text: String
    /// The most likely value as served ("$8M").
    public var short: String

    public init(low: Double, likely: Double, high: Double, text: String, short: String) {
        self.low = low
        self.likely = likely
        self.high = high
        self.text = text
        self.short = short
    }
}

/// One dimension of "How we win and lose": a stated league place among the clubs that have the figure.
nonisolated public struct PlaceDimension: Identifiable, Sendable, Hashable {
    /// Where the server puts a dimension: a strength (the top fifth, a stated line), a weakness (the bottom fifth),
    /// the rest, or too early to call (below the stated sample).
    public enum Group: String, Sendable, Hashable, CaseIterable {
        case strength, weakness, rest, tooEarly
    }

    public var id: String
    public var name: String
    public var symbol: String
    /// The place among `of` clubs; nil when it is too early to call.
    public var place: Int?
    public var of: Int
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

    public init(
        id: String, name: String, symbol: String, place: Int?, of: Int, tiedWith: Int, recentPlace: Int?,
        placeText: String, recentText: String, group: Group, claim: Components.Schemas.Claim
    ) {
        self.id = id
        self.name = name
        self.symbol = symbol
        self.place = place
        self.of = of
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
    /// Under control for `seasons` more seasons, counting this one ("Through 2043").
    case seasons(Int, text: String)
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

/// One position on the roster diagram: the holder, what he is worth, his place, who is behind him.
nonisolated public struct RosterPosition: Identifiable, Sendable, Hashable {
    /// The position ("C", "1B", "DH").
    public var id: String
    public var holder: String
    public var value: ValueRange?
    /// The value as served ("$8M", "Not valued").
    public var valueText: String
    /// The place as served ("12th of 30", "Not placed yet").
    public var placeText: String
    /// Who is behind him, as served.
    public var behind: String
    /// The farm's next man with his readiness, as served; nil when there is nobody with a read.
    public var farmNext: String?
    public var control: ControlTerm
    /// Major League Ops raised a need here.
    public var need: Bool
    public var claim: Components.Schemas.Claim

    public init(
        id: String, holder: String, value: ValueRange?, valueText: String, placeText: String, behind: String,
        farmNext: String?, control: ControlTerm, need: Bool, claim: Components.Schemas.Claim
    ) {
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

    public init(id: String, role: String, name: String, line: String, value: ValueRange?, note: String?, hint: String) {
        self.id = id
        self.role = role
        self.name = name
        self.line = line
        self.value = value
        self.note = note
        self.hint = hint
    }
}

/// A chip in "since the last export".
nonisolated public struct Chip: Identifiable, Sendable, Hashable {
    public var id: String
    public var symbol: String
    public var text: String
    public var hint: String

    public init(id: String, symbol: String, text: String, hint: String) {
        self.id = id
        self.symbol = symbol
        self.text = text
        self.hint = hint
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

    public init(id: String, club: String, abbreviation: String, followed: Bool, text: String, when: String) {
        self.id = id
        self.club = club
        self.abbreviation = abbreviation
        self.followed = followed
        self.text = text
        self.when = when
    }
}

/// A game's result in the last five.
nonisolated public enum GameResult: Sendable, Hashable {
    case win, loss

    /// From a served letter ("W", "L"); anything else is nil.
    public init?(served letter: String) {
        switch letter.uppercased() {
        case "W": self = .win
        case "L": self = .loss
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

    public init(when: String, matchup: String, starters: String, hint: String) {
        self.when = when
        self.matchup = matchup
        self.starters = starters
        self.hint = hint
    }
}

/// The trade deadline, beside tonight's game.
nonisolated public struct DeadlineNote: Sendable, Hashable {
    /// "17 days", as served.
    public var count: String
    /// "to the deadline · July 31", as served.
    public var text: String

    public init(count: String, text: String) {
        self.count = count
        self.text = text
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

    public init(
        record: Components.Schemas.Claim, recordLine: String, runs: Components.Schemas.Claim? = nil, runsLine: String? = nil,
        trend: [Int]? = nil, lastFive: [GameResult]? = nil, lastFiveLine: String? = nil, tonight: TonightGame? = nil,
        deadline: DeadlineNote? = nil
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

    /// A served figure: its `value.display` is the figure, its `text` the label. A ring only when the served value
    /// has a whole to be a share of (`value.high`).
    public init(_ claim: Components.Schemas.Claim, id: String) {
        self.id = id
        self.claim = claim
        if let n = claim.value?.n, let whole = claim.value?.high, whole > 0 {
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

    public init(id: String, group: String, symbol: String, title: String, line: String? = nil, keywords: [String] = [], shortcut: String? = nil) {
        self.id = id
        self.group = group
        self.symbol = symbol
        self.title = title
        self.line = line
        self.keywords = keywords
        self.shortcut = shortcut
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
