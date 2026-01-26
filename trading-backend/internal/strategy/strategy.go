// Package strategy provides trading strategy implementations.
package strategy

import (
	"context"
	"sync"
	"time"

	"github.com/atlas-desktop/trading-backend/pkg/types"
	"github.com/shopspring/decimal"
	"go.uber.org/zap"
)

// Strategy is the interface all strategies must implement.
type Strategy interface {
	Name() string
	Description() string
	Parameters() map[string]StrategyParameter
	SetParameter(name string, value interface{}) error
	Initialize(ctx context.Context) error
	OnBar(bar types.OHLCV) (*Signal, error)
	OnTick(tick TickData) (*Signal, error)
	Reset()
}

// StrategyParameter defines a strategy parameter.
type StrategyParameter struct {
	Name        string      `json:"name"`
	Description string      `json:"description"`
	Type        string      `json:"type"` // "int", "float", "bool", "string"
	Default     interface{} `json:"default"`
	Min         interface{} `json:"min,omitempty"`
	Max         interface{} `json:"max,omitempty"`
	Current     interface{} `json:"current"`
}

// TickData represents tick-level market data.
type TickData struct {
	Symbol    string
	Bid       decimal.Decimal
	Ask       decimal.Decimal
	BidSize   decimal.Decimal
	AskSize   decimal.Decimal
	Last      decimal.Decimal
	Volume    decimal.Decimal
	Timestamp time.Time
}

// Signal represents a trading signal from a strategy.
type Signal struct {
	Symbol      string
	Side        types.OrderSide
	Strength    decimal.Decimal // 0-1
	StopLoss    decimal.Decimal
	TakeProfit  decimal.Decimal
	Reason      string
	Metadata    map[string]interface{}
	GeneratedAt time.Time
}

// StrategyRegistry manages available strategies.
type StrategyRegistry struct {
	logger     *zap.Logger
	strategies map[string]func() Strategy
	mu         sync.RWMutex
}

// NewStrategyRegistry creates a new strategy registry.
func NewStrategyRegistry(logger *zap.Logger) *StrategyRegistry {
	r := &StrategyRegistry{
		logger:     logger,
		strategies: make(map[string]func() Strategy),
	}
	
	// Register built-in strategies
	r.Register("momentum", func() Strategy { return NewMomentumStrategy(logger) })
	r.Register("mean_reversion", func() Strategy { return NewMeanReversionStrategy(logger) })
	r.Register("breakout", func() Strategy { return NewBreakoutStrategy(logger) })
	r.Register("trend_following", func() Strategy { return NewTrendFollowingStrategy(logger) })
	r.Register("rsi_divergence", func() Strategy { return NewRSIDivergenceStrategy(logger) })
	r.Register("vwap_reversion", func() Strategy { return NewVWAPReversionStrategy(logger) })
	r.Register("grid", func() Strategy { return NewGridStrategy(logger) })
	r.Register("dca", func() Strategy { return NewDCAStrategy(logger) })
	
	return r
}

// Register registers a new strategy factory.
func (r *StrategyRegistry) Register(name string, factory func() Strategy) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.strategies[name] = factory
}

// Create creates a new strategy instance by name.
func (r *StrategyRegistry) Create(name string) (Strategy, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	
	factory, ok := r.strategies[name]
	if !ok {
		return nil, false
	}
	
	return factory(), true
}

// List returns all available strategy names.
func (r *StrategyRegistry) List() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	
	names := make([]string, 0, len(r.strategies))
	for name := range r.strategies {
		names = append(names, name)
	}
	return names
}

// BaseStrategy provides common functionality.
type BaseStrategy struct {
	logger     *zap.Logger
	params     map[string]StrategyParameter
	bars       []types.OHLCV
	maxBars    int
}

// SetParameter sets a parameter value.
func (s *BaseStrategy) SetParameter(name string, value interface{}) error {
	if param, ok := s.params[name]; ok {
		param.Current = value
		s.params[name] = param
	}
	return nil
}

// Parameters returns strategy parameters.
func (s *BaseStrategy) Parameters() map[string]StrategyParameter {
	return s.params
}

// AddBar adds a bar to the buffer.
func (s *BaseStrategy) AddBar(bar types.OHLCV) {
	s.bars = append(s.bars, bar)
	if len(s.bars) > s.maxBars {
		s.bars = s.bars[1:]
	}
}

// Reset resets the strategy state.
func (s *BaseStrategy) Reset() {
	s.bars = s.bars[:0]
}

// MomentumStrategy implements momentum-based trading.
type MomentumStrategy struct {
	BaseStrategy
	period     int
	threshold  decimal.Decimal
}

