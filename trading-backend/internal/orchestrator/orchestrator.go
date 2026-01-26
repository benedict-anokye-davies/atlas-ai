// Package orchestrator provides the central integration point for all PhD-level trading components.
// This orchestrator coordinates the Event Bus, Regime Detection, Position Sizing, Monte Carlo,
// and Optimization modules into a cohesive autonomous trading system.
package orchestrator

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/atlas-desktop/trading-backend/internal/backtester"
	"github.com/atlas-desktop/trading-backend/internal/events"
	"github.com/atlas-desktop/trading-backend/internal/execution"
	"github.com/atlas-desktop/trading-backend/internal/montecarlo"
	"github.com/atlas-desktop/trading-backend/internal/optimization"
	"github.com/atlas-desktop/trading-backend/internal/regime"
	"github.com/atlas-desktop/trading-backend/internal/signals"
	"github.com/atlas-desktop/trading-backend/internal/sizing"
	"github.com/atlas-desktop/trading-backend/internal/workers"
	"github.com/shopspring/decimal"
	"go.uber.org/zap"
)

// TradingOrchestrator coordinates all PhD-level trading components.
type TradingOrchestrator struct {
	logger *zap.Logger
	config OrchestratorConfig

	// Core PhD-level components
	eventBus       *events.EventBus
	regimeDetector *regime.HMMRegimeDetector
	positionSizer  *sizing.MultiStrategyPositionSizer
	monteCarloSim  *montecarlo.Simulator
	optimizer      *optimization.WalkForwardOptimizer
	workerPool     *workers.Pool
	viabilityCheck *backtester.ViabilityChecker

	// Existing components integration
	signalAggregator *signals.Aggregator
	riskManager      *execution.RiskManager
	executionModeler *execution.ExecutionModel

	// State tracking
	mu            sync.RWMutex
	currentRegime regime.RegimeType
	regimeHistory []RegimeTransition

	// Strategy state
	activeStrategies map[string]*StrategyState

	// Metrics
	metrics OrchestratorMetrics

	// Control
	running bool
	stopCh  chan struct{}
}

// OrchestratorConfig configures the orchestrator.
type OrchestratorConfig struct {
	// Event Bus Configuration
	EventWorkers    int `json:"eventWorkers"`
	EventBufferSize int `json:"eventBufferSize"`

	// Regime Detection
	RegimeDetectionInterval time.Duration `json:"regimeDetectionInterval"`
	RegimeLookbackBars      int           `json:"regimeLookbackBars"`
	RegimeMinProbability    float64       `json:"regimeMinProbability"`

	// Position Sizing
	DefaultSizingStrategy string          `json:"defaultSizingStrategy"` // "kelly", "volatility", "risk_budget"
	MaxPositionSize       decimal.Decimal `json:"maxPositionSize"`
	KellyFraction         float64         `json:"kellyFraction"`
	TargetVolatility      float64         `json:"targetVolatility"`

	// Monte Carlo Validation
	MonteCarloRuns       int     `json:"monteCarloRuns"`
	MonteCarloConfidence float64 `json:"monteCarloConfidence"`
	MinRobustnessScore   float64 `json:"minRobustnessScore"`

	// Walk-Forward Optimization
	WalkForwardWindows     int           `json:"walkForwardWindows"`
	WalkForwardInSample    time.Duration `json:"walkForwardInSample"`
	WalkForwardOutSample   time.Duration `json:"walkForwardOutSample"`
	MaxOptimizationDegrade float64       `json:"maxOptimizationDegrade"`

	// Worker Pool
	WorkerPoolSize int `json:"workerPoolSize"`
	MaxQueuedTasks int `json:"maxQueuedTasks"`

	// Strategy Viability Thresholds
	MinSharpeRatio float64 `json:"minSharpeRatio"`
	MaxDrawdown    float64 `json:"maxDrawdown"`
	MinWinRate     float64 `json:"minWinRate"`
	MinTradeCount  int     `json:"minTradeCount"`
}

