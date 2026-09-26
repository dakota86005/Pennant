import SwiftUI

/// The club card at the top of the sidebar (SWIFTUI_REBUILD.md section 3.2): the served club's name on its served
/// colours, its logo and record when the server serves them, with a line saying which club this is. Everything written
/// on it comes from the caller: the name and the record are served, the line is a structural label.
///
/// The colour is never the only signal: the name is always written. With Increase Contrast the card gets a border and
/// its text is held to 7:1; with no served colour (or team colours off) it is neutral (`ClubTint`). It is opaque on a
/// served colour, and it does not move.
public struct ClubCard: View {
    private let name: String
    private let detail: Text?
    private let record: String?
    private let recordHint: String?
    private let logo: Image?
    private let tint: ClubTint
    private let symbol: String
    @Environment(\.colorSchemeContrast) private var contrast

    /// - Parameters:
    ///   - name: the served club name (`label`).
    ///   - detail: a structural line under it ("Your club"), or nil.
    ///   - record: the served record ("45–38"), or nil; `recordHint` is its served help tag.
    ///   - logo: the club's logo as the save holds it, drawn in place of the symbol; nil draws the symbol.
    ///   - tint: the served colours.
    ///   - symbol: an SF Symbol drawn beside the name.
    public init(
        name: String,
        detail: Text?,
        record: String? = nil,
        recordHint: String? = nil,
        logo: Image? = nil,
        tint: ClubTint,
        symbol: String = "baseball.diamond.bases"
    ) {
        self.name = name
        self.detail = detail
        self.record = record
        self.recordHint = recordHint
        self.logo = logo
        self.tint = tint
        self.symbol = symbol
    }

    public var body: some View {
        let increased = contrast == .increased
        let fill = tint.fill(increasedContrast: increased)
        let text = tint.text(increasedContrast: increased)
        HStack(spacing: 10) {
            Group {
                if let logo {
                    logo.resizable().scaledToFit().frame(width: 32, height: 32)
                } else {
                    Image(systemName: symbol).font(.title2)
                }
            }
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: name)
                    .font(.headline)
                    .lineLimit(2)
                if let detail {
                    detail
                        .font(.caption)
                }
            }
            Spacer(minLength: 0)
            if let record {
                Text(verbatim: record)
                    .font(.title3.weight(.semibold))
                    .fontWidth(.condensed)
                    .monospacedDigit()
                    .contentTransition(.numericText())
                    .help(recordHint.map { Text(verbatim: $0) } ?? Text(verbatim: record))
            }
        }
        .foregroundStyle(text.map { AnyShapeStyle($0) } ?? AnyShapeStyle(.primary))
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background {
            if let fill {
                RoundedRectangle(cornerRadius: 10).fill(fill)
            } else {
                RoundedRectangle(cornerRadius: 10).fill(.fill.tertiary)
            }
        }
        .overlay {
            if increased {
                RoundedRectangle(cornerRadius: 10).strokeBorder(Color.primary, lineWidth: 1.5)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("club.card")
    }
}

#Preview("Club card") {
    VStack {
        ClubCard(name: "Club 1 N", detail: Text("Your club"), record: "15–15", recordHint: "15 wins, 15 losses", tint: ClubTint(background: "#1d2d44", foreground: "#f0ebd8"))
        ClubCard(name: "Low contrast", detail: nil, tint: ClubTint(background: "#777777", foreground: "#888888"))
        ClubCard(name: "No colours served", detail: nil, tint: ClubTint(background: nil, foreground: nil))
    }
    .padding()
    .frame(width: 260)
}
