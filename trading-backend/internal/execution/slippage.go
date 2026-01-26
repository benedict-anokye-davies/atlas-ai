// Package execution provides slippage calculation capabilities.
package execution

import (
	"math"
	"sync"
	"time"

	"github.com/atlas-desktop/trading-backend/pkg/types"
	"github.com/shopspring/decimal"
	"go.uber.org/zap"
)

// SlippageCalculator calculates and predicts slippage.
type SlippageCalculator struct {
	logger  *zap.Logger
	config  SlippageConfig
	mu      sync.RWMutex
	
	// Historical slippage data
	historicalSlippage map[string][]SlippageRecord
	
	// Market impact models
	orderBooks map[string]*OrderBook
}

// SlippageConfig contains slippage calculation configuration.
type SlippageConfig struct {
	// Base slippage (always applied)
	BaseSlippage decimal.Decimal `json:"baseSlippage"` // e.g., 0.001 = 0.1%
	
	// Volume-based slippage
	VolumeImpactFactor  decimal.Decimal `json:"volumeImpactFactor"`  // Impact per unit of volume
	VolumeImpactDecay   float64         `json:"volumeImpactDecay"`   // How quickly impact decreases
	
	// Volatility-based slippage
	VolatilityMultiplier decimal.Decimal `json:"volatilityMultiplier"` // Multiplier for volatility
	
	// Time-based factors
	SpreadExpansion decimal.Decimal `json:"spreadExpansion"` // Extra slippage during high volatility
	
	// Market hours slippage (higher outside regular hours)
	OffHoursMultiplier decimal.Decimal `json:"offHoursMultiplier"`
	
	// Maximum slippage cap
	MaxSlippage decimal.Decimal `json:"maxSlippage"` // e.g., 0.05 = 5%
	
	// MEV protection
	MEVProtectionEnabled bool            `json:"mevProtectionEnabled"`
	MaxMEVSlippage       decimal.Decimal `json:"maxMevSlippage"`
}

// SlippageRecord represents a historical slippage observation.
type SlippageRecord struct {
	Symbol          string          `json:"symbol"`
	ExpectedPrice   decimal.Decimal `json:"expectedPrice"`
	ExecutedPrice   decimal.Decimal `json:"executedPrice"`
	Slippage        decimal.Decimal `json:"slippage"`        // As percentage
	SlippageUSD     decimal.Decimal `json:"slippageUsd"`
	OrderSize       decimal.Decimal `json:"orderSize"`
	DailyVolume     decimal.Decimal `json:"dailyVolume"`
	Volatility      decimal.Decimal `json:"volatility"`
	Timestamp       time.Time       `json:"timestamp"`
	Exchange        string          `json:"exchange"`
	OrderType       string          `json:"orderType"`
	IsMEVAttack     bool            `json:"isMevAttack"`
}

// OrderBook represents a simplified order book for market impact calculation.
type OrderBook struct {
	Symbol    string           `json:"symbol"`
	Bids      []OrderBookLevel `json:"bids"`
	Asks      []OrderBookLevel `json:"asks"`
	UpdatedAt time.Time        `json:"updatedAt"`
}

// OrderBookLevel represents a price level in the order book.
type OrderBookLevel struct {
	Price    decimal.Decimal `json:"price"`
	Quantity decimal.Decimal `json:"quantity"`
}

// SlippageEstimate contains the estimated slippage for an order.
type SlippageEstimate struct {
	ExpectedSlippage   decimal.Decimal `json:"expectedSlippage"`   // As percentage
	SlippageRange      SlippageRange   `json:"slippageRange"`      // Min/Max range
	MarketImpact       decimal.Decimal `json:"marketImpact"`       // Expected price movement
	ExpectedFillPrice  decimal.Decimal `json:"expectedFillPrice"`
	Confidence         float64         `json:"confidence"`         // 0-1
	Factors            []SlippageFactor `json:"factors"`
	Recommendation     string          `json:"recommendation,omitempty"`
}

// SlippageRange represents a range of possible slippage values.
type SlippageRange struct {
	Min decimal.Decimal `json:"min"`
	Max decimal.Decimal `json:"max"`
	P50 decimal.Decimal `json:"p50"` // 50th percentile
	P95 decimal.Decimal `json:"p95"` // 95th percentile
}

