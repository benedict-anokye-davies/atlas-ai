// Package execution provides order management capabilities.
package execution

import (
	"context"
	"sync"
	"time"

	"github.com/atlas-desktop/trading-backend/pkg/types"
	"github.com/shopspring/decimal"
	"go.uber.org/zap"
)

// OrderManager manages order lifecycle.
type OrderManager struct {
	logger       *zap.Logger
	orders       map[string]*ManagedOrder
	positions    map[string]*types.Position
	mu           sync.RWMutex
	
	// Event channels
	orderUpdates chan OrderUpdate
	fills        chan OrderFill
}

// ManagedOrder wraps an order with management state.
type ManagedOrder struct {
	Order         *types.Order    `json:"order"`
	Exchange      string          `json:"exchange"`
	Status        OrderStatus     `json:"status"`
	FilledQty     decimal.Decimal `json:"filledQty"`
	AvgFillPrice  decimal.Decimal `json:"avgFillPrice"`
	Commission    decimal.Decimal `json:"commission"`
	CreatedAt     time.Time       `json:"createdAt"`
	UpdatedAt     time.Time       `json:"updatedAt"`
	Fills         []OrderFill     `json:"fills"`
	
	// Linked orders
	ParentOrderID string          `json:"parentOrderId,omitempty"`
	StopLossID    string          `json:"stopLossId,omitempty"`
	TakeProfitID  string          `json:"takeProfitId,omitempty"`
	
	// Tracking
	SignalID      string          `json:"signalId,omitempty"`
	Tags          []string        `json:"tags,omitempty"`
}

// OrderStatus represents order status.
type OrderStatus string

const (
	OrderStatusPending      OrderStatus = "pending"
	OrderStatusOpen         OrderStatus = "open"
	OrderStatusPartialFill  OrderStatus = "partial_fill"
	OrderStatusFilled       OrderStatus = "filled"
	OrderStatusCancelled    OrderStatus = "cancelled"
	OrderStatusRejected     OrderStatus = "rejected"
	OrderStatusExpired      OrderStatus = "expired"
)

// OrderUpdate represents an order state update.
type OrderUpdate struct {
	OrderID   string      `json:"orderId"`
	Status    OrderStatus `json:"status"`
	Message   string      `json:"message,omitempty"`
	Timestamp time.Time   `json:"timestamp"`
}

// OrderFill represents a trade fill.
type OrderFill struct {
	OrderID    string          `json:"orderId"`
	TradeID    string          `json:"tradeId"`
	Price      decimal.Decimal `json:"price"`
	Quantity   decimal.Decimal `json:"quantity"`
	Commission decimal.Decimal `json:"commission"`
	Timestamp  time.Time       `json:"timestamp"`
}

// NewOrderManager creates a new order manager.
func NewOrderManager(logger *zap.Logger) *OrderManager {
	return &OrderManager{
		logger:       logger.Named("order-manager"),
		orders:       make(map[string]*ManagedOrder),
		positions:    make(map[string]*types.Position),
		orderUpdates: make(chan OrderUpdate, 1000),
		fills:        make(chan OrderFill, 1000),
	}
}

// TrackOrder starts tracking an order.
func (om *OrderManager) TrackOrder(order *types.Order, exchange string, signalID string) *ManagedOrder {
	om.mu.Lock()
	defer om.mu.Unlock()
	
	managed := &ManagedOrder{
		Order:     order,
		Exchange:  exchange,
		Status:    OrderStatusPending,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
		SignalID:  signalID,
	}
	
	om.orders[order.ID] = managed
	
	om.logger.Info("Tracking order",
		zap.String("orderId", order.ID),
		zap.String("symbol", order.Symbol),
		zap.String("side", string(order.Side)))
	
	return managed
}

// UpdateOrderStatus updates an order's status.
func (om *OrderManager) UpdateOrderStatus(orderID string, status OrderStatus, message string) {
	om.mu.Lock()
	defer om.mu.Unlock()
	
	order, ok := om.orders[orderID]
	if !ok {
		return
	}
	
	order.Status = status
	order.UpdatedAt = time.Now()
	
	// Send update notification
	select {
	case om.orderUpdates <- OrderUpdate{
		OrderID:   orderID,
		Status:    status,
		Message:   message,
		Timestamp: time.Now(),
	}:
	default:
		om.logger.Warn("Order update channel full")
	}
}

