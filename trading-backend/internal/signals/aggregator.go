// Package signals provides signal aggregation from multiple sources.
package signals

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/atlas-desktop/trading-backend/pkg/types"
	"github.com/shopspring/decimal"
	"go.uber.org/zap"
)

// SignalSource represents a source of trading signals.
type SignalSource interface {
	Name() string
	Type() SignalSourceType
	Subscribe(ctx context.Context, symbols []string) (<-chan *types.Signal, error)
	GetLatestSignals(ctx context.Context, symbol string) ([]*types.Signal, error)
	Health() SourceHealth
}

// SignalSourceType categorizes signal sources.
type SignalSourceType string

const (
	SourceTypeTechnical  SignalSourceType = "technical"
	SourceTypeSentiment  SignalSourceType = "sentiment"
	SourceTypeOnChain    SignalSourceType = "onchain"
	SourceTypeNews       SignalSourceType = "news"
	SourceTypeAI         SignalSourceType = "ai"
	SourceTypeSocial     SignalSourceType = "social"
	SourceTypeOrderFlow  SignalSourceType = "orderflow"
)

// SourceHealth represents the health of a signal source.
type SourceHealth struct {
	IsHealthy       bool          `json:"isHealthy"`
	LastSignalTime  time.Time     `json:"lastSignalTime"`
	SignalsPerHour  float64       `json:"signalsPerHour"`
	Latency         time.Duration `json:"latency"`
	ErrorRate       float64       `json:"errorRate"`
	LastError       string        `json:"lastError,omitempty"`
}

// AggregatedSignal combines signals from multiple sources.
type AggregatedSignal struct {
	Symbol          string               `json:"symbol"`
	Direction       types.SignalDirection `json:"direction"`
	Strength        decimal.Decimal      `json:"strength"` // 0-1
	Confidence      decimal.Decimal      `json:"confidence"` // 0-1
	Sources         []string             `json:"sources"`
	SourceSignals   []*types.Signal      `json:"sourceSignals"`
	ConsensusScore  decimal.Decimal      `json:"consensusScore"` // Agreement between sources
	Timestamp       time.Time            `json:"timestamp"`
	ExpiresAt       time.Time            `json:"expiresAt"`
	
	// Recommended actions
	SuggestedEntry  decimal.Decimal      `json:"suggestedEntry,omitempty"`
	SuggestedStop   decimal.Decimal      `json:"suggestedStop,omitempty"`
	SuggestedTarget decimal.Decimal      `json:"suggestedTarget,omitempty"`
	RiskRewardRatio decimal.Decimal      `json:"riskRewardRatio,omitempty"`
}

// Aggregator combines signals from multiple sources.
type Aggregator struct {
	logger  *zap.Logger
	sources map[string]SignalSource
	weights map[string]decimal.Decimal // Source weights
	
	// State
	latestSignals map[string][]*types.Signal // symbol -> signals
	aggregated    map[string]*AggregatedSignal
	
	// Configuration
	config AggregatorConfig
	
	// Channels
	signals chan *AggregatedSignal
	
	// Control
	mu      sync.RWMutex
	running bool
	cancel  context.CancelFunc
	wg      sync.WaitGroup
}

// AggregatorConfig configures the signal aggregator.
type AggregatorConfig struct {
	// Aggregation settings
	AggregationWindow  time.Duration          `json:"aggregationWindow"`
	MinSources         int                    `json:"minSources"` // Minimum sources for valid signal
	MinConfidence      decimal.Decimal        `json:"minConfidence"`
	MinConsensus       decimal.Decimal        `json:"minConsensus"`
	
	// Source weights
	SourceWeights      map[string]decimal.Decimal `json:"sourceWeights"`
	TypeWeights        map[SignalSourceType]decimal.Decimal `json:"typeWeights"`
	
	// Filtering
	MinStrength        decimal.Decimal        `json:"minStrength"`
	MaxAge             time.Duration          `json:"maxAge"`
	
	// Output
	SignalBufferSize   int                    `json:"signalBufferSize"`
	EmitInterval       time.Duration          `json:"emitInterval"`
}

