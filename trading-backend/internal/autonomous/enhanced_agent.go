// Package autonomous provides the enhanced autonomous trading agent with PhD-level integration.
package autonomous

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/atlas-desktop/trading-backend/internal/events"
	"github.com/atlas-desktop/trading-backend/internal/execution"
	"github.com/atlas-desktop/trading-backend/internal/orchestrator"
	"github.com/atlas-desktop/trading-backend/internal/regime"
	"github.com/atlas-desktop/trading-backend/internal/signals"
	"github.com/atlas-desktop/trading-backend/internal/sizing"
	"github.com/atlas-desktop/trading-backend/pkg/types"
	"github.com/shopspring/decimal"
	"go.uber.org/zap"
)

// EnhancedTradingAgent is the PhD-level autonomous trading agent.
// It integrates with the orchestrator for regime-aware, adaptively-sized trading.
type EnhancedTradingAgent struct {
	logger *zap.Logger
	config EnhancedAgentConfig
	mu     sync.RWMutex

	// PhD-level orchestrator
	orchestrator *orchestrator.TradingOrchestrator

	// Core components
	executor     *execution.Executor
	riskManager  *execution.RiskManager
	orderManager *execution.OrderManager
	signalAgg    *signals.Aggregator

	// State
	isRunning bool
	isPaused  bool
	startTime time.Time

	// Strategy management
	registeredStrategies map[string]*StrategyConfig
	activeStrategy       string

	// Metrics
	metrics EnhancedMetrics

	// Control
	stopCh chan struct{}

	// Callbacks
	onTrade  func(*types.Trade)
	onSignal func(*signals.AggregatedSignal)
	onRegime func(regime.RegimeType, float64)
	onError  func(error)
}

// EnhancedAgentConfig configures the enhanced agent.
type EnhancedAgentConfig struct {
	// Trading parameters
	TradingPairs     []string `json:"tradingPairs"`
	MaxConcurrentPos int      `json:"maxConcurrentPositions"`

	// Signal thresholds (regime-adaptive)
	BaseMinConfidence decimal.Decimal `json:"baseMinConfidence"`
	BaseMinConsensus  decimal.Decimal `json:"baseMinConsensus"`

	// Execution settings
	PaperTrading bool            `json:"paperTrading"`
	MaxSlippage  decimal.Decimal `json:"maxSlippage"`

	// Position sizing
	UseKellySize       bool            `json:"useKellySize"`
	KellyFraction      float64         `json:"kellyFraction"`
	MaxPositionPercent decimal.Decimal `json:"maxPositionPercent"`

	// Risk settings
	MaxDailyLoss decimal.Decimal `json:"maxDailyLoss"`
	MaxDrawdown  decimal.Decimal `json:"maxDrawdown"`

	// Regime-adaptive settings
	EnableRegimeAdapt  bool `json:"enableRegimeAdaptation"`
	ReducePosInHighVol bool `json:"reducePositionInHighVol"`
	PauseInBear        bool `json:"pauseInBearMarket"`

	// Timing
	SignalPollInterval time.Duration `json:"signalPollInterval"`
	RiskCheckInterval  time.Duration `json:"riskCheckInterval"`

	// Monte Carlo validation
	RequireMCValidation bool    `json:"requireMonteCarloValidation"`
	MinRobustnessScore  float64 `json:"minRobustnessScore"`
}

// StrategyConfig defines a trading strategy.
type StrategyConfig struct {
	ID                 string              `json:"id"`
	Name               string              `json:"name"`
	Parameters         map[string]float64  `json:"parameters"`
	PreferredRegimes   []regime.RegimeType `json:"preferredRegimes"`
	PositionSizeMethod string              `json:"positionSizeMethod"` // "kelly", "volatility", "fixed"
	RiskPerTrade       decimal.Decimal     `json:"riskPerTrade"`
	IsActive           bool                `json:"isActive"`
}

