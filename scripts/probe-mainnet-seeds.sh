#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
P2P_DIR="$ROOT_DIR/vendor/koinos/koinos-p2p"
ATTEMPTS="${SEED_PROBE_ATTEMPTS:-3}"
TIMEOUT="${SEED_PROBE_TIMEOUT:-8s}"
DELAY="${SEED_PROBE_DELAY:-5s}"
PEER_RPC="${SEED_PROBE_PEER_RPC:-1}"
VALIDATED_OUTPUT="${SEED_PROBE_OUTPUT:-}"
P2P_PEERS_FILE="${P2P_PEERS_FILE:-$ROOT_DIR/scripts/mainnet-peer-candidates.txt}"

if [[ -n "$P2P_PEERS_FILE" && "$P2P_PEERS_FILE" != /* ]]; then
  P2P_PEERS_FILE="$ROOT_DIR/$P2P_PEERS_FILE"
fi

if [[ -n "$VALIDATED_OUTPUT" && "$VALIDATED_OUTPUT" != /* ]]; then
  VALIDATED_OUTPUT="$ROOT_DIR/$VALIDATED_OUTPUT"
fi

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<'USAGE'
usage: scripts/probe-mainnet-seeds.sh

Environment:
  P2P_PEERS            Comma-separated multiaddrs to probe. Takes precedence.
  P2P_PEERS_FILE       File containing one multiaddr per line. Comments allowed.
  SEED_PROBE_ATTEMPTS  Dial attempts per peer. Default: 3
  SEED_PROBE_TIMEOUT   Timeout per attempt. Default: 8s
  SEED_PROBE_DELAY     Delay between attempts. Default: 5s
  SEED_PROBE_PEER_RPC  Require Koinos Peer RPC GetChainID/GetHeadBlock. Default: 1
  SEED_PROBE_OUTPUT    Optional file path to write only peers that passed validation
USAGE
  exit 0
fi

DEFAULT_P2P_PEERS=(
  "/dns4/seed.koinosblocks.com/tcp/8888/p2p/QmUNURuZxSu5wLnmBNJdwGtwjLmV5JxGhu4uNSAS8ZNcze"
  "/dns4/seed.koinosfoundation.org/tcp/8888/p2p/QmZjGG6eFnLLSskbgikz956DTpPgodo5P7Dxa32qHYZBBP"
  "/dns4/seed-east.burnkoin.com/tcp/8888/p2p/QmYAC9nxqgVt2p8NvmxNFsoMpQS7c4zEBmsZndEBTRHNu4"
  "/ip4/37.27.7.221/tcp/11394/p2p/QmY8NBHwoVrxBvrjS3wQoeTmWG4UUKMxmYHss7QYRXktrs"
  "/ip4/46.62.245.240/tcp/8888/p2p/QmWmxqE6WhcMWZEKwqUAbu87Qgm6JroZLdM4Xmxouu1Mmi"
)

if [[ -n "${P2P_PEERS:-}" ]]; then
  IFS=',' read -r -a P2P_PEER_LIST <<<"$P2P_PEERS"
elif [[ -f "$P2P_PEERS_FILE" ]]; then
  P2P_PEER_LIST=()
  while IFS= read -r peer; do
    peer="${peer%%#*}"
    peer="${peer#"${peer%%[![:space:]]*}"}"
    peer="${peer%"${peer##*[![:space:]]}"}"
    [[ -n "$peer" ]] && P2P_PEER_LIST+=("$peer")
  done <"$P2P_PEERS_FILE"
else
  P2P_PEER_LIST=("${DEFAULT_P2P_PEERS[@]}")
fi

cd "$P2P_DIR"
ARGS=(
  -attempts="$ATTEMPTS"
  -timeout="$TIMEOUT"
  -delay="$DELAY"
  -peer-rpc="$PEER_RPC"
)

if [[ -n "$VALIDATED_OUTPUT" ]]; then
  ARGS+=("-validated-output=$VALIDATED_OUTPUT")
fi

go run ./cmd/mainnet-seed-probe "${ARGS[@]}" "${P2P_PEER_LIST[@]}"
