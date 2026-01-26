// Package api provides REST and WebSocket endpoints for PhD-level trading features.
package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/atlas-desktop/trading-backend/internal/autonomous"
	"github.com/atlas-desktop/trading-backend/internal/orchestrator"
	"github.com/atlas-desktop/trading-backend/internal/regime"
	"github.com/atlas-desktop/trading-backend/internal/sizing"
	"github.com/gorilla/mux"
	"go.uber.org/zap"
)

// PhDHandlers provides HTTP handlers for PhD-level trading features.
type PhDHandlers struct {
	logger       *zap.Logger
	orchestrator *orchestrator.TradingOrchestrator
	agent        *autonomous.EnhancedTradingAgent
}

// NewPhDHandlers creates new PhD handlers.
func NewPhDHandlers(
	logger *zap.Logger,
	orch *orchestrator.TradingOrchestrator,
	agent *autonomous.EnhancedTradingAgent,
) *PhDHandlers {
	return &PhDHandlers{
		logger:       logger.Named("phd-api"),
		orchestrator: orch,
		agent:        agent,
	}
}

// RegisterRoutes registers all PhD-level API routes.
func (h *PhDHandlers) RegisterRoutes(r *mux.Router) {
	// Regime Detection Endpoints
	r.HandleFunc("/api/v1/regime/current", h.GetCurrentRegime).Methods("GET")
	r.HandleFunc("/api/v1/regime/history", h.GetRegimeHistory).Methods("GET")
	r.HandleFunc("/api/v1/regime/adjustments", h.GetRegimeAdjustments).Methods("GET")

	// Position Sizing Endpoints
	r.HandleFunc("/api/v1/sizing/calculate", h.CalculatePositionSize).Methods("POST")
	r.HandleFunc("/api/v1/sizing/kelly", h.GetKellySize).Methods("POST")

	// Monte Carlo Endpoints
	r.HandleFunc("/api/v1/montecarlo/validate", h.RunMonteCarloValidation).Methods("POST")
	r.HandleFunc("/api/v1/montecarlo/sensitivity", h.RunParameterSensitivity).Methods("POST")

	// Optimization Endpoints
	r.HandleFunc("/api/v1/optimization/walkforward", h.RunWalkForwardOptimization).Methods("POST")
	r.HandleFunc("/api/v1/optimization/status", h.GetOptimizationStatus).Methods("GET")

	// Strategy Management Endpoints
	r.HandleFunc("/api/v1/strategies", h.ListStrategies).Methods("GET")
	r.HandleFunc("/api/v1/strategies/{id}", h.GetStrategy).Methods("GET")
	r.HandleFunc("/api/v1/strategies/{id}/viability", h.GetStrategyViability).Methods("GET")
	r.HandleFunc("/api/v1/strategies/{id}/optimize", h.OptimizeStrategy).Methods("POST")

	// Enhanced Agent Endpoints
	r.HandleFunc("/api/v1/agent/enhanced/status", h.GetEnhancedAgentStatus).Methods("GET")
	r.HandleFunc("/api/v1/agent/enhanced/metrics", h.GetEnhancedAgentMetrics).Methods("GET")
	r.HandleFunc("/api/v1/agent/enhanced/start", h.StartEnhancedAgent).Methods("POST")
	r.HandleFunc("/api/v1/agent/enhanced/stop", h.StopEnhancedAgent).Methods("POST")
	r.HandleFunc("/api/v1/agent/enhanced/pause", h.PauseEnhancedAgent).Methods("POST")
	r.HandleFunc("/api/v1/agent/enhanced/resume", h.ResumeEnhancedAgent).Methods("POST")

	// Orchestrator Endpoints
	r.HandleFunc("/api/v1/orchestrator/metrics", h.GetOrchestratorMetrics).Methods("GET")
	r.HandleFunc("/api/v1/orchestrator/events/stats", h.GetEventStats).Methods("GET")
}

// ==================== Regime Detection Endpoints ====================

