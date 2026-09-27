import PennantAPI
import PennantDesign
import SwiftUI

/// The symbol beside a served line, from its served tone: the design's tone symbols (a different shape for each tone,
/// so colour is never the only signal). Decorative: the served words beside it say the same thing to VoiceOver.
public struct ToneSymbol: View {
    let tone: Components.Schemas.Tone?

    public init(tone: Components.Schemas.Tone?) {
        self.tone = tone
    }

    public var body: some View {
        ToneMark(served: tone)
            // A neutral line is marked small, never a large ring that reads as a control
            .imageScale(tone?.value1 == .neutral || tone == nil ? .small : .medium)
    }
}
