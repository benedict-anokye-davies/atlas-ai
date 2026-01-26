// Package types provides configuration types for the trading backend.
package types

import (
	"time"

	"github.com/shopspring/decimal"
)

// BacktestConfig represents the configuration for a backtest run
type BacktestConfig struct {
	ID             string          `json:"id"`
	Strategy       StrategyConfig  `json:"strategy"`
	Symbols        []string        `json:"symbols"`
	StartDate      time.Time       `json:"startDate"`
	EndDate        time.Time       `json:"endDate"`
	Timeframe      Timeframe       `json:"timeframe"`
	InitialCapital decimal.Decimal `json:"initialCapital"`
	Commission     decimal.Decimal `json:"commission"`
	Slippage       SlippageConfig  `json:"slippage"`
	RiskLimits     RiskLimits      `json:"riskLimits"`
	Validation     ValidationConfig `json:"validation"`
}

// StrategyConfig represents strategy configuration
type StrategyConfig struct {
	Name       string        `json:"name"`
	Type       string        `json:"type"`
	Parameters map[string]any `json:"parameters"`
	EntryRules []Rule        `json:"entryRules"`
	ExitRules  []Rule        `json:"exitRules"`
}

// Rule represents a trading rule
type Rule struct {
	Indicator  string      `json:"indicator"`
	Condition  string      `json:"condition"`
	Value      interface{} `json:"value"`
	Timeframe  Timeframe   `json:"timeframe,omitempty"`
	Lookback   int         `json:"lookback,omitempty"`
}

// SlippageConfig represents slippage model configuration
type SlippageConfig struct {
	Model           string          `json:"model"` // "fixed", "volume_weighted", "orderbook"
	FixedBps        decimal.Decimal `json:"fixedBps,omitempty"`
	ImpactFactor    decimal.Decimal `json:"impactFactor,omitempty"`
	VolumeFraction  decimal.Decimal `json:"volumeFraction,omitempty"`
}

// RiskLimits represents risk management limits
type RiskLimits struct {
	MaxPositionSize    decimal.Decimal `json:"maxPositionSize"`
	MaxDrawdown        decimal.Decimal `json:"maxDrawdown"`
	MaxDailyLoss       decimal.Decimal `json:"maxDailyLoss"`
	MaxOpenPositions   int             `json:"maxOpenPositions"`
	MaxLeverage        decimal.Decimal `json:"maxLeverage"`
	MaxCorrelation     decimal.Decimal `json:"maxCorrelation"`
}

// ValidationConfig represents validation settings
type ValidationConfig struct {
	WalkForward  WalkForwardConfig  `json:"walkForward,omitempty"`
	MonteCarlo   MonteCarloConfig   `json:"monteCarlo,omitempty"`
}

// WalkForwardConfig represents walk-forward analysis configuration
type WalkForwardConfig struct {
	Enabled    bool `json:"enabled"`
	WindowSize int  `json:"windowSize"` // days
	StepSize   int  `json:"stepSize"`   // days
	MinSamples int  `json:"minSamples"`
}

// MonteCarloConfig represents Monte Carlo simulation configuration
type MonteCarloConfig struct {
	Enabled         bool            `json:"enabled"`
	Iterations      int             `json:"iterations"`
	ConfidenceLevel decimal.Decimal `json:"confidenceLevel"`
	ShuffleReturns  bool            `json:"shuffleReturns"`
}

// BacktestResult represents the results of a backtest
type BacktestResult struct {
	ID             string              `json:"id"`
	Config         *BacktestConfig     `json:"config"`
	Metrics        *PerformanceMetrics `json:"metrics"`
	RiskMetrics    *RiskMetrics        `json:"riskMetrics"`
	EquityCurve    []EquityCurvePoint  `json:"equityCurve"`
	Trades         []Trade             `json:"trades"`
	MonteCarloResult *MonteCarloResult `json:"monteCarloResult,omitempty"`
	WalkForwardResult *WalkForwardResult `json:"walkForwardResult,omitempty"`
	StartedAt      time.Time           `json:"startedAt"`
	CompletedAt    time.Time           `json:"completedAt"`
	Duration       time.Duration       `json:"duration"`
	EventsProcessed uint64             `json:"eventsProcessed"`
}

// BacktestProgress represents the progress of a running backtest
type BacktestProgress struct {
	ID              string          `json:"id"`
	Status          string          `json:"status"` // "running", "completed", "failed", "cancelled"
	Progress        float64         `json:"progress"` // 0-100
	EventsProcessed uint64          `json:"eventsProcessed"`
	TotalEvents     uint64          `json:"totalEvents"`
	CurrentDate     time.Time       `json:"currentDate"`
	TradesExecuted  int             `json:"tradesExecuted"`
	CurrentEquity   decimal.Decimal `json:"currentEquity"`
	Error           string          `json:"error,omitempty"`
}

// KillSwitchConfig represents kill switch configuration
type KillSwitchConfig struct {
	MaxDrawdownPct     decimal.Decimal `json:"maxDrawdownPct"`
	MaxDailyLossPct    decimal.Decimal `json:"maxDailyLossPct"`
	MaxConsecutiveLoss int             `json:"maxConsecutiveLoss"`
	MaxVolatility      decimal.Decimal `json:"maxVolatility"`
	CooldownPeriod     time.Duration   `json:"cooldownPeriod"`
}

// ServerConfig represents server configuration
type ServerConfig struct {
	Host            string        `json:"host"`
	Port            int           `json:"port"`
	WebSocketPath   string        `json:"websocketPath"`
	ReadTimeout     time.Duration `json:"readTimeout"`
	WriteTimeout    time.Duration `json:"writeTimeout"`
	MaxConnections  int           `json:"maxConnections"`
	EnableMetrics   bool          `json:"enableMetrics"`
	MetricsPort     int           `json:"metricsPort"`
}

// DataConfig represents data storage configuration
type DataConfig struct {
	DataDir         string `json:"dataDir"`
	CacheSize       int    `json:"cacheSize"` // MB
	UseMemoryMap    bool   `json:"useMemoryMap"`
	CompressionType string `json:"compressionType"` // "none", "gzip", "lz4"
}
