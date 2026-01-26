// Package data provides real-time market data services.
package data

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"sync"
	"time"

	"github.com/atlas-desktop/trading-backend/pkg/types"
	"github.com/gorilla/websocket"
	"github.com/shopspring/decimal"
	"go.uber.org/zap"
)

// PriceUpdate represents a real-time price update.
type PriceUpdate struct {
	Symbol    string          `json:"symbol"`
	Price     decimal.Decimal `json:"price"`
	Bid       decimal.Decimal `json:"bid"`
	Ask       decimal.Decimal `json:"ask"`
	Volume    decimal.Decimal `json:"volume"`
	Timestamp int64           `json:"timestamp"`
	Source    string          `json:"source"`
}

// OHLCV represents a candlestick.
type OHLCV struct {
	Symbol    string          `json:"symbol"`
	Open      decimal.Decimal `json:"open"`
	High      decimal.Decimal `json:"high"`
	Low       decimal.Decimal `json:"low"`
	Close     decimal.Decimal `json:"close"`
	Volume    decimal.Decimal `json:"volume"`
	Timestamp int64           `json:"timestamp"`
	Interval  string          `json:"interval"`
}

// OrderBookUpdate represents an order book update.
type OrderBookUpdate struct {
	Symbol    string               `json:"symbol"`
	Bids      []types.OrderBookLevel `json:"bids"`
	Asks      []types.OrderBookLevel `json:"asks"`
	Timestamp int64                `json:"timestamp"`
}

// TradeUpdate represents a trade update from the exchange.
type TradeUpdate struct {
	Symbol    string          `json:"symbol"`
	Price     decimal.Decimal `json:"price"`
	Quantity  decimal.Decimal `json:"quantity"`
	Side      string          `json:"side"` // "buy" or "sell"
	Timestamp int64           `json:"timestamp"`
	TradeID   string          `json:"trade_id"`
}

// MarketDataService provides real-time market data.
type MarketDataService struct {
	logger        *zap.Logger
	config        MarketDataConfig
	
	// WebSocket connections
	binanceWS     *websocket.Conn
	binanceMu     sync.RWMutex
	
	// Subscriptions
	subscriptions map[string]bool
	subMu         sync.RWMutex
	
	// Callbacks
	onPrice       func(PriceUpdate)
	onOHLCV       func(OHLCV)
	onOrderBook   func(OrderBookUpdate)
	onTrade       func(TradeUpdate)
	
	// State
	running       bool
	ctx           context.Context
	cancel        context.CancelFunc
	
	// Cache
	priceCache    map[string]PriceUpdate
	priceMu       sync.RWMutex
	ohlcvCache    map[string][]OHLCV
	ohlcvMu       sync.RWMutex
}

// MarketDataConfig configures the market data service.
type MarketDataConfig struct {
	BinanceWSURL string
	Symbols      []string
	Intervals    []string // e.g., ["1m", "5m", "1h"]
	BufferSize   int
}

// DefaultMarketDataConfig returns default config.
func DefaultMarketDataConfig() MarketDataConfig {
	return MarketDataConfig{
		BinanceWSURL: "wss://stream.binance.com:9443/ws",
		Symbols:      []string{"BTCUSDT", "ETHUSDT", "SOLUSDT"},
		Intervals:    []string{"1m", "5m", "15m", "1h"},
		BufferSize:   100,
	}
}

// NewMarketDataService creates a new market data service.
func NewMarketDataService(logger *zap.Logger, config MarketDataConfig) *MarketDataService {
	return &MarketDataService{
		logger:        logger,
		config:        config,
		subscriptions: make(map[string]bool),
		priceCache:    make(map[string]PriceUpdate),
		ohlcvCache:    make(map[string][]OHLCV),
	}
}

