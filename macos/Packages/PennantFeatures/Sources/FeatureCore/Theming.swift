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
    /// A view's name as the catalog serves it (`Morning Report`), or nil while the catalog is not there.
    public func servedViewName(department: DeptID, view: String) -> String? {
        catalog?.departments.first { ($0.id.value1?.rawValue ?? $0.id.value2) == department.rawValue }?
            .views.first { $0.id == view }?.name
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
/// served name leads the kicker, then the caller's served parts (the game date, how current, who prepared it); the
/// served headline; a served claim as the deck; the caller's box score and control; the theme's art. Nothing on it is
/// written here; with no club served the kicker is the caller's parts alone.
public struct ClubMagazineMasthead<Figures: View, Control: View>: View {
    @Environment(AppModel.self) private var model
    @Environment(\.theme) private var theme
    private let kicker: [String?]
    private let kickerHint: String?
    private let headline: Text
    private let deck: Components.Schemas.Claim?
    private let deckText: String?
    private let deckHint: String?
    private let figures: () -> Figures
    private let control: () -> Control
    @State private var art: Image?

    public init(
        kicker: [String?],
        kickerHint: String? = nil,
        headline: Text,
        deck: Components.Schemas.Claim? = nil,
        @ViewBuilder figures: @escaping () -> Figures,
        @ViewBuilder control: @escaping () -> Control = { EmptyView() }
    ) {
        self.kicker = kicker
        self.kickerHint = kickerHint
        self.headline = headline
        self.deck = deck
        deckText = deck?.text
        deckHint = deck?.hint
        self.figures = figures
        self.control = control
    }

    /// With a served lede that is not a claim of its own (its help tag says where it comes from).
    public init(
        kicker: [String?],
        kickerHint: String? = nil,
        headline: Text,
        deckText: String?,
        deckHint: String?,
        @ViewBuilder figures: @escaping () -> Figures,
        @ViewBuilder control: @escaping () -> Control = { EmptyView() }
    ) {
        self.kicker = kicker
        self.kickerHint = kickerHint
        self.headline = headline
        deck = nil
        self.deckText = deckText
        self.deckHint = deckHint
        self.figures = figures
        self.control = control
    }

    public var body: some View {
        MagazineMasthead(
            kicker: [model.catalogClub?.name] + kicker,
            kickerHint: kickerHint,
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
