import Foundation

/// What the desktop widget draws (N14, Stage A, D-075): the last glance the app was served (`GET /api/v2/glance/:org`),
/// written to the App Group after each refresh. Every string is the server's, as served (a display, or its help tag
/// for VoiceOver); every number is a served one. The widget never calls the server and words nothing itself: what it
/// says when there is no snapshot, or the snapshot is old, comes from its String Catalog.
public struct GlanceSnapshot: Codable, Sendable, Equatable {
    /// The format this build writes. A snapshot of a later format is not read (an older widget beside a newer app).
    public static let currentVersion = 1

    public var version: Int
    /// When the app wrote it: the widget says how long ago, and marks it out of date after a while (`GlanceTimeline`).
    public var writtenAt: Date
    /// The club's name; nil when the export does not have it.
    public var club: String?
    /// How current the served data is ("Through May 5, 2040").
    public var asOf: String
    /// The record ("26–17", spoken "Won 26, lost 17"); nil when not served (`missing` says why).
    public var record: Line?
    /// The next game; nil when not served (`missing` says why).
    public var nextGame: Game?
    /// Why the record or the next game is not shown, one sentence each.
    public var missing: [String]
    public var desk: Desk
    /// The club's card colours as its served theme gives them (each pair checked by the server at 4.5:1, 7:1 with
    /// Increase Contrast); nil draws the neutral, fixed colours (team colours off, or no theme served).
    public var colors: Colors?

    public init(
        version: Int = GlanceSnapshot.currentVersion, writtenAt: Date, club: String?, asOf: String, record: Line?,
        nextGame: Game?, missing: [String], desk: Desk, colors: Colors?
    ) {
        self.version = version
        self.writtenAt = writtenAt
        self.club = club
        self.asOf = asOf
        self.record = record
        self.nextGame = nextGame
        self.missing = missing
        self.desk = desk
        self.colors = colors
    }

    /// A served figure and its words.
    public struct Line: Codable, Sendable, Equatable {
        /// What is drawn ("26–17").
        public var display: String
        /// What VoiceOver says ("Won 26, lost 17"); nil when the display says it.
        public var spoken: String?

        public init(display: String, spoken: String?) {
            self.display = display
            self.spoken = spoken
        }
    }

    /// The next game, as the masthead says it.
    public struct Game: Codable, Sendable, Equatable {
        /// "Tonight · 7:05 PM".
        public var when: String
        /// "vs Colorado Rockies".
        public var matchup: String

        public init(when: String, matchup: String) {
            self.when = when
            self.matchup = matchup
        }
    }

    /// The desk: its served count, the count in words, and its first items.
    public struct Desk: Codable, Sendable, Equatable {
        public var count: Int
        /// "3 to decide".
        public var line: String
        public var top: [Item]

        public init(count: Int, line: String, top: [Item]) {
            self.count = count
            self.line = line
            self.top = top
        }
    }

    /// One desk item: its headline and the department that raised it.
    public struct Item: Codable, Sendable, Equatable {
        public var headline: String
        public var department: String

        public init(headline: String, department: String) {
            self.headline = headline
            self.department = department
        }
    }

    /// A fill and the text drawn on it, as `#rrggbb`.
    public struct Pair: Codable, Sendable, Equatable {
        public var background: String
        public var text: String

        public init(background: String, text: String) {
            self.background = background
            self.text = text
        }
    }

    /// The club card's colours in each appearance.
    public struct Colors: Codable, Sendable, Equatable {
        public var light: Pair
        public var dark: Pair
        public var lightIncreasedContrast: Pair
        public var darkIncreasedContrast: Pair

        public init(light: Pair, dark: Pair, lightIncreasedContrast: Pair, darkIncreasedContrast: Pair) {
            self.light = light
            self.dark = dark
            self.lightIncreasedContrast = lightIncreasedContrast
            self.darkIncreasedContrast = darkIncreasedContrast
        }

        /// The pair for an appearance.
        public func pair(dark isDark: Bool, increasedContrast: Bool) -> Pair {
            switch (isDark, increasedContrast) {
            case (false, false): light
            case (true, false): dark
            case (false, true): lightIncreasedContrast
            case (true, true): darkIncreasedContrast
            }
        }

        /// The contrast a pair must reach to be drawn: the server's own bar (4.5:1, 7:1 with Increase Contrast).
        public static func requiredRatio(increasedContrast: Bool) -> Double { increasedContrast ? 7 : 4.5 }
    }
}
