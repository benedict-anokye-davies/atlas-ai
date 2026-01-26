// Package adapters provides exchange adapter implementations.
package adapters

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/atlas-desktop/trading-backend/pkg/types"
	"github.com/gorilla/websocket"
	"github.com/shopspring/decimal"
	"go.uber.org/zap"
)

// BinanceAdapter implements the exchange adapter for Binance.
type BinanceAdapter struct {
	logger     *zap.Logger
	apiKey     string
	apiSecret  string
	baseURL    string
	wsURL      string
	httpClient *http.Client
	mu         sync.RWMutex
	
	// WebSocket connection
	wsConn     *websocket.Conn
	wsConnected bool
	
	// Market data cache
	tickerCache map[string]*BinanceTicker
	orderBooks  map[string]*types.OrderBook
	
	// Rate limiting
	rateLimiter *RateLimiter
	
	// Callbacks
	onTicker    func(ticker *BinanceTicker)
	onOrderBook func(symbol string, ob *types.OrderBook)
	onTrade     func(trade *BinanceTrade)
}

// BinanceConfig contains Binance adapter configuration.
type BinanceConfig struct {
	APIKey       string `json:"apiKey"`
	APISecret    string `json:"apiSecret"`
	Testnet      bool   `json:"testnet"`
	WSDepthLevel int    `json:"wsDepthLevel"` // 5, 10, or 20
}

// BinanceTicker represents a Binance ticker update.
type BinanceTicker struct {
	Symbol             string          `json:"symbol"`
	PriceChange        decimal.Decimal `json:"priceChange"`
	PriceChangePercent decimal.Decimal `json:"priceChangePercent"`
	LastPrice          decimal.Decimal `json:"lastPrice"`
	BidPrice           decimal.Decimal `json:"bidPrice"`
	AskPrice           decimal.Decimal `json:"askPrice"`
	Volume             decimal.Decimal `json:"volume"`
	QuoteVolume        decimal.Decimal `json:"quoteVolume"`
	OpenTime           int64           `json:"openTime"`
	CloseTime          int64           `json:"closeTime"`
	HighPrice          decimal.Decimal `json:"highPrice"`
	LowPrice           decimal.Decimal `json:"lowPrice"`
}

// BinanceTrade represents a Binance trade.
type BinanceTrade struct {
	Symbol   string          `json:"s"`
	TradeID  int64           `json:"t"`
	Price    decimal.Decimal `json:"p"`
	Quantity decimal.Decimal `json:"q"`
	Time     int64           `json:"T"`
	IsBuyer  bool            `json:"m"`
}

// BinanceOrder represents a Binance order response.
type BinanceOrder struct {
	Symbol              string          `json:"symbol"`
	OrderID             int64           `json:"orderId"`
	ClientOrderID       string          `json:"clientOrderId"`
	Price               decimal.Decimal `json:"price"`
	OrigQty             decimal.Decimal `json:"origQty"`
	ExecutedQty         decimal.Decimal `json:"executedQty"`
	CumulativeQuoteQty  decimal.Decimal `json:"cummulativeQuoteQty"`
	Status              string          `json:"status"`
	TimeInForce         string          `json:"timeInForce"`
	Type                string          `json:"type"`
	Side                string          `json:"side"`
	StopPrice           decimal.Decimal `json:"stopPrice,omitempty"`
	Time                int64           `json:"time"`
	UpdateTime          int64           `json:"updateTime"`
}

// BinanceBalance represents account balance.
type BinanceBalance struct {
	Asset  string          `json:"asset"`
	Free   decimal.Decimal `json:"free"`
	Locked decimal.Decimal `json:"locked"`
}

// BinanceAccount represents account information.
type BinanceAccount struct {
	MakerCommission  int              `json:"makerCommission"`
	TakerCommission  int              `json:"takerCommission"`
	BuyerCommission  int              `json:"buyerCommission"`
	SellerCommission int              `json:"sellerCommission"`
	CanTrade         bool             `json:"canTrade"`
	CanWithdraw      bool             `json:"canWithdraw"`
	CanDeposit       bool             `json:"canDeposit"`
	UpdateTime       int64            `json:"updateTime"`
	AccountType      string           `json:"accountType"`
	Balances         []BinanceBalance `json:"balances"`
}

// RateLimiter implements simple rate limiting.
type RateLimiter struct {
	mu       sync.Mutex
	tokens   int
	maxTokens int
	refillRate time.Duration
	lastRefill time.Time
}

