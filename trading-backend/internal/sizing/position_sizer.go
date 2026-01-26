// Package sizing provides intelligent position sizing.
// Based on research: "Kelly Criterion, fractional Kelly, and regime-adjusted sizing"
// Uses: Win rate, risk/reward, correlation, regime, portfolio constraints
package sizing

import (
	"math"
	"sync"

	"github.com/shopspring/decimal"
	"go.uber.org/zap"
)

// PositionSizer calculates optimal position sizes
type PositionSizer struct {
	logger *zap.Logger
	config *SizingConfig

	mu              sync.RWMutex
	tradeHistory    []*TradeResult
	correlationData map[string][]float64
}

// SizingConfig configures position sizing
type SizingConfig struct {
	MaxPositionPct        float64 // Maximum position as % of portfolio (default 10%)
	MaxPortfolioRisk      float64 // Maximum portfolio risk (default 2%)
	KellyFraction         float64 // Fraction of Kelly to use (default 0.25)
	MinPositionPct        float64 // Minimum position size (default 0.5%)
	UseRegimeAdjustment   bool    // Adjust sizing based on regime
	UseCorrelationScaling bool    // Scale down if correlated positions
	MaxCorrelatedRisk     float64 // Max risk for correlated positions
	LookbackTrades        int     // Number of trades for statistics
}

// DefaultSizingConfig returns conservative defaults
func DefaultSizingConfig() *SizingConfig {
	return &SizingConfig{
		MaxPositionPct:        0.10,  // 10% max per position
		MaxPortfolioRisk:      0.02,  // 2% portfolio risk
		KellyFraction:         0.25,  // Quarter Kelly
		MinPositionPct:        0.005, // 0.5% min
		UseRegimeAdjustment:   true,
		UseCorrelationScaling: true,
		MaxCorrelatedRisk:     0.05, // 5% max correlated risk
		LookbackTrades:        100,
	}
}

// AggressiveSizingConfig for more aggressive sizing
func AggressiveSizingConfig() *SizingConfig {
	return &SizingConfig{
		MaxPositionPct:        0.20, // 20% max
		MaxPortfolioRisk:      0.05, // 5% portfolio risk
		KellyFraction:         0.50, // Half Kelly
		MinPositionPct:        0.01, // 1% min
		UseRegimeAdjustment:   true,
		UseCorrelationScaling: true,
		MaxCorrelatedRisk:     0.10,
		LookbackTrades:        50,
	}
}

// TradeResult represents a historical trade outcome
type TradeResult struct {
	Symbol       string
	Entry        decimal.Decimal
	Exit         decimal.Decimal
	ReturnPct    float64
	IsWin        bool
	RiskTaken    decimal.Decimal
	RewardGained decimal.Decimal
}

// NewPositionSizer creates a new position sizer
func NewPositionSizer(logger *zap.Logger, config *SizingConfig) *PositionSizer {
	if config == nil {
		config = DefaultSizingConfig()
	}

	return &PositionSizer{
		logger:          logger,
		config:          config,
		tradeHistory:    make([]*TradeResult, 0, config.LookbackTrades*2),
		correlationData: make(map[string][]float64),
	}
}

// SizingRequest contains inputs for position sizing
type SizingRequest struct {
	Symbol           string
	PortfolioValue   decimal.Decimal
	CurrentPrice     decimal.Decimal
	StopLoss         decimal.Decimal // Stop loss price
	TakeProfit       decimal.Decimal // Take profit price
	WinRate          float64         // Historical win rate (0-1)
	AvgWin           float64         // Average win %
	AvgLoss          float64         // Average loss %
	RegimeMultiplier float64         // From regime detector
	ExistingExposure decimal.Decimal // Current exposure in same symbol/sector
	Correlation      float64         // Correlation with existing positions
	Confidence       float64         // Signal confidence (0-1)
}

