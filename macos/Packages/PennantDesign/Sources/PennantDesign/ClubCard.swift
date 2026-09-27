import SwiftUI

/// The club card at the top of the sidebar (SWIFTUI_REBUILD.md section 3.2): the served club's name on the theme's card
/// colours, its logo and record when they are served, with a line saying which club this is. Everything written on it
/// comes from the caller: the name and the record are served, the line is a structural label.
///
/// The colour is never the only signal: the name is always written. The colours are the theme's (`\.theme`), for the
/// window's appearance and contrast; a neutral theme draws the system's fill and label colour. With Increase Contrast
/// the card gets a border. It is opaque, and it does not move.
public struct ClubCard: View {
    private let name: String
    private let detail: Text?
    private let record: String?
    private let recordHint: String?
    private let logo: Image?
    private let symbol: String
    @Environment(\.theme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @EffectiveContrast private var contrast
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// - Parameters:
    ///   - name: the served club name (`label`).
    ///   - detail: a structural line under it ("Your club"), or nil.
    ///   - record: the served record ("45–38"), or nil; `recordHint` is its served help tag.
    ///   - logo: the club's logo as served, drawn in place of the symbol; nil draws the symbol.
    ///   - symbol: an SF Symbol drawn beside the name.
    public init(
        name: String,
        detail: Text?,
        record: String? = nil,
        recordHint: String? = nil,
        logo: Image? = nil,
        symbol: String = "baseball.diamond.bases"
    ) {
        self.name = name
        self.detail = detail
        self.record = record
        self.recordHint = recordHint
        self.logo = logo
        self.symbol = symbol
    }

    public var body: some View {
        let palette = theme.palette(colorScheme: colorScheme, contrast: contrast)
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
                    .contentTransition(reduceMotion ? .identity : .numericText())
                    .help(recordHint.map { Text(verbatim: $0) } ?? Text(verbatim: record))
            }
        }
        .foregroundStyle(palette.cardText)
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(palette.card, in: .rect(cornerRadius: 10))
        .overlay {
            if contrast == .increased {
                RoundedRectangle(cornerRadius: 10).strokeBorder(palette.cardText, lineWidth: 1.5)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("club.card")
    }
}
