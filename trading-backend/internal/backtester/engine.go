// Package backtester provides the core event-driven backtesting engine.
package backtester

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/atlas-desktop/trading-backend/internal/backtester/events"
	"github.com/atlas-desktop/trading-backend/pkg/types"
	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"go.uber.org/zap"
)

// Engine is the core event-driven backtesting engine
type Engine struct {
	mu              sync.RWMutex
	logger          *zap.Logger
	config          *types.BacktestConfig
	dataLoader      DataLoader
	slippageModel   SlippageModel
	eventQueue      *events.EventQueue
	portfolio       *Portfolio
	orderManager    *OrderManager
	riskManager     *RiskManager
	metricsCalc     *MetricsCalculator
	
	// State
	running         atomic.Bool
	cancelled       atomic.Bool
	currentTime     time.Time
	eventsProcessed atomic.Uint64
	
	// Results
	trades          []*types.Trade
	equityCurve     []types.EquityCurvePoint
	
	// Progress callback
	progressChan    chan *types.BacktestProgress
}

// DataLoader interface for loading market data
type DataLoader interface {
	LoadOHLCV(ctx context.Context, symbol string, timeframe types.Timeframe, start, end time.Time) ([]*types.OHLCV, error)
	LoadTicks(ctx context.Context, symbol string, start, end time.Time) ([]*types.Tick, error)
	GetAvailableSymbols() []string
	GetDataRange(symbol string) (start, end time.Time, err error)
}

// SlippageModel interface for slippage calculation
type SlippageModel interface {
	Calculate(order *types.Order, marketData *events.MarketDataEvent) decimal.Decimal
}

// NewEngine creates a new backtesting engine
func NewEngine(logger *zap.Logger, dataLoader DataLoader, slippageModel SlippageModel) *Engine {
	return &Engine{
		logger:        logger,
		dataLoader:    dataLoader,
		slippageModel: slippageModel,
		eventQueue:    events.NewEventQueue(),
		trades:        make([]*types.Trade, 0),
		equityCurve:   make([]types.EquityCurvePoint, 0),
		progressChan:  make(chan *types.BacktestProgress, 100),
	}
}

// Run executes a backtest with the given configuration
func (e *Engine) Run(ctx context.Context, config *types.BacktestConfig) (*types.BacktestResult, error) {
	e.mu.Lock()
	if e.running.Load() {
		e.mu.Unlock()
		return nil, fmt.Errorf("backtest already running")
	}
	e.running.Store(true)
	e.cancelled.Store(false)
	e.mu.Unlock()

	defer func() {
		e.running.Store(false)
	}()

	startTime := time.Now()
	e.config = config

	// Initialize components
	e.portfolio = NewPortfolio(config.InitialCapital)
	e.orderManager = NewOrderManager(e.logger, config.Commission)
	e.riskManager = NewRiskManager(e.logger, &config.RiskLimits)
	e.metricsCalc = NewMetricsCalculator()

	// Reset state
	e.trades = e.trades[:0]
	e.equityCurve = e.equityCurve[:0]
	e.eventsProcessed.Store(0)
	e.eventQueue.Clear()

	// Load market data and create events
	totalEvents, err := e.loadMarketData(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("failed to load market data: %w", err)
	}

	e.logger.Info("Starting backtest",
		zap.String("id", config.ID),
		zap.Int("symbols", len(config.Symbols)),
		zap.Uint64("totalEvents", totalEvents),
	)

	// Main event loop
	for e.eventQueue.Len() > 0 {
		// Check for cancellation
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		if e.cancelled.Load() {
			return nil, fmt.Errorf("backtest cancelled")
		}

		event := e.eventQueue.Pop()
		e.currentTime = event.GetTimestamp()
		e.eventsProcessed.Add(1)

		if err := e.processEvent(event); err != nil {
			e.logger.Error("Error processing event",
				zap.Error(err),
				zap.String("eventType", string(event.GetType())),
			)
		}

		// Send progress updates periodically
		if e.eventsProcessed.Load()%10000 == 0 {
			e.sendProgress(totalEvents)
		}
	}

	// Calculate final metrics
	metrics := e.metricsCalc.Calculate(e.trades, e.equityCurve, e.config.InitialCapital)
	riskMetrics := e.metricsCalc.CalculateRiskMetrics(e.equityCurve)

	// Build result
	result := &types.BacktestResult{
		ID:              config.ID,
		Config:          config,
		Metrics:         metrics,
		RiskMetrics:     riskMetrics,
		EquityCurve:     e.equityCurve,
		Trades:          e.tradesToTypes(),
		StartedAt:       startTime,
		CompletedAt:     time.Now(),
		Duration:        time.Since(startTime),
		EventsProcessed: e.eventsProcessed.Load(),
	}

	// Run Monte Carlo if configured
	if config.Validation.MonteCarlo.Enabled {
		mcResult := e.runMonteCarlo(config.Validation.MonteCarlo)
		result.MonteCarloResult = mcResult
	}

	// Run walk-forward if configured
	if config.Validation.WalkForward.Enabled {
		wfResult, err := e.runWalkForward(ctx, config)
		if err != nil {
			e.logger.Warn("Walk-forward analysis failed", zap.Error(err))
		} else {
			result.WalkForwardResult = wfResult
		}
	}

	e.logger.Info("Backtest completed",
		zap.String("id", config.ID),
		zap.Duration("duration", result.Duration),
		zap.Int("trades", len(result.Trades)),
		zap.String("totalReturn", metrics.TotalReturn.String()),
	)

	return result, nil
}

