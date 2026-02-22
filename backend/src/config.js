const path = require('path');

const DATA_DIR = process.env.KNODEL_DATA_DIR || path.join(process.cwd(), 'backend', 'data');
const DB_PATH = process.env.KNODEL_DB_PATH || path.join(DATA_DIR, 'knodel.db');
const BACKUP_BASE_URL = process.env.KNODEL_BACKUP_BASE_URL || 'http://seed.koinosfoundation.org/backups/';

module.exports = { DATA_DIR, DB_PATH, BACKUP_BASE_URL };
