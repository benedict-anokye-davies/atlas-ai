// Package data provides data quality validation for historical market data.
// Based on research: "Garbage in = garbage out - bad data ruins backtests"
// Validates for missing sessions, extreme prices, volume anomalies, and OHLC consistency.
package data

import (
	"math"
	"sort"
	"time"

	"github.com/atlas-desktop/trading-backend/pkg/types"
	"github.com/shopspring/decimal"
	"go.uber.org/zap"
)

// DataQualityValidator checks historical data integrity
type DataQualityValidator struct {
	logger *zap.Logger

	// Configuration
	ExpectedTradingDaysPerYear int     // ~252 for stocks, ~365 for crypto
	MaxIntradayMove            float64 // Max intraday price change (e.g., 0.30 for 30%)
	MaxGapMove                 float64 // Max gap between bars (e.g., 0.20 for 20%)
	MinVolume                  float64 // Minimum acceptable volume
	MaxVolumeMultiple          float64 // Max multiple of average volume for spike detection
}

// DataIssue represents a data quality problem
type DataIssue struct {
	Type      string    `json:"type"`
	Severity  string    `json:"severity"` // "critical", "high", "medium", "low"
	Timestamp time.Time `json:"timestamp"`
	Symbol    string    `json:"symbol"`
	Message   string    `json:"message"`
	Value     string    `json:"value,omitempty"`
	BarIndex  int       `json:"bar_index,omitempty"`
}

// QualityReport summarizes data quality assessment
type QualityReport struct {
	Symbol       string      `json:"symbol"`
	TotalBars    int         `json:"total_bars"`
	Issues       []DataIssue `json:"issues"`
	QualityScore int         `json:"quality_score"` // 0-100
	IsUsable     bool        `json:"is_usable"`

	// Statistics
	MissingDataCount   int `json:"missing_data_count"`
	PriceAnomalyCount  int `json:"price_anomaly_count"`
	VolumeAnomalyCount int `json:"volume_anomaly_count"`
	OHLCErrorCount     int `json:"ohlc_error_count"`

	// Data range
	StartDate time.Time `json:"start_date"`
	EndDate   time.Time `json:"end_date"`
	Duration  string    `json:"duration"`

	// Recommendations
	Recommendations []string `json:"recommendations"`
}

// NewDataQualityValidator creates validator with default settings for crypto
func NewDataQualityValidator(logger *zap.Logger) *DataQualityValidator {
	return &DataQualityValidator{
		logger:                     logger,
		ExpectedTradingDaysPerYear: 365,  // Crypto trades 24/7
		MaxIntradayMove:            0.30, // 30% max intraday move
		MaxGapMove:                 0.20, // 20% max gap between bars
		MinVolume:                  100,  // Minimum volume
		MaxVolumeMultiple:          20.0, // 20x average = spike
	}
}

// NewStockDataQualityValidator creates validator with stock market defaults
func NewStockDataQualityValidator(logger *zap.Logger) *DataQualityValidator {
	return &DataQualityValidator{
		logger:                     logger,
		ExpectedTradingDaysPerYear: 252,  // Stock market trading days
		MaxIntradayMove:            0.20, // 20% max (circuit breakers)
		MaxGapMove:                 0.15, // 15% max gap
		MinVolume:                  1000, // Higher volume requirement
		MaxVolumeMultiple:          10.0, // 10x average = spike
	}
}

