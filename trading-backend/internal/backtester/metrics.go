// Package backtester provides performance metrics calculation.
package backtester

import (
	"math"
	"sort"
	"time"

	"github.com/atlas-desktop/trading-backend/pkg/types"
	"github.com/shopspring/decimal"
	"go.uber.org/zap"
)

// MetricsCalculator calculates performance metrics
type MetricsCalculator struct {
	logger *zap.Logger
}

// NewMetricsCalculator creates a new metrics calculator
func NewMetricsCalculator() *MetricsCalculator {
	return &MetricsCalculator{}
}

// Calculate calculates all performance metrics
func (mc *MetricsCalculator) Calculate(
	trades []*types.Trade,
	equityCurve []types.EquityCurvePoint,
	initialCapital decimal.Decimal,
) *types.PerformanceMetrics {
	if len(trades) == 0 || len(equityCurve) == 0 {
		return &types.PerformanceMetrics{}
	}
	
	metrics := &types.PerformanceMetrics{}
	
	// Basic trade statistics
	var winningTrades, losingTrades int
	var totalWins, totalLosses decimal.Decimal
	var largestWin, largestLoss decimal.Decimal
	var totalHoldingTime time.Duration
	
	for _, trade := range trades {
		if trade.PnL.GreaterThan(decimal.Zero) {
			winningTrades++
			totalWins = totalWins.Add(trade.PnL)
			if trade.PnL.GreaterThan(largestWin) {
				largestWin = trade.PnL
			}
		} else if trade.PnL.LessThan(decimal.Zero) {
			losingTrades++
			totalLosses = totalLosses.Add(trade.PnL.Abs())
			if trade.PnL.Abs().GreaterThan(largestLoss) {
				largestLoss = trade.PnL.Abs()
			}
		}
	}
	
	metrics.TotalTrades = len(trades)
	metrics.WinningTrades = winningTrades
	metrics.LosingTrades = losingTrades
	metrics.LargestWin = largestWin
	metrics.LargestLoss = largestLoss
	
	// Win rate
	if metrics.TotalTrades > 0 {
		metrics.WinRate = decimal.NewFromInt(int64(winningTrades)).Div(decimal.NewFromInt(int64(metrics.TotalTrades)))
	}
	
	// Average win/loss
	if winningTrades > 0 {
		metrics.AvgWin = totalWins.Div(decimal.NewFromInt(int64(winningTrades)))
	}
	if losingTrades > 0 {
		metrics.AvgLoss = totalLosses.Div(decimal.NewFromInt(int64(losingTrades)))
	}
	
	// Profit factor
	if !totalLosses.IsZero() {
		metrics.ProfitFactor = totalWins.Div(totalLosses)
	}
	
	// Expectancy: (Win% * AvgWin) - (Loss% * AvgLoss)
	if metrics.TotalTrades > 0 {
		winPct := metrics.WinRate
		lossPct := decimal.NewFromFloat(1).Sub(winPct)
		metrics.Expectancy = winPct.Mul(metrics.AvgWin).Sub(lossPct.Mul(metrics.AvgLoss))
	}
	
	// Average holding time
	if metrics.TotalTrades > 0 {
		metrics.AvgHoldingTime = totalHoldingTime / time.Duration(metrics.TotalTrades)
	}
	
	// Total return
	if len(equityCurve) > 0 && !initialCapital.IsZero() {
		finalEquity := equityCurve[len(equityCurve)-1].Equity
		metrics.TotalReturn = finalEquity.Sub(initialCapital).Div(initialCapital)
	}
	
	// Calculate returns for Sharpe/Sortino
	returns := mc.calculateDailyReturns(equityCurve)
	
	// Annualized return
	if len(equityCurve) > 1 {
		tradingDays := len(returns)
		if tradingDays > 0 {
			avgDailyReturn := mc.mean(returns)
			metrics.AnnualizedReturn = decimal.NewFromFloat(avgDailyReturn * 252)
		}
	}
	
	// Sharpe Ratio (assuming 0% risk-free rate)
	if len(returns) > 1 {
		avgReturn := mc.mean(returns)
		stdDev := mc.stdDev(returns)
		if stdDev > 0 {
			dailySharpe := avgReturn / stdDev
			metrics.SharpeRatio = decimal.NewFromFloat(dailySharpe * math.Sqrt(252))
		}
	}
	
	// Sortino Ratio (only downside deviation)
	if len(returns) > 1 {
		avgReturn := mc.mean(returns)
		downsideDev := mc.downsideDeviation(returns)
		if downsideDev > 0 {
			dailySortino := avgReturn / downsideDev
			metrics.SortinoRatio = decimal.NewFromFloat(dailySortino * math.Sqrt(252))
		}
	}
	
	// Max drawdown
	maxDD, maxDDDate := mc.calculateMaxDrawdown(equityCurve)
	metrics.MaxDrawdown = maxDD
	metrics.MaxDrawdownDate = maxDDDate
	
	// Calmar Ratio (annualized return / max drawdown)
	if !metrics.MaxDrawdown.IsZero() {
		metrics.CalmarRatio = metrics.AnnualizedReturn.Div(metrics.MaxDrawdown)
	}
	
	return metrics
}

