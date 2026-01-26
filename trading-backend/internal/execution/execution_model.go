// Package execution provides realistic trade execution modeling.
// Based on research: "Backtest results within ±10% of live trading"
// Models: commission, slippage, bid-ask spread, market impact, MEV
package execution

import (
	"math"
	"sync"
	"time"

	"github.com/atlas-desktop/trading-backend/pkg/types"
	"github.com/shopspring/decimal"
	"go.uber.org/zap"
)

// ExecutionModel provides realistic execution cost modeling
type ExecutionModel struct {
	logger *zap.Logger
	config *ExecutionModelConfig

	// Statistics
	mu              sync.RWMutex
	totalSlippage   decimal.Decimal
	totalCommission decimal.Decimal
	totalImpact     decimal.Decimal
	executionCount  int64
	latencies       []int64
}

// ExecutionModelConfig configures the execution model
type ExecutionModelConfig struct {
	// Commission
	CommissionRate decimal.Decimal // Per-trade commission rate (e.g., 0.001 = 0.1%)
	CommissionMin  decimal.Decimal // Minimum commission per trade
	CommissionMax  decimal.Decimal // Maximum commission per trade

	// Slippage
	BaseSlippageBps  decimal.Decimal // Base slippage in basis points
	VolatilityFactor decimal.Decimal // How much volatility increases slippage

	// Bid-Ask Spread
	BaseSpreadBps   decimal.Decimal // Base bid-ask spread in bps
	SpreadVolFactor decimal.Decimal // Spread increase with volatility

	// Market Impact (Almgren-Chriss model)
	PermanentImpact decimal.Decimal // Permanent price impact coefficient
	TemporaryImpact decimal.Decimal // Temporary price impact coefficient
	LinearImpact    decimal.Decimal // Linear component of impact

	// MEV (for crypto)
	MEVEnabled     bool
	MEVProbability decimal.Decimal // Probability of MEV extraction
	MEVImpactBps   decimal.Decimal // Average MEV impact when it occurs

	// Latency
	BaseLatencyMs   int64 // Base execution latency in ms
	LatencyJitterMs int64 // Random latency variation in ms
}

// DefaultExecutionModelConfig returns conservative defaults
func DefaultExecutionModelConfig() *ExecutionModelConfig {
	return &ExecutionModelConfig{
		CommissionRate:   decimal.NewFromFloat(0.001), // 0.1%
		CommissionMin:    decimal.NewFromFloat(0.01),  // $0.01 min
		CommissionMax:    decimal.NewFromFloat(100),   // $100 max
		BaseSlippageBps:  decimal.NewFromFloat(5),     // 5 bps base slippage
		VolatilityFactor: decimal.NewFromFloat(0.5),   // 50% volatility sensitivity
		BaseSpreadBps:    decimal.NewFromFloat(10),    // 10 bps spread
		SpreadVolFactor:  decimal.NewFromFloat(0.3),   // 30% spread vol sensitivity
		PermanentImpact:  decimal.NewFromFloat(0.1),   // Almgren-Chriss gamma
		TemporaryImpact:  decimal.NewFromFloat(0.05),  // Almgren-Chriss eta
		LinearImpact:     decimal.NewFromFloat(0.01),  // Linear impact term
		MEVEnabled:       true,
		MEVProbability:   decimal.NewFromFloat(0.05), // 5% MEV probability
		MEVImpactBps:     decimal.NewFromFloat(50),   // 50 bps MEV impact
		BaseLatencyMs:    50,
		LatencyJitterMs:  20,
	}
}

// CryptoExecutionModelConfig for crypto markets
func CryptoExecutionModelConfig() *ExecutionModelConfig {
	return &ExecutionModelConfig{
		CommissionRate:   decimal.NewFromFloat(0.001), // 0.1% (typical CEX maker)
		CommissionMin:    decimal.Zero,
		CommissionMax:    decimal.NewFromFloat(1000),
		BaseSlippageBps:  decimal.NewFromFloat(10),  // Higher slippage
		VolatilityFactor: decimal.NewFromFloat(1.0), // High vol sensitivity
		BaseSpreadBps:    decimal.NewFromFloat(20),  // Wider spreads
		SpreadVolFactor:  decimal.NewFromFloat(0.5),
		PermanentImpact:  decimal.NewFromFloat(0.2),
		TemporaryImpact:  decimal.NewFromFloat(0.1),
		LinearImpact:     decimal.NewFromFloat(0.02),
		MEVEnabled:       true,
		MEVProbability:   decimal.NewFromFloat(0.10), // 10% MEV on DEX
		MEVImpactBps:     decimal.NewFromFloat(100),  // 1% MEV impact
		BaseLatencyMs:    200,                        // Block time considerations
		LatencyJitterMs:  100,
	}
}

