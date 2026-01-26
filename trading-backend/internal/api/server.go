// Package api provides the HTTP and WebSocket server.
package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/atlas-desktop/trading-backend/internal/backtester"
	"github.com/atlas-desktop/trading-backend/internal/data"
	"github.com/atlas-desktop/trading-backend/pkg/types"
	"github.com/google/uuid"
	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
	"github.com/rs/cors"
	"go.uber.org/zap"
)

// Server is the HTTP/WebSocket API server
type Server struct {
	mu            sync.RWMutex
	logger        *zap.Logger
	config        *types.ServerConfig
	router        *mux.Router
	httpServer    *http.Server
	upgrader      websocket.Upgrader
	clients       map[string]*Client
	dataStore     *data.Store
	engine        *backtester.Engine
	backtests     map[string]*BacktestState
}

// Client represents a WebSocket client
type Client struct {
	ID       string
	Conn     *websocket.Conn
	Send     chan []byte
	Subs     map[string]bool // Subscriptions
}

// BacktestState tracks a running backtest
type BacktestState struct {
	ID       string
	Config   *types.BacktestConfig
	Engine   *backtester.Engine
	Status   string
	Started  time.Time
	Result   *types.BacktestResult
}

// Message represents a WebSocket message
type Message struct {
	ID        string      `json:"id"`
	Type      string      `json:"type"` // request, response, event
	Method    string      `json:"method"`
	Payload   interface{} `json:"payload,omitempty"`
	Error     string      `json:"error,omitempty"`
	Timestamp int64       `json:"timestamp"`
}

// NewServer creates a new API server
func NewServer(logger *zap.Logger, config *types.ServerConfig, dataStore *data.Store) *Server {
	server := &Server{
		logger:    logger,
		config:    config,
		router:    mux.NewRouter(),
		clients:   make(map[string]*Client),
		dataStore: dataStore,
		backtests: make(map[string]*BacktestState),
		upgrader: websocket.Upgrader{
			ReadBufferSize:  1024,
			WriteBufferSize: 1024,
			CheckOrigin: func(r *http.Request) bool {
				return true // Allow all origins for development
			},
		},
	}
	
	server.setupRoutes()
	return server
}

// setupRoutes configures HTTP routes
func (s *Server) setupRoutes() {
	// Health check
	s.router.HandleFunc("/api/v1/health", s.handleHealth).Methods("GET")
	
	// Data endpoints
	s.router.HandleFunc("/api/v1/data/symbols", s.handleGetSymbols).Methods("GET")
	s.router.HandleFunc("/api/v1/data/history/{symbol}", s.handleGetHistory).Methods("GET")
	
	// Backtest endpoints
	s.router.HandleFunc("/api/v1/backtest/run", s.handleRunBacktest).Methods("POST")
	s.router.HandleFunc("/api/v1/backtest/{id}", s.handleGetBacktest).Methods("GET")
	s.router.HandleFunc("/api/v1/backtest/{id}/trades", s.handleGetBacktestTrades).Methods("GET")
	s.router.HandleFunc("/api/v1/backtest/{id}/cancel", s.handleCancelBacktest).Methods("POST")
	
	// WebSocket
	s.router.HandleFunc(s.config.WebSocketPath, s.handleWebSocket)
}

// Start starts the HTTP server
func (s *Server) Start() error {
	addr := fmt.Sprintf("%s:%d", s.config.Host, s.config.Port)
	
	handler := cors.New(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"*"},
		AllowCredentials: true,
	}).Handler(s.router)
	
	s.httpServer = &http.Server{
		Addr:         addr,
		Handler:      handler,
		ReadTimeout:  s.config.ReadTimeout,
		WriteTimeout: s.config.WriteTimeout,
	}
	
	s.logger.Info("Starting API server", zap.String("addr", addr))
	
	return s.httpServer.ListenAndServe()
}

// Stop gracefully stops the server
func (s *Server) Stop(ctx context.Context) error {
	// Close all WebSocket connections
	s.mu.Lock()
	for _, client := range s.clients {
		client.Conn.Close()
	}
	s.mu.Unlock()
	
	return s.httpServer.Shutdown(ctx)
}