// DefaultOrchestratorConfig returns production-ready defaults based on Perplexity research.
func DefaultOrchestratorConfig() OrchestratorConfig {
	return OrchestratorConfig{
		// Event Bus - High throughput for real-time processing
		EventWorkers:    16,
		EventBufferSize: 100000,

		// Regime Detection - Detect market state changes
		RegimeDetectionInterval: 5 * time.Minute,
		RegimeLookbackBars:      100,
		RegimeMinProbability:    0.7,

		// Position Sizing - Conservative Kelly
		DefaultSizingStrategy: "kelly",
		MaxPositionSize:       decimal.NewFromFloat(0.10), // 10% max
		KellyFraction:         0.25,                       // Quarter Kelly
		TargetVolatility:      0.15,                       // 15% annual vol target

		// Monte Carlo - Statistical validation
		MonteCarloRuns:       1000,
		MonteCarloConfidence: 0.95,
		MinRobustnessScore:   0.6,

		// Walk-Forward - Out-of-sample validation
		WalkForwardWindows:     5,
		WalkForwardInSample:    180 * 24 * time.Hour, // 6 months
		WalkForwardOutSample:   30 * 24 * time.Hour,  // 1 month
		MaxOptimizationDegrade: 0.3,                  // Max 30% OOS degradation

		// Worker Pool - Parallel execution
		WorkerPoolSize: 32,
		MaxQueuedTasks: 10000,

		// Strategy Viability - PhD-level thresholds
		MinSharpeRatio: 0.5,
		MaxDrawdown:    0.2, // 20%
		MinWinRate:     0.4, // 40%
		MinTradeCount:  100,
	}
}

// RegimeTransition records a regime change.
type RegimeTransition struct {
	From        regime.RegimeType          `json:"from"`
	To          regime.RegimeType          `json:"to"`
	Probability float64                    `json:"probability"`
	Timestamp   time.Time                  `json:"timestamp"`
	Adjustments regime.StrategyAdjustments `json:"adjustments"`
}

// StrategyState tracks state for each active strategy.
type StrategyState struct {
	StrategyID      string                                    `json:"strategyId"`
	CurrentParams   map[string]float64                        `json:"currentParams"`
	LastOptimized   time.Time                                 `json:"lastOptimized"`
	ViabilityGrade  string                                    `json:"viabilityGrade"` // A, B, C, D, F
	ViabilityScore  float64                                   `json:"viabilityScore"`
	RobustnessScore float64                                   `json:"robustnessScore"`
	RegimePerf      map[regime.RegimeType]StrategyPerformance `json:"regimePerformance"`
	IsActive        bool                                      `json:"isActive"`
}

// StrategyPerformance tracks performance in a specific regime.
type StrategyPerformance struct {
	Sharpe      float64   `json:"sharpe"`
	WinRate     float64   `json:"winRate"`
	TradeCount  int       `json:"tradeCount"`
	TotalPnL    float64   `json:"totalPnl"`
	LastUpdated time.Time `json:"lastUpdated"`
}

// OrchestratorMetrics tracks orchestrator performance.
type OrchestratorMetrics struct {
	EventsProcessed     int64         `json:"eventsProcessed"`
	EventsPerSecond     float64       `json:"eventsPerSecond"`
	RegimeChanges       int           `json:"regimeChanges"`
	PositionsSized      int64         `json:"positionsSized"`
	MonteCarloRuns      int64         `json:"monteCarloRuns"`
	OptimizationCycles  int           `json:"optimizationCycles"`
	TasksExecuted       int64         `json:"tasksExecuted"`
	P99Latency          time.Duration `json:"p99Latency"`
	LastRegimeChange    time.Time     `json:"lastRegimeChange"`
	CurrentRegime       string        `json:"currentRegime"`
	ActiveStrategyCount int           `json:"activeStrategyCount"`
	AvgRobustnessScore  float64       `json:"avgRobustnessScore"`
}