// NewMomentumStrategy creates a new momentum strategy.
func NewMomentumStrategy(logger *zap.Logger) *MomentumStrategy {
	s := &MomentumStrategy{
		BaseStrategy: BaseStrategy{
			logger:  logger,
			params:  make(map[string]StrategyParameter),
			maxBars: 200,
		},
		period:    14,
		threshold: decimal.NewFromFloat(0.02),
	}
	
	s.params["period"] = StrategyParameter{
		Name:        "period",
		Description: "Lookback period for momentum calculation",
		Type:        "int",
		Default:     14,
		Min:         5,
		Max:         100,
		Current:     14,
	}
	s.params["threshold"] = StrategyParameter{
		Name:        "threshold",
		Description: "Minimum momentum threshold for signal",
		Type:        "float",
		Default:     0.02,
		Min:         0.001,
		Max:         0.1,
		Current:     0.02,
	}
	
	return s
}

func (s *MomentumStrategy) Name() string { return "momentum" }
func (s *MomentumStrategy) Description() string { 
	return "Trades based on price momentum over a lookback period"
}

func (s *MomentumStrategy) Initialize(ctx context.Context) error {
	s.bars = make([]types.OHLCV, 0, s.maxBars)
	return nil
}

func (s *MomentumStrategy) OnBar(bar types.OHLCV) (*Signal, error) {
	s.AddBar(bar)
	
	if len(s.bars) < s.period {
		return nil, nil
	}
	
	// Calculate momentum
	current := s.bars[len(s.bars)-1].Close
	past := s.bars[len(s.bars)-s.period].Close
	
	if past.IsZero() {
		return nil, nil
	}
	
	momentum := current.Sub(past).Div(past)
	
	// Generate signal if momentum exceeds threshold
	if momentum.GreaterThan(s.threshold) {
		return &Signal{
			Symbol:      bar.Symbol,
			Side:        types.OrderSideBuy,
			Strength:    momentum.Div(s.threshold).Min(decimal.NewFromInt(1)),
			StopLoss:    current.Mul(decimal.NewFromFloat(0.95)),
			TakeProfit:  current.Mul(decimal.NewFromFloat(1.05)),
			Reason:      "Strong positive momentum",
			GeneratedAt: time.Now(),
		}, nil
	} else if momentum.LessThan(s.threshold.Neg()) {
		return &Signal{
			Symbol:      bar.Symbol,
			Side:        types.OrderSideSell,
			Strength:    momentum.Abs().Div(s.threshold).Min(decimal.NewFromInt(1)),
			StopLoss:    current.Mul(decimal.NewFromFloat(1.05)),
			TakeProfit:  current.Mul(decimal.NewFromFloat(0.95)),
			Reason:      "Strong negative momentum",
			GeneratedAt: time.Now(),
		}, nil
	}
	
	return nil, nil
}

func (s *MomentumStrategy) OnTick(tick TickData) (*Signal, error) {
	return nil, nil
}

// MeanReversionStrategy implements mean reversion trading.
type MeanReversionStrategy struct {
	BaseStrategy
	period      int
	stdDevMult  decimal.Decimal
	ema         decimal.Decimal
	squaredSum  decimal.Decimal
	count       int
}

// NewMeanReversionStrategy creates a new mean reversion strategy.
func NewMeanReversionStrategy(logger *zap.Logger) *MeanReversionStrategy {
	s := &MeanReversionStrategy{
		BaseStrategy: BaseStrategy{
			logger:  logger,
			params:  make(map[string]StrategyParameter),
			maxBars: 200,
		},
		period:     20,
		stdDevMult: decimal.NewFromFloat(2.0),
	}
	
	s.params["period"] = StrategyParameter{
		Name:        "period",
		Description: "Period for moving average calculation",
		Type:        "int",
		Default:     20,
		Min:         10,
		Max:         100,
		Current:     20,
	}
	s.params["std_dev_mult"] = StrategyParameter{
		Name:        "std_dev_mult",
		Description: "Standard deviation multiplier for Bollinger Bands",
		Type:        "float",
		Default:     2.0,
		Min:         1.0,
		Max:         3.0,
		Current:     2.0,
	}
	
	return s
}

func (s *MeanReversionStrategy) Name() string { return "mean_reversion" }
func (s *MeanReversionStrategy) Description() string {
	return "Trades when price deviates from moving average by multiple standard deviations"
}

func (s *MeanReversionStrategy) Initialize(ctx context.Context) error {
	s.bars = make([]types.OHLCV, 0, s.maxBars)
	s.ema = decimal.Zero
	s.squaredSum = decimal.Zero
	s.count = 0
	return nil
}

