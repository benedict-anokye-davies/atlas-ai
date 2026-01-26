// Package optimization provides strategy parameter optimization.
// Based on research: "Walk-forward optimization with out-of-sample testing"
// Methods: Grid search, genetic algorithm, Bayesian optimization
package optimization

import (
	"context"
	"math"
	"math/rand"
	"sort"
	"sync"
	"time"

	"go.uber.org/zap"
)

// Optimizer performs strategy parameter optimization
type Optimizer struct {
	logger *zap.Logger
	config *OptimizerConfig
	rng    *rand.Rand
}

// OptimizerConfig configures the optimizer
type OptimizerConfig struct {
	Method           OptimizationMethod
	MaxIterations    int
	TargetMetric     string // Metric to optimize (sharpe, return, calmar)
	MinimizationMode bool   // True if we want to minimize (e.g., drawdown)
	Timeout          time.Duration
	ParallelWorkers  int

	// Grid search
	GridResolution int

	// Genetic algorithm
	PopulationSize int
	MutationRate   float64
	CrossoverRate  float64
	EliteCount     int
	Generations    int

	// Walk-forward
	InSamplePct float64 // % of data for in-sample
	NumFolds    int     // Number of walk-forward periods
	AnchoredWF  bool    // Use expanding window
}

// OptimizationMethod represents optimization algorithm
type OptimizationMethod string

const (
	MethodGridSearch   OptimizationMethod = "grid"
	MethodGeneticAlgo  OptimizationMethod = "genetic"
	MethodBayesian     OptimizationMethod = "bayesian"
	MethodRandomSearch OptimizationMethod = "random"
	MethodWalkForward  OptimizationMethod = "walk_forward"
)

// DefaultOptimizerConfig returns sensible defaults
func DefaultOptimizerConfig() *OptimizerConfig {
	return &OptimizerConfig{
		Method:           MethodGeneticAlgo,
		MaxIterations:    1000,
		TargetMetric:     "sharpe",
		MinimizationMode: false,
		Timeout:          10 * time.Minute,
		ParallelWorkers:  8,
		GridResolution:   10,
		PopulationSize:   50,
		MutationRate:     0.1,
		CrossoverRate:    0.7,
		EliteCount:       5,
		Generations:      100,
		InSamplePct:      0.7,
		NumFolds:         5,
		AnchoredWF:       false,
	}
}

// Parameter represents an optimization parameter
type Parameter struct {
	Name     string    `json:"name"`
	Type     ParamType `json:"type"`
	Min      float64   `json:"min"`
	Max      float64   `json:"max"`
	Step     float64   `json:"step,omitempty"`
	Default  float64   `json:"default"`
	Discrete []float64 `json:"discrete,omitempty"` // For discrete choices
}

// ParamType represents parameter type
type ParamType string

const (
	ParamTypeContinuous ParamType = "continuous"
	ParamTypeInteger    ParamType = "integer"
	ParamTypeDiscrete   ParamType = "discrete"
)

// ParamSet represents a set of parameter values
type ParamSet map[string]float64

// ObjectiveFunc evaluates a parameter set and returns a metric
type ObjectiveFunc func(params ParamSet) (float64, error)

// NewOptimizer creates a new optimizer
func NewOptimizer(logger *zap.Logger, config *OptimizerConfig) *Optimizer {
	if config == nil {
		config = DefaultOptimizerConfig()
	}

	return &Optimizer{
		logger: logger,
		config: config,
		rng:    rand.New(rand.NewSource(time.Now().UnixNano())),
	}
}

// OptimizationResult contains optimization results
type OptimizationResult struct {
	BestParams      ParamSet           `json:"best_params"`
	BestScore       float64            `json:"best_score"`
	AllResults      []EvaluationResult `json:"all_results"`
	ConvergenceHist []float64          `json:"convergence_history"`
	Duration        time.Duration      `json:"duration"`
	Iterations      int                `json:"iterations"`
	Method          OptimizationMethod `json:"method"`

	// Walk-forward specific
	WalkForwardResults []*WalkForwardFold `json:"walk_forward_results,omitempty"`
	OOSPerformance     float64            `json:"oos_performance,omitempty"`
	ISvsOOSDegradation float64            `json:"is_vs_oos_degradation,omitempty"`
}

// EvaluationResult represents a single parameter evaluation
type EvaluationResult struct {
	Params    ParamSet      `json:"params"`
	Score     float64       `json:"score"`
	Iteration int           `json:"iteration"`
	Duration  time.Duration `json:"duration"`
}

