// Package autonomous provides the autonomous trading agent.
package autonomous

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/atlas-desktop/trading-backend/internal/execution"
	"github.com/atlas-desktop/trading-backend/internal/signals"
	"github.com/atlas-desktop/trading-backend/pkg/types"
	"github.com/shopspring/decimal"
	"go.uber.org/zap"
)

// TradingAgent is the main autonomous trading agent.
type TradingAgent struct {
	logger       *zap.Logger
	config       AgentConfig
	mu           sync.RWMutex
	
	// Core components
	executor     *execution.Executor
	riskManager  *execution.RiskManager
	orderManager *execution.OrderManager
	signalAgg    *signals.SignalAggregator
	
	// State
	isRunning    bool
	isPaused     bool
	startTime    time.Time
	
	// Metrics
	metrics      AgentMetrics
	
	// Control
	stopChan     chan struct{}
	pauseChan    chan struct{}
	resumeChan   chan struct{}
	
	// Event callbacks
	onTrade      func(*types.Trade)
	onSignal     func(*signals.AggregatedSignal)
	onError      func(error)
}

// AgentConfig contains agent configuration.
type AgentConfig struct {
	// Trading parameters
	TradingPairs     []string          `json:"tradingPairs"`
	MaxConcurrentPos int               `json:"maxConcurrentPositions"`
	PositionSizing   PositionSizing    `json:"positionSizing"`
	
	// Signal thresholds
	MinSignalConfidence decimal.Decimal `json:"minSignalConfidence"`
	MinConsensusScore   decimal.Decimal `json:"minConsensusScore"`
	
	// Execution settings
	UseSlippage      bool            `json:"useSlippage"`
	MaxSlippage      decimal.Decimal `json:"maxSlippage"`
	PaperTrading     bool            `json:"paperTrading"`
	
	// Risk settings
	MaxDailyLoss     decimal.Decimal `json:"maxDailyLoss"`
	MaxDrawdown      decimal.Decimal `json:"maxDrawdown"`
	
	// Timing
	SignalPollInterval time.Duration `json:"signalPollInterval"`
	RiskCheckInterval  time.Duration `json:"riskCheckInterval"`
	
	// Hours
	TradingHours     *TradingHours   `json:"tradingHours,omitempty"`
}

// PositionSizing defines position sizing strategy.
type PositionSizing struct {
	Strategy       string          `json:"strategy"` // "fixed", "percent", "kelly", "volatility"
	FixedSize      decimal.Decimal `json:"fixedSize,omitempty"`
	PercentRisk    decimal.Decimal `json:"percentRisk,omitempty"`
	KellyFraction  decimal.Decimal `json:"kellyFraction,omitempty"`
}

// TradingHours defines allowed trading hours.
type TradingHours struct {
	Start     string   `json:"start"`     // "09:00"
	End       string   `json:"end"`       // "17:00"
	Timezone  string   `json:"timezone"`  // "America/New_York"
	TradeDays []int    `json:"tradeDays"` // 1=Monday, 7=Sunday
}

// AgentMetrics contains agent performance metrics.
type AgentMetrics struct {
	TotalTrades      int             `json:"totalTrades"`
	WinningTrades    int             `json:"winningTrades"`
	LosingTrades     int             `json:"losingTrades"`
	TotalPnL         decimal.Decimal `json:"totalPnl"`
	DailyPnL         decimal.Decimal `json:"dailyPnl"`
	MaxDrawdown      decimal.Decimal `json:"maxDrawdown"`
	CurrentDrawdown  decimal.Decimal `json:"currentDrawdown"`
	SignalsProcessed int             `json:"signalsProcessed"`
	SignalsAccepted  int             `json:"signalsAccepted"`
	SignalsRejected  int             `json:"signalsRejected"`
	Uptime           time.Duration   `json:"uptime"`
	LastTradeTime    time.Time       `json:"lastTradeTime,omitempty"`
}

// AgentStatus represents the agent's current status.
type AgentStatus struct {
	IsRunning    bool            `json:"isRunning"`
	IsPaused     bool            `json:"isPaused"`
	Uptime       time.Duration   `json:"uptime"`
	Metrics      AgentMetrics    `json:"metrics"`
	OpenPositions int            `json:"openPositions"`
	PendingOrders int            `json:"pendingOrders"`
	RiskStatus   *RiskStatus     `json:"riskStatus"`
}

