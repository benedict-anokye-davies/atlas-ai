// Package backtester provides slippage modeling for backtesting.
package backtester

import (
	"math"

	"github.com/atlas-desktop/trading-backend/internal/backtester/events"
	"github.com/atlas-desktop/trading-backend/pkg/types"
	"github.com/shopspring/decimal"
)

// SlippageModel interface for different slippage models
type SlippageModel interface {
	Calculate(order *types.Order, marketData *events.MarketDataEvent) decimal.Decimal
}

// FixedSlippage applies a fixed percentage slippage
type FixedSlippage struct {
	BasisPoints decimal.Decimal
}

// NewFixedSlippage creates a fixed slippage model
func NewFixedSlippage(bps decimal.Decimal) *FixedSlippage {
	return &FixedSlippage{BasisPoints: bps}
}

// Calculate returns fixed slippage
func (f *FixedSlippage) Calculate(order *types.Order, marketData *events.MarketDataEvent) decimal.Decimal {
	return f.BasisPoints.Div(decimal.NewFromInt(10000))
}

// VolumeWeightedSlippage models slippage based on order size relative to volume
type VolumeWeightedSlippage struct {
	BaseSlippage  decimal.Decimal // Base slippage in bps
	ImpactFactor  decimal.Decimal // Market impact multiplier
	VolumeFrac    decimal.Decimal // Max volume participation
}

// NewVolumeWeightedSlippage creates a volume-weighted slippage model
func NewVolumeWeightedSlippage(baseBps, impactFactor, volumeFrac decimal.Decimal) *VolumeWeightedSlippage {
	return &VolumeWeightedSlippage{
		BaseSlippage: baseBps,
		ImpactFactor: impactFactor,
		VolumeFrac:   volumeFrac,
	}
}

// Calculate returns slippage based on order size relative to volume
func (v *VolumeWeightedSlippage) Calculate(order *types.Order, marketData *events.MarketDataEvent) decimal.Decimal {
	baseSlip := v.BaseSlippage.Div(decimal.NewFromInt(10000))
	
	if marketData.OHLCV == nil || marketData.OHLCV.Volume.IsZero() {
		return baseSlip
	}
	
	// Calculate participation rate
	participation := order.Quantity.Div(marketData.OHLCV.Volume)
	
	// Square root impact model: impact = k * sqrt(participation)
	participationFloat, _ := participation.Float64()
	sqrtParticipation := decimal.NewFromFloat(math.Sqrt(participationFloat))
	
	impact := v.ImpactFactor.Mul(sqrtParticipation)
	
	return baseSlip.Add(impact)
}

// OrderBookSlippage models slippage using simulated order book depth
type OrderBookSlippage struct {
	DepthLevels   int             // Number of price levels
	AvgDepthBps   decimal.Decimal // Average depth at each level in bps
	SpreadBps     decimal.Decimal // Bid-ask spread in bps
}

// NewOrderBookSlippage creates an order book slippage model
func NewOrderBookSlippage(levels int, avgDepthBps, spreadBps decimal.Decimal) *OrderBookSlippage {
	return &OrderBookSlippage{
		DepthLevels: levels,
		AvgDepthBps: avgDepthBps,
		SpreadBps:   spreadBps,
	}
}

// Calculate returns slippage based on simulated order book traversal
func (o *OrderBookSlippage) Calculate(order *types.Order, marketData *events.MarketDataEvent) decimal.Decimal {
	if marketData.OrderBook != nil {
		// Use actual order book data
		return o.calculateFromOrderBook(order, marketData.OrderBook)
	}
	
	// Simulate order book
	spread := o.SpreadBps.Div(decimal.NewFromInt(10000))
	halfSpread := spread.Div(decimal.NewFromFloat(2))
	
	// Start with half spread as minimum slippage
	slippage := halfSpread
	
	// Add depth-based slippage
	if marketData.OHLCV != nil && !marketData.OHLCV.Volume.IsZero() {
		// Estimate how many levels we need to traverse
		avgLevelSize := marketData.OHLCV.Volume.Div(decimal.NewFromInt(int64(o.DepthLevels)))
		
		if !avgLevelSize.IsZero() {
			levelsNeeded := order.Quantity.Div(avgLevelSize)
			levelsFloat, _ := levelsNeeded.Float64()
			
			// Each level adds avgDepthBps slippage
			additionalSlip := o.AvgDepthBps.Mul(decimal.NewFromFloat(math.Min(levelsFloat, float64(o.DepthLevels))))
			additionalSlip = additionalSlip.Div(decimal.NewFromInt(10000))
			
			slippage = slippage.Add(additionalSlip)
		}
	}
	
	return slippage
}

