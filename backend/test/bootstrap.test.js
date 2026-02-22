const test = require('node:test');
const assert = require('node:assert/strict');
const { parseBackupLinks, pickLatest } = require('../src/bootstrap');

test('parse backup links from html', () => {
  const html = `
    <a href="koinos-2026-02-22.tar.gz">a</a>
    <a href="/backups/koinos-2026-02-23.tar.gz">b</a>
  `;
  const links = parseBackupLinks(html);
  assert.equal(links.length, 2);
  assert.ok(links[0].includes('http'));
});

test('pickLatest returns lexicographically latest', () => {
  const latest = pickLatest([
    'http://x/koinos-2026-02-20.tar.gz',
    'http://x/koinos-2026-02-23.tar.gz'
  ]);
  assert.equal(latest, 'http://x/koinos-2026-02-23.tar.gz');
});
