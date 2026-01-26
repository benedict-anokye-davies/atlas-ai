// Package execution provides trade execution capabilities.
package execution

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/atlas-desktop/trading-backend/pkg/types"
	"github.com/shopspring/decimal"
	"go.uber.org/zap"
)

// Executor handles trade execution across multiple exchanges.
type Executor struct {
	logger     *zap.Logger
	adapters   map[string]ExchangeAdapter
	orderMgr   *OrderManager
	riskMgr    *RiskManager
	slippage   SlippageCalculator
	config     ExecutorConfig
	
	// State
	mu         sync.RWMutex
	isActive   bool
	killSwitch bool
	
	// Metrics
	metrics    ExecutorMetrics
}

// ExecutorConfig configures the executor.
type ExecutorConfig struct {
	// Execution settings
	DefaultSlippage    decimal.Decimal `json:"defaultSlippage"`    // Default slippage tolerance
	MaxSlippage        decimal.Decimal `json:"maxSlippage"`        // Maximum allowed slippage
	RetryAttempts      int             `json:"retryAttempts"`
	RetryDelay         time.Duration   `json:"retryDelay"`
	
	// Order settings
	UseMarketOrders    bool            `json:"useMarketOrders"`
	LimitOrderTimeout  time.Duration   `json:"limitOrderTimeout"`
	
	// Safety
	RequireConfirmation bool           `json:"requireConfirmation"`
	MaxOrderSize       decimal.Decimal `json:"maxOrderSize"`
	MinOrderSize       decimal.Decimal `json:"minOrderSize"`
	
	// Paper trading
	PaperTrading       bool            `json:"paperTrading"`
}

// DefaultExecutorConfig returns sensible defaults.
func DefaultExecutorConfig() ExecutorConfig {
	return ExecutorConfig{
		DefaultSlippage:     decimal.NewFromFloat(0.005), // 0.5%
		MaxSlippage:         decimal.NewFromFloat(0.02),  // 2%
		RetryAttempts:       3,
		RetryDelay:          time.Second,
		UseMarketOrders:     false,
		LimitOrderTimeout:   30 * time.Second,
		RequireConfirmation: true,
		MaxOrderSize:        decimal.NewFromInt(10000),
		MinOrderSize:        decimal.NewFromInt(10),
		PaperTrading:        true, // Safe default
	}
}

// ExecutorMetrics tracks execution performance.
type ExecutorMetrics struct {
	TotalOrders       int             `json:"totalOrders"`
	SuccessfulOrders  int             `json:"successfulOrders"`
	FailedOrders      int             `json:"failedOrders"`
	TotalVolume       decimal.Decimal `json:"totalVolume"`
	AvgSlippage       decimal.Decimal `json:"avgSlippage"`
	AvgLatency        time.Duration   `json:"avgLatency"`
	LastOrderTime     time.Time       `json:"lastOrderTime"`
}

// ExchangeAdapter defines the interface for exchange integrations.
type ExchangeAdapter interface {
	Name() string
	Connect(ctx context.Context) error
	Disconnect() error
	IsConnected() bool
	
	// Market data
	GetPrice(ctx context.Context, symbol string) (decimal.Decimal, error)
	GetOrderBook(ctx context.Context, symbol string, depth int) (*OrderBook, error)
	
	// Trading
	PlaceOrder(ctx context.Context, order *types.Order) (*OrderResult, error)
	CancelOrder(ctx context.Context, orderID string) error
	GetOrder(ctx context.Context, orderID string) (*types.Order, error)
	GetOpenOrders(ctx context.Context, symbol string) ([]*types.Order, error)
	
	// Account
	GetBalance(ctx context.Context, asset string) (decimal.Decimal, error)
	GetPositions(ctx context.Context) ([]*types.Position, error)
}

// OrderBook represents an exchange order book.
type OrderBook struct {
	Symbol    string             `json:"symbol"`
	Bids      []OrderBookLevel   `json:"bids"`
	Asks      []OrderBookLevel   `json:"asks"`
	Timestamp time.Time          `json:"timestamp"`
}

// OrderBookLevel represents a price level.
type OrderBookLevel struct {
	Price  decimal.Decimal `json:"price"`
	Amount decimal.Decimal `json:"amount"`
}

