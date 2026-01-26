// Package learning provides ML-based strategy optimization.
package learning

import (
	"context"
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/atlas-desktop/trading-backend/pkg/types"
	"github.com/shopspring/decimal"
	"go.uber.org/zap"
)

// FeedbackEngine collects and processes user feedback on trades.
type FeedbackEngine struct {
	logger    *zap.Logger
	mu        sync.RWMutex
	
	feedback  []TradeFeedback
	patterns  map[string]*PatternPerformance
	dataDir   string
}

// TradeFeedback represents user feedback on a trade.
type TradeFeedback struct {
	TradeID       string          `json:"tradeId"`
	Symbol        string          `json:"symbol"`
	Rating        int             `json:"rating"`     // 1-5
	WasGoodEntry  bool            `json:"wasGoodEntry"`
	WasGoodExit   bool            `json:"wasGoodExit"`
	ShouldHaveHeld bool           `json:"shouldHaveHeld"`
	ActualPnL     decimal.Decimal `json:"actualPnl"`
	ExpectedPnL   decimal.Decimal `json:"expectedPnl,omitempty"`
	Notes         string          `json:"notes,omitempty"`
	Tags          []string        `json:"tags,omitempty"`
	Timestamp     time.Time       `json:"timestamp"`
	
	// Context at time of trade
	Signal       *SignalContext  `json:"signal,omitempty"`
	MarketState  *MarketContext  `json:"marketState,omitempty"`
}

// SignalContext captures signal state at trade time.
type SignalContext struct {
	SignalType  string          `json:"signalType"`
	Confidence  decimal.Decimal `json:"confidence"`
	Sources     []string        `json:"sources"`
	Indicators  map[string]any  `json:"indicators,omitempty"`
}

// MarketContext captures market state at trade time.
type MarketContext struct {
	Volatility   decimal.Decimal `json:"volatility"`
	Trend        string          `json:"trend"` // "bullish", "bearish", "ranging"
	Volume       decimal.Decimal `json:"volume"`
	NewsImpact   string          `json:"newsImpact,omitempty"`
}

// PatternPerformance tracks performance of specific patterns.
type PatternPerformance struct {
	Pattern     string          `json:"pattern"`
	TotalTrades int             `json:"totalTrades"`
	WinRate     decimal.Decimal `json:"winRate"`
	AvgPnL      decimal.Decimal `json:"avgPnl"`
	AvgRating   float64         `json:"avgRating"`
	LastUpdated time.Time       `json:"lastUpdated"`
}

// NewFeedbackEngine creates a new feedback engine.
func NewFeedbackEngine(logger *zap.Logger, dataDir string) *FeedbackEngine {
	fe := &FeedbackEngine{
		logger:   logger.Named("feedback-engine"),
		patterns: make(map[string]*PatternPerformance),
		dataDir:  dataDir,
	}
	
	// Load existing feedback
	fe.load()
	
	return fe
}

// RecordFeedback records user feedback for a trade.
func (fe *FeedbackEngine) RecordFeedback(feedback TradeFeedback) {
	fe.mu.Lock()
	defer fe.mu.Unlock()
	
	feedback.Timestamp = time.Now()
	fe.feedback = append(fe.feedback, feedback)
	
	// Update pattern performance
	if feedback.Signal != nil {
		pattern := feedback.Signal.SignalType
		perf, ok := fe.patterns[pattern]
		if !ok {
			perf = &PatternPerformance{Pattern: pattern}
			fe.patterns[pattern] = perf
		}
		
		perf.TotalTrades++
		if feedback.ActualPnL.GreaterThan(decimal.Zero) {
			// Update win rate with exponential moving average
			alpha := 0.1
			perf.WinRate = perf.WinRate.Mul(decimal.NewFromFloat(1 - alpha)).Add(decimal.NewFromFloat(alpha))
		} else {
			perf.WinRate = perf.WinRate.Mul(decimal.NewFromFloat(1 - alpha))
		}
		
		// Update average PnL
		oldWeight := decimal.NewFromInt(int64(perf.TotalTrades - 1))
		newWeight := decimal.NewFromInt(int64(perf.TotalTrades))
		perf.AvgPnL = perf.AvgPnL.Mul(oldWeight).Add(feedback.ActualPnL).Div(newWeight)
		
		// Update average rating
		perf.AvgRating = (perf.AvgRating*float64(perf.TotalTrades-1) + float64(feedback.Rating)) / float64(perf.TotalTrades)
		perf.LastUpdated = time.Now()
	}
	
	// Save periodically
	if len(fe.feedback)%10 == 0 {
		fe.save()
	}
	
	fe.logger.Info("Feedback recorded",
		zap.String("tradeId", feedback.TradeID),
		zap.Int("rating", feedback.Rating))
}

