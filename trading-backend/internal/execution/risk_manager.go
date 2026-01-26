// Package execution provides risk management capabilities.
package execution

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/atlas-desktop/trading-backend/pkg/types"
	"github.com/shopspring/decimal"
	"go.uber.org/zap"
)

// RiskManager manages trading risk.
type RiskManager struct {
	logger       *zap.Logger
	config       RiskConfig
	mu           sync.RWMutex
	
	// State tracking
	dailyPnL           decimal.Decimal
	dailyTrades        int
	dailyVolume        decimal.Decimal
	consecutiveLosses  int
	totalExposure      decimal.Decimal
	symbolExposure     map[string]decimal.Decimal
	correlatedExposure map[string]decimal.Decimal
	
	// Risk tracking
	violations    []RiskViolation
	isDisabled    bool
	disabledUntil time.Time
	
	// Events
	riskEvents chan RiskEvent
}

// RiskConfig contains risk management configuration.
type RiskConfig struct {
	// Position limits
	MaxPositionSize      decimal.Decimal `json:"maxPositionSize"`      // Max size per position
	MaxPositionValue     decimal.Decimal `json:"maxPositionValue"`     // Max value per position
	MaxTotalExposure     decimal.Decimal `json:"maxTotalExposure"`     // Max total exposure
	MaxSymbolExposure    decimal.Decimal `json:"maxSymbolExposure"`    // Max exposure per symbol
	MaxCorrelatedExposure decimal.Decimal `json:"maxCorrelatedExposure"` // Max correlated exposure
	
	// Loss limits
	MaxDailyLoss         decimal.Decimal `json:"maxDailyLoss"`         // Max daily loss
	MaxWeeklyLoss        decimal.Decimal `json:"maxWeeklyLoss"`        // Max weekly loss
	MaxDrawdown          decimal.Decimal `json:"maxDrawdown"`          // Max drawdown percentage
	MaxConsecutiveLosses int             `json:"maxConsecutiveLosses"` // Max consecutive losses
	
	// Trade limits
	MaxDailyTrades       int             `json:"maxDailyTrades"`       // Max trades per day
	MaxDailyVolume       decimal.Decimal `json:"maxDailyVolume"`       // Max daily volume
	MinOrderSize         decimal.Decimal `json:"minOrderSize"`         // Min order size
	MaxOrderSize         decimal.Decimal `json:"maxOrderSize"`         // Max order size
	
	// Risk per trade
	RiskPerTrade         decimal.Decimal `json:"riskPerTrade"`         // Max risk per trade (%)
	DefaultStopLoss      decimal.Decimal `json:"defaultStopLoss"`      // Default stop loss (%)
	
	// Time limits
	TradingHoursStart    string          `json:"tradingHoursStart"`    // Start of trading hours
	TradingHoursEnd      string          `json:"tradingHoursEnd"`      // End of trading hours
	
	// Kill switch
	KillSwitchThreshold  decimal.Decimal `json:"killSwitchThreshold"`  // Threshold for kill switch
	CooldownPeriod       time.Duration   `json:"cooldownPeriod"`       // Cooldown after kill switch
	
	// Correlation groups
	CorrelationGroups    map[string][]string `json:"correlationGroups"` // Symbol correlation groups
}

// RiskViolation represents a risk rule violation.
type RiskViolation struct {
	Rule      string          `json:"rule"`
	Severity  RiskSeverity    `json:"severity"`
	Value     decimal.Decimal `json:"value"`
	Limit     decimal.Decimal `json:"limit"`
	Message   string          `json:"message"`
	Timestamp time.Time       `json:"timestamp"`
}

// RiskSeverity represents severity of risk violation.
type RiskSeverity string

const (
	RiskSeverityWarning  RiskSeverity = "warning"
	RiskSeverityCritical RiskSeverity = "critical"
	RiskSeverityBlock    RiskSeverity = "block"
)

// RiskEvent represents a risk-related event.
type RiskEvent struct {
	Type      string    `json:"type"`
	Message   string    `json:"message"`
	Data      any       `json:"data,omitempty"`
	Timestamp time.Time `json:"timestamp"`
}

