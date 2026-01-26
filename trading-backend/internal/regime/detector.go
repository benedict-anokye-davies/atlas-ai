// Package regime provides market regime detection using HMM.
// Based on research: "HMM for regime detection, adjust strategy per regime"
// Detects: Bull, Bear, High-Vol, Low-Vol, Mean-Reverting, Trending
package regime

import (
	"math"
	"sync"
	"time"

	"github.com/shopspring/decimal"
	"go.uber.org/zap"
)

// RegimeType represents different market regimes
type RegimeType string

const (
	RegimeBull          RegimeType = "bull"           // Uptrend
	RegimeBear          RegimeType = "bear"           // Downtrend
	RegimeHighVol       RegimeType = "high_vol"       // High volatility
	RegimeLowVol        RegimeType = "low_vol"        // Low volatility
	RegimeMeanReverting RegimeType = "mean_reverting" // Range-bound
	RegimeTrending      RegimeType = "trending"       // Strong trend
	RegimeTransition    RegimeType = "transition"     // Regime change
	RegimeUnknown       RegimeType = "unknown"
)

// RegimeState represents the current market regime
type RegimeState struct {
	Primary       RegimeType             `json:"primary"`
	Secondary     RegimeType             `json:"secondary"`  // Optional secondary regime
	Confidence    float64                `json:"confidence"` // 0-1
	Duration      time.Duration          `json:"duration"`   // Time in regime
	StartedAt     time.Time              `json:"started_at"`
	Volatility    float64                `json:"volatility"`     // Current annualized vol
	Trend         float64                `json:"trend"`          // Trend strength (-1 to 1)
	MeanReversion float64                `json:"mean_reversion"` // MR coefficient
	Probabilities map[RegimeType]float64 `json:"probabilities"`
}

// RegimeDetector uses HMM to detect market regimes
type RegimeDetector struct {
	logger *zap.Logger
	config *RegimeConfig

	mu           sync.RWMutex
	currentState *RegimeState
	stateHistory []*RegimeState

	// HMM parameters (learned from data)
	transitionMatrix [][]float64 // State transition probabilities
	emissionMeans    []float64   // Emission means per state
	emissionVars     []float64   // Emission variances per state

	// Data buffers
	returns    []float64
	volatility []float64
	volumes    []float64
	windowSize int
}

// RegimeConfig configures the regime detector
type RegimeConfig struct {
	WindowSize        int           // Lookback window for regime detection
	MinRegimeDuration time.Duration // Minimum time before regime change
	VolatilityWindow  int           // Window for volatility calculation
	TrendWindow       int           // Window for trend calculation
	NumStates         int           // Number of HMM states
	VolThreshold      float64       // Threshold for high/low vol classification
	TrendThreshold    float64       // Threshold for trending classification
	MRThreshold       float64       // Mean reversion threshold
	ConfidenceMin     float64       // Minimum confidence to report regime
}

// DefaultRegimeConfig returns sensible defaults
func DefaultRegimeConfig() *RegimeConfig {
	return &RegimeConfig{
		WindowSize:        100,
		MinRegimeDuration: 1 * time.Hour,
		VolatilityWindow:  20,
		TrendWindow:       50,
		NumStates:         4, // Bull, Bear, HighVol, LowVol
		VolThreshold:      0.25,
		TrendThreshold:    0.3,
		MRThreshold:       -0.1,
		ConfidenceMin:     0.6,
	}
}

// NewRegimeDetector creates a new regime detector
func NewRegimeDetector(logger *zap.Logger, config *RegimeConfig) *RegimeDetector {
	if config == nil {
		config = DefaultRegimeConfig()
	}

	rd := &RegimeDetector{
		logger:       logger,
		config:       config,
		stateHistory: make([]*RegimeState, 0, 1000),
		returns:      make([]float64, 0, config.WindowSize*2),
		volatility:   make([]float64, 0, config.WindowSize*2),
		volumes:      make([]float64, 0, config.WindowSize*2),
		windowSize:   config.WindowSize,
	}

	// Initialize HMM with default parameters
	rd.initializeHMM()

	return rd
}

