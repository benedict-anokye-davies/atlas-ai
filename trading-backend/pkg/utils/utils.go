// Package utils provides utility functions for the trading backend.
package utils

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"math"
	"regexp"
	"strings"
	"time"

	"github.com/shopspring/decimal"
)

// GenerateID generates a unique ID with optional prefix.
func GenerateID(prefix string) string {
	bytes := make([]byte, 16)
	rand.Read(bytes)
	id := hex.EncodeToString(bytes)
	if prefix != "" {
		return fmt.Sprintf("%s_%s", prefix, id)
	}
	return id
}

// GenerateOrderID generates a unique order ID.
func GenerateOrderID() string {
	return GenerateID("ord")
}

// GenerateTradeID generates a unique trade ID.
func GenerateTradeID() string {
	return GenerateID("trd")
}

// GenerateSignalID generates a unique signal ID.
func GenerateSignalID() string {
	return GenerateID("sig")
}

// FormatSymbol normalizes a trading symbol.
func FormatSymbol(symbol string) string {
	// Remove whitespace
	symbol = strings.TrimSpace(symbol)
	
	// Uppercase
	symbol = strings.ToUpper(symbol)
	
	// Normalize separators
	symbol = strings.ReplaceAll(symbol, "-", "/")
	symbol = strings.ReplaceAll(symbol, "_", "/")
	
	// Ensure proper format (BASE/QUOTE)
	if !strings.Contains(symbol, "/") {
		// Try to detect common quote currencies
		quotes := []string{"USDT", "USDC", "USD", "BTC", "ETH", "BNB"}
		for _, quote := range quotes {
			if strings.HasSuffix(symbol, quote) {
				base := strings.TrimSuffix(symbol, quote)
				return base + "/" + quote
			}
		}
	}
	
	return symbol
}

// ParseSymbol extracts base and quote from a symbol.
func ParseSymbol(symbol string) (base, quote string) {
	parts := strings.Split(symbol, "/")
	if len(parts) == 2 {
		return parts[0], parts[1]
	}
	return symbol, ""
}

// RoundToDecimalPlaces rounds a decimal to specified places.
func RoundToDecimalPlaces(d decimal.Decimal, places int32) decimal.Decimal {
	return d.Round(places)
}

// RoundToTickSize rounds a price to the nearest tick size.
func RoundToTickSize(price, tickSize decimal.Decimal) decimal.Decimal {
	if tickSize.IsZero() {
		return price
	}
	return price.Div(tickSize).Floor().Mul(tickSize)
}

// RoundToStepSize rounds a quantity to the nearest step size.
func RoundToStepSize(qty, stepSize decimal.Decimal) decimal.Decimal {
	if stepSize.IsZero() {
		return qty
	}
	return qty.Div(stepSize).Floor().Mul(stepSize)
}

// CalculatePercentageChange calculates percentage change between two values.
func CalculatePercentageChange(old, new decimal.Decimal) decimal.Decimal {
	if old.IsZero() {
		return decimal.Zero
	}
	return new.Sub(old).Div(old).Mul(decimal.NewFromInt(100))
}

// CalculateReturns calculates returns from price series.
func CalculateReturns(prices []decimal.Decimal) []decimal.Decimal {
	if len(prices) < 2 {
		return nil
	}
	
	returns := make([]decimal.Decimal, len(prices)-1)
	for i := 1; i < len(prices); i++ {
		if prices[i-1].IsZero() {
			returns[i-1] = decimal.Zero
		} else {
			returns[i-1] = prices[i].Sub(prices[i-1]).Div(prices[i-1])
		}
	}
	
	return returns
}

// CalculateMean calculates the mean of decimal values.
func CalculateMean(values []decimal.Decimal) decimal.Decimal {
	if len(values) == 0 {
		return decimal.Zero
	}
	
	sum := decimal.Zero
	for _, v := range values {
		sum = sum.Add(v)
	}
	
	return sum.Div(decimal.NewFromInt(int64(len(values))))
}

// CalculateStdDev calculates standard deviation of decimal values.
func CalculateStdDev(values []decimal.Decimal) decimal.Decimal {
	if len(values) < 2 {
		return decimal.Zero
	}
	
	mean := CalculateMean(values)
	
	sumSquares := decimal.Zero
	for _, v := range values {
		diff := v.Sub(mean)
		sumSquares = sumSquares.Add(diff.Mul(diff))
	}
	
	variance := sumSquares.Div(decimal.NewFromInt(int64(len(values) - 1)))
	return decimal.NewFromFloat(math.Sqrt(variance.InexactFloat64()))
}