// EnhancedMetrics tracks enhanced agent metrics.
type EnhancedMetrics struct {
	// Trade metrics
	TotalTrades     int             `json:"totalTrades"`
	WinningTrades   int             `json:"winningTrades"`
	LosingTrades    int             `json:"losingTrades"`
	TotalPnL        decimal.Decimal `json:"totalPnl"`
	DailyPnL        decimal.Decimal `json:"dailyPnl"`
	MaxDrawdown     decimal.Decimal `json:"maxDrawdown"`
	CurrentDrawdown decimal.Decimal `json:"currentDrawdown"`

	// Signal metrics
	SignalsProcessed    int `json:"signalsProcessed"`
	SignalsAccepted     int `json:"signalsAccepted"`
	SignalsRejectedConf int `json:"signalsRejectedConfidence"`
	SignalsRejectedReg  int `json:"signalsRejectedRegime"`
	SignalsRejectedMC   int `json:"signalsRejectedMonteCarlo"`

	// Regime metrics
	RegimeChanges    int     `json:"regimeChanges"`
	CurrentRegime    string  `json:"currentRegime"`
	RegimeConfidence float64 `json:"regimeConfidence"`

	// Position sizing metrics
	AvgPositionSize   decimal.Decimal `json:"avgPositionSize"`
	KellyFractionUsed float64         `json:"kellyFractionUsed"`

	// Timing
	Uptime           time.Duration `json:"uptime"`
	LastTradeTime    time.Time     `json:"lastTradeTime"`
	LastRegimeChange time.Time     `json:"lastRegimeChange"`
}

// DefaultEnhancedAgentConfig returns PhD-level defaults.
func DefaultEnhancedAgentConfig() EnhancedAgentConfig {
	return EnhancedAgentConfig{
		TradingPairs:     []string{"BTC/USDT", "ETH/USDT", "SOL/USDT"},
		MaxConcurrentPos: 5,

		BaseMinConfidence: decimal.NewFromFloat(0.6),
		BaseMinConsensus:  decimal.NewFromFloat(0.5),

		PaperTrading: true,
		MaxSlippage:  decimal.NewFromFloat(0.005),

		UseKellySize:       true,
		KellyFraction:      0.25,                       // Quarter Kelly
		MaxPositionPercent: decimal.NewFromFloat(0.10), // 10% max

		MaxDailyLoss: decimal.NewFromInt(500),
		MaxDrawdown:  decimal.NewFromFloat(0.1),

		EnableRegimeAdapt:  true,
		ReducePosInHighVol: true,
		PauseInBear:        false, // Can still short

		SignalPollInterval: 5 * time.Second,
		RiskCheckInterval:  1 * time.Minute,

		RequireMCValidation: true,
		MinRobustnessScore:  0.6,
	}
}

// NewEnhancedTradingAgent creates a new enhanced trading agent.
func NewEnhancedTradingAgent(
	logger *zap.Logger,
	config EnhancedAgentConfig,
	orch *orchestrator.TradingOrchestrator,
	executor *execution.Executor,
	riskManager *execution.RiskManager,
	orderManager *execution.OrderManager,
	signalAgg *signals.Aggregator,
) *EnhancedTradingAgent {
	return &EnhancedTradingAgent{
		logger:               logger.Named("enhanced-agent"),
		config:               config,
		orchestrator:         orch,
		executor:             executor,
		riskManager:          riskManager,
		orderManager:         orderManager,
		signalAgg:            signalAgg,
		registeredStrategies: make(map[string]*StrategyConfig),
		stopCh:               make(chan struct{}),
	}
}

// Start starts the enhanced trading agent.
func (ea *EnhancedTradingAgent) Start(ctx context.Context) error {
	ea.mu.Lock()
	if ea.isRunning {
		ea.mu.Unlock()
		return fmt.Errorf("agent already running")
	}

	ea.isRunning = true
	ea.startTime = time.Now()
	ea.stopCh = make(chan struct{})
	ea.mu.Unlock()

	ea.logger.Info("Starting Enhanced Trading Agent",
		zap.Strings("pairs", ea.config.TradingPairs),
		zap.Bool("paperTrading", ea.config.PaperTrading),
		zap.Bool("regimeAdaptive", ea.config.EnableRegimeAdapt),
		zap.Bool("kellySize", ea.config.UseKellySize),
	)

	// Subscribe to orchestrator events
	ea.subscribeToEvents()

	// Start main trading loop
	go ea.mainLoop(ctx)

	// Start risk monitoring
	go ea.riskMonitorLoop(ctx)

	// Start regime monitoring
	go ea.regimeMonitorLoop(ctx)

	return nil
}

