// Package api provides extended HTTP endpoints for the trading backend.
package api

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/atlas-desktop/trading-backend/internal/autonomous"
	"github.com/atlas-desktop/trading-backend/internal/execution"
	"github.com/atlas-desktop/trading-backend/internal/learning"
	"github.com/atlas-desktop/trading-backend/internal/signals"
	"github.com/gorilla/mux"
	"go.uber.org/zap"
)

// ExtendedServer adds trading-specific endpoints to the server.
type ExtendedServer struct {
	logger       *zap.Logger
	router       *mux.Router
	
	// Components
	agent        *autonomous.TradingAgent
	riskManager  *execution.RiskManager
	orderManager *execution.OrderManager
	signalAgg    *signals.SignalAggregator
	feedback     *learning.FeedbackEngine
	optimizer    *learning.StrategyOptimizer
	analyzer     *learning.PerformanceAnalyzer
}

// NewExtendedServer creates a new extended server.
func NewExtendedServer(
	logger *zap.Logger,
	router *mux.Router,
	agent *autonomous.TradingAgent,
	riskManager *execution.RiskManager,
	orderManager *execution.OrderManager,
	signalAgg *signals.SignalAggregator,
	feedback *learning.FeedbackEngine,
	optimizer *learning.StrategyOptimizer,
) *ExtendedServer {
	es := &ExtendedServer{
		logger:       logger,
		router:       router,
		agent:        agent,
		riskManager:  riskManager,
		orderManager: orderManager,
		signalAgg:    signalAgg,
		feedback:     feedback,
		optimizer:    optimizer,
		analyzer:     learning.NewPerformanceAnalyzer(logger),
	}
	
	es.setupRoutes()
	return es
}

// setupRoutes configures extended routes.
func (es *ExtendedServer) setupRoutes() {
	// Agent endpoints
	es.router.HandleFunc("/api/v1/agent/status", es.handleAgentStatus).Methods("GET")
	es.router.HandleFunc("/api/v1/agent/start", es.handleAgentStart).Methods("POST")
	es.router.HandleFunc("/api/v1/agent/stop", es.handleAgentStop).Methods("POST")
	es.router.HandleFunc("/api/v1/agent/pause", es.handleAgentPause).Methods("POST")
	es.router.HandleFunc("/api/v1/agent/resume", es.handleAgentResume).Methods("POST")
	es.router.HandleFunc("/api/v1/agent/emergency-stop", es.handleEmergencyStop).Methods("POST")
	es.router.HandleFunc("/api/v1/agent/config", es.handleAgentConfig).Methods("GET", "PUT")
	
	// Risk endpoints
	es.router.HandleFunc("/api/v1/risk/status", es.handleRiskStatus).Methods("GET")
	es.router.HandleFunc("/api/v1/risk/config", es.handleRiskConfig).Methods("GET", "PUT")
	es.router.HandleFunc("/api/v1/risk/kill-switch", es.handleKillSwitch).Methods("POST", "DELETE")
	es.router.HandleFunc("/api/v1/risk/violations", es.handleRiskViolations).Methods("GET")
	
	// Order endpoints
	es.router.HandleFunc("/api/v1/orders", es.handleGetOrders).Methods("GET")
	es.router.HandleFunc("/api/v1/orders/{id}", es.handleGetOrder).Methods("GET")
	es.router.HandleFunc("/api/v1/orders/{id}/cancel", es.handleCancelOrder).Methods("POST")
	
	// Position endpoints
	es.router.HandleFunc("/api/v1/positions", es.handleGetPositions).Methods("GET")
	es.router.HandleFunc("/api/v1/positions/{symbol}", es.handleGetPosition).Methods("GET")
	es.router.HandleFunc("/api/v1/positions/{symbol}/close", es.handleClosePosition).Methods("POST")
	
	// Signal endpoints
	es.router.HandleFunc("/api/v1/signals/aggregate/{symbol}", es.handleAggregateSignals).Methods("GET")
	es.router.HandleFunc("/api/v1/signals/sources", es.handleSignalSources).Methods("GET")
	
	// Feedback endpoints
	es.router.HandleFunc("/api/v1/feedback", es.handleSubmitFeedback).Methods("POST")
	es.router.HandleFunc("/api/v1/feedback/recent", es.handleRecentFeedback).Methods("GET")
	es.router.HandleFunc("/api/v1/feedback/patterns", es.handlePatternPerformance).Methods("GET")
	
	// Optimization endpoints
	es.router.HandleFunc("/api/v1/optimize/{strategy}", es.handleOptimize).Methods("POST")
	es.router.HandleFunc("/api/v1/optimize/{strategy}", es.handleGetOptimization).Methods("GET")
	
	// Performance endpoints
	es.router.HandleFunc("/api/v1/performance/report", es.handlePerformanceReport).Methods("GET")
}

