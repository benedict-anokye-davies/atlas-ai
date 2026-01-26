// Package backtester provides order management for backtesting.
package backtester

import (
	"sync"
	"time"

	"github.com/atlas-desktop/trading-backend/internal/backtester/events"
	"github.com/atlas-desktop/trading-backend/pkg/types"
	"github.com/shopspring/decimal"
	"go.uber.org/zap"
)

// OrderManager manages pending and filled orders
type OrderManager struct {
	mu           sync.RWMutex
	logger       *zap.Logger
	pendingOrders map[string]*types.Order
	filledOrders  map[string]*types.Order
	commission    decimal.Decimal
	lastPrices    map[string]decimal.Decimal
}

// NewOrderManager creates a new order manager
func NewOrderManager(logger *zap.Logger, commission decimal.Decimal) *OrderManager {
	return &OrderManager{
		logger:        logger,
		pendingOrders: make(map[string]*types.Order),
		filledOrders:  make(map[string]*types.Order),
		commission:    commission,
		lastPrices:    make(map[string]decimal.Decimal),
	}
}

// Submit adds a new order to the pending queue
func (om *OrderManager) Submit(order *types.Order) {
	om.mu.Lock()
	defer om.mu.Unlock()
	
	order.Status = types.OrderStatusPending
	om.pendingOrders[order.ID] = order
	
	om.logger.Debug("Order submitted",
		zap.String("id", order.ID),
		zap.String("symbol", order.Symbol),
		zap.String("side", string(order.Side)),
		zap.String("type", string(order.Type)),
		zap.String("quantity", order.Quantity.String()),
	)
}

// Cancel cancels a pending order
func (om *OrderManager) Cancel(orderID string) bool {
	om.mu.Lock()
	defer om.mu.Unlock()
	
	order, ok := om.pendingOrders[orderID]
	if !ok {
		return false
	}
	
	order.Status = types.OrderStatusCancelled
	order.UpdatedAt = time.Now()
	delete(om.pendingOrders, orderID)
	
	om.logger.Debug("Order cancelled", zap.String("id", orderID))
	return true
}

// CheckFills checks if any pending orders can be filled
func (om *OrderManager) CheckFills(marketData *events.MarketDataEvent) []*events.FillEvent {
	om.mu.Lock()
	defer om.mu.Unlock()
	
	var fills []*events.FillEvent
	
	// Update last price
	var currentPrice decimal.Decimal
	if marketData.OHLCV != nil {
		currentPrice = marketData.OHLCV.Close
		om.lastPrices[marketData.Symbol] = currentPrice
	} else if marketData.Tick != nil {
		currentPrice = marketData.Tick.Price
		om.lastPrices[marketData.Symbol] = currentPrice
	} else {
		return fills
	}
	
	// Check each pending order
	for id, order := range om.pendingOrders {
		if order.Symbol != marketData.Symbol {
			continue
		}
		
		filled, fillPrice, slippage := om.checkOrderFill(order, marketData, currentPrice)
		if !filled {
			continue
		}
		
		// Calculate commission
		commission := order.Quantity.Mul(fillPrice).Mul(om.commission)
		
		// Create fill event
		fill := &events.FillEvent{
			BaseEvent: events.BaseEvent{
				Type:      events.EventTypeFill,
				Timestamp: marketData.Timestamp,
				Priority:  4,
			},
			OrderID:    order.ID,
			Symbol:     order.Symbol,
			Side:       order.Side,
			Quantity:   order.Quantity,
			Price:      fillPrice,
			Commission: commission,
			Slippage:   slippage,
		}
		fills = append(fills, fill)
		
		// Update order
		now := marketData.Timestamp
		order.Status = types.OrderStatusFilled
		order.FilledQty = order.Quantity
		order.AvgFillPrice = fillPrice
		order.Commission = commission
		order.UpdatedAt = now
		order.FilledAt = &now
		
		// Move to filled orders
		om.filledOrders[id] = order
		delete(om.pendingOrders, id)
		
		om.logger.Debug("Order filled",
			zap.String("id", order.ID),
			zap.String("price", fillPrice.String()),
			zap.String("slippage", slippage.String()),
		)
	}
	
	return fills
}