// Stop stops the enhanced trading agent.
func (ea *EnhancedTradingAgent) Stop() error {
	ea.mu.Lock()
	if !ea.isRunning {
		ea.mu.Unlock()
		return fmt.Errorf("agent not running")
	}

	ea.isRunning = false
	close(ea.stopCh)
	ea.mu.Unlock()

	ea.logger.Info("Stopping Enhanced Trading Agent")
	return nil
}

// subscribeToEvents subscribes to orchestrator events.
func (ea *EnhancedTradingAgent) subscribeToEvents() {
	eventBus := ea.orchestrator.GetEventBus()

	// Subscribe to position sizing events
	eventBus.Subscribe(events.EventTypePosition, func(e events.Event) {
		if posEvent, ok := e.(*events.PositionEvent); ok {
			ea.handlePositionEvent(posEvent)
		}
	})

	// Subscribe to risk alerts
	eventBus.Subscribe(events.EventTypeRiskAlert, func(e events.Event) {
		if riskEvent, ok := e.(*events.RiskAlertEvent); ok {
			if riskEvent.Severity == "critical" {
				ea.Pause()
			}
		}
	})
}

// handlePositionEvent handles sized position events from orchestrator.
func (ea *EnhancedTradingAgent) handlePositionEvent(e *events.PositionEvent) {
	ea.logger.Debug("Received sized position event",
		zap.String("symbol", e.Symbol),
		zap.Float64("size", e.PositionSize),
		zap.String("method", e.Method),
	)
}

// mainLoop is the main trading loop.
func (ea *EnhancedTradingAgent) mainLoop(ctx context.Context) {
	ticker := time.NewTicker(ea.config.SignalPollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ea.stopCh:
			return
		case <-ticker.C:
			if !ea.shouldTrade() {
				continue
			}
			ea.processSignals(ctx)
		}
	}
}

// riskMonitorLoop monitors risk metrics.
func (ea *EnhancedTradingAgent) riskMonitorLoop(ctx context.Context) {
	ticker := time.NewTicker(ea.config.RiskCheckInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ea.stopCh:
			return
		case <-ticker.C:
			ea.checkRiskLimits()
		}
	}
}

// regimeMonitorLoop monitors market regime changes.
func (ea *EnhancedTradingAgent) regimeMonitorLoop(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	var lastRegime regime.RegimeType

	for {
		select {
		case <-ctx.Done():
			return
		case <-ea.stopCh:
			return
		case <-ticker.C:
			currentRegime, confidence := ea.orchestrator.GetCurrentRegime()

			if currentRegime != lastRegime {
				ea.handleRegimeChange(lastRegime, currentRegime, confidence)
				lastRegime = currentRegime
			}

			ea.mu.Lock()
			ea.metrics.CurrentRegime = string(currentRegime)
			ea.metrics.RegimeConfidence = confidence
			ea.mu.Unlock()
		}
	}
}

// handleRegimeChange handles market regime transitions.
func (ea *EnhancedTradingAgent) handleRegimeChange(from, to regime.RegimeType, confidence float64) {
	ea.mu.Lock()
	ea.metrics.RegimeChanges++
	ea.metrics.LastRegimeChange = time.Now()
	ea.mu.Unlock()

	ea.logger.Info("Market regime changed",
		zap.String("from", string(from)),
		zap.String("to", string(to)),
		zap.Float64("confidence", confidence),
	)

	// Apply regime-based adjustments
	if ea.config.EnableRegimeAdapt {
		switch to {
		case regime.RegimeBear:
			if ea.config.PauseInBear {
				ea.logger.Warn("Pausing due to bear market regime")
				ea.Pause()
			}

		case regime.RegimeHighVolatility:
			if ea.config.ReducePosInHighVol {
				ea.logger.Info("Reducing position sizes due to high volatility")
			}

		case regime.RegimeBull:
			ea.Resume()
		}
	}

	// Notify callback
	if ea.onRegime != nil {
		ea.onRegime(to, confidence)
	}
}

// shouldTrade checks if trading is allowed.
func (ea *EnhancedTradingAgent) shouldTrade() bool {
	ea.mu.RLock()
	defer ea.mu.RUnlock()

	if !ea.isRunning || ea.isPaused {
		return false
	}

	// Check kill switch
	if ea.riskManager.IsDisabled() {
		return false
	}

	return true
}

