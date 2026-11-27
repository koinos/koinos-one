const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { generateKeyPairSync } = require('crypto');

// config.js reads the data directory when the module is loaded.
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'teleno-bootstrap-test-'));
process.env.TELENO_DATA_DIR = path.join(testRoot, 'data');
test.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));
const {
  parseBackupLinks, pickLatest, archiveName, discoverBackup, downloadAndExtract, extractLocalArchive,
} = require('../src/bootstrap');

const extractedDir = path.resolve(process.env.TELENO_DATA_DIR, 'extracted');
const posixOnly = { skip: process.platform === 'win32' };
const localArchiveName = 'daily backup.tar.gz';

function configureTrustedKey(t) {
  const dir = fs.mkdtempSync(path.join(testRoot, 'signature-fixture-'));
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privateKeyFile = path.join(dir, 'signing.pem');
  const publicKeyFile = path.join(dir, 'trusted.pub');
  const metadataFile = path.join(dir, 'archive.metadata');
  const metadata = Buffer.from('Included Directories:\nchain/\n');
  fs.writeFileSync(privateKeyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  fs.writeFileSync(publicKeyFile, publicKey.export({ type: 'spki', format: 'pem' }));
  fs.writeFileSync(metadataFile, metadata);
  const previous = process.env.TELENO_BACKUP_SIGNATURE_PUBLIC_KEY_FILE;
  process.env.TELENO_BACKUP_SIGNATURE_PUBLIC_KEY_FILE = publicKeyFile;
  t.after(() => {
    if (previous === undefined) delete process.env.TELENO_BACKUP_SIGNATURE_PUBLIC_KEY_FILE;
    else process.env.TELENO_BACKUP_SIGNATURE_PUBLIC_KEY_FILE = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { dir, metadata, metadataFile, privateKeyFile, publicKeyFile };
}

function signFixture(fixture, archive, url) {
  const manifestFile = `${archive}.manifest.json`;
  execFileSync(process.execPath, [
    path.resolve(__dirname, '../../scripts/sign-legacy-blockchain-backup.js'),
    '--archive', archive, '--metadata', fixture.metadataFile, '--archive-url', url,
    '--private-key', fixture.privateKeyFile, '--output', manifestFile,
  ]);
  return JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
}

function withFakeExtractors(fn, exitCode = 0) {
  const bin = fs.mkdtempSync(path.join(testRoot, 'fake-bin-'));
  const log = path.join(bin, 'calls.jsonl');
  for (const name of ['tar', 'unzip']) {
    fs.writeFileSync(path.join(bin, name), [
      '#!/usr/bin/env node',
      `require('fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify([${JSON.stringify(name)}, ...process.argv.slice(2)]) + '\\n');`,
      `process.exitCode = ${exitCode};`,
      '',
    ].join('\n'), { mode: 0o755 });
  }
  const oldPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${oldPath}`;
  try {
    fn();
  } finally {
    process.env.PATH = oldPath;
  }
  return fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line)) : [];
}

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

test('parseBackupLinks keeps only same-origin HTTPS links with plain archive names', () => {
  const html = [
    'koinos-2026-02-22.tar.gz',
    '/backups/koinos-2026-02-23.tgz',
    'https://seed.example/backups/koinos-2026-02-24.zip',
    'https://other.example/backups/koinos-2026-02-25.tar.gz',
    'http://seed.example/backups/koinos-2026-02-26.tar.gz',
    'https://user:secret@seed.example/backups/koinos-2026-02-27.tar.gz',
    'blob:https://seed.example/backups/koinos-2026-02-28.tar.gz',
    'https://seed.example/backups/next.tar.gz?copy=next.tar.gz',
    'koinos 2026.tar.gz',
    '-koinos.tar.gz',
    'CON.tar.gz',
    'koinos-2026-02-22.tar.gz',
  ].map((href) => `<a href="${href}">x</a>`).join('\n');
  assert.deepEqual(parseBackupLinks(html, 'https://seed.example/backups/'), [
    'https://seed.example/backups/koinos-2026-02-22.tar.gz',
    'https://seed.example/backups/koinos-2026-02-23.tgz',
    'https://seed.example/backups/koinos-2026-02-24.zip',
  ]);
});

test('archiveName rejects names that are not plain archive names', () => {
  assert.equal(archiveName(new URL('https://seed.example/b/koinos-backup.tar.gz')), 'koinos-backup.tar.gz');
  for (const url of ['https://seed.example/b/', 'https://seed.example/b/backup',
    'https://seed.example/b/a%20b.zip', 'https://seed.example/b/nul.tgz']) {
    assert.throws(() => archiveName(new URL(url)), /Unsupported backup archive name/, url);
  }
});

test('extractLocalArchive passes the archive path as one argument without a shell', posixOnly, () => {
  const dir = fs.mkdtempSync(path.join(testRoot, 'archive-'));
  const tarball = path.join(dir, localArchiveName);
  const zip = path.join(dir, "operator's backup.zip");
  const calls = withFakeExtractors(() => {
    extractLocalArchive(tarball);
    extractLocalArchive(zip);
  });
  assert.deepEqual(calls, [
    ['tar', '-xzf', tarball, '-C', extractedDir],
    ['unzip', '-o', zip, '-d', extractedDir],
  ]);
});

// Checks only which extractor the Windows branch selects; the test itself runs on POSIX with fake extractors.
test('extractLocalArchive selects tar for zip archives on Windows', posixOnly, () => {
  const zip = path.join(os.tmpdir(), 'backup.zip');
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'win32' });
  let calls;
  try {
    calls = withFakeExtractors(() => extractLocalArchive(zip));
  } finally {
    Object.defineProperty(process, 'platform', platform);
  }
  assert.deepEqual(calls, [['tar', '-xf', zip, '-C', extractedDir]]);
});

test('extractLocalArchive makes a relative path absolute so it cannot become an option', posixOnly, () => {
  const dir = fs.mkdtempSync(path.join(testRoot, 'cwd-'));
  const cwd = process.cwd();
  process.chdir(dir);
  let calls;
  try {
    calls = withFakeExtractors(() => extractLocalArchive('-backup.tar.gz'));
  } finally {
    process.chdir(cwd);
  }
  assert.deepEqual(calls, [['tar', '-xzf', path.join(fs.realpathSync(dir), '-backup.tar.gz'), '-C', extractedDir]]);
});

test('extractLocalArchive reports a failing extractor', posixOnly, () => {
  const tarball = path.join(os.tmpdir(), 'broken.tar.gz');
  const calls = withFakeExtractors(() => {
    assert.throws(() => extractLocalArchive(tarball), /Command failed/);
  }, 2);
  assert.deepEqual(calls, [['tar', '-xzf', tarball, '-C', extractedDir]]);
});

test('extractLocalArchive extracts a local archive with spaces in its name', posixOnly, () => {
  const source = fs.mkdtempSync(path.join(testRoot, 'local-source-'));
  fs.writeFileSync(path.join(source, 'block-0001.dat'), 'block data');
  const archive = path.join(source, localArchiveName);
  execFileSync('tar', ['-czf', archive, '-C', source, 'block-0001.dat']);
  extractLocalArchive(archive);
  assert.equal(fs.readFileSync(path.join(extractedDir, 'block-0001.dat'), 'utf8'), 'block data');
});

test('remote URL policy rejects HTTP, credentials, unsafe names and schemes before fetch', async (t) => {
  const requests = t.mock.method(global, 'fetch', async () => { throw new Error('unexpected fetch'); });
  for (const [url, message] of [
    ['ftp://seed.example/backups/koinos.tar.gz', /Unsupported backup URL scheme/],
    ['http://seed.example/backups/koinos.tar.gz', /Unsupported backup URL scheme/],
    ['https://user:secret@seed.example/backups/koinos.tar.gz', /must not contain credentials/],
    ['https://seed.example/backups/koinos%20backup.tar.gz', /Unsupported backup archive name/],
    ['https://seed.example/backups/-koinos.tar.gz', /Unsupported backup archive name/],
    ['https://seed.example/backups/koinos.tar.gz?mirror=stable', /must not include a query or fragment/],
    ['https://seed.example/backups/koinos.tar.gz#', /must not include a query or fragment/],
    ['https://seed.example/backups/koinos.tar.gz/', /Unsupported backup archive name/],
    ['https://seed.example/backups/', /Unsupported backup archive name/],
  ]) await assert.rejects(downloadAndExtract(url), message, url);
  await assert.rejects(discoverBackup('http://seed.example/backups/'), /Unsupported backup URL scheme/);
  assert.equal(requests.mock.callCount(), 0);
});

test('HTTPS discovery keeps same-origin links and refuses redirects', async (t) => {
  const calls = [];
  t.mock.method(global, 'fetch', async (url, options) => {
    calls.push([url.toString(), options.redirect]);
    if (url.pathname === '/moved/') throw new TypeError('redirect refused');
    return new Response('<a href="koinos-2026.tar.gz">a</a><a href="https://other.example/backups/koinos-9999.tar.gz">b</a>');
  });
  assert.equal(await discoverBackup('https://seed.example/backups/'), 'https://seed.example/backups/koinos-2026.tar.gz');
  await assert.rejects(discoverBackup('https://seed.example/moved/'), /redirect refused/);
  assert.deepEqual(calls, [
    ['https://seed.example/backups/', 'error'],
    ['https://seed.example/moved/', 'error'],
  ]);
});

test('remote download requires a configured public key before requesting sidecars', async (t) => {
  const previous = process.env.TELENO_BACKUP_SIGNATURE_PUBLIC_KEY_FILE;
  delete process.env.TELENO_BACKUP_SIGNATURE_PUBLIC_KEY_FILE;
  t.after(() => {
    if (previous !== undefined) process.env.TELENO_BACKUP_SIGNATURE_PUBLIC_KEY_FILE = previous;
  });
  const fetch = t.mock.method(global, 'fetch', async () => { throw new Error('unexpected fetch'); });
  await assert.rejects(downloadAndExtract('https://seed.example/backups/koinos.tar.gz'), /TELENO_BACKUP_SIGNATURE_PUBLIC_KEY_FILE/);
  assert.equal(fetch.mock.callCount(), 0);
});

test('HTTPS sidecar request refuses redirects', async (t) => {
  configureTrustedKey(t);
  const calls = [];
  t.mock.method(global, 'fetch', async (url, options) => {
    calls.push([url.toString(), options.redirect]);
    throw new TypeError('redirect refused');
  });
  await assert.rejects(downloadAndExtract('https://seed.example/backups/koinos-moved.tar.gz'), /redirect refused/);
  assert.deepEqual(calls, [['https://seed.example/backups/koinos-moved.tar.gz.metadata', 'error']]);
});

test('the signing utility produces TAR and ZIP publications the HTTPS helper accepts', posixOnly, async (t) => {
  const fixture = configureTrustedKey(t);
  const index = 'https://seed.example/backups/';
  const tarUrl = `${index}koinos-mirror.tar.gz`;
  const zipUrl = `${index}koinos-mirror.zip`;
  const tarball = path.join(fixture.dir, 'koinos-mirror.tar.gz');
  const zip = path.join(fixture.dir, 'koinos-mirror.zip');
  fs.writeFileSync(path.join(fixture.dir, 'tar-block.dat'), 'synthetic TAR block');
  fs.writeFileSync(path.join(fixture.dir, 'zip-block.dat'), 'synthetic ZIP block');
  execFileSync('tar', ['-czf', tarball, '-C', fixture.dir, 'tar-block.dat']);
  execFileSync('zip', ['-q', '-j', zip, path.join(fixture.dir, 'zip-block.dat')]);
  const replies = new Map([[index, '<a href="koinos-mirror.tar.gz">archive</a>']]);
  for (const [url, archive] of [[tarUrl, tarball], [zipUrl, zip]]) {
    replies.set(`${url}.metadata`, fixture.metadata);
    replies.set(`${url}.manifest.json`, JSON.stringify(signFixture(fixture, archive, url)));
    replies.set(url, fs.readFileSync(archive));
  }
  const calls = [];
  t.mock.method(global, 'fetch', async (url, options) => {
    const request = String(url);
    calls.push([request, options.redirect]);
    assert.ok(replies.has(request), `Unexpected offline fixture request: ${request}`);
    return new Response(replies.get(request));
  });
  await downloadAndExtract(await discoverBackup(index));
  assert.equal(fs.readFileSync(path.join(extractedDir, 'tar-block.dat'), 'utf8'), 'synthetic TAR block');
  await downloadAndExtract(zipUrl);
  assert.equal(fs.readFileSync(path.join(extractedDir, 'zip-block.dat'), 'utf8'), 'synthetic ZIP block');
  assert.deepEqual(calls, [...replies.keys()].map((url) => [url, 'error']));
  const archives = path.join(process.env.TELENO_DATA_DIR, 'archives');
  assert.deepEqual(fs.readdirSync(archives).sort(), ['koinos-mirror.tar.gz', 'koinos-mirror.zip']);
  assert.deepEqual(fs.readFileSync(path.join(archives, 'koinos-mirror.tar.gz')), replies.get(tarUrl));
  assert.deepEqual(fs.readFileSync(path.join(archives, 'koinos-mirror.zip')), replies.get(zipUrl));
});

test('unsigned or mismatched remote content is refused before extraction', posixOnly, async (t) => {
  const fixture = configureTrustedKey(t);
  const url = 'https://seed.example/backups/koinos-refusal.tar.gz';
  const otherUrl = 'https://seed.example/backups/koinos-other.tar.gz';
  const original = path.join(fixture.dir, 'original.tar.gz');
  const replacement = path.join(fixture.dir, 'replacement.tar.gz');
  fs.writeFileSync(path.join(fixture.dir, 'original-block.dat'), 'original synthetic block');
  fs.writeFileSync(path.join(fixture.dir, 'replacement-block.dat'), 'replacement synthetic block');
  execFileSync('tar', ['-czf', original, '-C', fixture.dir, 'original-block.dat']);
  execFileSync('tar', ['-czf', replacement, '-C', fixture.dir, 'replacement-block.dat']);
  const manifest = signFixture(fixture, original, url);
  const otherPublicKeyFile = path.join(fixture.dir, 'other.pub');
  const { publicKey } = generateKeyPairSync('ed25519');
  fs.writeFileSync(otherPublicKeyFile, publicKey.export({ type: 'spki', format: 'pem' }));
  const archives = path.join(process.env.TELENO_DATA_DIR, 'archives');
  fs.mkdirSync(archives, { recursive: true });
  const cached = path.join(archives, 'koinos-refusal.tar.gz');
  const cachedBytes = fs.readFileSync(original);
  fs.writeFileSync(cached, cachedBytes);
  const previousNames = fs.readdirSync(archives).sort();

  let responses;
  let requests;
  t.mock.method(global, 'fetch', async (requestUrl, options) => {
    const request = String(requestUrl);
    requests.push(request);
    assert.equal(options.redirect, 'error');
    assert.ok(responses.has(request), `Unexpected offline fixture request: ${request}`);
    return responses.get(request);
  });
  for (const [archiveUrl, metadata, signedManifest, archive, message, keyFile = fixture.publicKeyFile] of [
    [url, fixture.metadata, null, null, /signed manifest unavailable: HTTP 404/],
    [url, fixture.metadata, { ...manifest, signature_hex: undefined }, null, /Invalid legacy backup signature envelope/],
    [url, fixture.metadata, manifest, null, /signature does not match the trusted key/, otherPublicKeyFile],
    [url, Buffer.from('new synthetic metadata'), manifest, null, /does not match the archive or metadata/],
    [otherUrl, fixture.metadata, manifest, null, /does not match the archive or metadata/],
    [url, fixture.metadata, manifest, fs.readFileSync(replacement), /archive does not match the signed manifest/],
  ]) {
    process.env.TELENO_BACKUP_SIGNATURE_PUBLIC_KEY_FILE = keyFile;
    requests = [];
    responses = new Map([
      [`${archiveUrl}.metadata`, new Response(metadata)],
      [`${archiveUrl}.manifest.json`, signedManifest ? Response.json(signedManifest) : new Response(null, { status: 404 })],
    ]);
    if (archive) responses.set(archiveUrl, new Response(archive));
    await assert.rejects(downloadAndExtract(archiveUrl), message);
    assert.deepEqual(requests, [...responses.keys()]);
    assert.equal(fs.existsSync(path.join(extractedDir, 'replacement-block.dat')), false);
    assert.deepEqual(fs.readdirSync(archives).sort(), previousNames);
    assert.deepEqual(fs.readFileSync(cached), cachedBytes);
  }
});