// handleHealth handles health check requests
func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "healthy",
		"time":   time.Now().Unix(),
	})
}

// handleGetSymbols returns available symbols
func (s *Server) handleGetSymbols(w http.ResponseWriter, r *http.Request) {
	symbols := s.dataStore.GetAvailableSymbols()
	
	// Add default symbols if none exist
	if len(symbols) == 0 {
		symbols = []string{"SOL/USDT", "ETH/USDT", "BTC/USDT"}
	}
	
	json.NewEncoder(w).Encode(map[string]interface{}{
		"symbols": symbols,
	})
}

// handleGetHistory returns historical data for a symbol
func (s *Server) handleGetHistory(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	symbol := vars["symbol"]
	
	// Parse query params
	timeframe := r.URL.Query().Get("timeframe")
	if timeframe == "" {
		timeframe = "1h"
	}
	
	startStr := r.URL.Query().Get("start")
	endStr := r.URL.Query().Get("end")
	
	start := time.Now().AddDate(0, -1, 0) // Default: 1 month ago
	end := time.Now()
	
	if startStr != "" {
		if t, err := time.Parse(time.RFC3339, startStr); err == nil {
			start = t
		}
	}
	if endStr != "" {
		if t, err := time.Parse(time.RFC3339, endStr); err == nil {
			end = t
		}
	}
	
	data, err := s.dataStore.LoadOHLCV(r.Context(), symbol, types.Timeframe(timeframe), start, end)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	
	json.NewEncoder(w).Encode(map[string]interface{}{
		"symbol":    symbol,
		"timeframe": timeframe,
		"bars":      data,
		"count":     len(data),
	})
}

// handleRunBacktest starts a new backtest
func (s *Server) handleRunBacktest(w http.ResponseWriter, r *http.Request) {
	var config types.BacktestConfig
	if err := json.NewDecoder(r.Body).Decode(&config); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	
	// Generate ID if not provided
	if config.ID == "" {
		config.ID = uuid.New().String()
	}
	
	// Create engine and slippage model
	slippageModel := backtester.CreateSlippageModel(config.Slippage)
	engine := backtester.NewEngine(s.logger, s.dataStore, slippageModel)
	
	// Track backtest state
	state := &BacktestState{
		ID:      config.ID,
		Config:  &config,
		Engine:  engine,
		Status:  "running",
		Started: time.Now(),
	}
	
	s.mu.Lock()
	s.backtests[config.ID] = state
	s.mu.Unlock()
	
	// Run backtest in background
	go func() {
		result, err := engine.Run(context.Background(), &config)
		
		s.mu.Lock()
		if err != nil {
			state.Status = "failed"
			s.logger.Error("Backtest failed", zap.String("id", config.ID), zap.Error(err))
		} else {
			state.Status = "completed"
			state.Result = result
		}
		s.mu.Unlock()
		
		// Broadcast completion event
		s.broadcast(&Message{
			ID:        uuid.New().String(),
			Type:      "event",
			Method:    "backtest:complete",
			Payload:   map[string]interface{}{"id": config.ID, "status": state.Status},
			Timestamp: time.Now().UnixMilli(),
		})
	}()
	
	// Stream progress
	go func() {
		for progress := range engine.ProgressChan() {
			s.broadcast(&Message{
				ID:        uuid.New().String(),
				Type:      "event",
				Method:    "backtest:progress",
				Payload:   progress,
				Timestamp: time.Now().UnixMilli(),
			})
		}
	}()
	
	json.NewEncoder(w).Encode(map[string]interface{}{
		"id":      config.ID,
		"status":  "running",
		"started": state.Started.Unix(),
	})
}

// handleGetBacktest returns backtest results
func (s *Server) handleGetBacktest(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]
	
	s.mu.RLock()
	state, ok := s.backtests[id]
	s.mu.RUnlock()
	
	if !ok {
		http.Error(w, "Backtest not found", http.StatusNotFound)
		return
	}
	
	response := map[string]interface{}{
		"id":      state.ID,
		"status":  state.Status,
		"started": state.Started.Unix(),
	}
	
	if state.Result != nil {
		response["result"] = state.Result
	}
	
	if state.Status == "running" {
		response["progress"] = state.Engine.GetProgress()
	}
	
	json.NewEncoder(w).Encode(response)
}