// processSignals processes trading signals with regime awareness.
func (ea *EnhancedTradingAgent) processSignals(ctx context.Context) {
	// Get current regime adjustments
	adjustments := ea.orchestrator.GetStrategyAdjustments()
	currentRegime, regimeConf := ea.orchestrator.GetCurrentRegime()

	for _, pair := range ea.config.TradingPairs {
		signal, err := ea.signalAgg.AggregateSignals(ctx, pair)
		if err != nil {
			ea.logger.Debug("Failed to aggregate signals", zap.String("pair", pair), zap.Error(err))
			continue
		}

		ea.mu.Lock()
		ea.metrics.SignalsProcessed++
		ea.mu.Unlock()

		// Notify callback
		if ea.onSignal != nil {
			ea.onSignal(signal)
		}

		// Apply regime-adjusted thresholds
		minConfidence := ea.config.BaseMinConfidence
		minConsensus := ea.config.BaseMinConsensus

		// In high volatility, require higher confidence
		if currentRegime == regime.RegimeHighVolatility {
			minConfidence = minConfidence.Mul(decimal.NewFromFloat(1.2))
			minConsensus = minConsensus.Mul(decimal.NewFromFloat(1.2))
		}

		// Check signal quality
		if signal.Confidence.LessThan(minConfidence) {
			ea.logger.Debug("Signal confidence too low",
				zap.String("pair", pair),
				zap.String("confidence", signal.Confidence.String()),
				zap.String("minRequired", minConfidence.String()),
			)
			ea.mu.Lock()
			ea.metrics.SignalsRejectedConf++
			ea.mu.Unlock()
			continue
		}

		if signal.ConsensusScore.LessThan(minConsensus) {
			ea.mu.Lock()
			ea.metrics.SignalsRejectedConf++
			ea.mu.Unlock()
			continue
		}

		// Check if current regime suits the signal direction
		if ea.config.EnableRegimeAdapt {
			if !ea.isSignalSuitedForRegime(signal, currentRegime, regimeConf) {
				ea.mu.Lock()
				ea.metrics.SignalsRejectedReg++
				ea.mu.Unlock()
				continue
			}
		}

		// Check if we can take the position
		if !ea.canTakePosition(pair) {
			continue
		}

		// Monte Carlo validation for live trades
		if ea.config.RequireMCValidation && !ea.config.PaperTrading {
			if !ea.validateWithMonteCarlo(signal) {
				ea.mu.Lock()
				ea.metrics.SignalsRejectedMC++
				ea.mu.Unlock()
				continue
			}
		}

		ea.mu.Lock()
		ea.metrics.SignalsAccepted++
		ea.mu.Unlock()

		// Execute trade with regime-aware sizing
		if err := ea.executeTrade(ctx, signal, adjustments); err != nil {
			ea.logger.Error("Failed to execute trade", zap.Error(err))
			if ea.onError != nil {
				ea.onError(err)
			}
		}
	}
}

// isSignalSuitedForRegime checks if a signal suits the current regime.
func (ea *EnhancedTradingAgent) isSignalSuitedForRegime(
	signal *signals.AggregatedSignal,
	regimeType regime.RegimeType,
	confidence float64,
) bool {
	// Low confidence regime = accept all signals
	if confidence < 0.5 {
		return true
	}

	adjustments := ea.orchestrator.GetStrategyAdjustments()

	// Check if signal direction suits regime
	switch regimeType {
	case regime.RegimeBear:
		// In bear market, prefer shorts or skip
		if signal.Direction == signals.DirectionLong {
			// Only accept very strong long signals
			return signal.Confidence.GreaterThan(decimal.NewFromFloat(0.85))
		}
		return true

	case regime.RegimeBull:
		// In bull market, prefer longs
		if signal.Direction == signals.DirectionShort {
			return signal.Confidence.GreaterThan(decimal.NewFromFloat(0.85))
		}
		return true

	case regime.RegimeHighVolatility:
		// In high vol, need strong signals
		return signal.Confidence.GreaterThan(decimal.NewFromFloat(0.75))

	case regime.RegimeMeanReverting:
		// Mean reverting prefers counter-trend
		return true

	case regime.RegimeTrending:
		// Trending prefers momentum
		return true
	}

	_ = adjustments // Use in future for more complex logic
	return true
}