// initializeHMM sets up initial HMM parameters
func (rd *RegimeDetector) initializeHMM() {
	n := rd.config.NumStates

	// Transition matrix (uniform initial)
	rd.transitionMatrix = make([][]float64, n)
	for i := 0; i < n; i++ {
		rd.transitionMatrix[i] = make([]float64, n)
		for j := 0; j < n; j++ {
			if i == j {
				rd.transitionMatrix[i][j] = 0.9 // High self-transition
			} else {
				rd.transitionMatrix[i][j] = 0.1 / float64(n-1)
			}
		}
	}

	// Emission parameters (initial guesses)
	rd.emissionMeans = []float64{0.001, -0.001, 0.0, 0.0} // Bull, Bear, HighVol, LowVol
	rd.emissionVars = []float64{0.0001, 0.0001, 0.0004, 0.00005}
}

// AddDataPoint adds a new data point for regime detection
func (rd *RegimeDetector) AddDataPoint(price, volume decimal.Decimal, timestamp time.Time) {
	rd.mu.Lock()
	defer rd.mu.Unlock()

	priceFloat, _ := price.Float64()
	volFloat, _ := volume.Float64()

	// Calculate return if we have previous data
	if len(rd.returns) > 0 {
		// This would need previous price - simplified here
		rd.volumes = append(rd.volumes, volFloat)
	}

	// Trim buffers
	rd.trimBuffers()
}

// AddReturn adds a return observation
func (rd *RegimeDetector) AddReturn(ret float64) {
	rd.mu.Lock()
	defer rd.mu.Unlock()

	rd.returns = append(rd.returns, ret)

	// Calculate rolling volatility
	if len(rd.returns) >= rd.config.VolatilityWindow {
		vol := rd.calculateVolatility(rd.returns[len(rd.returns)-rd.config.VolatilityWindow:])
		rd.volatility = append(rd.volatility, vol)
	}

	rd.trimBuffers()
	rd.updateRegime()
}

// AddReturns adds multiple returns (batch)
func (rd *RegimeDetector) AddReturns(returns []float64) {
	for _, ret := range returns {
		rd.AddReturn(ret)
	}
}

// trimBuffers keeps buffers at manageable size
func (rd *RegimeDetector) trimBuffers() {
	maxSize := rd.windowSize * 2

	if len(rd.returns) > maxSize {
		rd.returns = rd.returns[len(rd.returns)-rd.windowSize:]
	}
	if len(rd.volatility) > maxSize {
		rd.volatility = rd.volatility[len(rd.volatility)-rd.windowSize:]
	}
	if len(rd.volumes) > maxSize {
		rd.volumes = rd.volumes[len(rd.volumes)-rd.windowSize:]
	}
}

// updateRegime recalculates the current regime
func (rd *RegimeDetector) updateRegime() {
	if len(rd.returns) < rd.config.WindowSize {
		return
	}

	// Calculate features
	recentReturns := rd.returns[len(rd.returns)-rd.config.WindowSize:]

	// 1. Trend (sum of returns normalized)
	trend := rd.calculateTrend(recentReturns)

	// 2. Volatility (annualized)
	vol := rd.calculateVolatility(recentReturns) * math.Sqrt(252)

	// 3. Mean reversion (autocorrelation)
	mr := rd.calculateMeanReversion(recentReturns)

	// 4. HMM state probabilities
	probs := rd.calculateStateProbabilities(recentReturns)

	// Determine primary regime
	primary, confidence := rd.classifyRegime(trend, vol, mr, probs)

	// Determine secondary regime if applicable
	secondary := rd.classifySecondary(trend, vol, mr, primary)

	// Create new state
	newState := &RegimeState{
		Primary:       primary,
		Secondary:     secondary,
		Confidence:    confidence,
		Volatility:    vol,
		Trend:         trend,
		MeanReversion: mr,
		Probabilities: probs,
		StartedAt:     time.Now(),
	}

	// Check if regime changed
	if rd.currentState != nil && rd.currentState.Primary == primary {
		newState.StartedAt = rd.currentState.StartedAt
		newState.Duration = time.Since(rd.currentState.StartedAt)
	}

	// Update state
	rd.currentState = newState
	rd.stateHistory = append(rd.stateHistory, newState)

	// Trim history
	if len(rd.stateHistory) > 1000 {
		rd.stateHistory = rd.stateHistory[500:]
	}
}

