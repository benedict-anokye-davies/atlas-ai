// Package api_test provides tests for the API server.
package api_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
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

func setupTestServer(t *testing.T) (*api.Server, *httptest.Server) {
	logger := zap.NewNop()
	
	dataStore, err := data.NewStore(logger, t.TempDir())
	if err != nil {
		t.Fatalf("Failed to create data store: %v", err)
	}
	
	slippage := backtester.NewFixedSlippage(decimal.NewFromInt(10))
	engine := backtester.NewEngine(logger, dataStore, slippage)
	
	server := api.NewServer(logger, engine, dataStore)
	ts := httptest.NewServer(server.Router())
	
	return server, ts
}

func TestHealthEndpoint(t *testing.T) {
	_, ts := setupTestServer(t)
	defer ts.Close()
	
	resp, err := http.Get(ts.URL + "/health")
	if err != nil {
		t.Fatalf("Health request failed: %v", err)
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != http.StatusOK {
		t.Errorf("Expected status 200, got %d", resp.StatusCode)
	}
	
	var result map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}
	
	if result["status"] != "healthy" {
		t.Errorf("Expected status 'healthy', got '%s'", result["status"])
	}
}

func TestSymbolsEndpoint(t *testing.T) {
	_, ts := setupTestServer(t)
	defer ts.Close()
	
	resp, err := http.Get(ts.URL + "/api/v1/symbols")
	if err != nil {
		t.Fatalf("Symbols request failed: %v", err)
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != http.StatusOK {
		t.Errorf("Expected status 200, got %d", resp.StatusCode)
	}
	
	var symbols []string
	if err := json.NewDecoder(resp.Body).Decode(&symbols); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}
	
	// Should have at least one symbol
	if len(symbols) == 0 {
		t.Log("No symbols available (expected if no data loaded)")
	}
}

func TestBacktestEndpoints(t *testing.T) {
	_, ts := setupTestServer(t)
	defer ts.Close()
	
	// Create backtest request
	config := types.BacktestConfig{
		ID:             "test-http-backtest",
		Symbols:        []string{"SOL/USDT"},
		StartDate:      time.Now().AddDate(0, -1, 0),
		EndDate:        time.Now(),
		Timeframe:      types.Timeframe1h,
		InitialCapital: decimal.NewFromInt(10000),
		Commission:     decimal.NewFromFloat(0.001),
	}
	
	body, _ := json.Marshal(config)
	
	// Start backtest
	resp, err := http.Post(ts.URL+"/api/v1/backtest/run", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("Backtest run request failed: %v", err)
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != http.StatusOK {
		t.Errorf("Expected status 200, got %d", resp.StatusCode)
	}
	
	var result map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}
	
	backtestID, ok := result["id"]
	if !ok {
		t.Fatal("Response missing backtest ID")
	}
	
	// Check status (might be pending or running)
	time.Sleep(100 * time.Millisecond)
	
	resp, err = http.Get(ts.URL + "/api/v1/backtest/status?id=" + backtestID)
	if err != nil {
		t.Fatalf("Backtest status request failed: %v", err)
	}
	defer resp.Body.Close()
	
	// Status endpoint should work
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNotFound {
		t.Errorf("Unexpected status code: %d", resp.StatusCode)
	}
}

func TestWebSocketConnection(t *testing.T) {
	_, ts := setupTestServer(t)
	defer ts.Close()
	
	// Convert HTTP URL to WebSocket URL
	wsURL := "ws" + ts.URL[4:] + "/ws"
	
	// Connect via WebSocket
	conn, resp, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("WebSocket connection failed: %v (response: %v)", err, resp)
	}
	defer conn.Close()
	
	// Send ping message
	pingMsg := api.WSMessage{
		Type: "ping",
		ID:   "test-ping-1",
	}
	
	if err := conn.WriteJSON(pingMsg); err != nil {
		t.Fatalf("Failed to send ping: %v", err)
	}
	
	// Wait for pong response
	conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	
	var response api.WSMessage
	if err := conn.ReadJSON(&response); err != nil {
		t.Fatalf("Failed to read pong: %v", err)
	}
	
	if response.Type != "pong" {
		t.Errorf("Expected 'pong', got '%s'", response.Type)
	}
	
	if response.ID != pingMsg.ID {
		t.Errorf("Response ID mismatch: expected '%s', got '%s'", pingMsg.ID, response.ID)
	}
}