// RecordFill records a fill for an order.
func (om *OrderManager) RecordFill(fill OrderFill) {
	om.mu.Lock()
	defer om.mu.Unlock()
	
	order, ok := om.orders[fill.OrderID]
	if !ok {
		return
	}
	
	order.Fills = append(order.Fills, fill)
	order.FilledQty = order.FilledQty.Add(fill.Quantity)
	order.Commission = order.Commission.Add(fill.Commission)
	
	// Update average fill price
	totalValue := decimal.Zero
	totalQty := decimal.Zero
	for _, f := range order.Fills {
		totalValue = totalValue.Add(f.Price.Mul(f.Quantity))
		totalQty = totalQty.Add(f.Quantity)
	}
	if !totalQty.IsZero() {
		order.AvgFillPrice = totalValue.Div(totalQty)
	}
	
	order.UpdatedAt = time.Now()
	
	// Update status
	if order.FilledQty.GreaterThanOrEqual(order.Order.Quantity) {
		order.Status = OrderStatusFilled
	} else if order.FilledQty.GreaterThan(decimal.Zero) {
		order.Status = OrderStatusPartialFill
	}
	
	// Update position
	om.updatePosition(order, fill)
	
	// Send fill notification
	select {
	case om.fills <- fill:
	default:
		om.logger.Warn("Fill channel full")
	}
}

// updatePosition updates the position based on a fill.
func (om *OrderManager) updatePosition(order *ManagedOrder, fill OrderFill) {
	symbol := order.Order.Symbol
	position, exists := om.positions[symbol]
	
	if !exists {
		// Create new position
		side := types.PositionSideLong
		if order.Order.Side == types.OrderSideSell {
			side = types.PositionSideShort
		}
		
		position = &types.Position{
			Symbol:       symbol,
			Side:         side,
			Quantity:     decimal.Zero,
			EntryPrice:   decimal.Zero,
			CurrentPrice: fill.Price,
			OpenedAt:     time.Now(),
		}
		om.positions[symbol] = position
	}
	
	// Update position quantity and entry price
	if order.Order.Side == types.OrderSideBuy {
		if position.Side == types.PositionSideLong {
			// Adding to long position
			totalValue := position.EntryPrice.Mul(position.Quantity).Add(fill.Price.Mul(fill.Quantity))
			position.Quantity = position.Quantity.Add(fill.Quantity)
			if !position.Quantity.IsZero() {
				position.EntryPrice = totalValue.Div(position.Quantity)
			}
		} else {
			// Closing short position
			position.Quantity = position.Quantity.Sub(fill.Quantity)
			if position.Quantity.LessThanOrEqual(decimal.Zero) {
				delete(om.positions, symbol)
			}
		}
	} else { // Sell
		if position.Side == types.PositionSideShort {
			// Adding to short position
			totalValue := position.EntryPrice.Mul(position.Quantity).Add(fill.Price.Mul(fill.Quantity))
			position.Quantity = position.Quantity.Add(fill.Quantity)
			if !position.Quantity.IsZero() {
				position.EntryPrice = totalValue.Div(position.Quantity)
			}
		} else {
			// Closing long position
			position.Quantity = position.Quantity.Sub(fill.Quantity)
			if position.Quantity.LessThanOrEqual(decimal.Zero) {
				delete(om.positions, symbol)
			}
		}
	}
}

// GetOrder returns a managed order by ID.
func (om *OrderManager) GetOrder(orderID string) *ManagedOrder {
	om.mu.RLock()
	defer om.mu.RUnlock()
	
	return om.orders[orderID]
}

// GetOpenOrders returns all open orders.
func (om *OrderManager) GetOpenOrders() []*ManagedOrder {
	om.mu.RLock()
	defer om.mu.RUnlock()
	
	var open []*ManagedOrder
	for _, order := range om.orders {
		if order.Status == OrderStatusPending || order.Status == OrderStatusOpen || order.Status == OrderStatusPartialFill {
			open = append(open, order)
		}
	}
	return open
}

// GetOrdersBySymbol returns orders for a symbol.
func (om *OrderManager) GetOrdersBySymbol(symbol string) []*ManagedOrder {
	om.mu.RLock()
	defer om.mu.RUnlock()
	
	var orders []*ManagedOrder
	for _, order := range om.orders {
		if order.Order.Symbol == symbol {
			orders = append(orders, order)
		}
	}
	return orders
}

// GetPosition returns the position for a symbol.
func (om *OrderManager) GetPosition(symbol string) *types.Position {
	om.mu.RLock()
	defer om.mu.RUnlock()
	
	if pos, ok := om.positions[symbol]; ok {
		// Return copy
		posCopy := *pos
		return &posCopy
	}
	return nil
}

// GetAllPositions returns all positions.
func (om *OrderManager) GetAllPositions() []*types.Position {
	om.mu.RLock()
	defer om.mu.RUnlock()
	
	positions := make([]*types.Position, 0, len(om.positions))
	for _, pos := range om.positions {
		posCopy := *pos
		positions = append(positions, &posCopy)
	}
	return positions
}

// OrderUpdates returns the order update channel.
func (om *OrderManager) OrderUpdates() <-chan OrderUpdate {
	return om.orderUpdates
}

// Fills returns the fill channel.
func (om *OrderManager) Fills() <-chan OrderFill {
	return om.fills
}

// CancelOrder marks an order as cancelled.
func (om *OrderManager) CancelOrder(orderID string) {
	om.UpdateOrderStatus(orderID, OrderStatusCancelled, "cancelled by user")
}