// NewRateLimiter creates a new rate limiter.
func NewRateLimiter(maxTokens int, refillRate time.Duration) *RateLimiter {
	return &RateLimiter{
		tokens:     maxTokens,
		maxTokens:  maxTokens,
		refillRate: refillRate,
		lastRefill: time.Now(),
	}
}

// Acquire acquires a token, blocking if necessary.
func (rl *RateLimiter) Acquire() {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	
	// Refill tokens
	now := time.Now()
	elapsed := now.Sub(rl.lastRefill)
	refills := int(elapsed / rl.refillRate)
	if refills > 0 {
		rl.tokens = min(rl.maxTokens, rl.tokens+refills)
		rl.lastRefill = now
	}
	
	// Wait if no tokens
	for rl.tokens <= 0 {
		rl.mu.Unlock()
		time.Sleep(rl.refillRate)
		rl.mu.Lock()
		rl.tokens++
	}
	
	rl.tokens--
}

// NewBinanceAdapter creates a new Binance adapter.
func NewBinanceAdapter(logger *zap.Logger, config BinanceConfig) *BinanceAdapter {
	baseURL := "https://api.binance.com"
	wsURL := "wss://stream.binance.com:9443/ws"
	
	if config.Testnet {
		baseURL = "https://testnet.binance.vision"
		wsURL = "wss://testnet.binance.vision/ws"
	}
	
	return &BinanceAdapter{
		logger:      logger.Named("binance"),
		apiKey:      config.APIKey,
		apiSecret:   config.APISecret,
		baseURL:     baseURL,
		wsURL:       wsURL,
		httpClient:  &http.Client{Timeout: 30 * time.Second},
		tickerCache: make(map[string]*BinanceTicker),
		orderBooks:  make(map[string]*types.OrderBook),
		rateLimiter: NewRateLimiter(1200, time.Minute), // Binance limit
	}
}

// Connect establishes connection to Binance.
func (b *BinanceAdapter) Connect(ctx context.Context) error {
	b.logger.Info("Connecting to Binance")
	
	// Test connectivity
	if err := b.ping(ctx); err != nil {
		return fmt.Errorf("failed to ping Binance: %w", err)
	}
	
	b.logger.Info("Successfully connected to Binance")
	return nil
}

// Disconnect closes the connection.
func (b *BinanceAdapter) Disconnect() error {
	b.mu.Lock()
	defer b.mu.Unlock()
	
	if b.wsConn != nil {
		err := b.wsConn.Close()
		b.wsConn = nil
		b.wsConnected = false
		return err
	}
	return nil
}

// ping tests API connectivity.
func (b *BinanceAdapter) ping(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, "GET", b.baseURL+"/api/v3/ping", nil)
	if err != nil {
		return err
	}
	
	resp, err := b.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("ping failed with status: %d", resp.StatusCode)
	}
	
	return nil
}

// PlaceOrder places an order on Binance.
func (b *BinanceAdapter) PlaceOrder(ctx context.Context, order *types.Order) (*types.Order, error) {
	b.rateLimiter.Acquire()
	
	// Convert order to Binance format
	params := url.Values{}
	params.Set("symbol", strings.ReplaceAll(order.Symbol, "/", ""))
	params.Set("side", strings.ToUpper(string(order.Side)))
	params.Set("type", b.convertOrderType(order.Type))
	params.Set("quantity", order.Quantity.String())
	
	if order.Type == types.OrderTypeLimit {
		params.Set("price", order.Price.String())
		params.Set("timeInForce", "GTC")
	}
	
	if order.ClientOrderID != "" {
		params.Set("newClientOrderId", order.ClientOrderID)
	}
	
	// Sign and send request
	resp, err := b.signedRequest(ctx, "POST", "/api/v3/order", params)
	if err != nil {
		return nil, fmt.Errorf("failed to place order: %w", err)
	}
	defer resp.Body.Close()
	
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}
	
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("order failed with status %d: %s", resp.StatusCode, string(body))
	}
	
	var binanceOrder BinanceOrder
	if err := json.Unmarshal(body, &binanceOrder); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}
	
	// Convert back to our order type
	return b.convertBinanceOrder(&binanceOrder), nil
}

// CancelOrder cancels an order on Binance.
func (b *BinanceAdapter) CancelOrder(ctx context.Context, orderID string) error {
	b.rateLimiter.Acquire()
	
	// Parse order ID (format: SYMBOL:ORDERID)
	parts := strings.Split(orderID, ":")
	if len(parts) != 2 {
		return fmt.Errorf("invalid order ID format: %s", orderID)
	}
	
	params := url.Values{}
	params.Set("symbol", parts[0])
	params.Set("orderId", parts[1])
	
	resp, err := b.signedRequest(ctx, "DELETE", "/api/v3/order", params)
	if err != nil {
		return fmt.Errorf("failed to cancel order: %w", err)
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("cancel failed with status %d: %s", resp.StatusCode, string(body))
	}
	
	return nil
}

