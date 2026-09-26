// swift-tools-version: 6.2
// PennantAPI: the Mac app's client for the Pennant server, generated from the presentation contract
// (`contract/openapi.json`, D-056) by swift-openapi-generator at build time. No hand-written server models.
import PackageDescription

let package = Package(
    name: "PennantAPI",
    platforms: [.macOS(.v26)],
    products: [
        .library(name: "PennantAPI", targets: ["PennantAPI"]),
    ],
    dependencies: [
        .package(url: "https://github.com/apple/swift-openapi-generator", from: "1.13.1"),
        .package(url: "https://github.com/apple/swift-openapi-runtime", from: "1.12.1"),
        .package(url: "https://github.com/apple/swift-openapi-urlsession", from: "1.3.1"),
    ],
    targets: [
        .target(
            name: "PennantAPI",
            dependencies: [
                .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
                .product(name: "OpenAPIURLSession", package: "swift-openapi-urlsession"),
            ],
            plugins: [
                .plugin(name: "OpenAPIGenerator", package: "swift-openapi-generator"),
            ]
        ),
        .testTarget(
            name: "PennantAPITests",
            dependencies: ["PennantAPI"]
        ),
    ],
    swiftLanguageModes: [.v6]
)