// DefaultAggregatorConfig returns sensible defaults.
func DefaultAggregatorConfig() AggregatorConfig {
	return AggregatorConfig{
		AggregationWindow:  5 * time.Minute,
		MinSources:         2,
		MinConfidence:      decimal.NewFromFloat(0.6),
		MinConsensus:       decimal.NewFromFloat(0.5),
		SourceWeights:      make(map[string]decimal.Decimal),
		TypeWeights: map[SignalSourceType]decimal.Decimal{
			SourceTypeTechnical: decimal.NewFromFloat(1.0),
			SourceTypeSentiment: decimal.NewFromFloat(0.8),
			SourceTypeOnChain:   decimal.NewFromFloat(1.2),
			SourceTypeNews:      decimal.NewFromFloat(0.7),
			SourceTypeAI:        decimal.NewFromFloat(1.0),
			SourceTypeSocial:    decimal.NewFromFloat(0.5),
			SourceTypeOrderFlow: decimal.NewFromFloat(1.3),
		},
		MinStrength:      decimal.NewFromFloat(0.3),
		MaxAge:           30 * time.Minute,
		SignalBufferSize: 100,
		EmitInterval:     10 * time.Second,
	}
}

// NewAggregator creates a new signal aggregator.
func NewAggregator(logger *zap.Logger, config AggregatorConfig) *Aggregator {
	return &Aggregator{
		logger:        logger.Named("signal-aggregator"),
		sources:       make(map[string]SignalSource),
		weights:       config.SourceWeights,
		latestSignals: make(map[string][]*types.Signal),
		aggregated:    make(map[string]*AggregatedSignal),
		config:        config,
		signals:       make(chan *AggregatedSignal, config.SignalBufferSize),
	}
}

// AddSource adds a signal source.
func (a *Aggregator) AddSource(source SignalSource) {
	a.mu.Lock()
	defer a.mu.Unlock()
	
	a.sources[source.Name()] = source
	
	// Set default weight if not configured
	if _, ok := a.weights[source.Name()]; !ok {
		typeWeight := a.config.TypeWeights[source.Type()]
		if typeWeight.IsZero() {
			typeWeight = decimal.NewFromFloat(1.0)
		}
		a.weights[source.Name()] = typeWeight
	}
	
	a.logger.Info("Added signal source",
		zap.String("name", source.Name()),
		zap.String("type", string(source.Type())))
}

// RemoveSource removes a signal source.
func (a *Aggregator) RemoveSource(name string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	
	delete(a.sources, name)
	delete(a.weights, name)
}

// Start begins signal aggregation.
func (a *Aggregator) Start(ctx context.Context, symbols []string) error {
	a.mu.Lock()
	if a.running {
		a.mu.Unlock()
		return nil
	}
	a.running = true
	
	ctx, a.cancel = context.WithCancel(ctx)
	a.mu.Unlock()
	
	a.logger.Info("Starting signal aggregator",
		zap.Int("sources", len(a.sources)),
		zap.Strings("symbols", symbols))
	
	// Subscribe to all sources
	for name, source := range a.sources {
		signalChan, err := source.Subscribe(ctx, symbols)
		if err != nil {
			a.logger.Error("Failed to subscribe to source",
				zap.String("source", name),
				zap.Error(err))
			continue
		}
		
		a.wg.Add(1)
		go a.collectSignals(ctx, name, signalChan)
	}
	
	// Start aggregation loop
	a.wg.Add(1)
	go a.aggregateLoop(ctx)
	
	return nil
}

// Stop stops the aggregator.
func (a *Aggregator) Stop() {
	a.mu.Lock()
	defer a.mu.Unlock()
	
	if !a.running {
		return
	}
	
	a.logger.Info("Stopping signal aggregator")
	a.cancel()
	a.wg.Wait()
	a.running = false
	
	close(a.signals)
}

