// Package backtester provides strategy viability assessment.
// Based on research: "Sharpe >0.5, DD <20%, PF >1.5 predict live performance"
// This module determines if a strategy is worth trading based on robust metrics.
package backtester

import (
	"time"

	"github.com/atlas-desktop/trading-backend/pkg/types"
	"github.com/shopspring/decimal"
)

// ViabilityThresholds defines the minimum requirements for a viable strategy
type ViabilityThresholds struct {
	// Core metrics
	MinSharpeRatio  decimal.Decimal // Minimum risk-adjusted return (0.5 default)
	MaxDrawdown     decimal.Decimal // Maximum acceptable drawdown (0.20 = 20%)
	MinProfitFactor decimal.Decimal // Minimum gross profit / gross loss (1.5)
	MinWinRate      decimal.Decimal // Minimum win rate (0.40 = 40%)
	MinTrades       int             // Minimum trades for statistical significance (30)

	// Risk metrics
	MaxVaR95        decimal.Decimal // Maximum 95% Value at Risk
	MinSortinoRatio decimal.Decimal // Minimum downside risk-adjusted return
	MinCalmarRatio  decimal.Decimal // Minimum return/drawdown ratio

	// Consistency metrics
	MinExpectancy     decimal.Decimal // Minimum expected value per trade
	MinRecoveryFactor decimal.Decimal // Minimum net profit / max drawdown

	// Walk-forward requirements
	MinWFConsistency decimal.Decimal // Minimum % of profitable walk-forward windows
	MinWFSharpe      decimal.Decimal // Minimum average out-of-sample Sharpe
}

// DefaultViabilityThresholds returns conservative default thresholds
func DefaultViabilityThresholds() *ViabilityThresholds {
	return &ViabilityThresholds{
		MinSharpeRatio:    decimal.NewFromFloat(0.5),
		MaxDrawdown:       decimal.NewFromFloat(0.20),
		MinProfitFactor:   decimal.NewFromFloat(1.5),
		MinWinRate:        decimal.NewFromFloat(0.40),
		MinTrades:         30,
		MaxVaR95:          decimal.NewFromFloat(0.05), // Max 5% daily VaR
		MinSortinoRatio:   decimal.NewFromFloat(0.8),
		MinCalmarRatio:    decimal.NewFromFloat(0.5),
		MinExpectancy:     decimal.Zero, // Must be positive
		MinRecoveryFactor: decimal.NewFromFloat(1.0),
		MinWFConsistency:  decimal.NewFromFloat(0.60), // 60% of windows profitable
		MinWFSharpe:       decimal.NewFromFloat(0.3),
	}
}

// AggressiveViabilityThresholds for higher risk tolerance
func AggressiveViabilityThresholds() *ViabilityThresholds {
	return &ViabilityThresholds{
		MinSharpeRatio:    decimal.NewFromFloat(0.3),
		MaxDrawdown:       decimal.NewFromFloat(0.30),
		MinProfitFactor:   decimal.NewFromFloat(1.2),
		MinWinRate:        decimal.NewFromFloat(0.35),
		MinTrades:         20,
		MaxVaR95:          decimal.NewFromFloat(0.08),
		MinSortinoRatio:   decimal.NewFromFloat(0.5),
		MinCalmarRatio:    decimal.NewFromFloat(0.3),
		MinExpectancy:     decimal.Zero,
		MinRecoveryFactor: decimal.NewFromFloat(0.5),
		MinWFConsistency:  decimal.NewFromFloat(0.50),
		MinWFSharpe:       decimal.NewFromFloat(0.2),
	}
}

// ConservativeViabilityThresholds for low risk tolerance
func ConservativeViabilityThresholds() *ViabilityThresholds {
	return &ViabilityThresholds{
		MinSharpeRatio:    decimal.NewFromFloat(1.0),
		MaxDrawdown:       decimal.NewFromFloat(0.10),
		MinProfitFactor:   decimal.NewFromFloat(2.0),
		MinWinRate:        decimal.NewFromFloat(0.50),
		MinTrades:         50,
		MaxVaR95:          decimal.NewFromFloat(0.03),
		MinSortinoRatio:   decimal.NewFromFloat(1.5),
		MinCalmarRatio:    decimal.NewFromFloat(1.0),
		MinExpectancy:     decimal.NewFromFloat(0.001),
		MinRecoveryFactor: decimal.NewFromFloat(2.0),
		MinWFConsistency:  decimal.NewFromFloat(0.75),
		MinWFSharpe:       decimal.NewFromFloat(0.5),
	}
}