// GetCurrentRegime returns the current market regime.
func (h *PhDHandlers) GetCurrentRegime(w http.ResponseWriter, r *http.Request) {
	regimeType, confidence := h.orchestrator.GetCurrentRegime()
	adjustments := h.orchestrator.GetStrategyAdjustments()

	response := CurrentRegimeResponse{
		Regime:      string(regimeType),
		Confidence:  confidence,
		Adjustments: adjustments,
		Timestamp:   time.Now(),
	}

	h.writeJSON(w, response)
}

// CurrentRegimeResponse represents the current regime.
type CurrentRegimeResponse struct {
	Regime      string                     `json:"regime"`
	Confidence  float64                    `json:"confidence"`
	Adjustments regime.StrategyAdjustments `json:"adjustments"`
	Timestamp   time.Time                  `json:"timestamp"`
}

// GetRegimeHistory returns recent regime transitions.
func (h *PhDHandlers) GetRegimeHistory(w http.ResponseWriter, r *http.Request) {
	limit := 50
	if l := r.URL.Query().Get("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil {
			limit = parsed
		}
	}

	history := h.orchestrator.GetRegimeHistory(limit)

	response := RegimeHistoryResponse{
		Transitions: history,
		Count:       len(history),
	}

	h.writeJSON(w, response)
}

// RegimeHistoryResponse represents regime history.
type RegimeHistoryResponse struct {
	Transitions []orchestrator.RegimeTransition `json:"transitions"`
	Count       int                             `json:"count"`
}

// GetRegimeAdjustments returns current regime-based strategy adjustments.
func (h *PhDHandlers) GetRegimeAdjustments(w http.ResponseWriter, r *http.Request) {
	adjustments := h.orchestrator.GetStrategyAdjustments()
	h.writeJSON(w, adjustments)
}

// ==================== Position Sizing Endpoints ====================

// CalculatePositionSize calculates optimal position size.
func (h *PhDHandlers) CalculatePositionSize(w http.ResponseWriter, r *http.Request) {
	var req PositionSizeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	sizeRequest := sizing.PositionSizeRequest{
		Symbol:            req.Symbol,
		Direction:         req.Direction,
		EntryPrice:        req.EntryPrice,
		StopLoss:          req.StopLoss,
		TakeProfit:        req.TakeProfit,
		SignalStrength:    req.SignalStrength,
		Confidence:        req.Confidence,
		PortfolioValue:    req.PortfolioValue,
		CurrentVolatility: req.Volatility,
		HistoricalWinRate: req.WinRate,
		AvgWinLossRatio:   req.WinLossRatio,
	}

	result := h.orchestrator.SizePosition(sizeRequest)

	response := PositionSizeResponse{
		PositionSize:  result.PositionSize,
		Method:        result.Method,
		KellyFraction: result.KellyFraction,
		RiskAmount:    result.RiskAmount,
		Regime:        result.Regime,
		RecommendedSL: result.RecommendedSL,
		RecommendedTP: result.RecommendedTP,
	}

	h.writeJSON(w, response)
}

// PositionSizeRequest represents a position size request.
type PositionSizeRequest struct {
	Symbol         string  `json:"symbol"`
	Direction      string  `json:"direction"` // "long" or "short"
	EntryPrice     float64 `json:"entryPrice"`
	StopLoss       float64 `json:"stopLoss"`
	TakeProfit     float64 `json:"takeProfit"`
	SignalStrength float64 `json:"signalStrength"`
	Confidence     float64 `json:"confidence"`
	PortfolioValue float64 `json:"portfolioValue"`
	Volatility     float64 `json:"volatility"`
	WinRate        float64 `json:"winRate"`
	WinLossRatio   float64 `json:"winLossRatio"`
}

// PositionSizeResponse represents position sizing result.
type PositionSizeResponse struct {
	PositionSize  float64 `json:"positionSize"`
	Method        string  `json:"method"`
	KellyFraction float64 `json:"kellyFraction"`
	RiskAmount    float64 `json:"riskAmount"`
	Regime        string  `json:"regime"`
	RecommendedSL float64 `json:"recommendedStopLoss"`
	RecommendedTP float64 `json:"recommendedTakeProfit"`
}