// Cancel cancels a running backtest
func (e *Engine) Cancel() {
	e.cancelled.Store(true)
}

// GetProgress returns the current progress
func (e *Engine) GetProgress() *types.BacktestProgress {
	e.mu.RLock()
	defer e.mu.RUnlock()

	status := "idle"
	if e.running.Load() {
		status = "running"
	}

	return &types.BacktestProgress{
		ID:              e.config.ID,
		Status:          status,
		EventsProcessed: e.eventsProcessed.Load(),
		CurrentDate:     e.currentTime,
		TradesExecuted:  len(e.trades),
		CurrentEquity:   e.portfolio.GetEquity(),
	}
}

// ProgressChan returns the progress channel
func (e *Engine) ProgressChan() <-chan *types.BacktestProgress {
	return e.progressChan
}

// loadMarketData loads all market data and creates events
func (e *Engine) loadMarketData(ctx context.Context, config *types.BacktestConfig) (uint64, error) {
	var totalEvents uint64

	for _, symbol := range config.Symbols {
		ohlcv, err := e.dataLoader.LoadOHLCV(ctx, symbol, config.Timeframe, config.StartDate, config.EndDate)
		if err != nil {
			return 0, fmt.Errorf("failed to load data for %s: %w", symbol, err)
		}

		for _, bar := range ohlcv {
			event := &events.MarketDataEvent{
				BaseEvent: events.BaseEvent{
					Type:      events.EventTypeMarketData,
					Timestamp: bar.Timestamp,
					Priority:  1,
				},
				Symbol: symbol,
				OHLCV:  bar,
			}
			e.eventQueue.Push(event)
			totalEvents++
		}
	}

	return totalEvents, nil
}

// processEvent handles a single event
func (e *Engine) processEvent(event events.Event) error {
	switch ev := event.(type) {
	case *events.MarketDataEvent:
		return e.handleMarketData(ev)
	case *events.SignalEvent:
		return e.handleSignal(ev)
	case *events.OrderEvent:
		return e.handleOrder(ev)
	case *events.FillEvent:
		return e.handleFill(ev)
	case *events.RiskEvent:
		return e.handleRisk(ev)
	case *events.KillSwitchEvent:
		return e.handleKillSwitch(ev)
	default:
		return nil
	}
}

// handleMarketData processes market data events
func (e *Engine) handleMarketData(event *events.MarketDataEvent) error {
	// Update portfolio with current prices
	if event.OHLCV != nil {
		e.portfolio.UpdatePrice(event.Symbol, event.OHLCV.Close)
	}

	// Generate signals from strategy
	signal := e.generateSignal(event)
	if signal != nil {
		signalEvent := &events.SignalEvent{
			BaseEvent: events.BaseEvent{
				Type:      events.EventTypeSignal,
				Timestamp: event.Timestamp,
				Priority:  2,
			},
			Signal: signal,
		}
		e.eventQueue.Push(signalEvent)
	}

	// Check pending orders for fills
	fills := e.orderManager.CheckFills(event)
	for _, fill := range fills {
		e.eventQueue.Push(fill)
	}

	// Record equity curve
	e.equityCurve = append(e.equityCurve, types.EquityCurvePoint{
		Timestamp: event.Timestamp,
		Equity:    e.portfolio.GetEquity(),
		Cash:      e.portfolio.GetCash(),
		Drawdown:  e.portfolio.GetDrawdown(),
	})

	// Check risk limits
	riskEvent := e.riskManager.Check(e.portfolio)
	if riskEvent != nil {
		e.eventQueue.Push(riskEvent)
	}

	return nil
}