// handleAgentStatus returns the agent status.
func (es *ExtendedServer) handleAgentStatus(w http.ResponseWriter, r *http.Request) {
	status := es.agent.GetStatus()
	es.jsonResponse(w, status)
}

// handleAgentStart starts the trading agent.
func (es *ExtendedServer) handleAgentStart(w http.ResponseWriter, r *http.Request) {
	if err := es.agent.Start(r.Context()); err != nil {
		es.errorResponse(w, http.StatusBadRequest, err.Error())
		return
	}
	es.jsonResponse(w, map[string]string{"status": "started"})
}

// handleAgentStop stops the trading agent.
func (es *ExtendedServer) handleAgentStop(w http.ResponseWriter, r *http.Request) {
	if err := es.agent.Stop(); err != nil {
		es.errorResponse(w, http.StatusBadRequest, err.Error())
		return
	}
	es.jsonResponse(w, map[string]string{"status": "stopped"})
}

// handleAgentPause pauses the trading agent.
func (es *ExtendedServer) handleAgentPause(w http.ResponseWriter, r *http.Request) {
	es.agent.Pause()
	es.jsonResponse(w, map[string]string{"status": "paused"})
}

// handleAgentResume resumes the trading agent.
func (es *ExtendedServer) handleAgentResume(w http.ResponseWriter, r *http.Request) {
	es.agent.Resume()
	es.jsonResponse(w, map[string]string{"status": "resumed"})
}

// handleEmergencyStop triggers emergency stop.
func (es *ExtendedServer) handleEmergencyStop(w http.ResponseWriter, r *http.Request) {
	if err := es.agent.EmergencyStop(r.Context()); err != nil {
		es.errorResponse(w, http.StatusInternalServerError, err.Error())
		return
	}
	es.jsonResponse(w, map[string]string{"status": "emergency_stop_activated"})
}

// handleAgentConfig gets or updates agent config.
func (es *ExtendedServer) handleAgentConfig(w http.ResponseWriter, r *http.Request) {
	if r.Method == "PUT" {
		var config autonomous.AgentConfig
		if err := json.NewDecoder(r.Body).Decode(&config); err != nil {
			es.errorResponse(w, http.StatusBadRequest, "Invalid config")
			return
		}
		es.agent.UpdateConfig(config)
		es.jsonResponse(w, map[string]string{"status": "updated"})
	} else {
		// GET - return current config (would need to add GetConfig method)
		es.jsonResponse(w, map[string]string{"status": "ok"})
	}
}

// handleRiskStatus returns risk status.
func (es *ExtendedServer) handleRiskStatus(w http.ResponseWriter, r *http.Request) {
	stats := es.riskManager.GetStats()
	es.jsonResponse(w, stats)
}

// handleRiskConfig gets or updates risk config.
func (es *ExtendedServer) handleRiskConfig(w http.ResponseWriter, r *http.Request) {
	if r.Method == "PUT" {
		var config execution.RiskConfig
		if err := json.NewDecoder(r.Body).Decode(&config); err != nil {
			es.errorResponse(w, http.StatusBadRequest, "Invalid config")
			return
		}
		es.riskManager.UpdateConfig(config)
		es.jsonResponse(w, map[string]string{"status": "updated"})
	} else {
		config := es.riskManager.GetConfig()
		es.jsonResponse(w, config)
	}
}

// handleKillSwitch manages the kill switch.
func (es *ExtendedServer) handleKillSwitch(w http.ResponseWriter, r *http.Request) {
	if r.Method == "POST" {
		var req struct {
			Reason   string `json:"reason"`
			Duration string `json:"duration"` // e.g., "1h", "24h"
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			es.errorResponse(w, http.StatusBadRequest, "Invalid request")
			return
		}
		
		// Parse duration (simplified)
		duration := 4 * 3600 * 1000000000 // 4 hours default
		es.riskManager.ManualKillSwitch(req.Reason, time.Duration(duration))
		es.jsonResponse(w, map[string]string{"status": "kill_switch_activated"})
	} else {
		// DELETE - disable kill switch
		es.riskManager.DisableKillSwitch()
		es.jsonResponse(w, map[string]string{"status": "kill_switch_disabled"})
	}
}

// handleRiskViolations returns recent risk violations.
func (es *ExtendedServer) handleRiskViolations(w http.ResponseWriter, r *http.Request) {
	violations := es.riskManager.GetViolations(50)
	es.jsonResponse(w, violations)
}

