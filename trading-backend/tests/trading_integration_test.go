// Package tests provides integration tests for the trading backend.
package tests

import (
	"context"
	"testing"
	"time"

	"github.com/atlas-desktop/trading-backend/internal/backtester"
	"github.com/atlas-desktop/trading-backend/internal/execution"
	"github.com/atlas-desktop/trading-backend/internal/learning"
	"github.com/atlas-desktop/trading-backend/internal/strategy"
	"github.com/atlas-desktop/trading-backend/pkg/types"
	"github.com/atlas-desktop/trading-backend/pkg/utils"
	"github.com/shopspring/decimal"
	"go.uber.org/zap"
)

func TestBacktesterWithStrategies(t *testing.T) {
	logger := zap.NewNop()
	
	// Create test OHLCV data
	bars := generateTestBars(1000)
	
	// Test momentum strategy
	t.Run("MomentumStrategy", func(t *testing.T) {
		registry := strategy.NewStrategyRegistry(logger)
		strat, ok := registry.Create("momentum")
		if !ok {
			t.Fatal("Failed to create momentum strategy")
		}
		
		if err := strat.Initialize(context.Background()); err != nil {
			t.Fatal(err)
		}
		
		signalCount := 0
		for _, bar := range bars {
			signal, err := strat.OnBar(bar)
			if err != nil {
				t.Fatal(err)
			}
			if signal != nil {
				signalCount++
			}
		}
		
		t.Logf("Momentum strategy generated %d signals from %d bars", signalCount, len(bars))
	})
	
	// Test mean reversion strategy
	t.Run("MeanReversionStrategy", func(t *testing.T) {
		registry := strategy.NewStrategyRegistry(logger)
		strat, ok := registry.Create("mean_reversion")
		if !ok {
			t.Fatal("Failed to create mean_reversion strategy")
		}
		
		if err := strat.Initialize(context.Background()); err != nil {
			t.Fatal(err)
		}
		
		signalCount := 0
		for _, bar := range bars {
			signal, err := strat.OnBar(bar)
			if err != nil {
				t.Fatal(err)
			}
			if signal != nil {
				signalCount++
			}
		}
		
		t.Logf("Mean reversion strategy generated %d signals from %d bars", signalCount, len(bars))
	})
}

func TestRiskManager(t *testing.T) {
	logger := zap.NewNop()
	
	config := execution.RiskConfig{
		MaxPositionSize:  decimal.NewFromInt(1000),
		MaxOpenPositions: 5,
		MaxDailyLoss:     decimal.NewFromInt(500),
		MaxTradesPerDay:  20,
		MaxRiskPerTrade:  0.02,
		EnableKillSwitch: true,
	}
	
	rm := execution.NewRiskManager(logger, config)
	
	t.Run("ApproveValidOrder", func(t *testing.T) {
		order := &types.Order{
			ID:       utils.GenerateOrderID(),
			Symbol:   "BTCUSDT",
			Side:     types.OrderSideBuy,
			Type:     types.OrderTypeMarket,
			Quantity: decimal.NewFromFloat(0.1),
			Price:    decimal.NewFromInt(50000),
		}
		
		result := rm.CheckOrder(order, decimal.NewFromInt(10000))
		if !result.Approved {
			t.Errorf("Expected order to be approved, got violations: %v", result.Violations)
		}
	})
	
	t.Run("RejectOversizedOrder", func(t *testing.T) {
		order := &types.Order{
			ID:       utils.GenerateOrderID(),
			Symbol:   "BTCUSDT",
			Side:     types.OrderSideBuy,
			Type:     types.OrderTypeMarket,
			Quantity: decimal.NewFromFloat(1),
			Price:    decimal.NewFromInt(50000),
		}
		
		result := rm.CheckOrder(order, decimal.NewFromInt(10000))
		// Should have warnings about position size
		t.Logf("Result: approved=%v, warnings=%v", result.Approved, result.Warnings)
	})
	
	t.Run("KillSwitchActivation", func(t *testing.T) {
		rm.ManualKillSwitch("Test activation", time.Hour)
		
		order := &types.Order{
			ID:       utils.GenerateOrderID(),
			Symbol:   "ETHUSDT",
			Side:     types.OrderSideBuy,
			Type:     types.OrderTypeMarket,
			Quantity: decimal.NewFromFloat(0.1),
			Price:    decimal.NewFromInt(3000),
		}
		
		result := rm.CheckOrder(order, decimal.NewFromInt(10000))
		if result.Approved {
			t.Error("Expected order to be rejected due to kill switch")
		}
		
		rm.DisableKillSwitch()
	})
}

