import Foundation
import SwiftUI

@MainActor
final class BlockExplorerViewModel: ObservableObject {
    @Published var blocks: [BlockRow] = []
    @Published var head: HeadSnapshot?
    @Published var isInitialLoading = true
    @Published var errorMessage: String?
    @Published var lastSuccessAt: Date?
    @Published var dataSource: DataSource = .external

    enum DataSource: String, CaseIterable, Identifiable {
        case external = "External RPC"
        case local = "Local Node"

        var id: String { rawValue }
    }

    private let rpcClient = KoinosRPCClient()
    private var pollTask: Task<Void, Never>?
    private var rpcUrl = ExplorerSettings.default.rpcUrl
    private var pollMs = ExplorerSettings.default.pollMs
    private var rowLimit = ExplorerSettings.default.rowLimit

    var effectiveRpcUrl: String {
        switch dataSource {
        case .external: return rpcUrl
        case .local: return "http://127.0.0.1:8080"
        }
    }

    func configure(with settingsVM: SettingsViewModel) {
        let settings = settingsVM.explorerSettings
        self.rpcUrl = settings.rpcUrl
        self.pollMs = settings.pollMs
        self.rowLimit = settings.rowLimit
        startPolling()
    }

    func startPolling() {
        pollTask?.cancel()
        isInitialLoading = true
        errorMessage = nil

        pollTask = Task { [weak self] in
            guard let self else { return }
            var isFirst = true

            while !Task.isCancelled {
                await self.fetchBlocks(isInitial: isFirst)
                isFirst = false

                do {
                    try await Task.sleep(for: .milliseconds(self.pollMs))
                } catch {
                    break
                }
            }
        }
    }

    func refresh() {
        startPolling()
    }

    private func fetchBlocks(isInitial: Bool) async {
        do {
            let result = try await rpcClient.fetchLatestBlocks(rpcUrl: effectiveRpcUrl, rowLimit: rowLimit)
            self.blocks = result.blocks
            self.head = result.head
            self.lastSuccessAt = Date()
            self.errorMessage = nil
            self.isInitialLoading = false
        } catch is CancellationError {
            // ignore
        } catch {
            self.errorMessage = error.localizedDescription
            self.isInitialLoading = false
        }
    }

    deinit {
        pollTask?.cancel()
    }
}
