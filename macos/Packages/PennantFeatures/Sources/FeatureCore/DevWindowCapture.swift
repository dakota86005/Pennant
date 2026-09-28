import AppKit
import Foundation

#if DEBUG
/// Development builds only: with `PENNANT_DEV_CAPTURE_DIR` set, the Morning Report's window draws itself to a PNG in
/// that folder at the moments a screen capture cannot time (the kept report said to be updating, then the fresh one),
/// the window only and by the app itself, so no screen-recording permission is involved. Each moment once a launch,
/// named for the appearance ("morning-report-updating-dark.png"). Nothing happens without the variable.
@MainActor
public enum DevWindowCapture {
    private static var taken: Set<String> = []

    /// - Parameter title: the window to draw, by its title (the Setup window's); nil draws the main window.
    public static func capture(_ moment: String, title: String? = nil) {
        guard let folder = ProcessInfo.processInfo.environment["PENNANT_DEV_CAPTURE_DIR"], !folder.isEmpty,
              !taken.contains(moment),
              let window = NSApp.windows.first(where: { w in w.isVisible && w.contentView != nil && (title.map { w.title == $0 } ?? (w.frame.height > 400)) }),
              let view = window.contentView?.superview ?? window.contentView,
              let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds)
        else { return }
        taken.insert(moment)
        view.cacheDisplay(in: view.bounds, to: rep)
        let dark = window.effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
        guard let png = rep.representation(using: .png, properties: [:]) else { return }
        let url = URL(fileURLWithPath: folder, isDirectory: true).appending(path: "\(moment)-\(dark ? "dark" : "light").png")
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? png.write(to: url)
    }
}
#endif