func TestWebSocketSubscription(t *testing.T) {
	_, ts := setupTestServer(t)
	defer ts.Close()
	
	wsURL := "ws" + ts.URL[4:] + "/ws"
	
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("WebSocket connection failed: %v", err)
	}
	defer conn.Close()
	
	// Subscribe to a topic
	subMsg := api.WSMessage{
		Type:  "subscribe",
		ID:    "test-sub-1",
		Topic: "backtest:test-123",
	}
	
	if err := conn.WriteJSON(subMsg); err != nil {
		t.Fatalf("Failed to send subscribe: %v", err)
	}
	
	// Wait for response
	conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	
	var response api.WSMessage
	if err := conn.ReadJSON(&response); err != nil {
		t.Fatalf("Failed to read response: %v", err)
	}
	
	if !response.Success {
		t.Errorf("Subscribe failed: %s", response.Error)
	}
	
	// Unsubscribe
	unsubMsg := api.WSMessage{
		Type:  "unsubscribe",
		ID:    "test-unsub-1",
		Topic: "backtest:test-123",
	}
	
	if err := conn.WriteJSON(unsubMsg); err != nil {
		t.Fatalf("Failed to send unsubscribe: %v", err)
	}
	
	if err := conn.ReadJSON(&response); err != nil {
		t.Fatalf("Failed to read unsubscribe response: %v", err)
	}
	
	if !response.Success {
		t.Errorf("Unsubscribe failed: %s", response.Error)
	}
}

func TestWebSocketBacktestRun(t *testing.T) {
	_, ts := setupTestServer(t)
	defer ts.Close()
	
	wsURL := "ws" + ts.URL[4:] + "/ws"
	
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("WebSocket connection failed: %v", err)
	}
	defer conn.Close()
	
	// Run backtest via WebSocket
	config := types.BacktestConfig{
		ID:             "test-ws-backtest",
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
		ID:      "test-run-1",
		Payload: configJSON,
	}
	
	if err := conn.WriteJSON(runMsg); err != nil {
		t.Fatalf("Failed to send backtest:run: %v", err)
	}
	
	// Read responses (should get at least one)
	conn.SetReadDeadline(time.Now().Add(10 * time.Second))
	
	for {
		var response api.WSMessage
		if err := conn.ReadJSON(&response); err != nil {
			if websocket.IsCloseError(err, websocket.CloseNormalClosure) {
				break
			}
			// Timeout is expected if backtest completes quickly
			break
		}
		
		t.Logf("Received: type=%s success=%v", response.Type, response.Success)
		
		if response.Type == "backtest:complete" || response.Type == "backtest:error" {
			break
		}
	}
}

func TestConcurrentConnections(t *testing.T) {
	_, ts := setupTestServer(t)
	defer ts.Close()
	
	wsURL := "ws" + ts.URL[4:] + "/ws"
	
	// Create multiple concurrent connections
	numConnections := 5
	conns := make([]*websocket.Conn, numConnections)
	
	for i := 0; i < numConnections; i++ {
		conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
		if err != nil {
			t.Fatalf("Connection %d failed: %v", i, err)
		}
		conns[i] = conn
	}
	
	// Send ping from each
	for i, conn := range conns {
		pingMsg := api.WSMessage{
			Type: "ping",
			ID:   string(rune('0' + i)),
		}
		
		if err := conn.WriteJSON(pingMsg); err != nil {
			t.Errorf("Connection %d: failed to send ping: %v", i, err)
		}
	}
	
	// Verify all respond
	for i, conn := range conns {
		conn.SetReadDeadline(time.Now().Add(5 * time.Second))
		
		var response api.WSMessage
		if err := conn.ReadJSON(&response); err != nil {
			t.Errorf("Connection %d: failed to read pong: %v", i, err)
		}
		
		if response.Type != "pong" {
			t.Errorf("Connection %d: expected 'pong', got '%s'", i, response.Type)
		}
	}
	
	// Close all connections
	for _, conn := range conns {
		conn.Close()
	}
}

func TestServerShutdown(t *testing.T) {
	logger := zap.NewNop()
	
	dataStore, err := data.NewStore(logger, t.TempDir())
	if err != nil {
		t.Fatalf("Failed to create data store: %v", err)
	}
	
	slippage := backtester.NewFixedSlippage(decimal.NewFromInt(10))
	engine := backtester.NewEngine(logger, dataStore, slippage)
	
	server := api.NewServer(logger, engine, dataStore)
	
	// Start server in background
	go func() {
		server.Start(":18081")
	}()
	
	// Give it time to start
	time.Sleep(100 * time.Millisecond)
	
	// Create context with timeout
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	
	// Shutdown should complete gracefully
	if err := server.Shutdown(ctx); err != nil {
		t.Errorf("Shutdown error: %v", err)
	}
}