// SizingResult contains the calculated position size
type SizingResult struct {
	PositionSize    decimal.Decimal `json:"position_size"`     // Dollar amount
	PositionUnits   decimal.Decimal `json:"position_units"`    // Number of units
	PositionPct     float64         `json:"position_pct"`      // As % of portfolio
	RiskAmount      decimal.Decimal `json:"risk_amount"`       // Dollar risk
	RiskPct         float64         `json:"risk_pct"`          // Risk as % of portfolio
	KellyOptimal    float64         `json:"kelly_optimal"`     // Full Kelly %
	KellyUsed       float64         `json:"kelly_used"`        // Actual Kelly used %
	RiskRewardRatio float64         `json:"risk_reward_ratio"` // R:R ratio
	MaxLoss         decimal.Decimal `json:"max_loss"`          // Max loss if stopped out
	MaxGain         decimal.Decimal `json:"max_gain"`          // Max gain if TP hit
	Adjustments     []string        `json:"adjustments"`       // Applied adjustments
	LimitingFactor  string          `json:"limiting_factor"`   // What limited size
}

// CalculateSize determines optimal position size
func (ps *PositionSizer) CalculateSize(req *SizingRequest) *SizingResult {
	ps.mu.RLock()
	defer ps.mu.RUnlock()

	result := &SizingResult{
		Adjustments: make([]string, 0),
	}

	portfolioFloat, _ := req.PortfolioValue.Float64()
	priceFloat, _ := req.CurrentPrice.Float64()
	stopFloat, _ := req.StopLoss.Float64()
	tpFloat, _ := req.TakeProfit.Float64()

	// Calculate risk/reward
	riskPct := math.Abs(priceFloat-stopFloat) / priceFloat
	rewardPct := math.Abs(tpFloat-priceFloat) / priceFloat

	if riskPct > 0 {
		result.RiskRewardRatio = rewardPct / riskPct
	}

	// 1. Calculate Kelly Criterion
	kellyOptimal := ps.calculateKelly(req.WinRate, req.AvgWin, req.AvgLoss)
	result.KellyOptimal = kellyOptimal

	// 2. Apply Kelly fraction
	kellyUsed := kellyOptimal * ps.config.KellyFraction
	result.KellyUsed = kellyUsed
	result.Adjustments = append(result.Adjustments,
		"fractional_kelly: "+formatPct(ps.config.KellyFraction))

	// 3. Risk-based sizing (most common approach)
	riskBasedPct := ps.config.MaxPortfolioRisk / riskPct

	// Use the more conservative of Kelly and risk-based
	positionPct := math.Min(kellyUsed, riskBasedPct)
	result.LimitingFactor = "kelly"
	if riskBasedPct < kellyUsed {
		result.LimitingFactor = "risk_based"
	}

	// 4. Apply regime adjustment
	if ps.config.UseRegimeAdjustment && req.RegimeMultiplier != 0 {
		positionPct *= req.RegimeMultiplier
		result.Adjustments = append(result.Adjustments,
			"regime: "+formatPct(req.RegimeMultiplier))
	}

	// 5. Apply confidence adjustment
	if req.Confidence > 0 && req.Confidence < 1 {
		positionPct *= req.Confidence
		result.Adjustments = append(result.Adjustments,
			"confidence: "+formatPct(req.Confidence))
	}

	// 6. Apply correlation scaling
	if ps.config.UseCorrelationScaling && req.Correlation > 0.3 {
		correlationPenalty := 1 - (req.Correlation * 0.5) // Up to 50% reduction
		positionPct *= correlationPenalty
		result.Adjustments = append(result.Adjustments,
			"correlation: "+formatPct(correlationPenalty))
	}

	// 7. Apply max position constraint
	if positionPct > ps.config.MaxPositionPct {
		positionPct = ps.config.MaxPositionPct
		result.LimitingFactor = "max_position"
		result.Adjustments = append(result.Adjustments, "capped_max_position")
	}

	// 8. Apply min position constraint
	if positionPct < ps.config.MinPositionPct {
		positionPct = ps.config.MinPositionPct
		result.Adjustments = append(result.Adjustments, "min_position")
	}

	// Calculate final values
	result.PositionPct = positionPct
	positionDollars := portfolioFloat * positionPct
	result.PositionSize = decimal.NewFromFloat(positionDollars)

	if priceFloat > 0 {
		result.PositionUnits = result.PositionSize.Div(req.CurrentPrice)
	}

	// Calculate risk
	result.RiskPct = positionPct * riskPct
	result.RiskAmount = decimal.NewFromFloat(portfolioFloat * result.RiskPct)

	// Calculate potential outcomes
	result.MaxLoss = result.PositionSize.Mul(decimal.NewFromFloat(riskPct))
	result.MaxGain = result.PositionSize.Mul(decimal.NewFromFloat(rewardPct))

	return result
}