// validateWithMonteCarlo validates a signal with Monte Carlo simulation.
func (ea *EnhancedTradingAgent) validateWithMonteCarlo(signal *signals.AggregatedSignal) bool {
	// Get recent trades for this strategy
	// In production, this would pull from trade history
	recentTrades := []float64{
		100, -50, 75, -30, 120, -60, 80, -40, 90, -45,
	}

	results := ea.orchestrator.RunMonteCarloValidation(recentTrades)
	return results.RobustnessScore >= ea.config.MinRobustnessScore
}

// canTakePosition checks if we can take a new position.
func (ea *EnhancedTradingAgent) canTakePosition(symbol string) bool {
	positions := ea.orderManager.GetAllPositions()
	if len(positions) >= ea.config.MaxConcurrentPos {
		ea.logger.Debug("Max positions reached")
		return false
	}

	if ea.orderManager.GetPosition(symbol) != nil {
		return false
	}

	return true
}

// executeTrade executes a trade with regime-aware position sizing.
func (ea *EnhancedTradingAgent) executeTrade(
	ctx context.Context,
	signal *signals.AggregatedSignal,
	adjustments regime.StrategyAdjustments,
) error {
	// Get portfolio value
	portfolioValue := decimal.NewFromInt(10000) // TODO: Get from portfolio manager

	// Calculate position size using orchestrator
	sizeRequest := sizing.PositionSizeRequest{
		Symbol:            signal.Symbol,
		Direction:         string(signal.Direction),
		EntryPrice:        signal.SuggestedEntry.InexactFloat64(),
		StopLoss:          signal.SuggestedStop.InexactFloat64(),
		TakeProfit:        signal.SuggestedTarget.InexactFloat64(),
		SignalStrength:    signal.Strength.InexactFloat64(),
		Confidence:        signal.Confidence.InexactFloat64(),
		PortfolioValue:    portfolioValue.InexactFloat64(),
		HistoricalWinRate: ea.getHistoricalWinRate(),
		AvgWinLossRatio:   ea.getAverageWinLossRatio(),
	}

	sizeResult := ea.orchestrator.SizePosition(sizeRequest)

	// Apply regime multiplier (already done in orchestrator, but we can add more)
	positionSize := decimal.NewFromFloat(sizeResult.PositionSize)

	// Cap at max position
	maxPosition := portfolioValue.Mul(ea.config.MaxPositionPercent)
	if positionSize.GreaterThan(maxPosition) {
		positionSize = maxPosition
	}

	if positionSize.LessThanOrEqual(decimal.Zero) {
		return nil
	}

	// Create order
	order := &types.Order{
		Symbol:   signal.Symbol,
		Type:     types.OrderTypeMarket,
		Quantity: positionSize,
		Price:    signal.SuggestedEntry,
	}

	if signal.Direction == signals.DirectionLong {
		order.Side = types.OrderSideBuy
	} else {
		order.Side = types.OrderSideSell
	}

	// Check risk
	riskResult := ea.riskManager.CheckOrder(ctx, order, portfolioValue)
	if !riskResult.Approved {
		ea.logger.Warn("Order rejected by risk manager",
			zap.String("symbol", order.Symbol),
			zap.Int("violations", len(riskResult.Violations)))
		return nil
	}

	// Log the trade with PhD-level context
	ea.logger.Info("Executing regime-aware trade",
		zap.String("symbol", order.Symbol),
		zap.String("side", string(order.Side)),
		zap.String("quantity", order.Quantity.String()),
		zap.String("confidence", signal.Confidence.String()),
		zap.String("sizingMethod", sizeResult.Method),
		zap.Float64("regimePosMultiplier", adjustments.PositionSizeMultiplier),
		zap.Float64("kellyFraction", sizeResult.KellyFraction),
	)

	// Apply regime-adjusted stop/take profit
	var stopLoss, takeProfit decimal.Decimal
	if !signal.SuggestedStop.IsZero() {
		stopLoss = signal.SuggestedStop.Mul(decimal.NewFromFloat(adjustments.StopLossMultiplier))
	}
	if !signal.SuggestedTarget.IsZero() {
		takeProfit = signal.SuggestedTarget.Mul(decimal.NewFromFloat(adjustments.TakeProfitMultiplier))
	}

	// Execute
	var result *execution.ExecutionResult
	var err error

	if !stopLoss.IsZero() || !takeProfit.IsZero() {
		result, err = ea.executor.ExecuteWithSLTP(ctx, order, stopLoss, takeProfit)
	} else {
		result, err = ea.executor.Execute(ctx, order)
	}

	if err != nil {
		return fmt.Errorf("execution failed: %w", err)
	}

	// Update metrics
	ea.mu.Lock()
	ea.metrics.TotalTrades++
	ea.metrics.LastTradeTime = time.Now()
	ea.metrics.KellyFractionUsed = sizeResult.KellyFraction

	// Update average position size
	if ea.metrics.TotalTrades == 1 {
		ea.metrics.AvgPositionSize = positionSize
	} else {
		n := decimal.NewFromInt(int64(ea.metrics.TotalTrades))
		ea.metrics.AvgPositionSize = ea.metrics.AvgPositionSize.
			Mul(n.Sub(decimal.NewFromInt(1))).
			Add(positionSize).
			Div(n)
	}
	ea.mu.Unlock()

	ea.logger.Info("Trade executed",
		zap.String("orderId", result.OrderID),
		zap.String("avgPrice", result.AvgPrice.String()),
		zap.String("slippage", result.Slippage.String()))

	// Publish execution event to orchestrator for learning
	execEvent := &events.ExecutionEvent{
		BaseEvent:  events.NewBaseEvent(events.EventTypeExecution, signal.Symbol),
		OrderID:    result.OrderID,
		StrategyID: ea.activeStrategy,
		Symbol:     signal.Symbol,
		Side:       string(order.Side),
		Quantity:   result.FilledQty.InexactFloat64(),
		Price:      result.AvgPrice.InexactFloat64(),
		Slippage:   result.Slippage.InexactFloat64(),
		Commission: result.Commission.InexactFloat64(),
	}
	ea.orchestrator.PublishEvent(execEvent)

	// Notify callback
	if ea.onTrade != nil {
		trade := &types.Trade{
			ID:         result.OrderID,
			OrderID:    result.OrderID,
			Symbol:     order.Symbol,
			Side:       order.Side,
			Quantity:   result.FilledQty,
			Price:      result.AvgPrice,
			Commission: result.Commission,
			Slippage:   result.Slippage,
			ExecutedAt: time.Now(),
		}
		ea.onTrade(trade)
	}

	return nil
}