// Signals returns the channel for aggregated signals.
func (a *Aggregator) Signals() <-chan *AggregatedSignal {
	return a.signals
}

// GetAggregatedSignal returns the latest aggregated signal for a symbol.
func (a *Aggregator) GetAggregatedSignal(symbol string) *AggregatedSignal {
	a.mu.RLock()
	defer a.mu.RUnlock()
	
	if sig, ok := a.aggregated[symbol]; ok {
		return sig
	}
	return nil
}

// GetSourceHealth returns health info for all sources.
func (a *Aggregator) GetSourceHealth() map[string]SourceHealth {
	a.mu.RLock()
	defer a.mu.RUnlock()
	
	health := make(map[string]SourceHealth)
	for name, source := range a.sources {
		health[name] = source.Health()
	}
	return health
}

// collectSignals collects signals from a source.
func (a *Aggregator) collectSignals(ctx context.Context, sourceName string, signalChan <-chan *types.Signal) {
	defer a.wg.Done()
	
	for {
		select {
		case <-ctx.Done():
			return
		case signal, ok := <-signalChan:
			if !ok {
				return
			}
			
			a.recordSignal(sourceName, signal)
		}
	}
}

// recordSignal records a signal from a source.
func (a *Aggregator) recordSignal(sourceName string, signal *types.Signal) {
	a.mu.Lock()
	defer a.mu.Unlock()
	
	signal.Source = sourceName
	
	// Add to symbol's signal list
	signals := a.latestSignals[signal.Symbol]
	signals = append(signals, signal)
	
	// Remove expired signals
	cutoff := time.Now().Add(-a.config.MaxAge)
	filtered := make([]*types.Signal, 0, len(signals))
	for _, s := range signals {
		if s.Timestamp.After(cutoff) {
			filtered = append(filtered, s)
		}
	}
	
	a.latestSignals[signal.Symbol] = filtered
}

// aggregateLoop periodically aggregates signals.
func (a *Aggregator) aggregateLoop(ctx context.Context) {
	defer a.wg.Done()
	
	ticker := time.NewTicker(a.config.EmitInterval)
	defer ticker.Stop()
	
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			a.aggregate()
		}
	}
}

// aggregate combines signals from all sources.
func (a *Aggregator) aggregate() {
	a.mu.Lock()
	defer a.mu.Unlock()
	
	now := time.Now()
	windowStart := now.Add(-a.config.AggregationWindow)
	
	for symbol, signals := range a.latestSignals {
		// Filter to window
		var windowSignals []*types.Signal
		for _, s := range signals {
			if s.Timestamp.After(windowStart) {
				windowSignals = append(windowSignals, s)
			}
		}
		
		if len(windowSignals) == 0 {
			continue
		}
		
		// Group by source
		sourceSignals := make(map[string][]*types.Signal)
		for _, s := range windowSignals {
			sourceSignals[s.Source] = append(sourceSignals[s.Source], s)
		}
		
		// Check minimum sources
		if len(sourceSignals) < a.config.MinSources {
			continue
		}
		
		// Calculate aggregated signal
		aggregated := a.calculateAggregatedSignal(symbol, sourceSignals)
		
		// Apply filters
		if aggregated.Strength.LessThan(a.config.MinStrength) {
			continue
		}
		if aggregated.Confidence.LessThan(a.config.MinConfidence) {
			continue
		}
		if aggregated.ConsensusScore.LessThan(a.config.MinConsensus) {
			continue
		}
		
		// Update and emit
		a.aggregated[symbol] = aggregated
		
		select {
		case a.signals <- aggregated:
		default:
			a.logger.Warn("Signal buffer full, dropping aggregated signal",
				zap.String("symbol", symbol))
		}
	}
}