// ViabilityIssue represents a specific problem with the strategy
type ViabilityIssue struct {
	Metric      string          `json:"metric"`
	Actual      decimal.Decimal `json:"actual"`
	Required    decimal.Decimal `json:"required"`
	Severity    string          `json:"severity"` // "critical", "warning", "info"
	Description string          `json:"description"`
	Suggestion  string          `json:"suggestion"`
}

// ViabilityReport contains the full viability assessment
type ViabilityReport struct {
	IsViable  bool             `json:"is_viable"`
	Score     int              `json:"score"` // 0-100 overall viability score
	Grade     string           `json:"grade"` // A, B, C, D, F
	Issues    []ViabilityIssue `json:"issues"`
	Strengths []string         `json:"strengths"`
	Summary   string           `json:"summary"`

	// Detailed scores
	ReturnScore      int `json:"return_score"`      // Risk-adjusted returns
	RiskScore        int `json:"risk_score"`        // Drawdown and VaR
	ConsistencyScore int `json:"consistency_score"` // Win rate, profit factor
	RobustnessScore  int `json:"robustness_score"`  // Walk-forward results

	GeneratedAt time.Time `json:"generated_at"`
}

// ViabilityChecker assesses strategy viability
type ViabilityChecker struct {
	thresholds *ViabilityThresholds
}

// NewViabilityChecker creates a new viability checker
func NewViabilityChecker(thresholds *ViabilityThresholds) *ViabilityChecker {
	if thresholds == nil {
		thresholds = DefaultViabilityThresholds()
	}
	return &ViabilityChecker{thresholds: thresholds}
}

// Check performs a comprehensive viability assessment
func (vc *ViabilityChecker) Check(result *types.BacktestResult) *ViabilityReport {
	report := &ViabilityReport{
		Issues:      make([]ViabilityIssue, 0),
		Strengths:   make([]string, 0),
		GeneratedAt: time.Now(),
	}

	metrics := result.Metrics
	riskMetrics := result.RiskMetrics

	// Check core metrics
	vc.checkSharpeRatio(metrics, report)
	vc.checkMaxDrawdown(metrics, report)
	vc.checkProfitFactor(metrics, report)
	vc.checkWinRate(metrics, report)
	vc.checkTradeCount(metrics, report)

	// Check risk metrics
	if riskMetrics != nil {
		vc.checkVaR(riskMetrics, report)
		vc.checkSortinoRatio(metrics, report)
		vc.checkCalmarRatio(metrics, report)
	}

	// Check consistency metrics
	vc.checkExpectancy(metrics, report)
	vc.checkRecoveryFactor(metrics, report)

	// Check walk-forward results if available
	if result.WalkForwardResult != nil {
		vc.checkWalkForward(result.WalkForwardResult, report)
	}

	// Calculate scores
	report.ReturnScore = vc.calculateReturnScore(metrics)
	report.RiskScore = vc.calculateRiskScore(metrics, riskMetrics)
	report.ConsistencyScore = vc.calculateConsistencyScore(metrics)
	report.RobustnessScore = vc.calculateRobustnessScore(result.WalkForwardResult)

	// Overall score (weighted average)
	report.Score = (report.ReturnScore*30 + report.RiskScore*30 +
		report.ConsistencyScore*20 + report.RobustnessScore*20) / 100

	// Determine grade
	report.Grade = vc.scoreToGrade(report.Score)

	// Determine viability
	report.IsViable = !vc.hasCriticalIssues(report.Issues) && report.Score >= 60

	// Generate summary
	report.Summary = vc.generateSummary(report)

	return report
}

func (vc *ViabilityChecker) checkSharpeRatio(metrics *types.PerformanceMetrics, report *ViabilityReport) {
	if metrics.SharpeRatio.LessThan(vc.thresholds.MinSharpeRatio) {
		severity := "warning"
		if metrics.SharpeRatio.LessThan(decimal.Zero) {
			severity = "critical"
		}
		report.Issues = append(report.Issues, ViabilityIssue{
			Metric:      "Sharpe Ratio",
			Actual:      metrics.SharpeRatio,
			Required:    vc.thresholds.MinSharpeRatio,
			Severity:    severity,
			Description: "Risk-adjusted return is below threshold",
			Suggestion:  "Consider reducing trade frequency or improving entry signals",
		})
	} else if metrics.SharpeRatio.GreaterThan(decimal.NewFromFloat(1.5)) {
		report.Strengths = append(report.Strengths, "Excellent risk-adjusted returns (Sharpe > 1.5)")
	}
}

