// Package blockchain provides EVM blockchain integration.
package blockchain

import (
	"context"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/atlas-desktop/trading-backend/internal/backtester/events"
	"github.com/gorilla/websocket"
	"github.com/shopspring/decimal"
	"go.uber.org/zap"
)

// EVMChain represents different EVM chains
type EVMChain string

const (
	ChainEthereum EVMChain = "ethereum"
	ChainBSC      EVMChain = "bsc"
	ChainPolygon  EVMChain = "polygon"
	ChainArbitrum EVMChain = "arbitrum"
	ChainOptimism EVMChain = "optimism"
	ChainBase     EVMChain = "base"
	ChainAvalanche EVMChain = "avalanche"
)

// EVMClient provides access to EVM blockchain data
type EVMClient struct {
	mu         sync.RWMutex
	logger     *zap.Logger
	chain      EVMChain
	rpcURL     string
	wsURL      string
	httpClient *http.Client
	wsConn     *websocket.Conn
	
	// Block tracking
	currentBlock   uint64
	blockCallbacks []func(*events.BlockEvent)
	txCallbacks    []func(*events.MempoolEvent)
	
	// Connection state
	connected bool
	stopChan  chan struct{}
}

// EVMConfig holds EVM client configuration
type EVMConfig struct {
	Chain  EVMChain
	RPCURL string
	WSURL  string
}

// NewEVMClient creates a new EVM client
func NewEVMClient(logger *zap.Logger, config *EVMConfig) *EVMClient {
	return &EVMClient{
		logger: logger,
		chain:  config.Chain,
		rpcURL: config.RPCURL,
		wsURL:  config.WSURL,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
		blockCallbacks: make([]func(*events.BlockEvent), 0),
		txCallbacks:    make([]func(*events.MempoolEvent), 0),
		stopChan:       make(chan struct{}),
	}
}

// Connect establishes WebSocket connection for real-time updates
func (c *EVMClient) Connect(ctx context.Context) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	
	if c.wsURL == "" {
		c.logger.Warn("No WebSocket URL configured, running in HTTP-only mode")
		c.connected = true
		return nil
	}
	
	dialer := websocket.Dialer{
		HandshakeTimeout: 10 * time.Second,
	}
	
	conn, _, err := dialer.DialContext(ctx, c.wsURL, nil)
	if err != nil {
		return fmt.Errorf("failed to connect to EVM WS: %w", err)
	}
	
	c.wsConn = conn
	c.connected = true
	
	// Subscribe to new blocks
	if err := c.subscribeToBlocks(); err != nil {
		c.wsConn.Close()
		c.connected = false
		return fmt.Errorf("failed to subscribe to blocks: %w", err)
	}
	
	// Start message handler
	go c.handleMessages()
	
	c.logger.Info("Connected to EVM chain",
		zap.String("chain", string(c.chain)),
		zap.String("url", c.wsURL),
	)
	return nil
}

// Disconnect closes the WebSocket connection
func (c *EVMClient) Disconnect() {
	c.mu.Lock()
	defer c.mu.Unlock()
	
	close(c.stopChan)
	
	if c.wsConn != nil {
		c.wsConn.Close()
		c.wsConn = nil
	}
	
	c.connected = false
	c.logger.Info("Disconnected from EVM chain", zap.String("chain", string(c.chain)))
}

// IsConnected returns connection status
func (c *EVMClient) IsConnected() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.connected
}

// GetCurrentBlock returns the current block number
func (c *EVMClient) GetCurrentBlock() uint64 {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.currentBlock
}

// OnBlock registers a callback for new block events
func (c *EVMClient) OnBlock(callback func(*events.BlockEvent)) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.blockCallbacks = append(c.blockCallbacks, callback)
}

// OnTransaction registers a callback for new transaction events
func (c *EVMClient) OnTransaction(callback func(*events.MempoolEvent)) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.txCallbacks = append(c.txCallbacks, callback)
}

// GetBlockNumber fetches the current block number
func (c *EVMClient) GetBlockNumber(ctx context.Context) (uint64, error) {
	resp, err := c.rpcCall(ctx, "eth_blockNumber", []interface{}{})
	if err != nil {
		return 0, err
	}
	
	result, ok := resp["result"].(string)
	if !ok {
		return 0, fmt.Errorf("invalid response format")
	}
	
	return hexToUint64(result), nil
}