// StockExecutionModelConfig for traditional equities
func StockExecutionModelConfig() *ExecutionModelConfig {
	return &ExecutionModelConfig{
		CommissionRate:   decimal.NewFromFloat(0.0001), // 1 bps
		CommissionMin:    decimal.NewFromFloat(1),      // $1 min
		CommissionMax:    decimal.NewFromFloat(50),
		BaseSlippageBps:  decimal.NewFromFloat(2), // Lower slippage
		VolatilityFactor: decimal.NewFromFloat(0.3),
		BaseSpreadBps:    decimal.NewFromFloat(5), // Tighter spreads
		SpreadVolFactor:  decimal.NewFromFloat(0.2),
		PermanentImpact:  decimal.NewFromFloat(0.05),
		TemporaryImpact:  decimal.NewFromFloat(0.02),
		LinearImpact:     decimal.NewFromFloat(0.005),
		MEVEnabled:       false, // No MEV in stocks
		MEVProbability:   decimal.Zero,
		MEVImpactBps:     decimal.Zero,
		BaseLatencyMs:    10, // Faster execution
		LatencyJitterMs:  5,
	}
}

// NewExecutionModel creates a new execution model
func NewExecutionModel(logger *zap.Logger, config *ExecutionModelConfig) *ExecutionModel {
	if config == nil {
		config = DefaultExecutionModelConfig()
	}
	return &ExecutionModel{
		logger:    logger,
		config:    config,
		latencies: make([]int64, 0, 1000),
	}
}

// ExecutionResult contains the result of execution modeling
type ExecutionResult struct {
	FillPrice    decimal.Decimal `json:"fill_price"`
	Commission   decimal.Decimal `json:"commission"`
	Slippage     decimal.Decimal `json:"slippage"`
	Spread       decimal.Decimal `json:"spread"`
	MarketImpact decimal.Decimal `json:"market_impact"`
	MEVCost      decimal.Decimal `json:"mev_cost"`
	TotalCost    decimal.Decimal `json:"total_cost"`
	TotalCostBps decimal.Decimal `json:"total_cost_bps"`
	LatencyMs    int64           `json:"latency_ms"`
	ExecutedAt   time.Time       `json:"executed_at"`
}

// MarketContext provides market data for execution modeling
type MarketContext struct {
	Symbol        string
	Price         decimal.Decimal // Current mid price
	BidPrice      decimal.Decimal // Best bid
	AskPrice      decimal.Decimal // Best ask
	Volume        decimal.Decimal // Recent volume (for impact calc)
	Volatility    decimal.Decimal // Recent volatility (annualized)
	OrderBookBids []types.OrderBookLevel
	OrderBookAsks []types.OrderBookLevel
}

// SimulateExecution models realistic execution costs
func (em *ExecutionModel) SimulateExecution(
	order *types.Order,
	market *MarketContext,
) *ExecutionResult {
	startTime := time.Now()

	result := &ExecutionResult{
		ExecutedAt: startTime,
	}

	// 1. Calculate commission
	result.Commission = em.calculateCommission(order, market)

	// 2. Calculate spread cost
	result.Spread = em.calculateSpreadCost(order, market)

	// 3. Calculate slippage
	result.Slippage = em.calculateSlippage(order, market)

	// 4. Calculate market impact (Almgren-Chriss model)
	result.MarketImpact = em.calculateMarketImpact(order, market)

	// 5. Calculate MEV cost (for crypto)
	result.MEVCost = em.calculateMEVCost(order, market)

	// 6. Calculate total cost
	result.TotalCost = result.Commission.Add(result.Spread).
		Add(result.Slippage).Add(result.MarketImpact).Add(result.MEVCost)

	// 7. Calculate total cost in basis points
	if !market.Price.IsZero() && !order.Quantity.IsZero() {
		notional := market.Price.Mul(order.Quantity)
		if !notional.IsZero() {
			result.TotalCostBps = result.TotalCost.Div(notional).Mul(decimal.NewFromInt(10000))
		}
	}

	// 8. Calculate fill price
	result.FillPrice = em.calculateFillPrice(order, market, result)

	// 9. Simulate latency
	result.LatencyMs = em.simulateLatency()

	// Update statistics
	em.updateStats(result)

	return result
}

