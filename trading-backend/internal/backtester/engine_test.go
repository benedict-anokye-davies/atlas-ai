// Package backtester_test provides tests for the backtesting engine.
package backtester_test

import (
	"context"
	"testing"
	"time"

	"github.com/atlas-desktop/trading-backend/internal/backtester"
	"github.com/atlas-desktop/trading-backend/internal/data"
	"github.com/atlas-desktop/trading-backend/pkg/types"
	"github.com/shopspring/decimal"
	"go.uber.org/zap"
)

func TestEngineRun(t *testing.T) {
	logger := zap.NewNop()
	
	// Create data store with test data
	dataStore, err := data.NewStore(logger, t.TempDir())
	if err != nil {
		t.Fatalf("Failed to create data store: %v", err)
	}
	
	// Create slippage model
	slippageModel := backtester.NewFixedSlippage(decimal.NewFromInt(10))
	
	// Create engine
	engine := backtester.NewEngine(logger, dataStore, slippageModel)
	
	// Create backtest config
	config := &types.BacktestConfig{
		ID:             "test-backtest",
		Symbols:        []string{"SOL/USDT"},
		StartDate:      time.Now().AddDate(0, -1, 0),
		EndDate:        time.Now(),
		Timeframe:      types.Timeframe1h,
		InitialCapital: decimal.NewFromInt(10000),
		Commission:     decimal.NewFromFloat(0.001),
		RiskLimits: types.RiskLimits{
			MaxPositionSize:  decimal.NewFromFloat(0.1),
			MaxDrawdown:      decimal.NewFromFloat(0.2),
			MaxDailyLoss:     decimal.NewFromFloat(0.05),
			MaxOpenPositions: 5,
		},
	}
	
	// Run backtest
	ctx := context.Background()
	result, err := engine.Run(ctx, config)
	if err != nil {
		t.Fatalf("Backtest failed: %v", err)
	}
	
	// Verify result
	if result == nil {
		t.Fatal("Result is nil")
	}
	
	if result.ID != config.ID {
		t.Errorf("Expected ID %s, got %s", config.ID, result.ID)
	}
	
	if result.EventsProcessed == 0 {
		t.Error("No events were processed")
	}
	
	t.Logf("Backtest completed: %d events processed, %d trades",
		result.EventsProcessed, len(result.Trades))
}

func TestPortfolio(t *testing.T) {
	portfolio := backtester.NewPortfolio(decimal.NewFromInt(10000))
	
	// Test initial state
	if !portfolio.GetCash().Equal(decimal.NewFromInt(10000)) {
		t.Errorf("Initial cash incorrect: %s", portfolio.GetCash())
	}
	
	if !portfolio.GetEquity().Equal(decimal.NewFromInt(10000)) {
		t.Errorf("Initial equity incorrect: %s", portfolio.GetEquity())
	}
	
	// Test buy
	portfolio.Buy("SOL/USDT", decimal.NewFromInt(10), decimal.NewFromInt(100), decimal.NewFromInt(1))
	
	expectedCash := decimal.NewFromInt(10000 - 1000 - 1) // 10 * 100 + 1 commission
	if !portfolio.GetCash().Equal(expectedCash) {
		t.Errorf("Cash after buy incorrect: expected %s, got %s", expectedCash, portfolio.GetCash())
	}
	
	// Verify position
	pos := portfolio.GetPosition("SOL/USDT")
	if pos == nil {
		t.Fatal("Position not created")
	}
	
	if !pos.Quantity.Equal(decimal.NewFromInt(10)) {
		t.Errorf("Position quantity incorrect: %s", pos.Quantity)
	}
	
	// Test price update
	portfolio.UpdatePrice("SOL/USDT", decimal.NewFromInt(110))
	
	// Equity should be cash + position value
	expectedEquity := expectedCash.Add(decimal.NewFromInt(10 * 110))
	if !portfolio.GetEquity().Equal(expectedEquity) {
		t.Errorf("Equity after price update incorrect: expected %s, got %s",
			expectedEquity, portfolio.GetEquity())
	}
	
	// Test sell
	pnl := portfolio.Sell("SOL/USDT", decimal.NewFromInt(10), decimal.NewFromInt(110), decimal.NewFromInt(1))
	
	// PnL should be (110 - 100) * 10 - 1 commission = 99
	expectedPnL := decimal.NewFromInt(99)
	if !pnl.Equal(expectedPnL) {
		t.Errorf("PnL incorrect: expected %s, got %s", expectedPnL, pnl)
	}
	
	// Position should be closed
	if portfolio.GetPosition("SOL/USDT") != nil {
		t.Error("Position should be closed after full sell")
	}
}