func (s *MeanReversionStrategy) OnBar(bar types.OHLCV) (*Signal, error) {
	s.AddBar(bar)
	
	if len(s.bars) < s.period {
		return nil, nil
	}
	
	// Calculate SMA and Std Dev
	sum := decimal.Zero
	for i := len(s.bars) - s.period; i < len(s.bars); i++ {
		sum = sum.Add(s.bars[i].Close)
	}
	sma := sum.Div(decimal.NewFromInt(int64(s.period)))
	
	variance := decimal.Zero
	for i := len(s.bars) - s.period; i < len(s.bars); i++ {
		diff := s.bars[i].Close.Sub(sma)
		variance = variance.Add(diff.Mul(diff))
	}
	variance = variance.Div(decimal.NewFromInt(int64(s.period)))
	
	// Approximate sqrt using Newton's method
	stdDev := sqrtDecimal(variance)
	
	current := bar.Close
	upperBand := sma.Add(stdDev.Mul(s.stdDevMult))
	lowerBand := sma.Sub(stdDev.Mul(s.stdDevMult))
	
	// Generate signals at Bollinger Band extremes
	if current.LessThan(lowerBand) {
		// Price below lower band - buy for mean reversion
		deviation := lowerBand.Sub(current).Div(stdDev)
		return &Signal{
			Symbol:      bar.Symbol,
			Side:        types.OrderSideBuy,
			Strength:    deviation.Div(s.stdDevMult).Min(decimal.NewFromInt(1)),
			StopLoss:    current.Mul(decimal.NewFromFloat(0.97)),
			TakeProfit:  sma,
			Reason:      "Price below lower Bollinger Band",
			Metadata:    map[string]interface{}{"sma": sma, "stdDev": stdDev},
			GeneratedAt: time.Now(),
		}, nil
	} else if current.GreaterThan(upperBand) {
		// Price above upper band - sell for mean reversion
		deviation := current.Sub(upperBand).Div(stdDev)
		return &Signal{
			Symbol:      bar.Symbol,
			Side:        types.OrderSideSell,
			Strength:    deviation.Div(s.stdDevMult).Min(decimal.NewFromInt(1)),
			StopLoss:    current.Mul(decimal.NewFromFloat(1.03)),
			TakeProfit:  sma,
			Reason:      "Price above upper Bollinger Band",
			Metadata:    map[string]interface{}{"sma": sma, "stdDev": stdDev},
			GeneratedAt: time.Now(),
		}, nil
	}
	
	return nil, nil
}

func (s *MeanReversionStrategy) OnTick(tick TickData) (*Signal, error) {
	return nil, nil
}

// BreakoutStrategy implements breakout trading.
type BreakoutStrategy struct {
	BaseStrategy
	lookback    int
	minVolMult  decimal.Decimal
}

// NewBreakoutStrategy creates a new breakout strategy.
func NewBreakoutStrategy(logger *zap.Logger) *BreakoutStrategy {
	s := &BreakoutStrategy{
		BaseStrategy: BaseStrategy{
			logger:  logger,
			params:  make(map[string]StrategyParameter),
			maxBars: 100,
		},
		lookback:   20,
		minVolMult: decimal.NewFromFloat(1.5),
	}
	
	s.params["lookback"] = StrategyParameter{
		Name:        "lookback",
		Description: "Period for high/low detection",
		Type:        "int",
		Default:     20,
		Min:         5,
		Max:         50,
		Current:     20,
	}
	s.params["min_volume_mult"] = StrategyParameter{
		Name:        "min_volume_mult",
		Description: "Minimum volume multiplier for breakout confirmation",
		Type:        "float",
		Default:     1.5,
		Min:         1.0,
		Max:         3.0,
		Current:     1.5,
	}
	
	return s
}

func (s *BreakoutStrategy) Name() string { return "breakout" }
func (s *BreakoutStrategy) Description() string {
	return "Trades breakouts from consolidation ranges with volume confirmation"
}

func (s *BreakoutStrategy) Initialize(ctx context.Context) error {
	s.bars = make([]types.OHLCV, 0, s.maxBars)
	return nil
}

