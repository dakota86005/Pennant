import PennantAPI
import SwiftUI

// The four layers of depth (SWIFTUI_REBUILD.md section 3.3): a served claim on the face, its help tag on hover, its
// basis in a popover on a click (or Space on the focused claim), the evidence pinned to the inspector, and the way
// into the department that owns it. Every word is the server's; the views add the section labels.

/// What the window offers a basis popover (set by the shell): pinning a claim to the inspector, detaching the popover
/// into a floating panel, opening a served target, and the served names of the departments a target names. Nil where
/// no window hosts the view (a preview), and the popover offers nothing.
public struct ClaimActions {
    public var pin: (@MainActor (Components.Schemas.Claim) -> Void)?
    public var detach: (@MainActor (Components.Schemas.Claim) -> Void)?
    /// Opens a served target; false when this build cannot (the button is not offered).
    public var canOpen: (@MainActor (Components.Schemas.Target) -> Bool)?
    public var open: (@MainActor (Components.Schemas.Target) -> Void)?
    /// A department's served name by its id, for "Open in Major League Ops" and the basis's "From".
    public var departmentName: (@MainActor (String) -> String?)?

    public init(
        pin: (@MainActor (Components.Schemas.Claim) -> Void)? = nil,
        detach: (@MainActor (Components.Schemas.Claim) -> Void)? = nil,
        canOpen: (@MainActor (Components.Schemas.Target) -> Bool)? = nil,
        open: (@MainActor (Components.Schemas.Target) -> Void)? = nil,
        departmentName: (@MainActor (String) -> String?)? = nil
    ) {
        self.pin = pin
        self.detach = detach
        self.canOpen = canOpen
        self.open = open
        self.departmentName = departmentName
    }
}

extension EnvironmentValues {
    @Entry public var claimActions: ClaimActions? = nil
}

/// A served claim on the face: the caller's label, the served help tag on hover, the basis popover on a click or on
/// Space while it is focused (a click or Tab focuses it; like Quick Look, and whether or not the Mac's keyboard
/// navigation is on, which a plain button would need). VoiceOver reads the served text as the label and the basis as
/// custom content.
public struct ClaimText<Label: View, Detail: View>: View {
    let claim: Components.Schemas.Claim
    let edge: Edge
    @ViewBuilder let label: () -> Label
    /// What the popover shows under the basis (a served figure the basis's words describe); nothing by default.
    @ViewBuilder let detail: () -> Detail
    @State private var showing = false

    /// The key that opens (and closes) the focused claim's basis, as Quick Look's does a selected file.
    nonisolated public static var basisKey: KeyEquivalent { .space }

    public init(_ claim: Components.Schemas.Claim, edge: Edge = .bottom, @ViewBuilder label: @escaping () -> Label, @ViewBuilder detail: @escaping () -> Detail) {
        self.claim = claim
        self.edge = edge
        self.label = label
        self.detail = detail
    }

    public var body: some View {
        Button { showing.toggle() } label: { label().contentShape(.rect) }
            .buttonStyle(.plain)
            .focusable()
            .onKeyPress(Self.basisKey) {
                showing.toggle()
                return .handled
            }
            .help(Text(verbatim: claim.hint ?? claim.text))
            .accessibilityLabel(Text(verbatim: claim.text))
            .accessibilityHint(Text("Shows why"))
            .accessibilityCustomContent(Text("Why"), Text(verbatim: claim.basis.because.map { "\($0.label): \($0.value)" }.joined(separator: "; ")))
            .accessibilityIdentifier("claim")
            .popover(isPresented: $showing, arrowEdge: edge) { BasisPopover(claim: claim, detail: detail) }
    }
}

extension ClaimText where Detail == EmptyView {
    public init(_ claim: Components.Schemas.Claim, edge: Edge = .bottom, @ViewBuilder label: @escaping () -> Label) {
        self.init(claim, edge: edge, label: label, detail: { EmptyView() })
    }
}

extension ClaimText where Label == Text, Detail == EmptyView {
    /// The claim's served text as its own label.
    public init(_ claim: Components.Schemas.Claim, edge: Edge = .bottom, font: Font = .body) {
        self.init(claim, edge: edge, label: { Text(verbatim: claim.text).font(font) }, detail: { EmptyView() })
    }
}

/// A served figure: its served value large, condensed and tabular, the served text as its label beneath, its basis
/// one click away.
public struct ClaimValue: View {
    let claim: Components.Schemas.Claim
    let size: CGFloat
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(_ claim: Components.Schemas.Claim, size: CGFloat = 22) {
        self.claim = claim
        self.size = size
    }

    public var body: some View {
        ClaimText(claim, edge: .bottom) {
            VStack(alignment: .leading, spacing: 3) {
                Text(verbatim: claim.value?.display ?? claim.text)
                    .font(.system(size: size, weight: .bold)).fontWidth(.condensed).monospacedDigit().lineLimit(1)
                    .contentTransition(reduceMotion ? .identity : .numericText())
                if claim.value != nil {
                    Kicker(claim.text, size: .small).foregroundStyle(.secondary)
                }
            }
        }
    }
}

/// The basis, read top to bottom (section 3.3): why, from, how it's called, not known, would change if, our
/// philosophy's lean beside the neutral reading; then pin to the inspector, detach, and open in the owning department.
public struct BasisPopover<Detail: View>: View {
    let claim: Components.Schemas.Claim
    /// What the caller shows under the basis (a served figure its words describe); nothing by default.
    @ViewBuilder let detail: () -> Detail
    @Environment(\.claimActions) private var actions
    @Environment(\.dismiss) private var dismiss

