import Foundation

enum ConfigFileManager {
    enum FileKind: String {
        case compose, env, config
    }

    static func filePath(for kind: FileKind, settings: NodeSettings) -> String {
        switch kind {
        case .compose: return settings.composeFilePath
        case .env: return settings.envFilePath
        case .config: return (settings.configDirPath as NSString).appendingPathComponent("config.yml")
        }
    }

    static func read(kind: FileKind, settings: NodeSettings) throws -> String {
        let path = filePath(for: kind, settings: settings)
        return try String(contentsOfFile: path, encoding: .utf8)
    }

    static func write(kind: FileKind, settings: NodeSettings, content: String) throws {
        let path = filePath(for: kind, settings: settings)
        let dir = (path as NSString).deletingLastPathComponent
        try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        try content.write(toFile: path, atomically: true, encoding: .utf8)
    }
}
