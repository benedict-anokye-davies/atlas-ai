// Package backtester provides portfolio simulation for backtesting.
package backtester

import (
	"sync"
	"time"

	"github.com/atlas-desktop/trading-backend/pkg/types"
	"github.com/shopspring/decimal"
)

// Portfolio manages simulated portfolio state
type Portfolio struct {
	mu            sync.RWMutex
	cash          decimal.Decimal
	initialCash   decimal.Decimal
	positions     map[string]*Position
	peakEquity    decimal.Decimal
	currentEquity decimal.Decimal
}

// Position represents a portfolio position
type Position struct {
	Symbol       string
	Quantity     decimal.Decimal
	AvgPrice     decimal.Decimal
	CurrentPrice decimal.Decimal
	OpenedAt     time.Time
	Trades       int
}

// NewPortfolio creates a new portfolio
func NewPortfolio(initialCash decimal.Decimal) *Portfolio {
	return &Portfolio{
		cash:          initialCash,
		initialCash:   initialCash,
		positions:     make(map[string]*Position),
		peakEquity:    initialCash,
		currentEquity: initialCash,
	}
}

// GetCash returns available cash
func (p *Portfolio) GetCash() decimal.Decimal {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.cash
}

// GetEquity returns total equity (cash + positions)
func (p *Portfolio) GetEquity() decimal.Decimal {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.calculateEquity()
}

// GetDrawdown returns current drawdown from peak
func (p *Portfolio) GetDrawdown() decimal.Decimal {
	p.mu.RLock()
	defer p.mu.RUnlock()
	
	if p.peakEquity.IsZero() {
		return decimal.Zero
	}
	
	equity := p.calculateEquity()
	return p.peakEquity.Sub(equity).Div(p.peakEquity)
}

// GetPosition returns a position by symbol
func (p *Portfolio) GetPosition(symbol string) *Position {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.positions[symbol]
}

// GetPositions returns all positions
func (p *Portfolio) GetPositions() map[string]*Position {
	p.mu.RLock()
	defer p.mu.RUnlock()
	
	result := make(map[string]*Position, len(p.positions))
	for k, v := range p.positions {
		posCopy := *v
		result[k] = &posCopy
	}
	return result
}

// UpdatePrice updates the price for a symbol
func (p *Portfolio) UpdatePrice(symbol string, price decimal.Decimal) {
	p.mu.Lock()
	defer p.mu.Unlock()
	
	if pos, ok := p.positions[symbol]; ok {
		pos.CurrentPrice = price
	}
	
	// Update equity and peak
	p.currentEquity = p.calculateEquity()
	if p.currentEquity.GreaterThan(p.peakEquity) {
		p.peakEquity = p.currentEquity
	}
}

// Buy executes a buy order
func (p *Portfolio) Buy(symbol string, quantity, price, commission decimal.Decimal) {
	p.mu.Lock()
	defer p.mu.Unlock()
	
	cost := quantity.Mul(price).Add(commission)
	p.cash = p.cash.Sub(cost)
	
	if pos, ok := p.positions[symbol]; ok {
		// Add to existing position (average up/down)
		totalQty := pos.Quantity.Add(quantity)
		totalCost := pos.Quantity.Mul(pos.AvgPrice).Add(quantity.Mul(price))
		pos.AvgPrice = totalCost.Div(totalQty)
		pos.Quantity = totalQty
		pos.CurrentPrice = price
		pos.Trades++
	} else {
		// New position
		p.positions[symbol] = &Position{
			Symbol:       symbol,
			Quantity:     quantity,
			AvgPrice:     price,
			CurrentPrice: price,
			OpenedAt:     time.Now(),
			Trades:       1,
		}
	}
	
	p.currentEquity = p.calculateEquity()
	if p.currentEquity.GreaterThan(p.peakEquity) {
		p.peakEquity = p.currentEquity
	}
}

