#!/usr/bin/env node
process.noDeprecation = true;

const childProcess = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Contract, Provider, Signer, Transaction, utils } = require("koilib");

const DEFAULT_LOCAL_RPC = "http://127.0.0.1:18122";
const DEFAULT_PUBLIC_RPC = "https://testnet.koinosfoundation.org/jsonrpc";
const DEFAULT_PRODUCER = "1Kjfrv3qxWvb3afwUdFevZHS1WdT4ginPi";
const DEFAULT_RECIPIENT = "1FFpnG9ev9ZsZ91uDWF19ro7zaKodcBtzX";
const DEFAULT_TESTNET_KOIN_CONTRACT = "1FaSvLjQJsCJKq5ybmGsMMQs8RQYyVv8ju";
const DEFAULT_TESTNET_CHAIN_ID = "EiAIKVvm6-V2qmsmUvPJy09vCCLbtn9lHFpwrJbcTIEWRQ==";
const DEFAULT_PASSWORD_FILE = path.join(
  os.homedir(),
  ".kcli",
  "teleno-testnet-producer",
  "producer-control-wallet",
  "wallet-password.txt",
);

function utcNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function safeTimestamp() {
  return utcNow().replace(/[-:]/g, "").replace("Z", "Z");
}

function die(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {
    localRpc: process.env.LOCAL_RPC || DEFAULT_LOCAL_RPC,
    publicRpc: process.env.PUBLIC_RPC || DEFAULT_PUBLIC_RPC,
    walletFile: process.env.KCLI_WALLET_FILE || path.join(os.homedir(), ".kcli", "wallet.json"),
    passwordFile: process.env.KCLI_PASSWORD_FILE || DEFAULT_PASSWORD_FILE,
    kcliBin: process.env.KCLI_BIN || "kcli",
    koinContract: process.env.KOIN_CONTRACT || DEFAULT_TESTNET_KOIN_CONTRACT,
    expectedChainId: process.env.CHAIN_ID || DEFAULT_TESTNET_CHAIN_ID,
    producerAddress: process.env.PRODUCER_ADDRESS || DEFAULT_PRODUCER,
    recipientAddress: process.env.RECIPIENT_ADDRESS || DEFAULT_RECIPIENT,
    amount: process.env.TRANSFER_AMOUNT || "0.001",
    txCount: Number.parseInt(process.env.TX_COUNT || "5", 10),
    maxTotalKoin: process.env.MAX_TOTAL_KOIN || "0.02",
    resultDir: process.env.RESULT_DIR || "",
    pollIntervalMs: Number.parseInt(process.env.POLL_INTERVAL_MS || "1000", 10),
    confirmTimeoutMs: Number.parseInt(process.env.CONFIRM_TIMEOUT_MS || "120000", 10),
    headConvergenceRetries: Number.parseInt(process.env.HEAD_CONVERGENCE_RETRIES || "10", 10),
    headConvergenceDelayMs: Number.parseInt(process.env.HEAD_CONVERGENCE_DELAY_MS || "1000", 10),
    submit: process.env.SUBMIT_TRANSFERS === "1",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) die(`missing value for ${arg}`);
      return argv[i];
    };
    switch (arg) {
      case "--local-rpc":
        args.localRpc = next();
        break;
      case "--public-rpc":
        args.publicRpc = next();
        break;
      case "--wallet-file":
        args.walletFile = next();
        break;
      case "--password-file":
        args.passwordFile = next();
        break;
      case "--kcli-bin":
        args.kcliBin = next();
        break;
      case "--koin-contract":
        args.koinContract = next();
        break;
      case "--chain-id":
        args.expectedChainId = next();
        break;
      case "--producer-address":
        args.producerAddress = next();
        break;
      case "--recipient-address":
        args.recipientAddress = next();
        break;
      case "--amount":
        args.amount = next();
        break;
      case "--tx-count":
        args.txCount = Number.parseInt(next(), 10);
        break;
      case "--max-total-koin":
        args.maxTotalKoin = next();
        break;
      case "--result-dir":
        args.resultDir = next();
        break;
      case "--poll-interval-ms":
        args.pollIntervalMs = Number.parseInt(next(), 10);
        break;
      case "--confirm-timeout-ms":
        args.confirmTimeoutMs = Number.parseInt(next(), 10);
        break;
      case "--head-convergence-retries":
        args.headConvergenceRetries = Number.parseInt(next(), 10);
        break;
      case "--head-convergence-delay-ms":
        args.headConvergenceDelayMs = Number.parseInt(next(), 10);
        break;
      case "--submit":
        args.submit = true;
        break;
      case "--dry-run":
        args.submit = false;
        break;
      case "-h":
      case "--help":
        usage();
        process.exit(0);
        break;
      default:
        die(`unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(args.txCount) || args.txCount <= 0) die("--tx-count must be a positive integer");
  if (!Number.isFinite(args.pollIntervalMs) || args.pollIntervalMs <= 0) die("--poll-interval-ms must be positive");
  if (!Number.isFinite(args.confirmTimeoutMs) || args.confirmTimeoutMs <= 0) die("--confirm-timeout-ms must be positive");
  if (!Number.isFinite(args.headConvergenceRetries) || args.headConvergenceRetries < 0) {
    die("--head-convergence-retries must be non-negative");
  }
  if (!Number.isFinite(args.headConvergenceDelayMs) || args.headConvergenceDelayMs <= 0) {
    die("--head-convergence-delay-ms must be positive");
  }
  return args;
}

function usage() {
  console.log(`usage:
  scripts/benchmark-transaction-submission.js --submit [options]

Options:
  --local-rpc URL             Local monolith JSON-RPC endpoint. Default: ${DEFAULT_LOCAL_RPC}
  --public-rpc URL            Public witness JSON-RPC endpoint. Default: ${DEFAULT_PUBLIC_RPC}
  --recipient-address ADDR    Recipient for low-value KOIN transfers.
  --amount KOIN               Amount per transfer. Default: 0.001
  --tx-count N                Number of transfers. Default: 5
  --max-total-koin KOIN       Safety cap. Default: 0.02
  --password-file PATH        0600 kcli wallet password file.
  --result-dir PATH           Output directory.
  --dry-run                   Prepare/sign only; do not submit.

The script decrypts the local kcli wallet in memory, never prints the WIF,
times prepare/sign/direct chain.submit_transaction, and verifies public
inclusion for submitted transactions.`);
}

function ensurePrivateFile(filePath, label) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) die(`${label} is not a regular file: ${filePath}`);
  if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) {
    die(`${label} must not be readable by group or others: ${filePath}`);
  }
}

function deriveKey(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 32, "sha256");
}

function decryptWalletKey(encryptedData, password) {
  const salt = Buffer.from(encryptedData.salt, "hex");
  const iv = Buffer.from(encryptedData.iv, "hex");
  const authTag = Buffer.from(encryptedData.authTag, "hex");
  const key = deriveKey(password, salt);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encryptedData.encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

function readWallet(walletFile, passwordFile) {
  ensurePrivateFile(walletFile, "wallet file");
  ensurePrivateFile(passwordFile, "password file");
  const walletData = JSON.parse(fs.readFileSync(walletFile, "utf8"));
  const password = fs.readFileSync(passwordFile, "utf8").replace(/\r?\n$/, "");
  if (!password) die("password file is empty");
  const privateKey = decryptWalletKey(walletData.encryptedKey, password);
  return { address: walletData.address, privateKey };
}

function resolveKcliAbi(kcliBin) {
  const resolved = fs.realpathSync(childProcess.execSync(`command -v ${shellQuote(kcliBin)}`).toString().trim());
  const abiPath = path.resolve(path.dirname(resolved), "abis", "token.json");
  if (!fs.existsSync(abiPath)) die(`kcli token ABI not found at ${abiPath}`);
  return JSON.parse(fs.readFileSync(abiPath, "utf8"));
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function parseUnits(value) {
  if (!/^\d+(\.\d+)?$/.test(value)) die(`invalid decimal amount: ${value}`);
  return BigInt(utils.parseUnits(value, 8));
}

function formatUnits(value) {
  return utils.formatUnits(value.toString(), 8);
}

function nowMs() {
  return Number(process.hrtime.bigint()) / 1_000_000;
}

async function timed(fn) {
  const started = nowMs();
  const value = await fn();
  return { value, ms: round(nowMs() - started) };
}

function round(value, places = 3) {
  return Math.round(value * 10 ** places) / 10 ** places;
}

function percentile(values, pct) {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  if (ordered.length === 1) return ordered[0];
  const rank = (ordered.length - 1) * (pct / 100);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return ordered[lower];
  return ordered[lower] * (1 - (rank - lower)) + ordered[upper] * (rank - lower);
}

function summarize(values) {
  if (!values.length) return { count: 0 };
  return {
    count: values.length,
    min: round(Math.min(...values)),
    mean: round(values.reduce((sum, value) => sum + value, 0) / values.length),
    p50: round(percentile(values, 50)),
    p95: round(percentile(values, 95)),
    p99: round(percentile(values, 99)),
    max: round(Math.max(...values)),
  };
}

function encodeNonceValue(value) {
  const bytes = [0x28];
  let next = BigInt(value);
  while (next >= 0x80n) {
    bytes.push(Number((next & 0x7fn) | 0x80n));
    next >>= 7n;
  }
  bytes.push(Number(next));
  return Buffer.from(bytes).toString("base64url");
}

function normalizeHead(head) {
  const topology = head.head_topology || {};
  return {
    height: Number(topology.height || 0),
    id: topology.id || "",
    previous: topology.previous || "",
    last_irreversible_block: Number(head.last_irreversible_block || 0),
  };
}

async function getHead(provider) {
  const { value, ms } = await timed(() => provider.getHeadInfo());
  return { head: normalizeHead(value), latency_ms: ms };
}

async function waitForHeadConvergence(localProvider, publicProvider, retries, delayMs) {
  let localHead = null;
  let publicHead = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    localHead = await getHead(localProvider);
    publicHead = await getHead(publicProvider);
    if (localHead.head.id === publicHead.head.id) {
      return { localHead, publicHead, converged: true, attempts: attempt + 1 };
    }
    if (attempt < retries) await sleep(delayMs);
  }
  return { localHead, publicHead, converged: false, attempts: retries + 1 };
}

async function getPending(provider) {
  const { value, ms } = await timed(() => provider.call("mempool.get_pending_transactions", {}));
  const pending = value.pending_transactions || value.pendingTransactions || [];
  const ids = [];
  for (const item of pending) {
    const tx = item.transaction || item.trx?.transaction || {};
    if (tx.id) ids.push(tx.id);
  }
  return { count: pending.length, ids, latency_ms: ms };
}

function blockContainsTx(block, txId) {
  const transactions = block?.block?.transactions || [];
  return transactions.some((tx) => tx.id === txId);
}

async function waitForPublicInclusion(publicProvider, txIds, startHeight, timeoutMs, pollIntervalMs) {
  const pending = new Set(txIds);
  const included = {};
  const checkedBlocks = [];
  const started = nowMs();
  let nextHeight = startHeight;

  while (pending.size && nowMs() - started <= timeoutMs) {
    const { head } = await getHead(publicProvider);
    while (nextHeight <= head.height && pending.size) {
      const block = await publicProvider.getBlock(nextHeight);
      checkedBlocks.push(nextHeight);
      for (const txId of [...pending]) {
        if (blockContainsTx(block, txId)) {
          included[txId] = {
            height: nextHeight,
            block_id: block.block_id,
            detected_after_ms: round(nowMs() - started),
          };
          pending.delete(txId);
        }
      }
      nextHeight += 1;
    }
    if (pending.size) await sleep(pollIntervalMs);
  }

  return {
    included,
    missing: [...pending],
    checked_blocks: checkedBlocks,
    elapsed_ms: round(nowMs() - started),
    timeout_ms: timeoutMs,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function buildTransfer({ token, signerAddress, recipientAddress, amountRaw }) {
  const { operation } = await token.functions.transfer(
    {
      from: signerAddress,
      to: recipientAddress,
      value: amountRaw.toString(),
    },
    { onlyOperation: true },
  );
  return operation;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = utcNow();
  const resultDir = args.resultDir || path.join("/private/tmp/teleno-transaction-benchmarks", safeTimestamp());
  fs.mkdirSync(resultDir, { recursive: true });

  const amountRaw = parseUnits(args.amount);
  const maxTotalRaw = parseUnits(args.maxTotalKoin);
  const totalRaw = amountRaw * BigInt(args.txCount);
  if (totalRaw > maxTotalRaw) {
    die(`requested total ${formatUnits(totalRaw)} KOIN exceeds --max-total-koin ${args.maxTotalKoin}`);
  }

  const wallet = readWallet(args.walletFile, args.passwordFile);
  const tokenAbi = resolveKcliAbi(args.kcliBin);
  const localProvider = new Provider([args.localRpc]);
  const publicProvider = new Provider([args.publicRpc]);
  const signer = Signer.fromWif(wallet.privateKey);
  signer.provider = localProvider;
  const signerAddress = await signer.getAddress();
  if (signerAddress !== wallet.address) die("decrypted wallet address does not match wallet file address");
  if (signerAddress !== args.producerAddress) die(`wallet address ${signerAddress} does not match producer address ${args.producerAddress}`);
  if (!utils.isChecksumAddress(args.recipientAddress)) die(`invalid recipient address: ${args.recipientAddress}`);

  const token = new Contract({
    id: args.koinContract,
    abi: tokenAbi,
    provider: localProvider,
    signer,
  });

  const convergence = await waitForHeadConvergence(
    localProvider,
    publicProvider,
    args.headConvergenceRetries,
    args.headConvergenceDelayMs,
  );
  if (!convergence.converged) {
    die(
      `local/public heads did not converge: local=${convergence.localHead.head.height} ${convergence.localHead.head.id}, ` +
      `public=${convergence.publicHead.head.height} ${convergence.publicHead.head.id}`,
    );
  }

  const chainId = await localProvider.getChainId();
  if (chainId !== args.expectedChainId) die(`unexpected chain id: ${chainId}`);

  const balanceResult = await token.functions.balance_of({ owner: signerAddress });
  const balanceRaw = BigInt(balanceResult.result?.value || "0");
  if (balanceRaw < totalRaw) die(`insufficient KOIN balance for benchmark total ${formatUnits(totalRaw)}`);
  const manaRaw = BigInt(await localProvider.getAccountRc(signerAddress));
  if (manaRaw <= 50_000_000n) die("insufficient mana for benchmark");
  const rcLimit = ((manaRaw * 10n) / 100n).toString();
  const baseNonce = BigInt(await localProvider.getNonce(signerAddress));

  const transactions = [];
  const pendingSamples = [{ label: "before", ...(await getPending(localProvider)) }];
  const txIds = [];
  const startPublicHeight = convergence.publicHead.head.height + 1;

  for (let index = 0; index < args.txCount; index += 1) {
    const txStarted = nowMs();
    const nonceValue = baseNonce + BigInt(index + 1);
    const tx = new Transaction({
      signer,
      provider: localProvider,
      options: { rcLimit },
    });
    const operationTiming = await timed(() => buildTransfer({
      token,
      signerAddress,
      recipientAddress: args.recipientAddress,
      amountRaw,
    }));
    await tx.pushOperation(operationTiming.value);
    const prepareTiming = await timed(() => tx.prepare({
      nonce: encodeNonceValue(nonceValue),
      rcLimit,
      payer: signerAddress,
      chainId: args.expectedChainId,
    }));
    if (tx.transaction.header?.chain_id !== args.expectedChainId) die("prepared transaction chain id mismatch");
    const signTiming = await timed(() => tx.sign());

    const row = {
      index: index + 1,
      nonce: nonceValue.toString(),
      tx_id: tx.transaction.id,
      operation_build_ms: operationTiming.ms,
      prepare_ms: prepareTiming.ms,
      sign_ms: signTiming.ms,
      submitted: false,
      submit_ms: null,
      receipt: null,
      client_total_ms: null,
      pending_after_submit: null,
      error: null,
    };

    if (args.submit) {
      try {
        const sendTiming = await timed(() => tx.send({ broadcast: true }));
        row.submit_ms = sendTiming.ms;
        row.submitted = true;
        row.receipt = {
          id: sendTiming.value?.id || tx.transaction.id,
          rc_used: sendTiming.value?.rc_used || "",
          reverted: Boolean(sendTiming.value?.reverted),
          event_count: Array.isArray(sendTiming.value?.events) ? sendTiming.value.events.length : 0,
          log_count: Array.isArray(sendTiming.value?.logs) ? sendTiming.value.logs.length : 0,
        };
        txIds.push(tx.transaction.id);
        row.pending_after_submit = await getPending(localProvider);
        pendingSamples.push({ label: `after-submit-${index + 1}`, ...row.pending_after_submit });
      } catch (error) {
        row.error = error instanceof Error ? error.message : String(error);
      }
    }

    row.client_total_ms = round(nowMs() - txStarted);
    transactions.push(row);
    if (row.error) break;
  }

  let inclusion = { included: {}, missing: [], checked_blocks: [], elapsed_ms: 0, timeout_ms: args.confirmTimeoutMs };
  if (args.submit && txIds.length) {
    inclusion = await waitForPublicInclusion(publicProvider, txIds, startPublicHeight, args.confirmTimeoutMs, args.pollIntervalMs);
    pendingSamples.push({ label: "after-inclusion", ...(await getPending(localProvider)) });
  }

  const submittedRows = transactions.filter((tx) => tx.submitted);
  const errors = transactions.filter((tx) => tx.error).map((tx) => ({ index: tx.index, tx_id: tx.tx_id, error: tx.error }));
  const missing = inclusion.missing || [];
  const status = errors.length || missing.length || (args.submit && submittedRows.length !== args.txCount)
    ? "fail"
    : args.submit
      ? "pass"
      : "warn";

  const includedHeights = {};
  for (const item of Object.values(inclusion.included || {})) {
    includedHeights[String(item.height)] = (includedHeights[String(item.height)] || 0) + 1;
  }

  const result = {
    kind: "teleno-transaction-submission-benchmark",
    status,
    started_at: startedAt,
    finished_at: utcNow(),
    local_rpc: args.localRpc,
    public_rpc: args.publicRpc,
    producer_address: args.producerAddress,
    recipient_address: args.recipientAddress,
    koin_contract: args.koinContract,
    amount_koin: args.amount,
    tx_count: args.txCount,
    total_koin: formatUnits(totalRaw),
    submitted: args.submit,
    head_convergence: convergence,
    local_head: convergence.localHead,
    public_head: convergence.publicHead,
    base_nonce: baseNonce.toString(),
    balance_koin_before: formatUnits(balanceRaw),
    mana_before: formatUnits(manaRaw),
    rc_limit: rcLimit,
    transaction_latency_ms: {
      operation_build: summarize(transactions.map((tx) => tx.operation_build_ms).filter((value) => typeof value === "number")),
      prepare: summarize(transactions.map((tx) => tx.prepare_ms).filter((value) => typeof value === "number")),
      sign: summarize(transactions.map((tx) => tx.sign_ms).filter((value) => typeof value === "number")),
      submit: summarize(submittedRows.map((tx) => tx.submit_ms).filter((value) => typeof value === "number")),
      client_total: summarize(transactions.map((tx) => tx.client_total_ms).filter((value) => typeof value === "number")),
    },
    included_block_counts: includedHeights,
    inclusion,
    pending_samples: pendingSamples,
    transactions,
    errors,
    result_dir: resultDir,
  };

  writeOutputs(result, resultDir);
  console.log(JSON.stringify({
    status: result.status,
    result_dir: resultDir,
    json: path.join(resultDir, "result.json"),
    markdown: path.join(resultDir, "result.md"),
  }, null, 2));

  process.exit(status === "fail" ? 1 : 0);
}

function writeOutputs(result, resultDir) {
  const jsonPath = path.join(resultDir, "result.json");
  const mdPath = path.join(resultDir, "result.md");
  fs.writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });

  const submit = result.transaction_latency_ms.submit;
  const total = result.transaction_latency_ms.client_total;
  const lines = [
    "# Transaction Submission Benchmark",
    "",
    `- Status: \`${result.status}\``,
    `- Started: \`${result.started_at}\``,
    `- Finished: \`${result.finished_at}\``,
    `- Local RPC: \`${result.local_rpc}\``,
    `- Public RPC: \`${result.public_rpc}\``,
    `- Submitted: \`${result.submitted}\``,
    `- Transactions: \`${result.transactions.length}\``,
    `- Amount per transfer: \`${result.amount_koin} KOIN\``,
    `- Total transfer amount: \`${result.total_koin} KOIN\``,
    "",
    "## Latency",
    "",
    "| Metric | Count | Mean ms | p50 ms | p95 ms | p99 ms | Max ms |",
    "|---|---:|---:|---:|---:|---:|---:|",
  ];
  for (const [label, stats] of Object.entries(result.transaction_latency_ms)) {
    lines.push(`| ${label} | ${stats.count || 0} | ${stats.mean ?? ""} | ${stats.p50 ?? ""} | ${stats.p95 ?? ""} | ${stats.p99 ?? ""} | ${stats.max ?? ""} |`);
  }
  lines.push(
    "",
    "## Inclusion",
    "",
    `- Missing transactions: \`${result.inclusion.missing.length}\``,
    `- Included block counts: \`${JSON.stringify(result.included_block_counts)}\``,
    `- Inclusion detection elapsed: \`${result.inclusion.elapsed_ms} ms\``,
    "",
    "## Notes",
    "",
    `- Direct submit latency p95: \`${submit.p95 ?? ""} ms\``,
    `- Full client prepare/sign/submit p95: \`${total.p95 ?? ""} ms\``,
    "- The WIF/private key and wallet password are never written to this report.",
    "",
    `JSON result: \`${jsonPath}\``,
    "",
  );
  fs.writeFileSync(mdPath, lines.join("\n"), { mode: 0o600 });
}

main().catch((error) => {
  if (process.env.DEBUG_STACK === "1" && error instanceof Error) {
    console.error(error.stack || error.message);
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exit(1);
});
