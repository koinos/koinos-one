#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTRACTS_REPO="${PRIVATE_TESTNET_CONTRACTS_REPO:-$ROOT_DIR/vendor/koinos/koinos-contracts-as}"
OUTPUT_DIR="${PRIVATE_TESTNET_CONTRACTS_OUTPUT:-$ROOT_DIR/tools/private-testnet/contracts}"
SKIP_INSTALL="${PRIVATE_TESTNET_CONTRACTS_SKIP_INSTALL:-0}"
CONTRACTS=(koin name_service pob vhp)

die() {
  echo "error: $*" >&2
  exit 1
}

sha256_file() {
  shasum -a 256 "$1" | awk '{ print $1 }'
}

repo_commit() {
  git -C "$CONTRACTS_REPO" rev-parse HEAD 2>/dev/null || echo unknown
}

build_contract() {
  local name="$1"
  local contract_dir="$CONTRACTS_REPO/contracts/$name"

  [[ -d "$contract_dir" ]] || die "missing contract directory: $contract_dir"
  [[ -f "$contract_dir/package.json" ]] || die "missing package.json: $contract_dir/package.json"

  if [[ "$SKIP_INSTALL" != "1" ]]; then
    ( cd "$contract_dir" && yarn install --frozen-lockfile )
  fi

  if [[ "$name" == "vhp" ]]; then
    # The upstream VHP script invokes protoc without include paths even though
    # its proto imports koinos/options.proto. Keep the workaround explicit.
    (
      cd "$contract_dir"
      ./node_modules/.bin/protoc \
        -I. \
        -I../.. \
        -Inode_modules/@koinos/sdk-as-cli/__template__ \
        --plugin=protoc-gen-as=./node_modules/.bin/as-proto-gen \
        --as_out=. \
        assembly/proto/*.proto
      ./node_modules/.bin/koinos-sdk-as-cli build release
    )
  else
    ( cd "$contract_dir" && yarn build:release )
  fi

  local wasm="$contract_dir/build/release/contract.wasm"
  local abi="$contract_dir/abi/$name.abi"
  [[ -f "$wasm" ]] || die "missing built WASM: $wasm"
  [[ -f "$abi" ]] || die "missing ABI: $abi"

  local dest="$OUTPUT_DIR/$name"
  mkdir -p "$dest"
  cp "$wasm" "$dest/contract.wasm"
  cp "$abi" "$dest/$name.abi"
}

write_manifest() {
  mkdir -p "$OUTPUT_DIR"

  local manifest="$OUTPUT_DIR/manifest.json"
  {
    printf '{\n'
    printf '  "sourceRepository": "https://github.com/koinos/koinos-contracts-as",\n'
    printf '  "sourceCommit": "%s",\n' "$(repo_commit)"
    printf '  "generatedAt": "%s",\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    printf '  "contracts": {\n'
    local first=1
    local name
    for name in "${CONTRACTS[@]}"; do
      local wasm="$OUTPUT_DIR/$name/contract.wasm"
      local abi="$OUTPUT_DIR/$name/$name.abi"
      [[ -f "$wasm" ]] || die "missing staged WASM: $wasm"
      [[ -f "$abi" ]] || die "missing staged ABI: $abi"
      if [[ "$first" == "1" ]]; then
        first=0
      else
        printf ',\n'
      fi
      printf '    "%s": {\n' "$name"
      printf '      "wasm": "%s/contract.wasm",\n' "$name"
      printf '      "abi": "%s/%s.abi",\n' "$name" "$name"
      printf '      "wasmBytes": %s,\n' "$(wc -c < "$wasm" | tr -d ' ')"
      printf '      "wasmSha256": "%s"\n' "$(sha256_file "$wasm")"
      printf '    }'
    done
    printf '\n  }\n'
    printf '}\n'
  } > "$manifest"

  echo "$manifest"
}

[[ -d "$CONTRACTS_REPO" ]] || die "missing contracts repo: $CONTRACTS_REPO"
command -v yarn >/dev/null 2>&1 || die "missing yarn"
command -v shasum >/dev/null 2>&1 || die "missing shasum"

for contract in "${CONTRACTS[@]}"; do
  build_contract "$contract"
done

manifest="$(write_manifest)"
echo "private testnet contracts built: output=$OUTPUT_DIR manifest=$manifest"