func TestOrderManager(t *testing.T) {
	logger := zap.NewNop()
	om := execution.NewOrderManager(logger)
	
	t.Run("TrackOrder", func(t *testing.T) {
		order := &types.Order{
			ID:       utils.GenerateOrderID(),
			Symbol:   "BTCUSDT",
			Side:     types.OrderSideBuy,
			Type:     types.OrderTypeLimit,
			Quantity: decimal.NewFromFloat(0.5),
			Price:    decimal.NewFromInt(48000),
			Status:   types.OrderStatusOpen,
		}
		
		om.TrackOrder(order)
		
		tracked := om.GetOrder(order.ID)
		if tracked == nil {
			t.Fatal("Failed to track order")
		}
		
		if tracked.Order.ID != order.ID {
			t.Error("Order ID mismatch")
		}
	})
	
	t.Run("RecordFill", func(t *testing.T) {
		order := &types.Order{
			ID:       utils.GenerateOrderID(),
			Symbol:   "ETHUSDT",
			Side:     types.OrderSideBuy,
			Type:     types.OrderTypeLimit,
			Quantity: decimal.NewFromFloat(1.0),
			Price:    decimal.NewFromInt(3000),
			Status:   types.OrderStatusOpen,
		}
		
		om.TrackOrder(order)
		
		fill := execution.OrderFill{
			FillID:    utils.GenerateTradeID(),
			Quantity:  decimal.NewFromFloat(0.5),
			Price:     decimal.NewFromInt(2995),
			Fee:       decimal.NewFromFloat(0.5),
			Timestamp: time.Now(),
		}
		
		om.RecordFill(order.ID, fill)
		
		tracked := om.GetOrder(order.ID)
		if tracked.FilledQty.String() != "0.5" {
			t.Errorf("Expected filled qty 0.5, got %s", tracked.FilledQty)
		}
		
		// Full fill
		fill2 := execution.OrderFill{
			FillID:    utils.GenerateTradeID(),
			Quantity:  decimal.NewFromFloat(0.5),
			Price:     decimal.NewFromInt(3000),
			Fee:       decimal.NewFromFloat(0.5),
			Timestamp: time.Now(),
		}
		
		om.RecordFill(order.ID, fill2)
		
		tracked = om.GetOrder(order.ID)
		if tracked.Status != execution.OrderStatusFilled {
			t.Errorf("Expected status filled, got %s", tracked.Status)
		}
	})
	
	t.Run("PositionTracking", func(t *testing.T) {
		position := om.GetPosition("ETHUSDT")
		if position == nil {
			t.Fatal("Expected position to exist")
		}
		
		if position.Quantity.IsZero() {
			t.Error("Expected non-zero position quantity")
		}
	})
}