// Validate runs all quality checks on historical data
func (dqv *DataQualityValidator) Validate(bars []*types.OHLCV, symbol string) *QualityReport {
	if len(bars) == 0 {
		return &QualityReport{
			Symbol:       symbol,
			TotalBars:    0,
			Issues:       []DataIssue{{Type: "NO_DATA", Severity: "critical", Message: "No data provided"}},
			QualityScore: 0,
			IsUsable:     false,
		}
	}

	issues := make([]DataIssue, 0)

	// Check 1: Missing data gaps
	gapIssues := dqv.checkMissingData(bars, symbol)
	issues = append(issues, gapIssues...)

	// Check 2: Price anomalies (extreme moves, negative prices)
	priceIssues := dqv.checkPriceAnomalies(bars, symbol)
	issues = append(issues, priceIssues...)

	// Check 3: Volume anomalies
	volumeIssues := dqv.checkVolumeAnomalies(bars, symbol)
	issues = append(issues, volumeIssues...)

	// Check 4: OHLC consistency
	ohlcIssues := dqv.checkOHLCConsistency(bars, symbol)
	issues = append(issues, ohlcIssues...)

	// Check 5: Duplicate timestamps
	dupIssues := dqv.checkDuplicates(bars, symbol)
	issues = append(issues, dupIssues...)

	// Check 6: Chronological order
	orderIssues := dqv.checkChronologicalOrder(bars, symbol)
	issues = append(issues, orderIssues...)

	// Calculate statistics
	missingCount := countIssuesByType(issues, "MISSING_DATA", "GAP_DETECTED")
	priceCount := countIssuesByType(issues, "NEGATIVE_PRICE", "EXTREME_MOVE", "GAP_MOVE", "ZERO_PRICE")
	volumeCount := countIssuesByType(issues, "ZERO_VOLUME", "LOW_VOLUME", "VOLUME_SPIKE")
	ohlcCount := countIssuesByType(issues, "OHLC_INCONSISTENT")

	// Calculate quality score (0-100)
	score := dqv.calculateQualityScore(len(bars), issues)

	// Generate recommendations
	recommendations := dqv.generateRecommendations(issues, len(bars))

	return &QualityReport{
		Symbol:             symbol,
		TotalBars:          len(bars),
		Issues:             issues,
		QualityScore:       score,
		IsUsable:           score >= 70 && !dqv.hasCriticalIssues(issues),
		MissingDataCount:   missingCount,
		PriceAnomalyCount:  priceCount,
		VolumeAnomalyCount: volumeCount,
		OHLCErrorCount:     ohlcCount,
		StartDate:          bars[0].Timestamp,
		EndDate:            bars[len(bars)-1].Timestamp,
		Duration:           bars[len(bars)-1].Timestamp.Sub(bars[0].Timestamp).String(),
		Recommendations:    recommendations,
	}
}

// checkMissingData finds gaps in the time series
func (dqv *DataQualityValidator) checkMissingData(bars []*types.OHLCV, symbol string) []DataIssue {
	issues := make([]DataIssue, 0)

	if len(bars) < 2 {
		return issues
	}

	// Calculate expected interval from median of first 10 intervals
	intervals := make([]time.Duration, 0)
	for i := 1; i < len(bars) && i <= 10; i++ {
		intervals = append(intervals, bars[i].Timestamp.Sub(bars[i-1].Timestamp))
	}
	sort.Slice(intervals, func(i, j int) bool {
		return intervals[i] < intervals[j]
	})

	var expectedInterval time.Duration
	if len(intervals) > 0 {
		expectedInterval = intervals[len(intervals)/2] // Median
	}

	for i := 1; i < len(bars); i++ {
		actualInterval := bars[i].Timestamp.Sub(bars[i-1].Timestamp)

		// Allow 50% variance in interval
		maxInterval := expectedInterval + expectedInterval/2

		if actualInterval > maxInterval*3 {
			severity := "high"
			if actualInterval > maxInterval*10 {
				severity = "critical"
			}

			issues = append(issues, DataIssue{
				Type:      "GAP_DETECTED",
				Severity:  severity,
				Timestamp: bars[i-1].Timestamp,
				Symbol:    symbol,
				Message:   "Data gap detected: " + actualInterval.String() + " (expected ~" + expectedInterval.String() + ")",
				Value:     actualInterval.String(),
				BarIndex:  i - 1,
			})
		}
	}

	return issues
}

