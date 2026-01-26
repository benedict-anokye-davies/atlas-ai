// Package events provides event types for the event-driven backtester.
package events

import (
	"time"

	"github.com/atlas-desktop/trading-backend/pkg/types"
	"github.com/shopspring/decimal"
)

// EventType represents the type of event
type EventType string

const (
	EventTypeMarketData    EventType = "market_data"
	EventTypeSignal        EventType = "signal"
	EventTypeOrder         EventType = "order"
	EventTypeFill          EventType = "fill"
	EventTypeCancel        EventType = "cancel"
	EventTypePortfolio     EventType = "portfolio"
	EventTypeRisk          EventType = "risk"
	EventTypeBlock         EventType = "block"
	EventTypeMempool       EventType = "mempool"
	EventTypeKillSwitch    EventType = "kill_switch"
)

// Event is the base interface for all events
type Event interface {
	GetType() EventType
	GetTimestamp() time.Time
	GetPriority() int
}

// BaseEvent provides common fields for all events
type BaseEvent struct {
	Type      EventType `json:"type"`
	Timestamp time.Time `json:"timestamp"`
	Priority  int       `json:"priority"`
}

func (e *BaseEvent) GetType() EventType     { return e.Type }
func (e *BaseEvent) GetTimestamp() time.Time { return e.Timestamp }
func (e *BaseEvent) GetPriority() int        { return e.Priority }

// MarketDataEvent represents a market data update
type MarketDataEvent struct {
	BaseEvent
	Symbol    string           `json:"symbol"`
	OHLCV     *types.OHLCV     `json:"ohlcv,omitempty"`
	Tick      *types.Tick      `json:"tick,omitempty"`
	OrderBook *OrderBookUpdate `json:"orderBook,omitempty"`
}

// OrderBookUpdate represents an order book update
type OrderBookUpdate struct {
	Bids      []PriceLevel    `json:"bids"`
	Asks      []PriceLevel    `json:"asks"`
	Timestamp time.Time       `json:"timestamp"`
}

// PriceLevel represents a price level in the order book
type PriceLevel struct {
	Price    decimal.Decimal `json:"price"`
	Quantity decimal.Decimal `json:"quantity"`
}

// SignalEvent represents a trading signal
type SignalEvent struct {
	BaseEvent
	Signal *types.Signal `json:"signal"`
}

// OrderEvent represents an order submission
type OrderEvent struct {
	BaseEvent
	Order *types.Order `json:"order"`
}

// FillEvent represents an order fill
type FillEvent struct {
	BaseEvent
	OrderID      string          `json:"orderId"`
	Symbol       string          `json:"symbol"`
	Side         types.OrderSide `json:"side"`
	Quantity     decimal.Decimal `json:"quantity"`
	Price        decimal.Decimal `json:"price"`
	Commission   decimal.Decimal `json:"commission"`
	Slippage     decimal.Decimal `json:"slippage"`
}

// CancelEvent represents an order cancellation
type CancelEvent struct {
	BaseEvent
	OrderID string `json:"orderId"`
	Reason  string `json:"reason"`
}

// PortfolioEvent represents a portfolio update
type PortfolioEvent struct {
	BaseEvent
	Portfolio *types.Portfolio `json:"portfolio"`
}

// RiskEvent represents a risk limit breach
type RiskEvent struct {
	BaseEvent
	RiskType  string          `json:"riskType"`
	Threshold decimal.Decimal `json:"threshold"`
	Current   decimal.Decimal `json:"current"`
	Message   string          `json:"message"`
}

// BlockEvent represents a blockchain block
type BlockEvent struct {
	BaseEvent
	Chain       string    `json:"chain"`
	BlockNumber uint64    `json:"blockNumber"`
	BlockHash   string    `json:"blockHash"`
	ParentHash  string    `json:"parentHash"`
	Timestamp   time.Time `json:"timestamp"`
	TxCount     int       `json:"txCount"`
	GasUsed     uint64    `json:"gasUsed,omitempty"`
	BaseFee     uint64    `json:"baseFee,omitempty"`
	Slot        uint64    `json:"slot,omitempty"` // Solana specific
}

// MempoolEvent represents a mempool transaction
type MempoolEvent struct {
	BaseEvent
	TxHash      string          `json:"txHash"`
	From        string          `json:"from"`
	To          string          `json:"to"`
	Value       decimal.Decimal `json:"value"`
	GasPrice    uint64          `json:"gasPrice,omitempty"`
	GasLimit    uint64          `json:"gasLimit,omitempty"`
	Data        []byte          `json:"data,omitempty"`
	IsPotentialMEV bool         `json:"isPotentialMev"`
	MEVType     string          `json:"mevType,omitempty"` // "sandwich", "frontrun", "backrun"
}

// KillSwitchEvent represents a kill switch trigger
type KillSwitchEvent struct {
	BaseEvent
	Reason      string          `json:"reason"`
	TriggerType string          `json:"triggerType"`
	Threshold   decimal.Decimal `json:"threshold"`
	Current     decimal.Decimal `json:"current"`
}

// EventQueue is a priority queue for events
type EventQueue struct {
	events []Event
}

// NewEventQueue creates a new event queue
func NewEventQueue() *EventQueue {
	return &EventQueue{
		events: make([]Event, 0, 10000),
	}
}

// Push adds an event to the queue
func (q *EventQueue) Push(e Event) {
	// Find insertion point (maintain sorted order by timestamp, then priority)
	i := len(q.events)
	for i > 0 {
		prev := q.events[i-1]
		if e.GetTimestamp().After(prev.GetTimestamp()) {
			break
		}
		if e.GetTimestamp().Equal(prev.GetTimestamp()) && e.GetPriority() >= prev.GetPriority() {
			break
		}
		i--
	}
	
	// Insert at position i
	q.events = append(q.events, nil)
	copy(q.events[i+1:], q.events[i:])
	q.events[i] = e
}

// Pop removes and returns the next event
func (q *EventQueue) Pop() Event {
	if len(q.events) == 0 {
		return nil
	}
	e := q.events[0]
	q.events = q.events[1:]
	return e
}

// Peek returns the next event without removing it
func (q *EventQueue) Peek() Event {
	if len(q.events) == 0 {
		return nil
	}
	return q.events[0]
}

// Len returns the number of events in the queue
func (q *EventQueue) Len() int {
	return len(q.events)
}

// Clear removes all events from the queue
func (q *EventQueue) Clear() {
	q.events = q.events[:0]
}