// NewTradingOrchestrator creates a new orchestrator with all PhD-level components.
func NewTradingOrchestrator(
	logger *zap.Logger,
	config OrchestratorConfig,
	signalAgg *signals.Aggregator,
	riskMgr *execution.RiskManager,
) (*TradingOrchestrator, error) {
	// Initialize Event Bus
	eventBusConfig := events.EventBusConfig{
		BufferSize: config.EventBufferSize,
		NumWorkers: config.EventWorkers,
	}
	eventBus := events.NewEventBus(logger, eventBusConfig)

	// Initialize HMM Regime Detector
	regimeConfig := regime.HMMConfig{
		NumRegimes:       6,
		LookbackBars:     config.RegimeLookbackBars,
		TransitionSmooth: 0.1,
		MinProbability:   config.RegimeMinProbability,
	}
	regimeDetector := regime.NewHMMRegimeDetector(logger, regimeConfig)

	// Initialize Multi-Strategy Position Sizer
	positionSizer := sizing.NewMultiStrategyPositionSizer(logger, sizing.MultiStrategyConfig{
		KellyFraction:    config.KellyFraction,
		TargetVolatility: config.TargetVolatility,
		MaxPosition:      config.MaxPositionSize.InexactFloat64(),
	})

	// Initialize Monte Carlo Simulator
	mcConfig := montecarlo.SimulatorConfig{
		NumSimulations:  config.MonteCarloRuns,
		ConfidenceLevel: config.MonteCarloConfidence,
		Bootstrap:       true,
	}
	monteCarloSim := montecarlo.NewSimulator(logger, mcConfig)

	// Initialize Walk-Forward Optimizer
	wfConfig := optimization.WalkForwardConfig{
		InSampleDuration:  config.WalkForwardInSample,
		OutSampleDuration: config.WalkForwardOutSample,
		Windows:           config.WalkForwardWindows,
		Anchored:          false, // Rolling windows
	}
	optimizer := optimization.NewWalkForwardOptimizer(logger, wfConfig)

	// Initialize Worker Pool
	poolConfig := workers.PoolConfig{
		NumWorkers:  config.WorkerPoolSize,
		QueueSize:   config.MaxQueuedTasks,
		EnableStats: true,
	}
	workerPool := workers.NewPool(logger, poolConfig)

	// Initialize Viability Checker with PhD-level thresholds
	viabilityThresholds := backtester.DefaultViabilityThresholds()
	viabilityThresholds.MinSharpeRatio = config.MinSharpeRatio
	viabilityThresholds.MaxDrawdown = config.MaxDrawdown
	viabilityThresholds.MinWinRate = config.MinWinRate
	viabilityThresholds.MinTradeCount = config.MinTradeCount
	viabilityCheck := backtester.NewViabilityChecker(logger, viabilityThresholds)

	// Initialize Execution Model with Almgren-Chriss
	execModel := execution.CryptoExecutionModelConfig()

	orch := &TradingOrchestrator{
		logger:           logger.Named("orchestrator"),
		config:           config,
		eventBus:         eventBus,
		regimeDetector:   regimeDetector,
		positionSizer:    positionSizer,
		monteCarloSim:    monteCarloSim,
		optimizer:        optimizer,
		workerPool:       workerPool,
		viabilityCheck:   viabilityCheck,
		signalAggregator: signalAgg,
		riskManager:      riskMgr,
		executionModeler: execModel,
		currentRegime:    regime.RegimeNeutral,
		regimeHistory:    make([]RegimeTransition, 0, 1000),
		activeStrategies: make(map[string]*StrategyState),
		stopCh:           make(chan struct{}),
	}

	// Wire up event handlers
	orch.setupEventHandlers()

	return orch, nil
}

// setupEventHandlers registers handlers for all event types.
func (o *TradingOrchestrator) setupEventHandlers() {
	// Handle bar events for regime detection
	o.eventBus.Subscribe(events.EventTypeBar, func(e events.Event) {
		if barEvent, ok := e.(*events.BarEvent); ok {
			o.handleBarEvent(barEvent)
		}
	})

	// Handle signal events for position sizing
	o.eventBus.Subscribe(events.EventTypeSignal, func(e events.Event) {
		if signalEvent, ok := e.(*events.SignalEvent); ok {
			o.handleSignalEvent(signalEvent)
		}
	})

	// Handle execution events for feedback
	o.eventBus.Subscribe(events.EventTypeExecution, func(e events.Event) {
		if execEvent, ok := e.(*events.ExecutionEvent); ok {
			o.handleExecutionEvent(execEvent)
		}
	})

	// Handle risk alerts
	o.eventBus.Subscribe(events.EventTypeRiskAlert, func(e events.Event) {
		if riskEvent, ok := e.(*events.RiskAlertEvent); ok {
			o.handleRiskAlert(riskEvent)
		}
	})
}

