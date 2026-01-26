// Package types provides shared type definitions for the trading backend.
package types

import (
	"time"

	"github.com/shopspring/decimal"
)

// OrderSide represents buy or sell
type OrderSide string

const (
	OrderSideBuy  OrderSide = "buy"
	OrderSideSell OrderSide = "sell"
)

// OrderType represents the type of order
type OrderType string

const (
	OrderTypeMarket     OrderType = "market"
	OrderTypeLimit      OrderType = "limit"
	OrderTypeStopLimit  OrderType = "stop_limit"
	OrderTypeStopMarket OrderType = "stop_market"
	OrderTypeStopLoss   OrderType = "stop_loss"
	OrderTypeTakeProfit OrderType = "take_profit"
)

// OrderStatus represents the status of an order
type OrderStatus string

const (
	OrderStatusPending        OrderStatus = "pending"
	OrderStatusOpen           OrderStatus = "open"
	OrderStatusFilled         OrderStatus = "filled"
	OrderStatusPartiallyFilled OrderStatus = "partially_filled"
	OrderStatusPartial        OrderStatus = "partial"
	OrderStatusCancelled      OrderStatus = "cancelled"
	OrderStatusRejected       OrderStatus = "rejected"
	OrderStatusExpired        OrderStatus = "expired"
)

// PositionSide represents long or short position
type PositionSide string

const (
	PositionSideLong  PositionSide = "long"
	PositionSideShort PositionSide = "short"
)

// SignalType represents the type of trading signal
type SignalType string

const (
	SignalTypeEntry SignalType = "entry"
	SignalTypeExit  SignalType = "exit"
	SignalTypeScale SignalType = "scale"
)

// Timeframe represents trading timeframes
type Timeframe string

const (
	Timeframe1m  Timeframe = "1m"
	Timeframe5m  Timeframe = "5m"
	Timeframe15m Timeframe = "15m"
	Timeframe1h  Timeframe = "1h"
	Timeframe4h  Timeframe = "4h"
	Timeframe1d  Timeframe = "1d"
)

// OHLCV represents a single candlestick
type OHLCV struct {
	Timestamp time.Time       `json:"timestamp"`
	Open      decimal.Decimal `json:"open"`
	High      decimal.Decimal `json:"high"`
	Low       decimal.Decimal `json:"low"`
	Close     decimal.Decimal `json:"close"`
	Volume    decimal.Decimal `json:"volume"`
}

// Tick represents a single trade/tick
type Tick struct {
	Timestamp time.Time       `json:"timestamp"`
	Price     decimal.Decimal `json:"price"`
	Size      decimal.Decimal `json:"size"`
	Side      OrderSide       `json:"side"`
	TradeID   string          `json:"tradeId"`
}

// Order represents a trading order
type Order struct {
	ID            string          `json:"id"`
	ClientOrderID string          `json:"clientOrderId,omitempty"`
	Symbol        string          `json:"symbol"`
	Side          OrderSide       `json:"side"`
	Type          OrderType       `json:"type"`
	Quantity      decimal.Decimal `json:"quantity"`
	Price         decimal.Decimal `json:"price,omitempty"`
	StopPrice     decimal.Decimal `json:"stopPrice,omitempty"`
	Status        OrderStatus     `json:"status"`
	FilledQty     decimal.Decimal `json:"filledQty"`
	AvgFillPrice  decimal.Decimal `json:"avgFillPrice"`
	Commission    decimal.Decimal `json:"commission"`
	CreatedAt     time.Time       `json:"createdAt"`
	UpdatedAt     time.Time       `json:"updatedAt"`
	FilledAt      *time.Time      `json:"filledAt,omitempty"`
}

// Position represents an open position
type Position struct {
	Symbol        string          `json:"symbol"`
	Side          PositionSide    `json:"side"`
	Quantity      decimal.Decimal `json:"quantity"`
	EntryPrice    decimal.Decimal `json:"entryPrice"`
	CurrentPrice  decimal.Decimal `json:"currentPrice"`
	UnrealizedPnL decimal.Decimal `json:"unrealizedPnl"`
	RealizedPnL   decimal.Decimal `json:"realizedPnl"`
	StopLoss      decimal.Decimal `json:"stopLoss,omitempty"`
	TakeProfit    decimal.Decimal `json:"takeProfit,omitempty"`
	OpenedAt      time.Time       `json:"openedAt"`
}

// OrderBook represents an order book snapshot
type OrderBook struct {
	Symbol    string           `json:"symbol"`
	Bids      []OrderBookLevel `json:"bids"`
	Asks      []OrderBookLevel `json:"asks"`
	Timestamp time.Time        `json:"timestamp"`
}

// OrderBookLevel represents a price level in the order book
type OrderBookLevel struct {
	Price    decimal.Decimal `json:"price"`
	Quantity decimal.Decimal `json:"quantity"`
}