// OrderResult contains the result of an order placement.
type OrderResult struct {
	OrderID       string          `json:"orderId"`
	ClientOrderID string          `json:"clientOrderId"`
	Symbol        string          `json:"symbol"`
	Side          string          `json:"side"`
	Type          string          `json:"type"`
	Status        string          `json:"status"`
	Price         decimal.Decimal `json:"price"`
	Quantity      decimal.Decimal `json:"quantity"`
	FilledQty     decimal.Decimal `json:"filledQty"`
	AvgPrice      decimal.Decimal `json:"avgPrice"`
	Commission    decimal.Decimal `json:"commission"`
	Timestamp     time.Time       `json:"timestamp"`
}

// SlippageCalculator calculates expected slippage.
type SlippageCalculator interface {
	Calculate(orderBook *OrderBook, order *types.Order) decimal.Decimal
	EstimateFillPrice(orderBook *OrderBook, side string, quantity decimal.Decimal) decimal.Decimal
}

// NewExecutor creates a new trade executor.
func NewExecutor(logger *zap.Logger, config ExecutorConfig) *Executor {
	return &Executor{
		logger:   logger.Named("executor"),
		adapters: make(map[string]ExchangeAdapter),
		orderMgr: NewOrderManager(logger),
		riskMgr:  NewRiskManager(logger, DefaultRiskConfig()),
		slippage: NewSmartSlippageCalculator(),
		config:   config,
		isActive: true,
	}
}

// AddAdapter adds an exchange adapter.
func (e *Executor) AddAdapter(adapter ExchangeAdapter) {
	e.mu.Lock()
	defer e.mu.Unlock()
	
	e.adapters[adapter.Name()] = adapter
	e.logger.Info("Added exchange adapter", zap.String("exchange", adapter.Name()))
}

// Connect connects to all exchanges.
func (e *Executor) Connect(ctx context.Context) error {
	e.mu.RLock()
	adapters := make([]ExchangeAdapter, 0, len(e.adapters))
	for _, adapter := range e.adapters {
		adapters = append(adapters, adapter)
	}
	e.mu.RUnlock()
	
	for _, adapter := range adapters {
		if err := adapter.Connect(ctx); err != nil {
			e.logger.Error("Failed to connect to exchange",
				zap.String("exchange", adapter.Name()),
				zap.Error(err))
			// Continue with other exchanges
		} else {
			e.logger.Info("Connected to exchange", zap.String("exchange", adapter.Name()))
		}
	}
	
	return nil
}

// Disconnect disconnects from all exchanges.
func (e *Executor) Disconnect() {
	e.mu.RLock()
	defer e.mu.RUnlock()
	
	for _, adapter := range e.adapters {
		adapter.Disconnect()
	}
}