// calculateTrend calculates trend strength
func (rd *RegimeDetector) calculateTrend(returns []float64) float64 {
	if len(returns) == 0 {
		return 0
	}

	// Simple: sum of returns normalized by volatility
	sum := 0.0
	for _, r := range returns {
		sum += r
	}

	vol := rd.calculateVolatility(returns)
	if vol == 0 {
		return 0
	}

	// Normalize to [-1, 1]
	trend := sum / (vol * math.Sqrt(float64(len(returns))))

	// Clamp
	if trend > 1 {
		trend = 1
	} else if trend < -1 {
		trend = -1
	}

	return trend
}

// calculateVolatility calculates standard deviation
func (rd *RegimeDetector) calculateVolatility(returns []float64) float64 {
	if len(returns) < 2 {
		return 0
	}

	// Mean
	mean := 0.0
	for _, r := range returns {
		mean += r
	}
	mean /= float64(len(returns))

	// Variance
	variance := 0.0
	for _, r := range returns {
		diff := r - mean
		variance += diff * diff
	}
	variance /= float64(len(returns) - 1)

	return math.Sqrt(variance)
}

// calculateMeanReversion calculates autocorrelation (negative = mean reverting)
func (rd *RegimeDetector) calculateMeanReversion(returns []float64) float64 {
	if len(returns) < 3 {
		return 0
	}

	// Lag-1 autocorrelation
	n := len(returns)

	// Mean
	mean := 0.0
	for _, r := range returns {
		mean += r
	}
	mean /= float64(n)

	// Autocovariance and variance
	autocovariance := 0.0
	variance := 0.0

	for i := 1; i < n; i++ {
		autocovariance += (returns[i] - mean) * (returns[i-1] - mean)
		variance += (returns[i] - mean) * (returns[i] - mean)
	}

	if variance == 0 {
		return 0
	}

	return autocovariance / variance
}

// calculateStateProbabilities uses HMM forward algorithm
func (rd *RegimeDetector) calculateStateProbabilities(returns []float64) map[RegimeType]float64 {
	if len(returns) == 0 {
		return make(map[RegimeType]float64)
	}

	n := rd.config.NumStates

	// Forward algorithm (simplified)
	alpha := make([]float64, n)

	// Initial probabilities (uniform)
	for i := 0; i < n; i++ {
		alpha[i] = 1.0 / float64(n)
	}

	// Forward pass
	for _, ret := range returns {
		newAlpha := make([]float64, n)

		for j := 0; j < n; j++ {
			sum := 0.0
			for i := 0; i < n; i++ {
				sum += alpha[i] * rd.transitionMatrix[i][j]
			}

			// Emission probability (Gaussian)
			emission := rd.gaussianPDF(ret, rd.emissionMeans[j], rd.emissionVars[j])
			newAlpha[j] = sum * emission
		}

		// Normalize
		total := 0.0
		for _, a := range newAlpha {
			total += a
		}
		if total > 0 {
			for j := 0; j < n; j++ {
				newAlpha[j] /= total
			}
		}

		alpha = newAlpha
	}

	// Map to regime types
	regimeTypes := []RegimeType{RegimeBull, RegimeBear, RegimeHighVol, RegimeLowVol}
	probs := make(map[RegimeType]float64)

	for i, rt := range regimeTypes {
		if i < len(alpha) {
			probs[rt] = alpha[i]
		}
	}

	return probs
}