// handleGetBacktestTrades returns trades from a backtest
func (s *Server) handleGetBacktestTrades(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]
	
	s.mu.RLock()
	state, ok := s.backtests[id]
	s.mu.RUnlock()
	
	if !ok {
		http.Error(w, "Backtest not found", http.StatusNotFound)
		return
	}
	
	if state.Result == nil {
		http.Error(w, "Backtest not complete", http.StatusBadRequest)
		return
	}
	
	json.NewEncoder(w).Encode(map[string]interface{}{
		"id":     id,
		"trades": state.Result.Trades,
		"count":  len(state.Result.Trades),
	})
}

// handleCancelBacktest cancels a running backtest
func (s *Server) handleCancelBacktest(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]
	
	s.mu.RLock()
	state, ok := s.backtests[id]
	s.mu.RUnlock()
	
	if !ok {
		http.Error(w, "Backtest not found", http.StatusNotFound)
		return
	}
	
	if state.Status != "running" {
		http.Error(w, "Backtest not running", http.StatusBadRequest)
		return
	}
	
	state.Engine.Cancel()
	
	s.mu.Lock()
	state.Status = "cancelled"
	s.mu.Unlock()
	
	json.NewEncoder(w).Encode(map[string]interface{}{
		"id":     id,
		"status": "cancelled",
	})
}

// handleWebSocket handles WebSocket connections
func (s *Server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		s.logger.Error("WebSocket upgrade failed", zap.Error(err))
		return
	}
	
	client := &Client{
		ID:   uuid.New().String(),
		Conn: conn,
		Send: make(chan []byte, 256),
		Subs: make(map[string]bool),
	}
	
	s.mu.Lock()
	s.clients[client.ID] = client
	s.mu.Unlock()
	
	s.logger.Info("WebSocket client connected", zap.String("id", client.ID))
	
	// Start read/write goroutines
	go s.readPump(client)
	go s.writePump(client)
}

// readPump handles incoming WebSocket messages
func (s *Server) readPump(client *Client) {
	defer func() {
		s.mu.Lock()
		delete(s.clients, client.ID)
		s.mu.Unlock()
		client.Conn.Close()
		s.logger.Info("WebSocket client disconnected", zap.String("id", client.ID))
	}()
	
	client.Conn.SetReadLimit(512 * 1024) // 512KB max message size
	client.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	client.Conn.SetPongHandler(func(string) error {
		client.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})
	
	for {
		_, messageBytes, err := client.Conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				s.logger.Error("WebSocket read error", zap.Error(err))
			}
			break
		}
		
		var msg Message
		if err := json.Unmarshal(messageBytes, &msg); err != nil {
			s.logger.Warn("Invalid WebSocket message", zap.Error(err))
			continue
		}
		
		s.handleMessage(client, &msg)
	}
}