// GetPatternPerformance returns performance for a specific pattern.
func (fe *FeedbackEngine) GetPatternPerformance(pattern string) *PatternPerformance {
	fe.mu.RLock()
	defer fe.mu.RUnlock()
	
	return fe.patterns[pattern]
}

// GetAllPatternPerformance returns all pattern performances.
func (fe *FeedbackEngine) GetAllPatternPerformance() map[string]*PatternPerformance {
	fe.mu.RLock()
	defer fe.mu.RUnlock()
	
	result := make(map[string]*PatternPerformance)
	for k, v := range fe.patterns {
		result[k] = v
	}
	return result
}

// GetRecentFeedback returns recent feedback.
func (fe *FeedbackEngine) GetRecentFeedback(limit int) []TradeFeedback {
	fe.mu.RLock()
	defer fe.mu.RUnlock()
	
	if limit <= 0 || limit > len(fe.feedback) {
		limit = len(fe.feedback)
	}
	
	start := len(fe.feedback) - limit
	if start < 0 {
		start = 0
	}
	
	result := make([]TradeFeedback, limit)
	copy(result, fe.feedback[start:])
	return result
}

// save persists feedback to disk.
func (fe *FeedbackEngine) save() {
	path := filepath.Join(fe.dataDir, "feedback.json")
	
	data := struct {
		Feedback []TradeFeedback                `json:"feedback"`
		Patterns map[string]*PatternPerformance `json:"patterns"`
	}{
		Feedback: fe.feedback,
		Patterns: fe.patterns,
	}
	
	bytes, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		fe.logger.Error("Failed to marshal feedback", zap.Error(err))
		return
	}
	
	if err := os.MkdirAll(fe.dataDir, 0755); err != nil {
		fe.logger.Error("Failed to create data dir", zap.Error(err))
		return
	}
	
	if err := os.WriteFile(path, bytes, 0644); err != nil {
		fe.logger.Error("Failed to save feedback", zap.Error(err))
	}
}

// load loads feedback from disk.
func (fe *FeedbackEngine) load() {
	path := filepath.Join(fe.dataDir, "feedback.json")
	
	bytes, err := os.ReadFile(path)
	if err != nil {
		return
	}
	
	var data struct {
		Feedback []TradeFeedback                `json:"feedback"`
		Patterns map[string]*PatternPerformance `json:"patterns"`
	}
	
	if err := json.Unmarshal(bytes, &data); err != nil {
		fe.logger.Error("Failed to unmarshal feedback", zap.Error(err))
		return
	}
	
	fe.feedback = data.Feedback
	fe.patterns = data.Patterns
}

// StrategyOptimizer optimizes strategy parameters from feedback.
type StrategyOptimizer struct {
	logger         *zap.Logger
	feedbackEngine *FeedbackEngine
	mu             sync.RWMutex
	
	optimizations  map[string]*OptimizationResult
}

