// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "Knodel",
    platforms: [.macOS(.v14)],
    dependencies: [
        .package(url: "https://github.com/groue/GRDB.swift", from: "6.29.0"),
        .package(url: "https://github.com/jpsim/Yams", from: "5.1.0"),
    ],
    targets: [
        .executableTarget(
            name: "Knodel",
            dependencies: [
                .product(name: "GRDB", package: "GRDB.swift"),
                .product(name: "Yams", package: "Yams"),
            ],
            path: "Knodel",
            resources: [
                .process("Assets.xcassets"),
            ]
        ),
    ]
)
