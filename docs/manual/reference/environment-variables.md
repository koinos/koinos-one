# Environment Variables

This page documents environment variables confirmed in source or current docs.
Do not add variables here unless they are implemented.

## Runtime And Safety

| Variable | Used by | Meaning |
| --- | --- | --- |
| `KOINOS_ONE_PROTECTED_MAINNET_PRODUCER_ADDRESSES` | Electron wallet service | Comma- or whitespace-separated protected mainnet producer addresses. If a selected mainnet producer address is listed, Koinos One refuses to write it into runtime producer config. |
| `KOINOS_LIBP2P_TRACE` | Native P2P transport | Any set value raises cpp-libp2p logging to trace level instead of error level. Developer diagnostics only. |
| `HOME` | Electron path helpers and native CLI | Used for `~` expansion and for the native CLI default basedir fallback. |
| `USERPROFILE` | Electron backup/path helpers on Windows | Used as a home-directory fallback for `~` expansion and backup helper paths. |

## Native Backup Developer Overrides

Koinos One can write a generated native backup config from app settings. These
variables override private remote backup settings only when
`TELENO_BACKUP_REMOTE` is enabled.

| Variable | Meaning |
| --- | --- |
| `TELENO_BACKUP_REMOTE` | Enables remote SFTP override when set to `1`, `true`, or `yes`. |
| `TELENO_BACKUP_SSH_HOST` | Required SFTP host when remote override is enabled. |
| `TELENO_BACKUP_SSH_USER` | Required SFTP user when remote override is enabled. |
| `TELENO_BACKUP_REMOTE_DIR` | Required absolute remote directory when remote override is enabled. |
| `TELENO_BACKUP_SSH_PORT` | SFTP port. Default: `22`. |
| `TELENO_BACKUP_SSH_AUTH` | Auth method: `private-key`, `password-file`, or `env-password`. Default in the Electron override path: `private-key`. |
| `TELENO_BACKUP_SSH_PRIVATE_KEY_FILE` | Private-key file path for `private-key` auth. |
| `TELENO_BACKUP_SSH_PASSWORD_FILE` | Password file path for `password-file` auth. |
| `TELENO_BACKUP_SSH_PASSWORD` | Raw password used only by native libssh when `backup.ssh.auth=env-password`. Avoid using this outside controlled developer validation. |
| `TELENO_BACKUP_SSH_PASSPHRASE_FILE` | Passphrase file path for encrypted private keys. |
| `TELENO_BACKUP_SSH_KNOWN_HOSTS_FILE` | Known-hosts file path. |
| `TELENO_BACKUP_SSH_STRICT_HOST_KEY_CHECKING` | Set to `false` to disable strict host-key checking in the generated override config. Default: strict checking enabled. |
| `TELENO_BACKUP_SSH_CONNECT_TIMEOUT_SECONDS` | SSH connect timeout. Default: `15`. |
| `TELENO_BACKUP_REMOTE_RETENTION_COUNT` | Remote retention count. Default: `14`. |
| `TELENO_BACKUP_REMOTE_RETENTION_DAYS` | Remote retention days. Default: `30`. |
| `TELENO_BACKUP_REMOTE_UPLOAD_TEMP_SUFFIX` | Remote temporary upload suffix. Default: `.partial`. |
| `TELENO_BACKUP_SMOKE_ROOT` | Native backup smoke-test root used by `scripts/smoke-native-backup-restore.sh`. |
| `TELENO_PUBLIC_BOOTSTRAP_SMOKE_ROOT` | Public bootstrap promotion smoke-test root used by `scripts/smoke-public-bootstrap-promotion.sh`. |

These variables configure private remote backup behavior. They do not turn
public bootstrap restore into public administrative control.

## Build And Packaging

| Variable | Used by | Meaning |
| --- | --- | --- |
| `KOINOS_ONE_RELEASE_CHANNEL` | `scripts/generate-build-info.js` | Explicit release channel override. Takes priority over `TELENO_RELEASE_CHANNEL`. |
| `TELENO_RELEASE_CHANNEL` | `scripts/generate-build-info.js` | Legacy release channel override when `KOINOS_ONE_RELEASE_CHANNEL` is not set. |
| `PACKAGE_STAGING_DIR` | `scripts/verify-package-staging.js` | Override the staged bundle path for package-staging verification. |
| `PACKAGE_TARGET_PLATFORM` | Package verification scripts | Override target platform detection, such as `darwin`, `macos`, `win32`, or `windows`. |
| `PACKAGED_APP_DIR` | `scripts/verify-packaged-app.js` | Override the packaged app directory to verify. |
| `APPLE_KEYCHAIN_PROFILE` | `scripts/check-notarize-credentials.js` | Notarization credential option. |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | `scripts/check-notarize-credentials.js` | Apple ID notarization credential option. |
| `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` | `scripts/check-notarize-credentials.js` | App Store Connect API notarization credential option. |

## Local Development Helpers

| Variable | Used by | Meaning |
| --- | --- | --- |
| `VITE_DEV_SERVER_URL` | Electron main process | Development renderer URL. `scripts/dev-electron.js` sets it to `http://localhost:5173`. |
| `TELENO_LAUNCH_NODE_SETTINGS_JSON` | Electron preload | JSON settings payload used by automated Electron launch flows. |
| `TELENO_API_PORT` | `backend/src/server.js` | Local backend helper port. Default: `8787`. This is not the native monolith JSON-RPC port. |
| `TELENO_DATA_DIR` | `backend/src/config.js` | Local backend helper data directory. |
| `TELENO_DB_PATH` | `backend/src/config.js` | Local backend helper SQLite database path. |
| `TELENO_BACKUP_BASE_URL` | `backend/src/config.js` | Local backend helper backup base URL. |
| `TELENO_BACKUP_URL` | `backend/src/bootstrap.js` | Local backend bootstrap backup URL override. |
| `TELENO_BACKUP_LOCAL_PATH` | `backend/src/bootstrap.js` | Local backend bootstrap archive path override. |

The backend helper variables belong to older local helper scripts. They are not
the current native backup, public bootstrap, JSON-RPC, gRPC, or P2P config
surface.
