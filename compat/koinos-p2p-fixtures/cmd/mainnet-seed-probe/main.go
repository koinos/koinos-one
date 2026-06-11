package main

import (
	"context"
	"encoding/hex"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	koinosrpc "github.com/koinos/koinos-p2p/internal/rpc"
	libp2p "github.com/libp2p/go-libp2p"
	gorpc "github.com/libp2p/go-libp2p-gorpc"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/multiformats/go-multiaddr"
)

type probeResult struct {
	addr            string
	ok              bool
	connectedAt     time.Duration
	protocolVersion string
	peerRPC         bool
	chainIDHex      string
	headHeight      uint64
	headIDHex       string
	lastError       error
}

func main() {
	attempts := flag.Int("attempts", 3, "dial attempts per peer")
	timeout := flag.Duration("timeout", 8*time.Second, "timeout per attempt")
	delay := flag.Duration("delay", 5*time.Second, "delay between attempts")
	listen := flag.String("listen", "/ip4/127.0.0.1/tcp/0", "local listen multiaddr")
	requirePeerRPC := flag.Bool("peer-rpc", true, "require Koinos Peer RPC GetChainID and GetHeadBlock to succeed")
	validatedOutput := flag.String("validated-output", "", "optional path to write peers that passed validation")
	flag.Parse()

	peers := flag.Args()
	if len(peers) == 0 {
		fmt.Fprintln(os.Stderr, "usage: mainnet-seed-probe [flags] <multiaddr> [multiaddr...]")
		os.Exit(2)
	}

	anyOK := false
	okPeers := make([]probeResult, 0)
	for _, raw := range peers {
		result := probePeer(raw, *attempts, *timeout, *delay, *listen, *requirePeerRPC)
		if result.ok {
			anyOK = true
			okPeers = append(okPeers, result)
			fmt.Printf("OK %s elapsed=%s protocol_version=%s peer_rpc=%t chain_id=%s head_height=%d head_id=%s\n",
				result.addr,
				result.connectedAt.Round(time.Millisecond),
				result.protocolVersion,
				result.peerRPC,
				result.chainIDHex,
				result.headHeight,
				result.headIDHex)
			continue
		}

		fmt.Printf("FAIL %s error=%v\n", result.addr, result.lastError)
	}

	if *validatedOutput != "" {
		if err := writeValidatedOutput(*validatedOutput, okPeers, *requirePeerRPC); err != nil {
			fmt.Fprintf(os.Stderr, "write validated output: %v\n", err)
			os.Exit(1)
		}
	}

	if !anyOK {
		os.Exit(1)
	}
}

func probePeer(raw string, attempts int, timeout time.Duration, delay time.Duration, listen string, requirePeerRPC bool) probeResult {
	result := probeResult{addr: raw}

	ma, err := multiaddr.NewMultiaddr(raw)
	if err != nil {
		result.lastError = fmt.Errorf("parse multiaddr: %w", err)
		return result
	}

	info, err := peer.AddrInfoFromP2pAddr(ma)
	if err != nil {
		result.lastError = fmt.Errorf("parse peer addr info: %w", err)
		return result
	}

	if attempts < 1 {
		attempts = 1
	}

	for i := 0; i < attempts; i++ {
		if i > 0 {
			time.Sleep(delay)
		}

		ctx, cancel := context.WithTimeout(context.Background(), timeout)
		host, err := libp2p.New(
			libp2p.ListenAddrStrings(listen),
			libp2p.ProtocolVersion("koinos/p2p/1.0.0"),
		)
		if err != nil {
			cancel()
			result.lastError = fmt.Errorf("create host: %w", err)
			continue
		}

		start := time.Now()
		err = host.Connect(ctx, *info)
		if err == nil {
			result.connectedAt = time.Since(start)
			if protocolVersion, err := host.Peerstore().Get(info.ID, "ProtocolVersion"); err == nil {
				if version, ok := protocolVersion.(string); ok {
					result.protocolVersion = version
				}
			}
			if strings.TrimSpace(result.protocolVersion) == "" {
				result.protocolVersion = "unknown"
			}

			if requirePeerRPC {
				if err := probePeerRPC(ctx, host, info.ID, &result); err != nil {
					result.lastError = err
				} else {
					result.ok = true
				}
			} else {
				result.ok = true
			}
		} else {
			result.lastError = err
		}

		host.Close()
		cancel()
		if result.ok {
			return result
		}
	}

	return result
}

func probePeerRPC(ctx context.Context, h host.Host, peerID peer.ID, result *probeResult) error {
	client := gorpc.NewClient(h, koinosrpc.PeerRPCID)
	peerRPC := koinosrpc.NewPeerRPC(client, peerID)

	chainID, err := peerRPC.GetChainID(ctx)
	if err != nil {
		return fmt.Errorf("peer rpc GetChainID: %w", err)
	}

	headID, headHeight, err := peerRPC.GetHeadBlock(ctx)
	if err != nil {
		return fmt.Errorf("peer rpc GetHeadBlock: %w", err)
	}

	if len(chainID) == 0 {
		return fmt.Errorf("peer rpc GetChainID returned empty chain ID")
	}
	if len(headID) == 0 || headHeight == 0 {
		return fmt.Errorf("peer rpc GetHeadBlock returned empty head")
	}

	result.peerRPC = true
	result.chainIDHex = "0x" + hex.EncodeToString(chainID)
	result.headHeight = headHeight
	result.headIDHex = "0x" + hex.EncodeToString(headID)
	return nil
}

func writeValidatedOutput(path string, peers []probeResult, requirePeerRPC bool) error {
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}

	criteria := "libp2p dial"
	if requirePeerRPC {
		criteria += " + Koinos Peer RPC GetChainID/GetHeadBlock"
	}

	var builder strings.Builder
	builder.WriteString("# Mainnet peers validated by cmd/mainnet-seed-probe.\n")
	builder.WriteString("# Generated: ")
	builder.WriteString(time.Now().UTC().Format(time.RFC3339))
	builder.WriteString("\n")
	builder.WriteString("# Criteria: ")
	builder.WriteString(criteria)
	builder.WriteString("\n")
	if len(peers) == 0 {
		builder.WriteString("# No peers passed validation in this run.\n")
	} else {
		for _, peer := range peers {
			builder.WriteString(peer.addr)
			builder.WriteString("\n")
		}
	}

	return os.WriteFile(path, []byte(builder.String()), 0644)
}