// OptimizationResult contains optimization results.
type OptimizationResult struct {
	Strategy       string                    `json:"strategy"`
	Parameters     map[string]decimal.Decimal `json:"parameters"`
	Score          decimal.Decimal           `json:"score"`
	Confidence     decimal.Decimal           `json:"confidence"`
	SampleSize     int                       `json:"sampleSize"`
	OptimizedAt    time.Time                 `json:"optimizedAt"`
	Improvements   []Improvement             `json:"improvements"`
}

// Improvement describes a suggested improvement.
type Improvement struct {
	Parameter   string          `json:"parameter"`
	Current     decimal.Decimal `json:"current"`
	Suggested   decimal.Decimal `json:"suggested"`
	Reasoning   string          `json:"reasoning"`
	Confidence  decimal.Decimal `json:"confidence"`
}

// NewStrategyOptimizer creates a new strategy optimizer.
func NewStrategyOptimizer(logger *zap.Logger, feedbackEngine *FeedbackEngine) *StrategyOptimizer {
	return &StrategyOptimizer{
		logger:         logger.Named("strategy-optimizer"),
		feedbackEngine: feedbackEngine,
		optimizations:  make(map[string]*OptimizationResult),
	}
}

// Optimize runs optimization for a strategy.
func (so *StrategyOptimizer) Optimize(ctx context.Context, strategy string) (*OptimizationResult, error) {
	so.logger.Info("Starting strategy optimization", zap.String("strategy", strategy))
	
	// Get feedback for this strategy
	feedback := so.feedbackEngine.GetRecentFeedback(1000)
	
	// Filter for relevant feedback
	var relevant []TradeFeedback
	for _, f := range feedback {
		if f.Signal != nil && f.Signal.SignalType == strategy {
			relevant = append(relevant, f)
		}
	}
	
	if len(relevant) < 30 {
		return nil, nil // Not enough data
	}
	
	result := &OptimizationResult{
		Strategy:    strategy,
		Parameters:  make(map[string]decimal.Decimal),
		SampleSize:  len(relevant),
		OptimizedAt: time.Now(),
	}
	
	// Analyze entry quality
	entryScore := so.analyzeEntryQuality(relevant)
	result.Parameters["entryThreshold"] = entryScore.threshold
	if !entryScore.improvement.IsZero() {
		result.Improvements = append(result.Improvements, Improvement{
			Parameter:  "entryThreshold",
			Current:    entryScore.current,
			Suggested:  entryScore.threshold,
			Reasoning:  entryScore.reasoning,
			Confidence: entryScore.confidence,
		})
	}
	
	// Analyze exit quality
	exitScore := so.analyzeExitQuality(relevant)
	result.Parameters["stopLossMultiplier"] = exitScore.slMultiplier
	result.Parameters["takeProfitMultiplier"] = exitScore.tpMultiplier
	
	// Calculate overall score
	result.Score = so.calculateOverallScore(relevant)
	result.Confidence = decimal.NewFromFloat(math.Min(float64(len(relevant))/100.0, 1.0))
	
	// Store result
	so.mu.Lock()
	so.optimizations[strategy] = result
	so.mu.Unlock()
	
	return result, nil
}

type entryAnalysis struct {
	threshold   decimal.Decimal
	current     decimal.Decimal
	improvement decimal.Decimal
	reasoning   string
	confidence  decimal.Decimal
}