// RiskCheckResult represents the result of a risk check.
type RiskCheckResult struct {
	Approved   bool            `json:"approved"`
	Violations []RiskViolation `json:"violations"`
	Warnings   []string        `json:"warnings"`
	Adjustments *OrderAdjustments `json:"adjustments,omitempty"`
}

// OrderAdjustments contains suggested order adjustments.
type OrderAdjustments struct {
	AdjustedQuantity decimal.Decimal `json:"adjustedQuantity,omitempty"`
	SuggestedSL      decimal.Decimal `json:"suggestedSL,omitempty"`
	SuggestedTP      decimal.Decimal `json:"suggestedTP,omitempty"`
	Reason           string          `json:"reason,omitempty"`
}

// DefaultRiskConfig returns default risk configuration.
func DefaultRiskConfig() RiskConfig {
	return RiskConfig{
		MaxPositionSize:       decimal.NewFromFloat(0.1),    // 10% of portfolio
		MaxPositionValue:      decimal.NewFromInt(10000),    // $10,000
		MaxTotalExposure:      decimal.NewFromFloat(0.5),    // 50% of portfolio
		MaxSymbolExposure:     decimal.NewFromFloat(0.2),    // 20% per symbol
		MaxCorrelatedExposure: decimal.NewFromFloat(0.3),    // 30% correlated exposure
		
		MaxDailyLoss:          decimal.NewFromInt(500),      // $500
		MaxWeeklyLoss:         decimal.NewFromInt(1500),     // $1,500
		MaxDrawdown:           decimal.NewFromFloat(0.1),    // 10%
		MaxConsecutiveLosses:  5,
		
		MaxDailyTrades:        50,
		MaxDailyVolume:        decimal.NewFromInt(100000),   // $100,000
		MinOrderSize:          decimal.NewFromFloat(0.001),
		MaxOrderSize:          decimal.NewFromInt(10000),
		
		RiskPerTrade:          decimal.NewFromFloat(0.02),   // 2%
		DefaultStopLoss:       decimal.NewFromFloat(0.05),   // 5%
		
		TradingHoursStart:     "00:00",
		TradingHoursEnd:       "23:59",
		
		KillSwitchThreshold:   decimal.NewFromInt(1000),     // $1,000 loss
		CooldownPeriod:        4 * time.Hour,
		
		CorrelationGroups: map[string][]string{
			"btc-correlated": {"BTC/USD", "ETH/USD", "SOL/USD"},
			"stablecoins":    {"USDT/USD", "USDC/USD"},
		},
	}
}

// NewRiskManager creates a new risk manager.
func NewRiskManager(logger *zap.Logger, config RiskConfig) *RiskManager {
	return &RiskManager{
		logger:             logger.Named("risk-manager"),
		config:             config,
		symbolExposure:     make(map[string]decimal.Decimal),
		correlatedExposure: make(map[string]decimal.Decimal),
		riskEvents:         make(chan RiskEvent, 100),
	}
}