func (vc *ViabilityChecker) checkMaxDrawdown(metrics *types.PerformanceMetrics, report *ViabilityReport) {
	if metrics.MaxDrawdown.GreaterThan(vc.thresholds.MaxDrawdown) {
		severity := "warning"
		if metrics.MaxDrawdown.GreaterThan(decimal.NewFromFloat(0.30)) {
			severity = "critical"
		}
		report.Issues = append(report.Issues, ViabilityIssue{
			Metric:      "Max Drawdown",
			Actual:      metrics.MaxDrawdown,
			Required:    vc.thresholds.MaxDrawdown,
			Severity:    severity,
			Description: "Maximum drawdown exceeds acceptable level",
			Suggestion:  "Consider tighter stop losses or smaller position sizes",
		})
	} else if metrics.MaxDrawdown.LessThan(decimal.NewFromFloat(0.10)) {
		report.Strengths = append(report.Strengths, "Low drawdown risk (< 10%)")
	}
}

func (vc *ViabilityChecker) checkProfitFactor(metrics *types.PerformanceMetrics, report *ViabilityReport) {
	if metrics.ProfitFactor.LessThan(vc.thresholds.MinProfitFactor) {
		severity := "warning"
		if metrics.ProfitFactor.LessThan(decimal.NewFromFloat(1.0)) {
			severity = "critical"
		}
		report.Issues = append(report.Issues, ViabilityIssue{
			Metric:      "Profit Factor",
			Actual:      metrics.ProfitFactor,
			Required:    vc.thresholds.MinProfitFactor,
			Severity:    severity,
			Description: "Profit factor is below threshold",
			Suggestion:  "Focus on improving win size or reducing loss size",
		})
	} else if metrics.ProfitFactor.GreaterThan(decimal.NewFromFloat(2.0)) {
		report.Strengths = append(report.Strengths, "Strong profit factor (> 2.0)")
	}
}

func (vc *ViabilityChecker) checkWinRate(metrics *types.PerformanceMetrics, report *ViabilityReport) {
	if metrics.WinRate.LessThan(vc.thresholds.MinWinRate) {
		severity := "warning"
		if metrics.WinRate.LessThan(decimal.NewFromFloat(0.30)) {
			severity = "critical"
		}
		report.Issues = append(report.Issues, ViabilityIssue{
			Metric:      "Win Rate",
			Actual:      metrics.WinRate,
			Required:    vc.thresholds.MinWinRate,
			Severity:    severity,
			Description: "Win rate is below threshold",
			Suggestion:  "Consider stricter entry criteria or better market filtering",
		})
	} else if metrics.WinRate.GreaterThan(decimal.NewFromFloat(0.60)) {
		report.Strengths = append(report.Strengths, "High win rate (> 60%)")
	}
}

func (vc *ViabilityChecker) checkTradeCount(metrics *types.PerformanceMetrics, report *ViabilityReport) {
	if metrics.TotalTrades < vc.thresholds.MinTrades {
		report.Issues = append(report.Issues, ViabilityIssue{
			Metric:      "Trade Count",
			Actual:      decimal.NewFromInt(int64(metrics.TotalTrades)),
			Required:    decimal.NewFromInt(int64(vc.thresholds.MinTrades)),
			Severity:    "warning",
			Description: "Insufficient trades for statistical significance",
			Suggestion:  "Extend backtest period or reduce filter strictness",
		})
	}
}

func (vc *ViabilityChecker) checkVaR(riskMetrics *types.RiskMetrics, report *ViabilityReport) {
	if riskMetrics.VaR95.GreaterThan(vc.thresholds.MaxVaR95) {
		report.Issues = append(report.Issues, ViabilityIssue{
			Metric:      "VaR 95%",
			Actual:      riskMetrics.VaR95,
			Required:    vc.thresholds.MaxVaR95,
			Severity:    "warning",
			Description: "Daily Value at Risk exceeds acceptable level",
			Suggestion:  "Reduce position sizes or use tighter stops",
		})
	}
}