// RiskStatus contains current risk status.
type RiskStatus struct {
	DailyPnL          decimal.Decimal `json:"dailyPnl"`
	DailyLimit        decimal.Decimal `json:"dailyLimit"`
	DailyUsage        decimal.Decimal `json:"dailyUsage"` // Percentage of limit used
	IsKillSwitchActive bool           `json:"isKillSwitchActive"`
	OpenRisk          decimal.Decimal `json:"openRisk"`
}

// DefaultAgentConfig returns default agent configuration.
func DefaultAgentConfig() AgentConfig {
	return AgentConfig{
		TradingPairs:        []string{"BTC/USDT", "ETH/USDT", "SOL/USDT"},
		MaxConcurrentPos:    5,
		PositionSizing: PositionSizing{
			Strategy:    "percent",
			PercentRisk: decimal.NewFromFloat(0.02), // 2% risk per trade
		},
		MinSignalConfidence: decimal.NewFromFloat(0.6),
		MinConsensusScore:   decimal.NewFromFloat(0.5),
		UseSlippage:         true,
		MaxSlippage:         decimal.NewFromFloat(0.005), // 0.5%
		PaperTrading:        true,
		MaxDailyLoss:        decimal.NewFromInt(500),
		MaxDrawdown:         decimal.NewFromFloat(0.1), // 10%
		SignalPollInterval:  5 * time.Second,
		RiskCheckInterval:   1 * time.Minute,
	}
}

// NewTradingAgent creates a new trading agent.
func NewTradingAgent(
	logger *zap.Logger,
	config AgentConfig,
	executor *execution.Executor,
	riskManager *execution.RiskManager,
	orderManager *execution.OrderManager,
	signalAgg *signals.SignalAggregator,
) *TradingAgent {
	return &TradingAgent{
		logger:       logger.Named("trading-agent"),
		config:       config,
		executor:     executor,
		riskManager:  riskManager,
		orderManager: orderManager,
		signalAgg:    signalAgg,
		stopChan:     make(chan struct{}),
		pauseChan:    make(chan struct{}),
		resumeChan:   make(chan struct{}),
	}
}

// Start starts the trading agent.
func (ta *TradingAgent) Start(ctx context.Context) error {
	ta.mu.Lock()
	if ta.isRunning {
		ta.mu.Unlock()
		return fmt.Errorf("agent already running")
	}
	
	ta.isRunning = true
	ta.startTime = time.Now()
	ta.stopChan = make(chan struct{})
	ta.mu.Unlock()
	
	ta.logger.Info("Starting trading agent",
		zap.Strings("pairs", ta.config.TradingPairs),
		zap.Bool("paperTrading", ta.config.PaperTrading))
	
	// Start main trading loop
	go ta.mainLoop(ctx)
	
	// Start risk monitoring
	go ta.riskMonitorLoop(ctx)
	
	return nil
}

// Stop stops the trading agent.
func (ta *TradingAgent) Stop() error {
	ta.mu.Lock()
	if !ta.isRunning {
		ta.mu.Unlock()
		return fmt.Errorf("agent not running")
	}
	
	ta.isRunning = false
	close(ta.stopChan)
	ta.mu.Unlock()
	
	ta.logger.Info("Stopping trading agent")
	
	return nil
}

// Pause pauses trading (keeps monitoring).
func (ta *TradingAgent) Pause() {
	ta.mu.Lock()
	defer ta.mu.Unlock()
	
	if ta.isRunning && !ta.isPaused {
		ta.isPaused = true
		ta.logger.Info("Trading paused")
	}
}

// Resume resumes trading.
func (ta *TradingAgent) Resume() {
	ta.mu.Lock()
	defer ta.mu.Unlock()
	
	if ta.isRunning && ta.isPaused {
		ta.isPaused = false
		ta.logger.Info("Trading resumed")
	}
}

// mainLoop is the main trading loop.
func (ta *TradingAgent) mainLoop(ctx context.Context) {
	ticker := time.NewTicker(ta.config.SignalPollInterval)
	defer ticker.Stop()
	
	for {
		select {
		case <-ctx.Done():
			return
		case <-ta.stopChan:
			return
		case <-ticker.C:
			if !ta.shouldTrade() {
				continue
			}
			
			ta.processSignals(ctx)
		}
	}
}

