// Package backtester provides walk-forward analysis for strategy validation.
package backtester

import (
	"context"
	"fmt"
	"time"

	"github.com/atlas-desktop/trading-backend/pkg/types"
	"github.com/shopspring/decimal"
	"go.uber.org/zap"
)

// WalkForwardAnalyzer performs walk-forward optimization analysis
type WalkForwardAnalyzer struct {
	logger        *zap.Logger
	dataLoader    DataLoader
	slippageModel SlippageModel
}

// NewWalkForwardAnalyzer creates a new walk-forward analyzer
func NewWalkForwardAnalyzer(
	logger *zap.Logger,
	dataLoader DataLoader,
	slippageModel SlippageModel,
) *WalkForwardAnalyzer {
	return &WalkForwardAnalyzer{
		logger:        logger,
		dataLoader:    dataLoader,
		slippageModel: slippageModel,
	}
}

// Run performs walk-forward analysis
func (wf *WalkForwardAnalyzer) Run(ctx context.Context, config *types.BacktestConfig) (*types.WalkForwardResult, error) {
	wfConfig := config.Validation.WalkForward
	
	if !wfConfig.Enabled {
		return nil, nil
	}
	
	windowSize := wfConfig.WindowSize
	stepSize := wfConfig.StepSize
	
	if windowSize <= 0 {
		windowSize = 30 // Default 30 days
	}
	if stepSize <= 0 {
		stepSize = 7 // Default 7 days
	}
	
	// Generate windows
	windows, err := wf.generateWindows(config.StartDate, config.EndDate, windowSize, stepSize)
	if err != nil {
		return nil, fmt.Errorf("failed to generate windows: %w", err)
	}
	
	if len(windows) == 0 {
		return nil, fmt.Errorf("no windows generated for walk-forward analysis")
	}
	
	wf.logger.Info("Starting walk-forward analysis",
		zap.Int("windowCount", len(windows)),
		zap.Int("windowSize", windowSize),
		zap.Int("stepSize", stepSize),
	)
	
	// Run backtest for each window
	results := make([]types.WalkForwardWindow, len(windows))
	var allTrades []*types.Trade
	var allEquityCurve []types.EquityCurvePoint
	
	for i, window := range windows {
		// Check for cancellation
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}
		
		// Run in-sample backtest
		inSampleConfig := *config
		inSampleConfig.StartDate = window.InSampleStart
		inSampleConfig.EndDate = window.InSampleEnd
		inSampleConfig.Validation.WalkForward.Enabled = false // Avoid recursion
		inSampleConfig.Validation.MonteCarlo.Enabled = false
		
		inSampleEngine := NewEngine(wf.logger, wf.dataLoader, wf.slippageModel)
		inSampleResult, err := inSampleEngine.Run(ctx, &inSampleConfig)
		if err != nil {
			wf.logger.Warn("In-sample backtest failed",
				zap.Int("window", i),
				zap.Error(err),
			)
			continue
		}
		
		// Run out-of-sample backtest with same strategy parameters
		outSampleConfig := *config
		outSampleConfig.StartDate = window.OutSampleStart
		outSampleConfig.EndDate = window.OutSampleEnd
		outSampleConfig.Validation.WalkForward.Enabled = false
		outSampleConfig.Validation.MonteCarlo.Enabled = false
		
		outSampleEngine := NewEngine(wf.logger, wf.dataLoader, wf.slippageModel)
		outSampleResult, err := outSampleEngine.Run(ctx, &outSampleConfig)
		if err != nil {
			wf.logger.Warn("Out-of-sample backtest failed",
				zap.Int("window", i),
				zap.Error(err),
			)
			continue
		}
		
		results[i] = types.WalkForwardWindow{
			InSampleStart:    window.InSampleStart,
			InSampleEnd:      window.InSampleEnd,
			OutSampleStart:   window.OutSampleStart,
			OutSampleEnd:     window.OutSampleEnd,
			InSampleMetrics:  inSampleResult.Metrics,
			OutSampleMetrics: outSampleResult.Metrics,
		}
		
		// Collect out-of-sample trades for overall metrics
		for _, trade := range outSampleResult.Trades {
			tradeCopy := trade
			allTrades = append(allTrades, &tradeCopy)
		}
		allEquityCurve = append(allEquityCurve, outSampleResult.EquityCurve...)
		
		wf.logger.Debug("Window completed",
			zap.Int("window", i),
			zap.String("inSampleReturn", inSampleResult.Metrics.TotalReturn.String()),
			zap.String("outSampleReturn", outSampleResult.Metrics.TotalReturn.String()),
		)
	}
	
	// Calculate overall metrics from all out-of-sample periods
	metricsCalc := NewMetricsCalculator()
	overallMetrics := metricsCalc.Calculate(allTrades, allEquityCurve, config.InitialCapital)
	
	// Calculate robustness (ratio of out-of-sample to in-sample performance)
	robustness := wf.calculateRobustness(results)
	
	result := &types.WalkForwardResult{
		Windows:        results,
		OverallMetrics: overallMetrics,
		Robustness:     robustness,
	}
	
	wf.logger.Info("Walk-forward analysis complete",
		zap.String("overallReturn", overallMetrics.TotalReturn.String()),
		zap.String("robustness", robustness.String()),
		zap.Int("totalTrades", len(allTrades)),
	)
	
	return result, nil
}