// writePump handles outgoing WebSocket messages
func (s *Server) writePump(client *Client) {
	ticker := time.NewTicker(30 * time.Second)
	defer func() {
		ticker.Stop()
		client.Conn.Close()
	}()
	
	for {
		select {
		case message, ok := <-client.Send:
			client.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				client.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			
			if err := client.Conn.WriteMessage(websocket.TextMessage, message); err != nil {
				return
			}
			
		case <-ticker.C:
			client.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := client.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// handleMessage handles a WebSocket message
func (s *Server) handleMessage(client *Client, msg *Message) {
	response := &Message{
		ID:        msg.ID,
		Type:      "response",
		Method:    msg.Method,
		Timestamp: time.Now().UnixMilli(),
	}
	
	switch msg.Method {
	case "ping":
		response.Payload = map[string]string{"pong": "ok"}
		
	case "backtest:run":
		config, ok := msg.Payload.(map[string]interface{})
		if !ok {
			response.Error = "Invalid payload"
		} else {
			// Parse config and start backtest
			configBytes, _ := json.Marshal(config)
			var backtestConfig types.BacktestConfig
			json.Unmarshal(configBytes, &backtestConfig)
			
			if backtestConfig.ID == "" {
				backtestConfig.ID = uuid.New().String()
			}
			
			response.Payload = map[string]interface{}{
				"id":     backtestConfig.ID,
				"status": "started",
			}
			
			// Start backtest in background (similar to HTTP handler)
			go s.runBacktestAsync(&backtestConfig)
		}
		
	case "backtest:status":
		payload, _ := msg.Payload.(map[string]interface{})
		id, _ := payload["id"].(string)
		
		s.mu.RLock()
		state, ok := s.backtests[id]
		s.mu.RUnlock()
		
		if !ok {
			response.Error = "Backtest not found"
		} else {
			response.Payload = map[string]interface{}{
				"id":       state.ID,
				"status":   state.Status,
				"progress": state.Engine.GetProgress(),
			}
		}
		
	case "backtest:cancel":
		payload, _ := msg.Payload.(map[string]interface{})
		id, _ := payload["id"].(string)
		
		s.mu.RLock()
		state, ok := s.backtests[id]
		s.mu.RUnlock()
		
		if !ok {
			response.Error = "Backtest not found"
		} else {
			state.Engine.Cancel()
			response.Payload = map[string]string{"status": "cancelled"}
		}
		
	case "subscribe":
		payload, _ := msg.Payload.(map[string]interface{})
		channel, _ := payload["channel"].(string)
		client.Subs[channel] = true
		response.Payload = map[string]string{"subscribed": channel}
		
	case "unsubscribe":
		payload, _ := msg.Payload.(map[string]interface{})
		channel, _ := payload["channel"].(string)
		delete(client.Subs, channel)
		response.Payload = map[string]string{"unsubscribed": channel}
		
	default:
		response.Error = "Unknown method"
	}
	
	responseBytes, _ := json.Marshal(response)
	client.Send <- responseBytes
}

// runBacktestAsync runs a backtest asynchronously
func (s *Server) runBacktestAsync(config *types.BacktestConfig) {
	slippageModel := backtester.CreateSlippageModel(config.Slippage)
	engine := backtester.NewEngine(s.logger, s.dataStore, slippageModel)
	
	state := &BacktestState{
		ID:      config.ID,
		Config:  config,
		Engine:  engine,
		Status:  "running",
		Started: time.Now(),
	}
	
	s.mu.Lock()
	s.backtests[config.ID] = state
	s.mu.Unlock()
	
	// Stream progress
	go func() {
		for progress := range engine.ProgressChan() {
			s.broadcast(&Message{
				ID:        uuid.New().String(),
				Type:      "event",
				Method:    "backtest:progress",
				Payload:   progress,
				Timestamp: time.Now().UnixMilli(),
			})
		}
	}()
	
	result, err := engine.Run(context.Background(), config)
	
	s.mu.Lock()
	if err != nil {
		state.Status = "failed"
	} else {
		state.Status = "completed"
		state.Result = result
	}
	s.mu.Unlock()
	
	s.broadcast(&Message{
		ID:        uuid.New().String(),
		Type:      "event",
		Method:    "backtest:complete",
		Payload:   map[string]interface{}{"id": config.ID, "status": state.Status, "result": result},
		Timestamp: time.Now().UnixMilli(),
	})
}

// broadcast sends a message to all connected clients
func (s *Server) broadcast(msg *Message) {
	msgBytes, err := json.Marshal(msg)
	if err != nil {
		return
	}
	
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	for _, client := range s.clients {
		select {
		case client.Send <- msgBytes:
		default:
			// Client buffer full, skip
		}
	}
}

// broadcastToSubscribers sends a message to clients subscribed to a channel
func (s *Server) broadcastToSubscribers(channel string, msg *Message) {
	msgBytes, err := json.Marshal(msg)
	if err != nil {
		return
	}
	
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	for _, client := range s.clients {
		if client.Subs[channel] {
			select {
			case client.Send <- msgBytes:
			default:
			}
		}
	}
}
