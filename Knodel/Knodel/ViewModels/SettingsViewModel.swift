import Foundation
import SwiftUI

@MainActor
final class SettingsViewModel: ObservableObject {
    private static let explorerKey = "knodel.explorer.settings.v1"
    private static let nodeKey = "knodel.node.settings.v1"

    @Published var explorerSettings: ExplorerSettings {
        didSet { save() }
    }
    @Published var nodeSettings: NodeSettings {
        didSet { save() }
    }

    init() {
        self.explorerSettings = Self.loadExplorer()
        self.nodeSettings = Self.loadNode()
    }

    func resetToDefaults() {
        explorerSettings = .default
        nodeSettings = .default
    }

    private func save() {
        if let data = try? JSONEncoder().encode(explorerSettings) {
            UserDefaults.standard.set(data, forKey: Self.explorerKey)
        }
        if let data = try? JSONEncoder().encode(nodeSettings) {
            UserDefaults.standard.set(data, forKey: Self.nodeKey)
        }
    }

    private static func loadExplorer() -> ExplorerSettings {
        guard let data = UserDefaults.standard.data(forKey: explorerKey),
              let settings = try? JSONDecoder().decode(ExplorerSettings.self, from: data) else {
            return .default
        }
        return settings
    }

    private static func loadNode() -> NodeSettings {
        guard let data = UserDefaults.standard.data(forKey: nodeKey),
              let settings = try? JSONDecoder().decode(NodeSettings.self, from: data) else {
            return .default
        }
        return settings
    }
}