// CheckOrder validates an order against risk rules.
func (rm *RiskManager) CheckOrder(ctx context.Context, order *types.Order, portfolioValue decimal.Decimal) RiskCheckResult {
	rm.mu.RLock()
	defer rm.mu.RUnlock()
	
	result := RiskCheckResult{
		Approved: true,
	}
	
	// Check if trading is disabled
	if rm.isDisabled {
		if time.Now().Before(rm.disabledUntil) {
			result.Approved = false
			result.Violations = append(result.Violations, RiskViolation{
				Rule:      "kill_switch",
				Severity:  RiskSeverityBlock,
				Message:   fmt.Sprintf("Trading disabled until %s", rm.disabledUntil.Format(time.RFC3339)),
				Timestamp: time.Now(),
			})
			return result
		}
		// Re-enable trading
		rm.isDisabled = false
	}
	
	orderValue := order.Quantity.Mul(order.Price)
	
	// Check order size
	if order.Quantity.LessThan(rm.config.MinOrderSize) {
		result.Approved = false
		result.Violations = append(result.Violations, RiskViolation{
			Rule:     "min_order_size",
			Severity: RiskSeverityBlock,
			Value:    order.Quantity,
			Limit:    rm.config.MinOrderSize,
			Message:  "Order size below minimum",
		})
	}
	
	if orderValue.GreaterThan(rm.config.MaxOrderSize) {
		result.Approved = false
		result.Violations = append(result.Violations, RiskViolation{
			Rule:     "max_order_size",
			Severity: RiskSeverityBlock,
			Value:    orderValue,
			Limit:    rm.config.MaxOrderSize,
			Message:  "Order value exceeds maximum",
		})
	}
	
	// Check position size as percentage of portfolio
	if !portfolioValue.IsZero() {
		positionPct := orderValue.Div(portfolioValue)
		if positionPct.GreaterThan(rm.config.MaxPositionSize) {
			result.Approved = false
			result.Violations = append(result.Violations, RiskViolation{
				Rule:     "max_position_size",
				Severity: RiskSeverityBlock,
				Value:    positionPct,
				Limit:    rm.config.MaxPositionSize,
				Message:  "Position size exceeds maximum percentage of portfolio",
			})
		}
	}
	
	// Check position value
	if orderValue.GreaterThan(rm.config.MaxPositionValue) {
		result.Approved = false
		result.Violations = append(result.Violations, RiskViolation{
			Rule:     "max_position_value",
			Severity: RiskSeverityBlock,
			Value:    orderValue,
			Limit:    rm.config.MaxPositionValue,
			Message:  "Position value exceeds maximum",
		})
	}
	
	// Check daily trade count
	if rm.dailyTrades >= rm.config.MaxDailyTrades {
		result.Approved = false
		result.Violations = append(result.Violations, RiskViolation{
			Rule:     "max_daily_trades",
			Severity: RiskSeverityBlock,
			Value:    decimal.NewFromInt(int64(rm.dailyTrades)),
			Limit:    decimal.NewFromInt(int64(rm.config.MaxDailyTrades)),
			Message:  "Maximum daily trades reached",
		})
	}
	
	// Check daily volume
	newVolume := rm.dailyVolume.Add(orderValue)
	if newVolume.GreaterThan(rm.config.MaxDailyVolume) {
		result.Approved = false
		result.Violations = append(result.Violations, RiskViolation{
			Rule:     "max_daily_volume",
			Severity: RiskSeverityBlock,
			Value:    newVolume,
			Limit:    rm.config.MaxDailyVolume,
			Message:  "Maximum daily volume would be exceeded",
		})
	}
	
	// Check daily loss
	if rm.dailyPnL.LessThan(rm.config.MaxDailyLoss.Neg()) {
		result.Approved = false
		result.Violations = append(result.Violations, RiskViolation{
			Rule:     "max_daily_loss",
			Severity: RiskSeverityCritical,
			Value:    rm.dailyPnL,
			Limit:    rm.config.MaxDailyLoss.Neg(),
			Message:  "Maximum daily loss reached",
		})
	}
	
	// Check consecutive losses
	if rm.consecutiveLosses >= rm.config.MaxConsecutiveLosses {
		result.Approved = false
		result.Violations = append(result.Violations, RiskViolation{
			Rule:     "max_consecutive_losses",
			Severity: RiskSeverityCritical,
			Value:    decimal.NewFromInt(int64(rm.consecutiveLosses)),
			Limit:    decimal.NewFromInt(int64(rm.config.MaxConsecutiveLosses)),
			Message:  "Maximum consecutive losses reached",
		})
	}
	
	// Check total exposure
	newExposure := rm.totalExposure.Add(orderValue)
	maxExposure := portfolioValue.Mul(rm.config.MaxTotalExposure)
	if !portfolioValue.IsZero() && newExposure.GreaterThan(maxExposure) {
		result.Warnings = append(result.Warnings, "Total exposure approaching limit")
		if newExposure.GreaterThan(maxExposure.Mul(decimal.NewFromFloat(1.1))) {
			result.Approved = false
			result.Violations = append(result.Violations, RiskViolation{
				Rule:     "max_total_exposure",
				Severity: RiskSeverityBlock,
				Value:    newExposure,
				Limit:    maxExposure,
				Message:  "Maximum total exposure exceeded",
			})
		}
	}
	
	// Check symbol exposure
	symbolExp := rm.symbolExposure[order.Symbol].Add(orderValue)
	maxSymbolExp := portfolioValue.Mul(rm.config.MaxSymbolExposure)
	if !portfolioValue.IsZero() && symbolExp.GreaterThan(maxSymbolExp) {
		result.Approved = false
		result.Violations = append(result.Violations, RiskViolation{
			Rule:     "max_symbol_exposure",
			Severity: RiskSeverityBlock,
			Value:    symbolExp,
			Limit:    maxSymbolExp,
			Message:  fmt.Sprintf("Maximum exposure for %s exceeded", order.Symbol),
		})
	}
	
	// Check correlated exposure
	for groupName, symbols := range rm.config.CorrelationGroups {
		for _, sym := range symbols {
			if sym == order.Symbol {
				corrExp := rm.correlatedExposure[groupName].Add(orderValue)
				maxCorrExp := portfolioValue.Mul(rm.config.MaxCorrelatedExposure)
				if !portfolioValue.IsZero() && corrExp.GreaterThan(maxCorrExp) {
					result.Warnings = append(result.Warnings, 
						fmt.Sprintf("Correlated exposure for %s approaching limit", groupName))
				}
				break
			}
		}
	}
	
	// Check trading hours
	if !rm.isWithinTradingHours() {
		result.Warnings = append(result.Warnings, "Order placed outside regular trading hours")
	}
	
	// Calculate suggested adjustments if order is too large
	if !result.Approved {
		adjustments := rm.suggestAdjustments(order, portfolioValue)
		if adjustments != nil {
			result.Adjustments = adjustments
		}
	}
	
	// Log violations
	if len(result.Violations) > 0 {
		rm.logger.Warn("Risk violations detected",
			zap.String("symbol", order.Symbol),
			zap.Int("violationCount", len(result.Violations)))
	}
	
	return result
}

