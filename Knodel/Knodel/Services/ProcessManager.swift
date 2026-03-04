import Foundation

actor ProcessManager {
    private let dockerPathCandidates = [
        "/usr/local/bin/docker",
        "/opt/homebrew/bin/docker",
        "/Applications/Docker.app/Contents/Resources/bin/docker"
    ]

    // MARK: - Docker Desktop macOS Override

    private static let overrideContent = """
    services:
      amqp:
        configs: []
      chain:
        configs: []
      mempool:
        configs: []
      block_store:
        configs: []
      p2p:
        configs: []
      block_producer:
        configs: []
      jsonrpc:
        configs: []
      grpc:
        configs: []
      transaction_store:
        configs: []
      contract_meta_store:
        configs: []
      account_history:
        configs: []
    """

    private var overridePath: String {
        (NSTemporaryDirectory() as NSString).appendingPathComponent("knodel-koinos-docker-desktop.override.yml")
    }

    private var dockerPath: String {
        let fm = FileManager.default
        return dockerPathCandidates.first(where: { fm.fileExists(atPath: $0) }) ?? "/usr/local/bin/docker"
    }

    private func expandPath(_ path: String) -> String {
        let trimmed = path.trimmingCharacters(in: .whitespaces)
        if trimmed == "~" { return NSHomeDirectory() }
        if trimmed.hasPrefix("~/") {
            return (NSHomeDirectory() as NSString).appendingPathComponent(String(trimmed.dropFirst(2)))
        }
        return trimmed
    }

    // MARK: - Repo Discovery / Provisioning

    func resolveNodeSettings(
        _ settings: NodeSettings,
        autoCloneIfMissing: Bool
    ) async -> (settings: NodeSettings, output: String, ok: Bool, didProvisionRepo: Bool) {
        var resolved = settings
        var notes: [String] = []

        // Prefer the standard Koinos compose/env names when present in the selected repo.
        if !resolved.composeFile.isEmpty, !resolved.envFile.isEmpty {
            normalizeStandardFiles(&resolved)
        }

        if isProperKoinosRepo(at: resolved.expandedRepoPath) {
            return (resolved, "", true, false)
        }

        if let discovered = discoverKoinosRepoPath(preferredCurrent: resolved.expandedRepoPath) {
            resolved.repoPath = discovered
            resolved.composeFile = "docker-compose.yml"
            resolved.envFile = ".env"
            normalizeStandardFiles(&resolved)
            notes.append("Auto-selected Koinos repo: \(discovered)")
            return (resolved, notes.joined(separator: "\n"), true, false)
        }

        guard autoCloneIfMissing else {
            return (resolved, "", true, false)
        }

        let managedPath = expandPath(NodeSettings.managedRepoPath)
        resolved.repoPath = managedPath
        resolved.composeFile = "docker-compose.yml"
        resolved.envFile = ".env"
        notes.append("No valid Koinos repo found. Cloning Koinos into managed directory: \(managedPath)")

        let cloneResult = await cloneOrRefreshRepoAtCurrentPath(resolved)
        if !cloneResult.output.isEmpty {
            notes.append(cloneResult.output)
        }
        guard cloneResult.ok else {
            return (resolved, notes.joined(separator: "\n"), false, false)
        }

        guard isProperKoinosRepo(at: resolved.expandedRepoPath) else {
            notes.append("Managed repo exists, but required Koinos compose/config files were not found.")
            return (resolved, notes.joined(separator: "\n"), false, false)
        }

        return (resolved, notes.joined(separator: "\n"), true, true)
    }

    private func normalizeStandardFiles(_ settings: inout NodeSettings) {
        let fm = FileManager.default
        let repoPath = settings.expandedRepoPath
        guard !repoPath.isEmpty else { return }

        let composeYml = (repoPath as NSString).appendingPathComponent("docker-compose.yml")
        let composeYaml = (repoPath as NSString).appendingPathComponent("docker-compose.yaml")
        if fm.fileExists(atPath: composeYml) {
            settings.composeFile = "docker-compose.yml"
        } else if fm.fileExists(atPath: composeYaml) {
            settings.composeFile = "docker-compose.yaml"
        }

        let dotEnv = (repoPath as NSString).appendingPathComponent(".env")
        let envExample = (repoPath as NSString).appendingPathComponent("env.example")
        if fm.fileExists(atPath: dotEnv) || fm.fileExists(atPath: envExample) {
            settings.envFile = ".env"
        }
    }

    private func isProperKoinosRepo(at path: String) -> Bool {
        let fm = FileManager.default
        guard fm.fileExists(atPath: path) else { return false }

        let composeYml = (path as NSString).appendingPathComponent("docker-compose.yml")
        let composeYaml = (path as NSString).appendingPathComponent("docker-compose.yaml")
        let hasCompose = fm.fileExists(atPath: composeYml) || fm.fileExists(atPath: composeYaml)
        guard hasCompose else { return false }

        let dotEnv = (path as NSString).appendingPathComponent(".env")
        let envExample = (path as NSString).appendingPathComponent("env.example")
        let configDir = (path as NSString).appendingPathComponent("config")
        let configExample = (path as NSString).appendingPathComponent("config-example")

        return fm.fileExists(atPath: dotEnv)
            || fm.fileExists(atPath: envExample)
            || fm.fileExists(atPath: configDir)
            || fm.fileExists(atPath: configExample)
    }

    private func discoverKoinosRepoPath(preferredCurrent: String) -> String? {
        let fm = FileManager.default
        let home = NSHomeDirectory()
        let codeDir = (home as NSString).appendingPathComponent("code")
        let managedPath = expandPath(NodeSettings.managedRepoPath)

        var rawCandidates: [String] = [
            preferredCurrent,
            managedPath,
            (codeDir as NSString).appendingPathComponent("koinos_code/koinos"),
            (home as NSString).appendingPathComponent("koinos"),
            (codeDir as NSString).appendingPathComponent("koinos")
        ]

        if let entries = try? fm.contentsOfDirectory(atPath: codeDir) {
            for entry in entries.sorted() {
                let nested = (codeDir as NSString).appendingPathComponent("\(entry)/koinos")
                rawCandidates.append(nested)
            }
        }

        var seen = Set<String>()
        for candidate in rawCandidates {
            let normalized = (candidate as NSString).standardizingPath
            if normalized.isEmpty || seen.contains(normalized) { continue }
            seen.insert(normalized)
            if isProperKoinosRepo(at: normalized) {
                return normalized
            }
        }
        return nil
    }

    // MARK: - Docker Desktop (macOS)

    private func ensureDockerDesktopRunning() async -> (ok: Bool, output: String) {
        let fm = FileManager.default
        let docker = dockerPath
        guard fm.fileExists(atPath: docker) else {
            return (false, "Docker CLI not found. Checked: \(dockerPathCandidates.joined(separator: ", "))")
        }

        if await isDockerDaemonReady(docker) {
            return (true, "")
        }

        var notes = ["Docker daemon is not running. Launching Docker Desktop..."]
        let openResult = await ShellRunner.run("/usr/bin/open", arguments: ["-a", "Docker"])
        if !openResult.ok {
            let output = [notes.joined(separator: "\n"), openResult.output]
                .filter { !$0.isEmpty }
                .joined(separator: "\n")
            return (false, output)
        }

        var lastError = ""
        for _ in 0..<30 {
            do {
                try await Task.sleep(for: .seconds(2))
            } catch {
                break
            }

            let check = await dockerInfo(docker)
            if check.ok {
                notes.append("Docker Desktop is ready.")
                return (true, notes.joined(separator: "\n"))
            }
            lastError = check.output
        }

        notes.append("Timed out waiting for Docker Desktop to become ready.")
        if !lastError.isEmpty {
            notes.append(lastError)
        }
        return (false, notes.joined(separator: "\n"))
    }

    private func isDockerDaemonReady(_ dockerPath: String) async -> Bool {
        let result = await dockerInfo(dockerPath)
        return result.ok
    }

    private func dockerInfo(_ dockerPath: String) async -> ShellResult {
        await ShellRunner.run(
            dockerPath,
            arguments: ["info", "--format", "{{.ServerVersion}}"]
        )
    }

    // MARK: - Compose Args

    private func composeBaseArgs(_ settings: NodeSettings) -> [String] {
        var args = ["compose", "--file", settings.composeFilePath]

        // macOS Docker Desktop workaround: remove configs mounts
        let overridePath = self.overridePath
        try? ProcessManager.overrideContent.write(toFile: overridePath, atomically: true, encoding: .utf8)
        args += ["--file", overridePath]

        args += ["--env-file", settings.envFilePath]
        return args
    }

    private func composeEnv(_ settings: NodeSettings) -> [String: String] {
        var env: [String: String] = [
            "BASEDIR": settings.expandedBaseDir,
            "COMPOSE_PROFILES": settings.profiles.joined(separator: ",")
        ]
        // Koinos images are often amd64 only; force platform on Apple Silicon
        if ProcessInfo.processInfo.environment["DOCKER_DEFAULT_PLATFORM"] == nil {
            env["DOCKER_DEFAULT_PLATFORM"] = "linux/amd64"
        }
        return env
    }

    private func logsEnv(_ settings: NodeSettings) -> [String: String] {
        var env = composeEnv(settings)
        env["COMPOSE_ANSI"] = "always"
        return env
    }

    // MARK: - Config File Management

    func ensureConfigFiles(_ settings: NodeSettings) throws -> String {
        let configDir = settings.configDirPath
        let exampleDir = settings.configExampleDirPath
        let fm = FileManager.default

        if !fm.fileExists(atPath: configDir) {
            guard fm.fileExists(atPath: exampleDir) else {
                throw ProcessManagerError.missingConfig("Missing config dir and config-example dir in \(settings.expandedRepoPath)")
            }
            try fm.copyItem(atPath: exampleDir, toPath: configDir)
            return "Created config/ from config-example"
        }

        let required = ["config.yml", "genesis_data.json", "koinos_descriptors.pb", "rabbitmq.conf"]
        var copied: [String] = []
        for file in required {
            let target = (configDir as NSString).appendingPathComponent(file)
            if fm.fileExists(atPath: target) { continue }
            let source = (exampleDir as NSString).appendingPathComponent(file)
            if !fm.fileExists(atPath: source) { continue }
            try fm.copyItem(atPath: source, toPath: target)
            copied.append(file)
        }

        return copied.isEmpty ? "config/ ready" : "Completed config/ with: \(copied.joined(separator: ", "))"
    }

    func ensureRenamedFiles(_ settings: NodeSettings) -> String {
        let fm = FileManager.default
        let repoPath = settings.expandedRepoPath
        guard fm.fileExists(atPath: repoPath) else { return "" }

        var notes: [String] = []

        let configDir = settings.configDirPath
        let configExample = settings.configExampleDirPath
        if !fm.fileExists(atPath: configDir) && fm.fileExists(atPath: configExample) {
            try? fm.moveItem(atPath: configExample, toPath: configDir)
            notes.append("Renamed config-example/ -> config/")
        }

        let envExample = (repoPath as NSString).appendingPathComponent("env.example")
        let dotEnv = (repoPath as NSString).appendingPathComponent(".env")
        if !fm.fileExists(atPath: dotEnv) && fm.fileExists(atPath: envExample) {
            try? fm.moveItem(atPath: envExample, toPath: dotEnv)
            notes.append("Renamed env.example -> .env")
        }

        return notes.joined(separator: "\n")
    }

    func ensureBaseDirRuntimeFiles(_ settings: NodeSettings) throws -> String {
        let fm = FileManager.default
        let cfgDir = settings.configDirPath
        let baseDir = settings.expandedBaseDir

        let mappings: [(String, String)] = [
            ("config.yml", (baseDir as NSString).appendingPathComponent("config.yml")),
            ("genesis_data.json", ((baseDir as NSString).appendingPathComponent("chain") as NSString).appendingPathComponent("genesis_data.json")),
            ("koinos_descriptors.pb", ((baseDir as NSString).appendingPathComponent("jsonrpc/descriptors") as NSString).appendingPathComponent("koinos_descriptors.pb"))
        ]

        var copied: [String] = []
        for (sourceName, targetPath) in mappings {
            let sourcePath = (cfgDir as NSString).appendingPathComponent(sourceName)
            guard fm.fileExists(atPath: sourcePath) else {
                throw ProcessManagerError.missingConfig("Missing config source: \(sourcePath)")
            }
            let targetDir = (targetPath as NSString).deletingLastPathComponent
            try fm.createDirectory(atPath: targetDir, withIntermediateDirectories: true)
            if fm.fileExists(atPath: targetPath) {
                try fm.removeItem(atPath: targetPath)
            }
            try fm.copyItem(atPath: sourcePath, toPath: targetPath)
            copied.append(sourceName)
        }

        return "Prepared BASEDIR runtime files: \(copied.joined(separator: ", "))"
    }

    // MARK: - Validation

    func assertRepoReady(_ settings: NodeSettings) throws {
        let fm = FileManager.default
        guard fm.fileExists(atPath: settings.expandedRepoPath) else {
            throw ProcessManagerError.repoNotFound(settings.expandedRepoPath)
        }
        guard fm.fileExists(atPath: settings.composeFilePath) else {
            throw ProcessManagerError.fileNotFound("Compose file: \(settings.composeFilePath)")
        }
        guard fm.fileExists(atPath: settings.envFilePath) else {
            throw ProcessManagerError.fileNotFound("Env file: \(settings.envFilePath)")
        }
    }

    // MARK: - Docker Compose Commands

    func status(_ settings: NodeSettings) async -> (services: [ServiceState], output: String, ok: Bool) {
        let renameNotes = ensureRenamedFiles(settings)

        do {
            try assertRepoReady(settings)
        } catch {
            return ([], [renameNotes, error.localizedDescription].filter { !$0.isEmpty }.joined(separator: "\n"), false)
        }

        let dockerReady = await ensureDockerDesktopRunning()
        guard dockerReady.ok else {
            let output = [renameNotes, dockerReady.output].filter { !$0.isEmpty }.joined(separator: "\n")
            return ([], output, false)
        }

        let args = composeBaseArgs(settings) + ["ps", "--all", "--format", "json"]
        let result = await ShellRunner.run(
            dockerPath,
            arguments: args,
            currentDirectory: settings.expandedRepoPath,
            environment: composeEnv(settings)
        )

        let services = result.ok ? parseComposePsJson(result.output) : []
        let output = [renameNotes, dockerReady.output, result.output].filter { !$0.isEmpty }.joined(separator: "\n")
        return (services, output, result.ok)
    }

    func start(_ settings: NodeSettings) async -> (ok: Bool, output: String) {
        let renameNotes = ensureRenamedFiles(settings)
        var notes: [String] = []
        if !renameNotes.isEmpty { notes.append(renameNotes) }

        do {
            try assertRepoReady(settings)
            let configNote = try ensureConfigFiles(settings)
            notes.append(configNote)

            let fm = FileManager.default
            try fm.createDirectory(atPath: settings.expandedBaseDir, withIntermediateDirectories: true)

            notes.append("macOS: using Docker Desktop compose override")
            let runtimeNote = try ensureBaseDirRuntimeFiles(settings)
            notes.append(runtimeNote)
        } catch {
            return (false, [notes.joined(separator: "\n"), error.localizedDescription].filter { !$0.isEmpty }.joined(separator: "\n"))
        }

        let dockerReady = await ensureDockerDesktopRunning()
        if !dockerReady.ok {
            return (false, [notes.joined(separator: "\n"), dockerReady.output].filter { !$0.isEmpty }.joined(separator: "\n"))
        }
        if !dockerReady.output.isEmpty {
            notes.append(dockerReady.output)
        }

        let args = composeBaseArgs(settings) + ["up", "-d"]
        let result = await ShellRunner.run(
            dockerPath,
            arguments: args,
            currentDirectory: settings.expandedRepoPath,
            environment: composeEnv(settings)
        )

        let output = [notes.joined(separator: "\n"), result.output].filter { !$0.isEmpty }.joined(separator: "\n")
        return (result.ok, output)
    }

    func stop(_ settings: NodeSettings) async -> (ok: Bool, output: String) {
        let renameNotes = ensureRenamedFiles(settings)
        var notes: [String] = []
        if !renameNotes.isEmpty { notes.append(renameNotes) }

        do {
            try assertRepoReady(settings)
        } catch {
            return (false, error.localizedDescription)
        }

        let dockerReady = await ensureDockerDesktopRunning()
        if !dockerReady.ok {
            return (false, [notes.joined(separator: "\n"), dockerReady.output].filter { !$0.isEmpty }.joined(separator: "\n"))
        }
        if !dockerReady.output.isEmpty {
            notes.append(dockerReady.output)
        }

        let args = composeBaseArgs(settings) + ["down"]
        let result = await ShellRunner.run(
            dockerPath,
            arguments: args,
            currentDirectory: settings.expandedRepoPath,
            environment: composeEnv(settings)
        )

        let output = [notes.joined(separator: "\n"), result.output].filter { !$0.isEmpty }.joined(separator: "\n")
        return (result.ok, output)
    }

    func logs(
        _ settings: NodeSettings,
        service: String? = nil,
        tail: Int = 200
    ) -> (process: Process, lines: AsyncStream<String>) {
        var args = composeBaseArgs(settings) + ["logs", "--tail", String(tail), "--follow"]
        if let service, !service.isEmpty {
            args.append(service)
        }

        return ShellRunner.stream(
            dockerPath,
            arguments: args,
            currentDirectory: settings.expandedRepoPath,
            environment: logsEnv(settings)
        )
    }

    // MARK: - Git Operations

    func cloneOrRefreshRepo(_ settings: NodeSettings) async -> (ok: Bool, output: String) {
        let prep = await resolveNodeSettings(settings, autoCloneIfMissing: false)
        var target = prep.settings
        var notes: [String] = []
        if !prep.output.isEmpty { notes.append(prep.output) }
        guard prep.ok else {
            return (false, notes.joined(separator: "\n"))
        }

        if !isProperKoinosRepo(at: target.expandedRepoPath) {
            target.repoPath = expandPath(NodeSettings.managedRepoPath)
            target.composeFile = "docker-compose.yml"
            target.envFile = ".env"
            notes.append("No valid Koinos repo found. Using managed directory: \(target.expandedRepoPath)")
        }

        let result = await cloneOrRefreshRepoAtCurrentPath(target)
        if !result.output.isEmpty { notes.append(result.output) }

        let output = notes.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        return (result.ok, output.isEmpty ? (result.ok ? "Repo synced" : "Repo sync failed") : output)
    }

    private func cloneOrRefreshRepoAtCurrentPath(_ settings: NodeSettings) async -> (ok: Bool, output: String) {
        let fm = FileManager.default
        let repoPath = settings.expandedRepoPath

        if fm.fileExists(atPath: (repoPath as NSString).appendingPathComponent(".git")) {
            // Refresh existing repo
            var steps: [String] = []

            // Restore tracked templates before pull
            let restoreResult = await restoreTemplatesForRefresh(settings)
            if !restoreResult.isEmpty { steps.append(restoreResult) }

            let fetchResult = await ShellRunner.run(
                "/usr/bin/git",
                arguments: ["-C", repoPath, "fetch", "--all", "--prune"],
                currentDirectory: repoPath
            )
            if !fetchResult.output.isEmpty { steps.append(fetchResult.output) }
            guard fetchResult.ok else {
                return (false, steps.joined(separator: "\n"))
            }

            let pullResult = await ShellRunner.run(
                "/usr/bin/git",
                arguments: ["-C", repoPath, "pull", "--ff-only"],
                currentDirectory: repoPath
            )
            if !pullResult.output.isEmpty { steps.append(pullResult.output) }

            let renameNotes = ensureRenamedFiles(settings)
            if !renameNotes.isEmpty { steps.append(renameNotes) }

            let output = steps.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
            return (pullResult.ok, output.isEmpty ? (pullResult.ok ? "Refreshed repo" : "Pull failed") : output)

        } else if fm.fileExists(atPath: repoPath) {
            // Directory exists but not a git repo
            let entries = (try? fm.contentsOfDirectory(atPath: repoPath)) ?? []
            if !entries.isEmpty {
                return (false, "Target directory exists and is not empty: \(repoPath)")
            }
            // Empty directory, safe to clone into
        } else {
            // Create parent directory
            let parent = (repoPath as NSString).deletingLastPathComponent
            try? fm.createDirectory(atPath: parent, withIntermediateDirectories: true)
        }

        // Clone
        let cloneURL = "https://github.com/koinos/koinos"
        let result = await ShellRunner.run(
            "/usr/bin/git",
            arguments: ["clone", cloneURL, repoPath],
            currentDirectory: (repoPath as NSString).deletingLastPathComponent
        )

        let renameNotes = result.ok ? ensureRenamedFiles(settings) : ""
        let output = [result.output, renameNotes].filter { !$0.isEmpty }.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        return (result.ok, output.isEmpty ? (result.ok ? "Cloned repo" : "git clone failed") : output)
    }

    private func restoreTemplatesForRefresh(_ settings: NodeSettings) async -> String {
        let fm = FileManager.default
        let repoPath = settings.expandedRepoPath
        guard fm.fileExists(atPath: (repoPath as NSString).appendingPathComponent(".git")) else { return "" }

        var pathsToRestore: [String] = []

        if fm.fileExists(atPath: settings.configDirPath) && !fm.fileExists(atPath: settings.configExampleDirPath) {
            pathsToRestore.append("config-example")
        }

        let dotEnv = (repoPath as NSString).appendingPathComponent(".env")
        let envExample = (repoPath as NSString).appendingPathComponent("env.example")
        if fm.fileExists(atPath: dotEnv) && !fm.fileExists(atPath: envExample) {
            pathsToRestore.append("env.example")
        }

        guard !pathsToRestore.isEmpty else { return "" }

        let result = await ShellRunner.run(
            "/usr/bin/git",
            arguments: ["-C", repoPath, "checkout", "--"] + pathsToRestore,
            currentDirectory: repoPath
        )

        return "Restored tracked templates: \(pathsToRestore.joined(separator: ", "))\n\(result.output)".trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // MARK: - JSON Parsing

    private func parseComposePsJson(_ raw: String) -> [ServiceState] {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return [] }

        // Try parsing as JSON array first
        if let data = text.data(using: .utf8),
           let array = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
            return array.map(normalizeServiceItem)
        }

        // Try parsing as single JSON object
        if let data = text.data(using: .utf8),
           let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            return [normalizeServiceItem(obj)]
        }

        // Try line-by-line JSON (docker compose outputs one JSON per line)
        var items: [ServiceState] = []
        for line in text.components(separatedBy: .newlines) {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            guard !trimmed.isEmpty,
                  let data = trimmed.data(using: .utf8),
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
            items.append(normalizeServiceItem(obj))
        }
        return items
    }

    private func normalizeServiceItem(_ item: [String: Any]) -> ServiceState {
        let name = (item["Name"] ?? item["name"] ?? item["Service"] ?? item["service"]) as? String ?? "unknown"
        let service = (item["Service"] ?? item["service"] ?? item["Name"] ?? item["name"]) as? String ?? "unknown"
        let state = (item["State"] ?? item["state"] ?? item["Status"] ?? item["status"]) as? String ?? "unknown"
        let status = (item["Status"] ?? item["status"] ?? item["State"] ?? item["state"]) as? String ?? "unknown"
        return ServiceState(name: name, service: service, state: state, status: status)
    }
}

enum ProcessManagerError: LocalizedError {
    case repoNotFound(String)
    case fileNotFound(String)
    case missingConfig(String)

    var errorDescription: String? {
        switch self {
        case .repoNotFound(let path): return "Koinos repo path not found: \(path)"
        case .fileNotFound(let msg): return msg
        case .missingConfig(let msg): return msg
        }
    }
}
