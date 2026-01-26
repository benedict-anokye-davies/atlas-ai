// Package backtester provides Monte Carlo simulation for strategy validation.
package backtester

import (
	"math"
	"math/rand"
	"sort"
	"time"

	"github.com/atlas-desktop/trading-backend/pkg/types"
	"github.com/shopspring/decimal"
	"go.uber.org/zap"
)

// MonteCarloSimulator performs Monte Carlo analysis on trade results
type MonteCarloSimulator struct {
	logger *zap.Logger
	config types.MonteCarloConfig
	rng    *rand.Rand
}

// NewMonteCarloSimulator creates a new Monte Carlo simulator
func NewMonteCarloSimulator(logger *zap.Logger, config types.MonteCarloConfig) *MonteCarloSimulator {
	return &MonteCarloSimulator{
		logger: logger,
		config: config,
		rng:    rand.New(rand.NewSource(time.Now().UnixNano())),
	}
}

// Run performs Monte Carlo simulation on trade results
func (mc *MonteCarloSimulator) Run(trades []*types.Trade) *types.MonteCarloResult {
	if len(trades) == 0 {
		return &types.MonteCarloResult{Iterations: 0}
	}
	
	// Extract trade returns
	returns := make([]float64, len(trades))
	for i, trade := range trades {
		ret, _ := trade.PnL.Float64()
		returns[i] = ret
	}
	
	// Run simulations
	iterations := mc.config.Iterations
	if iterations <= 0 {
		iterations = 1000
	}
	
	simulatedReturns := make([]float64, iterations)
	maxDrawdowns := make([]float64, iterations)
	ruinCount := 0
	
	for i := 0; i < iterations; i++ {
		// Shuffle returns (bootstrap sampling)
		shuffled := mc.shuffleReturns(returns)
		
		// Calculate cumulative return and max drawdown for this path
		totalReturn, maxDD, isRuin := mc.simulatePath(shuffled)
		
		simulatedReturns[i] = totalReturn
		maxDrawdowns[i] = maxDD
		
		if isRuin {
			ruinCount++
		}
	}
	
	// Sort for percentile calculations
	sort.Float64s(simulatedReturns)
	sort.Float64s(maxDrawdowns)
	
	// Calculate statistics
	result := &types.MonteCarloResult{
		Iterations:      iterations,
		MedianReturn:    decimal.NewFromFloat(mc.percentile(simulatedReturns, 50)),
		P5Return:        decimal.NewFromFloat(mc.percentile(simulatedReturns, 5)),
		P95Return:       decimal.NewFromFloat(mc.percentile(simulatedReturns, 95)),
		ProbabilityRuin: decimal.NewFromFloat(float64(ruinCount) / float64(iterations)),
		MaxDrawdownP95:  decimal.NewFromFloat(mc.percentile(maxDrawdowns, 95)),
	}
	
	// Store distribution
	result.Distribution = make([]decimal.Decimal, len(simulatedReturns))
	for i, r := range simulatedReturns {
		result.Distribution[i] = decimal.NewFromFloat(r)
	}
	
	mc.logger.Info("Monte Carlo simulation complete",
		zap.Int("iterations", iterations),
		zap.String("medianReturn", result.MedianReturn.String()),
		zap.String("p5Return", result.P5Return.String()),
		zap.String("p95Return", result.P95Return.String()),
		zap.String("probabilityRuin", result.ProbabilityRuin.String()),
	)
	
	return result
}

// shuffleReturns creates a shuffled copy of returns
func (mc *MonteCarloSimulator) shuffleReturns(returns []float64) []float64 {
	shuffled := make([]float64, len(returns))
	copy(shuffled, returns)
	
	mc.rng.Shuffle(len(shuffled), func(i, j int) {
		shuffled[i], shuffled[j] = shuffled[j], shuffled[i]
	})
	
	return shuffled
}

// simulatePath simulates a single path and returns total return, max drawdown, and ruin status
func (mc *MonteCarloSimulator) simulatePath(returns []float64) (totalReturn float64, maxDrawdown float64, isRuin bool) {
	equity := 1.0 // Start at 1.0 (100%)
	peak := equity
	maxDD := 0.0
	ruinThreshold := 0.5 // Consider 50% loss as ruin
	
	for _, ret := range returns {
		equity += ret / 100 // Assuming returns are in percentage terms
		
		// Update peak
		if equity > peak {
			peak = equity
		}
		
		// Calculate drawdown
		if peak > 0 {
			dd := (peak - equity) / peak
			if dd > maxDD {
				maxDD = dd
			}
		}
		
		// Check for ruin
		if equity <= ruinThreshold {
			return equity - 1.0, maxDD, true
		}
	}
	
	return equity - 1.0, maxDD, false
}

// percentile calculates the nth percentile of sorted values
func (mc *MonteCarloSimulator) percentile(sorted []float64, p float64) float64 {
	if len(sorted) == 0 {
		return 0
	}
	
	index := (p / 100) * float64(len(sorted)-1)
	lower := int(math.Floor(index))
	upper := int(math.Ceil(index))
	
	if lower == upper {
		return sorted[lower]
	}
	
	// Linear interpolation
	weight := index - float64(lower)
	return sorted[lower]*(1-weight) + sorted[upper]*weight
}

// BootstrapConfidenceInterval calculates confidence interval using bootstrap
func (mc *MonteCarloSimulator) BootstrapConfidenceInterval(
	metric func([]*types.Trade) float64,
	trades []*types.Trade,
	confidence float64,
) (lower, upper float64) {
	iterations := mc.config.Iterations
	if iterations <= 0 {
		iterations = 1000
	}
	
	bootstrapValues := make([]float64, iterations)
	n := len(trades)
	
	for i := 0; i < iterations; i++ {
		// Bootstrap sample (sampling with replacement)
		sample := make([]*types.Trade, n)
		for j := 0; j < n; j++ {
			sample[j] = trades[mc.rng.Intn(n)]
		}
		
		bootstrapValues[i] = metric(sample)
	}
	
	sort.Float64s(bootstrapValues)
	
	alpha := 1 - confidence
	lowerIdx := int(alpha / 2 * float64(iterations))
	upperIdx := int((1 - alpha/2) * float64(iterations))
	
	return bootstrapValues[lowerIdx], bootstrapValues[upperIdx]
}
