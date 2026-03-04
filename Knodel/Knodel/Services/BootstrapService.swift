import Foundation

final class BootstrapService: NSObject, ObservableObject, URLSessionDownloadDelegate {
    @Published var state: BootstrapState = .idle

    private var downloadTask: URLSessionDownloadTask?
    private var session: URLSession?
    private var targetDir: String = ""

    func download(from urlString: String, targetDir: String) {
        guard let url = URL(string: urlString) else {
            state = .failed("Invalid URL: \(urlString)")
            return
        }

        self.targetDir = targetDir
        state = .downloading(progress: 0)

        let config = URLSessionConfiguration.default
        session = URLSession(configuration: config, delegate: self, delegateQueue: .main)
        downloadTask = session?.downloadTask(with: url)
        downloadTask?.resume()
    }

    func cancel() {
        downloadTask?.cancel()
        downloadTask = nil
        session?.invalidateAndCancel()
        session = nil
        state = .idle
    }

    // MARK: - URLSessionDownloadDelegate

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        state = .extracting

        Task.detached { [weak self, targetDir = self.targetDir] in
            do {
                let fm = FileManager.default
                try fm.createDirectory(atPath: targetDir, withIntermediateDirectories: true)

                // Move downloaded file to a temporary path with correct extension
                let tempPath = (NSTemporaryDirectory() as NSString).appendingPathComponent("koinos_backup.tar.gz")
                if fm.fileExists(atPath: tempPath) {
                    try fm.removeItem(atPath: tempPath)
                }
                try fm.moveItem(at: location, to: URL(fileURLWithPath: tempPath))

                // Extract using /usr/bin/tar
                let result = await ShellRunner.run(
                    "/usr/bin/tar",
                    arguments: ["-xzf", tempPath, "-C", targetDir],
                    currentDirectory: targetDir
                )

                // Clean up
                try? fm.removeItem(atPath: tempPath)

                await MainActor.run { [weak self] in
                    if result.ok {
                        self?.state = .completed
                    } else {
                        self?.state = .failed("Extraction failed: \(result.output)")
                    }
                }
            } catch {
                await MainActor.run { [weak self] in
                    self?.state = .failed("Error: \(error.localizedDescription)")
                }
            }
        }
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        if totalBytesExpectedToWrite > 0 {
            let progress = Double(totalBytesWritten) / Double(totalBytesExpectedToWrite)
            state = .downloading(progress: progress)
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: (any Error)?) {
        if let error, (error as NSError).code != NSURLErrorCancelled {
            state = .failed("Download failed: \(error.localizedDescription)")
        }
    }
}
