package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"sync"
	"syscall"

	"github.com/koinos/koinos-p2p/internal/rpc"
	"github.com/koinos/koinos-proto-golang/v2/koinos"
	"github.com/koinos/koinos-proto-golang/v2/koinos/protocol"
	"github.com/koinos/koinos-proto-golang/v2/koinos/rpc/block_store"
	"github.com/koinos/koinos-proto-golang/v2/koinos/rpc/chain"
	libp2p "github.com/libp2p/go-libp2p"
	gorpc "github.com/libp2p/go-libp2p-gorpc"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/multiformats/go-multiaddr"
	"github.com/multiformats/go-multihash"
)

type fixtureRPC struct {
	mu     sync.Mutex
	height uint64
}

func blockIDAtHeight(height uint64) multihash.Multihash {
	id, err := multihash.Encode([]byte{}, height)
	if err != nil {
		panic(err)
	}
	return id
}

func topologyAtHeight(height uint64) *koinos.BlockTopology {
	topology := &koinos.BlockTopology{
		Id:     blockIDAtHeight(height),
		Height: height,
	}
	if height > 1 {
		topology.Previous = blockIDAtHeight(height - 1)
	}
	return topology
}

func blockAtHeight(height uint64) *protocol.Block {
	topology := topologyAtHeight(height)
	return &protocol.Block{
		Id: topology.Id,
		Header: &protocol.BlockHeader{
			Previous: topology.Previous,
			Height:   height,
		},
	}
}

func (f *fixtureRPC) GetHeadBlock(ctx context.Context) (*chain.GetHeadInfoResponse, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return &chain.GetHeadInfoResponse{HeadTopology: topologyAtHeight(f.height)}, nil
}

func (f *fixtureRPC) ApplyBlock(ctx context.Context, block *protocol.Block) (*chain.SubmitBlockResponse, error) {
	return &chain.SubmitBlockResponse{}, nil
}

func (f *fixtureRPC) ApplyTransaction(ctx context.Context, tx *protocol.Transaction) (*chain.SubmitTransactionResponse, error) {
	return &chain.SubmitTransactionResponse{}, nil
}

func (f *fixtureRPC) GetBlocksByHeight(ctx context.Context, headID multihash.Multihash, height uint64, numBlocks uint32) (*block_store.GetBlocksByHeightResponse, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	response := &block_store.GetBlocksByHeightResponse{}
	for i := uint64(0); i < uint64(numBlocks); i++ {
		blockHeight := height + i
		if blockHeight > f.height {
			break
		}
		block := blockAtHeight(blockHeight)
		response.BlockItems = append(response.BlockItems, &block_store.BlockItem{
			BlockId:     block.Id,
			BlockHeight: block.Header.Height,
			Block:       block,
		})
	}
	return response, nil
}

func (f *fixtureRPC) GetChainID(ctx context.Context) (*chain.GetChainIdResponse, error) {
	chainID, err := multihash.Encode([]byte{}, 1)
	if err != nil {
		return nil, err
	}
	return &chain.GetChainIdResponse{ChainId: chainID}, nil
}

func (f *fixtureRPC) GetForkHeads(ctx context.Context) (*chain.GetForkHeadsResponse, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return &chain.GetForkHeadsResponse{
		ForkHeads:             []*koinos.BlockTopology{topologyAtHeight(f.height)},
		LastIrreversibleBlock: topologyAtHeight(1),
	}, nil
}

func (f *fixtureRPC) GetBlocksByID(ctx context.Context, blockIDs []multihash.Multihash) (*block_store.GetBlocksByIdResponse, error) {
	response := &block_store.GetBlocksByIdResponse{}
	for _, id := range blockIDs {
		response.BlockItems = append(response.BlockItems, &block_store.BlockItem{BlockId: id})
	}
	return response, nil
}

func (f *fixtureRPC) BroadcastGossipStatus(ctx context.Context, enabled bool) error {
	return nil
}

func (f *fixtureRPC) IsConnectedToBlockStore(ctx context.Context) (bool, error) {
	return true, nil
}

func (f *fixtureRPC) IsConnectedToChain(ctx context.Context) (bool, error) {
	return true, nil
}

func main() {
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

	server := gorpc.NewServer(host, rpc.PeerRPCID)
	if err := server.Register(rpc.NewPeerRPCService(&fixtureRPC{height: 12})); err != nil {
		panic(err)
	}

	addrs, err := peerAddrInfo(host)
	if err != nil {
		panic(err)
	}

	fmt.Println(addrs)
	<-ctx.Done()
}

func peerAddrInfo(h host.Host) (string, error) {
	for _, addr := range h.Addrs() {
		return fmt.Sprintf("%s/p2p/%s", addr.String(), h.ID().String()), nil
	}
	return "", fmt.Errorf("host has no listen addresses")
}