// Trade represents an executed trade
type Trade struct {
	ID           string          `json:"id"`
	OrderID      string          `json:"orderId"`
	Symbol       string          `json:"symbol"`
	Side         OrderSide       `json:"side"`
	Quantity     decimal.Decimal `json:"quantity"`
	Price        decimal.Decimal `json:"price"`
	Commission   decimal.Decimal `json:"commission"`
	Slippage     decimal.Decimal `json:"slippage"`
	PnL          decimal.Decimal `json:"pnl"`
	ExecutedAt   time.Time       `json:"executedAt"`
	BlockNumber  uint64          `json:"blockNumber,omitempty"`
	TxHash       string          `json:"txHash,omitempty"`
}

// Signal represents a trading signal
type Signal struct {
	ID         string          `json:"id"`
	Symbol     string          `json:"symbol"`
	Type       SignalType      `json:"type"`
	Side       OrderSide       `json:"side"`
	Price      decimal.Decimal `json:"price"`
	Confidence decimal.Decimal `json:"confidence"`
	Source     string          `json:"source"`
	Timeframe  Timeframe       `json:"timeframe"`
	Indicators map[string]any  `json:"indicators"`
	CreatedAt  time.Time       `json:"createdAt"`
	ExpiresAt  time.Time       `json:"expiresAt"`
}

// Portfolio represents the current portfolio state
type Portfolio struct {
	Cash       decimal.Decimal      `json:"cash"`
	Equity     decimal.Decimal      `json:"equity"`
	Positions  map[string]*Position `json:"positions"`
	TotalPnL   decimal.Decimal      `json:"totalPnl"`
	DailyPnL   decimal.Decimal      `json:"dailyPnl"`
	UpdatedAt  time.Time            `json:"updatedAt"`
}

// PerformanceMetrics represents backtest performance metrics
type PerformanceMetrics struct {
	TotalReturn      decimal.Decimal `json:"totalReturn"`
	AnnualizedReturn decimal.Decimal `json:"annualizedReturn"`
	SharpeRatio      decimal.Decimal `json:"sharpeRatio"`
	SortinoRatio     decimal.Decimal `json:"sortinoRatio"`
	MaxDrawdown      decimal.Decimal `json:"maxDrawdown"`
	MaxDrawdownDate  time.Time       `json:"maxDrawdownDate"`
	WinRate          decimal.Decimal `json:"winRate"`
	ProfitFactor     decimal.Decimal `json:"profitFactor"`
	TotalTrades      int             `json:"totalTrades"`
	WinningTrades    int             `json:"winningTrades"`
	LosingTrades     int             `json:"losingTrades"`
	AvgWin           decimal.Decimal `json:"avgWin"`
	AvgLoss          decimal.Decimal `json:"avgLoss"`
	LargestWin       decimal.Decimal `json:"largestWin"`
	LargestLoss      decimal.Decimal `json:"largestLoss"`
	AvgHoldingTime   time.Duration   `json:"avgHoldingTime"`
	Expectancy       decimal.Decimal `json:"expectancy"`
	CalmarRatio      decimal.Decimal `json:"calmarRatio"`
}

// RiskMetrics represents risk-related metrics
type RiskMetrics struct {
	VaR95            decimal.Decimal `json:"var95"`
	VaR99            decimal.Decimal `json:"var99"`
	CVaR95           decimal.Decimal `json:"cvar95"`
	DailyVolatility  decimal.Decimal `json:"dailyVolatility"`
	AnnualVolatility decimal.Decimal `json:"annualVolatility"`
	Beta             decimal.Decimal `json:"beta"`
	Alpha            decimal.Decimal `json:"alpha"`
	Correlation      decimal.Decimal `json:"correlation"`
}

// EquityCurvePoint represents a point on the equity curve
type EquityCurvePoint struct {
	Timestamp time.Time       `json:"timestamp"`
	Equity    decimal.Decimal `json:"equity"`
	Cash      decimal.Decimal `json:"cash"`
	Drawdown  decimal.Decimal `json:"drawdown"`
}

// MonteCarloResult represents Monte Carlo simulation results
type MonteCarloResult struct {
	Iterations       int               `json:"iterations"`
	MedianReturn     decimal.Decimal   `json:"medianReturn"`
	P5Return         decimal.Decimal   `json:"p5Return"`
	P95Return        decimal.Decimal   `json:"p95Return"`
	ProbabilityRuin  decimal.Decimal   `json:"probabilityRuin"`
	MaxDrawdownP95   decimal.Decimal   `json:"maxDrawdownP95"`
	Distribution     []decimal.Decimal `json:"distribution"`
}

// WalkForwardResult represents walk-forward analysis results
type WalkForwardResult struct {
	Windows        []WalkForwardWindow  `json:"windows"`
	OverallMetrics *PerformanceMetrics  `json:"overallMetrics"`
	Robustness     decimal.Decimal      `json:"robustness"`
}

// WalkForwardWindow represents a single walk-forward window
type WalkForwardWindow struct {
	InSampleStart   time.Time           `json:"inSampleStart"`
	InSampleEnd     time.Time           `json:"inSampleEnd"`
	OutSampleStart  time.Time           `json:"outSampleStart"`
	OutSampleEnd    time.Time           `json:"outSampleEnd"`
	InSampleMetrics *PerformanceMetrics `json:"inSampleMetrics"`
	OutSampleMetrics *PerformanceMetrics `json:"outSampleMetrics"`
}
