// Package integration_test provides end-to-end integration tests.
package integration_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/atlas-desktop/trading-backend/internal/api"
	"github.com/atlas-desktop/trading-backend/internal/backtester"
	"github.com/atlas-desktop/trading-backend/internal/data"
	"github.com/atlas-desktop/trading-backend/pkg/types"
	"github.com/gorilla/websocket"
	"github.com/shopspring/decimal"
	"go.uber.org/zap"
)

// TestFullBacktestWorkflow tests the complete flow from API request to results.
func TestFullBacktestWorkflow(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}
	
	logger, _ := zap.NewDevelopment()
	defer logger.Sync()
	
	// Setup data store
	dataStore, err := data.NewStore(logger, t.TempDir())
	if err != nil {
		t.Fatalf("Failed to create data store: %v", err)
	}
	
	// Generate substantial sample data
	dataStore.GenerateSampleData()
	
	// Create engine
	slippage := backtester.NewVolumeWeightedSlippage(
		decimal.NewFromInt(10),
		decimal.NewFromFloat(0.1),
		decimal.NewFromFloat(0.1),
	)
	engine := backtester.NewEngine(logger, dataStore, slippage)
	
	// Create and start server
	server := api.NewServer(logger, engine, dataStore)
	go func() {
		if err := server.Start(":18082"); err != http.ErrServerClosed {
			t.Logf("Server error: %v", err)
		}
	}()
	
	// Wait for server to start
	time.Sleep(100 * time.Millisecond)
	
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		server.Shutdown(ctx)
	}()
	
	baseURL := "http://localhost:18082"
	
	// Step 1: Check health
	t.Log("Step 1: Health check")
	resp, err := http.Get(baseURL + "/health")
	if err != nil {
		t.Fatalf("Health check failed: %v", err)
	}
	resp.Body.Close()
	
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("Health check returned %d", resp.StatusCode)
	}
	
	// Step 2: List available symbols
	t.Log("Step 2: Get symbols")
	resp, err = http.Get(baseURL + "/api/v1/symbols")
	if err != nil {
		t.Fatalf("Get symbols failed: %v", err)
	}
	
	var symbols []string
	json.NewDecoder(resp.Body).Decode(&symbols)
	resp.Body.Close()
	
	t.Logf("Available symbols: %v", symbols)
	
	if len(symbols) == 0 {
		t.Fatal("No symbols available")
	}
	
	// Step 3: Get historical data
	t.Log("Step 3: Get historical data")
	symbol := symbols[0]
	startTime := time.Now().AddDate(0, -1, 0).Format(time.RFC3339)
	endTime := time.Now().Format(time.RFC3339)
	
	historyURL := baseURL + "/api/v1/data/history?symbol=" + symbol +
		"&timeframe=1h&start=" + startTime + "&end=" + endTime
	
	resp, err = http.Get(historyURL)
	if err != nil {
		t.Fatalf("Get history failed: %v", err)
	}
	
	var ohlcv []types.OHLCV
	json.NewDecoder(resp.Body).Decode(&ohlcv)
	resp.Body.Close()
	
	t.Logf("Retrieved %d bars for %s", len(ohlcv), symbol)
	
	// Step 4: Run backtest via HTTP
	t.Log("Step 4: Run backtest")
	config := types.BacktestConfig{
		ID:             "integration-test-" + time.Now().Format("20060102150405"),
		Symbols:        []string{symbol},
		StartDate:      time.Now().AddDate(0, -1, 0),
		EndDate:        time.Now(),
		Timeframe:      types.Timeframe1h,
		InitialCapital: decimal.NewFromInt(10000),
		Commission:     decimal.NewFromFloat(0.001),
		Strategy: types.StrategyConfig{
			Type:        "sma_crossover",
			FastPeriod:  10,
			SlowPeriod:  30,
			TakeProfit:  decimal.NewFromFloat(0.05),
			StopLoss:    decimal.NewFromFloat(0.02),
			TrailingStop: decimal.NewFromFloat(0.03),
		},
		Slippage: types.SlippageConfig{
			Model:    "volume_weighted",
			BaseBps:  10,
			ImpactFactor: decimal.NewFromFloat(0.1),
		},
		RiskLimits: types.RiskLimits{
			MaxPositionSize:  decimal.NewFromFloat(0.2),
			MaxDrawdown:      decimal.NewFromFloat(0.3),
			MaxDailyLoss:     decimal.NewFromFloat(0.1),
			MaxOpenPositions: 3,
		},
	}
	
	configJSON, _ := json.Marshal(config)
	
	resp, err = http.Post(baseURL+"/api/v1/backtest/run", "application/json", bytes.NewReader(configJSON))
	if err != nil {
		t.Fatalf("Run backtest failed: %v", err)
	}
	
	var result map[string]string
	json.NewDecoder(resp.Body).Decode(&result)
	resp.Body.Close()
	
	backtestID := result["id"]
	t.Logf("Backtest started: %s", backtestID)
	
	// Step 5: Poll for status
	t.Log("Step 5: Check status")
	
	for i := 0; i < 30; i++ {
		time.Sleep(500 * time.Millisecond)
		
		resp, err = http.Get(baseURL + "/api/v1/backtest/status?id=" + backtestID)
		if err != nil {
			t.Logf("Status check error: %v", err)
			continue
		}
		
		var status types.BacktestResult
		json.NewDecoder(resp.Body).Decode(&status)
		resp.Body.Close()
		
		t.Logf("Status: %s, Progress: %.1f%%, Events: %d",
			status.Status, status.Progress*100, status.EventsProcessed)
		
		if status.Status == "completed" || status.Status == "failed" {
			break
		}
	}
	
	// Step 6: Get final results
	t.Log("Step 6: Get results")
	resp, err = http.Get(baseURL + "/api/v1/backtest/status?id=" + backtestID)
	if err != nil {
		t.Fatalf("Get results failed: %v", err)
	}
	
	var finalResult types.BacktestResult
	json.NewDecoder(resp.Body).Decode(&finalResult)
	resp.Body.Close()
	
	t.Logf("Final Results:")
	t.Logf("  Status: %s", finalResult.Status)
	t.Logf("  Events Processed: %d", finalResult.EventsProcessed)
	t.Logf("  Trades: %d", len(finalResult.Trades))
	
	if finalResult.Metrics != nil {
		t.Logf("  Total Return: %s", finalResult.Metrics.TotalReturn)
		t.Logf("  Win Rate: %s", finalResult.Metrics.WinRate)
		t.Logf("  Max Drawdown: %s", finalResult.Metrics.MaxDrawdown)
	}
}