// ExpireOrder marks an order as expired.
func (om *OrderManager) ExpireOrder(orderID string) {
	om.UpdateOrderStatus(orderID, OrderStatusExpired, "order expired")
}

// CleanupOldOrders removes old completed orders.
func (om *OrderManager) CleanupOldOrders(maxAge time.Duration) int {
	om.mu.Lock()
	defer om.mu.Unlock()
	
	cutoff := time.Now().Add(-maxAge)
	removed := 0
	
	for id, order := range om.orders {
		// Only clean up terminal states
		if order.Status == OrderStatusFilled || order.Status == OrderStatusCancelled ||
			order.Status == OrderStatusRejected || order.Status == OrderStatusExpired {
			if order.UpdatedAt.Before(cutoff) {
				delete(om.orders, id)
				removed++
			}
		}
	}
	
	return removed
}

// MonitorOrders monitors orders for timeouts and updates.
func (om *OrderManager) MonitorOrders(ctx context.Context, adapter ExchangeAdapter, pollInterval time.Duration) {
	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()
	
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			om.checkOrders(ctx, adapter)
		}
	}
}

// checkOrders checks order status with exchange.
func (om *OrderManager) checkOrders(ctx context.Context, adapter ExchangeAdapter) {
	om.mu.RLock()
	var openOrders []*ManagedOrder
	for _, order := range om.orders {
		if order.Status == OrderStatusPending || order.Status == OrderStatusOpen || order.Status == OrderStatusPartialFill {
			openOrders = append(openOrders, order)
		}
	}
	om.mu.RUnlock()
	
	for _, managed := range openOrders {
		exchangeOrder, err := adapter.GetOrder(ctx, managed.Order.ID)
		if err != nil {
			om.logger.Debug("Failed to get order status", zap.String("orderId", managed.Order.ID), zap.Error(err))
			continue
		}
		
		// Update from exchange
		if exchangeOrder.Status != managed.Order.Status {
			om.UpdateOrderStatus(managed.Order.ID, OrderStatus(exchangeOrder.Status), "updated from exchange")
		}
	}
}

// GetOrderStats returns order statistics.
func (om *OrderManager) GetOrderStats() OrderStats {
	om.mu.RLock()
	defer om.mu.RUnlock()
	
	stats := OrderStats{
		TotalOrders: len(om.orders),
	}
	
	for _, order := range om.orders {
		switch order.Status {
		case OrderStatusPending, OrderStatusOpen, OrderStatusPartialFill:
			stats.OpenOrders++
		case OrderStatusFilled:
			stats.FilledOrders++
			stats.TotalVolume = stats.TotalVolume.Add(order.Order.Quantity.Mul(order.AvgFillPrice))
			stats.TotalCommission = stats.TotalCommission.Add(order.Commission)
		case OrderStatusCancelled:
			stats.CancelledOrders++
		case OrderStatusRejected:
			stats.RejectedOrders++
		}
	}
	
	stats.TotalPositions = len(om.positions)
	
	return stats
}

// OrderStats contains order statistics.
type OrderStats struct {
	TotalOrders      int             `json:"totalOrders"`
	OpenOrders       int             `json:"openOrders"`
	FilledOrders     int             `json:"filledOrders"`
	CancelledOrders  int             `json:"cancelledOrders"`
	RejectedOrders   int             `json:"rejectedOrders"`
	TotalPositions   int             `json:"totalPositions"`
	TotalVolume      decimal.Decimal `json:"totalVolume"`
	TotalCommission  decimal.Decimal `json:"totalCommission"`
}

// LinkStopLoss links a stop loss order to a parent order.
func (om *OrderManager) LinkStopLoss(parentID, stopLossID string) {
	om.mu.Lock()
	defer om.mu.Unlock()
	
	if parent, ok := om.orders[parentID]; ok {
		parent.StopLossID = stopLossID
	}
	if sl, ok := om.orders[stopLossID]; ok {
		sl.ParentOrderID = parentID
	}
}

// LinkTakeProfit links a take profit order to a parent order.
func (om *OrderManager) LinkTakeProfit(parentID, takeProfitID string) {
	om.mu.Lock()
	defer om.mu.Unlock()
	
	if parent, ok := om.orders[parentID]; ok {
		parent.TakeProfitID = takeProfitID
	}
	if tp, ok := om.orders[takeProfitID]; ok {
		tp.ParentOrderID = parentID
	}
}

// CancelLinkedOrders cancels stop loss and take profit orders linked to a parent.
func (om *OrderManager) CancelLinkedOrders(parentID string) {
	om.mu.RLock()
	parent, ok := om.orders[parentID]
	if !ok {
		om.mu.RUnlock()
		return
	}
	slID := parent.StopLossID
	tpID := parent.TakeProfitID
	om.mu.RUnlock()
	
	if slID != "" {
		om.CancelOrder(slID)
	}
	if tpID != "" {
		om.CancelOrder(tpID)
	}
}
