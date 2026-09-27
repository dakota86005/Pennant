// swift-tools-version: 6.2
// PennantDesign: how the Mac app draws what the server says (SWIFTUI_REBUILD.md section 6): the club's theme (served
// theme packs), the masthead, the floating glass controls, and from N5's second stage the claims, charts and tone
// colours. It reads the generated types (PennantAPI) and decides nothing: every colour and word it draws is served.
import PackageDescription

let package = Package(
    name: "PennantDesign",
    platforms: [.macOS(.v26)],
    products: [
        .library(name: "PennantDesign", targets: ["PennantDesign"]),
    ],
    dependencies: [
        .package(path: "../PennantAPI"),
    ],
    targets: [
        .target(
            name: "PennantDesign",
            dependencies: [
                .product(name: "PennantAPI", package: "PennantAPI"),
            ],
            swiftSettings: [
                // Views: the app's own isolation (MainActor by default) and Approachable Concurrency
                .defaultIsolation(MainActor.self),
                .enableUpcomingFeature("NonisolatedNonsendingByDefault"),
                .enableUpcomingFeature("InferIsolatedConformances"),
            ]
        ),
        .testTarget(
            name: "PennantDesignTests",
            dependencies: [
                "PennantDesign",
                .product(name: "PennantAPI", package: "PennantAPI"),
            ]
        ),
    ],
    swiftLanguageModes: [.v6]
)