// Execute executes a trading signal.
func (e *Executor) Execute(ctx context.Context, signal *types.Signal, exchange string) (*ExecutionResult, error) {
	e.mu.RLock()
	if e.killSwitch {
		e.mu.RUnlock()
		return nil, fmt.Errorf("kill switch activated, trading disabled")
	}
	if !e.isActive {
		e.mu.RUnlock()
		return nil, fmt.Errorf("executor is not active")
	}
	e.mu.RUnlock()
	
	startTime := time.Now()
	
	// Get adapter
	adapter, ok := e.adapters[exchange]
	if !ok {
		return nil, fmt.Errorf("exchange adapter not found: %s", exchange)
	}
	
	if !adapter.IsConnected() {
		return nil, fmt.Errorf("exchange not connected: %s", exchange)
	}
	
	// Validate signal
	if err := e.validateSignal(signal); err != nil {
		return nil, fmt.Errorf("signal validation failed: %w", err)
	}
	
	// Get current price
	currentPrice, err := adapter.GetPrice(ctx, signal.Symbol)
	if err != nil {
		return nil, fmt.Errorf("failed to get price: %w", err)
	}
	
	// Check price hasn't moved too much
	if !signal.Price.IsZero() {
		priceMove := currentPrice.Sub(signal.Price).Abs().Div(signal.Price)
		if priceMove.GreaterThan(e.config.MaxSlippage) {
			return nil, fmt.Errorf("price moved too much since signal: %.2f%%", priceMove.Mul(decimal.NewFromInt(100)).InexactFloat64())
		}
	}
	
	// Risk check
	if err := e.riskMgr.CheckOrder(signal); err != nil {
		return nil, fmt.Errorf("risk check failed: %w", err)
	}
	
	// Calculate position size
	quantity := e.calculateQuantity(signal, currentPrice)
	if quantity.LessThan(e.config.MinOrderSize) {
		return nil, fmt.Errorf("calculated quantity %s below minimum %s", quantity, e.config.MinOrderSize)
	}
	
	// Create order
	order := &types.Order{
		ID:        fmt.Sprintf("ord-%d", time.Now().UnixNano()),
		Symbol:    signal.Symbol,
		Quantity:  quantity,
		Timestamp: time.Now(),
	}
	
	// Set side
	switch signal.Direction {
	case types.SignalBuy:
		order.Side = types.OrderSideBuy
	case types.SignalSell:
		order.Side = types.OrderSideSell
	default:
		return nil, fmt.Errorf("invalid signal direction: %s", signal.Direction)
	}
	
	// Set order type and price
	if e.config.UseMarketOrders {
		order.Type = types.OrderTypeMarket
	} else {
		order.Type = types.OrderTypeLimit
		// Set limit price with slippage buffer
		slippageFactor := decimal.NewFromFloat(1.0)
		if order.Side == types.OrderSideBuy {
			slippageFactor = slippageFactor.Add(e.config.DefaultSlippage)
		} else {
			slippageFactor = slippageFactor.Sub(e.config.DefaultSlippage)
		}
		order.Price = currentPrice.Mul(slippageFactor)
	}
	
	// Paper trading simulation
	if e.config.PaperTrading {
		return e.simulateExecution(order, currentPrice, startTime)
	}
	
	// Place order with retries
	var result *OrderResult
	var lastErr error
	
	for attempt := 0; attempt < e.config.RetryAttempts; attempt++ {
		result, err = adapter.PlaceOrder(ctx, order)
		if err == nil {
			break
		}
		
		lastErr = err
		e.logger.Warn("Order placement failed, retrying",
			zap.Int("attempt", attempt+1),
			zap.Error(err))
		
		time.Sleep(e.config.RetryDelay)
	}
	
	if result == nil {
		e.updateMetrics(false, decimal.Zero, time.Since(startTime))
		return nil, fmt.Errorf("order placement failed after %d attempts: %w", e.config.RetryAttempts, lastErr)
	}
	
	// Calculate actual slippage
	actualSlippage := decimal.Zero
	if !result.AvgPrice.IsZero() && !currentPrice.IsZero() {
		actualSlippage = result.AvgPrice.Sub(currentPrice).Abs().Div(currentPrice)
	}
	
	// Update metrics
	e.updateMetrics(true, actualSlippage, time.Since(startTime))
	
	execResult := &ExecutionResult{
		OrderID:       result.OrderID,
		Signal:        signal,
		Order:         order,
		Exchange:      exchange,
		Status:        result.Status,
		FilledQty:     result.FilledQty,
		AvgPrice:      result.AvgPrice,
		Commission:    result.Commission,
		Slippage:      actualSlippage,
		Latency:       time.Since(startTime),
		Timestamp:     time.Now(),
	}
	
	e.logger.Info("Order executed",
		zap.String("orderId", result.OrderID),
		zap.String("symbol", order.Symbol),
		zap.String("side", string(order.Side)),
		zap.String("qty", order.Quantity.String()),
		zap.String("price", result.AvgPrice.String()),
		zap.String("slippage", actualSlippage.String()))
	
	return execResult, nil
}

