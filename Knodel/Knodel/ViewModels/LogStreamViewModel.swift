import Foundation
import SwiftUI

@MainActor
final class LogStreamViewModel: ObservableObject {
    @Published var logText = AttributedString()
    @Published var isConnected = false
    @Published var errorMessage: String?

    private var process: Process?
    private var streamTask: Task<Void, Never>?
    private var rawBuffer = ""

    func start(provider: () -> (process: Process, lines: AsyncStream<String>)) {
        stop()

        let (proc, lines) = provider()
        self.process = proc
        self.isConnected = true
        self.errorMessage = nil
        self.logText = AttributedString()
        self.rawBuffer = ""

        streamTask = Task { [weak self] in
            for await chunk in lines {
                guard let self, !Task.isCancelled else { break }
                self.rawBuffer += chunk
                self.logText = AnsiParser.parse(self.rawBuffer)
            }

            guard let self else { return }
            self.isConnected = false
        }
    }

    func stop() {
        streamTask?.cancel()
        streamTask = nil

        if let process, process.isRunning {
            process.terminate()
        }
        process = nil
        isConnected = false
    }

    deinit {
        process?.terminate()
        streamTask?.cancel()
    }
}