// riskMonitorLoop monitors risk metrics.
func (ta *TradingAgent) riskMonitorLoop(ctx context.Context) {
	ticker := time.NewTicker(ta.config.RiskCheckInterval)
	defer ticker.Stop()
	
	for {
		select {
		case <-ctx.Done():
			return
		case <-ta.stopChan:
			return
		case <-ticker.C:
			ta.checkRiskLimits()
		}
	}
}

// shouldTrade checks if trading is allowed.
func (ta *TradingAgent) shouldTrade() bool {
	ta.mu.RLock()
	defer ta.mu.RUnlock()
	
	if !ta.isRunning || ta.isPaused {
		return false
	}
	
	// Check kill switch
	if ta.riskManager.IsDisabled() {
		return false
	}
	
	// Check trading hours
	if ta.config.TradingHours != nil && !ta.isWithinTradingHours() {
		return false
	}
	
	return true
}

// isWithinTradingHours checks if current time is within trading hours.
func (ta *TradingAgent) isWithinTradingHours() bool {
	if ta.config.TradingHours == nil {
		return true
	}
	
	now := time.Now()
	
	// Check day of week
	weekday := int(now.Weekday())
	if weekday == 0 {
		weekday = 7 // Sunday = 7
	}
	
	dayAllowed := false
	for _, d := range ta.config.TradingHours.TradeDays {
		if d == weekday {
			dayAllowed = true
			break
		}
	}
	if !dayAllowed {
		return false
	}
	
	// Check time
	startTime, _ := time.Parse("15:04", ta.config.TradingHours.Start)
	endTime, _ := time.Parse("15:04", ta.config.TradingHours.End)
	
	currentMinutes := now.Hour()*60 + now.Minute()
	startMinutes := startTime.Hour()*60 + startTime.Minute()
	endMinutes := endTime.Hour()*60 + endTime.Minute()
	
	return currentMinutes >= startMinutes && currentMinutes <= endMinutes
}

// processSignals processes trading signals.
func (ta *TradingAgent) processSignals(ctx context.Context) {
	for _, pair := range ta.config.TradingPairs {
		signal, err := ta.signalAgg.AggregateSignals(ctx, pair)
		if err != nil {
			ta.logger.Debug("Failed to aggregate signals", zap.String("pair", pair), zap.Error(err))
			continue
		}
		
		ta.mu.Lock()
		ta.metrics.SignalsProcessed++
		ta.mu.Unlock()
		
		// Notify callback
		if ta.onSignal != nil {
			ta.onSignal(signal)
		}
		
		// Check signal quality
		if signal.Confidence.LessThan(ta.config.MinSignalConfidence) {
			ta.logger.Debug("Signal confidence too low",
				zap.String("pair", pair),
				zap.String("confidence", signal.Confidence.String()))
			ta.mu.Lock()
			ta.metrics.SignalsRejected++
			ta.mu.Unlock()
			continue
		}
		
		if signal.ConsensusScore.LessThan(ta.config.MinConsensusScore) {
			ta.logger.Debug("Signal consensus too low",
				zap.String("pair", pair),
				zap.String("consensus", signal.ConsensusScore.String()))
			ta.mu.Lock()
			ta.metrics.SignalsRejected++
			ta.mu.Unlock()
			continue
		}
		
		// Check if we can take the position
		if !ta.canTakePosition(pair) {
			continue
		}
		
		ta.mu.Lock()
		ta.metrics.SignalsAccepted++
		ta.mu.Unlock()
		
		// Execute trade
		if err := ta.executeTrade(ctx, signal); err != nil {
			ta.logger.Error("Failed to execute trade", zap.Error(err))
			if ta.onError != nil {
				ta.onError(err)
			}
		}
	}
}

// canTakePosition checks if we can take a new position.
func (ta *TradingAgent) canTakePosition(symbol string) bool {
	// Check max concurrent positions
	positions := ta.orderManager.GetAllPositions()
	if len(positions) >= ta.config.MaxConcurrentPos {
		ta.logger.Debug("Max positions reached")
		return false
	}
	
	// Check if we already have a position in this symbol
	if ta.orderManager.GetPosition(symbol) != nil {
		return false
	}
	
	return true
}