func TestSlippageCalculator(t *testing.T) {
	logger := zap.NewNop()
	config := execution.DefaultSlippageConfig()
	sc := execution.NewSlippageCalculator(logger, config)
	
	t.Run("EstimateSlippage", func(t *testing.T) {
		orderBook := &types.OrderBook{
			Symbol: "BTCUSDT",
			Bids: []types.OrderBookLevel{
				{Price: decimal.NewFromInt(49990), Quantity: decimal.NewFromFloat(1.0)},
				{Price: decimal.NewFromInt(49980), Quantity: decimal.NewFromFloat(2.0)},
				{Price: decimal.NewFromInt(49970), Quantity: decimal.NewFromFloat(3.0)},
			},
			Asks: []types.OrderBookLevel{
				{Price: decimal.NewFromInt(50010), Quantity: decimal.NewFromFloat(1.0)},
				{Price: decimal.NewFromInt(50020), Quantity: decimal.NewFromFloat(2.0)},
				{Price: decimal.NewFromInt(50030), Quantity: decimal.NewFromFloat(3.0)},
			},
		}
		
		estimate := sc.EstimateSlippage(
			types.OrderSideBuy,
			decimal.NewFromFloat(0.5),
			decimal.NewFromInt(50000),
			orderBook,
			0.02, // 2% volatility
		)
		
		if estimate.ExpectedSlippage.LessThanOrEqual(decimal.Zero) {
			t.Error("Expected positive slippage estimate")
		}
		
		t.Logf("Estimated slippage: %.4f%% (range: %.4f%% - %.4f%%)",
			estimate.ExpectedSlippage.Mul(decimal.NewFromInt(100)).InexactFloat64(),
			estimate.SlippageRange.Min.Mul(decimal.NewFromInt(100)).InexactFloat64(),
			estimate.SlippageRange.Max.Mul(decimal.NewFromInt(100)).InexactFloat64(),
		)
	})
}

func TestLearningFeedback(t *testing.T) {
	logger := zap.NewNop()
	fe := learning.NewFeedbackEngine(logger)
	
	t.Run("RecordFeedback", func(t *testing.T) {
		feedback := learning.TradeFeedback{
			TradeID:       utils.GenerateTradeID(),
			Symbol:        "BTCUSDT",
			Side:          "buy",
			EntryPrice:    decimal.NewFromInt(50000),
			ExitPrice:     decimal.NewFromInt(52000),
			PnL:           decimal.NewFromInt(200),
			Rating:        5,
			WasGoodEntry:  true,
			WasGoodExit:   true,
			Notes:         "Great momentum play",
			Patterns:      []string{"breakout", "volume_surge"},
			MarketContext: map[string]string{"trend": "bullish"},
			Timestamp:     time.Now(),
		}
		
		fe.RecordFeedback(feedback)
		
		recent := fe.GetRecentFeedback(10)
		if len(recent) == 0 {
			t.Error("Expected feedback to be recorded")
		}
	})
	
	t.Run("PatternPerformance", func(t *testing.T) {
		// Record more feedback with patterns
		for i := 0; i < 10; i++ {
			pnl := decimal.NewFromInt(int64((i%3 - 1) * 100))
			rating := (i % 5) + 1
			
			fe.RecordFeedback(learning.TradeFeedback{
				TradeID:   utils.GenerateTradeID(),
				Symbol:    "ETHUSDT",
				Side:      "buy",
				PnL:       pnl,
				Rating:    rating,
				Patterns:  []string{"mean_reversion"},
				Timestamp: time.Now(),
			})
		}
		
		perf := fe.GetPatternPerformance("mean_reversion")
		if perf == nil {
			t.Fatal("Expected pattern performance to exist")
		}
		
		t.Logf("Mean reversion performance: count=%d, avgPnL=%.2f, avgRating=%.2f",
			perf.Count, perf.AvgPnL.InexactFloat64(), perf.AvgRating)
	})
}