    public init(claim: Components.Schemas.Claim, @ViewBuilder detail: @escaping () -> Detail) {
        self.claim = claim
        self.detail = detail
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(verbatim: claim.text).font(.headline).fixedSize(horizontal: false, vertical: true)
            if let hint = claim.hint {
                Text(verbatim: hint).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            Divider()
            BasisSections(basis: claim.basis)
            detail()
            if actions?.pin != nil || actions?.detach != nil || openTarget != nil {
                HStack {
                    if let pin = actions?.pin {
                        Button("Pin to Inspector", systemImage: "pin") { pin(claim); dismiss() }
                            .accessibilityIdentifier("basis.pin")
                    }
                    if let detach = actions?.detach {
                        Button("Detach", systemImage: "macwindow.on.rectangle") { detach(claim); dismiss() }
                            .accessibilityIdentifier("basis.detach")
                    }
                    Spacer()
                    if let (target, name) = openTarget, let open = actions?.open {
                        Button { open(target); dismiss() } label: {
                            Label {
                                Text("Open in \(name)")
                            } icon: {
                                Image(systemName: "arrow.up.forward.square")
                            }
                        }
                        .accessibilityIdentifier("basis.open")
                    }
                }
                .controlSize(.small)
                .padding(.top, 4)
            }
        }
        .font(.callout)
        .padding(16)
        .frame(width: 380, alignment: .leading)
        .accessibilityIdentifier("basis.popover")
    }

    /// The first served link this build can open, and the served name of its department.
    private var openTarget: (Components.Schemas.Target, String)? {
        guard let actions, let canOpen = actions.canOpen else { return nil }
        for link in claim.links where canOpen(link) {
            let id = link.department.map { $0.value1?.rawValue ?? $0.value2 ?? "" } ?? ""
            if let name = actions.departmentName?(id) { return (link, name) }
        }
        return nil
    }
}

extension BasisPopover where Detail == EmptyView {
    public init(claim: Components.Schemas.Claim) {
        self.init(claim: claim, detail: { EmptyView() })
    }
}

/// A served basis as sections, shared by the popover and the inspector's evidence view.
public struct BasisSections: View {
    let basis: Components.Schemas.Basis
    @Environment(\.claimActions) private var actions

    public init(basis: Components.Schemas.Basis) {
        self.basis = basis
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if !basis.because.isEmpty {
                section("Why") {
                    Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 4) {
                        ForEach(Array(basis.because.enumerated()), id: \.offset) { _, line in
                            GridRow(alignment: .firstTextBaseline) {
                                Text(verbatim: line.label).foregroundStyle(.secondary).gridColumnAlignment(.leading)
                                    .fixedSize(horizontal: false, vertical: true)
                                Text(verbatim: line.value).monospacedDigit().fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                }
            }
            section("From") {
                Text(verbatim: from).fixedSize(horizontal: false, vertical: true)
            }
            section("How it's called") {
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: basis.called).fixedSize(horizontal: false, vertical: true)
                    if let stamp = basis.stamp {
                        Text(verbatim: stamp).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            if !basis.unknown.isEmpty {
                section("Not known") {
                    ForEach(Array(basis.unknown.enumerated()), id: \.offset) { _, line in
                        Label { Text(verbatim: line).fixedSize(horizontal: false, vertical: true) } icon: { Image(systemName: "questionmark.circle") }
                    }
                }
            }
            if !basis.wouldChange.isEmpty {
                section("Would change if") {
                    ForEach(Array(basis.wouldChange.enumerated()), id: \.offset) { _, line in
                        Label { Text(verbatim: line).fixedSize(horizontal: false, vertical: true) } icon: { Image(systemName: "arrow.triangle.branch") }
                    }
                }
            }
            if let lean = basis.lean {
                section("Our philosophy's lean") {
                    ForEach(Array(lean.why.enumerated()), id: \.offset) { _, line in
                        Text(verbatim: line).fixedSize(horizontal: false, vertical: true)
                    }
                    LabeledContent("The neutral reading") {
                        Text(verbatim: lean.neutral).fixedSize(horizontal: false, vertical: true)
                    }
                    .font(.caption)
                }
            }
        }
        .accessibilityIdentifier("basis.content")
    }

    /// Who answered, as served: the specialist, the department's served name when the window knows it, the sample and
    /// the game date the evidence reflects (as the export wrote it, never re-typed).
    private var from: String {
        let source = basis.source
        let id = source.department.value1?.rawValue ?? source.department.value2 ?? ""
        return [source.specialist, actions?.departmentName?(id), source.sample, source.gameDate]
            .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
    }

    private func section<C: View>(_ title: LocalizedStringKey, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title).font(.caption.weight(.semibold)).foregroundStyle(.secondary).textCase(.uppercase).kerning(0.6)
            content()
        }
    }
}

/// The inspector's evidence view (section 3.3, the Evidence layer): the pinned claim, its basis in full, and whatever
/// trail the caller adds beneath (an item's staff options, fetched on demand).
public struct EvidenceView<Trail: View>: View {
    let claim: Components.Schemas.Claim
    @ViewBuilder let trail: () -> Trail

    public init(claim: Components.Schemas.Claim, @ViewBuilder trail: @escaping () -> Trail = { EmptyView() }) {
        self.claim = claim
        self.trail = trail
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text(verbatim: claim.text).font(.headline).fixedSize(horizontal: false, vertical: true)
                if let hint = claim.hint {
                    Text(verbatim: hint).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
                Divider()
                BasisSections(basis: claim.basis)
                trail()
            }
            .font(.callout)
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityIdentifier("inspector.evidence")
    }
}