// calculateKelly implements Kelly Criterion
// f* = (p*b - q) / b = p - q/b
// where p = win probability, q = 1-p, b = win/loss ratio
func (ps *PositionSizer) calculateKelly(winRate, avgWin, avgLoss float64) float64 {
	if winRate <= 0 || winRate >= 1 || avgLoss == 0 {
		return 0
	}

	p := winRate
	q := 1 - p
	b := avgWin / avgLoss // Win/loss ratio

	if b <= 0 {
		return 0
	}

	kelly := p - q/b

	// Kelly can be negative (don't trade) or very large (risky)
	if kelly < 0 {
		return 0
	}
	if kelly > 1 {
		kelly = 1
	}

	return kelly
}

// AddTradeResult adds a trade result for statistics
func (ps *PositionSizer) AddTradeResult(result *TradeResult) {
	ps.mu.Lock()
	defer ps.mu.Unlock()

	ps.tradeHistory = append(ps.tradeHistory, result)

	// Trim to lookback
	if len(ps.tradeHistory) > ps.config.LookbackTrades*2 {
		ps.tradeHistory = ps.tradeHistory[len(ps.tradeHistory)-ps.config.LookbackTrades:]
	}
}

// GetTradeStatistics returns statistics from trade history
func (ps *PositionSizer) GetTradeStatistics() *TradeStatistics {
	ps.mu.RLock()
	defer ps.mu.RUnlock()

	stats := &TradeStatistics{}

	if len(ps.tradeHistory) == 0 {
		return stats
	}

	stats.TotalTrades = len(ps.tradeHistory)

	var totalWins, totalLosses int
	var sumWins, sumLosses float64
	var sumReturns float64

	for _, trade := range ps.tradeHistory {
		sumReturns += trade.ReturnPct

		if trade.IsWin {
			totalWins++
			sumWins += trade.ReturnPct
		} else {
			totalLosses++
			sumLosses += math.Abs(trade.ReturnPct)
		}
	}

	stats.Wins = totalWins
	stats.Losses = totalLosses
	stats.WinRate = float64(totalWins) / float64(stats.TotalTrades)

	if totalWins > 0 {
		stats.AvgWin = sumWins / float64(totalWins)
	}
	if totalLosses > 0 {
		stats.AvgLoss = sumLosses / float64(totalLosses)
	}

	if stats.AvgLoss > 0 {
		stats.PayoffRatio = stats.AvgWin / stats.AvgLoss
	}

	stats.Expectancy = stats.WinRate*stats.AvgWin - (1-stats.WinRate)*stats.AvgLoss
	stats.KellyOptimal = ps.calculateKelly(stats.WinRate, stats.AvgWin, stats.AvgLoss)
	stats.KellyRecommended = stats.KellyOptimal * ps.config.KellyFraction

	return stats
}

// TradeStatistics contains trading statistics
type TradeStatistics struct {
	TotalTrades      int     `json:"total_trades"`
	Wins             int     `json:"wins"`
	Losses           int     `json:"losses"`
	WinRate          float64 `json:"win_rate"`
	AvgWin           float64 `json:"avg_win"`
	AvgLoss          float64 `json:"avg_loss"`
	PayoffRatio      float64 `json:"payoff_ratio"`
	Expectancy       float64 `json:"expectancy"`
	KellyOptimal     float64 `json:"kelly_optimal"`
	KellyRecommended float64 `json:"kelly_recommended"`
}

