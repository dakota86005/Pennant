import PennantAPI
import SwiftUI

/// The ⓘ beside a served claim: a click opens its basis (SWIFTUI_REBUILD.md section 3.3, the Basis layer): the evidence
/// lines, what is not known and what would change it, all as served. The claim's own line stays the only text on the
/// face; the basis is the breakdown. N5's `BasisPopover` (detachable, pinned to the inspector) replaces this stand-in.
public struct BasisButton: View {
    let basis: Components.Schemas.Basis
    @State private var showing = false

    public init(basis: Components.Schemas.Basis) {
        self.basis = basis
    }

    public var body: some View {
        Button {
            showing.toggle()
        } label: {
            Image(systemName: "info.circle")
        }
        .buttonStyle(.borderless)
        .help(Text("Show why"))
        .accessibilityLabel(Text("Show why"))
        .accessibilityIdentifier("basis.button")
        .popover(isPresented: $showing, arrowEdge: .trailing) {
            BasisContent(basis: basis)
                .padding()
                .frame(width: 360, alignment: .leading)
        }
    }
}

/// A served basis, read top to bottom.
struct BasisContent: View {
    let basis: Components.Schemas.Basis

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if !basis.because.isEmpty {
                section("Why") {
                    ForEach(Array(basis.because.enumerated()), id: \.offset) { _, line in
                        LabeledContent {
                            Text(verbatim: line.value).multilineTextAlignment(.trailing)
                        } label: {
                            Text(verbatim: line.label)
                        }
                    }
                }
            }
            if !basis.unknown.isEmpty {
                section("Not known") { sentences(basis.unknown) }
            }
            if !basis.wouldChange.isEmpty {
                section("What would change it") { sentences(basis.wouldChange) }
            }
        }
        .font(.callout)
        .accessibilityIdentifier("basis.content")
    }

    private func section<Content: View>(_ title: LocalizedStringKey, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.headline)
            content()
        }
    }

    private func sentences(_ texts: [String]) -> some View {
        ForEach(Array(texts.enumerated()), id: \.offset) { _, text in
            Text(verbatim: text).fixedSize(horizontal: false, vertical: true)
        }
    }
}
