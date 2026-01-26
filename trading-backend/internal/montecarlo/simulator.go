// Package montecarlo provides Monte Carlo simulation for strategy validation.
// Based on research: "Monte Carlo with 1000+ runs, confidence intervals"
// Tests: Robustness, drawdown distribution, parameter sensitivity
package montecarlo

import (
	"math"
	"math/rand"
	"sort"
	"sync"
	"time"

	"github.com/shopspring/decimal"
	"go.uber.org/zap"
)

// Simulator performs Monte Carlo simulations
type Simulator struct {
	logger *zap.Logger
	config *SimulatorConfig
	rng    *rand.Rand
	mu     sync.Mutex
}

// SimulatorConfig configures the simulator
type SimulatorConfig struct {
	NumSimulations   int       // Number of Monte Carlo runs
	Seed             int64     // Random seed (0 for time-based)
	ConfidenceLevels []float64 // Confidence levels to report
	ParallelWorkers  int       // Number of parallel workers
	BootstrapBlocks  int       // Block size for bootstrap
	AllowReplacement bool      // Bootstrap with replacement
}

// DefaultSimulatorConfig returns sensible defaults
func DefaultSimulatorConfig() *SimulatorConfig {
	return &SimulatorConfig{
		NumSimulations:   1000,
		Seed:             0,
		ConfidenceLevels: []float64{0.05, 0.25, 0.50, 0.75, 0.95},
		ParallelWorkers:  8,
		BootstrapBlocks:  20,
		AllowReplacement: true,
	}
}

// HighConfidenceConfig for more rigorous testing
func HighConfidenceConfig() *SimulatorConfig {
	return &SimulatorConfig{
		NumSimulations:   10000,
		Seed:             0,
		ConfidenceLevels: []float64{0.01, 0.05, 0.10, 0.25, 0.50, 0.75, 0.90, 0.95, 0.99},
		ParallelWorkers:  16,
		BootstrapBlocks:  50,
		AllowReplacement: true,
	}
}

// NewSimulator creates a new Monte Carlo simulator
func NewSimulator(logger *zap.Logger, config *SimulatorConfig) *Simulator {
	if config == nil {
		config = DefaultSimulatorConfig()
	}

	seed := config.Seed
	if seed == 0 {
		seed = time.Now().UnixNano()
	}

	return &Simulator{
		logger: logger,
		config: config,
		rng:    rand.New(rand.NewSource(seed)),
	}
}

// TradeSequence represents a sequence of trades
type TradeSequence struct {
	Returns    []float64                // Trade returns
	Timestamps []time.Time              // Trade timestamps
	Symbols    []string                 // Trade symbols
	Metadata   map[string][]interface{} // Additional metadata
}

// SimulationResult contains Monte Carlo simulation results
type SimulationResult struct {
	NumSimulations int               `json:"num_simulations"`
	OriginalEquity *EquityCurveStats `json:"original_equity"`

	// Distribution statistics
	FinalEquity  *Distribution `json:"final_equity"`
	MaxDrawdown  *Distribution `json:"max_drawdown"`
	SharpeRatio  *Distribution `json:"sharpe_ratio"`
	Volatility   *Distribution `json:"volatility"`
	WinRate      *Distribution `json:"win_rate"`
	ProfitFactor *Distribution `json:"profit_factor"`
	CAGR         *Distribution `json:"cagr"`

	// Confidence intervals
	ConfidenceIntervals map[string]map[string]float64 `json:"confidence_intervals"`

	// Risk metrics
	WorstCase           *EquityCurveStats `json:"worst_case"`
	BestCase            *EquityCurveStats `json:"best_case"`
	ProbabilityOfRuin   float64           `json:"probability_of_ruin"`
	ProbabilityOfTarget float64           `json:"probability_of_target"`

	// Robustness
	RobustnessScore float64 `json:"robustness_score"`
	Stability       float64 `json:"stability"`
}

// Distribution represents a statistical distribution
type Distribution struct {
	Mean        float64             `json:"mean"`
	Median      float64             `json:"median"`
	StdDev      float64             `json:"std_dev"`
	Min         float64             `json:"min"`
	Max         float64             `json:"max"`
	Skewness    float64             `json:"skewness"`
	Kurtosis    float64             `json:"kurtosis"`
	Percentiles map[float64]float64 `json:"percentiles"`
}