// handleSignal processes signal events
func (e *Engine) handleSignal(event *events.SignalEvent) error {
	signal := event.Signal

	// Check if signal passes risk filters
	if !e.riskManager.AllowSignal(signal, e.portfolio) {
		return nil
	}

	// Calculate position size
	positionSize := e.calculatePositionSize(signal)
	if positionSize.IsZero() {
		return nil
	}

	// Create order
	orderType := types.OrderTypeMarket
	var price decimal.Decimal

	// Use limit order if signal has specific price
	if !signal.Price.IsZero() {
		orderType = types.OrderTypeLimit
		price = signal.Price
	}

	order := &types.Order{
		ID:        uuid.New().String(),
		Symbol:    signal.Symbol,
		Side:      signal.Side,
		Type:      orderType,
		Quantity:  positionSize,
		Price:     price,
		Status:    types.OrderStatusPending,
		CreatedAt: event.Timestamp,
		UpdatedAt: event.Timestamp,
	}

	orderEvent := &events.OrderEvent{
		BaseEvent: events.BaseEvent{
			Type:      events.EventTypeOrder,
			Timestamp: event.Timestamp,
			Priority:  3,
		},
		Order: order,
	}
	e.eventQueue.Push(orderEvent)

	return nil
}

// handleOrder processes order events
func (e *Engine) handleOrder(event *events.OrderEvent) error {
	e.orderManager.Submit(event.Order)
	return nil
}

// handleFill processes fill events
func (e *Engine) handleFill(event *events.FillEvent) error {
	// Update portfolio
	if event.Side == types.OrderSideBuy {
		e.portfolio.Buy(event.Symbol, event.Quantity, event.Price, event.Commission)
	} else {
		pnl := e.portfolio.Sell(event.Symbol, event.Quantity, event.Price, event.Commission)
		
		// Record trade
		trade := &types.Trade{
			ID:         uuid.New().String(),
			OrderID:    event.OrderID,
			Symbol:     event.Symbol,
			Side:       event.Side,
			Quantity:   event.Quantity,
			Price:      event.Price,
			Commission: event.Commission,
			Slippage:   event.Slippage,
			PnL:        pnl,
			ExecutedAt: event.Timestamp,
		}
		e.trades = append(e.trades, trade)
	}

	return nil
}

// handleRisk processes risk events
func (e *Engine) handleRisk(event *events.RiskEvent) error {
	e.logger.Warn("Risk limit breached",
		zap.String("type", event.RiskType),
		zap.String("threshold", event.Threshold.String()),
		zap.String("current", event.Current.String()),
	)
	return nil
}

// handleKillSwitch processes kill switch events
func (e *Engine) handleKillSwitch(event *events.KillSwitchEvent) error {
	e.logger.Error("Kill switch triggered",
		zap.String("reason", event.Reason),
		zap.String("trigger", event.TriggerType),
	)
	// Close all positions
	e.portfolio.CloseAll(e.currentTime)
	return nil
}

// generateSignal generates trading signals from market data
func (e *Engine) generateSignal(event *events.MarketDataEvent) *types.Signal {
	// This would be replaced with actual strategy logic
	// For now, return nil (no signal)
	return nil
}

// calculatePositionSize calculates position size for a signal
func (e *Engine) calculatePositionSize(signal *types.Signal) decimal.Decimal {
	equity := e.portfolio.GetEquity()
	maxPositionPct := e.config.RiskLimits.MaxPositionSize
	
	// Simple fixed fractional sizing
	positionValue := equity.Mul(maxPositionPct)
	if signal.Price.IsZero() {
		return decimal.Zero
	}
	
	return positionValue.Div(signal.Price)
}

// sendProgress sends a progress update
func (e *Engine) sendProgress(totalEvents uint64) {
	progress := e.eventsProcessed.Load()
	pct := float64(progress) / float64(totalEvents) * 100

	update := &types.BacktestProgress{
		ID:              e.config.ID,
		Status:          "running",
		Progress:        pct,
		EventsProcessed: progress,
		TotalEvents:     totalEvents,
		CurrentDate:     e.currentTime,
		TradesExecuted:  len(e.trades),
		CurrentEquity:   e.portfolio.GetEquity(),
	}

	select {
	case e.progressChan <- update:
	default:
		// Channel full, skip update
	}
}

// tradesToTypes converts internal trades to types.Trade
func (e *Engine) tradesToTypes() []types.Trade {
	result := make([]types.Trade, len(e.trades))
	for i, t := range e.trades {
		result[i] = *t
	}
	return result
}

// runMonteCarlo runs Monte Carlo simulation
func (e *Engine) runMonteCarlo(config types.MonteCarloConfig) *types.MonteCarloResult {
	mc := NewMonteCarloSimulator(e.logger, config)
	return mc.Run(e.trades)
}

// runWalkForward runs walk-forward analysis
func (e *Engine) runWalkForward(ctx context.Context, config *types.BacktestConfig) (*types.WalkForwardResult, error) {
	wf := NewWalkForwardAnalyzer(e.logger, e.dataLoader, e.slippageModel)
	return wf.Run(ctx, config)
}
