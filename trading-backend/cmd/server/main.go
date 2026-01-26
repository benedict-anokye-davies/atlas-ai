// Package main provides the entry point for the trading backend server.
// This is the PhD-level autonomous trading system with:
// - HMM-based regime detection
// - Kelly Criterion position sizing
// - Monte Carlo validation
// - Walk-forward optimization
// - Event-driven architecture
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/atlas-desktop/trading-backend/internal/api"
	"github.com/atlas-desktop/trading-backend/internal/autonomous"
	"github.com/atlas-desktop/trading-backend/internal/blockchain"
	"github.com/atlas-desktop/trading-backend/internal/data"
	"github.com/atlas-desktop/trading-backend/internal/execution"
	"github.com/atlas-desktop/trading-backend/internal/learning"
	"github.com/atlas-desktop/trading-backend/internal/orchestrator"
	"github.com/atlas-desktop/trading-backend/internal/regime"
	"github.com/atlas-desktop/trading-backend/internal/signals"
	"github.com/atlas-desktop/trading-backend/internal/strategy"
	"github.com/atlas-desktop/trading-backend/pkg/types"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

func main() {
	// Parse command line flags
	host := flag.String("host", "localhost", "Server host")
	port := flag.Int("port", 8080, "Server port")
	dataDir := flag.String("data", "./data", "Data directory")
	logLevel := flag.String("log-level", "info", "Log level (debug, info, warn, error)")
	paperTrading := flag.Bool("paper", true, "Enable paper trading mode")
	flag.Parse()

	// Setup logger
	logger := setupLogger(*logLevel)
	defer logger.Sync()

	logger.Info("Starting Atlas Trading Backend",
		zap.String("host", *host),
		zap.Int("port", *port),
		zap.String("dataDir", *dataDir),
		zap.Bool("paperTrading", *paperTrading),
	)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Initialize data store
	dataStore, err := data.NewStore(logger, *dataDir)
	if err != nil {
		logger.Fatal("Failed to initialize data store", zap.Error(err))
	}

	// Initialize market data service
	marketDataConfig := data.DefaultMarketDataConfig()
	marketDataConfig.Symbols = []string{"BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"}
	marketDataService := data.NewMarketDataService(logger, marketDataConfig)

	// Initialize blockchain clients
	solanaClient := blockchain.NewSolanaClient(logger, blockchain.SolanaConfig{
		RPCURL:        getEnvOrDefault("SOLANA_RPC_URL", "https://api.mainnet-beta.solana.com"),
		WSURL:         getEnvOrDefault("SOLANA_WS_URL", "wss://api.mainnet-beta.solana.com"),
		Commitment:    "confirmed",
		MaxRetries:    3,
		EnableMetrics: true,
	})

	evmClient := blockchain.NewEVMClient(logger, blockchain.EVMConfig{
		DefaultChain: "ethereum",
		RPCURLs: map[string]string{
			"ethereum": getEnvOrDefault("ETH_RPC_URL", ""),
			"polygon":  getEnvOrDefault("POLYGON_RPC_URL", ""),
			"arbitrum": getEnvOrDefault("ARBITRUM_RPC_URL", ""),
		},
		MaxRetries:    3,
		EnableMetrics: true,
	})

	// Initialize block tracker
	blockTracker := blockchain.NewBlockTracker(logger, blockchain.BlockTrackerConfig{
		SolanaClient: solanaClient,
		EVMClient:    evmClient,
		BufferSize:   1000,
	})

	// Initialize signal aggregator
	signalConfig := signals.AggregatorConfig{
		Sources: []signals.SignalSourceConfig{
			{Type: "technical", Enabled: true, Weight: 0.3},
			{Type: "sentiment", Enabled: true, Weight: 0.2},
			{Type: "onchain", Enabled: true, Weight: 0.2},
			{Type: "ai", Enabled: true, Weight: 0.3},
		},
		MinConfidence:    0.6,
		PerplexityAPIKey: os.Getenv("PERPLEXITY_API_KEY"),
	}
	signalAggregator := signals.NewSignalAggregator(logger, signalConfig)

	// Initialize execution components
	riskConfig := execution.RiskConfig{
		MaxPositionSize:  1000,
		MaxOpenPositions: 10,
		MaxDailyLoss:     500,
		MaxWeeklyLoss:    2000,
		MaxTradesPerDay:  50,
		MaxRiskPerTrade:  0.02,
		MaxTotalExposure: 0.5,
		EnableKillSwitch: true,
		CorrelationGroups: map[string][]string{
			"defi": {"UNI", "AAVE", "COMP", "SUSHI"},
			"l1":   {"ETH", "SOL", "AVAX", "DOT"},
		},
	}
	riskManager := execution.NewRiskManager(logger, riskConfig)
	orderManager := execution.NewOrderManager(logger)
	slippageCalculator := execution.NewSlippageCalculator(logger, execution.DefaultSlippageConfig())

	// Initialize trade executor
	executorConfig := execution.ExecutorConfig{
		PaperTrading:      *paperTrading,
		MaxRetries:        3,
		RetryDelayMs:      1000,
		DefaultSlippage:   0.001,
		MaxSlippage:       0.05,
		ConfirmationLevel: 1,
	}
	executor := execution.NewExecutor(
		logger,
		executorConfig,
		riskManager,
		slippageCalculator,
		nil, // Exchange adapters set via env
	)

	// Initialize learning components
	feedbackEngine := learning.NewFeedbackEngine(logger)
	strategyOptimizer := learning.NewStrategyOptimizer(logger, feedbackEngine)

	// Initialize strategy registry
	strategyRegistry := strategy.NewStrategyRegistry(logger)
	logger.Info("Registered strategies",
		zap.Strings("strategies", strategyRegistry.List()),
	)

	// ========== PhD-LEVEL COMPONENTS ==========
	// Initialize the Trading Orchestrator with all PhD-level features
	orchConfig := orchestrator.DefaultOrchestratorConfig()
	orchConfig.EventWorkers = 16
	orchConfig.MonteCarloRuns = 1000
	orchConfig.KellyFraction = 0.25 // Quarter Kelly for safety
	orchConfig.MinSharpeRatio = 0.5
	orchConfig.MaxDrawdown = 0.2

	tradingOrchestrator, err := orchestrator.NewTradingOrchestrator(
		logger,
		orchConfig,
		signalAggregator,
		riskManager,
	)
	if err != nil {
		logger.Fatal("Failed to initialize trading orchestrator", zap.Error(err))
	}

	// Initialize Enhanced Trading Agent (PhD-level)
	enhancedAgentConfig := autonomous.DefaultEnhancedAgentConfig()
	enhancedAgentConfig.TradingPairs = []string{"BTCUSDT", "ETHUSDT", "SOLUSDT"}
	enhancedAgentConfig.PaperTrading = *paperTrading
	enhancedAgentConfig.EnableRegimeAdapt = true
	enhancedAgentConfig.UseKellySize = true
	enhancedAgentConfig.RequireMCValidation = true

	enhancedAgent := autonomous.NewEnhancedTradingAgent(
		logger,
		enhancedAgentConfig,
		tradingOrchestrator,
		executor,
		riskManager,
		orderManager,
		signalAggregator,
	)

	// Initialize legacy agent for backwards compatibility
	agentConfig := autonomous.AgentConfig{
		TradingPairs:        []string{"BTCUSDT", "ETHUSDT", "SOLUSDT"},
		MaxConcurrentPos:    5,
		PositionSizing:      "percent",
		PositionPercent:     0.05,
		MinSignalConfidence: 0.65,
		RiskPerTrade:        0.02,
		TradingHours: autonomous.TradingHoursConfig{
			Enabled:   false, // 24/7 crypto trading
			StartHour: 9,
			EndHour:   17,
		},
		PaperTrading: *paperTrading,
	}
	agent := autonomous.NewTradingAgent(
		logger,
		agentConfig,
		signalAggregator,
		riskManager,
		executor,
		feedbackEngine,
	)

	// Server configuration
	serverConfig := &types.ServerConfig{
		Host:           *host,
		Port:           *port,
		WebSocketPath:  "/ws",
		ReadTimeout:    30 * time.Second,
		WriteTimeout:   30 * time.Second,
		MaxConnections: 100,
		EnableMetrics:  true,
		MetricsPort:    9090,
	}

	// Create main server
	server := api.NewServer(logger, serverConfig, dataStore)

	// Register PhD-level API handlers
	phdHandlers := api.NewPhDHandlers(logger, tradingOrchestrator, enhancedAgent)
	phdHandlers.RegisterRoutes(server.Router())

	// Setup WebSocket hub for real-time updates
	wsHub := api.NewHub(logger)
	go wsHub.Run()

	// Wire up event callbacks
	marketDataService.OnPrice(func(update data.PriceUpdate) {
		wsHub.PublishToChannel("prices:"+update.Symbol, api.MsgTypePnLUpdate, update)
	})

	orderManager.OnOrderUpdate = func(order *execution.ManagedOrder) {
		wsHub.BroadcastOrderUpdate(&types.Order{
			ID:     order.Order.ID,
			Symbol: order.Order.Symbol,
			Side:   order.Order.Side,
			Status: order.Order.Status,
		})
	}

	riskManager.OnViolation = func(v execution.RiskViolation) {
		wsHub.BroadcastRiskAlert(v)
	}

	agent.SetTradeCallback(func(trade *types.Trade) {
		wsHub.BroadcastTradeUpdate(trade)
	})

	agent.SetSignalCallback(func(signal *types.Signal) {
		wsHub.BroadcastSignalUpdate(signal)
	})

	// Wire enhanced agent callbacks
	enhancedAgent.SetOnTrade(func(trade *types.Trade) {
		wsHub.BroadcastTradeUpdate(trade)
	})

	enhancedAgent.SetOnRegime(func(regimeType regime.RegimeType, confidence float64) {
		wsHub.PublishToChannel("regime", api.MsgTypeRegimeChange, map[string]interface{}{
			"regime":     string(regimeType),
			"confidence": confidence,
			"timestamp":  time.Now(),
		})
	})

	// Handle graceful shutdown
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	// Start PhD-level orchestrator
	go func() {
		if err := tradingOrchestrator.Start(ctx); err != nil {
			logger.Error("Trading orchestrator error", zap.Error(err))
		}
	}()

	// Start services
	go func() {
		if err := marketDataService.Start(ctx); err != nil {
			logger.Error("Market data service error", zap.Error(err))
		}
	}()

	go func() {
		if err := blockTracker.Start(ctx); err != nil {
			logger.Error("Block tracker error", zap.Error(err))
		}
	}()

	// Start server
	go func() {
		if err := server.Start(); err != nil {
			logger.Error("Server error", zap.Error(err))
		}
	}()

	logger.Info("Server started successfully",
		zap.String("ws", fmt.Sprintf("ws://%s:%d/ws", *host, *port)),
		zap.String("http", fmt.Sprintf("http://%s:%d/api/v1", *host, *port)),
		zap.Bool("paperTrading", *paperTrading),
		zap.Bool("phdLevel", true),
	)

	// Wait for shutdown signal
	<-sigChan
	logger.Info("Shutdown signal received")

	// Stop services
	cancel()

	// Stop enhanced agent first
	if enhancedAgent.IsRunning() {
		if err := enhancedAgent.Stop(); err != nil {
			logger.Error("Error stopping enhanced agent", zap.Error(err))
		}
	}

	// Stop legacy agent
	if agent.IsRunning() {
		if err := agent.Stop(); err != nil {
			logger.Error("Error stopping agent", zap.Error(err))
		}
	}

	// Stop orchestrator
	if err := tradingOrchestrator.Stop(); err != nil {
		logger.Error("Error stopping orchestrator", zap.Error(err))
	}

	if err := marketDataService.Stop(); err != nil {
		logger.Error("Error stopping market data", zap.Error(err))
	}

	blockTracker.Stop()

	// Graceful server shutdown with timeout
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer shutdownCancel()

	if err := server.Stop(shutdownCtx); err != nil {
		logger.Error("Error during server shutdown", zap.Error(err))
	}

	logger.Info("Server stopped")
}