// WalkForwardFold contains results for one walk-forward period
type WalkForwardFold struct {
	FoldNumber      int       `json:"fold_number"`
	InSampleStart   time.Time `json:"in_sample_start"`
	InSampleEnd     time.Time `json:"in_sample_end"`
	OutSampleStart  time.Time `json:"out_sample_start"`
	OutSampleEnd    time.Time `json:"out_sample_end"`
	OptimizedParams ParamSet  `json:"optimized_params"`
	InSampleScore   float64   `json:"in_sample_score"`
	OutSampleScore  float64   `json:"out_sample_score"`
	Degradation     float64   `json:"degradation"` // IS vs OOS difference
}

// Optimize runs optimization on parameter space
func (o *Optimizer) Optimize(ctx context.Context, params []Parameter, objective ObjectiveFunc) (*OptimizationResult, error) {
	startTime := time.Now()

	ctx, cancel := context.WithTimeout(ctx, o.config.Timeout)
	defer cancel()

	var result *OptimizationResult
	var err error

	switch o.config.Method {
	case MethodGridSearch:
		result, err = o.gridSearch(ctx, params, objective)
	case MethodGeneticAlgo:
		result, err = o.geneticAlgorithm(ctx, params, objective)
	case MethodRandomSearch:
		result, err = o.randomSearch(ctx, params, objective)
	default:
		result, err = o.geneticAlgorithm(ctx, params, objective)
	}

	if err != nil {
		return nil, err
	}

	result.Duration = time.Since(startTime)
	result.Method = o.config.Method

	return result, nil
}

// gridSearch performs grid search optimization
func (o *Optimizer) gridSearch(ctx context.Context, params []Parameter, objective ObjectiveFunc) (*OptimizationResult, error) {
	result := &OptimizationResult{
		AllResults:      make([]EvaluationResult, 0),
		ConvergenceHist: make([]float64, 0),
	}

	// Generate all parameter combinations
	combinations := o.generateGridCombinations(params)

	o.logger.Info("starting grid search",
		zap.Int("combinations", len(combinations)),
	)

	// Evaluate in parallel
	results := make(chan EvaluationResult, len(combinations))
	var wg sync.WaitGroup

	sem := make(chan struct{}, o.config.ParallelWorkers)

	for i, combo := range combinations {
		select {
		case <-ctx.Done():
			close(results)
			return result, ctx.Err()
		default:
		}

		wg.Add(1)
		go func(idx int, params ParamSet) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			start := time.Now()
			score, err := objective(params)
			if err != nil {
				return
			}

			results <- EvaluationResult{
				Params:    params,
				Score:     score,
				Iteration: idx,
				Duration:  time.Since(start),
			}
		}(i, combo)
	}

	go func() {
		wg.Wait()
		close(results)
	}()

	// Collect results
	bestScore := math.Inf(-1)
	if o.config.MinimizationMode {
		bestScore = math.Inf(1)
	}

	for res := range results {
		result.AllResults = append(result.AllResults, res)
		result.Iterations++

		isBetter := res.Score > bestScore
		if o.config.MinimizationMode {
			isBetter = res.Score < bestScore
		}

		if isBetter {
			bestScore = res.Score
			result.BestParams = res.Params
			result.BestScore = res.Score
		}

		result.ConvergenceHist = append(result.ConvergenceHist, bestScore)
	}

	return result, nil
}

// generateGridCombinations generates all grid combinations
func (o *Optimizer) generateGridCombinations(params []Parameter) []ParamSet {
	// Generate grid values for each parameter
	gridValues := make([][]float64, len(params))

	for i, param := range params {
		switch param.Type {
		case ParamTypeDiscrete:
			gridValues[i] = param.Discrete
		case ParamTypeInteger:
			step := param.Step
			if step == 0 {
				step = 1
			}
			values := make([]float64, 0)
			for v := param.Min; v <= param.Max; v += step {
				values = append(values, math.Round(v))
			}
			gridValues[i] = values
		default:
			step := (param.Max - param.Min) / float64(o.config.GridResolution)
			values := make([]float64, 0, o.config.GridResolution+1)
			for v := param.Min; v <= param.Max; v += step {
				values = append(values, v)
			}
			gridValues[i] = values
		}
	}

	// Generate Cartesian product
	return o.cartesianProduct(params, gridValues, 0, make(ParamSet))
}