// analyzeEntryQuality analyzes entry quality from feedback.
func (so *StrategyOptimizer) analyzeEntryQuality(feedback []TradeFeedback) entryAnalysis {
	result := entryAnalysis{
		threshold:  decimal.NewFromFloat(0.6),
		current:    decimal.NewFromFloat(0.6),
		confidence: decimal.NewFromFloat(0.5),
	}
	
	// Group by confidence level
	goodEntries := make(map[string]int)
	badEntries := make(map[string]int)
	
	for _, f := range feedback {
		if f.Signal == nil {
			continue
		}
		
		bucket := f.Signal.Confidence.Round(1).String()
		if f.WasGoodEntry {
			goodEntries[bucket]++
		} else {
			badEntries[bucket]++
		}
	}
	
	// Find optimal threshold
	bestThreshold := decimal.NewFromFloat(0.5)
	bestWinRate := decimal.Zero
	
	for threshold := 0.5; threshold <= 0.9; threshold += 0.1 {
		wins := 0
		total := 0
		
		for _, f := range feedback {
			if f.Signal == nil {
				continue
			}
			if f.Signal.Confidence.GreaterThanOrEqual(decimal.NewFromFloat(threshold)) {
				total++
				if f.WasGoodEntry {
					wins++
				}
			}
		}
		
		if total > 0 {
			winRate := decimal.NewFromInt(int64(wins)).Div(decimal.NewFromInt(int64(total)))
			if winRate.GreaterThan(bestWinRate) {
				bestWinRate = winRate
				bestThreshold = decimal.NewFromFloat(threshold)
			}
		}
	}
	
	result.threshold = bestThreshold
	if bestThreshold.GreaterThan(result.current) {
		result.improvement = bestThreshold.Sub(result.current)
		result.reasoning = "Higher confidence threshold improves entry win rate"
		result.confidence = decimal.NewFromFloat(0.7)
	}
	
	return result
}

type exitAnalysis struct {
	slMultiplier decimal.Decimal
	tpMultiplier decimal.Decimal
}

// analyzeExitQuality analyzes exit quality from feedback.
func (so *StrategyOptimizer) analyzeExitQuality(feedback []TradeFeedback) exitAnalysis {
	result := exitAnalysis{
		slMultiplier: decimal.NewFromFloat(1.0),
		tpMultiplier: decimal.NewFromFloat(2.0),
	}
	
	// Count "should have held" vs "good exit"
	heldCount := 0
	exitCount := 0
	
	for _, f := range feedback {
		if f.ShouldHaveHeld {
			heldCount++
		}
		if f.WasGoodExit {
			exitCount++
		}
	}
	
	// If many trades should have been held, increase TP
	if len(feedback) > 0 && float64(heldCount)/float64(len(feedback)) > 0.3 {
		result.tpMultiplier = decimal.NewFromFloat(2.5)
	}
	
	return result
}

// calculateOverallScore calculates overall strategy score.
func (so *StrategyOptimizer) calculateOverallScore(feedback []TradeFeedback) decimal.Decimal {
	if len(feedback) == 0 {
		return decimal.Zero
	}
	
	totalRating := 0
	totalPnL := decimal.Zero
	
	for _, f := range feedback {
		totalRating += f.Rating
		totalPnL = totalPnL.Add(f.ActualPnL)
	}
	
	avgRating := float64(totalRating) / float64(len(feedback)) / 5.0 // Normalize to 0-1
	avgPnL := totalPnL.Div(decimal.NewFromInt(int64(len(feedback))))
	
	// Combine rating and PnL into score
	// Score = 50% rating + 50% normalized PnL
	ratingScore := decimal.NewFromFloat(avgRating)
	
	// Normalize PnL (-$1000 to +$1000 -> 0 to 1)
	pnlScore := avgPnL.Add(decimal.NewFromInt(1000)).Div(decimal.NewFromInt(2000))
	if pnlScore.LessThan(decimal.Zero) {
		pnlScore = decimal.Zero
	}
	if pnlScore.GreaterThan(decimal.NewFromInt(1)) {
		pnlScore = decimal.NewFromInt(1)
	}
	
	return ratingScore.Mul(decimal.NewFromFloat(0.5)).Add(pnlScore.Mul(decimal.NewFromFloat(0.5)))
}

// GetOptimization returns optimization result for a strategy.
func (so *StrategyOptimizer) GetOptimization(strategy string) *OptimizationResult {
	so.mu.RLock()
	defer so.mu.RUnlock()
	
	return so.optimizations[strategy]
}

