import Foundation
import SwiftUI

@MainActor
final class BootstrapViewModel: ObservableObject {
    @Published var backupUrl: String = NodeSettings.default.backupUrl
    @Published var bootstrapService = BootstrapService()

    var state: BootstrapState {
        bootstrapService.state
    }

    func startDownload(targetDir: String) {
        bootstrapService.download(from: backupUrl, targetDir: targetDir)
    }

    func cancel() {
        bootstrapService.cancel()
    }
}
