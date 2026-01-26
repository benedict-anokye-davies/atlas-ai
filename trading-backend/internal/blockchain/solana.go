// Package blockchain provides Solana blockchain integration.
package blockchain

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/atlas-desktop/trading-backend/internal/backtester/events"
	"github.com/gorilla/websocket"
	"github.com/shopspring/decimal"
	"go.uber.org/zap"
)

// SolanaClient provides access to Solana blockchain data
type SolanaClient struct {
	mu         sync.RWMutex
	logger     *zap.Logger
	rpcURL     string
	wsURL      string
	httpClient *http.Client
	wsConn     *websocket.Conn
	
	// Block tracking
	currentSlot    uint64
	blockCallbacks []func(*events.BlockEvent)
	txCallbacks    []func(*events.MempoolEvent)
	
	// Connection state
	connected bool
	stopChan  chan struct{}
}

// SolanaConfig holds Solana client configuration
type SolanaConfig struct {
	RPCURL string
	WSURL  string
}

// NewSolanaClient creates a new Solana client
func NewSolanaClient(logger *zap.Logger, config *SolanaConfig) *SolanaClient {
	return &SolanaClient{
		logger: logger,
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
func (c *SolanaClient) Connect(ctx context.Context) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	
	dialer := websocket.Dialer{
		HandshakeTimeout: 10 * time.Second,
	}
	
	conn, _, err := dialer.DialContext(ctx, c.wsURL, nil)
	if err != nil {
		return fmt.Errorf("failed to connect to Solana WS: %w", err)
	}
	
	c.wsConn = conn
	c.connected = true
	
	// Subscribe to slot updates
	if err := c.subscribeToSlots(); err != nil {
		c.wsConn.Close()
		c.connected = false
		return fmt.Errorf("failed to subscribe to slots: %w", err)
	}
	
	// Start message handler
	go c.handleMessages()
	
	c.logger.Info("Connected to Solana", zap.String("url", c.wsURL))
	return nil
}

// Disconnect closes the WebSocket connection
func (c *SolanaClient) Disconnect() {
	c.mu.Lock()
	defer c.mu.Unlock()
	
	close(c.stopChan)
	
	if c.wsConn != nil {
		c.wsConn.Close()
		c.wsConn = nil
	}
	
	c.connected = false
	c.logger.Info("Disconnected from Solana")
}

// IsConnected returns connection status
func (c *SolanaClient) IsConnected() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.connected
}

// GetCurrentSlot returns the current slot number
func (c *SolanaClient) GetCurrentSlot() uint64 {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.currentSlot
}

// OnBlock registers a callback for new block events
func (c *SolanaClient) OnBlock(callback func(*events.BlockEvent)) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.blockCallbacks = append(c.blockCallbacks, callback)
}

// OnTransaction registers a callback for new transaction events
func (c *SolanaClient) OnTransaction(callback func(*events.MempoolEvent)) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.txCallbacks = append(c.txCallbacks, callback)
}

// GetBlock fetches a block by slot number
func (c *SolanaClient) GetBlock(ctx context.Context, slot uint64) (*events.BlockEvent, error) {
	req := map[string]interface{}{
		"jsonrpc": "2.0",
		"id":      1,
		"method":  "getBlock",
		"params": []interface{}{
			slot,
			map[string]interface{}{
				"encoding":                       "json",
				"transactionDetails":             "signatures",
				"rewards":                        false,
				"maxSupportedTransactionVersion": 0,
			},
		},
	}
	
	resp, err := c.rpcCall(ctx, req)
	if err != nil {
		return nil, err
	}
	
	result, ok := resp["result"].(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("invalid response format")
	}
	
	blockTime := int64(0)
	if bt, ok := result["blockTime"].(float64); ok {
		blockTime = int64(bt)
	}
	
	txCount := 0
	if sigs, ok := result["signatures"].([]interface{}); ok {
		txCount = len(sigs)
	}
	
	return &events.BlockEvent{
		BaseEvent: events.BaseEvent{
			Type:      events.EventTypeBlock,
			Timestamp: time.Unix(blockTime, 0),
			Priority:  1,
		},
		Chain:       "solana",
		BlockNumber: slot,
		BlockHash:   result["blockhash"].(string),
		ParentHash:  result["previousBlockhash"].(string),
		Timestamp:   time.Unix(blockTime, 0),
		TxCount:     txCount,
		Slot:        slot,
	}, nil
}