// ExecuteWithSLTP executes a signal with stop loss and take profit orders.
func (e *Executor) ExecuteWithSLTP(
	ctx context.Context,
	signal *types.Signal,
	exchange string,
) (*ExecutionResult, error) {
	// Execute main order
	result, err := e.Execute(ctx, signal, exchange)
	if err != nil {
		return nil, err
	}
	
	adapter := e.adapters[exchange]
	
	// Place stop loss
	if !signal.StopLoss.IsZero() {
		slOrder := &types.Order{
			ID:        fmt.Sprintf("sl-%s", result.OrderID),
			Symbol:    signal.Symbol,
			Side:      e.oppositeSide(result.Order.Side),
			Type:      types.OrderTypeStopLoss,
			Quantity:  result.FilledQty,
			StopPrice: signal.StopLoss,
			Timestamp: time.Now(),
		}
		
		_, err := adapter.PlaceOrder(ctx, slOrder)
		if err != nil {
			e.logger.Error("Failed to place stop loss", zap.Error(err))
		} else {
			result.StopLossOrderID = slOrder.ID
		}
	}
	
	// Place take profit
	if !signal.TakeProfit.IsZero() {
		tpOrder := &types.Order{
			ID:        fmt.Sprintf("tp-%s", result.OrderID),
			Symbol:    signal.Symbol,
			Side:      e.oppositeSide(result.Order.Side),
			Type:      types.OrderTypeTakeProfit,
			Quantity:  result.FilledQty,
			StopPrice: signal.TakeProfit,
			Timestamp: time.Now(),
		}
		
		_, err := adapter.PlaceOrder(ctx, tpOrder)
		if err != nil {
			e.logger.Error("Failed to place take profit", zap.Error(err))
		} else {
			result.TakeProfitOrderID = tpOrder.ID
		}
	}
	
	return result, nil
}

// ClosePosition closes an existing position.
func (e *Executor) ClosePosition(ctx context.Context, position *types.Position, exchange string) (*ExecutionResult, error) {
	adapter, ok := e.adapters[exchange]
	if !ok {
		return nil, fmt.Errorf("exchange adapter not found: %s", exchange)
	}
	
	// Determine close side
	var side types.OrderSide
	if position.Side == types.PositionSideLong {
		side = types.OrderSideSell
	} else {
		side = types.OrderSideBuy
	}
	
	order := &types.Order{
		ID:        fmt.Sprintf("close-%d", time.Now().UnixNano()),
		Symbol:    position.Symbol,
		Side:      side,
		Type:      types.OrderTypeMarket, // Use market for immediate close
		Quantity:  position.Quantity,
		Timestamp: time.Now(),
	}
	
	if e.config.PaperTrading {
		currentPrice, _ := adapter.GetPrice(ctx, position.Symbol)
		return e.simulateExecution(order, currentPrice, time.Now())
	}
	
	result, err := adapter.PlaceOrder(ctx, order)
	if err != nil {
		return nil, err
	}
	
	return &ExecutionResult{
		OrderID:   result.OrderID,
		Order:     order,
		Exchange:  exchange,
		Status:    result.Status,
		FilledQty: result.FilledQty,
		AvgPrice:  result.AvgPrice,
		Timestamp: time.Now(),
	}, nil
}

// ActivateKillSwitch activates the kill switch, stopping all trading.
func (e *Executor) ActivateKillSwitch() {
	e.mu.Lock()
	defer e.mu.Unlock()
	
	e.killSwitch = true
	e.logger.Error("KILL SWITCH ACTIVATED - All trading stopped")
}

// DeactivateKillSwitch deactivates the kill switch.
func (e *Executor) DeactivateKillSwitch() {
	e.mu.Lock()
	defer e.mu.Unlock()
	
	e.killSwitch = false
	e.logger.Info("Kill switch deactivated")
}

// IsKillSwitchActive returns whether the kill switch is active.
func (e *Executor) IsKillSwitchActive() bool {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.killSwitch
}

// GetMetrics returns execution metrics.
func (e *Executor) GetMetrics() ExecutorMetrics {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.metrics
}

// validateSignal validates a signal before execution.
func (e *Executor) validateSignal(signal *types.Signal) error {
	if signal == nil {
		return fmt.Errorf("signal is nil")
	}
	
	if signal.Symbol == "" {
		return fmt.Errorf("signal missing symbol")
	}
	
	if signal.Direction == types.SignalHold {
		return fmt.Errorf("signal is HOLD, nothing to execute")
	}
	
	// Check signal age
	maxAge := 5 * time.Minute
	if time.Since(signal.Timestamp) > maxAge {
		return fmt.Errorf("signal too old: %v", time.Since(signal.Timestamp))
	}
	
	// Check confidence threshold
	minConfidence := decimal.NewFromFloat(0.5)
	if signal.Confidence.LessThan(minConfidence) {
		return fmt.Errorf("signal confidence %s below minimum %s", signal.Confidence, minConfidence)
	}
	
	return nil
}