// PerformanceAnalyzer analyzes trading performance.
type PerformanceAnalyzer struct {
	logger *zap.Logger
}

// PerformanceReport contains comprehensive performance analysis.
type PerformanceReport struct {
	Period           string                        `json:"period"`
	TotalTrades      int                           `json:"totalTrades"`
	WinRate          decimal.Decimal               `json:"winRate"`
	ProfitFactor     decimal.Decimal               `json:"profitFactor"`
	SharpeRatio      decimal.Decimal               `json:"sharpeRatio"`
	SortinoRatio     decimal.Decimal               `json:"sortinoRatio"`
	MaxDrawdown      decimal.Decimal               `json:"maxDrawdown"`
	TotalPnL         decimal.Decimal               `json:"totalPnl"`
	AveragePnL       decimal.Decimal               `json:"averagePnl"`
	AverageWin       decimal.Decimal               `json:"averageWin"`
	AverageLoss      decimal.Decimal               `json:"averageLoss"`
	BestTrade        *types.Trade                  `json:"bestTrade,omitempty"`
	WorstTrade       *types.Trade                  `json:"worstTrade,omitempty"`
	BySymbol         map[string]*SymbolPerformance `json:"bySymbol"`
	ByDayOfWeek      map[string]*DayPerformance    `json:"byDayOfWeek"`
	ByHour           map[int]*HourPerformance      `json:"byHour"`
	Streaks          *StreakAnalysis               `json:"streaks"`
	GeneratedAt      time.Time                     `json:"generatedAt"`
}

// SymbolPerformance contains performance for a specific symbol.
type SymbolPerformance struct {
	Symbol     string          `json:"symbol"`
	Trades     int             `json:"trades"`
	WinRate    decimal.Decimal `json:"winRate"`
	TotalPnL   decimal.Decimal `json:"totalPnl"`
	AveragePnL decimal.Decimal `json:"averagePnl"`
}

// DayPerformance contains performance for a day of week.
type DayPerformance struct {
	Day      string          `json:"day"`
	Trades   int             `json:"trades"`
	WinRate  decimal.Decimal `json:"winRate"`
	TotalPnL decimal.Decimal `json:"totalPnl"`
}

// HourPerformance contains performance for an hour.
type HourPerformance struct {
	Hour     int             `json:"hour"`
	Trades   int             `json:"trades"`
	WinRate  decimal.Decimal `json:"winRate"`
	TotalPnL decimal.Decimal `json:"totalPnl"`
}

// StreakAnalysis contains streak analysis.
type StreakAnalysis struct {
	CurrentStreak      int `json:"currentStreak"` // Positive = wins, negative = losses
	LongestWinStreak   int `json:"longestWinStreak"`
	LongestLossStreak  int `json:"longestLossStreak"`
	AverageWinStreak   float64 `json:"averageWinStreak"`
	AverageLossStreak  float64 `json:"averageLossStreak"`
}

// NewPerformanceAnalyzer creates a new performance analyzer.
func NewPerformanceAnalyzer(logger *zap.Logger) *PerformanceAnalyzer {
	return &PerformanceAnalyzer{
		logger: logger.Named("performance-analyzer"),
	}
}

