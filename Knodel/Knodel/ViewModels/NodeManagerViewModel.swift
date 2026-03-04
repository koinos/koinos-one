import Foundation
import SwiftUI

@MainActor
final class NodeManagerViewModel: ObservableObject {
    @Published var services: [ServiceState] = []
    @Published var errorMessage: String?
    @Published var commandOutput: String = ""
    @Published var isLoading = false
    @Published var actionInProgress: NodeAction?
    @Published var isCloning = false
    @Published var showingLogs = false
    @Published var logsService: String = ""

    enum NodeAction: String {
        case start, stop
    }

    private let processManager = ProcessManager()
    private var settings = NodeSettings.default
    private weak var settingsVM: SettingsViewModel?
    private var pollTask: Task<Void, Never>?
    private var didAttemptAutoRepoProvision = false

    var runningCount: Int {
        services.filter(\.isRunning).count
    }

    var statusText: String {
        if isCloning { return "Syncing repo..." }
        if isLoading { return "Querying docker compose..." }
        if let action = actionInProgress {
            return action == .start ? "Starting node..." : "Stopping node..."
        }
        if !services.isEmpty {
            return runningCount > 0 ? "Running (\(runningCount)/\(services.count))" : "Stopped"
        }
        if errorMessage != nil { return "Error" }
        return "No status"
    }

    func configure(with settingsVM: SettingsViewModel) {
        let incoming = settingsVM.nodeSettings
        if incoming != self.settings {
            didAttemptAutoRepoProvision = false
        }
        self.settingsVM = settingsVM
        self.settings = incoming
        startPolling()
    }

    func startPolling() {
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            guard let self else { return }

            // Initial fetch
            await self.refreshStatus()

            // Poll every 6 seconds
            while !Task.isCancelled {
                do {
                    try await Task.sleep(for: .seconds(6))
                } catch { break }

                guard self.actionInProgress == nil else { continue }
                _ = await self.prepareNodeSettings(autoProvision: false)
                let (services, _, ok) = await self.processManager.status(self.settings)
                if ok {
                    self.services = services
                    self.errorMessage = nil
                }
            }
        }
    }

    func refreshStatus() async {
        isLoading = true
        errorMessage = nil

        let prep = await prepareNodeSettings(autoProvision: !didAttemptAutoRepoProvision)
        if !prep.ok {
            self.services = []
            self.commandOutput = prep.output
            self.errorMessage = prep.output
            isLoading = false
            return
        }

        let (services, output, ok) = await processManager.status(settings)
        let mergedOutput = [prep.output, output].filter { !$0.isEmpty }.joined(separator: "\n")
        self.services = services
        self.commandOutput = mergedOutput
        if !ok {
            self.errorMessage = mergedOutput.isEmpty ? output : mergedOutput
        }
        isLoading = false
    }

    func startNode() async {
        actionInProgress = .start
        errorMessage = nil

        let prep = await prepareNodeSettings(autoProvision: true)
        guard prep.ok else {
            commandOutput = prep.output
            errorMessage = prep.output
            actionInProgress = nil
            return
        }

        let (ok, output) = await processManager.start(settings)
        let mergedOutput = [prep.output, output].filter { !$0.isEmpty }.joined(separator: "\n")
        commandOutput = mergedOutput
        if !ok {
            errorMessage = mergedOutput
        }
        actionInProgress = nil
        await refreshStatus()
    }

    func stopNode() async {
        actionInProgress = .stop
        errorMessage = nil

        let prep = await prepareNodeSettings(autoProvision: false)
        if !prep.ok {
            commandOutput = prep.output
            errorMessage = prep.output
            actionInProgress = nil
            return
        }

        let (ok, output) = await processManager.stop(settings)
        let mergedOutput = [prep.output, output].filter { !$0.isEmpty }.joined(separator: "\n")
        commandOutput = mergedOutput
        if !ok {
            errorMessage = mergedOutput
        }
        actionInProgress = nil
        await refreshStatus()
    }

    func cloneRepo() async {
        isCloning = true
        errorMessage = nil

        let preSync = await prepareNodeSettings(autoProvision: false)
        if !preSync.ok {
            commandOutput = preSync.output
            errorMessage = preSync.output
            isCloning = false
            return
        }

        let (ok, output) = await processManager.cloneOrRefreshRepo(settings)
        let postSync = ok ? await prepareNodeSettings(autoProvision: false) : (ok: true, output: "")
        let mergedOutput = [preSync.output, output, postSync.output].filter { !$0.isEmpty }.joined(separator: "\n")
        commandOutput = mergedOutput
        if !ok {
            errorMessage = mergedOutput
        } else {
            await refreshStatus()
        }
        isCloning = false
    }

    func openLogs(for service: String) {
        logsService = service
        showingLogs = true
    }

    func logsStream() async -> (process: Process, lines: AsyncStream<String>) {
        _ = await prepareNodeSettings(autoProvision: false)
        return await processManager.logs(settings, service: logsService)
    }

    private func prepareNodeSettings(autoProvision: Bool) async -> (ok: Bool, output: String) {
        if autoProvision {
            didAttemptAutoRepoProvision = true
        }

        let result = await processManager.resolveNodeSettings(settings, autoCloneIfMissing: autoProvision)

        if result.settings != settings {
            settings = result.settings
            if let settingsVM, settingsVM.nodeSettings != result.settings {
                settingsVM.nodeSettings = result.settings
            }
        }

        return (result.ok, result.output)
    }

    deinit {
        pollTask?.cancel()
    }
}