// Start starts the market data service.
func (s *MarketDataService) Start(ctx context.Context) error {
	s.ctx, s.cancel = context.WithCancel(ctx)
	s.running = true
	
	// Connect to Binance WebSocket
	if err := s.connectBinance(); err != nil {
		return fmt.Errorf("failed to connect to Binance: %w", err)
	}
	
	// Subscribe to default symbols
	for _, symbol := range s.config.Symbols {
		s.Subscribe(symbol)
	}
	
	// Start read loop
	go s.readLoop()
	
	// Start reconnection monitor
	go s.reconnectMonitor()
	
	s.logger.Info("Market data service started",
		zap.Int("symbols", len(s.config.Symbols)))
	
	return nil
}

// Stop stops the market data service.
func (s *MarketDataService) Stop() error {
	s.running = false
	if s.cancel != nil {
		s.cancel()
	}
	
	s.binanceMu.Lock()
	if s.binanceWS != nil {
		s.binanceWS.Close()
	}
	s.binanceMu.Unlock()
	
	s.logger.Info("Market data service stopped")
	return nil
}

// connectBinance connects to Binance WebSocket.
func (s *MarketDataService) connectBinance() error {
	s.binanceMu.Lock()
	defer s.binanceMu.Unlock()
	
	u, err := url.Parse(s.config.BinanceWSURL)
	if err != nil {
		return err
	}
	
	conn, _, err := websocket.DefaultDialer.Dial(u.String(), nil)
	if err != nil {
		return err
	}
	
	s.binanceWS = conn
	s.logger.Debug("Connected to Binance WebSocket")
	
	return nil
}

// Subscribe subscribes to a symbol.
func (s *MarketDataService) Subscribe(symbol string) error {
	s.subMu.Lock()
	if s.subscriptions[symbol] {
		s.subMu.Unlock()
		return nil
	}
	s.subscriptions[symbol] = true
	s.subMu.Unlock()
	
	// Send subscription message
	streams := []string{
		fmt.Sprintf("%s@ticker", stringToLower(symbol)),
		fmt.Sprintf("%s@trade", stringToLower(symbol)),
		fmt.Sprintf("%s@depth20@100ms", stringToLower(symbol)),
	}
	
	// Add kline streams for configured intervals
	for _, interval := range s.config.Intervals {
		streams = append(streams, fmt.Sprintf("%s@kline_%s", stringToLower(symbol), interval))
	}
	
	msg := map[string]interface{}{
		"method": "SUBSCRIBE",
		"params": streams,
		"id":     time.Now().UnixNano(),
	}
	
	s.binanceMu.Lock()
	defer s.binanceMu.Unlock()
	
	if s.binanceWS == nil {
		return fmt.Errorf("websocket not connected")
	}
	
	if err := s.binanceWS.WriteJSON(msg); err != nil {
		return err
	}
	
	s.logger.Debug("Subscribed to symbol", zap.String("symbol", symbol))
	return nil
}

// Unsubscribe unsubscribes from a symbol.
func (s *MarketDataService) Unsubscribe(symbol string) error {
	s.subMu.Lock()
	if !s.subscriptions[symbol] {
		s.subMu.Unlock()
		return nil
	}
	delete(s.subscriptions, symbol)
	s.subMu.Unlock()
	
	streams := []string{
		fmt.Sprintf("%s@ticker", stringToLower(symbol)),
		fmt.Sprintf("%s@trade", stringToLower(symbol)),
		fmt.Sprintf("%s@depth20@100ms", stringToLower(symbol)),
	}
	
	msg := map[string]interface{}{
		"method": "UNSUBSCRIBE",
		"params": streams,
		"id":     time.Now().UnixNano(),
	}
	
	s.binanceMu.Lock()
	defer s.binanceMu.Unlock()
	
	if s.binanceWS != nil {
		return s.binanceWS.WriteJSON(msg)
	}
	
	return nil
}

// readLoop reads messages from WebSocket.
func (s *MarketDataService) readLoop() {
	for s.running {
		s.binanceMu.RLock()
		conn := s.binanceWS
		s.binanceMu.RUnlock()
		
		if conn == nil {
			time.Sleep(100 * time.Millisecond)
			continue
		}
		
		_, message, err := conn.ReadMessage()
		if err != nil {
			if s.running {
				s.logger.Error("WebSocket read error", zap.Error(err))
			}
			continue
		}
		
		s.handleMessage(message)
	}
}

