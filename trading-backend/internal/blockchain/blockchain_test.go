// Package blockchain_test provides tests for blockchain clients.
package blockchain_test

import (
	"context"
	"testing"
	"time"

	"github.com/atlas-desktop/trading-backend/internal/blockchain"
	"go.uber.org/zap"
)

// Note: These tests require network access to public RPC endpoints.
// They're designed to be skipped in CI without connectivity.

func TestSolanaClientCreation(t *testing.T) {
	logger := zap.NewNop()
	
	client := blockchain.NewSolanaClient(logger, blockchain.SolanaConfig{
		RPCURL:    "https://api.mainnet-beta.solana.com",
		WSURL:     "wss://api.mainnet-beta.solana.com",
		RateLimit: 10,
	})
	
	if client == nil {
		t.Fatal("Client is nil")
	}
}

func TestSolanaGetSlot(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping network test in short mode")
	}
	
	logger := zap.NewNop()
	
	client := blockchain.NewSolanaClient(logger, blockchain.SolanaConfig{
		RPCURL:    "https://api.mainnet-beta.solana.com",
		RateLimit: 5, // Conservative rate limit
	})
	
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	
	slot, err := client.GetSlot(ctx)
	if err != nil {
		t.Skipf("Network error (expected in offline testing): %v", err)
	}
	
	// Solana slot should be a very large number
	if slot < 100000000 {
		t.Errorf("Slot seems too low: %d", slot)
	}
	
	t.Logf("Current Solana slot: %d", slot)
}

func TestSolanaGetBalance(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping network test in short mode")
	}
	
	logger := zap.NewNop()
	
	client := blockchain.NewSolanaClient(logger, blockchain.SolanaConfig{
		RPCURL:    "https://api.mainnet-beta.solana.com",
		RateLimit: 5,
	})
	
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	
	// Query a known rich address (Solana Foundation)
	address := "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS"
	
	balance, err := client.GetBalance(ctx, address)
	if err != nil {
		t.Skipf("Network error (expected in offline testing): %v", err)
	}
	
	t.Logf("Balance of %s: %s SOL", address, balance)
}

func TestEVMClientCreation(t *testing.T) {
	logger := zap.NewNop()
	
	configs := map[string]blockchain.EVMConfig{
		"ethereum": {RPCURL: "https://eth.llamarpc.com", ChainID: 1},
		"polygon":  {RPCURL: "https://polygon-rpc.com", ChainID: 137},
		"arbitrum": {RPCURL: "https://arb1.arbitrum.io/rpc", ChainID: 42161},
	}
	
	for name, config := range configs {
		client := blockchain.NewEVMClient(logger, name, config)
		if client == nil {
			t.Errorf("Client for %s is nil", name)
		}
	}
}

func TestEVMGetBlockNumber(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping network test in short mode")
	}
	
	logger := zap.NewNop()
	
	client := blockchain.NewEVMClient(logger, "ethereum", blockchain.EVMConfig{
		RPCURL:    "https://eth.llamarpc.com",
		ChainID:   1,
		RateLimit: 5,
	})
	
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	
	blockNum, err := client.GetBlockNumber(ctx)
	if err != nil {
		t.Skipf("Network error (expected in offline testing): %v", err)
	}
	
	// Ethereum block number should be in the millions
	if blockNum < 15000000 {
		t.Errorf("Block number seems too low: %d", blockNum)
	}
	
	t.Logf("Current Ethereum block: %d", blockNum)
}

func TestEVMGetBalance(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping network test in short mode")
	}
	
	logger := zap.NewNop()
	
	client := blockchain.NewEVMClient(logger, "ethereum", blockchain.EVMConfig{
		RPCURL:    "https://eth.llamarpc.com",
		ChainID:   1,
		RateLimit: 5,
	})
	
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	
	// Query Vitalik's address
	address := "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
	
	balance, err := client.GetBalance(ctx, address)
	if err != nil {
		t.Skipf("Network error (expected in offline testing): %v", err)
	}
	
	t.Logf("Balance of %s: %s ETH", address, balance)
}

func TestMultiChainSupport(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping network test in short mode")
	}
	
	logger := zap.NewNop()
	
	chains := []struct {
		name    string
		config  blockchain.EVMConfig
		address string
	}{
		{
			name:    "ethereum",
			config:  blockchain.EVMConfig{RPCURL: "https://eth.llamarpc.com", ChainID: 1, RateLimit: 3},
			address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
		},
		{
			name:    "polygon",
			config:  blockchain.EVMConfig{RPCURL: "https://polygon-rpc.com", ChainID: 137, RateLimit: 3},
			address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
		},
	}
	
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	
	for _, chain := range chains {
		client := blockchain.NewEVMClient(logger, chain.name, chain.config)
		
		blockNum, err := client.GetBlockNumber(ctx)
		if err != nil {
			t.Logf("%s: network error (expected in offline testing): %v", chain.name, err)
			continue
		}
		
		t.Logf("%s: current block %d", chain.name, blockNum)
	}
}

func TestDEXDetection(t *testing.T) {
	logger := zap.NewNop()
	
	client := blockchain.NewEVMClient(logger, "ethereum", blockchain.EVMConfig{
		RPCURL:  "https://eth.llamarpc.com",
		ChainID: 1,
	})
	
	// Known DEX router addresses
	dexRouters := []struct {
		name    string
		address string
		isDEX   bool
	}{
		{"Uniswap V2 Router", "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D", true},
		{"Uniswap V3 Router", "0xE592427A0AEce92De3Edee1F18E0157C05861564", true},
		{"SushiSwap Router", "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F", true},
		{"Random Address", "0x0000000000000000000000000000000000000001", false},
	}
	
	for _, router := range dexRouters {
		isDEX := client.IsDEXRouter(router.address)
		
		if isDEX != router.isDEX {
			t.Errorf("%s: expected isDEX=%v, got %v", router.name, router.isDEX, isDEX)
		}
	}
}

func TestMEVDetection(t *testing.T) {
	logger := zap.NewNop()
	
	client := blockchain.NewEVMClient(logger, "ethereum", blockchain.EVMConfig{
		RPCURL:  "https://eth.llamarpc.com",
		ChainID: 1,
	})
	
	// Create test transactions
	testCases := []struct {
		name          string
		tx            blockchain.EVMTransaction
		expectedScore float64
	}{
		{
			name: "Normal Transaction",
			tx: blockchain.EVMTransaction{
				Hash:     "0x1234",
				To:       "0xabcd",
				Value:    "1000000000000000000",
				GasPrice: "20000000000", // 20 gwei
			},
			expectedScore: 0, // Low risk
		},
		{
			name: "High Gas DEX Transaction",
			tx: blockchain.EVMTransaction{
				Hash:     "0x5678",
				To:       "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D", // Uniswap
				Value:    "10000000000000000000",                       // 10 ETH
				GasPrice: "500000000000",                               // 500 gwei
			},
			expectedScore: 0.5, // Higher risk
		},
	}
	
	for _, tc := range testCases {
		score := client.CalculateMEVRisk(&tc.tx)
		
		// Just verify it returns a score in valid range
		if score < 0 || score > 1 {
			t.Errorf("%s: MEV score %f out of range [0,1]", tc.name, score)
		}
		
		t.Logf("%s: MEV risk score = %f", tc.name, score)
	}
}

func TestWebSocketSubscription(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping WebSocket test in short mode")
	}
	
	// This test would require a running WebSocket endpoint
	// In production, we'd test against a local node or mock
	t.Skip("WebSocket subscription test requires running node")
}