// gaussianPDF calculates Gaussian probability density
func (rd *RegimeDetector) gaussianPDF(x, mean, variance float64) float64 {
	if variance <= 0 {
		variance = 0.0001
	}

	diff := x - mean
	exponent := -0.5 * diff * diff / variance
	coefficient := 1.0 / math.Sqrt(2*math.Pi*variance)

	return coefficient * math.Exp(exponent)
}

// classifyRegime determines the primary regime
func (rd *RegimeDetector) classifyRegime(trend, vol, mr float64, probs map[RegimeType]float64) (RegimeType, float64) {
	// Rule-based classification with HMM probabilities

	// Find highest probability regime
	maxProb := 0.0
	maxRegime := RegimeUnknown
	for regime, prob := range probs {
		if prob > maxProb {
			maxProb = prob
			maxRegime = regime
		}
	}

	// Override with rule-based if strong signal
	if vol > rd.config.VolThreshold {
		if maxProb < 0.7 {
			maxRegime = RegimeHighVol
			maxProb = 0.5 + vol/2 // Confidence based on vol level
		}
	} else if vol < rd.config.VolThreshold/2 {
		if maxProb < 0.7 {
			maxRegime = RegimeLowVol
			maxProb = 0.5 + (rd.config.VolThreshold-vol)/rd.config.VolThreshold
		}
	}

	if math.Abs(trend) > rd.config.TrendThreshold {
		if trend > 0 && maxRegime != RegimeHighVol {
			maxRegime = RegimeBull
			maxProb = 0.5 + trend/2
		} else if trend < 0 && maxRegime != RegimeHighVol {
			maxRegime = RegimeBear
			maxProb = 0.5 + math.Abs(trend)/2
		}
	}

	if mr < rd.config.MRThreshold && maxProb < 0.6 {
		maxRegime = RegimeMeanReverting
		maxProb = 0.5 + math.Abs(mr)
	}

	// Clamp confidence
	if maxProb > 1 {
		maxProb = 1
	}

	return maxRegime, maxProb
}

// classifySecondary determines secondary regime
func (rd *RegimeDetector) classifySecondary(trend, vol, mr float64, primary RegimeType) RegimeType {
	switch primary {
	case RegimeBull, RegimeBear:
		if vol > rd.config.VolThreshold {
			return RegimeHighVol
		} else if vol < rd.config.VolThreshold/2 {
			return RegimeLowVol
		}
	case RegimeHighVol, RegimeLowVol:
		if trend > rd.config.TrendThreshold {
			return RegimeBull
		} else if trend < -rd.config.TrendThreshold {
			return RegimeBear
		} else if mr < rd.config.MRThreshold {
			return RegimeMeanReverting
		}
	case RegimeMeanReverting:
		if vol > rd.config.VolThreshold {
			return RegimeHighVol
		}
	}

	return RegimeUnknown
}

// GetCurrentRegime returns the current regime state
func (rd *RegimeDetector) GetCurrentRegime() *RegimeState {
	rd.mu.RLock()
	defer rd.mu.RUnlock()

	if rd.currentState == nil {
		return &RegimeState{
			Primary:    RegimeUnknown,
			Confidence: 0,
		}
	}

	// Update duration
	state := *rd.currentState
	state.Duration = time.Since(state.StartedAt)

	return &state
}

// GetRegimeHistory returns recent regime history
func (rd *RegimeDetector) GetRegimeHistory(limit int) []*RegimeState {
	rd.mu.RLock()
	defer rd.mu.RUnlock()

	if limit <= 0 || limit > len(rd.stateHistory) {
		limit = len(rd.stateHistory)
	}

	start := len(rd.stateHistory) - limit
	if start < 0 {
		start = 0
	}

	result := make([]*RegimeState, limit)
	copy(result, rd.stateHistory[start:])

	return result
}