// cartesianProduct generates all combinations recursively
func (o *Optimizer) cartesianProduct(params []Parameter, gridValues [][]float64, idx int, current ParamSet) []ParamSet {
	if idx == len(params) {
		// Make a copy
		result := make(ParamSet)
		for k, v := range current {
			result[k] = v
		}
		return []ParamSet{result}
	}

	var combinations []ParamSet
	for _, val := range gridValues[idx] {
		current[params[idx].Name] = val
		combinations = append(combinations, o.cartesianProduct(params, gridValues, idx+1, current)...)
	}

	return combinations
}

// geneticAlgorithm performs genetic algorithm optimization
func (o *Optimizer) geneticAlgorithm(ctx context.Context, params []Parameter, objective ObjectiveFunc) (*OptimizationResult, error) {
	result := &OptimizationResult{
		AllResults:      make([]EvaluationResult, 0),
		ConvergenceHist: make([]float64, 0),
	}

	// Initialize population
	population := o.initializePopulation(params)

	o.logger.Info("starting genetic algorithm",
		zap.Int("population_size", len(population)),
		zap.Int("generations", o.config.Generations),
	)

	bestScore := math.Inf(-1)
	if o.config.MinimizationMode {
		bestScore = math.Inf(1)
	}

	for gen := 0; gen < o.config.Generations; gen++ {
		select {
		case <-ctx.Done():
			return result, ctx.Err()
		default:
		}

		// Evaluate population
		scores := make([]float64, len(population))
		var wg sync.WaitGroup
		var mu sync.Mutex

		sem := make(chan struct{}, o.config.ParallelWorkers)

		for i, individual := range population {
			wg.Add(1)
			go func(idx int, params ParamSet) {
				defer wg.Done()
				sem <- struct{}{}
				defer func() { <-sem }()

				score, err := objective(params)
				if err != nil {
					score = math.Inf(-1)
					if o.config.MinimizationMode {
						score = math.Inf(1)
					}
				}

				mu.Lock()
				scores[idx] = score
				mu.Unlock()
			}(i, individual)
		}

		wg.Wait()

		// Find best in generation
		for i, score := range scores {
			isBetter := score > bestScore
			if o.config.MinimizationMode {
				isBetter = score < bestScore
			}

			if isBetter {
				bestScore = score
				result.BestParams = population[i]
				result.BestScore = score
			}

			result.AllResults = append(result.AllResults, EvaluationResult{
				Params:    population[i],
				Score:     score,
				Iteration: gen*len(population) + i,
			})
		}

		result.ConvergenceHist = append(result.ConvergenceHist, bestScore)
		result.Iterations = (gen + 1) * len(population)

		// Create next generation
		population = o.evolvePopulation(params, population, scores)
	}

	return result, nil
}

// initializePopulation creates initial random population
func (o *Optimizer) initializePopulation(params []Parameter) []ParamSet {
	population := make([]ParamSet, o.config.PopulationSize)

	for i := 0; i < o.config.PopulationSize; i++ {
		individual := make(ParamSet)
		for _, param := range params {
			individual[param.Name] = o.randomParamValue(param)
		}
		population[i] = individual
	}

	return population
}

// randomParamValue generates a random value for a parameter
func (o *Optimizer) randomParamValue(param Parameter) float64 {
	switch param.Type {
	case ParamTypeDiscrete:
		if len(param.Discrete) > 0 {
			return param.Discrete[o.rng.Intn(len(param.Discrete))]
		}
	case ParamTypeInteger:
		return math.Round(param.Min + o.rng.Float64()*(param.Max-param.Min))
	}
	return param.Min + o.rng.Float64()*(param.Max-param.Min)
}

// evolvePopulation creates next generation
func (o *Optimizer) evolvePopulation(params []Parameter, population []ParamSet, scores []float64) []ParamSet {
	// Sort by score
	indices := make([]int, len(population))
	for i := range indices {
		indices[i] = i
	}

	sort.Slice(indices, func(i, j int) bool {
		if o.config.MinimizationMode {
			return scores[indices[i]] < scores[indices[j]]
		}
		return scores[indices[i]] > scores[indices[j]]
	})

	newPopulation := make([]ParamSet, o.config.PopulationSize)

	// Elite: keep top performers
	for i := 0; i < o.config.EliteCount && i < len(indices); i++ {
		newPopulation[i] = o.copyParams(population[indices[i]])
	}

	// Fill rest with crossover and mutation
	for i := o.config.EliteCount; i < o.config.PopulationSize; i++ {
		// Tournament selection
		parent1 := o.tournamentSelect(population, scores)
		parent2 := o.tournamentSelect(population, scores)

		// Crossover
		var child ParamSet
		if o.rng.Float64() < o.config.CrossoverRate {
			child = o.crossover(params, parent1, parent2)
		} else {
			child = o.copyParams(parent1)
		}

		// Mutation
		child = o.mutate(params, child)

		newPopulation[i] = child
	}

	return newPopulation
}