// EquityCurveStats contains equity curve statistics
type EquityCurveStats struct {
	FinalEquity    decimal.Decimal `json:"final_equity"`
	MaxDrawdown    float64         `json:"max_drawdown"`
	MaxDrawdownDur int             `json:"max_drawdown_duration"` // In periods
	TotalReturn    float64         `json:"total_return"`
	CAGR           float64         `json:"cagr"`
	SharpeRatio    float64         `json:"sharpe_ratio"`
	SortinoRatio   float64         `json:"sortino_ratio"`
	CalmarRatio    float64         `json:"calmar_ratio"`
	WinRate        float64         `json:"win_rate"`
	ProfitFactor   float64         `json:"profit_factor"`
	NumTrades      int             `json:"num_trades"`
}

// RunSimulation performs Monte Carlo simulation on trade sequence
func (s *Simulator) RunSimulation(trades *TradeSequence, initialCapital decimal.Decimal) *SimulationResult {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.logger.Info("starting Monte Carlo simulation",
		zap.Int("num_simulations", s.config.NumSimulations),
		zap.Int("num_trades", len(trades.Returns)),
	)

	// Calculate original equity curve stats
	originalStats := s.calculateEquityStats(trades.Returns, initialCapital)

	result := &SimulationResult{
		NumSimulations:      s.config.NumSimulations,
		OriginalEquity:      originalStats,
		ConfidenceIntervals: make(map[string]map[string]float64),
	}

	// Run parallel simulations
	simResults := s.runParallelSimulations(trades, initialCapital)

	// Aggregate results
	result.FinalEquity = s.calculateDistribution(extractFloats(simResults, "final_equity"))
	result.MaxDrawdown = s.calculateDistribution(extractFloats(simResults, "max_drawdown"))
	result.SharpeRatio = s.calculateDistribution(extractFloats(simResults, "sharpe"))
	result.Volatility = s.calculateDistribution(extractFloats(simResults, "volatility"))
	result.WinRate = s.calculateDistribution(extractFloats(simResults, "win_rate"))
	result.ProfitFactor = s.calculateDistribution(extractFloats(simResults, "profit_factor"))
	result.CAGR = s.calculateDistribution(extractFloats(simResults, "cagr"))

	// Calculate confidence intervals
	result.ConfidenceIntervals["final_equity"] = s.calculateConfidenceIntervals(extractFloats(simResults, "final_equity"))
	result.ConfidenceIntervals["max_drawdown"] = s.calculateConfidenceIntervals(extractFloats(simResults, "max_drawdown"))
	result.ConfidenceIntervals["sharpe"] = s.calculateConfidenceIntervals(extractFloats(simResults, "sharpe"))

	// Find worst and best cases
	result.WorstCase = s.findWorstCase(simResults)
	result.BestCase = s.findBestCase(simResults)

	// Calculate probabilities
	initialFloat, _ := initialCapital.Float64()
	result.ProbabilityOfRuin = s.calculateRuinProbability(simResults, initialFloat*0.5)
	result.ProbabilityOfTarget = s.calculateTargetProbability(simResults, initialFloat*2.0)

	// Calculate robustness score
	result.RobustnessScore = s.calculateRobustnessScore(result)
	result.Stability = s.calculateStability(simResults)

	s.logger.Info("Monte Carlo simulation complete",
		zap.Float64("robustness_score", result.RobustnessScore),
		zap.Float64("probability_of_ruin", result.ProbabilityOfRuin),
	)

	return result
}

// runParallelSimulations runs simulations in parallel
func (s *Simulator) runParallelSimulations(trades *TradeSequence, initialCapital decimal.Decimal) []*simulationRun {
	results := make([]*simulationRun, s.config.NumSimulations)

	// Worker pool
	numWorkers := s.config.ParallelWorkers
	jobs := make(chan int, s.config.NumSimulations)
	var wg sync.WaitGroup

	// Start workers
	for w := 0; w < numWorkers; w++ {
		wg.Add(1)
		go func(workerID int) {
			defer wg.Done()
			// Each worker gets its own RNG
			rng := rand.New(rand.NewSource(time.Now().UnixNano() + int64(workerID)))

			for simIdx := range jobs {
				shuffled := s.shuffleTrades(trades, rng)
				stats := s.calculateEquityStats(shuffled, initialCapital)
				results[simIdx] = &simulationRun{
					idx:   simIdx,
					stats: stats,
				}
			}
		}(w)
	}

	// Submit jobs
	for i := 0; i < s.config.NumSimulations; i++ {
		jobs <- i
	}
	close(jobs)

	wg.Wait()

	return results
}

// simulationRun contains a single simulation result
type simulationRun struct {
	idx   int
	stats *EquityCurveStats
}