// checkOrderFill determines if an order should be filled
func (om *OrderManager) checkOrderFill(order *types.Order, marketData *events.MarketDataEvent, currentPrice decimal.Decimal) (bool, decimal.Decimal, decimal.Decimal) {
	switch order.Type {
	case types.OrderTypeMarket:
		// Market orders fill immediately at current price with slippage
		slippage := om.calculateSlippage(order, marketData)
		var fillPrice decimal.Decimal
		if order.Side == types.OrderSideBuy {
			fillPrice = currentPrice.Mul(decimal.NewFromFloat(1).Add(slippage))
		} else {
			fillPrice = currentPrice.Mul(decimal.NewFromFloat(1).Sub(slippage))
		}
		return true, fillPrice, slippage
		
	case types.OrderTypeLimit:
		// Limit orders fill if price crosses limit
		if order.Side == types.OrderSideBuy && currentPrice.LessThanOrEqual(order.Price) {
			return true, order.Price, decimal.Zero
		}
		if order.Side == types.OrderSideSell && currentPrice.GreaterThanOrEqual(order.Price) {
			return true, order.Price, decimal.Zero
		}
		return false, decimal.Zero, decimal.Zero
		
	case types.OrderTypeStopLoss:
		// Stop loss triggers when price crosses stop
		if order.Side == types.OrderSideSell && currentPrice.LessThanOrEqual(order.StopPrice) {
			slippage := om.calculateSlippage(order, marketData)
			fillPrice := currentPrice.Mul(decimal.NewFromFloat(1).Sub(slippage))
			return true, fillPrice, slippage
		}
		if order.Side == types.OrderSideBuy && currentPrice.GreaterThanOrEqual(order.StopPrice) {
			slippage := om.calculateSlippage(order, marketData)
			fillPrice := currentPrice.Mul(decimal.NewFromFloat(1).Add(slippage))
			return true, fillPrice, slippage
		}
		return false, decimal.Zero, decimal.Zero
		
	case types.OrderTypeTakeProfit:
		// Take profit triggers when price crosses target
		if order.Side == types.OrderSideSell && currentPrice.GreaterThanOrEqual(order.Price) {
			return true, order.Price, decimal.Zero
		}
		if order.Side == types.OrderSideBuy && currentPrice.LessThanOrEqual(order.Price) {
			return true, order.Price, decimal.Zero
		}
		return false, decimal.Zero, decimal.Zero
	}
	
	return false, decimal.Zero, decimal.Zero
}

// calculateSlippage calculates slippage for an order
func (om *OrderManager) calculateSlippage(order *types.Order, marketData *events.MarketDataEvent) decimal.Decimal {
	// Simple volume-based slippage model
	// In production, this would use order book depth
	baseSlippage := decimal.NewFromFloat(0.001) // 0.1% base slippage
	
	if marketData.OHLCV != nil && !marketData.OHLCV.Volume.IsZero() {
		// Adjust slippage based on order size relative to volume
		orderValue := order.Quantity.Mul(marketData.OHLCV.Close)
		volumeValue := marketData.OHLCV.Volume.Mul(marketData.OHLCV.Close)
		
		if !volumeValue.IsZero() {
			participation := orderValue.Div(volumeValue)
			// Square root impact model
			impact := participation.Mul(decimal.NewFromFloat(0.1)) // 10% impact factor
			baseSlippage = baseSlippage.Add(impact)
		}
	}
	
	// Cap slippage at 5%
	maxSlippage := decimal.NewFromFloat(0.05)
	if baseSlippage.GreaterThan(maxSlippage) {
		return maxSlippage
	}
	
	return baseSlippage
}

// GetPendingOrders returns all pending orders
func (om *OrderManager) GetPendingOrders() []*types.Order {
	om.mu.RLock()
	defer om.mu.RUnlock()
	
	orders := make([]*types.Order, 0, len(om.pendingOrders))
	for _, order := range om.pendingOrders {
		orderCopy := *order
		orders = append(orders, &orderCopy)
	}
	return orders
}

// GetFilledOrders returns all filled orders
func (om *OrderManager) GetFilledOrders() []*types.Order {
	om.mu.RLock()
	defer om.mu.RUnlock()
	
	orders := make([]*types.Order, 0, len(om.filledOrders))
	for _, order := range om.filledOrders {
		orderCopy := *order
		orders = append(orders, &orderCopy)
	}
	return orders
}

// GetOrder returns an order by ID
func (om *OrderManager) GetOrder(id string) *types.Order {
	om.mu.RLock()
	defer om.mu.RUnlock()
	
	if order, ok := om.pendingOrders[id]; ok {
		orderCopy := *order
		return &orderCopy
	}
	if order, ok := om.filledOrders[id]; ok {
		orderCopy := *order
		return &orderCopy
	}
	return nil
}

// CancelAll cancels all pending orders
func (om *OrderManager) CancelAll() int {
	om.mu.Lock()
	defer om.mu.Unlock()
	
	count := len(om.pendingOrders)
	for id, order := range om.pendingOrders {
		order.Status = types.OrderStatusCancelled
		order.UpdatedAt = time.Now()
		delete(om.pendingOrders, id)
	}
	
	return count
}