func (vc *ViabilityChecker) checkSortinoRatio(metrics *types.PerformanceMetrics, report *ViabilityReport) {
	if metrics.SortinoRatio.LessThan(vc.thresholds.MinSortinoRatio) {
		report.Issues = append(report.Issues, ViabilityIssue{
			Metric:      "Sortino Ratio",
			Actual:      metrics.SortinoRatio,
			Required:    vc.thresholds.MinSortinoRatio,
			Severity:    "info",
			Description: "Downside risk-adjusted return could be better",
			Suggestion:  "Focus on reducing losing trade sizes",
		})
	} else if metrics.SortinoRatio.GreaterThan(decimal.NewFromFloat(2.0)) {
		report.Strengths = append(report.Strengths, "Excellent downside protection (Sortino > 2.0)")
	}
}

func (vc *ViabilityChecker) checkCalmarRatio(metrics *types.PerformanceMetrics, report *ViabilityReport) {
	if metrics.CalmarRatio.LessThan(vc.thresholds.MinCalmarRatio) {
		report.Issues = append(report.Issues, ViabilityIssue{
			Metric:      "Calmar Ratio",
			Actual:      metrics.CalmarRatio,
			Required:    vc.thresholds.MinCalmarRatio,
			Severity:    "info",
			Description: "Return relative to drawdown could be better",
			Suggestion:  "Improve returns or reduce maximum drawdown",
		})
	}
}

func (vc *ViabilityChecker) checkExpectancy(metrics *types.PerformanceMetrics, report *ViabilityReport) {
	if metrics.Expectancy.LessThanOrEqual(vc.thresholds.MinExpectancy) {
		severity := "warning"
		if metrics.Expectancy.LessThan(decimal.Zero) {
			severity = "critical"
		}
		report.Issues = append(report.Issues, ViabilityIssue{
			Metric:      "Expectancy",
			Actual:      metrics.Expectancy,
			Required:    vc.thresholds.MinExpectancy,
			Severity:    severity,
			Description: "Expected value per trade is too low or negative",
			Suggestion:  "Strategy needs fundamental improvement",
		})
	}
}

func (vc *ViabilityChecker) checkRecoveryFactor(metrics *types.PerformanceMetrics, report *ViabilityReport) {
	// Recovery Factor = Total Return / Max Drawdown
	if !metrics.MaxDrawdown.IsZero() {
		recoveryFactor := metrics.TotalReturn.Div(metrics.MaxDrawdown)
		if recoveryFactor.LessThan(vc.thresholds.MinRecoveryFactor) {
			report.Issues = append(report.Issues, ViabilityIssue{
				Metric:      "Recovery Factor",
				Actual:      recoveryFactor,
				Required:    vc.thresholds.MinRecoveryFactor,
				Severity:    "info",
				Description: "Returns don't justify the drawdown risk",
				Suggestion:  "Consider if the risk is worth the potential reward",
			})
		}
	}
}

func (vc *ViabilityChecker) checkWalkForward(wfResult *types.WalkForwardResult, report *ViabilityReport) {
	if wfResult == nil || len(wfResult.Windows) == 0 {
		return
	}

	// Check consistency
	profitableWindows := 0
	var totalSharpe decimal.Decimal

	for _, window := range wfResult.Windows {
		if window.OutSampleReturn.GreaterThan(decimal.Zero) {
			profitableWindows++
		}
		totalSharpe = totalSharpe.Add(window.OutSampleSharpe)
	}

	consistency := decimal.NewFromInt(int64(profitableWindows)).Div(
		decimal.NewFromInt(int64(len(wfResult.Windows))))
	avgSharpe := totalSharpe.Div(decimal.NewFromInt(int64(len(wfResult.Windows))))

	if consistency.LessThan(vc.thresholds.MinWFConsistency) {
		report.Issues = append(report.Issues, ViabilityIssue{
			Metric:      "Walk-Forward Consistency",
			Actual:      consistency,
			Required:    vc.thresholds.MinWFConsistency,
			Severity:    "warning",
			Description: "Strategy is inconsistent across different time periods",
			Suggestion:  "Strategy may be overfit to specific market conditions",
		})
	} else {
		report.Strengths = append(report.Strengths, "Consistent out-of-sample performance")
	}

	if avgSharpe.LessThan(vc.thresholds.MinWFSharpe) {
		report.Issues = append(report.Issues, ViabilityIssue{
			Metric:      "Walk-Forward Sharpe",
			Actual:      avgSharpe,
			Required:    vc.thresholds.MinWFSharpe,
			Severity:    "warning",
			Description: "Out-of-sample Sharpe ratio is low",
			Suggestion:  "Strategy may perform worse in live trading than backtest suggests",
		})
	}
}