// shuffleTrades creates a shuffled/bootstrapped trade sequence
func (s *Simulator) shuffleTrades(trades *TradeSequence, rng *rand.Rand) []float64 {
	n := len(trades.Returns)
	if n == 0 {
		return nil
	}

	result := make([]float64, n)

	if s.config.AllowReplacement {
		// Bootstrap with replacement
		for i := 0; i < n; i++ {
			result[i] = trades.Returns[rng.Intn(n)]
		}
	} else {
		// Shuffle without replacement
		perm := rng.Perm(n)
		for i, idx := range perm {
			result[i] = trades.Returns[idx]
		}
	}

	return result
}

// calculateEquityStats calculates equity curve statistics
func (s *Simulator) calculateEquityStats(returns []float64, initialCapital decimal.Decimal) *EquityCurveStats {
	if len(returns) == 0 {
		return &EquityCurveStats{FinalEquity: initialCapital}
	}

	initialFloat, _ := initialCapital.Float64()
	equity := initialFloat
	peak := initialFloat
	maxDD := 0.0
	maxDDDuration := 0
	currentDDDuration := 0

	wins := 0
	losses := 0
	grossProfit := 0.0
	grossLoss := 0.0

	equityCurve := make([]float64, len(returns)+1)
	equityCurve[0] = equity

	for i, ret := range returns {
		equity *= (1 + ret)
		equityCurve[i+1] = equity

		// Track wins/losses
		if ret > 0 {
			wins++
			grossProfit += ret * equity
		} else {
			losses++
			grossLoss += math.Abs(ret) * equity
		}

		// Track drawdown
		if equity > peak {
			peak = equity
			currentDDDuration = 0
		} else {
			dd := (peak - equity) / peak
			if dd > maxDD {
				maxDD = dd
			}
			currentDDDuration++
			if currentDDDuration > maxDDDuration {
				maxDDDuration = currentDDDuration
			}
		}
	}

	stats := &EquityCurveStats{
		FinalEquity:    decimal.NewFromFloat(equity),
		MaxDrawdown:    maxDD,
		MaxDrawdownDur: maxDDDuration,
		TotalReturn:    (equity - initialFloat) / initialFloat,
		NumTrades:      len(returns),
	}

	// Win rate
	if len(returns) > 0 {
		stats.WinRate = float64(wins) / float64(len(returns))
	}

	// Profit factor
	if grossLoss > 0 {
		stats.ProfitFactor = grossProfit / grossLoss
	}

	// Sharpe ratio (annualized, assuming daily returns)
	meanRet := 0.0
	for _, r := range returns {
		meanRet += r
	}
	meanRet /= float64(len(returns))

	variance := 0.0
	for _, r := range returns {
		diff := r - meanRet
		variance += diff * diff
	}
	variance /= float64(len(returns))
	stdDev := math.Sqrt(variance)

	if stdDev > 0 {
		stats.SharpeRatio = (meanRet / stdDev) * math.Sqrt(252)
	}

	// Sortino ratio (downside deviation)
	downsideVariance := 0.0
	downsideCount := 0
	for _, r := range returns {
		if r < 0 {
			downsideVariance += r * r
			downsideCount++
		}
	}
	if downsideCount > 0 {
		downsideStdDev := math.Sqrt(downsideVariance / float64(downsideCount))
		if downsideStdDev > 0 {
			stats.SortinoRatio = (meanRet / downsideStdDev) * math.Sqrt(252)
		}
	}

	// Calmar ratio
	if maxDD > 0 {
		annualReturn := stats.TotalReturn * (252.0 / float64(len(returns)))
		stats.CalmarRatio = annualReturn / maxDD
	}

	// CAGR (assuming 252 trading days per year)
	years := float64(len(returns)) / 252.0
	if years > 0 && equity > 0 {
		stats.CAGR = math.Pow(equity/initialFloat, 1/years) - 1
	}

	return stats
}