// GetOrder gets an order status from Binance.
func (b *BinanceAdapter) GetOrder(ctx context.Context, orderID string) (*types.Order, error) {
	b.rateLimiter.Acquire()
	
	parts := strings.Split(orderID, ":")
	if len(parts) != 2 {
		return nil, fmt.Errorf("invalid order ID format: %s", orderID)
	}
	
	params := url.Values{}
	params.Set("symbol", parts[0])
	params.Set("orderId", parts[1])
	
	resp, err := b.signedRequest(ctx, "GET", "/api/v3/order", params)
	if err != nil {
		return nil, fmt.Errorf("failed to get order: %w", err)
	}
	defer resp.Body.Close()
	
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}
	
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("get order failed with status %d: %s", resp.StatusCode, string(body))
	}
	
	var binanceOrder BinanceOrder
	if err := json.Unmarshal(body, &binanceOrder); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}
	
	return b.convertBinanceOrder(&binanceOrder), nil
}

// GetBalance gets account balance.
func (b *BinanceAdapter) GetBalance(ctx context.Context, asset string) (decimal.Decimal, error) {
	account, err := b.GetAccount(ctx)
	if err != nil {
		return decimal.Zero, err
	}
	
	for _, balance := range account.Balances {
		if balance.Asset == asset {
			return balance.Free, nil
		}
	}
	
	return decimal.Zero, nil
}

// GetAccount gets full account information.
func (b *BinanceAdapter) GetAccount(ctx context.Context) (*BinanceAccount, error) {
	b.rateLimiter.Acquire()
	
	resp, err := b.signedRequest(ctx, "GET", "/api/v3/account", url.Values{})
	if err != nil {
		return nil, fmt.Errorf("failed to get account: %w", err)
	}
	defer resp.Body.Close()
	
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}
	
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("get account failed with status %d: %s", resp.StatusCode, string(body))
	}
	
	var account BinanceAccount
	if err := json.Unmarshal(body, &account); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}
	
	return &account, nil
}

// GetPositions returns current positions (for spot, this is balances > 0).
func (b *BinanceAdapter) GetPositions(ctx context.Context) ([]*types.Position, error) {
	account, err := b.GetAccount(ctx)
	if err != nil {
		return nil, err
	}
	
	var positions []*types.Position
	for _, bal := range account.Balances {
		total := bal.Free.Add(bal.Locked)
		if total.GreaterThan(decimal.Zero) {
			positions = append(positions, &types.Position{
				Symbol:   bal.Asset + "/USDT",
				Side:     types.PositionSideLong,
				Quantity: total,
			})
		}
	}
	
	return positions, nil
}

// GetTicker gets current ticker for a symbol.
func (b *BinanceAdapter) GetTicker(ctx context.Context, symbol string) (*BinanceTicker, error) {
	b.rateLimiter.Acquire()
	
	binanceSymbol := strings.ReplaceAll(symbol, "/", "")
	
	req, err := http.NewRequestWithContext(ctx, "GET", 
		b.baseURL+"/api/v3/ticker/24hr?symbol="+binanceSymbol, nil)
	if err != nil {
		return nil, err
	}
	
	resp, err := b.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("get ticker failed: %s", string(body))
	}
	
	var ticker BinanceTicker
	if err := json.Unmarshal(body, &ticker); err != nil {
		return nil, err
	}
	
	return &ticker, nil
}

// GetOrderBook gets order book for a symbol.
func (b *BinanceAdapter) GetOrderBook(ctx context.Context, symbol string, limit int) (*types.OrderBook, error) {
	b.rateLimiter.Acquire()
	
	binanceSymbol := strings.ReplaceAll(symbol, "/", "")
	
	req, err := http.NewRequestWithContext(ctx, "GET",
		fmt.Sprintf("%s/api/v3/depth?symbol=%s&limit=%d", b.baseURL, binanceSymbol, limit), nil)
	if err != nil {
		return nil, err
	}
	
	resp, err := b.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("get order book failed: %s", string(body))
	}
	
	var rawOB struct {
		LastUpdateID int64      `json:"lastUpdateId"`
		Bids         [][]string `json:"bids"`
		Asks         [][]string `json:"asks"`
	}
	
	if err := json.Unmarshal(body, &rawOB); err != nil {
		return nil, err
	}
	
	ob := &types.OrderBook{
		Symbol:    symbol,
		Timestamp: time.Now(),
	}
	
	for _, bid := range rawOB.Bids {
		if len(bid) >= 2 {
			price, _ := decimal.NewFromString(bid[0])
			qty, _ := decimal.NewFromString(bid[1])
			ob.Bids = append(ob.Bids, types.OrderBookLevel{Price: price, Quantity: qty})
		}
	}
	
	for _, ask := range rawOB.Asks {
		if len(ask) >= 2 {
			price, _ := decimal.NewFromString(ask[0])
			qty, _ := decimal.NewFromString(ask[1])
			ob.Asks = append(ob.Asks, types.OrderBookLevel{Price: price, Quantity: qty})
		}
	}
	
	return ob, nil
}

