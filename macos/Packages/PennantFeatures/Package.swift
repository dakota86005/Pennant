// swift-tools-version: 6.2
// PennantFeatures: the app's departments and its window shell (SWIFTUI_REBUILD.md section 6). Each department is a
// target exporting one `DepartmentModule` (its views as descriptors); the app target assembles them into the
// registry the sidebar, the Go menu and search come from. `FeatureCore` holds the registry's types and the
// navigation history; `Shell` the main window, the server states and Settings; `Setup` the first-run window.
// Nothing here decides a baseball question: every sentence and number shown is served, and the rest is structural
// labels in the app's String Catalog.
import PackageDescription

/// Views: the app's own isolation (MainActor by default) and Approachable Concurrency.
let concurrency: [SwiftSetting] = [
    .defaultIsolation(MainActor.self),
    .enableUpcomingFeature("NonisolatedNonsendingByDefault"),
    .enableUpcomingFeature("InferIsolatedConformances"),
]

/// One target per department (section 6), in the registry's order.
let departments = [
    "FrontOffice", "MajorLeague", "Farm", "Scouting", "Trades", "Finance", "Medical", "League", "Philosophy",
]

let package = Package(
    name: "PennantFeatures",
    platforms: [.macOS(.v26)],
    products: [
        .library(name: "PennantFeatures", targets: ["FeatureCore", "Shell", "Setup"] + departments),
    ],
    dependencies: [
        .package(path: "../PennantAPI"),
        .package(path: "../PennantKit"),
        .package(path: "../PennantDesign"),
        .package(url: "https://github.com/apple/swift-openapi-runtime", from: "1.12.1"),
    ],
    targets: [
        .target(
            name: "FeatureCore",
            dependencies: [
                .product(name: "PennantAPI", package: "PennantAPI"),
                .product(name: "PennantKit", package: "PennantKit"),
                .product(name: "PennantDesign", package: "PennantDesign"),
            ],
            swiftSettings: concurrency
        ),
        .target(
            name: "Shell",
            dependencies: [
                "FeatureCore",
                // The Setup window's model lives as long as the app (`AppRouting.setup`): the main window holds its
                // report while the club it asks is owed, even with the window closed
                "Setup",
                .product(name: "PennantAPI", package: "PennantAPI"),
                .product(name: "PennantKit", package: "PennantKit"),
                .product(name: "PennantDesign", package: "PennantDesign"),
            ],
            swiftSettings: concurrency
        ),
        .target(
            name: "Setup",
            dependencies: [
                "FeatureCore",
                .product(name: "PennantAPI", package: "PennantAPI"),
                .product(name: "PennantKit", package: "PennantKit"),
                .product(name: "PennantDesign", package: "PennantDesign"),
                .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
            ],
            swiftSettings: concurrency
        ),
        .testTarget(
            name: "PennantFeaturesTests",
            dependencies: ["FeatureCore", "Shell", "Setup"] + departments.map { .target(name: $0) } + [
                .product(name: "PennantAPI", package: "PennantAPI"),
                .product(name: "PennantKit", package: "PennantKit"),
                .product(name: "PennantDesign", package: "PennantDesign"),
                .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
            ],
            swiftSettings: concurrency
        ),
    ] + departments.map {
        .target(
            name: $0,
            dependencies: [
                "FeatureCore",
                .product(name: "PennantAPI", package: "PennantAPI"),
                .product(name: "PennantKit", package: "PennantKit"),
                .product(name: "PennantDesign", package: "PennantDesign"),
            ],
            swiftSettings: concurrency
        )
    },
    swiftLanguageModes: [.v6]
)
