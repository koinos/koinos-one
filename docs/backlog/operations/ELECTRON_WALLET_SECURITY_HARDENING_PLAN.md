# Electron Wallet Security Hardening Plan

- Date: 2026-07-05
- Scope: Electron renderer containment, navigation/CSP policy, wallet amount
  conversion, encrypted wallet file permissions, and wallet action tests
- Status: implementation plan
- Source: defensive review of `audit.md` received 2026-07-03, rechecked
  against `origin/main` at `92f65fe`

## Problem

Koinos One wallet storage and backup exclusion are fundamentally sound, but the
desktop app can still reduce the blast radius of renderer compromise and remove
low-level wallet correctness risks.

The verified gaps are:

- Electron renderer sandbox is disabled.
- A restrictive Content Security Policy is not currently enforced.
- KOIN/VHP transfer and burn paths convert decimal token amounts through
  JavaScript floating point math.
- The encrypted wallet file is written through atomic rename but does not
  explicitly chmod the final path after rename, unlike other storage writers.

Navigation guards are already present, so the older audit statement that there
is no navigation/window-open guard is stale. This plan keeps those guards and
adds the missing hardening.

## Confirmed Safe Baseline

- Wallet secrets are encrypted with AES-256-GCM, PBKDF2-HMAC-SHA256, fresh salt
  and IV, and authenticated tags.
- Producer wallet files live under Electron `userData/secure-storage/...`, not
  in the node basedir.
- Public bootstrap snapshot code uses a path allowlist plus denylist and
  config-content validation that blocks wallet/private-key/admin-token material.
- Restore activation remains observer-first and does not hot-swap an open live
  RocksDB database.
- Electron app navigation guards exist in `app-lifecycle-service.ts` through
  `will-frame-navigate` and `setWindowOpenHandler`.

## Goals

1. Enable Electron sandboxing without breaking preload IPC.
2. Enforce a restrictive CSP for packaged builds and a compatible dev CSP.
3. Convert wallet token amounts using decimal string/integer math, not
   floating point multiplication.
4. Explicitly set restrictive permissions after wallet-file atomic rename.
5. Add tests for edge-case token amount conversion and file permissions.
6. Preserve existing first-run assistant and wallet user experience.

## Non-Goals

- Do not change wallet encryption format unless a migration plan is included.
- Do not move wallet files into the node basedir.
- Do not add new signing or transfer flows.
- Do not submit live transactions as part of validation.
- Do not expose wallet secrets, WIF keys, seed phrases, or private local paths
  in docs or test artifacts.

## Implementation Plan

### 1. Enable Electron Renderer Sandbox

Change `BrowserWindow` creation from:

```ts
webPreferences: {
  preload,
  sandbox: false
}
```

to:

```ts
webPreferences: {
  preload,
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false
}
```

Then audit preload usage:

- no direct Node APIs exposed to renderer;
- every IPC method remains explicitly listed;
- no broad `ipcRenderer.send` escape hatch;
- no remote module usage.

If a dependency breaks under sandbox, fix that dependency path rather than
turning sandbox off again.

### 2. Add Content Security Policy

For packaged builds, add a CSP equivalent to:

```text
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
font-src 'self' data:;
connect-src 'self' http://127.0.0.1:* http://localhost:*;
frame-src 'self';
object-src 'none';
base-uri 'none';
form-action 'none';
```

Development builds may allow the Vite dev server and websocket endpoints, but
the packaged app should not need arbitrary remote script or frame execution.

Implementation options:

- Inject a `Content-Security-Policy` meta tag in `index.html`.
- Or set headers/interception in Electron for packaged local files.

Keep external documentation and source links opened with `shell.openExternal`,
not inside privileged app frames.

### 3. Keep And Test Navigation Guards

The app already has:

- `will-frame-navigate`
- `setWindowOpenHandler`
- external URL opening through `openExternalUrl`

Add tests that prove:

- packaged local file navigation is allowed only for the app bundle;
- HTTP(S) external navigation is denied inside the app and opened externally;
- dev-server same-origin navigation remains allowed in dev mode;
- non-HTTP schemes are denied unless explicitly required.