func (s *BreakoutStrategy) OnBar(bar types.OHLCV) (*Signal, error) {
	s.AddBar(bar)
	
	if len(s.bars) < s.lookback+1 {
		return nil, nil
	}
	
	// Find highest high and lowest low in lookback period
	highest := decimal.Zero
	lowest := decimal.NewFromFloat(999999999)
	avgVolume := decimal.Zero
	
	for i := len(s.bars) - s.lookback - 1; i < len(s.bars)-1; i++ {
		if s.bars[i].High.GreaterThan(highest) {
			highest = s.bars[i].High
		}
		if s.bars[i].Low.LessThan(lowest) {
			lowest = s.bars[i].Low
		}
		avgVolume = avgVolume.Add(s.bars[i].Volume)
	}
	avgVolume = avgVolume.Div(decimal.NewFromInt(int64(s.lookback)))
	
	current := bar.Close
	currentVol := bar.Volume
	
	// Check for volume confirmation
	hasVolumeConfirm := currentVol.GreaterThan(avgVolume.Mul(s.minVolMult))
	
	if current.GreaterThan(highest) && hasVolumeConfirm {
		// Bullish breakout
		rangeSize := highest.Sub(lowest)
		return &Signal{
			Symbol:      bar.Symbol,
			Side:        types.OrderSideBuy,
			Strength:    decimal.NewFromFloat(0.8),
			StopLoss:    highest.Sub(rangeSize.Mul(decimal.NewFromFloat(0.5))),
			TakeProfit:  current.Add(rangeSize),
			Reason:      "Bullish breakout with volume",
			Metadata:    map[string]interface{}{"highest": highest, "volume_mult": currentVol.Div(avgVolume)},
			GeneratedAt: time.Now(),
		}, nil
	} else if current.LessThan(lowest) && hasVolumeConfirm {
		// Bearish breakout
		rangeSize := highest.Sub(lowest)
		return &Signal{
			Symbol:      bar.Symbol,
			Side:        types.OrderSideSell,
			Strength:    decimal.NewFromFloat(0.8),
			StopLoss:    lowest.Add(rangeSize.Mul(decimal.NewFromFloat(0.5))),
			TakeProfit:  current.Sub(rangeSize),
			Reason:      "Bearish breakout with volume",
			Metadata:    map[string]interface{}{"lowest": lowest, "volume_mult": currentVol.Div(avgVolume)},
			GeneratedAt: time.Now(),
		}, nil
	}
	
	return nil, nil
}

func (s *BreakoutStrategy) OnTick(tick TickData) (*Signal, error) {
	return nil, nil
}

// TrendFollowingStrategy implements trend following with multiple timeframes.
type TrendFollowingStrategy struct {
	BaseStrategy
	fastPeriod int
	slowPeriod int
	fastEMA    decimal.Decimal
	slowEMA    decimal.Decimal
}

// NewTrendFollowingStrategy creates a new trend following strategy.
func NewTrendFollowingStrategy(logger *zap.Logger) *TrendFollowingStrategy {
	s := &TrendFollowingStrategy{
		BaseStrategy: BaseStrategy{
			logger:  logger,
			params:  make(map[string]StrategyParameter),
			maxBars: 200,
		},
		fastPeriod: 12,
		slowPeriod: 26,
	}
	
	s.params["fast_period"] = StrategyParameter{
		Name:        "fast_period",
		Description: "Fast EMA period",
		Type:        "int",
		Default:     12,
		Min:         5,
		Max:         50,
		Current:     12,
	}
	s.params["slow_period"] = StrategyParameter{
		Name:        "slow_period",
		Description: "Slow EMA period",
		Type:        "int",
		Default:     26,
		Min:         10,
		Max:         100,
		Current:     26,
	}
	
	return s
}

func (s *TrendFollowingStrategy) Name() string { return "trend_following" }
func (s *TrendFollowingStrategy) Description() string {
	return "Follows trends using EMA crossovers"
}

func (s *TrendFollowingStrategy) Initialize(ctx context.Context) error {
	s.bars = make([]types.OHLCV, 0, s.maxBars)
	s.fastEMA = decimal.Zero
	s.slowEMA = decimal.Zero
	return nil
}