// CalculateRiskMetrics calculates risk-related metrics
func (mc *MetricsCalculator) CalculateRiskMetrics(equityCurve []types.EquityCurvePoint) *types.RiskMetrics {
	if len(equityCurve) < 2 {
		return &types.RiskMetrics{}
	}
	
	returns := mc.calculateDailyReturns(equityCurve)
	if len(returns) == 0 {
		return &types.RiskMetrics{}
	}
	
	metrics := &types.RiskMetrics{}
	
	// Daily and annual volatility
	dailyVol := mc.stdDev(returns)
	metrics.DailyVolatility = decimal.NewFromFloat(dailyVol)
	metrics.AnnualVolatility = decimal.NewFromFloat(dailyVol * math.Sqrt(252))
	
	// VaR (Value at Risk)
	sortedReturns := make([]float64, len(returns))
	copy(sortedReturns, returns)
	sort.Float64s(sortedReturns)
	
	// 95% VaR
	idx95 := int(float64(len(sortedReturns)) * 0.05)
	if idx95 >= 0 && idx95 < len(sortedReturns) {
		metrics.VaR95 = decimal.NewFromFloat(-sortedReturns[idx95])
	}
	
	// 99% VaR
	idx99 := int(float64(len(sortedReturns)) * 0.01)
	if idx99 >= 0 && idx99 < len(sortedReturns) {
		metrics.VaR99 = decimal.NewFromFloat(-sortedReturns[idx99])
	}
	
	// CVaR (Conditional VaR / Expected Shortfall)
	if idx95 > 0 {
		var sum float64
		for i := 0; i < idx95; i++ {
			sum += sortedReturns[i]
		}
		metrics.CVaR95 = decimal.NewFromFloat(-sum / float64(idx95))
	}
	
	return metrics
}

// calculateDailyReturns calculates daily returns from equity curve
func (mc *MetricsCalculator) calculateDailyReturns(equityCurve []types.EquityCurvePoint) []float64 {
	if len(equityCurve) < 2 {
		return nil
	}
	
	returns := make([]float64, 0, len(equityCurve)-1)
	
	for i := 1; i < len(equityCurve); i++ {
		prevEquity := equityCurve[i-1].Equity
		currEquity := equityCurve[i].Equity
		
		if prevEquity.IsZero() {
			continue
		}
		
		ret := currEquity.Sub(prevEquity).Div(prevEquity)
		retFloat, _ := ret.Float64()
		returns = append(returns, retFloat)
	}
	
	return returns
}

// calculateMaxDrawdown calculates maximum drawdown
func (mc *MetricsCalculator) calculateMaxDrawdown(equityCurve []types.EquityCurvePoint) (decimal.Decimal, time.Time) {
	if len(equityCurve) == 0 {
		return decimal.Zero, time.Time{}
	}
	
	var maxDD decimal.Decimal
	var maxDDDate time.Time
	peak := equityCurve[0].Equity
	
	for _, point := range equityCurve {
		if point.Equity.GreaterThan(peak) {
			peak = point.Equity
		}
		
		if !peak.IsZero() {
			dd := peak.Sub(point.Equity).Div(peak)
			if dd.GreaterThan(maxDD) {
				maxDD = dd
				maxDDDate = point.Timestamp
			}
		}
	}
	
	return maxDD, maxDDDate
}

// mean calculates arithmetic mean
func (mc *MetricsCalculator) mean(values []float64) float64 {
	if len(values) == 0 {
		return 0
	}
	
	var sum float64
	for _, v := range values {
		sum += v
	}
	return sum / float64(len(values))
}

// stdDev calculates standard deviation
func (mc *MetricsCalculator) stdDev(values []float64) float64 {
	if len(values) < 2 {
		return 0
	}
	
	mean := mc.mean(values)
	var sumSquares float64
	
	for _, v := range values {
		diff := v - mean
		sumSquares += diff * diff
	}
	
	return math.Sqrt(sumSquares / float64(len(values)-1))
}

// downsideDeviation calculates downside deviation (only negative returns)
func (mc *MetricsCalculator) downsideDeviation(returns []float64) float64 {
	var negativeReturns []float64
	
	for _, r := range returns {
		if r < 0 {
			negativeReturns = append(negativeReturns, r)
		}
	}
	
	if len(negativeReturns) == 0 {
		return 0
	}
	
	return mc.stdDev(negativeReturns)
}