// Sell executes a sell order, returns realized PnL
func (p *Portfolio) Sell(symbol string, quantity, price, commission decimal.Decimal) decimal.Decimal {
	p.mu.Lock()
	defer p.mu.Unlock()
	
	pos, ok := p.positions[symbol]
	if !ok {
		return decimal.Zero
	}
	
	// Calculate PnL
	sellValue := quantity.Mul(price)
	costBasis := quantity.Mul(pos.AvgPrice)
	pnl := sellValue.Sub(costBasis).Sub(commission)
	
	// Update cash
	p.cash = p.cash.Add(sellValue).Sub(commission)
	
	// Update position
	pos.Quantity = pos.Quantity.Sub(quantity)
	pos.Trades++
	
	// Remove position if fully closed
	if pos.Quantity.LessThanOrEqual(decimal.Zero) {
		delete(p.positions, symbol)
	}
	
	p.currentEquity = p.calculateEquity()
	if p.currentEquity.GreaterThan(p.peakEquity) {
		p.peakEquity = p.currentEquity
	}
	
	return pnl
}

// CloseAll closes all positions at current prices
func (p *Portfolio) CloseAll(timestamp time.Time) decimal.Decimal {
	p.mu.Lock()
	defer p.mu.Unlock()
	
	var totalPnL decimal.Decimal
	
	for symbol, pos := range p.positions {
		sellValue := pos.Quantity.Mul(pos.CurrentPrice)
		costBasis := pos.Quantity.Mul(pos.AvgPrice)
		pnl := sellValue.Sub(costBasis)
		totalPnL = totalPnL.Add(pnl)
		
		p.cash = p.cash.Add(sellValue)
		delete(p.positions, symbol)
	}
	
	p.currentEquity = p.calculateEquity()
	return totalPnL
}

// calculateEquity calculates total equity (must hold lock)
func (p *Portfolio) calculateEquity() decimal.Decimal {
	equity := p.cash
	
	for _, pos := range p.positions {
		positionValue := pos.Quantity.Mul(pos.CurrentPrice)
		equity = equity.Add(positionValue)
	}
	
	return equity
}

// GetUnrealizedPnL returns unrealized PnL for all positions
func (p *Portfolio) GetUnrealizedPnL() decimal.Decimal {
	p.mu.RLock()
	defer p.mu.RUnlock()
	
	var unrealized decimal.Decimal
	
	for _, pos := range p.positions {
		marketValue := pos.Quantity.Mul(pos.CurrentPrice)
		costBasis := pos.Quantity.Mul(pos.AvgPrice)
		unrealized = unrealized.Add(marketValue.Sub(costBasis))
	}
	
	return unrealized
}

// GetTotalPnL returns total PnL (realized + unrealized)
func (p *Portfolio) GetTotalPnL() decimal.Decimal {
	return p.GetEquity().Sub(p.initialCash)
}

// ToTypes converts to types.Portfolio
func (p *Portfolio) ToTypes() *types.Portfolio {
	p.mu.RLock()
	defer p.mu.RUnlock()
	
	positions := make(map[string]*types.Position, len(p.positions))
	for symbol, pos := range p.positions {
		unrealizedPnL := pos.Quantity.Mul(pos.CurrentPrice.Sub(pos.AvgPrice))
		positions[symbol] = &types.Position{
			Symbol:        symbol,
			Side:          types.OrderSideBuy,
			Quantity:      pos.Quantity,
			EntryPrice:    pos.AvgPrice,
			CurrentPrice:  pos.CurrentPrice,
			UnrealizedPnL: unrealizedPnL,
			OpenedAt:      pos.OpenedAt,
		}
	}
	
	return &types.Portfolio{
		Cash:      p.cash,
		Equity:    p.calculateEquity(),
		Positions: positions,
		TotalPnL:  p.calculateEquity().Sub(p.initialCash),
		UpdatedAt: time.Now(),
	}
}