func getEnvOrDefault(key, defaultVal string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return defaultVal
}

func setupLogger(level string) *zap.Logger {
	var zapLevel zapcore.Level
	switch level {
	case "debug":
		zapLevel = zapcore.DebugLevel
	case "info":
		zapLevel = zapcore.InfoLevel
	case "warn":
		zapLevel = zapcore.WarnLevel
	case "error":
		zapLevel = zapcore.ErrorLevel
	default:
		zapLevel = zapcore.InfoLevel
	}

	config := zap.Config{
		Level:       zap.NewAtomicLevelAt(zapLevel),
		Development: false,
		Encoding:    "console",
		EncoderConfig: zapcore.EncoderConfig{
			TimeKey:        "time",
			LevelKey:       "level",
			NameKey:        "logger",
			CallerKey:      "caller",
			MessageKey:     "msg",
			StacktraceKey:  "stacktrace",
			LineEnding:     zapcore.DefaultLineEnding,
			EncodeLevel:    zapcore.CapitalColorLevelEncoder,
			EncodeTime:     zapcore.ISO8601TimeEncoder,
			EncodeDuration: zapcore.SecondsDurationEncoder,
			EncodeCaller:   zapcore.ShortCallerEncoder,
		},
		OutputPaths:      []string{"stdout"},
		ErrorOutputPaths: []string{"stderr"},
	}

	logger, err := config.Build()
	if err != nil {
		panic(err)
	}

	return logger
}