// SlippageFactor represents a factor contributing to slippage.
type SlippageFactor struct {
	Name        string          `json:"name"`
	Contribution decimal.Decimal `json:"contribution"`
	Description string          `json:"description"`
}

// DefaultSlippageConfig returns default slippage configuration.
func DefaultSlippageConfig() SlippageConfig {
	return SlippageConfig{
		BaseSlippage:         decimal.NewFromFloat(0.0005), // 0.05%
		VolumeImpactFactor:   decimal.NewFromFloat(0.0001),
		VolumeImpactDecay:    0.5,
		VolatilityMultiplier: decimal.NewFromFloat(2.0),
		SpreadExpansion:      decimal.NewFromFloat(0.001),
		OffHoursMultiplier:   decimal.NewFromFloat(1.5),
		MaxSlippage:          decimal.NewFromFloat(0.05), // 5%
		MEVProtectionEnabled: true,
		MaxMEVSlippage:       decimal.NewFromFloat(0.01), // 1%
	}
}

// NewSlippageCalculator creates a new slippage calculator.
func NewSlippageCalculator(logger *zap.Logger, config SlippageConfig) *SlippageCalculator {
	return &SlippageCalculator{
		logger:             logger.Named("slippage-calculator"),
		config:             config,
		historicalSlippage: make(map[string][]SlippageRecord),
		orderBooks:         make(map[string]*OrderBook),
	}
}

// EstimateSlippage estimates slippage for an order.
func (sc *SlippageCalculator) EstimateSlippage(order *types.Order, marketData MarketData) SlippageEstimate {
	sc.mu.RLock()
	defer sc.mu.RUnlock()
	
	estimate := SlippageEstimate{
		Confidence: 0.7, // Default confidence
	}
	
	var totalSlippage decimal.Decimal
	var factors []SlippageFactor
	
	// 1. Base slippage
	baseSlip := sc.config.BaseSlippage
	totalSlippage = totalSlippage.Add(baseSlip)
	factors = append(factors, SlippageFactor{
		Name:         "base",
		Contribution: baseSlip,
		Description:  "Base exchange slippage",
	})
	
	// 2. Spread impact
	spreadSlip := sc.calculateSpreadImpact(order, marketData)
	totalSlippage = totalSlippage.Add(spreadSlip)
	factors = append(factors, SlippageFactor{
		Name:         "spread",
		Contribution: spreadSlip,
		Description:  "Bid-ask spread impact",
	})
	
	// 3. Volume impact (market impact)
	volumeSlip := sc.calculateVolumeImpact(order, marketData)
	totalSlippage = totalSlippage.Add(volumeSlip)
	factors = append(factors, SlippageFactor{
		Name:         "volume",
		Contribution: volumeSlip,
		Description:  "Market impact from order size",
	})
	
	// 4. Volatility impact
	volatilitySlip := sc.calculateVolatilityImpact(marketData)
	totalSlippage = totalSlippage.Add(volatilitySlip)
	factors = append(factors, SlippageFactor{
		Name:         "volatility",
		Contribution: volatilitySlip,
		Description:  "Volatility-based slippage",
	})
	
	// 5. Time-of-day factor
	timeSlip := sc.calculateTimeImpact()
	totalSlippage = totalSlippage.Add(timeSlip)
	if !timeSlip.IsZero() {
		factors = append(factors, SlippageFactor{
			Name:         "time",
			Contribution: timeSlip,
			Description:  "Off-hours trading premium",
		})
	}
	
	// 6. Order book depth impact
	if ob, ok := sc.orderBooks[order.Symbol]; ok {
		depthSlip := sc.calculateOrderBookImpact(order, ob)
		totalSlippage = totalSlippage.Add(depthSlip)
		factors = append(factors, SlippageFactor{
			Name:         "depth",
			Contribution: depthSlip,
			Description:  "Order book depth impact",
		})
		estimate.Confidence = 0.85 // Higher confidence with order book data
	}
	
	// 7. Historical adjustment
	historicalAdj := sc.calculateHistoricalAdjustment(order.Symbol)
	if !historicalAdj.IsZero() {
		totalSlippage = totalSlippage.Add(historicalAdj)
		factors = append(factors, SlippageFactor{
			Name:         "historical",
			Contribution: historicalAdj,
			Description:  "Historical slippage adjustment",
		})
		estimate.Confidence = 0.9 // Higher confidence with historical data
	}
	
	// Apply maximum slippage cap
	if totalSlippage.GreaterThan(sc.config.MaxSlippage) {
		totalSlippage = sc.config.MaxSlippage
	}
	
	// Calculate expected fill price
	expectedFillPrice := order.Price
	if order.Side == types.OrderSideBuy {
		expectedFillPrice = order.Price.Mul(decimal.NewFromInt(1).Add(totalSlippage))
	} else {
		expectedFillPrice = order.Price.Mul(decimal.NewFromInt(1).Sub(totalSlippage))
	}
	
	// Calculate market impact
	marketImpact := order.Quantity.Mul(order.Price).Mul(totalSlippage)
	
	// Calculate slippage range
	slippageRange := sc.calculateSlippageRange(totalSlippage, estimate.Confidence)
	
	estimate.ExpectedSlippage = totalSlippage
	estimate.SlippageRange = slippageRange
	estimate.MarketImpact = marketImpact
	estimate.ExpectedFillPrice = expectedFillPrice
	estimate.Factors = factors
	
	// Generate recommendation
	estimate.Recommendation = sc.generateRecommendation(estimate, order)
	
	return estimate
}

