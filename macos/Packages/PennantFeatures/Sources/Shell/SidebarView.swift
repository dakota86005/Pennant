import FeatureCore
import PennantDesign
import PennantKit
import SwiftUI

/// The sidebar (SWIFTUI_REBUILD.md section 3.2): the club card, then every department from the registry disclosing its
/// views (two levels, the HIG's most), with SF Symbols and a badge with the count its card serves to decide.
public struct SidebarView: View {
    @Environment(AppModel.self) private var model
    @Bindable var window: MainWindowModel

    /// The sidebar column's widths: wide enough that every view title in the registry fits at the default text size
    /// (checked by `SidebarWidthTests`).
    public static let minimumWidth: CGFloat = 270
    public static let idealWidth: CGFloat = 280
    public static let maximumWidth: CGFloat = 380
    /// What a view row needs beside its title (the disclosure indent, the symbol and the margins), and the sidebar's row
    /// text size at the default setting, both as macOS 26 draws them (measured from the snapshots).
    public static let viewRowInset: CGFloat = 92
    public static let rowTextSize: CGFloat = 15

    public init(window: MainWindowModel) {
        self.window = window
    }

    public var body: some View {
        List(selection: $window.selection) {
            // The club card is the list's first row (no tag, so it is never selected): it scrolls with the departments
            // and nothing ever draws beneath it
            SidebarClubCard()
                .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 6, trailing: 0))
                .listRowSeparator(.hidden)
            ForEach(window.registry.departments) { department in
                let served = model.catalog?.departments.first { $0.id.value2 == department.id.rawValue || $0.id.value1?.rawValue == department.id.rawValue }
                DisclosureGroup(isExpanded: window.isExpanded(department.id)) {
                    ForEach(department.views) { view in
                        Label {
                            // The served name; the structural title only while the catalog is not there
                            if let name = served?.views.first(where: { $0.id == view.id })?.name {
                                Text(verbatim: name)
                            } else {
                                Text(view.title)
                            }
                        } icon: {
                            SidebarSymbol(name: view.symbol)
                        }
                        .tag(department.route(to: view))
                        .accessibilityIdentifier("sidebar.\(department.id.rawValue).\(view.id)")
                    }
                } label: {
                    Label {
                        if let name = served?.name { Text(verbatim: name) } else { Text(department.title) }
                    } icon: {
                        SidebarSymbol(name: department.symbol)
                    }
                    .badge(department.badge(from: model) ?? 0)
                    .accessibilityIdentifier("sidebar.\(department.id.rawValue)")
                }
            }
        }
        .listStyle(.sidebar)
        // The column's own container (AppKit's, which no SwiftUI modifier reaches) is named for VoiceOver and the audit
        .background(SidebarColumnName())
        // The departments' counts to decide come from the Front Office's served cards (a cached read on the server)
        .task(id: model.storeKey) { await model.loadFrontOffice() }
        .accessibilityIdentifier("sidebar")
    }
}

/// A sidebar row's symbol in a fixed box, scaled to fit it, so a wide symbol (three people, a diamond) never runs into
/// its title.
struct SidebarSymbol: View {
    let name: String

    var body: some View {
        Image(systemName: name)
            .resizable()
            .scaledToFit()
            .frame(width: 18, height: 16)
            .frame(width: 22)
            .accessibilityHidden(true)
    }
}

/// The club card for the served current club: its served name on the theme's card colours (the pack the club wears, or
/// neutral when the GM turned team colours off), its record and logo, and which club it is. A configured club the club
/// list does not have is named as not found; with no club served there is no card.
struct SidebarClubCard: View {
    @Environment(AppModel.self) private var model
    @Environment(\.theme) private var theme
    @State private var logo: Image?

    var body: some View {
        if let club = model.club {
            if let org = club.org {
                let served = model.catalogClub
                ClubCard(
                    name: org.label,
                    detail: club.source.label,
                    record: served?.record.display,
                    recordHint: served?.record.hint,
                    logo: logo
                )
                .task(id: theme.logo) { logo = await ServedImages.image(theme.logo, model: model) }
            } else {
                Label("Club not in this save", systemImage: "questionmark.circle")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityIdentifier("club.card")
            }
        }
    }
}

extension CurrentClub.Source {
    /// A structural line saying which club this is.
    var label: Text? {
        switch self {
        case .humanManaged: Text("Your club")
        case .configured: Text("Chosen in Settings")
        case .other: nil
        }
    }
}

/// Names the sidebar column's container for VoiceOver (N6, Stage B2: the accessibility audit on GitHub's runner found it
/// a group with no description). The container is the split view's hosting view for the column, drawn by AppKit, so no
/// SwiftUI modifier reaches it; labelling a SwiftUI container above the rows instead made them stop scrolling into view
/// for a click (N5). This finds the nearest enclosing view that vends itself as an unnamed group, inside the split view,
/// and gives it the structural name "Sidebar": only its label changes, never its children.
struct SidebarColumnName: NSViewRepresentable {
    static let name: LocalizedStringResource = "Sidebar"

    func makeNSView(context: Context) -> Finder { Finder() }
    func updateNSView(_ view: Finder, context: Context) { view.nameColumn() }

    final class Finder: NSView {
        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            nameColumn()
        }

        func nameColumn() {
            var view = superview
            while let current = view, !(current is NSSplitView) {
                if current.isAccessibilityElement(), current.accessibilityRole() == .group {
                    if current.accessibilityLabel()?.isEmpty ?? true {
                        current.setAccessibilityLabel(String(localized: SidebarColumnName.name))
                    }
                    return
                }
                view = current.superview
            }
        }

        override func isAccessibilityElement() -> Bool { false }
    }
}