### 4. Replace Floating-Point Amount Conversion

Introduce a helper, for example:

```ts
export function parseTokenAmountToSatoshi(input: string, decimals = 8): bigint
```

Rules:

- accept strings, not numbers, at the service boundary;
- trim whitespace;
- require digits with optional one decimal point;
- reject negative values, exponent notation, commas, Infinity, NaN, and empty
  strings;
- reject more than 8 fractional digits for KOIN/VHP;
- left-pad fractional part to 8 digits;
- return `BigInt(whole) * 100000000n + BigInt(fraction)`;
- enforce upper bounds before building transaction operations.

Update:

- `electron/lib/main-types.ts`
- `electron/lib/wallet-service.ts`
- `src/teleno-electron.d.ts`
- wallet modal/app state that currently stores numeric amount values
- tests that currently pass `amount: number`

If UI controls use `<input type="number">`, consider switching to text input
with decimal validation to avoid browser numeric coercion.

### 5. Apply Decimal Helper To Burn And Transfers

Replace current conversions:

- burn exact amount;
- VHP transfer amount;
- KOIN transfer amount.

Percent-based burn can remain arithmetic over integer basis points, but it
should parse the percent through a bounded decimal helper or explicit basis
point parser. Avoid `Math.floor(percent * 100)` precision surprises for user
supplied strings.

### 6. Chmod Wallet File After Rename

After `fs.renameSync(tempPath, filePath)` in `writeWalletFile`, call:

```ts
fs.chmodSync(filePath, 0o600)
```

Also ensure the secure storage directory remains `0o700` where the platform
supports POSIX permissions. Follow the existing best-effort style used by other
storage writers if Windows compatibility requires it.

### 7. Add Security Regression Tests

Add tests for:

- sandbox enabled in `BrowserWindow` options;
- CSP string exists and contains no remote script allowance in packaged mode;
- external navigation is opened externally and denied in-app;
- `parseTokenAmountToSatoshi("1.00000001") === 100000001n`;
- `parseTokenAmountToSatoshi("0.000000001")` is rejected;
- large integer token amounts do not lose precision;
- exponent notation is rejected;
- wallet write path chmods the final file after rename.

## Tests

### Unit Tests

- `electron/lib/app-lifecycle-service.test.ts`
- `electron/lib/wallet-service.test.ts`
- `electron/lib/teleno-storage.test.ts`
- type tests or compiler coverage for amount input type changes

### UI Tests

- Wallet send modal accepts valid decimal strings.
- Wallet send modal rejects too many decimal places.
- Burn modal shows clear validation text for invalid amount.
- Existing first-run wallet setup still renders and does not show funding,
  burn, registration, or signing prompts.

### Build Verification

- `npm test`
- `npm run build`
- Electron smoke with packaged entry if available

## Acceptance Criteria

- Packaged BrowserWindow runs with `sandbox: true`,
  `contextIsolation: true`, and `nodeIntegration: false`.
- Packaged app has a restrictive CSP.
- External navigation remains denied in-app and opened externally.
- Wallet amount conversion never uses `Math.floor(amount * 1e8)`.
- Wallet service accepts exact decimal strings and rejects ambiguous numeric
  formats.
- Final wallet file path is chmodded after atomic rename.
- Existing wallet encryption and file format remain readable.

## Release Gate

Before release:

1. Run `npm test`.
2. Run `npm run build`.
3. Run wallet send/burn dry-run paths against a local or testnet RPC without
   submitting live transactions.
4. Inspect packaged app window preferences and CSP behavior.
5. Confirm no logs or test artifacts contain WIF keys, seed phrases, wallet
   JSON, or protected producer information.

## Rollback Plan

If sandbox breaks packaged rendering:

- Keep CSP, decimal parsing, and chmod changes.
- Temporarily gate sandbox behind a build flag only while fixing the preload or
  dependency issue.
- Do not revert to accepting numeric token amounts once decimal parsing lands.