// calculateAggregatedSignal calculates the aggregated signal.
func (a *Aggregator) calculateAggregatedSignal(
	symbol string,
	sourceSignals map[string][]*types.Signal,
) *AggregatedSignal {
	var (
		totalWeight    = decimal.Zero
		buyWeight      = decimal.Zero
		sellWeight     = decimal.Zero
		strengthSum    = decimal.Zero
		confidenceSum  = decimal.Zero
		sources        []string
		allSignals     []*types.Signal
	)
	
	for sourceName, signals := range sourceSignals {
		sources = append(sources, sourceName)
		
		sourceWeight := a.weights[sourceName]
		if sourceWeight.IsZero() {
			sourceWeight = decimal.NewFromFloat(1.0)
		}
		
		// Take the most recent signal from each source
		latestSignal := signals[len(signals)-1]
		allSignals = append(allSignals, latestSignal)
		
		totalWeight = totalWeight.Add(sourceWeight)
		
		switch latestSignal.Direction {
		case types.SignalBuy:
			buyWeight = buyWeight.Add(sourceWeight.Mul(latestSignal.Strength))
		case types.SignalSell:
			sellWeight = sellWeight.Add(sourceWeight.Mul(latestSignal.Strength))
		}
		
		strengthSum = strengthSum.Add(latestSignal.Strength.Mul(sourceWeight))
		confidenceSum = confidenceSum.Add(latestSignal.Confidence.Mul(sourceWeight))
	}
	
	// Determine direction
	var direction types.SignalDirection
	var directionWeight decimal.Decimal
	
	if buyWeight.GreaterThan(sellWeight) {
		direction = types.SignalBuy
		directionWeight = buyWeight
	} else if sellWeight.GreaterThan(buyWeight) {
		direction = types.SignalSell
		directionWeight = sellWeight
	} else {
		direction = types.SignalHold
		directionWeight = decimal.Zero
	}
	
	// Calculate consensus (how much sources agree)
	totalDirectionWeight := buyWeight.Add(sellWeight)
	var consensus decimal.Decimal
	if !totalDirectionWeight.IsZero() {
		consensus = directionWeight.Div(totalDirectionWeight)
	}
	
	// Calculate weighted averages
	avgStrength := strengthSum.Div(totalWeight)
	avgConfidence := confidenceSum.Div(totalWeight)
	
	// Calculate suggested levels
	suggestedEntry, suggestedStop, suggestedTarget := a.calculateLevels(allSignals, direction)
	
	// Calculate risk/reward
	var rrRatio decimal.Decimal
	if !suggestedEntry.IsZero() && !suggestedStop.IsZero() && !suggestedTarget.IsZero() {
		risk := suggestedEntry.Sub(suggestedStop).Abs()
		reward := suggestedTarget.Sub(suggestedEntry).Abs()
		if !risk.IsZero() {
			rrRatio = reward.Div(risk)
		}
	}
	
	return &AggregatedSignal{
		Symbol:          symbol,
		Direction:       direction,
		Strength:        avgStrength,
		Confidence:      avgConfidence.Mul(consensus), // Scale confidence by consensus
		Sources:         sources,
		SourceSignals:   allSignals,
		ConsensusScore:  consensus,
		Timestamp:       time.Now(),
		ExpiresAt:       time.Now().Add(a.config.AggregationWindow),
		SuggestedEntry:  suggestedEntry,
		SuggestedStop:   suggestedStop,
		SuggestedTarget: suggestedTarget,
		RiskRewardRatio: rrRatio,
	}
}

// calculateLevels calculates suggested entry, stop, and target levels.
func (a *Aggregator) calculateLevels(
	signals []*types.Signal,
	direction types.SignalDirection,
) (entry, stop, target decimal.Decimal) {
	var entrySum, stopSum, targetSum decimal.Decimal
	var entryCount, stopCount, targetCount int
	
	for _, s := range signals {
		if !s.Price.IsZero() {
			entrySum = entrySum.Add(s.Price)
			entryCount++
		}
		if !s.StopLoss.IsZero() {
			stopSum = stopSum.Add(s.StopLoss)
			stopCount++
		}
		if !s.TakeProfit.IsZero() {
			targetSum = targetSum.Add(s.TakeProfit)
			targetCount++
		}
	}
	
	if entryCount > 0 {
		entry = entrySum.Div(decimal.NewFromInt(int64(entryCount)))
	}
	if stopCount > 0 {
		stop = stopSum.Div(decimal.NewFromInt(int64(stopCount)))
	}
	if targetCount > 0 {
		target = targetSum.Div(decimal.NewFromInt(int64(targetCount)))
	}
	
	return entry, stop, target
}

