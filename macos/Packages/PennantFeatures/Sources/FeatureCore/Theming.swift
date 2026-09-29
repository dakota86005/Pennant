import AppKit
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

extension AppModel {
    /// The theme the current club wears: the pack the catalog serves for it, neutral when team colours are off (the
    /// served `useTeamColors`) or no club is served. The main window puts it in the environment (`\.theme`).
    public var theme: Theme {
        Theme(served: catalogClub?.theme, useTeamColors: settings?.settings.useTeamColors ?? true)
    }
}

extension AppModel {
    /// A view's name as the catalog serves it (`Morning Report`); the Morning Report's as kept with the report shown
    /// until the catalog arrives; else nil.
    public func servedViewName(department: DeptID, view: String) -> String? {
        guard let catalog else {
            return department.rawValue == "frontOffice" && view == "morningReport" ? frontOffice.keptCatalog?.viewName : nil
        }
        return catalog.departments.first { ($0.id.value1?.rawValue ?? $0.id.value2) == department.rawValue }?
            .views.first { $0.id == view }?.name
    }
}

extension DepartmentRegistry {
    /// A department's name as the catalog serves it ("Major League Ops"), else the registry's structural title while
    /// the catalog is not there; nil for a department this build does not know. Every place that names a department
    /// (the window, the inspector, a detached basis) reads it here, so they never disagree.
    public func name(of id: String, catalog: Components.Schemas.Catalog?) -> String? {
        catalog?.departments.first { ($0.id.value1?.rawValue ?? $0.id.value2) == id }?.name
            ?? department(DeptID(rawValue: id)).map { String(localized: $0.title) }
    }
}

/// A picture the server serves by path (a club's logo, a theme pack's art), fetched with the launch's token and kept
/// for the rest of the launch, so the club card and every masthead share one fetch.
@MainActor
public enum ServedImages {
    private static var cache: [String: NSImage] = [:]

    /// Keeps a picture for a path without fetching it (a preview or a snapshot standing in for the server).
    public static func preload(_ path: String, image: NSImage) {
        cache[path] = image
    }

    public static func image(_ path: String?, model: AppModel) async -> Image? {
        guard let path else { return nil }
        if let cached = cache[path] { return Image(nsImage: cached) }
        guard let data = await model.servedFile(path), let image = NSImage(data: data) else { return nil }
        cache[path] = image
        return Image(nsImage: image)
    }
}

/// A view's masthead for the current club, set like a magazine (SWIFTUI_REBUILD.md sections 3.4 and 3.7): the club's
/// served name leads the kicker (the catalog's, or the one the caller's payload serves), then the caller's served parts
/// (the game date, how current, who prepared it) and a structural status ("Updating") while the caller has one; the
/// served headline; a served claim as the deck; the caller's box score and control; the theme's art. Nothing on it is
/// written here; with no club served the kicker is the caller's parts alone.
public struct ClubMagazineMasthead<Figures: View, Control: View>: View {
    @Environment(AppModel.self) private var model
    @Environment(\.theme) private var theme
    private let club: String??
    private let kicker: [String?]
    private let kickerHint: String?
    private let kickerStatus: String?
    private let headline: Text
    private let deck: Components.Schemas.Claim?
    private let deckText: String?
    private let deckHint: String?
    private let figures: () -> Figures
    private let control: () -> Control
    @State private var art: Image?

    /// - Parameters:
    ///   - club: the club's name as the caller's payload serves it (`.some(name)`, or `.some(nil)` for none); leave
    ///     it out for the catalog's.
    ///   - kickerStatus: a word after the kicker ("Updating", or the served "Updated to …"), or nil.
    ///   - deck: a served claim as the deck (its basis a click away); else `deckText` with its help tag, a served lede
    ///     that is not a claim of its own; nil draws none.
    public init(
        club: String?? = nil,
        kicker: [String?],
        kickerHint: String? = nil,
        kickerStatus: String? = nil,
        headline: Text,
        deck: Components.Schemas.Claim? = nil,
        deckText: String? = nil,
        deckHint: String? = nil,
        @ViewBuilder figures: @escaping () -> Figures,
        @ViewBuilder control: @escaping () -> Control = { EmptyView() }
    ) {
        self.club = club
        self.kicker = kicker
        self.kickerHint = kickerHint
        self.kickerStatus = kickerStatus
        self.headline = headline
        self.deck = deck
        self.deckText = deck?.text ?? deckText
        self.deckHint = deck?.hint ?? deckHint
        self.figures = figures
        self.control = control
    }

    public var body: some View {
        MagazineMasthead(
            kicker: [club ?? model.catalogClub?.name] + kicker,
            kickerHint: kickerHint,
            kickerStatus: kickerStatus,
            headline: headline,
            deck: deckText,
            deckHint: deckHint,
            deckClaim: deck,
            art: art,
            figures: figures,
            control: control
        )
        .task(id: theme.art) { art = await ServedImages.image(theme.art, model: model) }
    }
}
