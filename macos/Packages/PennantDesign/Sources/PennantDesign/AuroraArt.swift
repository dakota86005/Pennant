import AppKit
import SwiftUI

/// Made-up masthead art for the repository's example art pack (`docs/theme-packs/aurora-nights`, D-062): blurred
/// fields of the pack's own colours with two crisp threads over them, the way Now Playing derives a wash from artwork.
/// No club's mark is in it. In the app the art is always the pack's file, served and drawn as an image; this view
/// only makes that file (`render`) and stands in for it in previews. Pennant ships no trademarked art.
public struct AuroraArt: View {
    let dark: Bool

    public init(dark: Bool) {
        self.dark = dark
    }

    /// The five fields of colour: hue, centre (as a share of the width and the height) and radius (of the height).
    static let fields: [(hex: String, x: CGFloat, y: CGFloat, radius: CGFloat)] = [
        ("#4fd1c5", 0.62, 0.15, 0.55),
        ("#b48cff", 0.85, 0.55, 0.60),
        ("#ff8a5b", 0.72, 0.95, 0.42),
        ("#ffd166", 1.02, 0.35, 0.34),
        ("#2ea3c7", 0.50, 0.80, 0.40),
    ]

    public var body: some View {
        Canvas { ctx, size in
            ctx.addFilter(.blur(radius: size.height * 0.11))
            for field in Self.fields {
                let r = size.height * field.radius
                let rect = CGRect(x: size.width * field.x - r, y: size.height * field.y - r, width: r * 2, height: r * 2)
                ctx.fill(Path(ellipseIn: rect), with: .color((ServedColor.color(field.hex) ?? .clear).opacity(dark ? 0.55 : 0.50)))
            }
        }
        .overlay {
            Canvas { ctx, size in
                var p = Path()
                p.move(to: CGPoint(x: size.width * 0.45, y: size.height * 1.1))
                p.addCurve(to: CGPoint(x: size.width * 1.05, y: size.height * 0.1),
                           control1: CGPoint(x: size.width * 0.6, y: size.height * 0.2),
                           control2: CGPoint(x: size.width * 0.85, y: size.height * 0.9))
                ctx.stroke(p, with: .color(.white.opacity(0.18)), lineWidth: 1.2)
                var q = Path()
                q.move(to: CGPoint(x: size.width * 0.55, y: size.height * 1.1))
                q.addCurve(to: CGPoint(x: size.width * 1.1, y: size.height * 0.3),
                           control1: CGPoint(x: size.width * 0.7, y: size.height * 0.3),
                           control2: CGPoint(x: size.width * 0.9, y: size.height * 1.0))
                ctx.stroke(q, with: .color(.white.opacity(0.10)), lineWidth: 1)
            }
        }
        .accessibilityHidden(true)
    }

    /// The art as PNG data at the given size, drawn over a clear background (the masthead's gradient shows through).
    @MainActor
    public static func render(size: CGSize, dark: Bool, scale: CGFloat = 2) -> Data? {
        let renderer = ImageRenderer(content: AuroraArt(dark: dark).frame(width: size.width, height: size.height))
        renderer.scale = scale
        guard let image = renderer.nsImage, let tiff = image.tiffRepresentation,
              let rep = NSBitmapImageRep(data: tiff)
        else { return nil }
        return rep.representation(using: .png, properties: [:])
    }
}