// tournamentSelect performs tournament selection
func (o *Optimizer) tournamentSelect(population []ParamSet, scores []float64) ParamSet {
	tournamentSize := 3
	bestIdx := o.rng.Intn(len(population))

	for i := 1; i < tournamentSize; i++ {
		idx := o.rng.Intn(len(population))
		isBetter := scores[idx] > scores[bestIdx]
		if o.config.MinimizationMode {
			isBetter = scores[idx] < scores[bestIdx]
		}
		if isBetter {
			bestIdx = idx
		}
	}

	return population[bestIdx]
}

// crossover performs uniform crossover
func (o *Optimizer) crossover(params []Parameter, parent1, parent2 ParamSet) ParamSet {
	child := make(ParamSet)

	for _, param := range params {
		if o.rng.Float64() < 0.5 {
			child[param.Name] = parent1[param.Name]
		} else {
			child[param.Name] = parent2[param.Name]
		}
	}

	return child
}

// mutate performs mutation
func (o *Optimizer) mutate(params []Parameter, individual ParamSet) ParamSet {
	mutated := o.copyParams(individual)

	for _, param := range params {
		if o.rng.Float64() < o.config.MutationRate {
			// Gaussian mutation
			current := mutated[param.Name]
			range_ := param.Max - param.Min
			delta := o.rng.NormFloat64() * range_ * 0.1

			newVal := current + delta

			// Clamp to bounds
			if newVal < param.Min {
				newVal = param.Min
			}
			if newVal > param.Max {
				newVal = param.Max
			}

			if param.Type == ParamTypeInteger {
				newVal = math.Round(newVal)
			}

			mutated[param.Name] = newVal
		}
	}

	return mutated
}

// copyParams creates a deep copy of parameter set
func (o *Optimizer) copyParams(params ParamSet) ParamSet {
	copy := make(ParamSet)
	for k, v := range params {
		copy[k] = v
	}
	return copy
}

// randomSearch performs random search optimization
func (o *Optimizer) randomSearch(ctx context.Context, params []Parameter, objective ObjectiveFunc) (*OptimizationResult, error) {
	result := &OptimizationResult{
		AllResults:      make([]EvaluationResult, 0),
		ConvergenceHist: make([]float64, 0),
	}

	bestScore := math.Inf(-1)
	if o.config.MinimizationMode {
		bestScore = math.Inf(1)
	}

	for i := 0; i < o.config.MaxIterations; i++ {
		select {
		case <-ctx.Done():
			return result, ctx.Err()
		default:
		}

		// Generate random parameters
		paramSet := make(ParamSet)
		for _, param := range params {
			paramSet[param.Name] = o.randomParamValue(param)
		}

		// Evaluate
		start := time.Now()
		score, err := objective(paramSet)
		if err != nil {
			continue
		}

		result.AllResults = append(result.AllResults, EvaluationResult{
			Params:    paramSet,
			Score:     score,
			Iteration: i,
			Duration:  time.Since(start),
		})

		// Update best
		isBetter := score > bestScore
		if o.config.MinimizationMode {
			isBetter = score < bestScore
		}

		if isBetter {
			bestScore = score
			result.BestParams = paramSet
			result.BestScore = score
		}

		result.ConvergenceHist = append(result.ConvergenceHist, bestScore)
		result.Iterations++
	}

	return result, nil
}

// WalkForwardOptimizer performs walk-forward optimization
type WalkForwardOptimizer struct {
	logger    *zap.Logger
	config    *OptimizerConfig
	optimizer *Optimizer
}

// NewWalkForwardOptimizer creates a walk-forward optimizer
func NewWalkForwardOptimizer(logger *zap.Logger, config *OptimizerConfig) *WalkForwardOptimizer {
	return &WalkForwardOptimizer{
		logger:    logger,
		config:    config,
		optimizer: NewOptimizer(logger, config),
	}
}

// DataRange represents a time range for data
type DataRange struct {
	Start time.Time
	End   time.Time
}

// WalkForwardObjective is the objective function with data range
type WalkForwardObjective func(params ParamSet, dataRange DataRange) (float64, error)

