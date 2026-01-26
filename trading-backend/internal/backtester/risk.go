// Package backtester provides risk management for backtesting.
package backtester

import (
	"sync"

	"github.com/atlas-desktop/trading-backend/internal/backtester/events"
	"github.com/atlas-desktop/trading-backend/pkg/types"
	"github.com/shopspring/decimal"
	"go.uber.org/zap"
)

// RiskManager monitors and enforces risk limits
type RiskManager struct {
	mu              sync.RWMutex
	logger          *zap.Logger
	limits          *types.RiskLimits
	peakEquity      decimal.Decimal
	dailyStartEquity decimal.Decimal
	consecutiveLosses int
	killSwitchActive bool
}

// NewRiskManager creates a new risk manager
func NewRiskManager(logger *zap.Logger, limits *types.RiskLimits) *RiskManager {
	return &RiskManager{
		logger: logger,
		limits: limits,
	}
}

// SetPeakEquity sets the peak equity for drawdown calculation
func (rm *RiskManager) SetPeakEquity(equity decimal.Decimal) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	rm.peakEquity = equity
}

// SetDailyStartEquity sets the starting equity for daily loss calculation
func (rm *RiskManager) SetDailyStartEquity(equity decimal.Decimal) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	rm.dailyStartEquity = equity
}

// RecordLoss records a losing trade
func (rm *RiskManager) RecordLoss() {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	rm.consecutiveLosses++
}

// RecordWin records a winning trade
func (rm *RiskManager) RecordWin() {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	rm.consecutiveLosses = 0
}

// IsKillSwitchActive returns whether the kill switch is active
func (rm *RiskManager) IsKillSwitchActive() bool {
	rm.mu.RLock()
	defer rm.mu.RUnlock()
	return rm.killSwitchActive
}

// Check checks risk limits and returns a risk event if breached
func (rm *RiskManager) Check(portfolio *Portfolio) events.Event {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	
	if rm.killSwitchActive {
		return nil
	}
	
	equity := portfolio.GetEquity()
	
	// Check max drawdown
	if !rm.peakEquity.IsZero() {
		drawdown := rm.peakEquity.Sub(equity).Div(rm.peakEquity)
		if drawdown.GreaterThan(rm.limits.MaxDrawdown) {
			rm.killSwitchActive = true
			return &events.KillSwitchEvent{
				BaseEvent: events.BaseEvent{
					Type:     events.EventTypeKillSwitch,
					Priority: 0, // Highest priority
				},
				Reason:      "Maximum drawdown exceeded",
				TriggerType: "max_drawdown",
				Threshold:   rm.limits.MaxDrawdown,
				Current:     drawdown,
			}
		}
	}
	
	// Check daily loss
	if !rm.dailyStartEquity.IsZero() {
		dailyLoss := rm.dailyStartEquity.Sub(equity).Div(rm.dailyStartEquity)
		if dailyLoss.GreaterThan(rm.limits.MaxDailyLoss) {
			rm.killSwitchActive = true
			return &events.KillSwitchEvent{
				BaseEvent: events.BaseEvent{
					Type:     events.EventTypeKillSwitch,
					Priority: 0,
				},
				Reason:      "Maximum daily loss exceeded",
				TriggerType: "max_daily_loss",
				Threshold:   rm.limits.MaxDailyLoss,
				Current:     dailyLoss,
			}
		}
	}
	
	// Update peak equity
	if equity.GreaterThan(rm.peakEquity) {
		rm.peakEquity = equity
	}
	
	return nil
}

// AllowSignal checks if a signal is allowed based on risk limits
func (rm *RiskManager) AllowSignal(signal *types.Signal, portfolio *Portfolio) bool {
	rm.mu.RLock()
	defer rm.mu.RUnlock()
	
	if rm.killSwitchActive {
		return false
	}
	
	// Check max open positions
	positions := portfolio.GetPositions()
	if len(positions) >= rm.limits.MaxOpenPositions {
		// Only allow if closing existing position
		if signal.Type != types.SignalTypeExit {
			rm.logger.Debug("Signal rejected: max open positions reached")
			return false
		}
	}
	
	return true
}

// AllowOrder checks if an order is allowed based on risk limits
func (rm *RiskManager) AllowOrder(order *types.Order, portfolio *Portfolio) bool {
	rm.mu.RLock()
	defer rm.mu.RUnlock()
	
	if rm.killSwitchActive {
		return false
	}
	
	equity := portfolio.GetEquity()
	
	// Check position size limit
	orderValue := order.Quantity.Mul(order.Price)
	if !order.Price.IsZero() && !equity.IsZero() {
		positionPct := orderValue.Div(equity)
		if positionPct.GreaterThan(rm.limits.MaxPositionSize) {
			rm.logger.Debug("Order rejected: position size too large",
				zap.String("positionPct", positionPct.String()),
				zap.String("limit", rm.limits.MaxPositionSize.String()),
			)
			return false
		}
	}
	
	return true
}

// CalculatePositionSize calculates appropriate position size based on risk
func (rm *RiskManager) CalculatePositionSize(
	signal *types.Signal,
	portfolio *Portfolio,
	method string,
) decimal.Decimal {
	rm.mu.RLock()
	defer rm.mu.RUnlock()
	
	equity := portfolio.GetEquity()
	
	switch method {
	case "fixed_fractional":
		return rm.fixedFractionalSize(equity, signal)
	case "kelly":
		return rm.kellySize(equity, signal)
	case "volatility":
		return rm.volatilityAdjustedSize(equity, signal)
	default:
		return rm.fixedFractionalSize(equity, signal)
	}
}

