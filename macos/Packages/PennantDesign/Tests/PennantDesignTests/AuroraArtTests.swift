import Foundation
import Testing
@testable import PennantDesign

/// The example art pack's picture (`docs/theme-packs/aurora-nights/art.png`) is made from `AuroraArt`, so the file in
/// the repository can be remade the same way: `PENNANT_RENDER_ART=<path> swift test --filter AuroraArtTests` writes it.
@MainActor
@Suite("Aurora art")
struct AuroraArtTests {
    @Test("renders as a PNG of the size asked, and writes the example pack's file when asked to")
    func renders() throws {
        let data = try #require(AuroraArt.render(size: CGSize(width: 320, height: 100), dark: false, scale: 1))
        #expect(data.count > 1000)
        #expect(data.prefix(8) == Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))
        if let path = ProcessInfo.processInfo.environment["PENNANT_RENDER_ART"] {
            let file = try #require(AuroraArt.render(size: CGSize(width: 1400, height: 460), dark: false, scale: 1))
            try file.write(to: URL(fileURLWithPath: path))
        }
    }
}