func (s *TrendFollowingStrategy) OnBar(bar types.OHLCV) (*Signal, error) {
	s.AddBar(bar)
	
	price := bar.Close
	
	// Update EMAs
	if s.fastEMA.IsZero() {
		s.fastEMA = price
		s.slowEMA = price
		return nil, nil
	}
	
	fastMult := decimal.NewFromFloat(2.0).Div(decimal.NewFromInt(int64(s.fastPeriod + 1)))
	slowMult := decimal.NewFromFloat(2.0).Div(decimal.NewFromInt(int64(s.slowPeriod + 1)))
	
	prevFastEMA := s.fastEMA
	prevSlowEMA := s.slowEMA
	
	s.fastEMA = price.Mul(fastMult).Add(s.fastEMA.Mul(decimal.NewFromInt(1).Sub(fastMult)))
	s.slowEMA = price.Mul(slowMult).Add(s.slowEMA.Mul(decimal.NewFromInt(1).Sub(slowMult)))
	
	if len(s.bars) < s.slowPeriod {
		return nil, nil
	}
	
	// Detect crossovers
	wasBullish := prevFastEMA.GreaterThan(prevSlowEMA)
	isBullish := s.fastEMA.GreaterThan(s.slowEMA)
	
	if !wasBullish && isBullish {
		// Bullish crossover
		return &Signal{
			Symbol:      bar.Symbol,
			Side:        types.OrderSideBuy,
			Strength:    decimal.NewFromFloat(0.7),
			StopLoss:    s.slowEMA.Mul(decimal.NewFromFloat(0.97)),
			TakeProfit:  price.Mul(decimal.NewFromFloat(1.06)),
			Reason:      "Bullish EMA crossover",
			Metadata:    map[string]interface{}{"fast_ema": s.fastEMA, "slow_ema": s.slowEMA},
			GeneratedAt: time.Now(),
		}, nil
	} else if wasBullish && !isBullish {
		// Bearish crossover
		return &Signal{
			Symbol:      bar.Symbol,
			Side:        types.OrderSideSell,
			Strength:    decimal.NewFromFloat(0.7),
			StopLoss:    s.slowEMA.Mul(decimal.NewFromFloat(1.03)),
			TakeProfit:  price.Mul(decimal.NewFromFloat(0.94)),
			Reason:      "Bearish EMA crossover",
			Metadata:    map[string]interface{}{"fast_ema": s.fastEMA, "slow_ema": s.slowEMA},
			GeneratedAt: time.Now(),
		}, nil
	}
	
	return nil, nil
}

func (s *TrendFollowingStrategy) OnTick(tick TickData) (*Signal, error) {
	return nil, nil
}

// RSIDivergenceStrategy implements RSI divergence trading.
type RSIDivergenceStrategy struct {
	BaseStrategy
	period        int
	oversold      decimal.Decimal
	overbought    decimal.Decimal
	gains         []decimal.Decimal
	losses        []decimal.Decimal
	prevClose     decimal.Decimal
	avgGain       decimal.Decimal
	avgLoss       decimal.Decimal
	rsiValues     []decimal.Decimal
	priceValues   []decimal.Decimal
}

// NewRSIDivergenceStrategy creates a new RSI divergence strategy.
func NewRSIDivergenceStrategy(logger *zap.Logger) *RSIDivergenceStrategy {
	return &RSIDivergenceStrategy{
		BaseStrategy: BaseStrategy{
			logger:  logger,
			params:  make(map[string]StrategyParameter),
			maxBars: 200,
		},
		period:     14,
		oversold:   decimal.NewFromInt(30),
		overbought: decimal.NewFromInt(70),
		rsiValues:  make([]decimal.Decimal, 0, 50),
		priceValues: make([]decimal.Decimal, 0, 50),
	}
}

func (s *RSIDivergenceStrategy) Name() string { return "rsi_divergence" }
func (s *RSIDivergenceStrategy) Description() string {
	return "Detects and trades RSI divergences"
}

func (s *RSIDivergenceStrategy) Initialize(ctx context.Context) error {
	s.bars = make([]types.OHLCV, 0, s.maxBars)
	s.gains = make([]decimal.Decimal, 0)
	s.losses = make([]decimal.Decimal, 0)
	s.prevClose = decimal.Zero
	s.avgGain = decimal.Zero
	s.avgLoss = decimal.Zero
	return nil
}

