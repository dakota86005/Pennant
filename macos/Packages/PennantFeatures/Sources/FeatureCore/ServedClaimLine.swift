import PennantAPI
import PennantDesign
import SwiftUI

/// A served claim as a line of its own: its tone as a symbol (never colour alone), its text wrapping in full, its hint
/// on hover and its basis a click (or Space) away. The Setup window's reasons, the notices' sentences and the rating
/// history's lines use it; every word is the server's.
public struct ServedClaimLine: View {
    let claim: Components.Schemas.Claim
    let font: Font

    public init(_ claim: Components.Schemas.Claim, font: Font = .body) {
        self.claim = claim
        self.font = font
    }

    public var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            ToneSymbol(tone: claim.tone)
            ClaimText(claim, edge: .trailing) {
                Text(verbatim: claim.text)
                    .font(font)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

extension Components.Schemas.Claim {
    /// The claim for a help tag where the whole row is a control and its basis cannot open in a popover (a save the GM
    /// chooses with one click): the served text, its hint, then each line of its basis ("Last played: Sep 22, …"), one
    /// to a line. Only served words, joined.
    public var hoverText: String {
        ([text, hint] + basis.because.map { "\($0.label): \($0.value)" } + [basis.stamp])
            .compactMap { $0 }
            .filter { !$0.isEmpty }
            .joined(separator: "\n")
    }
}