// calculateCommission computes trade commission
func (em *ExecutionModel) calculateCommission(order *types.Order, market *MarketContext) decimal.Decimal {
	notional := market.Price.Mul(order.Quantity)
	commission := notional.Mul(em.config.CommissionRate)

	// Apply min/max bounds
	if commission.LessThan(em.config.CommissionMin) {
		commission = em.config.CommissionMin
	}
	if commission.GreaterThan(em.config.CommissionMax) {
		commission = em.config.CommissionMax
	}

	return commission
}

// calculateSpreadCost computes bid-ask spread cost
func (em *ExecutionModel) calculateSpreadCost(order *types.Order, market *MarketContext) decimal.Decimal {
	// Use actual spread if available
	var spreadBps decimal.Decimal

	if !market.BidPrice.IsZero() && !market.AskPrice.IsZero() {
		actualSpread := market.AskPrice.Sub(market.BidPrice)
		midPrice := market.BidPrice.Add(market.AskPrice).Div(decimal.NewFromInt(2))
		if !midPrice.IsZero() {
			spreadBps = actualSpread.Div(midPrice).Mul(decimal.NewFromInt(10000))
		}
	} else {
		// Use base spread with volatility adjustment
		spreadBps = em.config.BaseSpreadBps
		if !market.Volatility.IsZero() {
			volAdjustment := market.Volatility.Mul(em.config.SpreadVolFactor)
			spreadBps = spreadBps.Mul(decimal.NewFromInt(1).Add(volAdjustment))
		}
	}

	// Spread cost is half the spread (crossing the spread)
	halfSpreadBps := spreadBps.Div(decimal.NewFromInt(2))
	notional := market.Price.Mul(order.Quantity)

	return notional.Mul(halfSpreadBps).Div(decimal.NewFromInt(10000))
}

// calculateSlippage computes price slippage
func (em *ExecutionModel) calculateSlippage(order *types.Order, market *MarketContext) decimal.Decimal {
	slippageBps := em.config.BaseSlippageBps

	// Adjust for volatility
	if !market.Volatility.IsZero() {
		volAdjustment := market.Volatility.Mul(em.config.VolatilityFactor)
		slippageBps = slippageBps.Mul(decimal.NewFromInt(1).Add(volAdjustment))
	}

	// Adjust for order size relative to volume
	if !market.Volume.IsZero() {
		participation := order.Quantity.Div(market.Volume)
		participationFloat, _ := participation.Float64()

		// Square root impact
		if participationFloat > 0 {
			sqrtParticipation := decimal.NewFromFloat(math.Sqrt(participationFloat))
			slippageBps = slippageBps.Mul(decimal.NewFromInt(1).Add(sqrtParticipation))
		}
	}

	notional := market.Price.Mul(order.Quantity)
	return notional.Mul(slippageBps).Div(decimal.NewFromInt(10000))
}

// calculateMarketImpact implements Almgren-Chriss market impact model
// Impact = gamma * sigma * sqrt(V/T) + eta * V/T
// gamma = permanent impact, eta = temporary impact
// V = order volume, T = average daily volume, sigma = volatility
func (em *ExecutionModel) calculateMarketImpact(order *types.Order, market *MarketContext) decimal.Decimal {
	if market.Volume.IsZero() {
		return decimal.Zero
	}

	// Participation rate
	participation := order.Quantity.Div(market.Volume)
	participationFloat, _ := participation.Float64()

	if participationFloat <= 0 {
		return decimal.Zero
	}

	// Volatility
	volFloat, _ := market.Volatility.Float64()
	if volFloat <= 0 {
		volFloat = 0.20 // Default 20% annual vol
	}

	// Permanent impact: gamma * sigma * sqrt(participation)
	gammaFloat, _ := em.config.PermanentImpact.Float64()
	permanentImpact := gammaFloat * volFloat * math.Sqrt(participationFloat)

	// Temporary impact: eta * participation
	etaFloat, _ := em.config.TemporaryImpact.Float64()
	temporaryImpact := etaFloat * participationFloat

	// Linear impact: linear * participation
	linearFloat, _ := em.config.LinearImpact.Float64()
	linearImpact := linearFloat * participationFloat

	// Total impact
	totalImpact := permanentImpact + temporaryImpact + linearImpact

	notional := market.Price.Mul(order.Quantity)
	return notional.Mul(decimal.NewFromFloat(totalImpact))
}