// suggestAdjustments calculates suggested order adjustments.
func (rm *RiskManager) suggestAdjustments(order *types.Order, portfolioValue decimal.Decimal) *OrderAdjustments {
	if portfolioValue.IsZero() {
		return nil
	}
	
	// Calculate max allowed quantity based on position size limit
	maxPositionValue := portfolioValue.Mul(rm.config.MaxPositionSize)
	if !order.Price.IsZero() {
		maxQuantity := maxPositionValue.Div(order.Price)
		
		// Also consider max order size
		maxOrderQty := rm.config.MaxOrderSize.Div(order.Price)
		if maxOrderQty.LessThan(maxQuantity) {
			maxQuantity = maxOrderQty
		}
		
		if maxQuantity.LessThan(order.Quantity) {
			// Calculate suggested stop loss
			riskAmount := portfolioValue.Mul(rm.config.RiskPerTrade)
			slDistance := riskAmount.Div(maxQuantity)
			var suggestedSL decimal.Decimal
			if order.Side == types.OrderSideBuy {
				suggestedSL = order.Price.Sub(slDistance)
			} else {
				suggestedSL = order.Price.Add(slDistance)
			}
			
			return &OrderAdjustments{
				AdjustedQuantity: maxQuantity,
				SuggestedSL:      suggestedSL,
				Reason:           "Quantity reduced to comply with position size limits",
			}
		}
	}
	
	return nil
}

// isWithinTradingHours checks if current time is within trading hours.
func (rm *RiskManager) isWithinTradingHours() bool {
	now := time.Now()
	
	start, err := time.Parse("15:04", rm.config.TradingHoursStart)
	if err != nil {
		return true // Default to allow if not configured
	}
	end, err := time.Parse("15:04", rm.config.TradingHoursEnd)
	if err != nil {
		return true
	}
	
	currentMinutes := now.Hour()*60 + now.Minute()
	startMinutes := start.Hour()*60 + start.Minute()
	endMinutes := end.Hour()*60 + end.Minute()
	
	if startMinutes <= endMinutes {
		return currentMinutes >= startMinutes && currentMinutes <= endMinutes
	}
	// Handle overnight trading hours
	return currentMinutes >= startMinutes || currentMinutes <= endMinutes
}