// GetStrategyAdjustments returns recommended strategy adjustments
func (rd *RegimeDetector) GetStrategyAdjustments() *StrategyAdjustments {
	rd.mu.RLock()
	defer rd.mu.RUnlock()

	if rd.currentState == nil {
		return &StrategyAdjustments{
			PositionSizeMultiplier: 1.0,
			StopLossMultiplier:     1.0,
			TakeProfitMultiplier:   1.0,
			PreferredStrategies:    []string{"any"},
			AvoidStrategies:        []string{},
		}
	}

	adj := &StrategyAdjustments{}

	switch rd.currentState.Primary {
	case RegimeBull:
		adj.PositionSizeMultiplier = 1.2 // Increase position
		adj.StopLossMultiplier = 0.8     // Tighter stops (trend protection)
		adj.TakeProfitMultiplier = 1.5   // Let winners run
		adj.PreferredStrategies = []string{"momentum", "trend_following", "breakout"}
		adj.AvoidStrategies = []string{"mean_reversion", "short"}

	case RegimeBear:
		adj.PositionSizeMultiplier = 0.8 // Reduce position
		adj.StopLossMultiplier = 0.7     // Tighter stops
		adj.TakeProfitMultiplier = 1.2   // Take profits earlier
		adj.PreferredStrategies = []string{"short", "hedging", "defensive"}
		adj.AvoidStrategies = []string{"long_momentum", "breakout"}

	case RegimeHighVol:
		adj.PositionSizeMultiplier = 0.5 // Significantly reduce position
		adj.StopLossMultiplier = 1.5     // Wider stops
		adj.TakeProfitMultiplier = 2.0   // Higher targets
		adj.PreferredStrategies = []string{"volatility", "options", "straddle"}
		adj.AvoidStrategies = []string{"leverage", "tight_stops"}

	case RegimeLowVol:
		adj.PositionSizeMultiplier = 1.5 // Increase position
		adj.StopLossMultiplier = 0.5     // Very tight stops
		adj.TakeProfitMultiplier = 0.8   // Lower targets
		adj.PreferredStrategies = []string{"carry", "range", "selling_vol"}
		adj.AvoidStrategies = []string{"breakout", "momentum"}

	case RegimeMeanReverting:
		adj.PositionSizeMultiplier = 1.2 // Good for MR strategies
		adj.StopLossMultiplier = 0.8
		adj.TakeProfitMultiplier = 0.9 // Take profits at mean
		adj.PreferredStrategies = []string{"mean_reversion", "pairs", "statistical_arb"}
		adj.AvoidStrategies = []string{"trend_following", "breakout"}

	case RegimeTrending:
		adj.PositionSizeMultiplier = 1.3
		adj.StopLossMultiplier = 1.0
		adj.TakeProfitMultiplier = 1.5
		adj.PreferredStrategies = []string{"trend_following", "momentum"}
		adj.AvoidStrategies = []string{"counter_trend", "mean_reversion"}

	default:
		adj.PositionSizeMultiplier = 0.7 // Conservative in unknown
		adj.StopLossMultiplier = 1.0
		adj.TakeProfitMultiplier = 1.0
		adj.PreferredStrategies = []string{"any"}
		adj.AvoidStrategies = []string{}
	}

	// Adjust for confidence
	if rd.currentState.Confidence < 0.7 {
		// Low confidence: reduce adjustments toward neutral
		adj.PositionSizeMultiplier = 1 + (adj.PositionSizeMultiplier-1)*rd.currentState.Confidence
		adj.StopLossMultiplier = 1 + (adj.StopLossMultiplier-1)*rd.currentState.Confidence
		adj.TakeProfitMultiplier = 1 + (adj.TakeProfitMultiplier-1)*rd.currentState.Confidence
	}

	return adj
}

// StrategyAdjustments contains recommended strategy modifications
type StrategyAdjustments struct {
	PositionSizeMultiplier float64  `json:"position_size_multiplier"`
	StopLossMultiplier     float64  `json:"stop_loss_multiplier"`
	TakeProfitMultiplier   float64  `json:"take_profit_multiplier"`
	PreferredStrategies    []string `json:"preferred_strategies"`
	AvoidStrategies        []string `json:"avoid_strategies"`
}