// TestWebSocketBacktest tests backtest execution via WebSocket.
func TestWebSocketBacktest(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping WebSocket integration test in short mode")
	}
	
	logger, _ := zap.NewDevelopment()
	defer logger.Sync()
	
	dataStore, _ := data.NewStore(logger, t.TempDir())
	dataStore.GenerateSampleData()
	
	slippage := backtester.NewFixedSlippage(decimal.NewFromInt(10))
	engine := backtester.NewEngine(logger, dataStore, slippage)
	server := api.NewServer(logger, engine, dataStore)
	
	go server.Start(":18083")
	time.Sleep(100 * time.Millisecond)
	
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		server.Shutdown(ctx)
	}()
	
	// Connect WebSocket
	conn, _, err := websocket.DefaultDialer.Dial("ws://localhost:18083/ws", nil)
	if err != nil {
		t.Fatalf("WebSocket connection failed: %v", err)
	}
	defer conn.Close()
	
	// Subscribe to backtest updates
	subMsg := api.WSMessage{
		Type:  "subscribe",
		ID:    "sub-1",
		Topic: "backtest:*",
	}
	conn.WriteJSON(subMsg)
	
	conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	var subResp api.WSMessage
	conn.ReadJSON(&subResp)
	
	if !subResp.Success {
		t.Fatalf("Subscribe failed: %s", subResp.Error)
	}
	
	// Start backtest
	config := types.BacktestConfig{
		ID:             "ws-test",
		Symbols:        []string{"SOL/USDT"},
		StartDate:      time.Now().AddDate(0, -1, 0),
		EndDate:        time.Now(),
		Timeframe:      types.Timeframe1h,
		InitialCapital: decimal.NewFromInt(10000),
		Commission:     decimal.NewFromFloat(0.001),
	}
	
	configJSON, _ := json.Marshal(config)
	
	runMsg := api.WSMessage{
		Type:    "backtest:run",
		ID:      "run-1",
		Payload: configJSON,
	}
	
	if err := conn.WriteJSON(runMsg); err != nil {
		t.Fatalf("Failed to send run message: %v", err)
	}
	
	// Collect updates
	updates := make([]api.WSMessage, 0)
	conn.SetReadDeadline(time.Now().Add(30 * time.Second))
	
	for {
		var msg api.WSMessage
		if err := conn.ReadJSON(&msg); err != nil {
			break
		}
		
		updates = append(updates, msg)
		t.Logf("Received: type=%s", msg.Type)
		
		if msg.Type == "backtest:complete" || msg.Type == "backtest:error" {
			break
		}
	}
	
	if len(updates) == 0 {
		t.Error("No updates received")
	}
	
	// Verify we got completion
	lastMsg := updates[len(updates)-1]
	if lastMsg.Type != "backtest:complete" {
		t.Errorf("Expected complete message, got %s", lastMsg.Type)
	}
	
	t.Logf("Received %d WebSocket updates", len(updates))
}