// handleMessage handles a WebSocket message.
func (s *MarketDataService) handleMessage(data []byte) {
	// Try to parse as ticker
	var msg map[string]interface{}
	if err := json.Unmarshal(data, &msg); err != nil {
		return
	}
	
	// Check event type
	eventType, ok := msg["e"].(string)
	if !ok {
		return
	}
	
	switch eventType {
	case "24hrTicker":
		s.handleTicker(msg)
	case "trade":
		s.handleTrade(msg)
	case "depthUpdate":
		s.handleDepth(msg)
	case "kline":
		s.handleKline(msg)
	}
}

// handleTicker handles ticker updates.
func (s *MarketDataService) handleTicker(msg map[string]interface{}) {
	symbol, _ := msg["s"].(string)
	lastPrice, _ := msg["c"].(string)
	bidPrice, _ := msg["b"].(string)
	askPrice, _ := msg["a"].(string)
	volume, _ := msg["v"].(string)
	timestamp, _ := msg["E"].(float64)
	
	price, _ := decimal.NewFromString(lastPrice)
	bid, _ := decimal.NewFromString(bidPrice)
	ask, _ := decimal.NewFromString(askPrice)
	vol, _ := decimal.NewFromString(volume)
	
	update := PriceUpdate{
		Symbol:    symbol,
		Price:     price,
		Bid:       bid,
		Ask:       ask,
		Volume:    vol,
		Timestamp: int64(timestamp),
		Source:    "binance",
	}
	
	// Cache
	s.priceMu.Lock()
	s.priceCache[symbol] = update
	s.priceMu.Unlock()
	
	// Callback
	if s.onPrice != nil {
		s.onPrice(update)
	}
}

// handleTrade handles trade updates.
func (s *MarketDataService) handleTrade(msg map[string]interface{}) {
	symbol, _ := msg["s"].(string)
	priceStr, _ := msg["p"].(string)
	qtyStr, _ := msg["q"].(string)
	isBuyer, _ := msg["m"].(bool)
	timestamp, _ := msg["E"].(float64)
	tradeID, _ := msg["t"].(float64)
	
	price, _ := decimal.NewFromString(priceStr)
	qty, _ := decimal.NewFromString(qtyStr)
	
	side := "buy"
	if !isBuyer {
		side = "sell"
	}
	
	update := TradeUpdate{
		Symbol:    symbol,
		Price:     price,
		Quantity:  qty,
		Side:      side,
		Timestamp: int64(timestamp),
		TradeID:   fmt.Sprintf("%d", int64(tradeID)),
	}
	
	if s.onTrade != nil {
		s.onTrade(update)
	}
}

// handleDepth handles order book updates.
func (s *MarketDataService) handleDepth(msg map[string]interface{}) {
	symbol, _ := msg["s"].(string)
	timestamp, _ := msg["E"].(float64)
	
	bidsRaw, _ := msg["b"].([]interface{})
	asksRaw, _ := msg["a"].([]interface{})
	
	bids := parseOrderBookLevels(bidsRaw)
	asks := parseOrderBookLevels(asksRaw)
	
	update := OrderBookUpdate{
		Symbol:    symbol,
		Bids:      bids,
		Asks:      asks,
		Timestamp: int64(timestamp),
	}
	
	if s.onOrderBook != nil {
		s.onOrderBook(update)
	}
}