// Analyze generates a comprehensive performance report.
func (pa *PerformanceAnalyzer) Analyze(trades []*types.Trade, period string) *PerformanceReport {
	report := &PerformanceReport{
		Period:      period,
		TotalTrades: len(trades),
		BySymbol:    make(map[string]*SymbolPerformance),
		ByDayOfWeek: make(map[string]*DayPerformance),
		ByHour:      make(map[int]*HourPerformance),
		GeneratedAt: time.Now(),
	}
	
	if len(trades) == 0 {
		return report
	}
	
	// Basic metrics
	wins := 0
	losses := 0
	grossProfit := decimal.Zero
	grossLoss := decimal.Zero
	totalPnL := decimal.Zero
	var pnls []decimal.Decimal
	
	for _, trade := range trades {
		totalPnL = totalPnL.Add(trade.PnL)
		pnls = append(pnls, trade.PnL)
		
		if trade.PnL.GreaterThan(decimal.Zero) {
			wins++
			grossProfit = grossProfit.Add(trade.PnL)
			if report.BestTrade == nil || trade.PnL.GreaterThan(report.BestTrade.PnL) {
				report.BestTrade = trade
			}
		} else {
			losses++
			grossLoss = grossLoss.Add(trade.PnL.Abs())
			if report.WorstTrade == nil || trade.PnL.LessThan(report.WorstTrade.PnL) {
				report.WorstTrade = trade
			}
		}
		
		// By symbol
		sp, ok := report.BySymbol[trade.Symbol]
		if !ok {
			sp = &SymbolPerformance{Symbol: trade.Symbol}
			report.BySymbol[trade.Symbol] = sp
		}
		sp.Trades++
		sp.TotalPnL = sp.TotalPnL.Add(trade.PnL)
		
		// By day of week
		day := trade.ExecutedAt.Weekday().String()
		dp, ok := report.ByDayOfWeek[day]
		if !ok {
			dp = &DayPerformance{Day: day}
			report.ByDayOfWeek[day] = dp
		}
		dp.Trades++
		dp.TotalPnL = dp.TotalPnL.Add(trade.PnL)
		
		// By hour
		hour := trade.ExecutedAt.Hour()
		hp, ok := report.ByHour[hour]
		if !ok {
			hp = &HourPerformance{Hour: hour}
			report.ByHour[hour] = hp
		}
		hp.Trades++
		hp.TotalPnL = hp.TotalPnL.Add(trade.PnL)
	}
	
	report.TotalPnL = totalPnL
	
	if len(trades) > 0 {
		report.WinRate = decimal.NewFromInt(int64(wins)).Div(decimal.NewFromInt(int64(len(trades))))
		report.AveragePnL = totalPnL.Div(decimal.NewFromInt(int64(len(trades))))
	}
	
	if wins > 0 {
		report.AverageWin = grossProfit.Div(decimal.NewFromInt(int64(wins)))
	}
	
	if losses > 0 {
		report.AverageLoss = grossLoss.Div(decimal.NewFromInt(int64(losses)))
	}
	
	if !grossLoss.IsZero() {
		report.ProfitFactor = grossProfit.Div(grossLoss)
	}
	
	// Sharpe/Sortino ratios
	if len(pnls) > 1 {
		report.SharpeRatio = pa.calculateSharpe(pnls)
		report.SortinoRatio = pa.calculateSortino(pnls)
	}
	
	// Max drawdown
	report.MaxDrawdown = pa.calculateMaxDrawdown(trades)
	
	// Streaks
	report.Streaks = pa.analyzeStreaks(trades)
	
	return report
}

// calculateSharpe calculates Sharpe ratio.
func (pa *PerformanceAnalyzer) calculateSharpe(pnls []decimal.Decimal) decimal.Decimal {
	if len(pnls) < 2 {
		return decimal.Zero
	}
	
	sum := decimal.Zero
	for _, pnl := range pnls {
		sum = sum.Add(pnl)
	}
	mean := sum.Div(decimal.NewFromInt(int64(len(pnls))))
	
	sumSq := decimal.Zero
	for _, pnl := range pnls {
		diff := pnl.Sub(mean)
		sumSq = sumSq.Add(diff.Mul(diff))
	}
	variance := sumSq.Div(decimal.NewFromInt(int64(len(pnls) - 1)))
	stdDev := decimal.NewFromFloat(math.Sqrt(variance.InexactFloat64()))
	
	if stdDev.IsZero() {
		return decimal.Zero
	}
	
	// Annualize (assuming daily returns)
	annFactor := decimal.NewFromFloat(math.Sqrt(252))
	return mean.Div(stdDev).Mul(annFactor)
}