// GetBlock fetches a block by number
func (c *EVMClient) GetBlock(ctx context.Context, blockNumber uint64) (*events.BlockEvent, error) {
	blockHex := fmt.Sprintf("0x%x", blockNumber)
	
	resp, err := c.rpcCall(ctx, "eth_getBlockByNumber", []interface{}{blockHex, false})
	if err != nil {
		return nil, err
	}
	
	result, ok := resp["result"].(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("invalid response format")
	}
	
	timestamp := hexToUint64(result["timestamp"].(string))
	gasUsed := hexToUint64(result["gasUsed"].(string))
	
	var baseFee uint64
	if bf, ok := result["baseFeePerGas"].(string); ok {
		baseFee = hexToUint64(bf)
	}
	
	txCount := 0
	if txs, ok := result["transactions"].([]interface{}); ok {
		txCount = len(txs)
	}
	
	return &events.BlockEvent{
		BaseEvent: events.BaseEvent{
			Type:      events.EventTypeBlock,
			Timestamp: time.Unix(int64(timestamp), 0),
			Priority:  1,
		},
		Chain:       string(c.chain),
		BlockNumber: blockNumber,
		BlockHash:   result["hash"].(string),
		ParentHash:  result["parentHash"].(string),
		Timestamp:   time.Unix(int64(timestamp), 0),
		TxCount:     txCount,
		GasUsed:     gasUsed,
		BaseFee:     baseFee,
	}, nil
}

// GetTransaction fetches a transaction by hash
func (c *EVMClient) GetTransaction(ctx context.Context, txHash string) (*events.MempoolEvent, error) {
	resp, err := c.rpcCall(ctx, "eth_getTransactionByHash", []interface{}{txHash})
	if err != nil {
		return nil, err
	}
	
	result, ok := resp["result"].(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("transaction not found")
	}
	
	var value decimal.Decimal
	if v, ok := result["value"].(string); ok {
		value = hexToDecimal(v)
	}
	
	var gasPrice uint64
	if gp, ok := result["gasPrice"].(string); ok {
		gasPrice = hexToUint64(gp)
	}
	
	var gasLimit uint64
	if gl, ok := result["gas"].(string); ok {
		gasLimit = hexToUint64(gl)
	}
	
	from := ""
	if f, ok := result["from"].(string); ok {
		from = f
	}
	
	to := ""
	if t, ok := result["to"].(string); ok {
		to = t
	}
	
	return &events.MempoolEvent{
		BaseEvent: events.BaseEvent{
			Type:      events.EventTypeMempool,
			Timestamp: time.Now(),
			Priority:  2,
		},
		TxHash:   txHash,
		From:     from,
		To:       to,
		Value:    value,
		GasPrice: gasPrice,
		GasLimit: gasLimit,
	}, nil
}

// GetBalance fetches ETH/native token balance
func (c *EVMClient) GetBalance(ctx context.Context, address string) (decimal.Decimal, error) {
	resp, err := c.rpcCall(ctx, "eth_getBalance", []interface{}{address, "latest"})
	if err != nil {
		return decimal.Zero, err
	}
	
	result, ok := resp["result"].(string)
	if !ok {
		return decimal.Zero, fmt.Errorf("invalid response format")
	}
	
	// Convert from wei to ether
	wei := hexToBigInt(result)
	weiDecimal := decimal.NewFromBigInt(wei, 0)
	return weiDecimal.Div(decimal.NewFromFloat(1e18)), nil
}

// GetTokenBalance fetches ERC20 token balance
func (c *EVMClient) GetTokenBalance(ctx context.Context, tokenAddress, walletAddress string) (decimal.Decimal, error) {
	// balanceOf(address) function selector
	data := "0x70a08231" + padAddress(walletAddress)
	
	resp, err := c.rpcCall(ctx, "eth_call", []interface{}{
		map[string]string{
			"to":   tokenAddress,
			"data": data,
		},
		"latest",
	})
	if err != nil {
		return decimal.Zero, err
	}
	
	result, ok := resp["result"].(string)
	if !ok {
		return decimal.Zero, fmt.Errorf("invalid response format")
	}
	
	balance := hexToBigInt(result)
	return decimal.NewFromBigInt(balance, 0), nil
}

// subscribeToBlocks subscribes to new block headers
func (c *EVMClient) subscribeToBlocks() error {
	msg := map[string]interface{}{
		"jsonrpc": "2.0",
		"id":      1,
		"method":  "eth_subscribe",
		"params":  []string{"newHeads"},
	}
	
	return c.wsConn.WriteJSON(msg)
}

// SubscribeToPendingTx subscribes to pending transactions (mempool)
func (c *EVMClient) SubscribeToPendingTx() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	
	if c.wsConn == nil {
		return fmt.Errorf("not connected")
	}
	
	msg := map[string]interface{}{
		"jsonrpc": "2.0",
		"id":      2,
		"method":  "eth_subscribe",
		"params":  []string{"newPendingTransactions"},
	}
	
	return c.wsConn.WriteJSON(msg)
}

// handleMessages processes incoming WebSocket messages
func (c *EVMClient) handleMessages() {
	for {
		select {
		case <-c.stopChan:
			return
		default:
			_, message, err := c.wsConn.ReadMessage()
			if err != nil {
				c.logger.Error("WebSocket read error", zap.Error(err))
				c.mu.Lock()
				c.connected = false
				c.mu.Unlock()
				return
			}
			
			c.processMessage(message)
		}
	}
}