func (s *RSIDivergenceStrategy) OnBar(bar types.OHLCV) (*Signal, error) {
	s.AddBar(bar)
	
	if s.prevClose.IsZero() {
		s.prevClose = bar.Close
		return nil, nil
	}
	
	// Calculate gain/loss
	change := bar.Close.Sub(s.prevClose)
	s.prevClose = bar.Close
	
	var gain, loss decimal.Decimal
	if change.GreaterThan(decimal.Zero) {
		gain = change
	} else {
		loss = change.Abs()
	}
	
	s.gains = append(s.gains, gain)
	s.losses = append(s.losses, loss)
	
	if len(s.gains) < s.period {
		return nil, nil
	}
	
	// Calculate RSI
	if s.avgGain.IsZero() {
		// Initial average
		sumGain := decimal.Zero
		sumLoss := decimal.Zero
		for i := 0; i < s.period; i++ {
			sumGain = sumGain.Add(s.gains[i])
			sumLoss = sumLoss.Add(s.losses[i])
		}
		s.avgGain = sumGain.Div(decimal.NewFromInt(int64(s.period)))
		s.avgLoss = sumLoss.Div(decimal.NewFromInt(int64(s.period)))
	} else {
		// Smoothed average
		periodDec := decimal.NewFromInt(int64(s.period))
		s.avgGain = s.avgGain.Mul(periodDec.Sub(decimal.NewFromInt(1))).Add(gain).Div(periodDec)
		s.avgLoss = s.avgLoss.Mul(periodDec.Sub(decimal.NewFromInt(1))).Add(loss).Div(periodDec)
	}
	
	var rsi decimal.Decimal
	if s.avgLoss.IsZero() {
		rsi = decimal.NewFromInt(100)
	} else {
		rs := s.avgGain.Div(s.avgLoss)
		rsi = decimal.NewFromInt(100).Sub(decimal.NewFromInt(100).Div(decimal.NewFromInt(1).Add(rs)))
	}
	
	// Track RSI and price values
	s.rsiValues = append(s.rsiValues, rsi)
	s.priceValues = append(s.priceValues, bar.Close)
	
	if len(s.rsiValues) > 20 {
		s.rsiValues = s.rsiValues[1:]
		s.priceValues = s.priceValues[1:]
	}
	
	if len(s.rsiValues) < 10 {
		return nil, nil
	}
	
	// Check for divergence
	if signal := s.checkDivergence(bar.Symbol); signal != nil {
		return signal, nil
	}
	
	return nil, nil
}

func (s *RSIDivergenceStrategy) checkDivergence(symbol string) *Signal {
	n := len(s.rsiValues)
	if n < 5 {
		return nil
	}
	
	// Find recent lows/highs in price and RSI
	currentPrice := s.priceValues[n-1]
	currentRSI := s.rsiValues[n-1]
	
	// Check for bullish divergence (price making lower lows, RSI making higher lows)
	if currentRSI.LessThan(s.oversold.Add(decimal.NewFromInt(10))) {
		for i := 0; i < n-3; i++ {
			if s.priceValues[i].GreaterThan(currentPrice) && s.rsiValues[i].LessThan(currentRSI) {
				// Bullish divergence
				return &Signal{
					Symbol:      symbol,
					Side:        types.OrderSideBuy,
					Strength:    decimal.NewFromFloat(0.75),
					StopLoss:    currentPrice.Mul(decimal.NewFromFloat(0.96)),
					TakeProfit:  currentPrice.Mul(decimal.NewFromFloat(1.08)),
					Reason:      "Bullish RSI divergence detected",
					Metadata:    map[string]interface{}{"rsi": currentRSI},
					GeneratedAt: time.Now(),
				}
			}
		}
	}
	
	// Check for bearish divergence (price making higher highs, RSI making lower highs)
	if currentRSI.GreaterThan(s.overbought.Sub(decimal.NewFromInt(10))) {
		for i := 0; i < n-3; i++ {
			if s.priceValues[i].LessThan(currentPrice) && s.rsiValues[i].GreaterThan(currentRSI) {
				// Bearish divergence
				return &Signal{
					Symbol:      symbol,
					Side:        types.OrderSideSell,
					Strength:    decimal.NewFromFloat(0.75),
					StopLoss:    currentPrice.Mul(decimal.NewFromFloat(1.04)),
					TakeProfit:  currentPrice.Mul(decimal.NewFromFloat(0.92)),
					Reason:      "Bearish RSI divergence detected",
					Metadata:    map[string]interface{}{"rsi": currentRSI},
					GeneratedAt: time.Now(),
				}
			}
		}
	}
	
	return nil
}

func (s *RSIDivergenceStrategy) OnTick(tick TickData) (*Signal, error) {
	return nil, nil
}

// VWAPReversionStrategy implements VWAP reversion.
type VWAPReversionStrategy struct {
	BaseStrategy
	stdDevMult    decimal.Decimal
	cumVolPrice   decimal.Decimal
	cumVolume     decimal.Decimal
	vwap          decimal.Decimal
	dayBars       []types.OHLCV
}

// NewVWAPReversionStrategy creates a new VWAP reversion strategy.
func NewVWAPReversionStrategy(logger *zap.Logger) *VWAPReversionStrategy {
	return &VWAPReversionStrategy{
		BaseStrategy: BaseStrategy{
			logger:  logger,
			params:  make(map[string]StrategyParameter),
			maxBars: 500,
		},
		stdDevMult: decimal.NewFromFloat(2.0),
	}
}