// calculateMEVCost estimates MEV extraction cost (for crypto)
func (em *ExecutionModel) calculateMEVCost(order *types.Order, market *MarketContext) decimal.Decimal {
	if !em.config.MEVEnabled {
		return decimal.Zero
	}

	// Probabilistic MEV: probability * impact
	mevProbFloat, _ := em.config.MEVProbability.Float64()

	// Simple random check (in production, use proper randomness)
	// For backtesting, we use expected value
	expectedMEVProb := decimal.NewFromFloat(mevProbFloat)

	notional := market.Price.Mul(order.Quantity)
	mevImpact := notional.Mul(em.config.MEVImpactBps).Div(decimal.NewFromInt(10000))

	return mevImpact.Mul(expectedMEVProb)
}

// calculateFillPrice computes the actual fill price including all costs
func (em *ExecutionModel) calculateFillPrice(
	order *types.Order,
	market *MarketContext,
	result *ExecutionResult,
) decimal.Decimal {
	basePrice := market.Price

	// Use bid/ask if available
	if order.Side == types.OrderSideBuy && !market.AskPrice.IsZero() {
		basePrice = market.AskPrice
	} else if order.Side == types.OrderSideSell && !market.BidPrice.IsZero() {
		basePrice = market.BidPrice
	}

	// Calculate price impact as percentage
	notional := basePrice.Mul(order.Quantity)
	if notional.IsZero() {
		return basePrice
	}

	// Total execution costs (excluding commission which is separate)
	executionCosts := result.Slippage.Add(result.MarketImpact).Add(result.MEVCost)
	costRatio := executionCosts.Div(notional)

	// Adjust fill price
	if order.Side == types.OrderSideBuy {
		// Buying: price goes up
		return basePrice.Mul(decimal.NewFromInt(1).Add(costRatio))
	}
	// Selling: price goes down (we get less)
	return basePrice.Mul(decimal.NewFromInt(1).Sub(costRatio))
}

// simulateLatency generates realistic execution latency
func (em *ExecutionModel) simulateLatency() int64 {
	base := em.config.BaseLatencyMs
	jitter := em.config.LatencyJitterMs

	// Simple jitter (in production, use proper random distribution)
	// For deterministic backtesting, just use base + half jitter
	return base + jitter/2
}

// updateStats updates execution statistics
func (em *ExecutionModel) updateStats(result *ExecutionResult) {
	em.mu.Lock()
	defer em.mu.Unlock()

	em.totalSlippage = em.totalSlippage.Add(result.Slippage)
	em.totalCommission = em.totalCommission.Add(result.Commission)
	em.totalImpact = em.totalImpact.Add(result.MarketImpact)
	em.executionCount++

	em.latencies = append(em.latencies, result.LatencyMs)
	if len(em.latencies) > 10000 {
		em.latencies = em.latencies[5000:]
	}
}

// GetStats returns execution statistics
func (em *ExecutionModel) GetStats() ExecutionStats {
	em.mu.RLock()
	defer em.mu.RUnlock()

	stats := ExecutionStats{
		ExecutionCount:    em.executionCount,
		TotalSlippage:     em.totalSlippage,
		TotalCommission:   em.totalCommission,
		TotalMarketImpact: em.totalImpact,
	}

	if em.executionCount > 0 {
		count := decimal.NewFromInt(em.executionCount)
		stats.AvgSlippage = em.totalSlippage.Div(count)
		stats.AvgCommission = em.totalCommission.Div(count)
		stats.AvgMarketImpact = em.totalImpact.Div(count)
	}

	// Calculate latency stats
	if len(em.latencies) > 0 {
		var total int64
		for _, l := range em.latencies {
			total += l
		}
		stats.AvgLatencyMs = total / int64(len(em.latencies))
		stats.P99LatencyMs = em.calculateP99Latency()
	}

	return stats
}