// calculateDistribution calculates distribution statistics
func (s *Simulator) calculateDistribution(values []float64) *Distribution {
	if len(values) == 0 {
		return &Distribution{}
	}

	// Sort for percentiles
	sorted := make([]float64, len(values))
	copy(sorted, values)
	sort.Float64s(sorted)

	n := float64(len(values))

	// Mean
	sum := 0.0
	for _, v := range values {
		sum += v
	}
	mean := sum / n

	// Variance and higher moments
	variance := 0.0
	skewSum := 0.0
	kurtSum := 0.0

	for _, v := range values {
		diff := v - mean
		variance += diff * diff
		skewSum += diff * diff * diff
		kurtSum += diff * diff * diff * diff
	}
	variance /= n
	stdDev := math.Sqrt(variance)

	skewness := 0.0
	kurtosis := 0.0
	if stdDev > 0 {
		skewness = (skewSum / n) / (stdDev * stdDev * stdDev)
		kurtosis = (kurtSum/n)/(variance*variance) - 3 // Excess kurtosis
	}

	dist := &Distribution{
		Mean:        mean,
		Median:      sorted[len(sorted)/2],
		StdDev:      stdDev,
		Min:         sorted[0],
		Max:         sorted[len(sorted)-1],
		Skewness:    skewness,
		Kurtosis:    kurtosis,
		Percentiles: make(map[float64]float64),
	}

	// Calculate percentiles
	for _, p := range s.config.ConfidenceLevels {
		idx := int(p * float64(len(sorted)-1))
		dist.Percentiles[p] = sorted[idx]
	}

	return dist
}

// calculateConfidenceIntervals calculates confidence intervals
func (s *Simulator) calculateConfidenceIntervals(values []float64) map[string]float64 {
	if len(values) == 0 {
		return nil
	}

	sorted := make([]float64, len(values))
	copy(sorted, values)
	sort.Float64s(sorted)

	intervals := make(map[string]float64)

	// Common confidence levels
	levels := []struct {
		name  string
		lower float64
		upper float64
	}{
		{"99%", 0.005, 0.995},
		{"95%", 0.025, 0.975},
		{"90%", 0.05, 0.95},
		{"80%", 0.10, 0.90},
	}

	for _, level := range levels {
		lowerIdx := int(level.lower * float64(len(sorted)-1))
		upperIdx := int(level.upper * float64(len(sorted)-1))

		intervals[level.name+"_lower"] = sorted[lowerIdx]
		intervals[level.name+"_upper"] = sorted[upperIdx]
	}

	return intervals
}

// findWorstCase finds the worst performing simulation
func (s *Simulator) findWorstCase(runs []*simulationRun) *EquityCurveStats {
	var worst *EquityCurveStats
	worstReturn := math.MaxFloat64

	for _, run := range runs {
		if run.stats.TotalReturn < worstReturn {
			worstReturn = run.stats.TotalReturn
			worst = run.stats
		}
	}

	return worst
}

// findBestCase finds the best performing simulation
func (s *Simulator) findBestCase(runs []*simulationRun) *EquityCurveStats {
	var best *EquityCurveStats
	bestReturn := -math.MaxFloat64

	for _, run := range runs {
		if run.stats.TotalReturn > bestReturn {
			bestReturn = run.stats.TotalReturn
			best = run.stats
		}
	}

	return best
}

// calculateRuinProbability calculates probability of drawdown below threshold
func (s *Simulator) calculateRuinProbability(runs []*simulationRun, ruinLevel float64) float64 {
	count := 0
	for _, run := range runs {
		finalFloat, _ := run.stats.FinalEquity.Float64()
		if finalFloat < ruinLevel {
			count++
		}
	}
	return float64(count) / float64(len(runs))
}

// calculateTargetProbability calculates probability of reaching target
func (s *Simulator) calculateTargetProbability(runs []*simulationRun, target float64) float64 {
	count := 0
	for _, run := range runs {
		finalFloat, _ := run.stats.FinalEquity.Float64()
		if finalFloat >= target {
			count++
		}
	}
	return float64(count) / float64(len(runs))
}

// calculateRobustnessScore calculates overall robustness
func (s *Simulator) calculateRobustnessScore(result *SimulationResult) float64 {
	score := 0.0

	// Factor 1: Win rate consistency (low variance in win rate = good)
	if result.WinRate != nil && result.WinRate.StdDev > 0 {
		winRateConsistency := 1 - math.Min(result.WinRate.StdDev/result.WinRate.Mean, 1)
		score += winRateConsistency * 0.2
	}

	// Factor 2: Sharpe ratio (median > 0.5 = good)
	if result.SharpeRatio != nil {
		sharpeScore := math.Min(result.SharpeRatio.Median/2.0, 1) * 0.25
		score += sharpeScore
	}

	// Factor 3: Low probability of ruin
	ruinScore := (1 - result.ProbabilityOfRuin) * 0.25
	score += ruinScore

	// Factor 4: High probability of reaching target
	targetScore := result.ProbabilityOfTarget * 0.15
	score += targetScore

	// Factor 5: Drawdown control
	if result.MaxDrawdown != nil {
		ddScore := math.Max(0, 1-result.MaxDrawdown.Median*2) * 0.15
		score += ddScore
	}

	return score
}