// handleGetOrders returns open orders.
func (es *ExtendedServer) handleGetOrders(w http.ResponseWriter, r *http.Request) {
	orders := es.orderManager.GetOpenOrders()
	es.jsonResponse(w, orders)
}

// handleGetOrder returns a specific order.
func (es *ExtendedServer) handleGetOrder(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	orderID := vars["id"]
	
	order := es.orderManager.GetOrder(orderID)
	if order == nil {
		es.errorResponse(w, http.StatusNotFound, "Order not found")
		return
	}
	
	es.jsonResponse(w, order)
}

// handleCancelOrder cancels an order.
func (es *ExtendedServer) handleCancelOrder(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	orderID := vars["id"]
	
	es.orderManager.CancelOrder(orderID)
	es.jsonResponse(w, map[string]string{"status": "cancelled"})
}

// handleGetPositions returns all positions.
func (es *ExtendedServer) handleGetPositions(w http.ResponseWriter, r *http.Request) {
	positions := es.orderManager.GetAllPositions()
	es.jsonResponse(w, positions)
}

// handleGetPosition returns a specific position.
func (es *ExtendedServer) handleGetPosition(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	symbol := vars["symbol"]
	
	position := es.orderManager.GetPosition(symbol)
	if position == nil {
		es.errorResponse(w, http.StatusNotFound, "Position not found")
		return
	}
	
	es.jsonResponse(w, position)
}

// handleClosePosition closes a position.
func (es *ExtendedServer) handleClosePosition(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	symbol := vars["symbol"]
	
	// TODO: Implement position closing via executor
	es.jsonResponse(w, map[string]string{"status": "close_requested", "symbol": symbol})
}

// handleAggregateSignals aggregates signals for a symbol.
func (es *ExtendedServer) handleAggregateSignals(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	symbol := vars["symbol"]
	
	signal, err := es.signalAgg.AggregateSignals(r.Context(), symbol)
	if err != nil {
		es.errorResponse(w, http.StatusInternalServerError, err.Error())
		return
	}
	
	es.jsonResponse(w, signal)
}

// handleSignalSources returns available signal sources.
func (es *ExtendedServer) handleSignalSources(w http.ResponseWriter, r *http.Request) {
	// TODO: Get from signal aggregator
	sources := []string{"technical", "sentiment", "onchain", "ai"}
	es.jsonResponse(w, sources)
}

// handleSubmitFeedback submits trade feedback.
func (es *ExtendedServer) handleSubmitFeedback(w http.ResponseWriter, r *http.Request) {
	var feedback learning.TradeFeedback
	if err := json.NewDecoder(r.Body).Decode(&feedback); err != nil {
		es.errorResponse(w, http.StatusBadRequest, "Invalid feedback")
		return
	}
	
	es.feedback.RecordFeedback(feedback)
	es.jsonResponse(w, map[string]string{"status": "recorded"})
}

// handleRecentFeedback returns recent feedback.
func (es *ExtendedServer) handleRecentFeedback(w http.ResponseWriter, r *http.Request) {
	feedback := es.feedback.GetRecentFeedback(50)
	es.jsonResponse(w, feedback)
}

// handlePatternPerformance returns pattern performance.
func (es *ExtendedServer) handlePatternPerformance(w http.ResponseWriter, r *http.Request) {
	performance := es.feedback.GetAllPatternPerformance()
	es.jsonResponse(w, performance)
}

// handleOptimize runs strategy optimization.
func (es *ExtendedServer) handleOptimize(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	strategy := vars["strategy"]
	
	result, err := es.optimizer.Optimize(r.Context(), strategy)
	if err != nil {
		es.errorResponse(w, http.StatusInternalServerError, err.Error())
		return
	}
	
	es.jsonResponse(w, result)
}

// handleGetOptimization returns optimization result.
func (es *ExtendedServer) handleGetOptimization(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	strategy := vars["strategy"]
	
	result := es.optimizer.GetOptimization(strategy)
	if result == nil {
		es.errorResponse(w, http.StatusNotFound, "No optimization found")
		return
	}
	
	es.jsonResponse(w, result)
}

// handlePerformanceReport returns performance report.
func (es *ExtendedServer) handlePerformanceReport(w http.ResponseWriter, r *http.Request) {
	// TODO: Get trades from storage
	report := es.analyzer.Analyze(nil, "all")
	es.jsonResponse(w, report)
}

// jsonResponse writes a JSON response.
func (es *ExtendedServer) jsonResponse(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(data)
}

// errorResponse writes an error response.
func (es *ExtendedServer) errorResponse(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}