// executeTrade executes a trade based on the signal.
func (ta *TradingAgent) executeTrade(ctx context.Context, signal *signals.AggregatedSignal) error {
	// Calculate position size
	portfolioValue := decimal.NewFromInt(10000) // TODO: Get from portfolio
	positionSize := ta.calculatePositionSize(portfolioValue, signal)
	
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
	riskResult := ta.riskManager.CheckOrder(ctx, order, portfolioValue)
	if !riskResult.Approved {
		ta.logger.Warn("Order rejected by risk manager",
			zap.String("symbol", order.Symbol),
			zap.Int("violations", len(riskResult.Violations)))
		return nil
	}
	
	// Execute
	ta.logger.Info("Executing trade",
		zap.String("symbol", order.Symbol),
		zap.String("side", string(order.Side)),
		zap.String("quantity", order.Quantity.String()),
		zap.String("confidence", signal.Confidence.String()))
	
	// Execute with SL/TP if available
	var stopLoss, takeProfit decimal.Decimal
	if !signal.SuggestedStop.IsZero() {
		stopLoss = signal.SuggestedStop
	}
	if !signal.SuggestedTarget.IsZero() {
		takeProfit = signal.SuggestedTarget
	}
	
	var result *execution.ExecutionResult
	var err error
	
	if !stopLoss.IsZero() || !takeProfit.IsZero() {
		result, err = ta.executor.ExecuteWithSLTP(ctx, order, stopLoss, takeProfit)
	} else {
		result, err = ta.executor.Execute(ctx, order)
	}
	
	if err != nil {
		return fmt.Errorf("execution failed: %w", err)
	}
	
	// Update metrics
	ta.mu.Lock()
	ta.metrics.TotalTrades++
	ta.metrics.LastTradeTime = time.Now()
	ta.mu.Unlock()
	
	ta.logger.Info("Trade executed",
		zap.String("orderId", result.OrderID),
		zap.String("avgPrice", result.AvgPrice.String()),
		zap.String("slippage", result.Slippage.String()))
	
	// Notify callback
	if ta.onTrade != nil {
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
		ta.onTrade(trade)
	}
	
	return nil
}

// calculatePositionSize calculates position size based on strategy.
func (ta *TradingAgent) calculatePositionSize(portfolioValue decimal.Decimal, signal *signals.AggregatedSignal) decimal.Decimal {
	sizing := ta.config.PositionSizing
	
	switch sizing.Strategy {
	case "fixed":
		return sizing.FixedSize
		
	case "percent":
		// Risk-based position sizing
		riskAmount := portfolioValue.Mul(sizing.PercentRisk)
		
		// If we have a stop loss, use it for sizing
		if !signal.SuggestedStop.IsZero() && !signal.SuggestedEntry.IsZero() {
			stopDistance := signal.SuggestedEntry.Sub(signal.SuggestedStop).Abs()
			if !stopDistance.IsZero() {
				return riskAmount.Div(stopDistance)
			}
		}
		
		// Default: use percentage of portfolio
		return portfolioValue.Mul(sizing.PercentRisk).Div(signal.SuggestedEntry)
		
	case "kelly":
		// Kelly criterion: f* = (bp - q) / b
		// where b = odds, p = probability of win, q = 1 - p
		winRate := ta.getHistoricalWinRate()
		avgWin := ta.getAverageWin()
		avgLoss := ta.getAverageLoss()
		
		if avgLoss.IsZero() {
			return portfolioValue.Mul(sizing.KellyFraction)
		}
		
		b := avgWin.Div(avgLoss)
		p := winRate
		q := decimal.NewFromInt(1).Sub(p)
		
		kelly := b.Mul(p).Sub(q).Div(b)
		
		// Apply Kelly fraction (e.g., 0.5 for half Kelly)
		kelly = kelly.Mul(sizing.KellyFraction)
		
		// Clamp between 0 and max position
		if kelly.LessThan(decimal.Zero) {
			return decimal.Zero
		}
		if kelly.GreaterThan(decimal.NewFromFloat(0.25)) {
			kelly = decimal.NewFromFloat(0.25)
		}
		
		return portfolioValue.Mul(kelly).Div(signal.SuggestedEntry)
		
	case "volatility":
		// Volatility-adjusted position sizing
		// TODO: Implement volatility-based sizing
		return portfolioValue.Mul(decimal.NewFromFloat(0.02)).Div(signal.SuggestedEntry)
		
	default:
		return portfolioValue.Mul(decimal.NewFromFloat(0.02)).Div(signal.SuggestedEntry)
	}
}