// calculateStability measures result stability across simulations
func (s *Simulator) calculateStability(runs []*simulationRun) float64 {
	if len(runs) == 0 {
		return 0
	}

	// Calculate coefficient of variation of final equity
	values := make([]float64, len(runs))
	for i, run := range runs {
		values[i], _ = run.stats.FinalEquity.Float64()
	}

	mean := 0.0
	for _, v := range values {
		mean += v
	}
	mean /= float64(len(values))

	variance := 0.0
	for _, v := range values {
		diff := v - mean
		variance += diff * diff
	}
	variance /= float64(len(values))

	if mean == 0 {
		return 0
	}

	cv := math.Sqrt(variance) / mean

	// Lower CV = higher stability (invert and normalize)
	stability := math.Max(0, 1-cv)

	return stability
}

// extractFloats extracts float values from simulation runs
func extractFloats(runs []*simulationRun, field string) []float64 {
	values := make([]float64, len(runs))

	for i, run := range runs {
		switch field {
		case "final_equity":
			values[i], _ = run.stats.FinalEquity.Float64()
		case "max_drawdown":
			values[i] = run.stats.MaxDrawdown
		case "sharpe":
			values[i] = run.stats.SharpeRatio
		case "volatility":
			// Implied from Sharpe
			if run.stats.SharpeRatio != 0 {
				values[i] = run.stats.TotalReturn / run.stats.SharpeRatio
			}
		case "win_rate":
			values[i] = run.stats.WinRate
		case "profit_factor":
			values[i] = run.stats.ProfitFactor
		case "cagr":
			values[i] = run.stats.CAGR
		}
	}

	return values
}

// ParameterSensitivity tests strategy sensitivity to parameter changes
type ParameterSensitivity struct {
	logger *zap.Logger
	sim    *Simulator
}

// NewParameterSensitivity creates a parameter sensitivity analyzer
func NewParameterSensitivity(logger *zap.Logger, sim *Simulator) *ParameterSensitivity {
	return &ParameterSensitivity{
		logger: logger,
		sim:    sim,
	}
}

// SensitivityResult contains parameter sensitivity analysis
type SensitivityResult struct {
	Parameter   string              `json:"parameter"`
	BaseValue   float64             `json:"base_value"`
	Variations  []float64           `json:"variations"`
	Results     []*EquityCurveStats `json:"results"`
	Sensitivity float64             `json:"sensitivity"` // % change in result per % change in param
	Optimal     float64             `json:"optimal"`
	IsRobust    bool                `json:"is_robust"` // Small changes don't kill performance
}

// AnalyzeSensitivity analyzes sensitivity to a parameter
func (ps *ParameterSensitivity) AnalyzeSensitivity(
	baseParam float64,
	variations []float64,
	runStrategy func(param float64) *TradeSequence,
	initialCapital decimal.Decimal,
) *SensitivityResult {
	result := &SensitivityResult{
		BaseValue:  baseParam,
		Variations: variations,
		Results:    make([]*EquityCurveStats, len(variations)),
	}

	baseResult := ps.sim.RunSimulation(runStrategy(baseParam), initialCapital)
	baseSharpe := baseResult.SharpeRatio.Median

	bestSharpe := baseSharpe
	bestParam := baseParam

	for i, variation := range variations {
		param := baseParam * variation
		trades := runStrategy(param)
		simResult := ps.sim.RunSimulation(trades, initialCapital)
		result.Results[i] = simResult.OriginalEquity

		if simResult.SharpeRatio.Median > bestSharpe {
			bestSharpe = simResult.SharpeRatio.Median
			bestParam = param
		}
	}

	result.Optimal = bestParam

	// Calculate sensitivity (average % change in Sharpe per % change in param)
	sensitivities := make([]float64, 0)
	for i, variation := range variations {
		if variation != 1 && baseSharpe != 0 {
			paramChange := (variation - 1) * 100 // % change in param
			sharpeChange := (result.Results[i].SharpeRatio - baseSharpe) / baseSharpe * 100
			if paramChange != 0 {
				sensitivities = append(sensitivities, math.Abs(sharpeChange/paramChange))
			}
		}
	}

	if len(sensitivities) > 0 {
		sum := 0.0
		for _, s := range sensitivities {
			sum += s
		}
		result.Sensitivity = sum / float64(len(sensitivities))
	}

	// Strategy is robust if small changes (+/-20%) don't significantly hurt performance
	result.IsRobust = result.Sensitivity < 0.5 // Less than 0.5% change in result per 1% param change

	return result
}
