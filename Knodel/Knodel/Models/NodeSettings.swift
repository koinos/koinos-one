import Foundation

struct NodeSettings: Codable, Equatable {
    var repoPath: String
    var composeFile: String
    var envFile: String
    var baseDir: String
    var profiles: [String]
    var backupUrl: String

    static let `default` = NodeSettings(
        repoPath: "~/code/knodel-managed/koinos",
        composeFile: "docker-compose.yml",
        envFile: ".env",
        baseDir: "~/.koinos",
        profiles: ["block_producer", "jsonrpc"],
        backupUrl: "http://seed.koinosfoundation.org/backups/koinos_blockchain_backup.tar.gz"
    )

    static let managedRepoPath = "~/code/knodel-managed/koinos"

    var expandedRepoPath: String {
        expandUserPath(repoPath)
    }

    var expandedBaseDir: String {
        expandUserPath(baseDir)
    }

    var composeFilePath: String {
        if composeFile.hasPrefix("/") { return composeFile }
        return (expandedRepoPath as NSString).appendingPathComponent(composeFile)
    }

    var envFilePath: String {
        if envFile.hasPrefix("/") { return envFile }
        return (expandedRepoPath as NSString).appendingPathComponent(envFile)
    }

    var configDirPath: String {
        (expandedRepoPath as NSString).appendingPathComponent("config")
    }

    var configExampleDirPath: String {
        (expandedRepoPath as NSString).appendingPathComponent("config-example")
    }

    var profilesCSV: String {
        get { profiles.joined(separator: ",") }
        set { profiles = newValue.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty } }
    }
}

private func expandUserPath(_ path: String) -> String {
    let trimmed = path.trimmingCharacters(in: .whitespaces)
    if trimmed == "~" { return NSHomeDirectory() }
    if trimmed.hasPrefix("~/") {
        return (NSHomeDirectory() as NSString).appendingPathComponent(String(trimmed.dropFirst(2)))
    }
    return trimmed
}