// calculateSortino calculates Sortino ratio.
func (pa *PerformanceAnalyzer) calculateSortino(pnls []decimal.Decimal) decimal.Decimal {
	if len(pnls) < 2 {
		return decimal.Zero
	}
	
	sum := decimal.Zero
	for _, pnl := range pnls {
		sum = sum.Add(pnl)
	}
	mean := sum.Div(decimal.NewFromInt(int64(len(pnls))))
	
	// Only use negative returns for downside deviation
	sumSq := decimal.Zero
	negCount := 0
	for _, pnl := range pnls {
		if pnl.LessThan(decimal.Zero) {
			sumSq = sumSq.Add(pnl.Mul(pnl))
			negCount++
		}
	}
	
	if negCount == 0 {
		return decimal.NewFromInt(100) // No downside
	}
	
	downsideVar := sumSq.Div(decimal.NewFromInt(int64(negCount)))
	downsideDev := decimal.NewFromFloat(math.Sqrt(downsideVar.InexactFloat64()))
	
	if downsideDev.IsZero() {
		return decimal.Zero
	}
	
	annFactor := decimal.NewFromFloat(math.Sqrt(252))
	return mean.Div(downsideDev).Mul(annFactor)
}

// calculateMaxDrawdown calculates maximum drawdown.
func (pa *PerformanceAnalyzer) calculateMaxDrawdown(trades []*types.Trade) decimal.Decimal {
	if len(trades) == 0 {
		return decimal.Zero
	}
	
	equity := decimal.NewFromInt(10000) // Starting equity
	peak := equity
	maxDD := decimal.Zero
	
	for _, trade := range trades {
		equity = equity.Add(trade.PnL)
		if equity.GreaterThan(peak) {
			peak = equity
		}
		dd := peak.Sub(equity).Div(peak)
		if dd.GreaterThan(maxDD) {
			maxDD = dd
		}
	}
	
	return maxDD
}

// analyzeStreaks analyzes win/loss streaks.
func (pa *PerformanceAnalyzer) analyzeStreaks(trades []*types.Trade) *StreakAnalysis {
	analysis := &StreakAnalysis{}
	
	if len(trades) == 0 {
		return analysis
	}
	
	currentStreak := 0
	var winStreaks, lossStreaks []int
	
	for _, trade := range trades {
		if trade.PnL.GreaterThan(decimal.Zero) {
			if currentStreak < 0 {
				lossStreaks = append(lossStreaks, -currentStreak)
				currentStreak = 0
			}
			currentStreak++
		} else {
			if currentStreak > 0 {
				winStreaks = append(winStreaks, currentStreak)
				currentStreak = 0
			}
			currentStreak--
		}
	}
	
	// Final streak
	if currentStreak > 0 {
		winStreaks = append(winStreaks, currentStreak)
	} else if currentStreak < 0 {
		lossStreaks = append(lossStreaks, -currentStreak)
	}
	
	analysis.CurrentStreak = currentStreak
	
	// Find longest streaks
	for _, s := range winStreaks {
		if s > analysis.LongestWinStreak {
			analysis.LongestWinStreak = s
		}
	}
	for _, s := range lossStreaks {
		if s > analysis.LongestLossStreak {
			analysis.LongestLossStreak = s
		}
	}
	
	// Average streaks
	if len(winStreaks) > 0 {
		sum := 0
		for _, s := range winStreaks {
			sum += s
		}
		analysis.AverageWinStreak = float64(sum) / float64(len(winStreaks))
	}
	if len(lossStreaks) > 0 {
		sum := 0
		for _, s := range lossStreaks {
			sum += s
		}
		analysis.AverageLossStreak = float64(sum) / float64(len(lossStreaks))
	}
	
	return analysis
}