// Start starts all orchestrator components.
func (o *TradingOrchestrator) Start(ctx context.Context) error {
	o.mu.Lock()
	if o.running {
		o.mu.Unlock()
		return fmt.Errorf("orchestrator already running")
	}
	o.running = true
	o.stopCh = make(chan struct{})
	o.mu.Unlock()

	o.logger.Info("Starting Trading Orchestrator with PhD-level components",
		zap.Int("eventWorkers", o.config.EventWorkers),
		zap.Int("monteCarloRuns", o.config.MonteCarloRuns),
		zap.Float64("kellyFraction", o.config.KellyFraction),
	)

	// Start Event Bus
	if err := o.eventBus.Start(ctx); err != nil {
		return fmt.Errorf("failed to start event bus: %w", err)
	}

	// Start Worker Pool
	if err := o.workerPool.Start(ctx); err != nil {
		return fmt.Errorf("failed to start worker pool: %w", err)
	}

	// Start regime detection loop
	go o.regimeDetectionLoop(ctx)

	// Start strategy monitoring loop
	go o.strategyMonitoringLoop(ctx)

	// Start metrics collection
	go o.metricsLoop(ctx)

	o.logger.Info("Trading Orchestrator started successfully")
	return nil
}

// Stop stops all orchestrator components.
func (o *TradingOrchestrator) Stop() error {
	o.mu.Lock()
	if !o.running {
		o.mu.Unlock()
		return nil
	}
	o.running = false
	close(o.stopCh)
	o.mu.Unlock()

	o.logger.Info("Stopping Trading Orchestrator")

	// Stop in reverse order
	o.workerPool.Stop()
	o.eventBus.Stop()

	o.logger.Info("Trading Orchestrator stopped")
	return nil
}

// handleBarEvent processes bar data for regime detection.
func (o *TradingOrchestrator) handleBarEvent(e *events.BarEvent) {
	// Update regime detector with new bar
	o.regimeDetector.AddBar(regime.Bar{
		Open:   e.Open,
		High:   e.High,
		Low:    e.Low,
		Close:  e.Close,
		Volume: e.Volume,
		Time:   e.Timestamp,
	})

	// Check for regime change
	newRegime, prob := o.regimeDetector.GetCurrentRegime()

	o.mu.Lock()
	if newRegime != o.currentRegime && prob >= o.config.RegimeMinProbability {
		// Regime transition detected
		adjustments := o.regimeDetector.GetStrategyAdjustments(newRegime)

		transition := RegimeTransition{
			From:        o.currentRegime,
			To:          newRegime,
			Probability: prob,
			Timestamp:   time.Now(),
			Adjustments: adjustments,
		}
		o.regimeHistory = append(o.regimeHistory, transition)
		o.currentRegime = newRegime
		o.metrics.RegimeChanges++
		o.metrics.LastRegimeChange = time.Now()
		o.metrics.CurrentRegime = string(newRegime)

		o.logger.Info("Regime transition detected",
			zap.String("from", string(transition.From)),
			zap.String("to", string(transition.To)),
			zap.Float64("probability", prob),
			zap.Float64("positionMultiplier", adjustments.PositionSizeMultiplier),
		)

		// Apply regime adjustments to active strategies
		o.applyRegimeAdjustments(adjustments)
	}
	o.mu.Unlock()
}