func (vc *ViabilityChecker) calculateReturnScore(metrics *types.PerformanceMetrics) int {
	score := 50 // Base score

	// Sharpe contribution (up to +30)
	sharpeFloat, _ := metrics.SharpeRatio.Float64()
	if sharpeFloat > 0 {
		score += int(min(30, sharpeFloat*20))
	} else {
		score -= 20
	}

	// Sortino contribution (up to +20)
	sortinoFloat, _ := metrics.SortinoRatio.Float64()
	if sortinoFloat > 0 {
		score += int(min(20, sortinoFloat*10))
	}

	return clamp(score, 0, 100)
}

func (vc *ViabilityChecker) calculateRiskScore(metrics *types.PerformanceMetrics, riskMetrics *types.RiskMetrics) int {
	score := 100 // Start with perfect score, deduct for risk

	// Drawdown penalty (up to -40)
	ddFloat, _ := metrics.MaxDrawdown.Float64()
	score -= int(ddFloat * 200)

	// VaR penalty (up to -30)
	if riskMetrics != nil {
		varFloat, _ := riskMetrics.VaR95.Float64()
		score -= int(varFloat * 300)
	}

	return clamp(score, 0, 100)
}

func (vc *ViabilityChecker) calculateConsistencyScore(metrics *types.PerformanceMetrics) int {
	score := 0

	// Win rate contribution (up to 40)
	winRateFloat, _ := metrics.WinRate.Float64()
	score += int(winRateFloat * 60)

	// Profit factor contribution (up to 40)
	pfFloat, _ := metrics.ProfitFactor.Float64()
	if pfFloat > 1 {
		score += int(min(40, (pfFloat-1)*20))
	}

	// Trade count (up to 20)
	if metrics.TotalTrades >= 100 {
		score += 20
	} else if metrics.TotalTrades >= 50 {
		score += 15
	} else if metrics.TotalTrades >= 30 {
		score += 10
	}

	return clamp(score, 0, 100)
}

func (vc *ViabilityChecker) calculateRobustnessScore(wfResult *types.WalkForwardResult) int {
	if wfResult == nil || len(wfResult.Windows) == 0 {
		return 50 // Neutral if no walk-forward data
	}

	// Calculate from walk-forward results
	profitableWindows := 0
	for _, window := range wfResult.Windows {
		if window.OutSampleReturn.GreaterThan(decimal.Zero) {
			profitableWindows++
		}
	}

	consistency := float64(profitableWindows) / float64(len(wfResult.Windows))
	return int(consistency * 100)
}

func (vc *ViabilityChecker) scoreToGrade(score int) string {
	switch {
	case score >= 90:
		return "A"
	case score >= 80:
		return "B"
	case score >= 70:
		return "C"
	case score >= 60:
		return "D"
	default:
		return "F"
	}
}

func (vc *ViabilityChecker) hasCriticalIssues(issues []ViabilityIssue) bool {
	for _, issue := range issues {
		if issue.Severity == "critical" {
			return true
		}
	}
	return false
}

func (vc *ViabilityChecker) generateSummary(report *ViabilityReport) string {
	if !report.IsViable {
		criticalCount := 0
		for _, issue := range report.Issues {
			if issue.Severity == "critical" {
				criticalCount++
			}
		}
		if criticalCount > 0 {
			return "Strategy is NOT viable for trading. " +
				"Found " + itoa(int64(criticalCount)) + " critical issues that must be addressed."
		}
		return "Strategy does not meet minimum viability requirements. Consider fundamental changes."
	}

	switch report.Grade {
	case "A":
		return "Excellent strategy with strong risk-adjusted returns and consistency. Ready for paper trading."
	case "B":
		return "Good strategy with acceptable metrics. Consider paper trading before live deployment."
	case "C":
		return "Adequate strategy but monitor closely. Address warnings before scaling up."
	case "D":
		return "Marginally viable strategy. Significant improvements recommended before trading."
	default:
		return "Strategy needs substantial work before it can be considered for trading."
	}
}

// Helper functions

func min(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}

func clamp(value, minVal, maxVal int) int {
	if value < minVal {
		return minVal
	}
	if value > maxVal {
		return maxVal
	}
	return value
}

func itoa(i int64) string {
	if i == 0 {
		return "0"
	}
	var buf [20]byte
	pos := len(buf)
	for i > 0 {
		pos--
		buf[pos] = byte('0' + i%10)
		i /= 10
	}
	return string(buf[pos:])
}