// RecordTrade records a trade for risk tracking.
func (rm *RiskManager) RecordTrade(trade *TradeRecord) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	
	rm.dailyTrades++
	rm.dailyVolume = rm.dailyVolume.Add(trade.Value)
	
	// Update exposure
	if trade.Side == types.OrderSideBuy {
		rm.totalExposure = rm.totalExposure.Add(trade.Value)
		rm.symbolExposure[trade.Symbol] = rm.symbolExposure[trade.Symbol].Add(trade.Value)
		
		// Update correlated exposure
		for groupName, symbols := range rm.config.CorrelationGroups {
			for _, sym := range symbols {
				if sym == trade.Symbol {
					rm.correlatedExposure[groupName] = rm.correlatedExposure[groupName].Add(trade.Value)
					break
				}
			}
		}
	} else {
		rm.totalExposure = rm.totalExposure.Sub(trade.Value)
		rm.symbolExposure[trade.Symbol] = rm.symbolExposure[trade.Symbol].Sub(trade.Value)
		
		// Update correlated exposure
		for groupName, symbols := range rm.config.CorrelationGroups {
			for _, sym := range symbols {
				if sym == trade.Symbol {
					rm.correlatedExposure[groupName] = rm.correlatedExposure[groupName].Sub(trade.Value)
					break
				}
			}
		}
	}
	
	// Track P&L and consecutive losses
	if trade.PnL.LessThan(decimal.Zero) {
		rm.dailyPnL = rm.dailyPnL.Add(trade.PnL)
		rm.consecutiveLosses++
		
		// Check kill switch threshold
		if rm.dailyPnL.LessThan(rm.config.KillSwitchThreshold.Neg()) {
			rm.triggerKillSwitch("Daily loss exceeded kill switch threshold")
		}
	} else {
		rm.dailyPnL = rm.dailyPnL.Add(trade.PnL)
		rm.consecutiveLosses = 0
	}
	
	rm.logger.Info("Trade recorded",
		zap.String("symbol", trade.Symbol),
		zap.String("pnl", trade.PnL.String()),
		zap.String("dailyPnL", rm.dailyPnL.String()),
		zap.Int("consecutiveLosses", rm.consecutiveLosses))
}

// TradeRecord represents a completed trade.
type TradeRecord struct {
	Symbol string
	Side   types.OrderSide
	Value  decimal.Decimal
	PnL    decimal.Decimal
}

// triggerKillSwitch activates the kill switch.
func (rm *RiskManager) triggerKillSwitch(reason string) {
	rm.isDisabled = true
	rm.disabledUntil = time.Now().Add(rm.config.CooldownPeriod)
	
	rm.violations = append(rm.violations, RiskViolation{
		Rule:      "kill_switch",
		Severity:  RiskSeverityCritical,
		Message:   reason,
		Timestamp: time.Now(),
	})
	
	rm.sendRiskEvent(RiskEvent{
		Type:      "kill_switch_activated",
		Message:   reason,
		Data:      map[string]any{"disabledUntil": rm.disabledUntil},
		Timestamp: time.Now(),
	})
	
	rm.logger.Error("Kill switch activated",
		zap.String("reason", reason),
		zap.Time("disabledUntil", rm.disabledUntil))
}

// ManualKillSwitch manually activates the kill switch.
func (rm *RiskManager) ManualKillSwitch(reason string, duration time.Duration) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	
	rm.isDisabled = true
	rm.disabledUntil = time.Now().Add(duration)
	
	rm.sendRiskEvent(RiskEvent{
		Type:      "manual_kill_switch",
		Message:   reason,
		Data:      map[string]any{"disabledUntil": rm.disabledUntil, "duration": duration.String()},
		Timestamp: time.Now(),
	})
}

// DisableKillSwitch manually disables the kill switch.
func (rm *RiskManager) DisableKillSwitch() {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	
	rm.isDisabled = false
	rm.disabledUntil = time.Time{}
	
	rm.sendRiskEvent(RiskEvent{
		Type:      "kill_switch_disabled",
		Message:   "Kill switch manually disabled",
		Timestamp: time.Now(),
	})
}

// IsDisabled returns whether trading is disabled.
func (rm *RiskManager) IsDisabled() bool {
	rm.mu.RLock()
	defer rm.mu.RUnlock()
	
	return rm.isDisabled && time.Now().Before(rm.disabledUntil)
}