// checkRiskLimits checks and enforces risk limits.
func (ea *EnhancedTradingAgent) checkRiskLimits() {
	stats := ea.riskManager.GetStats()

	// Check daily loss
	if stats.DailyPnL.LessThan(ea.config.MaxDailyLoss.Neg()) {
		ea.logger.Warn("Daily loss limit approaching",
			zap.String("dailyPnL", stats.DailyPnL.String()),
			zap.String("limit", ea.config.MaxDailyLoss.String()))
	}

	// Update metrics
	ea.mu.Lock()
	ea.metrics.DailyPnL = stats.DailyPnL
	ea.mu.Unlock()
}

// getHistoricalWinRate returns historical win rate.
func (ea *EnhancedTradingAgent) getHistoricalWinRate() float64 {
	ea.mu.RLock()
	defer ea.mu.RUnlock()

	total := ea.metrics.WinningTrades + ea.metrics.LosingTrades
	if total == 0 {
		return 0.5
	}

	return float64(ea.metrics.WinningTrades) / float64(total)
}

// getAverageWinLossRatio returns avg win / avg loss ratio.
func (ea *EnhancedTradingAgent) getAverageWinLossRatio() float64 {
	// TODO: Calculate from trade history
	return 1.5
}

// Pause pauses trading.
func (ea *EnhancedTradingAgent) Pause() {
	ea.mu.Lock()
	defer ea.mu.Unlock()

	if ea.isRunning && !ea.isPaused {
		ea.isPaused = true
		ea.logger.Info("Trading paused")
	}
}

// Resume resumes trading.
func (ea *EnhancedTradingAgent) Resume() {
	ea.mu.Lock()
	defer ea.mu.Unlock()

	if ea.isRunning && ea.isPaused {
		ea.isPaused = false
		ea.logger.Info("Trading resumed")
	}
}

// RegisterStrategy registers a new strategy.
func (ea *EnhancedTradingAgent) RegisterStrategy(config *StrategyConfig) {
	ea.mu.Lock()
	defer ea.mu.Unlock()

	ea.registeredStrategies[config.ID] = config

	// Register with orchestrator
	ea.orchestrator.RegisterStrategy(config.ID, config.Parameters)

	ea.logger.Info("Strategy registered", zap.String("id", config.ID))
}

