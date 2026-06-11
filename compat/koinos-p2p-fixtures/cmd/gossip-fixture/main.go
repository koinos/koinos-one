package main

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"sync/atomic"
	"syscall"
	"time"

	p2ptopics "github.com/koinos/koinos-p2p/internal/p2p"
	"github.com/koinos/koinos-proto-golang/v2/koinos/protocol"
	libp2p "github.com/libp2p/go-libp2p"
	pubsub "github.com/libp2p/go-libp2p-pubsub"
	pb "github.com/libp2p/go-libp2p-pubsub/pb"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/multiformats/go-multiaddr"
	"google.golang.org/protobuf/proto"
)

func blockAtHeight(height uint64) *protocol.Block {
	id := []byte(fmt.Sprintf("go-block-%d", height))
	previous := []byte(fmt.Sprintf("go-block-%d", height-1))
	if height == 1 {
		previous = []byte("genesis")
	}
	return &protocol.Block{
		Id: id,
		Header: &protocol.BlockHeader{
			Previous: previous,
			Height:   height,
		},
	}
}

func transactionWithID(id string) *protocol.Transaction {
	return &protocol.Transaction{Id: []byte(id)}
}

func peerAddrInfo(h host.Host) (string, error) {
	for _, addr := range h.Addrs() {
		return fmt.Sprintf("%s/p2p/%s", addr.String(), h.ID().String()), nil
	}
	return "", fmt.Errorf("host has no listen addresses")
}

func generateMessageID(msg *pb.Message) string {
	switch *msg.Topic {
	case p2ptopics.BlockTopicName, p2ptopics.TransactionTopicName:
		sum := sha256.Sum256(msg.Data)
		return base64.RawStdEncoding.EncodeToString(sum[:])
	default:
		return pubsub.DefaultMsgIdFn(msg)
	}
}

func subscribeBlocks(ctx context.Context, topic *pubsub.Topic, seen *atomic.Bool) error {
	sub, err := topic.Subscribe()
	if err != nil {
		return err
	}
	go func() {
		defer sub.Cancel()
		for {
			msg, err := sub.Next(ctx)
			if err != nil {
				return
			}
			block := &protocol.Block{}
			if proto.Unmarshal(msg.Data, block) == nil && string(block.Id) == "cpp-block-77" {
				fmt.Println("fixture received cpp block")
				seen.Store(true)
			}
		}
	}()
	return nil
}

func subscribeTransactions(ctx context.Context, topic *pubsub.Topic, seen *atomic.Bool) error {
	sub, err := topic.Subscribe()
	if err != nil {
		return err
	}
	go func() {
		defer sub.Cancel()
		for {
			msg, err := sub.Next(ctx)
			if err != nil {
				return
			}
			tx := &protocol.Transaction{}
			if proto.Unmarshal(msg.Data, tx) == nil && string(tx.Id) == "cpp-tx-77" {
				fmt.Println("fixture received cpp transaction")
				seen.Store(true)
			}
		}
	}()
	return nil
}

func main() {
	peerAddr := flag.String("peer", "", "optional peer multiaddr to dial")
	flag.Parse()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	listen, err := multiaddr.NewMultiaddr("/ip4/127.0.0.1/tcp/0")
	if err != nil {
		panic(err)
	}

	host, err := libp2p.New(libp2p.ListenAddrs(listen))
	if err != nil {
		panic(err)
	}
	defer host.Close()

	ps, err := pubsub.NewGossipSub(
		ctx,
		host,
		pubsub.WithMessageIdFn(generateMessageID),
		pubsub.WithPeerExchange(true),
		pubsub.WithMessageSignaturePolicy(pubsub.StrictSign),
		pubsub.WithFloodPublish(true),
	)
	if err != nil {
		panic(err)
	}

	blockTopic, err := ps.Join(p2ptopics.BlockTopicName)
	if err != nil {
		panic(err)
	}
	txTopic, err := ps.Join(p2ptopics.TransactionTopicName)
	if err != nil {
		panic(err)
	}
	defer blockTopic.Close()
	defer txTopic.Close()

	var sawCPPBlock atomic.Bool
	var sawCPPTx atomic.Bool
	if err := subscribeBlocks(ctx, blockTopic, &sawCPPBlock); err != nil {
		panic(err)
	}
	if err := subscribeTransactions(ctx, txTopic, &sawCPPTx); err != nil {
		panic(err)
	}

	if *peerAddr != "" {
		ma, err := multiaddr.NewMultiaddr(*peerAddr)
		if err != nil {
			panic(err)
		}
		info, err := peer.AddrInfoFromP2pAddr(ma)
		if err != nil {
			panic(err)
		}
		if err := host.Connect(ctx, *info); err != nil {
			panic(err)
		}
	}

	addr, err := peerAddrInfo(host)
	if err != nil {
		panic(err)
	}
	fmt.Println(addr)

	go func() {
		blockBytes, _ := proto.Marshal(blockAtHeight(33))
		txBytes, _ := proto.Marshal(transactionWithID("go-tx-33"))
		ticker := time.NewTicker(500 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				_ = blockTopic.Publish(ctx, blockBytes)
				_ = txTopic.Publish(ctx, txBytes)
			case <-ctx.Done():
				return
			}
		}
	}()

	deadline := time.After(15 * time.Second)
	for {
		if sawCPPBlock.Load() && sawCPPTx.Load() {
			fmt.Println("gossip fixture interop ok")
			return
		}
		select {
		case <-time.After(100 * time.Millisecond):
		case <-deadline:
			fmt.Fprintln(os.Stderr, "timed out waiting for cpp gossip")
			os.Exit(1)
		case <-ctx.Done():
			return
		}
	}
}