// TestConcurrentBacktests tests running multiple backtests simultaneously.
func TestConcurrentBacktests(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping concurrent integration test in short mode")
	}
	
	logger, _ := zap.NewDevelopment()
	defer logger.Sync()
	
	dataStore, _ := data.NewStore(logger, t.TempDir())
	dataStore.GenerateSampleData()
	
	slippage := backtester.NewFixedSlippage(decimal.NewFromInt(10))
	engine := backtester.NewEngine(logger, dataStore, slippage)
	server := api.NewServer(logger, engine, dataStore)
	
	go server.Start(":18084")
	time.Sleep(100 * time.Millisecond)
	
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		server.Shutdown(ctx)
	}()
	
	baseURL := "http://localhost:18084"
	
	// Start multiple backtests concurrently
	numBacktests := 3
	done := make(chan string, numBacktests)
	
	for i := 0; i < numBacktests; i++ {
		go func(id int) {
			config := types.BacktestConfig{
				ID:             time.Now().Format("20060102150405") + "-" + string(rune('A'+id)),
				Symbols:        []string{"SOL/USDT"},
				StartDate:      time.Now().AddDate(0, -1, 0),
				EndDate:        time.Now(),
				Timeframe:      types.Timeframe1h,
				InitialCapital: decimal.NewFromInt(int64(10000 * (id + 1))),
				Commission:     decimal.NewFromFloat(0.001),
			}
			
			configJSON, _ := json.Marshal(config)
			
			resp, err := http.Post(baseURL+"/api/v1/backtest/run", "application/json", bytes.NewReader(configJSON))
			if err != nil {
				done <- "error: " + err.Error()
				return
			}
			
			var result map[string]string
			json.NewDecoder(resp.Body).Decode(&result)
			resp.Body.Close()
			
			done <- result["id"]
		}(i)
	}
	
	// Collect results
	backtestIDs := make([]string, 0, numBacktests)
	for i := 0; i < numBacktests; i++ {
		id := <-done
		if id[:5] != "error" {
			backtestIDs = append(backtestIDs, id)
		}
	}
	
	t.Logf("Started %d concurrent backtests: %v", len(backtestIDs), backtestIDs)
	
	// Wait for all to complete
	time.Sleep(10 * time.Second)
	
	// Check all completed
	for _, id := range backtestIDs {
		resp, _ := http.Get(baseURL + "/api/v1/backtest/status?id=" + id)
		
		var status types.BacktestResult
		json.NewDecoder(resp.Body).Decode(&status)
		resp.Body.Close()
		
		t.Logf("Backtest %s: status=%s, trades=%d", id, status.Status, len(status.Trades))
	}
}

// TestLargeDataset tests performance with larger datasets.
func TestLargeDataset(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping large dataset test in short mode")
	}
	
	logger := zap.NewNop()
	
	dataStore, _ := data.NewStore(logger, t.TempDir())
	
	// Generate 1 year of 1-minute data (500k+ bars)
	symbol := "SOL/USDT"
	timeframe := types.Timeframe1m
	
	startTime := time.Now().AddDate(-1, 0, 0)
	numBars := 365 * 24 * 60 // 1 year of minutes
	
	t.Logf("Generating %d bars...", numBars)
	startGen := time.Now()
	
	bars := make([]types.OHLCV, numBars)
	price := decimal.NewFromInt(100)
	
	for i := 0; i < numBars; i++ {
		change := decimal.NewFromFloat(0.001 * (float64(i%100-50) / 50.0))
		price = price.Add(price.Mul(change))
		
		bars[i] = types.OHLCV{
			Timestamp: startTime.Add(time.Duration(i) * time.Minute),
			Open:      price,
			High:      price.Mul(decimal.NewFromFloat(1.001)),
			Low:       price.Mul(decimal.NewFromFloat(0.999)),
			Close:     price,
			Volume:    decimal.NewFromInt(int64(1000 + i%500)),
		}
	}
	
	dataStore.StoreOHLCV(symbol, timeframe, bars)
	
	genDuration := time.Since(startGen)
	t.Logf("Generated %d bars in %v", numBars, genDuration)
	
	// Run backtest
	slippage := backtester.NewFixedSlippage(decimal.NewFromInt(5))
	engine := backtester.NewEngine(logger, dataStore, slippage)
	
	config := &types.BacktestConfig{
		ID:             "large-test",
		Symbols:        []string{symbol},
		StartDate:      startTime,
		EndDate:        time.Now(),
		Timeframe:      timeframe,
		InitialCapital: decimal.NewFromInt(100000),
		Commission:     decimal.NewFromFloat(0.0005),
	}
	
	t.Log("Running backtest...")
	startBacktest := time.Now()
	
	ctx := context.Background()
	result, err := engine.Run(ctx, config)
	
	backtestDuration := time.Since(startBacktest)
	
	if err != nil {
		t.Fatalf("Backtest failed: %v", err)
	}
	
	eventsPerSecond := float64(result.EventsProcessed) / backtestDuration.Seconds()
	
	t.Logf("Results:")
	t.Logf("  Events Processed: %d", result.EventsProcessed)
	t.Logf("  Duration: %v", backtestDuration)
	t.Logf("  Throughput: %.0f events/second", eventsPerSecond)
	t.Logf("  Trades: %d", len(result.Trades))
	
	// Performance target: 100k events/second minimum
	if eventsPerSecond < 100000 {
		t.Logf("Warning: Throughput %.0f events/second below target of 100,000", eventsPerSecond)
	}
}