// checkPriceAnomalies finds extreme price moves and errors
func (dqv *DataQualityValidator) checkPriceAnomalies(bars []*types.OHLCV, symbol string) []DataIssue {
	issues := make([]DataIssue, 0)

	for i, bar := range bars {
		// Check for zero prices
		if bar.Open.IsZero() || bar.High.IsZero() || bar.Low.IsZero() || bar.Close.IsZero() {
			issues = append(issues, DataIssue{
				Type:      "ZERO_PRICE",
				Severity:  "critical",
				Timestamp: bar.Timestamp,
				Symbol:    symbol,
				Message:   "Zero price detected",
				BarIndex:  i,
			})
			continue
		}

		// Check for negative prices
		if bar.Open.LessThan(decimal.Zero) ||
			bar.High.LessThan(decimal.Zero) ||
			bar.Low.LessThan(decimal.Zero) ||
			bar.Close.LessThan(decimal.Zero) {
			issues = append(issues, DataIssue{
				Type:      "NEGATIVE_PRICE",
				Severity:  "critical",
				Timestamp: bar.Timestamp,
				Symbol:    symbol,
				Message:   "Negative price detected",
				BarIndex:  i,
			})
			continue
		}

		// Check intraday range
		if !bar.Low.IsZero() {
			intradayMove := bar.High.Sub(bar.Low).Div(bar.Low)
			intradayFloat, _ := intradayMove.Float64()

			if intradayFloat > dqv.MaxIntradayMove {
				issues = append(issues, DataIssue{
					Type:      "EXTREME_MOVE",
					Severity:  "high",
					Timestamp: bar.Timestamp,
					Symbol:    symbol,
					Message:   "Extreme intraday move: " + intradayMove.Mul(decimal.NewFromInt(100)).StringFixed(2) + "%",
					Value:     intradayMove.StringFixed(4),
					BarIndex:  i,
				})
			}
		}

		// Check bar-to-bar gap
		if i > 0 {
			prevClose := bars[i-1].Close
			if !prevClose.IsZero() {
				move := bar.Open.Sub(prevClose).Div(prevClose).Abs()
				moveFloat, _ := move.Float64()

				if moveFloat > dqv.MaxGapMove {
					issues = append(issues, DataIssue{
						Type:      "GAP_MOVE",
						Severity:  "medium",
						Timestamp: bar.Timestamp,
						Symbol:    symbol,
						Message:   "Large price gap: " + move.Mul(decimal.NewFromInt(100)).StringFixed(2) + "%",
						Value:     move.StringFixed(4),
						BarIndex:  i,
					})
				}
			}
		}
	}

	return issues
}

// checkVolumeAnomalies finds suspicious volume patterns
func (dqv *DataQualityValidator) checkVolumeAnomalies(bars []*types.OHLCV, symbol string) []DataIssue {
	issues := make([]DataIssue, 0)

	// Calculate average volume
	var totalVolume decimal.Decimal
	nonZeroCount := 0
	for _, bar := range bars {
		if bar.Volume.GreaterThan(decimal.Zero) {
			totalVolume = totalVolume.Add(bar.Volume)
			nonZeroCount++
		}
	}

	var avgVolume decimal.Decimal
	if nonZeroCount > 0 {
		avgVolume = totalVolume.Div(decimal.NewFromInt(int64(nonZeroCount)))
	}
	avgFloat, _ := avgVolume.Float64()

	for i, bar := range bars {
		volFloat, _ := bar.Volume.Float64()

		// Zero volume
		if bar.Volume.IsZero() {
			issues = append(issues, DataIssue{
				Type:      "ZERO_VOLUME",
				Severity:  "low",
				Timestamp: bar.Timestamp,
				Symbol:    symbol,
				Message:   "Zero volume bar",
				BarIndex:  i,
			})
			continue
		}

		// Extremely low volume
		if volFloat < dqv.MinVolume {
			issues = append(issues, DataIssue{
				Type:      "LOW_VOLUME",
				Severity:  "low",
				Timestamp: bar.Timestamp,
				Symbol:    symbol,
				Message:   "Volume below threshold: " + bar.Volume.String(),
				Value:     bar.Volume.String(),
				BarIndex:  i,
			})
		}

		// Volume spike (unusual)
		if avgFloat > 0 && volFloat > avgFloat*dqv.MaxVolumeMultiple {
			issues = append(issues, DataIssue{
				Type:      "VOLUME_SPIKE",
				Severity:  "low",
				Timestamp: bar.Timestamp,
				Symbol:    symbol,
				Message:   "Volume spike: " + bar.Volume.String() + " (" + decimal.NewFromFloat(volFloat/avgFloat).StringFixed(1) + "x average)",
				Value:     bar.Volume.String(),
				BarIndex:  i,
			})
		}
	}

	return issues
}