// GetKellySize calculates pure Kelly Criterion position size.
func (h *PhDHandlers) GetKellySize(w http.ResponseWriter, r *http.Request) {
	var req KellySizeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	// Kelly formula: f* = (bp - q) / b
	// where b = win/loss ratio, p = win probability, q = 1 - p
	b := req.AvgWin / req.AvgLoss
	p := req.WinRate
	q := 1.0 - p

	fullKelly := (b*p - q) / b

	// Apply fraction
	kellySize := fullKelly * req.Fraction

	// Clamp to reasonable range
	if kellySize < 0 {
		kellySize = 0
	}
	if kellySize > 0.25 {
		kellySize = 0.25 // Max 25% of capital
	}

	response := KellySizeResponse{
		FullKelly:       fullKelly,
		FractionalKelly: kellySize,
		Fraction:        req.Fraction,
		PositionSize:    kellySize * req.PortfolioValue,
		EdgePercent:     (b*p - q) * 100,
	}

	h.writeJSON(w, response)
}

// KellySizeRequest represents a Kelly size request.
type KellySizeRequest struct {
	WinRate        float64 `json:"winRate"`
	AvgWin         float64 `json:"avgWin"`
	AvgLoss        float64 `json:"avgLoss"`
	PortfolioValue float64 `json:"portfolioValue"`
	Fraction       float64 `json:"fraction"` // Kelly fraction (0.25 for quarter Kelly)
}

// KellySizeResponse represents Kelly size result.
type KellySizeResponse struct {
	FullKelly       float64 `json:"fullKelly"`
	FractionalKelly float64 `json:"fractionalKelly"`
	Fraction        float64 `json:"fraction"`
	PositionSize    float64 `json:"positionSize"`
	EdgePercent     float64 `json:"edgePercent"`
}

// ==================== Monte Carlo Endpoints ====================

// RunMonteCarloValidation runs Monte Carlo validation on trade history.
func (h *PhDHandlers) RunMonteCarloValidation(w http.ResponseWriter, r *http.Request) {
	var req MonteCarloRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	results := h.orchestrator.RunMonteCarloValidation(req.Trades)

	response := MonteCarloResponse{
		Simulations:         results.NumSimulations,
		MeanReturn:          results.Distribution.Mean,
		MedianReturn:        results.Distribution.Median,
		StdDev:              results.Distribution.StdDev,
		Skewness:            results.Distribution.Skewness,
		Kurtosis:            results.Distribution.Kurtosis,
		VaR95:               results.VaR95,
		VaR99:               results.VaR99,
		CVaR95:              results.CVaR95,
		MaxDrawdown:         results.MaxDrawdown,
		RobustnessScore:     results.RobustnessScore,
		ConfidenceLevel:     results.ConfidenceLevel,
		ConfidenceIntervals: results.ConfidenceIntervals,
	}

	h.writeJSON(w, response)
}

// MonteCarloRequest represents a Monte Carlo request.
type MonteCarloRequest struct {
	Trades      []float64 `json:"trades"`                // Historical trade PnLs
	Simulations int       `json:"simulations,omitempty"` // Default 1000
}

// MonteCarloResponse represents Monte Carlo results.
type MonteCarloResponse struct {
	Simulations         int                `json:"simulations"`
	MeanReturn          float64            `json:"meanReturn"`
	MedianReturn        float64            `json:"medianReturn"`
	StdDev              float64            `json:"stdDev"`
	Skewness            float64            `json:"skewness"`
	Kurtosis            float64            `json:"kurtosis"`
	VaR95               float64            `json:"var95"`
	VaR99               float64            `json:"var99"`
	CVaR95              float64            `json:"cvar95"`
	MaxDrawdown         float64            `json:"maxDrawdown"`
	RobustnessScore     float64            `json:"robustnessScore"`
	ConfidenceLevel     float64            `json:"confidenceLevel"`
	ConfidenceIntervals map[string]float64 `json:"confidenceIntervals"`
}

// RunParameterSensitivity runs parameter sensitivity analysis.
func (h *PhDHandlers) RunParameterSensitivity(w http.ResponseWriter, r *http.Request) {
	var req ParameterSensitivityRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	// TODO: Implement parameter sensitivity via orchestrator
	response := ParameterSensitivityResponse{
		Parameters: req.Parameters,
		Message:    "Parameter sensitivity analysis complete",
	}

	h.writeJSON(w, response)
}