// SubscribeToTicker subscribes to ticker updates via WebSocket.
func (b *BinanceAdapter) SubscribeToTicker(ctx context.Context, symbols []string, callback func(*BinanceTicker)) error {
	b.onTicker = callback
	
	// Build stream names
	var streams []string
	for _, s := range symbols {
		binanceSymbol := strings.ToLower(strings.ReplaceAll(s, "/", ""))
		streams = append(streams, binanceSymbol+"@ticker")
	}
	
	return b.subscribeToStreams(ctx, streams)
}

// subscribeToStreams subscribes to multiple WebSocket streams.
func (b *BinanceAdapter) subscribeToStreams(ctx context.Context, streams []string) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	
	// Build combined stream URL
	streamStr := strings.Join(streams, "/")
	wsURL := b.wsURL + "/" + streamStr
	
	dialer := websocket.Dialer{
		HandshakeTimeout: 10 * time.Second,
	}
	
	conn, _, err := dialer.DialContext(ctx, wsURL, nil)
	if err != nil {
		return fmt.Errorf("failed to connect to WebSocket: %w", err)
	}
	
	b.wsConn = conn
	b.wsConnected = true
	
	// Start reading messages
	go b.readWebSocket(ctx)
	
	return nil
}

// readWebSocket reads messages from WebSocket.
func (b *BinanceAdapter) readWebSocket(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}
		
		b.mu.RLock()
		conn := b.wsConn
		b.mu.RUnlock()
		
		if conn == nil {
			return
		}
		
		_, message, err := conn.ReadMessage()
		if err != nil {
			b.logger.Error("WebSocket read error", zap.Error(err))
			b.mu.Lock()
			b.wsConnected = false
			b.mu.Unlock()
			return
		}
		
		b.handleWebSocketMessage(message)
	}
}

// handleWebSocketMessage processes a WebSocket message.
func (b *BinanceAdapter) handleWebSocketMessage(message []byte) {
	// Try to parse as ticker
	var ticker struct {
		EventType string `json:"e"`
		EventTime int64  `json:"E"`
		Symbol    string `json:"s"`
		BinanceTicker
	}
	
	if err := json.Unmarshal(message, &ticker); err == nil {
		if ticker.EventType == "24hrTicker" && b.onTicker != nil {
			b.onTicker(&ticker.BinanceTicker)
		}
	}
}

// signedRequest makes a signed API request.
func (b *BinanceAdapter) signedRequest(ctx context.Context, method, endpoint string, params url.Values) (*http.Response, error) {
	// Add timestamp
	params.Set("timestamp", strconv.FormatInt(time.Now().UnixMilli(), 10))
	
	// Create signature
	queryString := params.Encode()
	signature := b.sign(queryString)
	params.Set("signature", signature)
	
	// Build URL
	reqURL := b.baseURL + endpoint + "?" + params.Encode()
	
	req, err := http.NewRequestWithContext(ctx, method, reqURL, nil)
	if err != nil {
		return nil, err
	}
	
	req.Header.Set("X-MBX-APIKEY", b.apiKey)
	
	return b.httpClient.Do(req)
}

// sign creates HMAC-SHA256 signature.
func (b *BinanceAdapter) sign(data string) string {
	h := hmac.New(sha256.New, []byte(b.apiSecret))
	h.Write([]byte(data))
	return hex.EncodeToString(h.Sum(nil))
}

// convertOrderType converts our order type to Binance format.
func (b *BinanceAdapter) convertOrderType(t types.OrderType) string {
	switch t {
	case types.OrderTypeMarket:
		return "MARKET"
	case types.OrderTypeLimit:
		return "LIMIT"
	case types.OrderTypeStopLimit:
		return "STOP_LOSS_LIMIT"
	case types.OrderTypeStopMarket:
		return "STOP_LOSS"
	default:
		return "LIMIT"
	}
}