// handleSignalEvent processes trading signals through position sizing.
func (o *TradingOrchestrator) handleSignalEvent(e *events.SignalEvent) {
	o.mu.RLock()
	currentRegime := o.currentRegime
	o.mu.RUnlock()

	// Get regime adjustments
	adjustments := o.regimeDetector.GetStrategyAdjustments(currentRegime)

	// Calculate position size using Kelly Criterion
	request := sizing.PositionSizeRequest{
		Symbol:            e.Symbol,
		Direction:         string(e.Direction),
		EntryPrice:        e.EntryPrice,
		StopLoss:          e.StopLoss,
		TakeProfit:        e.TakeProfit,
		SignalStrength:    e.Strength,
		Confidence:        e.Confidence,
		PortfolioValue:    e.PortfolioValue,
		CurrentVolatility: e.Volatility,
		HistoricalWinRate: e.WinRate,
		AvgWinLossRatio:   e.WinLossRatio,
	}

	// Size the position
	result := o.positionSizer.Size(request)

	// Apply regime multiplier
	result.PositionSize *= adjustments.PositionSizeMultiplier

	// Clamp to max position
	maxPos := o.config.MaxPositionSize.InexactFloat64() * e.PortfolioValue
	if result.PositionSize > maxPos {
		result.PositionSize = maxPos
	}

	o.mu.Lock()
	o.metrics.PositionsSized++
	o.mu.Unlock()

	// Publish sized position event
	positionEvent := &events.PositionEvent{
		BaseEvent:    events.NewBaseEvent(events.EventTypePosition, e.Symbol),
		PositionSize: result.PositionSize,
		Method:       result.Method,
		Regime:       string(currentRegime),
		StopLoss:     e.StopLoss * adjustments.StopLossMultiplier,
		TakeProfit:   e.TakeProfit * adjustments.TakeProfitMultiplier,
	}
	o.eventBus.Publish(positionEvent)

	o.logger.Debug("Position sized",
		zap.String("symbol", e.Symbol),
		zap.Float64("size", result.PositionSize),
		zap.String("method", result.Method),
		zap.String("regime", string(currentRegime)),
	)
}

// handleExecutionEvent processes trade execution results for learning.
func (o *TradingOrchestrator) handleExecutionEvent(e *events.ExecutionEvent) {
	// Record execution for strategy performance tracking
	o.mu.Lock()
	if strategy, exists := o.activeStrategies[e.StrategyID]; exists {
		if perfMap, ok := strategy.RegimePerf[o.currentRegime]; ok {
			perfMap.TradeCount++
			perfMap.TotalPnL += e.PnL
			if e.PnL > 0 {
				perfMap.WinRate = float64(perfMap.TradeCount) // Will recalculate
			}
			perfMap.LastUpdated = time.Now()
			strategy.RegimePerf[o.currentRegime] = perfMap
		}
	}
	o.mu.Unlock()
}

// handleRiskAlert processes risk management alerts.
func (o *TradingOrchestrator) handleRiskAlert(e *events.RiskAlertEvent) {
	o.logger.Warn("Risk alert received",
		zap.String("type", e.AlertType),
		zap.String("message", e.Message),
		zap.String("severity", e.Severity),
	)

	// If critical, reduce all position sizes
	if e.Severity == "critical" {
		o.mu.Lock()
		for _, strategy := range o.activeStrategies {
			strategy.IsActive = false
		}
		o.mu.Unlock()
		o.logger.Error("All strategies deactivated due to critical risk alert")
	}
}

// applyRegimeAdjustments applies regime-based adjustments to active strategies.
func (o *TradingOrchestrator) applyRegimeAdjustments(adj regime.StrategyAdjustments) {
	// Adjust position sizing multipliers
	for strategyID, strategy := range o.activeStrategies {
		// Check if strategy is suited for current regime
		suited := false
		for _, preferred := range adj.PreferredStrategies {
			if preferred == strategyID {
				suited = true
				break
			}
		}

		if !suited {
			o.logger.Debug("Strategy not suited for current regime",
				zap.String("strategy", strategyID),
			)
		}

		strategy.IsActive = suited
	}
}

// regimeDetectionLoop periodically checks for regime changes.
func (o *TradingOrchestrator) regimeDetectionLoop(ctx context.Context) {
	ticker := time.NewTicker(o.config.RegimeDetectionInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-o.stopCh:
			return
		case <-ticker.C:
			// Regime detection is event-driven via bar events
			// This loop can perform additional regime analysis if needed
			currentRegime, prob := o.regimeDetector.GetCurrentRegime()
			o.logger.Debug("Regime check",
				zap.String("regime", string(currentRegime)),
				zap.Float64("probability", prob),
			)
		}
	}
}

// strategyMonitoringLoop monitors and optimizes active strategies.
func (o *TradingOrchestrator) strategyMonitoringLoop(ctx context.Context) {
	ticker := time.NewTicker(1 * time.Hour) // Hourly optimization check
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-o.stopCh:
			return
		case <-ticker.C:
			o.evaluateStrategies(ctx)
		}
	}
}