func (s *VWAPReversionStrategy) Name() string { return "vwap_reversion" }
func (s *VWAPReversionStrategy) Description() string {
	return "Trades reversion to VWAP"
}

func (s *VWAPReversionStrategy) Initialize(ctx context.Context) error {
	s.bars = make([]types.OHLCV, 0, s.maxBars)
	s.cumVolPrice = decimal.Zero
	s.cumVolume = decimal.Zero
	s.dayBars = make([]types.OHLCV, 0)
	return nil
}

func (s *VWAPReversionStrategy) OnBar(bar types.OHLCV) (*Signal, error) {
	s.AddBar(bar)
	
	// Calculate typical price
	typical := bar.High.Add(bar.Low).Add(bar.Close).Div(decimal.NewFromInt(3))
	
	// Update cumulative values
	s.cumVolPrice = s.cumVolPrice.Add(typical.Mul(bar.Volume))
	s.cumVolume = s.cumVolume.Add(bar.Volume)
	
	if s.cumVolume.IsZero() {
		return nil, nil
	}
	
	s.vwap = s.cumVolPrice.Div(s.cumVolume)
	s.dayBars = append(s.dayBars, bar)
	
	if len(s.dayBars) < 10 {
		return nil, nil
	}
	
	// Calculate VWAP standard deviation
	variance := decimal.Zero
	for _, b := range s.dayBars {
		typPrice := b.High.Add(b.Low).Add(b.Close).Div(decimal.NewFromInt(3))
		diff := typPrice.Sub(s.vwap)
		variance = variance.Add(diff.Mul(diff))
	}
	variance = variance.Div(decimal.NewFromInt(int64(len(s.dayBars))))
	stdDev := sqrtDecimal(variance)
	
	current := bar.Close
	upperBand := s.vwap.Add(stdDev.Mul(s.stdDevMult))
	lowerBand := s.vwap.Sub(stdDev.Mul(s.stdDevMult))
	
	if current.LessThan(lowerBand) {
		return &Signal{
			Symbol:      bar.Symbol,
			Side:        types.OrderSideBuy,
			Strength:    decimal.NewFromFloat(0.7),
			StopLoss:    current.Mul(decimal.NewFromFloat(0.97)),
			TakeProfit:  s.vwap,
			Reason:      "Price below VWAP lower band",
			Metadata:    map[string]interface{}{"vwap": s.vwap},
			GeneratedAt: time.Now(),
		}, nil
	} else if current.GreaterThan(upperBand) {
		return &Signal{
			Symbol:      bar.Symbol,
			Side:        types.OrderSideSell,
			Strength:    decimal.NewFromFloat(0.7),
			StopLoss:    current.Mul(decimal.NewFromFloat(1.03)),
			TakeProfit:  s.vwap,
			Reason:      "Price above VWAP upper band",
			Metadata:    map[string]interface{}{"vwap": s.vwap},
			GeneratedAt: time.Now(),
		}, nil
	}
	
	return nil, nil
}

func (s *VWAPReversionStrategy) OnTick(tick TickData) (*Signal, error) {
	return nil, nil
}

// GridStrategy implements grid trading.
type GridStrategy struct {
	BaseStrategy
	gridSize    decimal.Decimal
	gridLevels  int
	basePrice   decimal.Decimal
	buyLevels   []decimal.Decimal
	sellLevels  []decimal.Decimal
}

// NewGridStrategy creates a new grid strategy.
func NewGridStrategy(logger *zap.Logger) *GridStrategy {
	return &GridStrategy{
		BaseStrategy: BaseStrategy{
			logger:  logger,
			params:  make(map[string]StrategyParameter),
			maxBars: 100,
		},
		gridSize:   decimal.NewFromFloat(0.01),
		gridLevels: 5,
	}
}

func (s *GridStrategy) Name() string { return "grid" }
func (s *GridStrategy) Description() string {
	return "Grid trading with multiple buy/sell levels"
}

func (s *GridStrategy) Initialize(ctx context.Context) error {
	s.bars = make([]types.OHLCV, 0, s.maxBars)
	return nil
}