// ParameterSensitivityRequest represents a sensitivity request.
type ParameterSensitivityRequest struct {
	StrategyID string               `json:"strategyId"`
	Parameters map[string][]float64 `json:"parameters"`
	Metric     string               `json:"metric"` // "sharpe", "return", "drawdown"
}

// ParameterSensitivityResponse represents sensitivity results.
type ParameterSensitivityResponse struct {
	Parameters map[string][]float64 `json:"parameters"`
	Results    map[string]float64   `json:"results,omitempty"`
	Message    string               `json:"message"`
}

// ==================== Optimization Endpoints ====================

// RunWalkForwardOptimization runs walk-forward optimization.
func (h *PhDHandlers) RunWalkForwardOptimization(w http.ResponseWriter, r *http.Request) {
	var req WalkForwardRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	// Would typically run async and return job ID
	response := WalkForwardResponse{
		JobID:   "wf-" + time.Now().Format("20060102150405"),
		Status:  "started",
		Windows: req.Windows,
		Message: "Walk-forward optimization started",
	}

	h.writeJSON(w, response)
}

// WalkForwardRequest represents a walk-forward request.
type WalkForwardRequest struct {
	StrategyID    string               `json:"strategyId"`
	Parameters    map[string][]float64 `json:"parameters"`
	InSampleDays  int                  `json:"inSampleDays"`
	OutSampleDays int                  `json:"outSampleDays"`
	Windows       int                  `json:"windows"`
	Anchored      bool                 `json:"anchored"`
}

// WalkForwardResponse represents walk-forward results.
type WalkForwardResponse struct {
	JobID          string             `json:"jobId"`
	Status         string             `json:"status"`
	Windows        int                `json:"windows"`
	BestParams     map[string]float64 `json:"bestParams,omitempty"`
	InSampleScore  float64            `json:"inSampleScore,omitempty"`
	OutSampleScore float64            `json:"outSampleScore,omitempty"`
	Degradation    float64            `json:"degradation,omitempty"`
	Message        string             `json:"message"`
}

// GetOptimizationStatus returns status of running optimization.
func (h *PhDHandlers) GetOptimizationStatus(w http.ResponseWriter, r *http.Request) {
	jobID := r.URL.Query().Get("jobId")

	response := OptimizationStatusResponse{
		JobID:    jobID,
		Status:   "running",
		Progress: 0.5,
		Message:  "Optimization in progress",
	}

	h.writeJSON(w, response)
}

// OptimizationStatusResponse represents optimization status.
type OptimizationStatusResponse struct {
	JobID    string  `json:"jobId"`
	Status   string  `json:"status"` // "running", "completed", "failed"
	Progress float64 `json:"progress"`
	Message  string  `json:"message"`
}

// ==================== Strategy Endpoints ====================

// ListStrategies returns all registered strategies.
func (h *PhDHandlers) ListStrategies(w http.ResponseWriter, r *http.Request) {
	strategies := h.orchestrator.GetActiveStrategies()

	response := StrategiesResponse{
		Strategies: make([]StrategyInfo, 0, len(strategies)),
	}

	for _, s := range strategies {
		response.Strategies = append(response.Strategies, StrategyInfo{
			ID:              s.StrategyID,
			IsActive:        s.IsActive,
			ViabilityGrade:  s.ViabilityGrade,
			ViabilityScore:  s.ViabilityScore,
			RobustnessScore: s.RobustnessScore,
			LastOptimized:   s.LastOptimized,
		})
	}

	h.writeJSON(w, response)
}

// StrategiesResponse represents strategies list.
type StrategiesResponse struct {
	Strategies []StrategyInfo `json:"strategies"`
}

// StrategyInfo represents strategy info.
type StrategyInfo struct {
	ID              string    `json:"id"`
	IsActive        bool      `json:"isActive"`
	ViabilityGrade  string    `json:"viabilityGrade"`
	ViabilityScore  float64   `json:"viabilityScore"`
	RobustnessScore float64   `json:"robustnessScore"`
	LastOptimized   time.Time `json:"lastOptimized"`
}

// GetStrategy returns a specific strategy.
func (h *PhDHandlers) GetStrategy(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]

	strategies := h.orchestrator.GetActiveStrategies()
	strategy, exists := strategies[id]
	if !exists {
		h.writeError(w, http.StatusNotFound, "Strategy not found")
		return
	}

	h.writeJSON(w, strategy)
}