// GetTransaction fetches a transaction by signature
func (c *SolanaClient) GetTransaction(ctx context.Context, signature string) (*events.MempoolEvent, error) {
	req := map[string]interface{}{
		"jsonrpc": "2.0",
		"id":      1,
		"method":  "getTransaction",
		"params": []interface{}{
			signature,
			map[string]interface{}{
				"encoding":                       "json",
				"maxSupportedTransactionVersion": 0,
			},
		},
	}
	
	resp, err := c.rpcCall(ctx, req)
	if err != nil {
		return nil, err
	}
	
	result, ok := resp["result"].(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("transaction not found")
	}
	
	blockTime := time.Now()
	if bt, ok := result["blockTime"].(float64); ok {
		blockTime = time.Unix(int64(bt), 0)
	}
	
	return &events.MempoolEvent{
		BaseEvent: events.BaseEvent{
			Type:      events.EventTypeMempool,
			Timestamp: blockTime,
			Priority:  2,
		},
		TxHash: signature,
	}, nil
}

// GetBalance fetches SOL balance for an address
func (c *SolanaClient) GetBalance(ctx context.Context, address string) (decimal.Decimal, error) {
	req := map[string]interface{}{
		"jsonrpc": "2.0",
		"id":      1,
		"method":  "getBalance",
		"params":  []string{address},
	}
	
	resp, err := c.rpcCall(ctx, req)
	if err != nil {
		return decimal.Zero, err
	}
	
	result, ok := resp["result"].(map[string]interface{})
	if !ok {
		return decimal.Zero, fmt.Errorf("invalid response format")
	}
	
	value, ok := result["value"].(float64)
	if !ok {
		return decimal.Zero, fmt.Errorf("invalid balance value")
	}
	
	// Convert lamports to SOL
	return decimal.NewFromFloat(value / 1e9), nil
}

// GetTokenBalance fetches SPL token balance
func (c *SolanaClient) GetTokenBalance(ctx context.Context, tokenAccount string) (decimal.Decimal, error) {
	req := map[string]interface{}{
		"jsonrpc": "2.0",
		"id":      1,
		"method":  "getTokenAccountBalance",
		"params":  []string{tokenAccount},
	}
	
	resp, err := c.rpcCall(ctx, req)
	if err != nil {
		return decimal.Zero, err
	}
	
	result, ok := resp["result"].(map[string]interface{})
	if !ok {
		return decimal.Zero, fmt.Errorf("invalid response format")
	}
	
	value, ok := result["value"].(map[string]interface{})
	if !ok {
		return decimal.Zero, fmt.Errorf("invalid value format")
	}
	
	uiAmount, ok := value["uiAmount"].(float64)
	if !ok {
		return decimal.Zero, fmt.Errorf("invalid amount value")
	}
	
	return decimal.NewFromFloat(uiAmount), nil
}

// subscribeToSlots subscribes to slot updates
func (c *SolanaClient) subscribeToSlots() error {
	msg := map[string]interface{}{
		"jsonrpc": "2.0",
		"id":      1,
		"method":  "slotSubscribe",
	}
	
	return c.wsConn.WriteJSON(msg)
}

// handleMessages processes incoming WebSocket messages
func (c *SolanaClient) handleMessages() {
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
func (c *SolanaClient) processMessage(message []byte) {
	var msg map[string]interface{}
	if err := json.Unmarshal(message, &msg); err != nil {
		c.logger.Warn("Failed to parse message", zap.Error(err))
		return
	}
	
	// Check for slot notification
	if method, ok := msg["method"].(string); ok && method == "slotNotification" {
		params, ok := msg["params"].(map[string]interface{})
		if !ok {
			return
		}
		
		result, ok := params["result"].(map[string]interface{})
		if !ok {
			return
		}
		
		slot := uint64(result["slot"].(float64))
		
		c.mu.Lock()
		c.currentSlot = slot
		callbacks := make([]func(*events.BlockEvent), len(c.blockCallbacks))
		copy(callbacks, c.blockCallbacks)
		c.mu.Unlock()
		
		// Create block event
		blockEvent := &events.BlockEvent{
			BaseEvent: events.BaseEvent{
				Type:      events.EventTypeBlock,
				Timestamp: time.Now(),
				Priority:  1,
			},
			Chain:       "solana",
			BlockNumber: slot,
			Slot:        slot,
		}
		
		// Notify callbacks
		for _, cb := range callbacks {
			go cb(blockEvent)
		}
	}
}

// rpcCall makes an RPC call to Solana
func (c *SolanaClient) rpcCall(ctx context.Context, request interface{}) (map[string]interface{}, error) {
	reqBytes, err := json.Marshal(request)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}
	
	req, err := http.NewRequestWithContext(ctx, "POST", c.rpcURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	
	req.Header.Set("Content-Type", "application/json")
	req.Body = http.NoBody
	
	// Use bytes reader instead
	req, err = http.NewRequestWithContext(ctx, "POST", c.rpcURL, 
		&bytesReader{data: reqBytes})
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

// bytesReader wraps []byte as io.Reader
type bytesReader struct {
	data []byte
	pos  int
}

func (r *bytesReader) Read(p []byte) (n int, err error) {
	if r.pos >= len(r.data) {
		return 0, fmt.Errorf("EOF")
	}
	n = copy(p, r.data[r.pos:])
	r.pos += n
	return n, nil
}
