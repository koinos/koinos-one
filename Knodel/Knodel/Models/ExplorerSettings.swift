import Foundation

struct ExplorerSettings: Codable, Equatable {
    var rpcUrl: String
    var pollMs: Int
    var rowLimit: Int

    static let `default` = ExplorerSettings(
        rpcUrl: "https://api.koinos.io",
        pollMs: 3000,
        rowLimit: 20
    )
}