// CalculateSharpeRatio calculates Sharpe ratio.
func CalculateSharpeRatio(returns []decimal.Decimal, riskFreeRate decimal.Decimal, periodsPerYear int) decimal.Decimal {
	if len(returns) < 2 {
		return decimal.Zero
	}
	
	meanReturn := CalculateMean(returns)
	stdDev := CalculateStdDev(returns)
	
	if stdDev.IsZero() {
		return decimal.Zero
	}
	
	// Annualize
	annualizationFactor := decimal.NewFromFloat(math.Sqrt(float64(periodsPerYear)))
	excessReturn := meanReturn.Sub(riskFreeRate.Div(decimal.NewFromInt(int64(periodsPerYear))))
	
	return excessReturn.Div(stdDev).Mul(annualizationFactor)
}

// CalculateMaxDrawdown calculates maximum drawdown from equity curve.
func CalculateMaxDrawdown(equity []decimal.Decimal) decimal.Decimal {
	if len(equity) < 2 {
		return decimal.Zero
	}
	
	maxDrawdown := decimal.Zero
	peak := equity[0]
	
	for _, value := range equity {
		if value.GreaterThan(peak) {
			peak = value
		}
		drawdown := peak.Sub(value).Div(peak)
		if drawdown.GreaterThan(maxDrawdown) {
			maxDrawdown = drawdown
		}
	}
	
	return maxDrawdown
}

// CalculateWinRate calculates win rate from PnL values.
func CalculateWinRate(pnls []decimal.Decimal) decimal.Decimal {
	if len(pnls) == 0 {
		return decimal.Zero
	}
	
	wins := 0
	for _, pnl := range pnls {
		if pnl.GreaterThan(decimal.Zero) {
			wins++
		}
	}
	
	return decimal.NewFromInt(int64(wins)).Div(decimal.NewFromInt(int64(len(pnls))))
}

// CalculateProfitFactor calculates profit factor (gross profit / gross loss).
func CalculateProfitFactor(pnls []decimal.Decimal) decimal.Decimal {
	grossProfit := decimal.Zero
	grossLoss := decimal.Zero
	
	for _, pnl := range pnls {
		if pnl.GreaterThan(decimal.Zero) {
			grossProfit = grossProfit.Add(pnl)
		} else {
			grossLoss = grossLoss.Add(pnl.Abs())
		}
	}
	
	if grossLoss.IsZero() {
		return decimal.NewFromInt(100) // Infinite profit factor capped
	}
	
	return grossProfit.Div(grossLoss)
}

// TimeRange represents a time range.
type TimeRange struct {
	Start time.Time
	End   time.Time
}

// Duration returns the duration of the time range.
func (tr TimeRange) Duration() time.Duration {
	return tr.End.Sub(tr.Start)
}

// Contains checks if a time is within the range.
func (tr TimeRange) Contains(t time.Time) bool {
	return (t.Equal(tr.Start) || t.After(tr.Start)) && (t.Equal(tr.End) || t.Before(tr.End))
}

// ParseTimeRange parses a time range string (e.g., "1d", "1w", "1m").
func ParseTimeRange(s string) (time.Duration, error) {
	s = strings.ToLower(strings.TrimSpace(s))
	
	if len(s) < 2 {
		return 0, fmt.Errorf("invalid time range: %s", s)
	}
	
	value := 0
	for i, c := range s {
		if c >= '0' && c <= '9' {
			value = value*10 + int(c-'0')
		} else {
			unit := s[i:]
			switch unit {
			case "s", "sec", "second", "seconds":
				return time.Duration(value) * time.Second, nil
			case "m", "min", "minute", "minutes":
				return time.Duration(value) * time.Minute, nil
			case "h", "hr", "hour", "hours":
				return time.Duration(value) * time.Hour, nil
			case "d", "day", "days":
				return time.Duration(value) * 24 * time.Hour, nil
			case "w", "week", "weeks":
				return time.Duration(value) * 7 * 24 * time.Hour, nil
			case "mo", "month", "months":
				return time.Duration(value) * 30 * 24 * time.Hour, nil
			case "y", "year", "years":
				return time.Duration(value) * 365 * 24 * time.Hour, nil
			default:
				return 0, fmt.Errorf("unknown time unit: %s", unit)
			}
		}
	}
	
	return 0, fmt.Errorf("invalid time range: %s", s)
}

// FormatDuration formats a duration in human-readable form.
func FormatDuration(d time.Duration) string {
	days := int(d.Hours() / 24)
	hours := int(d.Hours()) % 24
	minutes := int(d.Minutes()) % 60
	
	if days > 0 {
		return fmt.Sprintf("%dd %dh %dm", days, hours, minutes)
	}
	if hours > 0 {
		return fmt.Sprintf("%dh %dm", hours, minutes)
	}
	return fmt.Sprintf("%dm", minutes)
}

// FormatMoney formats a decimal as money.
func FormatMoney(d decimal.Decimal, currency string) string {
	switch strings.ToUpper(currency) {
	case "USD", "USDT", "USDC":
		return "$" + d.StringFixed(2)
	case "GBP":
		return "£" + d.StringFixed(2)
	case "EUR":
		return "€" + d.StringFixed(2)
	case "BTC":
		return d.StringFixed(8) + " BTC"
	case "ETH":
		return d.StringFixed(6) + " ETH"
	case "SOL":
		return d.StringFixed(4) + " SOL"
	default:
		return d.String() + " " + currency
	}
}