// windowConfig holds configuration for a single walk-forward window
type windowConfig struct {
	InSampleStart  time.Time
	InSampleEnd    time.Time
	OutSampleStart time.Time
	OutSampleEnd   time.Time
}

// generateWindows generates walk-forward windows
func (wf *WalkForwardAnalyzer) generateWindows(
	start, end time.Time,
	windowDays, stepDays int,
) ([]windowConfig, error) {
	var windows []windowConfig
	
	windowDuration := time.Duration(windowDays) * 24 * time.Hour
	stepDuration := time.Duration(stepDays) * 24 * time.Hour
	
	// Use 80/20 split for in-sample/out-of-sample
	inSampleRatio := 0.8
	inSampleDuration := time.Duration(float64(windowDuration) * inSampleRatio)
	outSampleDuration := windowDuration - inSampleDuration
	
	current := start
	
	for current.Add(windowDuration).Before(end) || current.Add(windowDuration).Equal(end) {
		window := windowConfig{
			InSampleStart:  current,
			InSampleEnd:    current.Add(inSampleDuration),
			OutSampleStart: current.Add(inSampleDuration),
			OutSampleEnd:   current.Add(windowDuration),
		}
		
		windows = append(windows, window)
		current = current.Add(stepDuration)
	}
	
	return windows, nil
}

// calculateRobustness calculates the walk-forward efficiency ratio
func (wf *WalkForwardAnalyzer) calculateRobustness(windows []types.WalkForwardWindow) decimal.Decimal {
	if len(windows) == 0 {
		return decimal.Zero
	}
	
	var inSampleReturns, outSampleReturns decimal.Decimal
	validWindows := 0
	
	for _, w := range windows {
		if w.InSampleMetrics != nil && w.OutSampleMetrics != nil {
			inSampleReturns = inSampleReturns.Add(w.InSampleMetrics.TotalReturn)
			outSampleReturns = outSampleReturns.Add(w.OutSampleMetrics.TotalReturn)
			validWindows++
		}
	}
	
	if validWindows == 0 || inSampleReturns.IsZero() {
		return decimal.Zero
	}
	
	// Robustness = Out-of-sample return / In-sample return
	// Values > 0.5 indicate good strategy robustness
	robustness := outSampleReturns.Div(inSampleReturns)
	
	// Clamp to reasonable range [0, 2]
	if robustness.LessThan(decimal.Zero) {
		return decimal.Zero
	}
	if robustness.GreaterThan(decimal.NewFromFloat(2)) {
		return decimal.NewFromFloat(2)
	}
	
	return robustness
}
