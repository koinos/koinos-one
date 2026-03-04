import Foundation

struct ShellResult {
    let ok: Bool
    let exitCode: Int32
    let output: String
}

enum ShellRunner {
    static func run(
        _ command: String,
        arguments: [String] = [],
        currentDirectory: String? = nil,
        environment: [String: String]? = nil
    ) async -> ShellResult {
        await withCheckedContinuation { continuation in
            let process = Process()
            process.executableURL = URL(fileURLWithPath: command)
            process.arguments = arguments

            if let cwd = currentDirectory {
                process.currentDirectoryURL = URL(fileURLWithPath: cwd)
            }

            if let env = environment {
                var merged = ProcessInfo.processInfo.environment
                for (key, value) in env {
                    merged[key] = value
                }
                process.environment = merged
            }

            let stdout = Pipe()
            let stderr = Pipe()
            process.standardOutput = stdout
            process.standardError = stderr
            process.standardInput = FileHandle.nullDevice

            do {
                try process.run()
            } catch {
                continuation.resume(returning: ShellResult(ok: false, exitCode: -1, output: error.localizedDescription))
                return
            }

            process.waitUntilExit()

            let stdoutData = stdout.fileHandleForReading.readDataToEndOfFile()
            let stderrData = stderr.fileHandleForReading.readDataToEndOfFile()
            let output = [
                String(data: stdoutData, encoding: .utf8) ?? "",
                String(data: stderrData, encoding: .utf8) ?? ""
            ].joined().trimmingCharacters(in: .whitespacesAndNewlines)

            continuation.resume(returning: ShellResult(
                ok: process.terminationStatus == 0,
                exitCode: process.terminationStatus,
                output: output
            ))
        }
    }

    static func stream(
        _ command: String,
        arguments: [String] = [],
        currentDirectory: String? = nil,
        environment: [String: String]? = nil
    ) -> (process: Process, lines: AsyncStream<String>) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: command)
        process.arguments = arguments

        if let cwd = currentDirectory {
            process.currentDirectoryURL = URL(fileURLWithPath: cwd)
        }

        if let env = environment {
            var merged = ProcessInfo.processInfo.environment
            for (key, value) in env {
                merged[key] = value
            }
            process.environment = merged
        }

        let stdout = Pipe()
        let stderr = Pipe()
        process.standardOutput = stdout
        process.standardError = stderr
        process.standardInput = FileHandle.nullDevice

        let stream = AsyncStream<String> { continuation in
            stdout.fileHandleForReading.readabilityHandler = { handle in
                let data = handle.availableData
                if data.isEmpty {
                    stdout.fileHandleForReading.readabilityHandler = nil
                    return
                }
                if let str = String(data: data, encoding: .utf8) {
                    continuation.yield(str)
                }
            }

            stderr.fileHandleForReading.readabilityHandler = { handle in
                let data = handle.availableData
                if data.isEmpty {
                    stderr.fileHandleForReading.readabilityHandler = nil
                    return
                }
                if let str = String(data: data, encoding: .utf8) {
                    continuation.yield(str)
                }
            }

            process.terminationHandler = { _ in
                stdout.fileHandleForReading.readabilityHandler = nil
                stderr.fileHandleForReading.readabilityHandler = nil
                continuation.finish()
            }

            do {
                try process.run()
            } catch {
                continuation.yield("Error: \(error.localizedDescription)")
                continuation.finish()
            }
        }

        return (process, stream)
    }
}