// convertBinanceOrder converts Binance order to our format.
func (b *BinanceAdapter) convertBinanceOrder(bo *BinanceOrder) *types.Order {
	order := &types.Order{
		ID:            fmt.Sprintf("%s:%d", bo.Symbol, bo.OrderID),
		ClientOrderID: bo.ClientOrderID,
		Symbol:        b.formatSymbol(bo.Symbol),
		Price:         bo.Price,
		Quantity:      bo.OrigQty,
		FilledQty:     bo.ExecutedQty,
		Status:        b.convertOrderStatus(bo.Status),
		CreatedAt:     time.UnixMilli(bo.Time),
		UpdatedAt:     time.UnixMilli(bo.UpdateTime),
	}
	
	switch strings.ToLower(bo.Side) {
	case "buy":
		order.Side = types.OrderSideBuy
	case "sell":
		order.Side = types.OrderSideSell
	}
	
	switch bo.Type {
	case "MARKET":
		order.Type = types.OrderTypeMarket
	case "LIMIT":
		order.Type = types.OrderTypeLimit
	case "STOP_LOSS_LIMIT":
		order.Type = types.OrderTypeStopLimit
	}
	
	return order
}

// convertOrderStatus converts Binance order status.
func (b *BinanceAdapter) convertOrderStatus(status string) types.OrderStatus {
	switch status {
	case "NEW":
		return types.OrderStatusOpen
	case "PARTIALLY_FILLED":
		return types.OrderStatusPartiallyFilled
	case "FILLED":
		return types.OrderStatusFilled
	case "CANCELED":
		return types.OrderStatusCancelled
	case "REJECTED":
		return types.OrderStatusRejected
	case "EXPIRED":
		return types.OrderStatusExpired
	default:
		return types.OrderStatusOpen
	}
}

// formatSymbol converts BTCUSDT to BTC/USDT.
func (b *BinanceAdapter) formatSymbol(symbol string) string {
	// Common quote currencies
	quotes := []string{"USDT", "BUSD", "BTC", "ETH", "BNB"}
	
	for _, quote := range quotes {
		if strings.HasSuffix(symbol, quote) {
			base := strings.TrimSuffix(symbol, quote)
			return base + "/" + quote
		}
	}
	
	return symbol
}

// GetExchangeInfo gets exchange trading rules.
func (b *BinanceAdapter) GetExchangeInfo(ctx context.Context) (*BinanceExchangeInfo, error) {
	b.rateLimiter.Acquire()
	
	req, err := http.NewRequestWithContext(ctx, "GET", b.baseURL+"/api/v3/exchangeInfo", nil)
	if err != nil {
		return nil, err
	}
	
	resp, err := b.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("get exchange info failed: %s", string(body))
	}
	
	var info BinanceExchangeInfo
	if err := json.Unmarshal(body, &info); err != nil {
		return nil, err
	}
	
	return &info, nil
}

// BinanceExchangeInfo represents exchange information.
type BinanceExchangeInfo struct {
	Timezone        string                `json:"timezone"`
	ServerTime      int64                 `json:"serverTime"`
	RateLimits      []BinanceRateLimit    `json:"rateLimits"`
	Symbols         []BinanceSymbolInfo   `json:"symbols"`
}

// BinanceRateLimit represents a rate limit.
type BinanceRateLimit struct {
	RateLimitType string `json:"rateLimitType"`
	Interval      string `json:"interval"`
	IntervalNum   int    `json:"intervalNum"`
	Limit         int    `json:"limit"`
}

// BinanceSymbolInfo represents symbol trading info.
type BinanceSymbolInfo struct {
	Symbol              string                 `json:"symbol"`
	Status              string                 `json:"status"`
	BaseAsset           string                 `json:"baseAsset"`
	QuoteAsset          string                 `json:"quoteAsset"`
	BaseAssetPrecision  int                    `json:"baseAssetPrecision"`
	QuoteAssetPrecision int                    `json:"quoteAssetPrecision"`
	Filters             []BinanceSymbolFilter  `json:"filters"`
}

// BinanceSymbolFilter represents a trading filter.
type BinanceSymbolFilter struct {
	FilterType  string `json:"filterType"`
	MinPrice    string `json:"minPrice,omitempty"`
	MaxPrice    string `json:"maxPrice,omitempty"`
	TickSize    string `json:"tickSize,omitempty"`
	MinQty      string `json:"minQty,omitempty"`
	MaxQty      string `json:"maxQty,omitempty"`
	StepSize    string `json:"stepSize,omitempty"`
	MinNotional string `json:"minNotional,omitempty"`
}
