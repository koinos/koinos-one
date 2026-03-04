import Foundation
import GRDB

struct BlockRecord: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "blocks"

    let height: Int
    let id: String
    let previousId: String
    let signer: String
    let timestampMs: Int64
    let txCount: Int

    func toBlockRow() -> BlockRow {
        BlockRow(
            height: height,
            blockId: id,
            previousId: previousId,
            signer: signer,
            timestampMs: timestampMs
        )
    }
}

struct SyncStateRecord: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "sync_state"

    let key: String
    let value: String
}

final class BlockDatabase {
    private let dbQueue: DatabaseQueue

    init() throws {
        let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let dbDir = appSupport.appendingPathComponent("Knodel", isDirectory: true)
        try FileManager.default.createDirectory(at: dbDir, withIntermediateDirectories: true)
        let dbPath = dbDir.appendingPathComponent("blocks.sqlite").path

        dbQueue = try DatabaseQueue(path: dbPath)
        try migrate()
    }

    private func migrate() throws {
        var migrator = DatabaseMigrator()

        migrator.registerMigration("v1") { db in
            try db.create(table: "blocks", ifNotExists: true) { t in
                t.column("height", .integer).notNull().primaryKey()
                t.column("id", .text).notNull()
                t.column("previousId", .text).notNull().defaults(to: "")
                t.column("signer", .text).notNull().defaults(to: "")
                t.column("timestampMs", .integer).notNull().defaults(to: 0)
                t.column("txCount", .integer).notNull().defaults(to: 0)
            }

            try db.create(table: "sync_state", ifNotExists: true) { t in
                t.column("key", .text).notNull().primaryKey()
                t.column("value", .text).notNull()
            }
        }

        try migrator.migrate(dbQueue)
    }

    func insertBlocks(_ blocks: [BlockRecord]) throws {
        try dbQueue.write { db in
            for block in blocks {
                try block.insert(db, onConflict: .replace)
            }
        }
    }

    func latestBlocks(limit: Int = 20) throws -> [BlockRow] {
        try dbQueue.read { db in
            let records = try BlockRecord
                .order(Column("height").desc)
                .limit(limit)
                .fetchAll(db)
            return records.map { $0.toBlockRow() }
        }
    }

    func maxHeight() throws -> Int? {
        try dbQueue.read { db in
            try Int.fetchOne(db, sql: "SELECT MAX(height) FROM blocks")
        }
    }

    func setSyncState(key: String, value: String) throws {
        try dbQueue.write { db in
            try SyncStateRecord(key: key, value: value).insert(db, onConflict: .replace)
        }
    }

    func getSyncState(key: String) throws -> String? {
        try dbQueue.read { db in
            try SyncStateRecord.filter(Column("key") == key).fetchOne(db)?.value
        }
    }
}