// checkOHLCConsistency verifies High >= Open, Close, Low and Low <= Open, Close, High
func (dqv *DataQualityValidator) checkOHLCConsistency(bars []*types.OHLCV, symbol string) []DataIssue {
	issues := make([]DataIssue, 0)

	for i, bar := range bars {
		// High should be >= Open, Close, Low
		if bar.High.LessThan(bar.Open) || bar.High.LessThan(bar.Close) || bar.High.LessThan(bar.Low) {
			issues = append(issues, DataIssue{
				Type:      "OHLC_INCONSISTENT",
				Severity:  "critical",
				Timestamp: bar.Timestamp,
				Symbol:    symbol,
				Message:   "High is not the highest price (O:" + bar.Open.String() + " H:" + bar.High.String() + " L:" + bar.Low.String() + " C:" + bar.Close.String() + ")",
				BarIndex:  i,
			})
		}

		// Low should be <= Open, Close, High
		if bar.Low.GreaterThan(bar.Open) || bar.Low.GreaterThan(bar.Close) || bar.Low.GreaterThan(bar.High) {
			issues = append(issues, DataIssue{
				Type:      "OHLC_INCONSISTENT",
				Severity:  "critical",
				Timestamp: bar.Timestamp,
				Symbol:    symbol,
				Message:   "Low is not the lowest price (O:" + bar.Open.String() + " H:" + bar.High.String() + " L:" + bar.Low.String() + " C:" + bar.Close.String() + ")",
				BarIndex:  i,
			})
		}
	}

	return issues
}

// checkDuplicates finds duplicate timestamps
func (dqv *DataQualityValidator) checkDuplicates(bars []*types.OHLCV, symbol string) []DataIssue {
	issues := make([]DataIssue, 0)
	seen := make(map[int64]int) // timestamp -> first index

	for i, bar := range bars {
		ts := bar.Timestamp.UnixNano()
		if firstIdx, exists := seen[ts]; exists {
			issues = append(issues, DataIssue{
				Type:      "DUPLICATE_TIMESTAMP",
				Severity:  "high",
				Timestamp: bar.Timestamp,
				Symbol:    symbol,
				Message:   "Duplicate timestamp (also at index " + itoa(int64(firstIdx)) + ")",
				BarIndex:  i,
			})
		} else {
			seen[ts] = i
		}
	}

	return issues
}

// checkChronologicalOrder ensures data is in ascending time order
func (dqv *DataQualityValidator) checkChronologicalOrder(bars []*types.OHLCV, symbol string) []DataIssue {
	issues := make([]DataIssue, 0)

	for i := 1; i < len(bars); i++ {
		if bars[i].Timestamp.Before(bars[i-1].Timestamp) {
			issues = append(issues, DataIssue{
				Type:      "OUT_OF_ORDER",
				Severity:  "critical",
				Timestamp: bars[i].Timestamp,
				Symbol:    symbol,
				Message:   "Bar is out of chronological order",
				BarIndex:  i,
			})
		}
	}

	return issues
}

// calculateQualityScore returns a 0-100 score
func (dqv *DataQualityValidator) calculateQualityScore(totalBars int, issues []DataIssue) int {
	if totalBars == 0 {
		return 0
	}

	// Weight issues by severity
	penaltyPoints := 0.0
	for _, issue := range issues {
		switch issue.Severity {
		case "critical":
			penaltyPoints += 10.0
		case "high":
			penaltyPoints += 5.0
		case "medium":
			penaltyPoints += 2.0
		case "low":
			penaltyPoints += 0.5
		}
	}

	// Score = 100 - penalty (normalized by data size)
	// More data = more tolerance for small issues
	normalizedPenalty := penaltyPoints / math.Max(1, float64(totalBars)/100) * 10
	score := 100.0 - math.Min(normalizedPenalty, 100)

	return int(math.Max(0, math.Min(100, score)))
}