// evaluateStrategies evaluates all active strategies for viability.
func (o *TradingOrchestrator) evaluateStrategies(ctx context.Context) {
	o.mu.RLock()
	strategies := make([]string, 0, len(o.activeStrategies))
	for id := range o.activeStrategies {
		strategies = append(strategies, id)
	}
	o.mu.RUnlock()

	for _, strategyID := range strategies {
		// Submit viability check as task
		o.workerPool.Submit(func() {
			o.evaluateStrategy(ctx, strategyID)
		})
	}

	o.mu.Lock()
	o.metrics.TasksExecuted += int64(len(strategies))
	o.mu.Unlock()
}

// evaluateStrategy evaluates a single strategy.
func (o *TradingOrchestrator) evaluateStrategy(ctx context.Context, strategyID string) {
	o.mu.RLock()
	strategy, exists := o.activeStrategies[strategyID]
	o.mu.RUnlock()

	if !exists {
		return
	}

	// Get strategy's backtest results (would come from actual backtest)
	// For now, use placeholder
	results := backtester.BacktestResults{
		TotalReturn:  0.15, // 15%
		SharpeRatio:  0.8,
		MaxDrawdown:  0.12,
		WinRate:      0.52,
		TradeCount:   150,
		ProfitFactor: 1.3,
	}

	// Check viability
	report := o.viabilityCheck.Check(results)

	// Run Monte Carlo validation
	trades := make([]float64, results.TradeCount)
	// Populate with historical trade PnLs...

	mcResults := o.monteCarloSim.Simulate(trades)

	o.mu.Lock()
	strategy.ViabilityGrade = report.Grade
	strategy.ViabilityScore = report.OverallScore
	strategy.RobustnessScore = mcResults.RobustnessScore
	strategy.IsActive = report.IsViable && mcResults.RobustnessScore >= o.config.MinRobustnessScore
	o.mu.Unlock()

	o.logger.Info("Strategy evaluated",
		zap.String("strategyId", strategyID),
		zap.String("grade", report.Grade),
		zap.Float64("score", report.OverallScore),
		zap.Float64("robustness", mcResults.RobustnessScore),
		zap.Bool("active", strategy.IsActive),
	)
}

// metricsLoop collects and updates metrics.
func (o *TradingOrchestrator) metricsLoop(ctx context.Context) {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	var lastEventsProcessed int64

	for {
		select {
		case <-ctx.Done():
			return
		case <-o.stopCh:
			return
		case <-ticker.C:
			ebStats := o.eventBus.GetStats()
			wpStats := o.workerPool.GetStats()

			o.mu.Lock()
			o.metrics.EventsProcessed = ebStats.TotalProcessed
			o.metrics.EventsPerSecond = float64(ebStats.TotalProcessed-lastEventsProcessed) / 10.0
			o.metrics.P99Latency = ebStats.P99Latency
			o.metrics.TasksExecuted = wpStats.TotalCompleted

			// Count active strategies
			activeCount := 0
			totalRobustness := 0.0
			for _, s := range o.activeStrategies {
				if s.IsActive {
					activeCount++
					totalRobustness += s.RobustnessScore
				}
			}
			o.metrics.ActiveStrategyCount = activeCount
			if activeCount > 0 {
				o.metrics.AvgRobustnessScore = totalRobustness / float64(activeCount)
			}
			o.mu.Unlock()

			lastEventsProcessed = ebStats.TotalProcessed
		}
	}
}

// RegisterStrategy registers a new strategy for monitoring.
func (o *TradingOrchestrator) RegisterStrategy(strategyID string, params map[string]float64) {
	o.mu.Lock()
	defer o.mu.Unlock()

	o.activeStrategies[strategyID] = &StrategyState{
		StrategyID:      strategyID,
		CurrentParams:   params,
		LastOptimized:   time.Now(),
		ViabilityGrade:  "C", // Default
		ViabilityScore:  0.5,
		RobustnessScore: 0.5,
		RegimePerf:      make(map[regime.RegimeType]StrategyPerformance),
		IsActive:        true,
	}

	o.logger.Info("Strategy registered", zap.String("strategyId", strategyID))
}