// calculateFromOrderBook calculates slippage from actual order book data
func (o *OrderBookSlippage) calculateFromOrderBook(order *types.Order, book *events.OrderBookUpdate) decimal.Decimal {
	var levels []events.PriceLevel
	
	if order.Side == types.OrderSideBuy {
		levels = book.Asks
	} else {
		levels = book.Bids
	}
	
	if len(levels) == 0 {
		return decimal.NewFromFloat(0.001) // Default 0.1%
	}
	
	// Traverse order book to fill order
	remaining := order.Quantity
	var totalCost decimal.Decimal
	midPrice := levels[0].Price
	
	for _, level := range levels {
		if remaining.LessThanOrEqual(decimal.Zero) {
			break
		}
		
		fillQty := decimal.Min(remaining, level.Quantity)
		totalCost = totalCost.Add(fillQty.Mul(level.Price))
		remaining = remaining.Sub(fillQty)
	}
	
	if remaining.GreaterThan(decimal.Zero) {
		// Not enough liquidity - assume worst price
		lastPrice := levels[len(levels)-1].Price
		extraSlip := lastPrice.Mul(decimal.NewFromFloat(0.01)) // 1% per unit unfilled
		totalCost = totalCost.Add(remaining.Mul(lastPrice.Add(extraSlip)))
	}
	
	// Calculate average fill price
	avgPrice := totalCost.Div(order.Quantity)
	
	// Slippage = (avgPrice - midPrice) / midPrice
	slippage := avgPrice.Sub(midPrice).Div(midPrice).Abs()
	
	return slippage
}

// MEVAwareSlippage models slippage including MEV attack detection
type MEVAwareSlippage struct {
	BaseModel       SlippageModel
	MEVMultiplier   decimal.Decimal // Multiplier when MEV is detected
	SandwichBuffer  decimal.Decimal // Additional buffer for sandwich attacks
}

// NewMEVAwareSlippage creates an MEV-aware slippage model
func NewMEVAwareSlippage(baseModel SlippageModel, mevMultiplier, sandwichBuffer decimal.Decimal) *MEVAwareSlippage {
	return &MEVAwareSlippage{
		BaseModel:      baseModel,
		MEVMultiplier:  mevMultiplier,
		SandwichBuffer: sandwichBuffer,
	}
}

// Calculate returns slippage accounting for potential MEV
func (m *MEVAwareSlippage) Calculate(order *types.Order, marketData *events.MarketDataEvent) decimal.Decimal {
	baseSlip := m.BaseModel.Calculate(order, marketData)
	
	// Check for MEV indicators in recent mempool events
	// This would be implemented with actual mempool data
	isMEVLikely := m.detectPotentialMEV(order, marketData)
	
	if isMEVLikely {
		// Apply MEV multiplier
		baseSlip = baseSlip.Mul(m.MEVMultiplier)
		
		// Add sandwich attack buffer
		baseSlip = baseSlip.Add(m.SandwichBuffer.Div(decimal.NewFromInt(10000)))
	}
	
	return baseSlip
}

// detectPotentialMEV checks for MEV attack indicators
func (m *MEVAwareSlippage) detectPotentialMEV(order *types.Order, marketData *events.MarketDataEvent) bool {
	// In production, this would:
	// 1. Check mempool for similar pending transactions
	// 2. Look for known MEV bot addresses
	// 3. Analyze recent block patterns
	// 4. Check gas price anomalies
	
	// For simulation, use heuristics:
	// - Large orders are more likely to be sandwiched
	if marketData.OHLCV != nil && !marketData.OHLCV.Volume.IsZero() {
		participation := order.Quantity.Div(marketData.OHLCV.Volume)
		// Orders > 1% of volume are MEV targets
		if participation.GreaterThan(decimal.NewFromFloat(0.01)) {
			return true
		}
	}
	
	return false
}

// CreateSlippageModel creates a slippage model from config
func CreateSlippageModel(config types.SlippageConfig) SlippageModel {
	switch config.Model {
	case "fixed":
		return NewFixedSlippage(config.FixedBps)
	case "volume_weighted":
		return NewVolumeWeightedSlippage(
			config.FixedBps,
			config.ImpactFactor,
			config.VolumeFraction,
		)
	case "orderbook":
		return NewOrderBookSlippage(10, decimal.NewFromFloat(0.5), decimal.NewFromFloat(1))
	default:
		// Default to 10 bps fixed
		return NewFixedSlippage(decimal.NewFromInt(10))
	}
}