// TechnicalSignalSource provides signals from technical analysis.
type TechnicalSignalSource struct {
	logger     *zap.Logger
	name       string
	httpClient *http.Client
	apiURL     string
	apiKey     string
	health     SourceHealth
	mu         sync.RWMutex
}

// NewTechnicalSignalSource creates a technical analysis signal source.
func NewTechnicalSignalSource(logger *zap.Logger, apiURL, apiKey string) *TechnicalSignalSource {
	return &TechnicalSignalSource{
		logger:     logger.Named("technical-signals"),
		name:       "technical",
		httpClient: &http.Client{Timeout: 30 * time.Second},
		apiURL:     apiURL,
		apiKey:     apiKey,
		health: SourceHealth{
			IsHealthy: true,
		},
	}
}

func (t *TechnicalSignalSource) Name() string           { return t.name }
func (t *TechnicalSignalSource) Type() SignalSourceType { return SourceTypeTechnical }

func (t *TechnicalSignalSource) Health() SourceHealth {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return t.health
}

func (t *TechnicalSignalSource) Subscribe(ctx context.Context, symbols []string) (<-chan *types.Signal, error) {
	signalChan := make(chan *types.Signal, 100)
	
	go func() {
		defer close(signalChan)
		
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				for _, symbol := range symbols {
					signals, err := t.GetLatestSignals(ctx, symbol)
					if err != nil {
						t.logger.Debug("Failed to get signals", zap.String("symbol", symbol), zap.Error(err))
						continue
					}
					
					for _, signal := range signals {
						select {
						case signalChan <- signal:
						case <-ctx.Done():
							return
						}
					}
				}
			}
		}
	}()
	
	return signalChan, nil
}

func (t *TechnicalSignalSource) GetLatestSignals(ctx context.Context, symbol string) ([]*types.Signal, error) {
	// Generate technical signals based on indicators
	// In production, this would call external APIs or calculate locally
	
	signals := make([]*types.Signal, 0)
	
	// RSI signal
	rsiSignal := t.generateRSISignal(symbol)
	if rsiSignal != nil {
		signals = append(signals, rsiSignal)
	}
	
	// MACD signal
	macdSignal := t.generateMACDSignal(symbol)
	if macdSignal != nil {
		signals = append(signals, macdSignal)
	}
	
	// Moving Average signal
	maSignal := t.generateMASignal(symbol)
	if maSignal != nil {
		signals = append(signals, maSignal)
	}
	
	t.mu.Lock()
	t.health.LastSignalTime = time.Now()
	t.health.IsHealthy = true
	t.mu.Unlock()
	
	return signals, nil
}

func (t *TechnicalSignalSource) generateRSISignal(symbol string) *types.Signal {
	// Placeholder - would calculate real RSI
	return &types.Signal{
		ID:         fmt.Sprintf("rsi-%s-%d", symbol, time.Now().UnixNano()),
		Symbol:     symbol,
		Direction:  types.SignalBuy,
		Strength:   decimal.NewFromFloat(0.7),
		Confidence: decimal.NewFromFloat(0.75),
		Source:     "technical-rsi",
		Timestamp:  time.Now(),
		Metadata: map[string]interface{}{
			"indicator": "RSI",
			"value":     35.5,
			"condition": "oversold",
		},
	}
}