func TestSlippageModels(t *testing.T) {
	// Test fixed slippage
	fixed := backtester.NewFixedSlippage(decimal.NewFromInt(10))
	slip := fixed.Calculate(nil, nil)
	
	expected := decimal.NewFromFloat(0.001) // 10 bps = 0.1%
	if !slip.Equal(expected) {
		t.Errorf("Fixed slippage incorrect: expected %s, got %s", expected, slip)
	}
	
	// Test volume-weighted slippage
	vw := backtester.NewVolumeWeightedSlippage(
		decimal.NewFromInt(10),
		decimal.NewFromFloat(0.1),
		decimal.NewFromFloat(0.1),
	)
	
	// Without market data, should return base slippage
	slip = vw.Calculate(nil, nil)
	if slip.LessThan(expected) {
		t.Errorf("Volume-weighted slippage should be at least base: %s", slip)
	}
}

func TestMetricsCalculator(t *testing.T) {
	calc := backtester.NewMetricsCalculator()
	
	// Create some test trades
	trades := []*types.Trade{
		{PnL: decimal.NewFromInt(100)},
		{PnL: decimal.NewFromInt(50)},
		{PnL: decimal.NewFromInt(-30)},
		{PnL: decimal.NewFromInt(80)},
		{PnL: decimal.NewFromInt(-20)},
	}
	
	// Create equity curve
	equityCurve := []types.EquityCurvePoint{
		{Timestamp: time.Now().Add(-5 * time.Hour), Equity: decimal.NewFromInt(10000)},
		{Timestamp: time.Now().Add(-4 * time.Hour), Equity: decimal.NewFromInt(10100)},
		{Timestamp: time.Now().Add(-3 * time.Hour), Equity: decimal.NewFromInt(10150)},
		{Timestamp: time.Now().Add(-2 * time.Hour), Equity: decimal.NewFromInt(10120)},
		{Timestamp: time.Now().Add(-1 * time.Hour), Equity: decimal.NewFromInt(10200)},
		{Timestamp: time.Now(), Equity: decimal.NewFromInt(10180)},
	}
	
	metrics := calc.Calculate(trades, equityCurve, decimal.NewFromInt(10000))
	
	// Verify basic metrics
	if metrics.TotalTrades != 5 {
		t.Errorf("Total trades incorrect: %d", metrics.TotalTrades)
	}
	
	if metrics.WinningTrades != 3 {
		t.Errorf("Winning trades incorrect: %d", metrics.WinningTrades)
	}
	
	if metrics.LosingTrades != 2 {
		t.Errorf("Losing trades incorrect: %d", metrics.LosingTrades)
	}
	
	expectedWinRate := decimal.NewFromFloat(0.6) // 3/5
	if !metrics.WinRate.Equal(expectedWinRate) {
		t.Errorf("Win rate incorrect: expected %s, got %s", expectedWinRate, metrics.WinRate)
	}
	
	// Verify return calculation
	expectedReturn := decimal.NewFromFloat(0.018) // (10180 - 10000) / 10000
	if metrics.TotalReturn.Sub(expectedReturn).Abs().GreaterThan(decimal.NewFromFloat(0.001)) {
		t.Errorf("Total return incorrect: expected ~%s, got %s", expectedReturn, metrics.TotalReturn)
	}
}

func TestMonteCarloSimulator(t *testing.T) {
	logger := zap.NewNop()
	
	config := types.MonteCarloConfig{
		Enabled:         true,
		Iterations:      100,
		ConfidenceLevel: decimal.NewFromFloat(0.95),
	}
	
	mc := backtester.NewMonteCarloSimulator(logger, config)
	
	// Create test trades
	trades := make([]*types.Trade, 50)
	for i := 0; i < 50; i++ {
		pnl := decimal.NewFromInt(int64((i%3-1) * 10)) // -10, 0, 10 pattern
		trades[i] = &types.Trade{PnL: pnl}
	}
	
	result := mc.Run(trades)
	
	if result.Iterations != 100 {
		t.Errorf("Iterations incorrect: %d", result.Iterations)
	}
	
	// P5 should be less than median, P95 should be greater
	if result.P5Return.GreaterThan(result.MedianReturn) {
		t.Error("P5 should be less than median")
	}
	
	if result.P95Return.LessThan(result.MedianReturn) {
		t.Error("P95 should be greater than median")
	}
	
	t.Logf("Monte Carlo: P5=%s, Median=%s, P95=%s, Ruin=%s",
		result.P5Return, result.MedianReturn, result.P95Return, result.ProbabilityRuin)
}