// UnregisterStrategy removes a strategy from monitoring.
func (o *TradingOrchestrator) UnregisterStrategy(strategyID string) {
	o.mu.Lock()
	defer o.mu.Unlock()
	delete(o.activeStrategies, strategyID)
	o.logger.Info("Strategy unregistered", zap.String("strategyId", strategyID))
}

// GetCurrentRegime returns the current detected market regime.
func (o *TradingOrchestrator) GetCurrentRegime() (regime.RegimeType, float64) {
	return o.regimeDetector.GetCurrentRegime()
}

// GetRegimeHistory returns recent regime transitions.
func (o *TradingOrchestrator) GetRegimeHistory(limit int) []RegimeTransition {
	o.mu.RLock()
	defer o.mu.RUnlock()

	if limit <= 0 || limit > len(o.regimeHistory) {
		limit = len(o.regimeHistory)
	}

	start := len(o.regimeHistory) - limit
	if start < 0 {
		start = 0
	}

	result := make([]RegimeTransition, limit)
	copy(result, o.regimeHistory[start:])
	return result
}

// GetStrategyAdjustments returns current regime-based strategy adjustments.
func (o *TradingOrchestrator) GetStrategyAdjustments() regime.StrategyAdjustments {
	o.mu.RLock()
	currentRegime := o.currentRegime
	o.mu.RUnlock()
	return o.regimeDetector.GetStrategyAdjustments(currentRegime)
}

// SizePosition calculates optimal position size with regime awareness.
func (o *TradingOrchestrator) SizePosition(request sizing.PositionSizeRequest) sizing.PositionSizeResult {
	o.mu.RLock()
	currentRegime := o.currentRegime
	o.mu.RUnlock()

	// Size with position sizer
	result := o.positionSizer.Size(request)

	// Apply regime adjustments
	adjustments := o.regimeDetector.GetStrategyAdjustments(currentRegime)
	result.PositionSize *= adjustments.PositionSizeMultiplier

	return result
}

// RunMonteCarloValidation validates a strategy with Monte Carlo simulation.
func (o *TradingOrchestrator) RunMonteCarloValidation(trades []float64) *montecarlo.SimulationResults {
	results := o.monteCarloSim.Simulate(trades)

	o.mu.Lock()
	o.metrics.MonteCarloRuns++
	o.mu.Unlock()

	return results
}

// OptimizeStrategy runs walk-forward optimization on a strategy.
func (o *TradingOrchestrator) OptimizeStrategy(
	strategyID string,
	paramGrid map[string][]float64,
	evaluator optimization.ObjectiveFunc,
) (*optimization.WalkForwardResults, error) {
	results, err := o.optimizer.Run(paramGrid, evaluator)
	if err != nil {
		return nil, err
	}

	o.mu.Lock()
	o.metrics.OptimizationCycles++

	if strategy, exists := o.activeStrategies[strategyID]; exists {
		strategy.CurrentParams = results.BestParams
		strategy.LastOptimized = time.Now()
	}
	o.mu.Unlock()

	o.logger.Info("Strategy optimized",
		zap.String("strategyId", strategyID),
		zap.Float64("isScore", results.InSampleScore),
		zap.Float64("oosScore", results.OutOfSampleScore),
		zap.Float64("degradation", results.Degradation),
	)

	return results, nil
}

// PublishEvent publishes an event to the event bus.
func (o *TradingOrchestrator) PublishEvent(event events.Event) {
	o.eventBus.Publish(event)
}

// GetMetrics returns current orchestrator metrics.
func (o *TradingOrchestrator) GetMetrics() OrchestratorMetrics {
	o.mu.RLock()
	defer o.mu.RUnlock()
	return o.metrics
}

// GetActiveStrategies returns all active strategies.
func (o *TradingOrchestrator) GetActiveStrategies() map[string]*StrategyState {
	o.mu.RLock()
	defer o.mu.RUnlock()

	result := make(map[string]*StrategyState, len(o.activeStrategies))
	for k, v := range o.activeStrategies {
		copyState := *v
		result[k] = &copyState
	}
	return result
}

// GetEventBus returns the event bus for external integration.
func (o *TradingOrchestrator) GetEventBus() *events.EventBus {
	return o.eventBus
}

// GetWorkerPool returns the worker pool for external task submission.
func (o *TradingOrchestrator) GetWorkerPool() *workers.Pool {
	return o.workerPool
}