// calculateSpreadImpact calculates slippage from bid-ask spread.
func (sc *SlippageCalculator) calculateSpreadImpact(order *types.Order, market MarketData) decimal.Decimal {
	if market.Ask.IsZero() || market.Bid.IsZero() {
		return decimal.Zero
	}
	
	spread := market.Ask.Sub(market.Bid).Div(market.Price)
	
	// Market orders pay full spread, limit orders pay half
	if order.Type == types.OrderTypeMarket {
		return spread
	}
	return spread.Div(decimal.NewFromInt(2))
}

// calculateVolumeImpact calculates market impact from order size.
func (sc *SlippageCalculator) calculateVolumeImpact(order *types.Order, market MarketData) decimal.Decimal {
	if market.Volume24h.IsZero() {
		return decimal.Zero
	}
	
	// Order size as fraction of daily volume
	orderValue := order.Quantity.Mul(order.Price)
	volumeRatio := orderValue.Div(market.Volume24h)
	
	// Square-root market impact model: impact = factor * sqrt(volume_ratio)
	impactBase := sc.config.VolumeImpactFactor
	sqrtRatio := decimal.NewFromFloat(math.Sqrt(volumeRatio.InexactFloat64()))
	
	return impactBase.Mul(sqrtRatio)
}

// calculateVolatilityImpact calculates slippage from market volatility.
func (sc *SlippageCalculator) calculateVolatilityImpact(market MarketData) decimal.Decimal {
	// ATR-based volatility
	if market.ATR.IsZero() || market.Price.IsZero() {
		return decimal.Zero
	}
	
	volatilityPct := market.ATR.Div(market.Price)
	return volatilityPct.Mul(sc.config.VolatilityMultiplier).Div(decimal.NewFromInt(100))
}

// calculateTimeImpact calculates slippage from time of day.
func (sc *SlippageCalculator) calculateTimeImpact() decimal.Decimal {
	hour := time.Now().UTC().Hour()
	
	// Lower liquidity during Asian session for most markets
	if hour >= 0 && hour < 8 {
		return sc.config.BaseSlippage.Mul(sc.config.OffHoursMultiplier.Sub(decimal.NewFromInt(1)))
	}
	
	return decimal.Zero
}

