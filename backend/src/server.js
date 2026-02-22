const express = require('express');
const { ensureDb } = require('./db');

const app = express();
const PORT = process.env.KNODEL_API_PORT || 8787;

app.get('/health', (_req, res) => res.json({ ok: true }));

app.get('/blocks/latest', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '20', 10), 100);
  const db = ensureDb();
  const rows = db.prepare('SELECT * FROM blocks ORDER BY height DESC LIMIT ?').all(limit);
  db.close();
  res.json(rows);
});

app.get('/blocks/:height', (req, res) => {
  const h = parseInt(req.params.height, 10);
  const db = ensureDb();
  const row = db.prepare('SELECT * FROM blocks WHERE height = ?').get(h);
  db.close();
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.json(row);
});

app.listen(PORT, () => console.log(`[knodel-api] listening on ${PORT}`));