// UpdateHMM updates HMM parameters using EM (simplified Baum-Welch)
func (rd *RegimeDetector) UpdateHMM(returns []float64) {
	rd.mu.Lock()
	defer rd.mu.Unlock()

	if len(returns) < rd.config.WindowSize {
		return
	}

	// Simplified parameter update (full Baum-Welch would go here)
	// Update emission means based on classified returns

	// Group returns by likely state
	groups := make([][]float64, rd.config.NumStates)
	for i := range groups {
		groups[i] = make([]float64, 0)
	}

	// Classify each return
	for _, ret := range returns {
		vol := math.Abs(ret)

		var state int
		if ret > 0.01 {
			state = 0 // Bull
		} else if ret < -0.01 {
			state = 1 // Bear
		} else if vol > 0.02 {
			state = 2 // High vol
		} else {
			state = 3 // Low vol
		}

		if state < rd.config.NumStates {
			groups[state] = append(groups[state], ret)
		}
	}

	// Update means and variances
	for i := 0; i < rd.config.NumStates; i++ {
		if len(groups[i]) > 10 {
			mean := 0.0
			for _, r := range groups[i] {
				mean += r
			}
			mean /= float64(len(groups[i]))

			variance := 0.0
			for _, r := range groups[i] {
				diff := r - mean
				variance += diff * diff
			}
			variance /= float64(len(groups[i]))

			// Exponential smoothing update
			alpha := 0.1
			rd.emissionMeans[i] = (1-alpha)*rd.emissionMeans[i] + alpha*mean
			rd.emissionVars[i] = (1-alpha)*rd.emissionVars[i] + alpha*variance
		}
	}

	rd.logger.Debug("HMM parameters updated",
		zap.Float64s("means", rd.emissionMeans),
		zap.Float64s("vars", rd.emissionVars),
	)
}

// IsRegimeTransition checks if we're in a regime transition
func (rd *RegimeDetector) IsRegimeTransition() bool {
	rd.mu.RLock()
	defer rd.mu.RUnlock()

	if rd.currentState == nil || rd.currentState.Duration < rd.config.MinRegimeDuration {
		return true
	}

	return rd.currentState.Confidence < rd.config.ConfidenceMin
}

// RegimeStats returns regime statistics
func (rd *RegimeDetector) RegimeStats() *RegimeStatistics {
	rd.mu.RLock()
	defer rd.mu.RUnlock()

	stats := &RegimeStatistics{
		RegimeCounts:    make(map[RegimeType]int),
		RegimeDurations: make(map[RegimeType]time.Duration),
	}

	for _, state := range rd.stateHistory {
		stats.RegimeCounts[state.Primary]++
		stats.RegimeDurations[state.Primary] += state.Duration
		stats.TotalObservations++
	}

	// Calculate percentages
	stats.RegimePercentages = make(map[RegimeType]float64)
	if stats.TotalObservations > 0 {
		for regime, count := range stats.RegimeCounts {
			stats.RegimePercentages[regime] = float64(count) / float64(stats.TotalObservations)
		}
	}

	if rd.currentState != nil {
		stats.CurrentRegime = rd.currentState.Primary
		stats.CurrentConfidence = rd.currentState.Confidence
	}

	return stats
}

// RegimeStatistics contains regime statistics
type RegimeStatistics struct {
	CurrentRegime     RegimeType                   `json:"current_regime"`
	CurrentConfidence float64                      `json:"current_confidence"`
	RegimeCounts      map[RegimeType]int           `json:"regime_counts"`
	RegimeDurations   map[RegimeType]time.Duration `json:"regime_durations"`
	RegimePercentages map[RegimeType]float64       `json:"regime_percentages"`
	TotalObservations int                          `json:"total_observations"`
}