// calculateOrderBookImpact calculates impact based on order book depth.
func (sc *SlippageCalculator) calculateOrderBookImpact(order *types.Order, ob *OrderBook) decimal.Decimal {
	if ob == nil {
		return decimal.Zero
	}
	
	// Select the appropriate side
	var levels []OrderBookLevel
	if order.Side == types.OrderSideBuy {
		levels = ob.Asks
	} else {
		levels = ob.Bids
	}
	
	if len(levels) == 0 {
		return decimal.Zero
	}
	
	// Walk through order book to simulate fill
	remainingQty := order.Quantity
	totalCost := decimal.Zero
	
	for _, level := range levels {
		fillQty := decimal.Min(remainingQty, level.Quantity)
		totalCost = totalCost.Add(fillQty.Mul(level.Price))
		remainingQty = remainingQty.Sub(fillQty)
		
		if remainingQty.LessThanOrEqual(decimal.Zero) {
			break
		}
	}
	
	if order.Quantity.IsZero() {
		return decimal.Zero
	}
	
	// Calculate average fill price
	avgFillPrice := totalCost.Div(order.Quantity.Sub(remainingQty))
	
	// Calculate slippage from best price
	bestPrice := levels[0].Price
	if bestPrice.IsZero() {
		return decimal.Zero
	}
	
	slippage := avgFillPrice.Sub(bestPrice).Div(bestPrice).Abs()
	return slippage
}

// calculateHistoricalAdjustment adjusts based on historical slippage data.
func (sc *SlippageCalculator) calculateHistoricalAdjustment(symbol string) decimal.Decimal {
	records := sc.historicalSlippage[symbol]
	if len(records) < 10 {
		return decimal.Zero
	}
	
	// Calculate recent average slippage
	recentRecords := records
	if len(records) > 100 {
		recentRecords = records[len(records)-100:]
	}
	
	totalSlippage := decimal.Zero
	for _, r := range recentRecords {
		totalSlippage = totalSlippage.Add(r.Slippage)
	}
	
	avgSlippage := totalSlippage.Div(decimal.NewFromInt(int64(len(recentRecords))))
	
	// Return adjustment (difference from base)
	return avgSlippage.Sub(sc.config.BaseSlippage)
}

// calculateSlippageRange calculates the range of possible slippage values.
func (sc *SlippageCalculator) calculateSlippageRange(expected decimal.Decimal, confidence float64) SlippageRange {
	// Standard deviation estimate based on confidence
	stdDev := expected.Mul(decimal.NewFromFloat(1.0 - confidence))
	
	return SlippageRange{
		Min: decimal.Max(decimal.Zero, expected.Sub(stdDev.Mul(decimal.NewFromFloat(2)))),
		Max: expected.Add(stdDev.Mul(decimal.NewFromFloat(3))),
		P50: expected,
		P95: expected.Add(stdDev.Mul(decimal.NewFromFloat(1.645))),
	}
}

// generateRecommendation generates a trading recommendation based on slippage.
func (sc *SlippageCalculator) generateRecommendation(estimate SlippageEstimate, order *types.Order) string {
	// High slippage warning
	if estimate.ExpectedSlippage.GreaterThan(decimal.NewFromFloat(0.01)) { // >1%
		return "High slippage expected. Consider using limit orders or splitting the order."
	}
	
	// Order book impact warning
	for _, factor := range estimate.Factors {
		if factor.Name == "depth" && factor.Contribution.GreaterThan(decimal.NewFromFloat(0.005)) {
			return "Large market impact expected. Consider TWAP execution."
		}
	}
	
	// Volatility warning
	for _, factor := range estimate.Factors {
		if factor.Name == "volatility" && factor.Contribution.GreaterThan(decimal.NewFromFloat(0.003)) {
			return "High volatility detected. Use limit orders for better execution."
		}
	}
	
	// Time of day warning
	for _, factor := range estimate.Factors {
		if factor.Name == "time" && !factor.Contribution.IsZero() {
			return "Trading outside peak hours. Expect wider spreads."
		}
	}
	
	return ""
}

// RecordSlippage records actual slippage from a filled order.
func (sc *SlippageCalculator) RecordSlippage(record SlippageRecord) {
	sc.mu.Lock()
	defer sc.mu.Unlock()
	
	sc.historicalSlippage[record.Symbol] = append(sc.historicalSlippage[record.Symbol], record)
	
	// Limit history size
	if len(sc.historicalSlippage[record.Symbol]) > 1000 {
		sc.historicalSlippage[record.Symbol] = sc.historicalSlippage[record.Symbol][500:]
	}
	
	sc.logger.Debug("Slippage recorded",
		zap.String("symbol", record.Symbol),
		zap.String("slippage", record.Slippage.String()),
		zap.Bool("isMEV", record.IsMEVAttack))
}