// OptimizeWalkForward performs walk-forward optimization
func (wfo *WalkForwardOptimizer) OptimizeWalkForward(
	ctx context.Context,
	params []Parameter,
	objective WalkForwardObjective,
	fullRange DataRange,
) (*OptimizationResult, error) {

	result := &OptimizationResult{
		AllResults:         make([]EvaluationResult, 0),
		WalkForwardResults: make([]*WalkForwardFold, 0, wfo.config.NumFolds),
		Method:             MethodWalkForward,
	}

	startTime := time.Now()

	// Calculate fold boundaries
	totalDuration := fullRange.End.Sub(fullRange.Start)
	foldDuration := totalDuration / time.Duration(wfo.config.NumFolds)
	inSampleDuration := time.Duration(float64(foldDuration) * wfo.config.InSamplePct)
	outSampleDuration := foldDuration - inSampleDuration

	var totalISScore, totalOOSScore float64

	for fold := 0; fold < wfo.config.NumFolds; fold++ {
		select {
		case <-ctx.Done():
			return result, ctx.Err()
		default:
		}

		var isStart, isEnd, oosStart, oosEnd time.Time

		if wfo.config.AnchoredWF {
			// Expanding window: IS always starts from beginning
			isStart = fullRange.Start
			isEnd = fullRange.Start.Add(time.Duration(fold+1) * foldDuration * time.Duration(wfo.config.InSamplePct))
			oosStart = isEnd
			oosEnd = oosStart.Add(outSampleDuration)
		} else {
			// Rolling window
			foldStart := fullRange.Start.Add(time.Duration(fold) * foldDuration)
			isStart = foldStart
			isEnd = foldStart.Add(inSampleDuration)
			oosStart = isEnd
			oosEnd = foldStart.Add(foldDuration)
		}

		// Make sure we don't exceed the full range
		if oosEnd.After(fullRange.End) {
			oosEnd = fullRange.End
		}

		wfo.logger.Info("walk-forward fold",
			zap.Int("fold", fold+1),
			zap.Time("is_start", isStart),
			zap.Time("is_end", isEnd),
			zap.Time("oos_start", oosStart),
			zap.Time("oos_end", oosEnd),
		)

		// Create objective wrapper for in-sample
		isObjective := func(p ParamSet) (float64, error) {
			return objective(p, DataRange{Start: isStart, End: isEnd})
		}

		// Optimize on in-sample
		optResult, err := wfo.optimizer.Optimize(ctx, params, isObjective)
		if err != nil {
			return nil, err
		}

		// Evaluate on out-of-sample
		oosScore, err := objective(optResult.BestParams, DataRange{Start: oosStart, End: oosEnd})
		if err != nil {
			return nil, err
		}

		// Calculate degradation
		degradation := 0.0
		if optResult.BestScore != 0 {
			degradation = (optResult.BestScore - oosScore) / math.Abs(optResult.BestScore)
		}

		foldResult := &WalkForwardFold{
			FoldNumber:      fold + 1,
			InSampleStart:   isStart,
			InSampleEnd:     isEnd,
			OutSampleStart:  oosStart,
			OutSampleEnd:    oosEnd,
			OptimizedParams: optResult.BestParams,
			InSampleScore:   optResult.BestScore,
			OutSampleScore:  oosScore,
			Degradation:     degradation,
		}

		result.WalkForwardResults = append(result.WalkForwardResults, foldResult)
		result.AllResults = append(result.AllResults, optResult.AllResults...)

		totalISScore += optResult.BestScore
		totalOOSScore += oosScore
	}

	// Calculate averages
	avgISScore := totalISScore / float64(wfo.config.NumFolds)
	avgOOSScore := totalOOSScore / float64(wfo.config.NumFolds)

	result.OOSPerformance = avgOOSScore
	if avgISScore != 0 {
		result.ISvsOOSDegradation = (avgISScore - avgOOSScore) / math.Abs(avgISScore)
	}

	// Best params from last fold (or could average)
	if len(result.WalkForwardResults) > 0 {
		lastFold := result.WalkForwardResults[len(result.WalkForwardResults)-1]
		result.BestParams = lastFold.OptimizedParams
		result.BestScore = lastFold.OutSampleScore
	}

	result.Duration = time.Since(startTime)
	result.Iterations = len(result.AllResults)

	wfo.logger.Info("walk-forward optimization complete",
		zap.Float64("avg_is_score", avgISScore),
		zap.Float64("avg_oos_score", avgOOSScore),
		zap.Float64("degradation", result.ISvsOOSDegradation),
	)

	return result, nil
}