// calculateQuantity calculates order quantity.
func (e *Executor) calculateQuantity(signal *types.Signal, currentPrice decimal.Decimal) decimal.Decimal {
	// If signal specifies quantity, use it
	if !signal.Quantity.IsZero() {
		return signal.Quantity
	}
	
	// Default to max order size in quote currency divided by price
	if !currentPrice.IsZero() {
		quantity := e.config.MaxOrderSize.Div(currentPrice)
		
		// Apply position sizing from signal strength
		quantity = quantity.Mul(signal.Strength)
		
		return quantity
	}
	
	return decimal.Zero
}

// simulateExecution simulates order execution for paper trading.
func (e *Executor) simulateExecution(order *types.Order, currentPrice decimal.Decimal, startTime time.Time) (*ExecutionResult, error) {
	// Simulate some slippage
	simulatedSlippage := e.config.DefaultSlippage.Mul(decimal.NewFromFloat(0.5))
	
	fillPrice := currentPrice
	if order.Side == types.OrderSideBuy {
		fillPrice = currentPrice.Mul(decimal.NewFromInt(1).Add(simulatedSlippage))
	} else {
		fillPrice = currentPrice.Mul(decimal.NewFromInt(1).Sub(simulatedSlippage))
	}
	
	// Simulate commission (0.1%)
	commission := order.Quantity.Mul(fillPrice).Mul(decimal.NewFromFloat(0.001))
	
	e.updateMetrics(true, simulatedSlippage, time.Since(startTime))
	
	return &ExecutionResult{
		OrderID:    order.ID,
		Order:      order,
		Exchange:   "paper",
		Status:     "FILLED",
		FilledQty:  order.Quantity,
		AvgPrice:   fillPrice,
		Commission: commission,
		Slippage:   simulatedSlippage,
		Latency:    time.Since(startTime),
		Timestamp:  time.Now(),
		IsPaper:    true,
	}, nil
}

// updateMetrics updates execution metrics.
func (e *Executor) updateMetrics(success bool, slippage decimal.Decimal, latency time.Duration) {
	e.mu.Lock()
	defer e.mu.Unlock()
	
	e.metrics.TotalOrders++
	if success {
		e.metrics.SuccessfulOrders++
	} else {
		e.metrics.FailedOrders++
	}
	
	// Update average slippage
	if e.metrics.SuccessfulOrders > 0 {
		weight := decimal.NewFromInt(int64(e.metrics.SuccessfulOrders - 1))
		e.metrics.AvgSlippage = e.metrics.AvgSlippage.Mul(weight).Add(slippage).Div(decimal.NewFromInt(int64(e.metrics.SuccessfulOrders)))
	}
	
	// Update average latency
	if e.metrics.SuccessfulOrders > 0 {
		e.metrics.AvgLatency = time.Duration(
			(int64(e.metrics.AvgLatency)*int64(e.metrics.SuccessfulOrders-1) + int64(latency)) /
				int64(e.metrics.SuccessfulOrders),
		)
	}
	
	e.metrics.LastOrderTime = time.Now()
}

// oppositeSide returns the opposite order side.
func (e *Executor) oppositeSide(side types.OrderSide) types.OrderSide {
	if side == types.OrderSideBuy {
		return types.OrderSideSell
	}
	return types.OrderSideBuy
}

// ExecutionResult contains the result of signal execution.
type ExecutionResult struct {
	OrderID           string          `json:"orderId"`
	Signal            *types.Signal   `json:"signal"`
	Order             *types.Order    `json:"order"`
	Exchange          string          `json:"exchange"`
	Status            string          `json:"status"`
	FilledQty         decimal.Decimal `json:"filledQty"`
	AvgPrice          decimal.Decimal `json:"avgPrice"`
	Commission        decimal.Decimal `json:"commission"`
	Slippage          decimal.Decimal `json:"slippage"`
	Latency           time.Duration   `json:"latency"`
	Timestamp         time.Time       `json:"timestamp"`
	IsPaper           bool            `json:"isPaper"`
	StopLossOrderID   string          `json:"stopLossOrderId,omitempty"`
	TakeProfitOrderID string          `json:"takeProfitOrderId,omitempty"`
}