func (t *TechnicalSignalSource) generateMACDSignal(symbol string) *types.Signal {
	return &types.Signal{
		ID:         fmt.Sprintf("macd-%s-%d", symbol, time.Now().UnixNano()),
		Symbol:     symbol,
		Direction:  types.SignalHold,
		Strength:   decimal.NewFromFloat(0.5),
		Confidence: decimal.NewFromFloat(0.65),
		Source:     "technical-macd",
		Timestamp:  time.Now(),
		Metadata: map[string]interface{}{
			"indicator":  "MACD",
			"macd":       0.05,
			"signal":     0.03,
			"histogram":  0.02,
		},
	}
}

func (t *TechnicalSignalSource) generateMASignal(symbol string) *types.Signal {
	return &types.Signal{
		ID:         fmt.Sprintf("ma-%s-%d", symbol, time.Now().UnixNano()),
		Symbol:     symbol,
		Direction:  types.SignalBuy,
		Strength:   decimal.NewFromFloat(0.6),
		Confidence: decimal.NewFromFloat(0.7),
		Source:     "technical-ma",
		Timestamp:  time.Now(),
		Metadata: map[string]interface{}{
			"indicator": "SMA_Crossover",
			"fast":      50,
			"slow":      200,
			"crossover": "bullish",
		},
	}
}

// SentimentSignalSource provides signals from sentiment analysis.
type SentimentSignalSource struct {
	logger     *zap.Logger
	name       string
	httpClient *http.Client
	apiURL     string
	apiKey     string
	health     SourceHealth
	mu         sync.RWMutex
}

// NewSentimentSignalSource creates a sentiment analysis signal source.
func NewSentimentSignalSource(logger *zap.Logger, apiURL, apiKey string) *SentimentSignalSource {
	return &SentimentSignalSource{
		logger:     logger.Named("sentiment-signals"),
		name:       "sentiment",
		httpClient: &http.Client{Timeout: 30 * time.Second},
		apiURL:     apiURL,
		apiKey:     apiKey,
		health: SourceHealth{
			IsHealthy: true,
		},
	}
}

func (s *SentimentSignalSource) Name() string           { return s.name }
func (s *SentimentSignalSource) Type() SignalSourceType { return SourceTypeSentiment }

func (s *SentimentSignalSource) Health() SourceHealth {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.health
}

func (s *SentimentSignalSource) Subscribe(ctx context.Context, symbols []string) (<-chan *types.Signal, error) {
	signalChan := make(chan *types.Signal, 100)
	
	go func() {
		defer close(signalChan)
		
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				for _, symbol := range symbols {
					signals, err := s.GetLatestSignals(ctx, symbol)
					if err != nil {
						continue
					}
					
					for _, signal := range signals {
						select {
						case signalChan <- signal:
						case <-ctx.Done():
							return
						}
					}
				}
			}
		}
	}()
	
	return signalChan, nil
}

func (s *SentimentSignalSource) GetLatestSignals(ctx context.Context, symbol string) ([]*types.Signal, error) {
	// In production, would call sentiment APIs (Santiment, LunarCrush, etc.)
	
	signal := &types.Signal{
		ID:         fmt.Sprintf("sentiment-%s-%d", symbol, time.Now().UnixNano()),
		Symbol:     symbol,
		Direction:  types.SignalBuy,
		Strength:   decimal.NewFromFloat(0.65),
		Confidence: decimal.NewFromFloat(0.6),
		Source:     "sentiment",
		Timestamp:  time.Now(),
		Metadata: map[string]interface{}{
			"socialVolume":    12500,
			"socialDominance": 3.5,
			"sentiment":       "positive",
			"fearGreedIndex":  65,
		},
	}
	
	s.mu.Lock()
	s.health.LastSignalTime = time.Now()
	s.health.IsHealthy = true
	s.mu.Unlock()
	
	return []*types.Signal{signal}, nil
}

// OnChainSignalSource provides signals from on-chain data.
type OnChainSignalSource struct {
	logger     *zap.Logger
	name       string
	httpClient *http.Client
	health     SourceHealth
	mu         sync.RWMutex
}