// ValidateEmail validates an email address.
func ValidateEmail(email string) bool {
	emailRegex := regexp.MustCompile(`^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`)
	return emailRegex.MatchString(email)
}

// ValidateWebhookURL validates a webhook URL.
func ValidateWebhookURL(url string) bool {
	urlRegex := regexp.MustCompile(`^https?://[a-zA-Z0-9.-]+(/[a-zA-Z0-9._/-]*)?$`)
	return urlRegex.MatchString(url)
}

// MinDecimal returns the minimum of two decimals.
func MinDecimal(a, b decimal.Decimal) decimal.Decimal {
	if a.LessThan(b) {
		return a
	}
	return b
}

// MaxDecimal returns the maximum of two decimals.
func MaxDecimal(a, b decimal.Decimal) decimal.Decimal {
	if a.GreaterThan(b) {
		return a
	}
	return b
}

// ClampDecimal clamps a value between min and max.
func ClampDecimal(value, min, max decimal.Decimal) decimal.Decimal {
	if value.LessThan(min) {
		return min
	}
	if value.GreaterThan(max) {
		return max
	}
	return value
}

// RetryConfig contains retry configuration.
type RetryConfig struct {
	MaxAttempts int
	InitialDelay time.Duration
	MaxDelay     time.Duration
	Multiplier   float64
}

// DefaultRetryConfig returns default retry configuration.
func DefaultRetryConfig() RetryConfig {
	return RetryConfig{
		MaxAttempts:  3,
		InitialDelay: 100 * time.Millisecond,
		MaxDelay:     5 * time.Second,
		Multiplier:   2.0,
	}
}

// Retry retries a function with exponential backoff.
func Retry[T any](config RetryConfig, fn func() (T, error)) (T, error) {
	var result T
	var err error
	delay := config.InitialDelay
	
	for attempt := 1; attempt <= config.MaxAttempts; attempt++ {
		result, err = fn()
		if err == nil {
			return result, nil
		}
		
		if attempt == config.MaxAttempts {
			break
		}
		
		time.Sleep(delay)
		delay = time.Duration(float64(delay) * config.Multiplier)
		if delay > config.MaxDelay {
			delay = config.MaxDelay
		}
	}
	
	return result, fmt.Errorf("after %d attempts: %w", config.MaxAttempts, err)
}

// BatchProcess processes items in batches.
func BatchProcess[T any, R any](items []T, batchSize int, fn func([]T) ([]R, error)) ([]R, error) {
	var results []R
	
	for i := 0; i < len(items); i += batchSize {
		end := i + batchSize
		if end > len(items) {
			end = len(items)
		}
		
		batch := items[i:end]
		batchResults, err := fn(batch)
		if err != nil {
			return nil, fmt.Errorf("batch %d-%d failed: %w", i, end, err)
		}
		
		results = append(results, batchResults...)
	}
	
	return results, nil
}

// EMA calculates exponential moving average.
type EMA struct {
	period    int
	multiplier decimal.Decimal
	current   decimal.Decimal
	count     int
}

// NewEMA creates a new EMA calculator.
func NewEMA(period int) *EMA {
	mult := decimal.NewFromFloat(2.0 / float64(period+1))
	return &EMA{
		period:     period,
		multiplier: mult,
	}
}

// Add adds a value and returns the current EMA.
func (e *EMA) Add(value decimal.Decimal) decimal.Decimal {
	e.count++
	
	if e.count == 1 {
		e.current = value
		return e.current
	}
	
	// EMA = (value - previous EMA) * multiplier + previous EMA
	e.current = value.Sub(e.current).Mul(e.multiplier).Add(e.current)
	return e.current
}

// Current returns the current EMA value.
func (e *EMA) Current() decimal.Decimal {
	return e.current
}

// SMA calculates simple moving average.
type SMA struct {
	period  int
	values  []decimal.Decimal
	sum     decimal.Decimal
}

// NewSMA creates a new SMA calculator.
func NewSMA(period int) *SMA {
	return &SMA{
		period: period,
		values: make([]decimal.Decimal, 0, period),
	}
}

// Add adds a value and returns the current SMA.
func (s *SMA) Add(value decimal.Decimal) decimal.Decimal {
	s.values = append(s.values, value)
	s.sum = s.sum.Add(value)
	
	if len(s.values) > s.period {
		s.sum = s.sum.Sub(s.values[0])
		s.values = s.values[1:]
	}
	
	return s.sum.Div(decimal.NewFromInt(int64(len(s.values))))
}

// Current returns the current SMA value.
func (s *SMA) Current() decimal.Decimal {
	if len(s.values) == 0 {
		return decimal.Zero
	}
	return s.sum.Div(decimal.NewFromInt(int64(len(s.values))))
}