// checkRiskLimits checks and enforces risk limits.
func (ta *TradingAgent) checkRiskLimits() {
	stats := ta.riskManager.GetStats()
	
	// Check daily loss
	if stats.DailyPnL.LessThan(ta.config.MaxDailyLoss.Neg()) {
		ta.logger.Warn("Daily loss limit approaching",
			zap.String("dailyPnL", stats.DailyPnL.String()),
			zap.String("limit", ta.config.MaxDailyLoss.String()))
	}
	
	// Update metrics
	ta.mu.Lock()
	ta.metrics.DailyPnL = stats.DailyPnL
	ta.mu.Unlock()
}

// getHistoricalWinRate returns historical win rate.
func (ta *TradingAgent) getHistoricalWinRate() decimal.Decimal {
	ta.mu.RLock()
	defer ta.mu.RUnlock()
	
	total := ta.metrics.WinningTrades + ta.metrics.LosingTrades
	if total == 0 {
		return decimal.NewFromFloat(0.5) // Default
	}
	
	return decimal.NewFromInt(int64(ta.metrics.WinningTrades)).Div(decimal.NewFromInt(int64(total)))
}

// getAverageWin returns average winning trade.
func (ta *TradingAgent) getAverageWin() decimal.Decimal {
	// TODO: Calculate from trade history
	return decimal.NewFromFloat(100)
}

// getAverageLoss returns average losing trade.
func (ta *TradingAgent) getAverageLoss() decimal.Decimal {
	// TODO: Calculate from trade history
	return decimal.NewFromFloat(50)
}

// GetStatus returns the current agent status.
func (ta *TradingAgent) GetStatus() AgentStatus {
	ta.mu.RLock()
	defer ta.mu.RUnlock()
	
	uptime := time.Duration(0)
	if ta.isRunning {
		uptime = time.Since(ta.startTime)
	}
	
	riskStats := ta.riskManager.GetStats()
	
	return AgentStatus{
		IsRunning:     ta.isRunning,
		IsPaused:      ta.isPaused,
		Uptime:        uptime,
		Metrics:       ta.metrics,
		OpenPositions: len(ta.orderManager.GetAllPositions()),
		PendingOrders: len(ta.orderManager.GetOpenOrders()),
		RiskStatus: &RiskStatus{
			DailyPnL:           riskStats.DailyPnL,
			DailyLimit:         ta.config.MaxDailyLoss,
			IsKillSwitchActive: riskStats.IsDisabled,
			OpenRisk:           riskStats.TotalExposure,
		},
	}
}

// GetMetrics returns agent metrics.
func (ta *TradingAgent) GetMetrics() AgentMetrics {
	ta.mu.RLock()
	defer ta.mu.RUnlock()
	
	metrics := ta.metrics
	if ta.isRunning {
		metrics.Uptime = time.Since(ta.startTime)
	}
	
	return metrics
}

// UpdateConfig updates the agent configuration.
func (ta *TradingAgent) UpdateConfig(config AgentConfig) {
	ta.mu.Lock()
	defer ta.mu.Unlock()
	
	ta.config = config
	ta.logger.Info("Agent config updated")
}

// SetOnTrade sets the trade callback.
func (ta *TradingAgent) SetOnTrade(callback func(*types.Trade)) {
	ta.onTrade = callback
}

// SetOnSignal sets the signal callback.
func (ta *TradingAgent) SetOnSignal(callback func(*signals.AggregatedSignal)) {
	ta.onSignal = callback
}

// SetOnError sets the error callback.
func (ta *TradingAgent) SetOnError(callback func(error)) {
	ta.onError = callback
}

// EmergencyStop immediately stops all trading and closes positions.
func (ta *TradingAgent) EmergencyStop(ctx context.Context) error {
	ta.logger.Error("EMERGENCY STOP ACTIVATED")
	
	// Pause trading immediately
	ta.Pause()
	
	// Activate kill switch
	ta.riskManager.ManualKillSwitch("Emergency stop activated", 24*time.Hour)
	
	// Cancel all pending orders
	for _, order := range ta.orderManager.GetOpenOrders() {
		ta.executor.CancelOrder(ctx, order.Order.ID)
	}
	
	// Close all positions
	for _, pos := range ta.orderManager.GetAllPositions() {
		ta.executor.ClosePosition(ctx, pos.Symbol)
	}
	
	return nil
}