// RiskBudgetSizer manages portfolio-level risk budgeting
type RiskBudgetSizer struct {
	logger          *zap.Logger
	portfolioValue  decimal.Decimal
	totalRiskBudget float64 // Total risk as % of portfolio
	allocatedRisk   float64 // Currently allocated risk
	positions       map[string]*PositionRisk
	mu              sync.RWMutex
}

// PositionRisk tracks risk for a position
type PositionRisk struct {
	Symbol       string
	RiskPct      float64
	PositionPct  float64
	Correlation  float64
	StopDistance float64
}

// NewRiskBudgetSizer creates a risk budget manager
func NewRiskBudgetSizer(logger *zap.Logger, portfolioValue decimal.Decimal, totalRiskBudget float64) *RiskBudgetSizer {
	return &RiskBudgetSizer{
		logger:          logger,
		portfolioValue:  portfolioValue,
		totalRiskBudget: totalRiskBudget,
		positions:       make(map[string]*PositionRisk),
	}
}

// AvailableRisk returns remaining risk budget
func (rbs *RiskBudgetSizer) AvailableRisk() float64 {
	rbs.mu.RLock()
	defer rbs.mu.RUnlock()

	return rbs.totalRiskBudget - rbs.allocatedRisk
}

// AllocateRisk allocates risk for a new position
func (rbs *RiskBudgetSizer) AllocateRisk(symbol string, riskPct, positionPct, correlation, stopDistance float64) bool {
	rbs.mu.Lock()
	defer rbs.mu.Unlock()

	// Check if we have budget
	if rbs.allocatedRisk+riskPct > rbs.totalRiskBudget {
		return false
	}

	// Adjust for correlation with existing positions
	correlatedRisk := riskPct
	for _, pos := range rbs.positions {
		if correlation > 0 {
			// Correlated risk increases total risk
			correlatedRisk += pos.RiskPct * correlation * 0.5
		}
	}

	if rbs.allocatedRisk+correlatedRisk > rbs.totalRiskBudget {
		return false
	}

	rbs.positions[symbol] = &PositionRisk{
		Symbol:       symbol,
		RiskPct:      riskPct,
		PositionPct:  positionPct,
		Correlation:  correlation,
		StopDistance: stopDistance,
	}

	rbs.allocatedRisk += riskPct

	return true
}

// ReleaseRisk releases risk when closing a position
func (rbs *RiskBudgetSizer) ReleaseRisk(symbol string) {
	rbs.mu.Lock()
	defer rbs.mu.Unlock()

	if pos, ok := rbs.positions[symbol]; ok {
		rbs.allocatedRisk -= pos.RiskPct
		delete(rbs.positions, symbol)
	}
}

// GetRiskSummary returns current risk allocation
func (rbs *RiskBudgetSizer) GetRiskSummary() *RiskSummary {
	rbs.mu.RLock()
	defer rbs.mu.RUnlock()

	summary := &RiskSummary{
		TotalBudget:   rbs.totalRiskBudget,
		AllocatedRisk: rbs.allocatedRisk,
		AvailableRisk: rbs.totalRiskBudget - rbs.allocatedRisk,
		PositionCount: len(rbs.positions),
		PositionRisks: make(map[string]float64),
	}

	for symbol, pos := range rbs.positions {
		summary.PositionRisks[symbol] = pos.RiskPct
	}

	return summary
}

// RiskSummary contains risk allocation summary
type RiskSummary struct {
	TotalBudget   float64            `json:"total_budget"`
	AllocatedRisk float64            `json:"allocated_risk"`
	AvailableRisk float64            `json:"available_risk"`
	PositionCount int                `json:"position_count"`
	PositionRisks map[string]float64 `json:"position_risks"`
}