func (s *GridStrategy) OnBar(bar types.OHLCV) (*Signal, error) {
	s.AddBar(bar)
	
	if s.basePrice.IsZero() {
		s.basePrice = bar.Close
		s.setupGridLevels()
	}
	
	current := bar.Close
	
	// Check if price hit a grid level
	for _, level := range s.buyLevels {
		if current.LessThanOrEqual(level) && s.bars[len(s.bars)-2].Close.GreaterThan(level) {
			return &Signal{
				Symbol:      bar.Symbol,
				Side:        types.OrderSideBuy,
				Strength:    decimal.NewFromFloat(0.6),
				StopLoss:    level.Mul(decimal.NewFromFloat(0.95)),
				TakeProfit:  s.basePrice,
				Reason:      "Grid buy level triggered",
				Metadata:    map[string]interface{}{"grid_level": level},
				GeneratedAt: time.Now(),
			}, nil
		}
	}
	
	for _, level := range s.sellLevels {
		if current.GreaterThanOrEqual(level) && s.bars[len(s.bars)-2].Close.LessThan(level) {
			return &Signal{
				Symbol:      bar.Symbol,
				Side:        types.OrderSideSell,
				Strength:    decimal.NewFromFloat(0.6),
				StopLoss:    level.Mul(decimal.NewFromFloat(1.05)),
				TakeProfit:  s.basePrice,
				Reason:      "Grid sell level triggered",
				Metadata:    map[string]interface{}{"grid_level": level},
				GeneratedAt: time.Now(),
			}, nil
		}
	}
	
	return nil, nil
}

func (s *GridStrategy) setupGridLevels() {
	s.buyLevels = make([]decimal.Decimal, s.gridLevels)
	s.sellLevels = make([]decimal.Decimal, s.gridLevels)
	
	for i := 0; i < s.gridLevels; i++ {
		offset := s.gridSize.Mul(decimal.NewFromInt(int64(i + 1)))
		s.buyLevels[i] = s.basePrice.Sub(s.basePrice.Mul(offset))
		s.sellLevels[i] = s.basePrice.Add(s.basePrice.Mul(offset))
	}
}

func (s *GridStrategy) OnTick(tick TickData) (*Signal, error) {
	return nil, nil
}

// DCAStrategy implements Dollar Cost Averaging.
type DCAStrategy struct {
	BaseStrategy
	interval      int
	dropThreshold decimal.Decimal
	barCount      int
	lastBuyBar    int
}

// NewDCAStrategy creates a new DCA strategy.
func NewDCAStrategy(logger *zap.Logger) *DCAStrategy {
	return &DCAStrategy{
		BaseStrategy: BaseStrategy{
			logger:  logger,
			params:  make(map[string]StrategyParameter),
			maxBars: 200,
		},
		interval:      24, // Buy every 24 bars
		dropThreshold: decimal.NewFromFloat(0.05), // Extra buy on 5% drop
	}
}

func (s *DCAStrategy) Name() string { return "dca" }
func (s *DCAStrategy) Description() string {
	return "Dollar Cost Averaging with optional dip buying"
}

func (s *DCAStrategy) Initialize(ctx context.Context) error {
	s.bars = make([]types.OHLCV, 0, s.maxBars)
	s.barCount = 0
	s.lastBuyBar = 0
	return nil
}

func (s *DCAStrategy) OnBar(bar types.OHLCV) (*Signal, error) {
	s.AddBar(bar)
	s.barCount++
	
	// Regular DCA buy
	if s.barCount-s.lastBuyBar >= s.interval {
		s.lastBuyBar = s.barCount
		return &Signal{
			Symbol:      bar.Symbol,
			Side:        types.OrderSideBuy,
			Strength:    decimal.NewFromFloat(0.5),
			Reason:      "Scheduled DCA buy",
			GeneratedAt: time.Now(),
		}, nil
	}
	
	// Extra buy on significant drop
	if len(s.bars) > 1 {
		prevClose := s.bars[len(s.bars)-2].Close
		drop := prevClose.Sub(bar.Close).Div(prevClose)
		
		if drop.GreaterThan(s.dropThreshold) {
			s.lastBuyBar = s.barCount
			return &Signal{
				Symbol:      bar.Symbol,
				Side:        types.OrderSideBuy,
				Strength:    decimal.NewFromFloat(0.7),
				Reason:      "DCA dip buy opportunity",
				Metadata:    map[string]interface{}{"drop_pct": drop.Mul(decimal.NewFromInt(100))},
				GeneratedAt: time.Now(),
			}, nil
		}
	}
	
	return nil, nil
}

func (s *DCAStrategy) OnTick(tick TickData) (*Signal, error) {
	return nil, nil
}

// Helper: sqrt using Newton's method
func sqrtDecimal(d decimal.Decimal) decimal.Decimal {
	if d.IsZero() || d.IsNegative() {
		return decimal.Zero
	}
	
	// Newton's method
	x := d
	for i := 0; i < 20; i++ {
		x = x.Add(d.Div(x)).Div(decimal.NewFromInt(2))
	}
	return x
}