// processMessage handles a single WebSocket message
func (c *EVMClient) processMessage(message []byte) {
	var msg map[string]interface{}
	if err := json.Unmarshal(message, &msg); err != nil {
		c.logger.Warn("Failed to parse message", zap.Error(err))
		return
	}
	
	// Check for subscription notification
	if method, ok := msg["method"].(string); ok && method == "eth_subscription" {
		params, ok := msg["params"].(map[string]interface{})
		if !ok {
			return
		}
		
		result, ok := params["result"].(map[string]interface{})
		if !ok {
			// Might be a pending tx hash
			if txHash, ok := params["result"].(string); ok {
				c.handlePendingTx(txHash)
			}
			return
		}
		
		// New block header
		c.handleNewBlock(result)
	}
}

// handleNewBlock processes a new block notification
func (c *EVMClient) handleNewBlock(block map[string]interface{}) {
	blockNumber := hexToUint64(block["number"].(string))
	
	c.mu.Lock()
	c.currentBlock = blockNumber
	callbacks := make([]func(*events.BlockEvent), len(c.blockCallbacks))
	copy(callbacks, c.blockCallbacks)
	c.mu.Unlock()
	
	timestamp := hexToUint64(block["timestamp"].(string))
	gasUsed := hexToUint64(block["gasUsed"].(string))
	
	var baseFee uint64
	if bf, ok := block["baseFeePerGas"].(string); ok {
		baseFee = hexToUint64(bf)
	}
	
	blockEvent := &events.BlockEvent{
		BaseEvent: events.BaseEvent{
			Type:      events.EventTypeBlock,
			Timestamp: time.Unix(int64(timestamp), 0),
			Priority:  1,
		},
		Chain:       string(c.chain),
		BlockNumber: blockNumber,
		BlockHash:   block["hash"].(string),
		ParentHash:  block["parentHash"].(string),
		Timestamp:   time.Unix(int64(timestamp), 0),
		GasUsed:     gasUsed,
		BaseFee:     baseFee,
	}
	
	// Notify callbacks
	for _, cb := range callbacks {
		go cb(blockEvent)
	}
}

// handlePendingTx processes a pending transaction notification
func (c *EVMClient) handlePendingTx(txHash string) {
	c.mu.RLock()
	callbacks := make([]func(*events.MempoolEvent), len(c.txCallbacks))
	copy(callbacks, c.txCallbacks)
	c.mu.RUnlock()
	
	if len(callbacks) == 0 {
		return
	}
	
	// Fetch full transaction details
	tx, err := c.GetTransaction(context.Background(), txHash)
	if err != nil {
		return
	}
	
	// Check for potential MEV
	tx.IsPotentialMEV = c.checkMEVIndicators(tx)
	
	// Notify callbacks
	for _, cb := range callbacks {
		go cb(tx)
	}
}

// checkMEVIndicators checks if a transaction might be MEV-related
func (c *EVMClient) checkMEVIndicators(tx *events.MempoolEvent) bool {
	// High gas price might indicate MEV
	// This is a simplified check - production would be more sophisticated
	avgGasPrice := uint64(30e9) // 30 gwei average
	
	if tx.GasPrice > avgGasPrice*2 {
		return true
	}
	
	// Check for known DEX router addresses
	dexRouters := []string{
		"0x7a250d5630b4cf539739df2c5dacb4c659f2488d", // Uniswap V2
		"0xe592427a0aece92de3edee1f18e0157c05861564", // Uniswap V3
		"0xd9e1ce17f2641f24ae83637ab66a2cca9c378b9f", // SushiSwap
	}
	
	toLower := strings.ToLower(tx.To)
	for _, router := range dexRouters {
		if toLower == router {
			return true
		}
	}
	
	return false
}

// rpcCall makes an RPC call to the EVM node
func (c *EVMClient) rpcCall(ctx context.Context, method string, params interface{}) (map[string]interface{}, error) {
	request := map[string]interface{}{
		"jsonrpc": "2.0",
		"id":      1,
		"method":  method,
		"params":  params,
	}
	
	reqBytes, err := json.Marshal(request)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}
	
	req, err := http.NewRequestWithContext(ctx, "POST", c.rpcURL, 
		strings.NewReader(string(reqBytes)))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()
	
	var result map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}
	
	// Check for error
	if errObj, ok := result["error"].(map[string]interface{}); ok {
		return nil, fmt.Errorf("RPC error: %v", errObj["message"])
	}
	
	return result, nil
}

// Helper functions

func hexToUint64(hex string) uint64 {
	hex = strings.TrimPrefix(hex, "0x")
	val, _ := new(big.Int).SetString(hex, 16)
	if val == nil {
		return 0
	}
	return val.Uint64()
}

func hexToBigInt(hex string) *big.Int {
	hex = strings.TrimPrefix(hex, "0x")
	val, _ := new(big.Int).SetString(hex, 16)
	if val == nil {
		return big.NewInt(0)
	}
	return val
}

func hexToDecimal(hex string) decimal.Decimal {
	bi := hexToBigInt(hex)
	return decimal.NewFromBigInt(bi, 0)
}

func padAddress(address string) string {
	address = strings.TrimPrefix(address, "0x")
	return strings.Repeat("0", 64-len(address)) + address
}