// VaRSizer calculates position sizes based on VaR constraints
type VaRSizer struct {
	logger          *zap.Logger
	portfolioValue  decimal.Decimal
	maxVaR          float64 // Maximum daily VaR
	confidenceLevel float64 // VaR confidence (e.g., 0.99)
}

// NewVaRSizer creates a VaR-based sizer
func NewVaRSizer(logger *zap.Logger, portfolioValue decimal.Decimal, maxVaR, confidence float64) *VaRSizer {
	return &VaRSizer{
		logger:          logger,
		portfolioValue:  portfolioValue,
		maxVaR:          maxVaR,
		confidenceLevel: confidence,
	}
}

// CalculateVaRSize calculates position size to stay within VaR limit
func (vs *VaRSizer) CalculateVaRSize(volatility float64, existingVaR float64) float64 {
	// Remaining VaR budget
	availableVaR := vs.maxVaR - existingVaR
	if availableVaR <= 0 {
		return 0
	}

	// Z-score for confidence level
	zScore := vs.getZScore(vs.confidenceLevel)

	// VaR = Position * Volatility * ZScore
	// Position = VaR / (Volatility * ZScore)
	if volatility > 0 && zScore > 0 {
		maxPosition := availableVaR / (volatility * zScore)
		return maxPosition
	}

	return 0
}

// getZScore returns z-score for confidence level
func (vs *VaRSizer) getZScore(confidence float64) float64 {
	// Common z-scores
	switch {
	case confidence >= 0.99:
		return 2.326
	case confidence >= 0.95:
		return 1.645
	case confidence >= 0.90:
		return 1.282
	default:
		return 1.0
	}
}

// Helper function
func formatPct(pct float64) string {
	return decimal.NewFromFloat(pct*100).Round(1).String() + "%"
}

// VolatilityScaledSizer adjusts position size based on volatility targeting
type VolatilityScaledSizer struct {
	logger           *zap.Logger
	targetVolatility float64 // Target portfolio volatility
	lookbackDays     int     // Days for volatility calculation
}

// NewVolatilityScaledSizer creates a volatility-targeting sizer
func NewVolatilityScaledSizer(logger *zap.Logger, targetVol float64, lookback int) *VolatilityScaledSizer {
	return &VolatilityScaledSizer{
		logger:           logger,
		targetVolatility: targetVol,
		lookbackDays:     lookback,
	}
}

// CalculateVolTargetSize calculates size for volatility targeting
func (vss *VolatilityScaledSizer) CalculateVolTargetSize(currentVol float64) float64 {
	if currentVol <= 0 {
		return 1.0 // Full position
	}

	// Leverage = Target Vol / Current Vol
	leverage := vss.targetVolatility / currentVol

	// Cap leverage
	if leverage > 2.0 {
		leverage = 2.0
	}
	if leverage < 0.1 {
		leverage = 0.1
	}

	return leverage
}

// InverseVolatilityWeighter for portfolio allocation
type InverseVolatilityWeighter struct {
	logger *zap.Logger
}

// NewInverseVolatilityWeighter creates inverse vol weighter
func NewInverseVolatilityWeighter(logger *zap.Logger) *InverseVolatilityWeighter {
	return &InverseVolatilityWeighter{logger: logger}
}

// CalculateWeights returns inverse volatility weights
func (ivw *InverseVolatilityWeighter) CalculateWeights(volatilities map[string]float64) map[string]float64 {
	weights := make(map[string]float64)

	// Calculate inverse vol sum
	totalInverseVol := 0.0
	for _, vol := range volatilities {
		if vol > 0 {
			totalInverseVol += 1.0 / vol
		}
	}

	if totalInverseVol == 0 {
		// Equal weight fallback
		n := len(volatilities)
		for symbol := range volatilities {
			weights[symbol] = 1.0 / float64(n)
		}
		return weights
	}

	// Calculate weights
	for symbol, vol := range volatilities {
		if vol > 0 {
			weights[symbol] = (1.0 / vol) / totalInverseVol
		}
	}

	return weights
}
