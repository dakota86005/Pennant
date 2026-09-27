import AppKit
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

    public static func image(_ path: String?, model: AppModel) async -> Image? {
        guard let path else { return nil }
        if let cached = cache[path] { return Image(nsImage: cached) }
        guard let data = await model.servedFile(path), let image = NSImage(data: data) else { return nil }
        cache[path] = image
        return Image(nsImage: image)
    }
}

/// A view's masthead for the current club (SWIFTUI_REBUILD.md section 3.4): the view's served title and line, with
/// the club's served name and record and the theme's logo and art. Nothing on it is written here; with no club served
/// it shows the title and line alone.
public struct ClubMasthead: View {
    @Environment(AppModel.self) private var model
    @Environment(\.theme) private var theme
    private let title: Text
    private let line: String?
    private let lineHint: String?
    @State private var logo: Image?
    @State private var art: Image?

    public init(title: Text, line: String? = nil, lineHint: String? = nil) {
        self.title = title
        self.line = line
        self.lineHint = lineHint
    }

    public var body: some View {
        let club = model.catalogClub
        Masthead(
            title: title,
            club: club?.name,
            record: club?.record.display,
            recordHint: club?.record.hint,
            line: line,
            lineHint: lineHint,
            logo: logo,
            art: art
        )
        .task(id: theme.logo) { logo = await ServedImages.image(theme.logo, model: model) }
        .task(id: theme.art) { art = await ServedImages.image(theme.art, model: model) }
    }
}