// UpdateOrderBook updates the order book for a symbol.
func (sc *SlippageCalculator) UpdateOrderBook(symbol string, ob *OrderBook) {
	sc.mu.Lock()
	defer sc.mu.Unlock()
	
	sc.orderBooks[symbol] = ob
}

// DetectMEVAttack detects potential MEV attacks.
func (sc *SlippageCalculator) DetectMEVAttack(expected, actual decimal.Decimal, blockTime time.Time) (bool, string) {
	if !sc.config.MEVProtectionEnabled {
		return false, ""
	}
	
	slippage := actual.Sub(expected).Div(expected).Abs()
	
	// MEV indicators:
	// 1. Unexpectedly high slippage
	if slippage.GreaterThan(sc.config.MaxMEVSlippage) {
		return true, "Abnormally high slippage detected - possible sandwich attack"
	}
	
	// 2. Price moved significantly right before execution
	// (Would need historical price data to detect)
	
	return false, ""
}

// GetHistoricalSlippage returns historical slippage data for a symbol.
func (sc *SlippageCalculator) GetHistoricalSlippage(symbol string, limit int) []SlippageRecord {
	sc.mu.RLock()
	defer sc.mu.RUnlock()
	
	records := sc.historicalSlippage[symbol]
	if limit <= 0 || limit > len(records) {
		limit = len(records)
	}
	
	result := make([]SlippageRecord, limit)
	copy(result, records[len(records)-limit:])
	return result
}

// GetAverageSlippage returns average slippage for a symbol.
func (sc *SlippageCalculator) GetAverageSlippage(symbol string, period time.Duration) decimal.Decimal {
	sc.mu.RLock()
	defer sc.mu.RUnlock()
	
	records := sc.historicalSlippage[symbol]
	if len(records) == 0 {
		return sc.config.BaseSlippage
	}
	
	cutoff := time.Now().Add(-period)
	var sum decimal.Decimal
	var count int
	
	for _, r := range records {
		if r.Timestamp.After(cutoff) {
			sum = sum.Add(r.Slippage)
			count++
		}
	}
	
	if count == 0 {
		return sc.config.BaseSlippage
	}
	
	return sum.Div(decimal.NewFromInt(int64(count)))
}

// MarketData contains market information for slippage calculation.
type MarketData struct {
	Symbol    string          `json:"symbol"`
	Price     decimal.Decimal `json:"price"`
	Bid       decimal.Decimal `json:"bid"`
	Ask       decimal.Decimal `json:"ask"`
	Volume24h decimal.Decimal `json:"volume24h"`
	ATR       decimal.Decimal `json:"atr"`       // Average True Range
	Liquidity decimal.Decimal `json:"liquidity"` // Available liquidity
}

// OptimalSlippageForExecution calculates optimal slippage tolerance for an order.
func (sc *SlippageCalculator) OptimalSlippageForExecution(order *types.Order, market MarketData, urgency float64) decimal.Decimal {
	estimate := sc.EstimateSlippage(order, market)
	
	// Urgency factor: 0 = patient, 1 = urgent
	// Patient orders use tighter slippage, urgent orders allow more
	urgencyMultiplier := decimal.NewFromFloat(1.0 + urgency)
	
	// Use P95 slippage with urgency adjustment
	optimalSlippage := estimate.SlippageRange.P95.Mul(urgencyMultiplier)
	
	// Cap at maximum
	if optimalSlippage.GreaterThan(sc.config.MaxSlippage) {
		optimalSlippage = sc.config.MaxSlippage
	}
	
	// Minimum slippage floor
	minSlippage := decimal.NewFromFloat(0.001) // 0.1%
	if optimalSlippage.LessThan(minSlippage) {
		optimalSlippage = minSlippage
	}
	
	return optimalSlippage
}