// hasCriticalIssues checks for critical data problems
func (dqv *DataQualityValidator) hasCriticalIssues(issues []DataIssue) bool {
	for _, issue := range issues {
		if issue.Severity == "critical" {
			return true
		}
	}
	return false
}

// generateRecommendations creates actionable recommendations
func (dqv *DataQualityValidator) generateRecommendations(issues []DataIssue, totalBars int) []string {
	recs := make([]string, 0)
	issueTypes := make(map[string]int)

	for _, issue := range issues {
		issueTypes[issue.Type]++
	}

	if issueTypes["GAP_DETECTED"] > 0 {
		recs = append(recs, "Consider filling data gaps with interpolation or removing affected periods")
	}

	if issueTypes["OHLC_INCONSISTENT"] > 0 {
		recs = append(recs, "OHLC inconsistencies detected - verify data source integrity")
	}

	if issueTypes["EXTREME_MOVE"] > totalBars/100 {
		recs = append(recs, "Many extreme price moves detected - consider filtering outliers or verifying data")
	}

	if issueTypes["ZERO_VOLUME"] > totalBars/10 {
		recs = append(recs, "High proportion of zero volume bars - consider using a more liquid asset or timeframe")
	}

	if issueTypes["DUPLICATE_TIMESTAMP"] > 0 {
		recs = append(recs, "Remove duplicate timestamps before backtesting")
	}

	if issueTypes["OUT_OF_ORDER"] > 0 {
		recs = append(recs, "Sort data by timestamp before use")
	}

	if len(recs) == 0 {
		recs = append(recs, "Data quality is acceptable for backtesting")
	}

	return recs
}

// Helper functions

func countIssuesByType(issues []DataIssue, types ...string) int {
	count := 0
	typeSet := make(map[string]bool)
	for _, t := range types {
		typeSet[t] = true
	}
	for _, issue := range issues {
		if typeSet[issue.Type] {
			count++
		}
	}
	return count
}

func itoa(i int64) string {
	if i == 0 {
		return "0"
	}

	var buf [20]byte
	pos := len(buf)
	neg := i < 0
	if neg {
		i = -i
	}

	for i > 0 {
		pos--
		buf[pos] = byte('0' + i%10)
		i /= 10
	}

	if neg {
		pos--
		buf[pos] = '-'
	}

	return string(buf[pos:])
}

// CleanData removes or fixes common data issues
func (dqv *DataQualityValidator) CleanData(bars []*types.OHLCV) []*types.OHLCV {
	if len(bars) == 0 {
		return bars
	}

	cleaned := make([]*types.OHLCV, 0, len(bars))
	seen := make(map[int64]bool)

	// Sort by timestamp first
	sort.Slice(bars, func(i, j int) bool {
		return bars[i].Timestamp.Before(bars[j].Timestamp)
	})

	for _, bar := range bars {
		// Skip duplicates
		ts := bar.Timestamp.UnixNano()
		if seen[ts] {
			continue
		}
		seen[ts] = true

		// Skip invalid OHLC
		if bar.High.LessThan(bar.Low) {
			continue
		}

		// Skip zero/negative prices
		if bar.Open.LessThanOrEqual(decimal.Zero) ||
			bar.High.LessThanOrEqual(decimal.Zero) ||
			bar.Low.LessThanOrEqual(decimal.Zero) ||
			bar.Close.LessThanOrEqual(decimal.Zero) {
			continue
		}

		// Fix OHLC if possible (adjust High/Low to encompass O/C)
		fixedBar := &types.OHLCV{
			Timestamp: bar.Timestamp,
			Open:      bar.Open,
			Close:     bar.Close,
			Volume:    bar.Volume,
		}

		// High should be max of O, H, C
		fixedBar.High = decimal.Max(bar.Open, decimal.Max(bar.High, bar.Close))

		// Low should be min of O, L, C
		fixedBar.Low = decimal.Min(bar.Open, decimal.Min(bar.Low, bar.Close))

		cleaned = append(cleaned, fixedBar)
	}

	dqv.logger.Info("Data cleaning complete",
		zap.Int("original_bars", len(bars)),
		zap.Int("cleaned_bars", len(cleaned)),
		zap.Int("removed", len(bars)-len(cleaned)),
	)

	return cleaned
}