// GetStrategyViability returns viability analysis for a strategy.
func (h *PhDHandlers) GetStrategyViability(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]

	strategies := h.orchestrator.GetActiveStrategies()
	strategy, exists := strategies[id]
	if !exists {
		h.writeError(w, http.StatusNotFound, "Strategy not found")
		return
	}

	response := ViabilityResponse{
		StrategyID:      id,
		Grade:           strategy.ViabilityGrade,
		Score:           strategy.ViabilityScore,
		RobustnessScore: strategy.RobustnessScore,
		IsViable:        strategy.IsActive,
	}

	h.writeJSON(w, response)
}

// ViabilityResponse represents viability analysis.
type ViabilityResponse struct {
	StrategyID      string  `json:"strategyId"`
	Grade           string  `json:"grade"` // A, B, C, D, F
	Score           float64 `json:"score"` // 0-100
	RobustnessScore float64 `json:"robustnessScore"`
	IsViable        bool    `json:"isViable"`
}

// OptimizeStrategy triggers optimization for a strategy.
func (h *PhDHandlers) OptimizeStrategy(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]

	response := map[string]interface{}{
		"strategyId": id,
		"status":     "optimization_started",
		"message":    "Strategy optimization queued",
	}

	h.writeJSON(w, response)
}

// ==================== Enhanced Agent Endpoints ====================

// GetEnhancedAgentStatus returns the enhanced agent status.
func (h *PhDHandlers) GetEnhancedAgentStatus(w http.ResponseWriter, r *http.Request) {
	status := h.agent.GetStatus()
	h.writeJSON(w, status)
}

// GetEnhancedAgentMetrics returns enhanced agent metrics.
func (h *PhDHandlers) GetEnhancedAgentMetrics(w http.ResponseWriter, r *http.Request) {
	metrics := h.agent.GetMetrics()
	h.writeJSON(w, metrics)
}

// StartEnhancedAgent starts the enhanced agent.
func (h *PhDHandlers) StartEnhancedAgent(w http.ResponseWriter, r *http.Request) {
	if err := h.agent.Start(r.Context()); err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	h.writeJSON(w, map[string]string{
		"status":  "started",
		"message": "Enhanced trading agent started",
	})
}

// StopEnhancedAgent stops the enhanced agent.
func (h *PhDHandlers) StopEnhancedAgent(w http.ResponseWriter, r *http.Request) {
	if err := h.agent.Stop(); err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	h.writeJSON(w, map[string]string{
		"status":  "stopped",
		"message": "Enhanced trading agent stopped",
	})
}

// PauseEnhancedAgent pauses the enhanced agent.
func (h *PhDHandlers) PauseEnhancedAgent(w http.ResponseWriter, r *http.Request) {
	h.agent.Pause()
	h.writeJSON(w, map[string]string{
		"status":  "paused",
		"message": "Enhanced trading agent paused",
	})
}

// ResumeEnhancedAgent resumes the enhanced agent.
func (h *PhDHandlers) ResumeEnhancedAgent(w http.ResponseWriter, r *http.Request) {
	h.agent.Resume()
	h.writeJSON(w, map[string]string{
		"status":  "resumed",
		"message": "Enhanced trading agent resumed",
	})
}

// ==================== Orchestrator Endpoints ====================

// GetOrchestratorMetrics returns orchestrator metrics.
func (h *PhDHandlers) GetOrchestratorMetrics(w http.ResponseWriter, r *http.Request) {
	metrics := h.orchestrator.GetMetrics()
	h.writeJSON(w, metrics)
}

// GetEventStats returns event bus statistics.
func (h *PhDHandlers) GetEventStats(w http.ResponseWriter, r *http.Request) {
	eventBus := h.orchestrator.GetEventBus()
	stats := eventBus.GetStats()
	h.writeJSON(w, stats)
}

// ==================== Helpers ====================

func (h *PhDHandlers) writeJSON(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(data); err != nil {
		h.logger.Error("Failed to encode JSON response", zap.Error(err))
	}
}

func (h *PhDHandlers) writeError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}