// NewOnChainSignalSource creates an on-chain signal source.
func NewOnChainSignalSource(logger *zap.Logger) *OnChainSignalSource {
	return &OnChainSignalSource{
		logger:     logger.Named("onchain-signals"),
		name:       "onchain",
		httpClient: &http.Client{Timeout: 30 * time.Second},
		health: SourceHealth{
			IsHealthy: true,
		},
	}
}

func (o *OnChainSignalSource) Name() string           { return o.name }
func (o *OnChainSignalSource) Type() SignalSourceType { return SourceTypeOnChain }

func (o *OnChainSignalSource) Health() SourceHealth {
	o.mu.RLock()
	defer o.mu.RUnlock()
	return o.health
}

func (o *OnChainSignalSource) Subscribe(ctx context.Context, symbols []string) (<-chan *types.Signal, error) {
	signalChan := make(chan *types.Signal, 100)
	
	go func() {
		defer close(signalChan)
		
		ticker := time.NewTicker(2 * time.Minute)
		defer ticker.Stop()
		
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				for _, symbol := range symbols {
					signals, err := o.GetLatestSignals(ctx, symbol)
					if err != nil {
						continue
					}
					
					for _, signal := range signals {
						select {
						case signalChan <- signal:
						case <-ctx.Done():
							return
						}
					}
				}
			}
		}
	}()
	
	return signalChan, nil
}

func (o *OnChainSignalSource) GetLatestSignals(ctx context.Context, symbol string) ([]*types.Signal, error) {
	// In production, would analyze:
	// - Whale movements
	// - Exchange inflows/outflows
	// - Active addresses
	// - Network value metrics
	
	signal := &types.Signal{
		ID:         fmt.Sprintf("onchain-%s-%d", symbol, time.Now().UnixNano()),
		Symbol:     symbol,
		Direction:  types.SignalBuy,
		Strength:   decimal.NewFromFloat(0.8),
		Confidence: decimal.NewFromFloat(0.85),
		Source:     "onchain",
		Timestamp:  time.Now(),
		Metadata: map[string]interface{}{
			"whaleAccumulation": true,
			"exchangeOutflow":   15000000,
			"activeAddresses":   125000,
			"nvtRatio":          45.2,
		},
	}
	
	o.mu.Lock()
	o.health.LastSignalTime = time.Now()
	o.health.IsHealthy = true
	o.mu.Unlock()
	
	return []*types.Signal{signal}, nil
}

// PerplexitySignalSource provides AI research signals via Perplexity API.
type PerplexitySignalSource struct {
	logger     *zap.Logger
	name       string
	httpClient *http.Client
	apiKey     string
	health     SourceHealth
	mu         sync.RWMutex
}

// NewPerplexitySignalSource creates a Perplexity AI signal source.
func NewPerplexitySignalSource(logger *zap.Logger, apiKey string) *PerplexitySignalSource {
	return &PerplexitySignalSource{
		logger:     logger.Named("perplexity-signals"),
		name:       "perplexity",
		httpClient: &http.Client{Timeout: 60 * time.Second},
		apiKey:     apiKey,
		health: SourceHealth{
			IsHealthy: true,
		},
	}
}

func (p *PerplexitySignalSource) Name() string           { return p.name }
func (p *PerplexitySignalSource) Type() SignalSourceType { return SourceTypeAI }

func (p *PerplexitySignalSource) Health() SourceHealth {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.health
}

func (p *PerplexitySignalSource) Subscribe(ctx context.Context, symbols []string) (<-chan *types.Signal, error) {
	signalChan := make(chan *types.Signal, 100)
	
	go func() {
		defer close(signalChan)
		
		// AI research less frequently
		ticker := time.NewTicker(15 * time.Minute)
		defer ticker.Stop()
		
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				for _, symbol := range symbols {
					signals, err := p.GetLatestSignals(ctx, symbol)
					if err != nil {
						p.logger.Debug("Failed to get Perplexity signals",
							zap.String("symbol", symbol),
							zap.Error(err))
						continue
					}
					
					for _, signal := range signals {
						select {
						case signalChan <- signal:
						case <-ctx.Done():
							return
						}
					}
				}
			}
		}
	}()
	
	return signalChan, nil
}

