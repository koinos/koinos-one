const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { DB_PATH } = require('./config');

function ensureDb() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS blocks (
      height INTEGER PRIMARY KEY,
      id TEXT NOT NULL,
      producer TEXT,
      tx_count INTEGER,
      timestamp TEXT
    );
    CREATE TABLE IF NOT EXISTS sync_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  return db;
}

function upsertBlocks(db, blocks) {
  const stmt = db.prepare(`
    INSERT INTO blocks(height,id,producer,tx_count,timestamp)
    VALUES(@height,@id,@producer,@tx_count,@timestamp)
    ON CONFLICT(height) DO UPDATE SET
      id=excluded.id,
      producer=excluded.producer,
      tx_count=excluded.tx_count,
      timestamp=excluded.timestamp
  `);
  const trx = db.transaction((rows) => { for (const r of rows) stmt.run(r); });
  trx(blocks);
}

module.exports = { ensureDb, upsertBlocks };