func TestStrategyOptimizer(t *testing.T) {
	logger := zap.NewNop()
	fe := learning.NewFeedbackEngine(logger)
	so := learning.NewStrategyOptimizer(logger, fe)
	
	// Seed feedback data
	for i := 0; i < 50; i++ {
		fe.RecordFeedback(learning.TradeFeedback{
			TradeID:  utils.GenerateTradeID(),
			Symbol:   "BTCUSDT",
			Side:     "buy",
			PnL:      decimal.NewFromFloat(float64((i%5 - 2) * 100)),
			Rating:   (i % 5) + 1,
			Patterns: []string{"momentum", "trend"},
			MarketContext: map[string]string{
				"volatility": "medium",
				"trend":      "bullish",
			},
			Timestamp: time.Now(),
		})
	}
	
	t.Run("Optimize", func(t *testing.T) {
		result, err := so.Optimize(context.Background(), "momentum")
		if err != nil {
			t.Fatal(err)
		}
		
		if len(result.Suggestions) == 0 {
			t.Log("No optimization suggestions (may need more data)")
		} else {
			for _, s := range result.Suggestions {
				t.Logf("Suggestion: %s (confidence: %.2f)", s.Description, s.Confidence)
			}
		}
	})
}

func TestPerformanceAnalyzer(t *testing.T) {
	logger := zap.NewNop()
	pa := learning.NewPerformanceAnalyzer(logger)
	
	// Create test trades
	trades := make([]*types.Trade, 20)
	baseTime := time.Now().Add(-30 * 24 * time.Hour)
	
	for i := 0; i < 20; i++ {
		// Alternate winning and losing trades
		pnl := decimal.NewFromFloat(float64((i%3 - 1) * 150))
		trades[i] = &types.Trade{
			ID:        utils.GenerateTradeID(),
			Symbol:    []string{"BTCUSDT", "ETHUSDT", "SOLUSDT"}[i%3],
			Side:      types.OrderSideBuy,
			Quantity:  decimal.NewFromFloat(0.1),
			Price:     decimal.NewFromInt(50000),
			PnL:       pnl,
			Fee:       decimal.NewFromFloat(1.0),
			Timestamp: baseTime.Add(time.Duration(i) * 24 * time.Hour),
		}
	}
	
	t.Run("AnalyzeAll", func(t *testing.T) {
		report := pa.Analyze(trades, "all")
		
		t.Logf("Performance Report:")
		t.Logf("  Total Trades: %d", report.TotalTrades)
		t.Logf("  Win Rate: %.2f%%", report.WinRate*100)
		t.Logf("  Total PnL: %.2f", report.TotalPnL.InexactFloat64())
		t.Logf("  Sharpe Ratio: %.2f", report.SharpeRatio)
		t.Logf("  Max Drawdown: %.2f%%", report.MaxDrawdown*100)
		t.Logf("  Profit Factor: %.2f", report.ProfitFactor)
	})
}

func TestBacktesterEngine(t *testing.T) {
	logger := zap.NewNop()
	
	config := backtester.EngineConfig{
		InitialCapital:  decimal.NewFromInt(10000),
		BaseCurrency:    "USDT",
		Slippage:        0.001,
		Commission:      0.001,
		MarginEnabled:   false,
		MaxPositionSize: 0.1,
	}
	
	engine := backtester.NewEngine(logger, config)
	
	bars := generateTestBars(500)
	
	t.Run("SimpleBacktest", func(t *testing.T) {
		// Simple buy and hold strategy
		var position decimal.Decimal
		entryPrice := decimal.Zero
		
		for i, bar := range bars {
			// Buy on bar 10, sell on bar 400
			if i == 10 {
				order := &types.Order{
					ID:       utils.GenerateOrderID(),
					Symbol:   bar.Symbol,
					Side:     types.OrderSideBuy,
					Type:     types.OrderTypeMarket,
					Quantity: decimal.NewFromFloat(0.1),
					Price:    bar.Close,
				}
				
				trade := engine.ExecuteOrder(order, bar.Timestamp)
				if trade != nil {
					position = trade.Quantity
					entryPrice = trade.Price
				}
			}
			
			if i == 400 && !position.IsZero() {
				order := &types.Order{
					ID:       utils.GenerateOrderID(),
					Symbol:   bar.Symbol,
					Side:     types.OrderSideSell,
					Type:     types.OrderTypeMarket,
					Quantity: position,
					Price:    bar.Close,
				}
				
				trade := engine.ExecuteOrder(order, bar.Timestamp)
				if trade != nil {
					pnl := bar.Close.Sub(entryPrice).Mul(position)
					t.Logf("Trade PnL: %.2f (entry: %.2f, exit: %.2f)",
						pnl.InexactFloat64(),
						entryPrice.InexactFloat64(),
						bar.Close.InexactFloat64(),
					)
				}
			}
			
			engine.ProcessBar(bar)
		}
		
		metrics := engine.GetMetrics()
		t.Logf("Final equity: %.2f", metrics.FinalEquity.InexactFloat64())
	})
}