func (p *PerplexitySignalSource) GetLatestSignals(ctx context.Context, symbol string) ([]*types.Signal, error) {
	if p.apiKey == "" {
		return nil, fmt.Errorf("perplexity API key not configured")
	}
	
	// Query Perplexity for market analysis
	query := fmt.Sprintf(`Analyze the current market conditions for %s cryptocurrency. 
		Provide a trading signal (BUY, SELL, or HOLD) with confidence level (0-100%%) and key reasons.
		Focus on: recent news, technical levels, market sentiment, and upcoming events.
		Format: SIGNAL: [BUY/SELL/HOLD], CONFIDENCE: [0-100], REASONS: [brief list]`, symbol)
	
	// Call Perplexity API
	response, err := p.callPerplexity(ctx, query)
	if err != nil {
		p.mu.Lock()
		p.health.IsHealthy = false
		p.health.LastError = err.Error()
		p.mu.Unlock()
		return nil, err
	}
	
	// Parse response into signal
	signal := p.parseResponse(symbol, response)
	
	p.mu.Lock()
	p.health.LastSignalTime = time.Now()
	p.health.IsHealthy = true
	p.health.LastError = ""
	p.mu.Unlock()
	
	return []*types.Signal{signal}, nil
}

func (p *PerplexitySignalSource) callPerplexity(ctx context.Context, query string) (string, error) {
	reqBody := map[string]interface{}{
		"model": "llama-3.1-sonar-large-128k-online",
		"messages": []map[string]string{
			{
				"role":    "system",
				"content": "You are a professional cryptocurrency market analyst. Provide concise, actionable trading signals based on current market data.",
			},
			{
				"role":    "user",
				"content": query,
			},
		},
		"temperature": 0.2,
		"max_tokens":  500,
	}
	
	jsonBody, _ := json.Marshal(reqBody)
	
	req, err := http.NewRequestWithContext(ctx, "POST", "https://api.perplexity.ai/chat/completions", 
		bytes.NewReader(jsonBody))
	if err != nil {
		return "", err
	}
	
	req.Header.Set("Authorization", "Bearer "+p.apiKey)
	req.Header.Set("Content-Type", "application/json")
	
	resp, err := p.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("perplexity API error: %d", resp.StatusCode)
	}
	
	var result struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}
	
	if len(result.Choices) == 0 {
		return "", fmt.Errorf("no response from Perplexity")
	}
	
	return result.Choices[0].Message.Content, nil
}

func (p *PerplexitySignalSource) parseResponse(symbol, response string) *types.Signal {
	// Default values
	direction := types.SignalHold
	strength := decimal.NewFromFloat(0.5)
	confidence := decimal.NewFromFloat(0.5)
	
	// Simple parsing - in production would use better NLP
	if contains(response, "BUY") || contains(response, "bullish") {
		direction = types.SignalBuy
		strength = decimal.NewFromFloat(0.7)
	} else if contains(response, "SELL") || contains(response, "bearish") {
		direction = types.SignalSell
		strength = decimal.NewFromFloat(0.7)
	}
	
	// Extract confidence if mentioned
	if contains(response, "high confidence") || contains(response, "90") {
		confidence = decimal.NewFromFloat(0.9)
	} else if contains(response, "moderate") || contains(response, "70") {
		confidence = decimal.NewFromFloat(0.7)
	}
	
	return &types.Signal{
		ID:         fmt.Sprintf("perplexity-%s-%d", symbol, time.Now().UnixNano()),
		Symbol:     symbol,
		Direction:  direction,
		Strength:   strength,
		Confidence: confidence,
		Source:     "perplexity",
		Timestamp:  time.Now(),
		Metadata: map[string]interface{}{
			"analysis": response,
			"model":    "llama-3.1-sonar-large-128k-online",
		},
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && containsHelper(s, substr))
}

func containsHelper(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}

// bytes import needed for Perplexity
import "bytes"