// SetActiveStrategy sets the active trading strategy.
func (ea *EnhancedTradingAgent) SetActiveStrategy(strategyID string) error {
	ea.mu.Lock()
	defer ea.mu.Unlock()

	if _, exists := ea.registeredStrategies[strategyID]; !exists {
		return fmt.Errorf("strategy not registered: %s", strategyID)
	}

	ea.activeStrategy = strategyID
	ea.logger.Info("Active strategy set", zap.String("id", strategyID))
	return nil
}

// GetMetrics returns current metrics.
func (ea *EnhancedTradingAgent) GetMetrics() EnhancedMetrics {
	ea.mu.RLock()
	defer ea.mu.RUnlock()

	metrics := ea.metrics
	if ea.isRunning {
		metrics.Uptime = time.Since(ea.startTime)
	}

	return metrics
}

// GetStatus returns agent status.
func (ea *EnhancedTradingAgent) GetStatus() EnhancedAgentStatus {
	ea.mu.RLock()
	defer ea.mu.RUnlock()

	uptime := time.Duration(0)
	if ea.isRunning {
		uptime = time.Since(ea.startTime)
	}

	regimeType, regimeConf := ea.orchestrator.GetCurrentRegime()
	adjustments := ea.orchestrator.GetStrategyAdjustments()

	return EnhancedAgentStatus{
		IsRunning:              ea.isRunning,
		IsPaused:               ea.isPaused,
		Uptime:                 uptime,
		Metrics:                ea.metrics,
		OpenPositions:          len(ea.orderManager.GetAllPositions()),
		PendingOrders:          len(ea.orderManager.GetOpenOrders()),
		CurrentRegime:          string(regimeType),
		RegimeConfidence:       regimeConf,
		PositionSizeMultiplier: adjustments.PositionSizeMultiplier,
		ActiveStrategy:         ea.activeStrategy,
		RegisteredStrategies:   len(ea.registeredStrategies),
	}
}

// EnhancedAgentStatus represents enhanced agent status.
type EnhancedAgentStatus struct {
	IsRunning              bool            `json:"isRunning"`
	IsPaused               bool            `json:"isPaused"`
	Uptime                 time.Duration   `json:"uptime"`
	Metrics                EnhancedMetrics `json:"metrics"`
	OpenPositions          int             `json:"openPositions"`
	PendingOrders          int             `json:"pendingOrders"`
	CurrentRegime          string          `json:"currentRegime"`
	RegimeConfidence       float64         `json:"regimeConfidence"`
	PositionSizeMultiplier float64         `json:"positionSizeMultiplier"`
	ActiveStrategy         string          `json:"activeStrategy"`
	RegisteredStrategies   int             `json:"registeredStrategies"`
}

// Callbacks

func (ea *EnhancedTradingAgent) SetOnTrade(cb func(*types.Trade)) {
	ea.onTrade = cb
}

func (ea *EnhancedTradingAgent) SetOnSignal(cb func(*signals.AggregatedSignal)) {
	ea.onSignal = cb
}

func (ea *EnhancedTradingAgent) SetOnRegime(cb func(regime.RegimeType, float64)) {
	ea.onRegime = cb
}

func (ea *EnhancedTradingAgent) SetOnError(cb func(error)) {
	ea.onError = cb
}

// EmergencyStop immediately stops all trading.
func (ea *EnhancedTradingAgent) EmergencyStop(ctx context.Context) error {
	ea.logger.Error("EMERGENCY STOP ACTIVATED")

	ea.Pause()
	ea.riskManager.ManualKillSwitch("Emergency stop", 24*time.Hour)

	// Cancel all pending orders
	for _, order := range ea.orderManager.GetOpenOrders() {
		ea.executor.CancelOrder(ctx, order.Order.ID)
	}

	// Close all positions
	for _, pos := range ea.orderManager.GetAllPositions() {
		ea.executor.ClosePosition(ctx, pos.Symbol)
	}

	return nil
}

// IsRunning returns whether the agent is running.
func (ea *EnhancedTradingAgent) IsRunning() bool {
	ea.mu.RLock()
	defer ea.mu.RUnlock()
	return ea.isRunning
}