// handleKline handles candlestick updates.
func (s *MarketDataService) handleKline(msg map[string]interface{}) {
	kline, ok := msg["k"].(map[string]interface{})
	if !ok {
		return
	}
	
	symbol, _ := kline["s"].(string)
	interval, _ := kline["i"].(string)
	openStr, _ := kline["o"].(string)
	highStr, _ := kline["h"].(string)
	lowStr, _ := kline["l"].(string)
	closeStr, _ := kline["c"].(string)
	volumeStr, _ := kline["v"].(string)
	timestamp, _ := kline["t"].(float64)
	
	open, _ := decimal.NewFromString(openStr)
	high, _ := decimal.NewFromString(highStr)
	low, _ := decimal.NewFromString(lowStr)
	closePrice, _ := decimal.NewFromString(closeStr)
	volume, _ := decimal.NewFromString(volumeStr)
	
	ohlcv := OHLCV{
		Symbol:    symbol,
		Open:      open,
		High:      high,
		Low:       low,
		Close:     closePrice,
		Volume:    volume,
		Timestamp: int64(timestamp),
		Interval:  interval,
	}
	
	// Cache
	key := fmt.Sprintf("%s:%s", symbol, interval)
	s.ohlcvMu.Lock()
	cache := s.ohlcvCache[key]
	cache = append(cache, ohlcv)
	if len(cache) > s.config.BufferSize {
		cache = cache[1:]
	}
	s.ohlcvCache[key] = cache
	s.ohlcvMu.Unlock()
	
	if s.onOHLCV != nil {
		s.onOHLCV(ohlcv)
	}
}

// reconnectMonitor monitors and reconnects WebSocket.
func (s *MarketDataService) reconnectMonitor() {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	
	for {
		select {
		case <-s.ctx.Done():
			return
		case <-ticker.C:
			s.binanceMu.RLock()
			conn := s.binanceWS
			s.binanceMu.RUnlock()
			
			if conn == nil && s.running {
				s.logger.Info("Attempting to reconnect to Binance...")
				if err := s.connectBinance(); err != nil {
					s.logger.Error("Reconnection failed", zap.Error(err))
				} else {
					// Resubscribe
					s.subMu.RLock()
					symbols := make([]string, 0, len(s.subscriptions))
					for symbol := range s.subscriptions {
						symbols = append(symbols, symbol)
					}
					s.subMu.RUnlock()
					
					for _, symbol := range symbols {
						s.subscriptions[symbol] = false
						s.Subscribe(symbol)
					}
				}
			}
		}
	}
}

// Callbacks

// OnPrice sets the price update callback.
func (s *MarketDataService) OnPrice(fn func(PriceUpdate)) {
	s.onPrice = fn
}

// OnOHLCV sets the OHLCV update callback.
func (s *MarketDataService) OnOHLCV(fn func(OHLCV)) {
	s.onOHLCV = fn
}

// OnOrderBook sets the order book update callback.
func (s *MarketDataService) OnOrderBook(fn func(OrderBookUpdate)) {
	s.onOrderBook = fn
}

// OnTrade sets the trade update callback.
func (s *MarketDataService) OnTrade(fn func(TradeUpdate)) {
	s.onTrade = fn
}

// Getters

// GetPrice returns the latest price for a symbol.
func (s *MarketDataService) GetPrice(symbol string) (PriceUpdate, bool) {
	s.priceMu.RLock()
	defer s.priceMu.RUnlock()
	price, ok := s.priceCache[symbol]
	return price, ok
}

// GetOHLCV returns cached OHLCV data for a symbol and interval.
func (s *MarketDataService) GetOHLCV(symbol, interval string) []OHLCV {
	key := fmt.Sprintf("%s:%s", symbol, interval)
	s.ohlcvMu.RLock()
	defer s.ohlcvMu.RUnlock()
	return s.ohlcvCache[key]
}

// Helper functions

func parseOrderBookLevels(raw []interface{}) []types.OrderBookLevel {
	levels := make([]types.OrderBookLevel, 0, len(raw))
	for _, r := range raw {
		level, ok := r.([]interface{})
		if !ok || len(level) < 2 {
			continue
		}
		priceStr, _ := level[0].(string)
		qtyStr, _ := level[1].(string)
		price, _ := decimal.NewFromString(priceStr)
		qty, _ := decimal.NewFromString(qtyStr)
		levels = append(levels, types.OrderBookLevel{Price: price, Quantity: qty})
	}
	return levels
}

func stringToLower(s string) string {
	result := make([]byte, len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 'A' && c <= 'Z' {
			c += 'a' - 'A'
		}
		result[i] = c
	}
	return string(result)
}