// ResetDailyStats resets daily statistics.
func (rm *RiskManager) ResetDailyStats() {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	
	rm.dailyPnL = decimal.Zero
	rm.dailyTrades = 0
	rm.dailyVolume = decimal.Zero
	rm.consecutiveLosses = 0
	
	rm.logger.Info("Daily stats reset")
}

// GetStats returns current risk stats.
func (rm *RiskManager) GetStats() RiskStats {
	rm.mu.RLock()
	defer rm.mu.RUnlock()
	
	return RiskStats{
		DailyPnL:          rm.dailyPnL,
		DailyTrades:       rm.dailyTrades,
		DailyVolume:       rm.dailyVolume,
		ConsecutiveLosses: rm.consecutiveLosses,
		TotalExposure:     rm.totalExposure,
		IsDisabled:        rm.isDisabled,
		DisabledUntil:     rm.disabledUntil,
		ViolationCount:    len(rm.violations),
	}
}

// RiskStats contains current risk statistics.
type RiskStats struct {
	DailyPnL          decimal.Decimal `json:"dailyPnL"`
	DailyTrades       int             `json:"dailyTrades"`
	DailyVolume       decimal.Decimal `json:"dailyVolume"`
	ConsecutiveLosses int             `json:"consecutiveLosses"`
	TotalExposure     decimal.Decimal `json:"totalExposure"`
	IsDisabled        bool            `json:"isDisabled"`
	DisabledUntil     time.Time       `json:"disabledUntil,omitempty"`
	ViolationCount    int             `json:"violationCount"`
}

// GetExposure returns exposure for a symbol.
func (rm *RiskManager) GetExposure(symbol string) decimal.Decimal {
	rm.mu.RLock()
	defer rm.mu.RUnlock()
	
	return rm.symbolExposure[symbol]
}

// GetViolations returns recent violations.
func (rm *RiskManager) GetViolations(limit int) []RiskViolation {
	rm.mu.RLock()
	defer rm.mu.RUnlock()
	
	if limit <= 0 || limit > len(rm.violations) {
		limit = len(rm.violations)
	}
	
	// Return most recent violations
	start := len(rm.violations) - limit
	if start < 0 {
		start = 0
	}
	
	result := make([]RiskViolation, limit)
	copy(result, rm.violations[start:])
	return result
}

// Events returns the risk event channel.
func (rm *RiskManager) Events() <-chan RiskEvent {
	return rm.riskEvents
}

// sendRiskEvent sends a risk event.
func (rm *RiskManager) sendRiskEvent(event RiskEvent) {
	select {
	case rm.riskEvents <- event:
	default:
		rm.logger.Warn("Risk event channel full")
	}
}

// CalculatePositionSize calculates position size based on risk parameters.
func (rm *RiskManager) CalculatePositionSize(portfolioValue, entryPrice, stopLoss decimal.Decimal) decimal.Decimal {
	rm.mu.RLock()
	defer rm.mu.RUnlock()
	
	if entryPrice.IsZero() || stopLoss.IsZero() {
		return decimal.Zero
	}
	
	// Risk amount = portfolio * risk per trade
	riskAmount := portfolioValue.Mul(rm.config.RiskPerTrade)
	
	// Stop loss distance
	slDistance := entryPrice.Sub(stopLoss).Abs()
	if slDistance.IsZero() {
		return decimal.Zero
	}
	
	// Position size = risk amount / stop loss distance
	positionSize := riskAmount.Div(slDistance)
	
	// Apply max position size limit
	maxPosition := portfolioValue.Mul(rm.config.MaxPositionSize).Div(entryPrice)
	if positionSize.GreaterThan(maxPosition) {
		positionSize = maxPosition
	}
	
	return positionSize
}

// UpdateConfig updates risk configuration.
func (rm *RiskManager) UpdateConfig(config RiskConfig) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	
	rm.config = config
	rm.logger.Info("Risk config updated")
}

// GetConfig returns current risk configuration.
func (rm *RiskManager) GetConfig() RiskConfig {
	rm.mu.RLock()
	defer rm.mu.RUnlock()
	
	return rm.config
}