// calculateP99Latency computes 99th percentile latency
func (em *ExecutionModel) calculateP99Latency() int64 {
	if len(em.latencies) == 0 {
		return 0
	}

	// Copy and sort
	sorted := make([]int64, len(em.latencies))
	copy(sorted, em.latencies)

	// Simple sort (in production, use a proper sorting algorithm)
	for i := 0; i < len(sorted); i++ {
		for j := i + 1; j < len(sorted); j++ {
			if sorted[j] < sorted[i] {
				sorted[i], sorted[j] = sorted[j], sorted[i]
			}
		}
	}

	idx := int(float64(len(sorted)) * 0.99)
	if idx >= len(sorted) {
		idx = len(sorted) - 1
	}

	return sorted[idx]
}

// ExecutionStats contains aggregated execution statistics
type ExecutionStats struct {
	ExecutionCount    int64           `json:"execution_count"`
	TotalSlippage     decimal.Decimal `json:"total_slippage"`
	TotalCommission   decimal.Decimal `json:"total_commission"`
	TotalMarketImpact decimal.Decimal `json:"total_market_impact"`
	AvgSlippage       decimal.Decimal `json:"avg_slippage"`
	AvgCommission     decimal.Decimal `json:"avg_commission"`
	AvgMarketImpact   decimal.Decimal `json:"avg_market_impact"`
	AvgLatencyMs      int64           `json:"avg_latency_ms"`
	P99LatencyMs      int64           `json:"p99_latency_ms"`
}

// CostBreakdown provides a summary of execution costs
func (em *ExecutionModel) CostBreakdown(orders []*types.Order, market *MarketContext) *CostBreakdownReport {
	report := &CostBreakdownReport{
		Orders: make([]OrderCostBreakdown, len(orders)),
	}

	for i, order := range orders {
		result := em.SimulateExecution(order, market)

		report.Orders[i] = OrderCostBreakdown{
			OrderID:      order.ID,
			Symbol:       order.Symbol,
			Side:         string(order.Side),
			Quantity:     order.Quantity,
			Commission:   result.Commission,
			Slippage:     result.Slippage,
			Spread:       result.Spread,
			MarketImpact: result.MarketImpact,
			MEVCost:      result.MEVCost,
			TotalCost:    result.TotalCost,
			TotalCostBps: result.TotalCostBps,
			FillPrice:    result.FillPrice,
		}

		report.TotalCommission = report.TotalCommission.Add(result.Commission)
		report.TotalSlippage = report.TotalSlippage.Add(result.Slippage)
		report.TotalSpread = report.TotalSpread.Add(result.Spread)
		report.TotalMarketImpact = report.TotalMarketImpact.Add(result.MarketImpact)
		report.TotalMEVCost = report.TotalMEVCost.Add(result.MEVCost)
		report.TotalCost = report.TotalCost.Add(result.TotalCost)
	}

	return report
}

// CostBreakdownReport contains execution cost analysis
type CostBreakdownReport struct {
	Orders            []OrderCostBreakdown `json:"orders"`
	TotalCommission   decimal.Decimal      `json:"total_commission"`
	TotalSlippage     decimal.Decimal      `json:"total_slippage"`
	TotalSpread       decimal.Decimal      `json:"total_spread"`
	TotalMarketImpact decimal.Decimal      `json:"total_market_impact"`
	TotalMEVCost      decimal.Decimal      `json:"total_mev_cost"`
	TotalCost         decimal.Decimal      `json:"total_cost"`
}

// OrderCostBreakdown contains per-order cost analysis
type OrderCostBreakdown struct {
	OrderID      string          `json:"order_id"`
	Symbol       string          `json:"symbol"`
	Side         string          `json:"side"`
	Quantity     decimal.Decimal `json:"quantity"`
	Commission   decimal.Decimal `json:"commission"`
	Slippage     decimal.Decimal `json:"slippage"`
	Spread       decimal.Decimal `json:"spread"`
	MarketImpact decimal.Decimal `json:"market_impact"`
	MEVCost      decimal.Decimal `json:"mev_cost"`
	TotalCost    decimal.Decimal `json:"total_cost"`
	TotalCostBps decimal.Decimal `json:"total_cost_bps"`
	FillPrice    decimal.Decimal `json:"fill_price"`
}