// fixedFractionalSize calculates position size using fixed fractional method
func (rm *RiskManager) fixedFractionalSize(equity decimal.Decimal, signal *types.Signal) decimal.Decimal {
	// Risk 2% of equity per trade
	riskPct := decimal.NewFromFloat(0.02)
	riskAmount := equity.Mul(riskPct)
	
	if signal.Price.IsZero() {
		return decimal.Zero
	}
	
	// Assume 5% stop loss
	stopPct := decimal.NewFromFloat(0.05)
	riskPerUnit := signal.Price.Mul(stopPct)
	
	if riskPerUnit.IsZero() {
		return decimal.Zero
	}
	
	positionSize := riskAmount.Div(riskPerUnit)
	
	// Apply max position size limit
	maxPositionValue := equity.Mul(rm.limits.MaxPositionSize)
	maxUnits := maxPositionValue.Div(signal.Price)
	
	if positionSize.GreaterThan(maxUnits) {
		return maxUnits
	}
	
	return positionSize
}

// kellySize calculates position size using Kelly Criterion
func (rm *RiskManager) kellySize(equity decimal.Decimal, signal *types.Signal) decimal.Decimal {
	// Kelly formula: f* = (bp - q) / b
	// Where: b = odds (win/loss ratio), p = win probability, q = 1-p
	
	// Use signal confidence as win probability estimate
	winProb := signal.Confidence
	if winProb.IsZero() {
		winProb = decimal.NewFromFloat(0.5)
	}
	
	// Assume 1.5:1 reward/risk ratio
	odds := decimal.NewFromFloat(1.5)
	
	lossProb := decimal.NewFromFloat(1).Sub(winProb)
	kelly := odds.Mul(winProb).Sub(lossProb).Div(odds)
	
	// Half Kelly for safety
	kelly = kelly.Div(decimal.NewFromFloat(2))
	
	// Clamp to reasonable range [0, 0.25]
	if kelly.LessThan(decimal.Zero) {
		return decimal.Zero
	}
	if kelly.GreaterThan(decimal.NewFromFloat(0.25)) {
		kelly = decimal.NewFromFloat(0.25)
	}
	
	positionValue := equity.Mul(kelly)
	
	if signal.Price.IsZero() {
		return decimal.Zero
	}
	
	return positionValue.Div(signal.Price)
}

// volatilityAdjustedSize calculates position size based on volatility
func (rm *RiskManager) volatilityAdjustedSize(equity decimal.Decimal, signal *types.Signal) decimal.Decimal {
	// Get ATR from signal indicators if available
	atrRaw, ok := signal.Indicators["atr"]
	if !ok {
		// Fall back to fixed fractional
		return rm.fixedFractionalSize(equity, signal)
	}
	
	atr, ok := atrRaw.(float64)
	if !ok {
		return rm.fixedFractionalSize(equity, signal)
	}
	
	atrDecimal := decimal.NewFromFloat(atr)
	
	// Risk 2% of equity
	riskAmount := equity.Mul(decimal.NewFromFloat(0.02))
	
	// Position size = Risk / (2 * ATR)
	if atrDecimal.IsZero() {
		return decimal.Zero
	}
	
	positionSize := riskAmount.Div(atrDecimal.Mul(decimal.NewFromFloat(2)))
	
	// Apply limits
	if signal.Price.IsZero() {
		return decimal.Zero
	}
	
	maxPositionValue := equity.Mul(rm.limits.MaxPositionSize)
	maxUnits := maxPositionValue.Div(signal.Price)
	
	if positionSize.GreaterThan(maxUnits) {
		return maxUnits
	}
	
	return positionSize
}

// Reset resets the risk manager state
func (rm *RiskManager) Reset() {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	
	rm.peakEquity = decimal.Zero
	rm.dailyStartEquity = decimal.Zero
	rm.consecutiveLosses = 0
	rm.killSwitchActive = false
}

// GetMetrics returns current risk metrics
func (rm *RiskManager) GetMetrics(portfolio *Portfolio) map[string]interface{} {
	rm.mu.RLock()
	defer rm.mu.RUnlock()
	
	equity := portfolio.GetEquity()
	
	var drawdown decimal.Decimal
	if !rm.peakEquity.IsZero() {
		drawdown = rm.peakEquity.Sub(equity).Div(rm.peakEquity)
	}
	
	var dailyLoss decimal.Decimal
	if !rm.dailyStartEquity.IsZero() {
		dailyLoss = rm.dailyStartEquity.Sub(equity).Div(rm.dailyStartEquity)
	}
	
	return map[string]interface{}{
		"currentDrawdown":   drawdown.String(),
		"maxDrawdownLimit":  rm.limits.MaxDrawdown.String(),
		"dailyLoss":         dailyLoss.String(),
		"maxDailyLossLimit": rm.limits.MaxDailyLoss.String(),
		"consecutiveLosses": rm.consecutiveLosses,
		"killSwitchActive":  rm.killSwitchActive,
		"peakEquity":        rm.peakEquity.String(),
	}
}