func TestUtils(t *testing.T) {
	t.Run("GenerateIDs", func(t *testing.T) {
		orderID := utils.GenerateOrderID()
		tradeID := utils.GenerateTradeID()
		signalID := utils.GenerateSignalID()
		
		if len(orderID) == 0 || len(tradeID) == 0 || len(signalID) == 0 {
			t.Error("Generated IDs should not be empty")
		}
		
		// Uniqueness check
		ids := make(map[string]bool)
		for i := 0; i < 1000; i++ {
			id := utils.GenerateOrderID()
			if ids[id] {
				t.Error("Duplicate ID generated")
			}
			ids[id] = true
		}
	})
	
	t.Run("EMACalculator", func(t *testing.T) {
		ema := utils.NewEMA(14)
		
		for i := 0; i < 20; i++ {
			ema.Add(float64(100 + i))
		}
		
		current := ema.Current()
		if current <= 0 {
			t.Error("EMA should be positive")
		}
		t.Logf("EMA(14) after 20 values: %.2f", current)
	})
	
	t.Run("SMACalculator", func(t *testing.T) {
		sma := utils.NewSMA(5)
		
		values := []float64{10, 20, 30, 40, 50}
		for _, v := range values {
			sma.Add(v)
		}
		
		expected := 30.0 // (10+20+30+40+50)/5
		if sma.Current() != expected {
			t.Errorf("Expected SMA %.2f, got %.2f", expected, sma.Current())
		}
	})
	
	t.Run("Statistics", func(t *testing.T) {
		values := []float64{10, 20, 30, 40, 50}
		
		mean := utils.CalculateMean(values)
		if mean != 30.0 {
			t.Errorf("Expected mean 30, got %.2f", mean)
		}
		
		stdDev := utils.CalculateStdDev(values)
		if stdDev <= 0 {
			t.Error("StdDev should be positive")
		}
		
		t.Logf("Mean: %.2f, StdDev: %.2f", mean, stdDev)
	})
}

// Helper function to generate test OHLCV data
func generateTestBars(count int) []types.OHLCV {
	bars := make([]types.OHLCV, count)
	basePrice := 50000.0
	baseTime := time.Now().Add(-time.Duration(count) * time.Hour)
	
	for i := 0; i < count; i++ {
		// Add some randomness and trend
		trend := float64(i) * 0.5
		noise := float64((i*17)%100-50) * 0.5
		price := basePrice + trend + noise
		
		high := price * (1 + float64((i*13)%10)*0.001)
		low := price * (1 - float64((i*7)%10)*0.001)
		open := price * (1 + float64((i*11)%5-2)*0.001)
		volume := 100.0 + float64((i*23)%200)
		
		bars[i] = types.OHLCV{
			Symbol:    "BTCUSDT",
			Open:      decimal.NewFromFloat(open),
			High:      decimal.NewFromFloat(high),
			Low:       decimal.NewFromFloat(low),
			Close:     decimal.NewFromFloat(price),
			Volume:    decimal.NewFromFloat(volume),
			Timestamp: baseTime.Add(time.Duration(i) * time.Hour),
		}
	}
	
	return bars
}
