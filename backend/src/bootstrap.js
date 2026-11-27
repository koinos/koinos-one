const fs = require('fs');
const { createHash } = require('crypto');
const path = require('path');
const { execFileSync } = require('child_process');
const { pipeline } = require('stream/promises');
const { BACKUP_BASE_URL, DATA_DIR } = require('./config');
const { ensureDb, upsertBlocks } = require('./db');
const { loadLegacyBackupPublicKey, verifyLegacyManifest } = require('./legacy-signature');

// Remote archive names become local file names, so only plain names are accepted.
const ARCHIVE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:tar\.gz|tgz|zip)$/;
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

function archiveName(url) {
  if (url.href.includes('?') || url.href.includes('#')) {
    throw new Error('Backup archive URLs must not include a query or fragment');
  }
  const name = url.pathname.slice(url.pathname.lastIndexOf('/') + 1);
  if (!ARCHIVE_NAME.test(name) || WINDOWS_RESERVED_NAME.test(name)) {
    throw new Error(`Unsupported backup archive name: ${JSON.stringify(name)}`);
  }
  return name;
}

function checkRemoteUrl(url) {
  if (url.protocol !== 'https:') {
    throw new Error(`Unsupported backup URL scheme: ${url.protocol}`);
  }
  if (url.username || url.password) throw new Error('Backup URLs must not contain credentials');
}

// Keeps only HTTPS archive links on the index's own origin with a plain archive name.
function parseBackupLinks(html, baseUrl = BACKUP_BASE_URL) {
  const base = new URL(baseUrl);
  const links = [];
  for (const match of html.matchAll(/href=["']([^"']+\.(?:tar\.gz|tgz|zip))["']/gi)) {
    let url;
    try {
      url = new URL(match[1], base);
      checkRemoteUrl(url);
      archiveName(url);
    } catch {
      continue;
    }
    if (url.origin !== base.origin) continue;
    links.push(url.toString());
  }
  return [...new Set(links)];
}

function pickLatest(urls) {
  if (!urls.length) return null;
  return urls.sort((a, b) => b.localeCompare(a))[0];
}

async function discoverBackup(baseUrl = BACKUP_BASE_URL) {
  const base = new URL(baseUrl);
  checkRemoteUrl(base);
  // Redirects are refused so that the index and the archive stay on the configured origin.
  const res = await fetch(base, { redirect: 'error' });
  if (!res.ok) throw new Error(`Failed to fetch backup index: ${res.status} ${res.statusText}`);
  const html = await res.text();
  const urls = parseBackupLinks(html, baseUrl);
  const latest = pickLatest(urls);
  if (!latest) throw new Error(`No backup archives found in ${baseUrl}`);
  return latest;
}

function extractLocalArchive(localArchive) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const archives = path.join(DATA_DIR, 'archives');
  const extracted = path.join(DATA_DIR, 'extracted');
  fs.mkdirSync(archives, { recursive: true });
  fs.mkdirSync(extracted, { recursive: true });

  // The extractors get the paths as separate arguments without a shell. The archive path is absolute, so a file
  // name that starts with "-" cannot be read as an option.
  const archive = path.resolve(localArchive);
  const target = path.resolve(extracted);
  if (path.basename(archive).endsWith('.zip')) {
    if (process.platform === 'win32') {
      execFileSync('tar', ['-xf', archive, '-C', target], { stdio: 'inherit' });
    } else {
      execFileSync('unzip', ['-o', archive, '-d', target], { stdio: 'inherit' });
    }
  } else {
    execFileSync('tar', ['-xzf', archive, '-C', target], { stdio: 'inherit' });
  }
  return extracted;
}

async function downloadAndExtract(backupUrl) {
  const url = new URL(backupUrl);
  checkRemoteUrl(url);
  const name = archiveName(url);
  const publicKey = loadLegacyBackupPublicKey(process.env.TELENO_BACKUP_SIGNATURE_PUBLIC_KEY_FILE);

  const metadataRes = await fetch(`${url}.metadata`, { redirect: 'error' });
  if (!metadataRes.ok) throw new Error(`Backup metadata unavailable: HTTP ${metadataRes.status}`);
  const metadata = Buffer.from(await metadataRes.arrayBuffer());
  const manifestRes = await fetch(`${url}.manifest.json`, { redirect: 'error' });
  if (!manifestRes.ok) throw new Error(`Backup signed manifest unavailable: HTTP ${manifestRes.status}`);
  const expectedSha256 = verifyLegacyManifest(await manifestRes.json(), url.toString(), metadata, publicKey);

  const archives = path.join(DATA_DIR, 'archives');
  await fs.promises.mkdir(archives, { recursive: true });
  const staging = await fs.promises.mkdtemp(path.join(archives, '.download-'));
  const localArchive = path.join(staging, name);
  try {
    const res = await fetch(url, { redirect: 'error' });
    if (!res.ok) throw new Error(`Failed to download backup: ${res.status} ${res.statusText}`);
    const digest = createHash('sha256');
    await pipeline(res.body, async function* hashDownload(source) {
      for await (const chunk of source) {
        digest.update(chunk);
        yield chunk;
      }
    }, fs.createWriteStream(localArchive, { flags: 'wx', mode: 0o600 }));
    if (digest.digest('hex') !== expectedSha256) throw new Error('Backup archive does not match the signed manifest');

    const extracted = extractLocalArchive(localArchive);
    await fs.promises.rename(localArchive, path.join(archives, name));
    return extracted;
  } finally {
    await fs.promises.rm(staging, { recursive: true, force: true });
  }
}

function useLocalAndExtract(localPath) {
  if (!fs.existsSync(localPath)) throw new Error(`Local backup not found: ${localPath}`);
  return extractLocalArchive(localPath);
}

function indexFromExtracted(extractedDir) {
  const db = ensureDb();
  const blocks = [];

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.isFile()) {
        const st = fs.statSync(p);
        blocks.push({
          height: blocks.length + 1,
          id: `${path.basename(p)}-${st.size}`,
          producer: 'from-backup',
          tx_count: Math.max(1, Math.floor(st.size % 200)),
          timestamp: new Date(st.mtimeMs).toISOString(),
        });
      }
      if (blocks.length >= 5000) return;
    }
  }

  walk(extractedDir);
  if (!blocks.length) {
    throw new Error('Backup extracted but no files found to index');
  }
  upsertBlocks(db, blocks);
  db.prepare(`INSERT INTO sync_state(key,value) VALUES('last_bootstrap_at',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(new Date().toISOString());
  db.prepare(`INSERT INTO sync_state(key,value) VALUES('rows_indexed',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(String(blocks.length));
  db.close();
  return blocks.length;
}

async function bootstrap() {
  const localPath = process.env.TELENO_BACKUP_LOCAL_PATH;
  let extracted;
  if (localPath) {
    console.log('[bootstrap] using local backup:', localPath);
    extracted = useLocalAndExtract(localPath);
  } else {
    const backupUrl = process.env.TELENO_BACKUP_URL || await discoverBackup();
    console.log('[bootstrap] using backup URL:', backupUrl);
    extracted = await downloadAndExtract(backupUrl);
  }
  const count = indexFromExtracted(extracted);
  console.log(`[bootstrap] indexed rows: ${count}`);
}

if (require.main === module) {
  bootstrap().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { parseBackupLinks, pickLatest, archiveName, discoverBackup, downloadAndExtract, extractLocalArchive };
