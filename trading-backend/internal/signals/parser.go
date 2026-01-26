// Package signals provides signal parsing and interpretation.
package signals

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/atlas-desktop/trading-backend/pkg/types"
	"github.com/shopspring/decimal"
	"go.uber.org/zap"
)

// SignalParser parses signals from various formats.
type SignalParser struct {
	logger *zap.Logger
}

// NewSignalParser creates a new signal parser.
func NewSignalParser(logger *zap.Logger) *SignalParser {
	return &SignalParser{
		logger: logger.Named("signal-parser"),
	}
}

// ParseJSON parses a signal from JSON format.
func (p *SignalParser) ParseJSON(data []byte) (*types.Signal, error) {
	var signal types.Signal
	if err := json.Unmarshal(data, &signal); err != nil {
		return nil, fmt.Errorf("failed to parse JSON signal: %w", err)
	}
	
	// Validate required fields
	if signal.Symbol == "" {
		return nil, fmt.Errorf("signal missing symbol")
	}
	
	// Set defaults
	if signal.ID == "" {
		signal.ID = fmt.Sprintf("parsed-%d", time.Now().UnixNano())
	}
	if signal.Timestamp.IsZero() {
		signal.Timestamp = time.Now()
	}
	if signal.Strength.IsZero() {
		signal.Strength = decimal.NewFromFloat(0.5)
	}
	if signal.Confidence.IsZero() {
		signal.Confidence = decimal.NewFromFloat(0.5)
	}
	
	return &signal, nil
}

// ParseTradingViewAlert parses a TradingView alert webhook.
func (p *SignalParser) ParseTradingViewAlert(data []byte) (*types.Signal, error) {
	// TradingView alerts can be in various formats
	// Try JSON first
	var tvAlert struct {
		Ticker     string  `json:"ticker"`
		Action     string  `json:"action"`
		Price      float64 `json:"price"`
		Volume     float64 `json:"volume"`
		Time       string  `json:"time"`
		Exchange   string  `json:"exchange"`
		Interval   string  `json:"interval"`
		Strategy   string  `json:"strategy"`
		PositionSize float64 `json:"position_size"`
		StopLoss   float64 `json:"stop_loss"`
		TakeProfit float64 `json:"take_profit"`
		Comment    string  `json:"comment"`
	}
	
	if err := json.Unmarshal(data, &tvAlert); err == nil && tvAlert.Ticker != "" {
		direction := p.parseDirection(tvAlert.Action)
		
		signal := &types.Signal{
			ID:         fmt.Sprintf("tv-%s-%d", tvAlert.Ticker, time.Now().UnixNano()),
			Symbol:     p.normalizeSymbol(tvAlert.Ticker),
			Direction:  direction,
			Price:      decimal.NewFromFloat(tvAlert.Price),
			Strength:   decimal.NewFromFloat(0.7),
			Confidence: decimal.NewFromFloat(0.75),
			Source:     "tradingview",
			Timestamp:  time.Now(),
			StopLoss:   decimal.NewFromFloat(tvAlert.StopLoss),
			TakeProfit: decimal.NewFromFloat(tvAlert.TakeProfit),
			Metadata: map[string]interface{}{
				"exchange": tvAlert.Exchange,
				"interval": tvAlert.Interval,
				"strategy": tvAlert.Strategy,
				"comment":  tvAlert.Comment,
			},
		}
		
		return signal, nil
	}
	
	// Try plain text format
	return p.ParsePlainText(string(data))
}

// ParsePlainText parses a signal from plain text.
func (p *SignalParser) ParsePlainText(text string) (*types.Signal, error) {
	text = strings.ToUpper(strings.TrimSpace(text))
	
	// Extract symbol
	symbolRegex := regexp.MustCompile(`([A-Z]{2,10})/?([A-Z]{3,4})`)
	symbolMatch := symbolRegex.FindStringSubmatch(text)
	if len(symbolMatch) < 2 {
		return nil, fmt.Errorf("could not extract symbol from text")
	}
	
	symbol := symbolMatch[1]
	if len(symbolMatch) > 2 && symbolMatch[2] != "" {
		symbol = symbolMatch[1] + "/" + symbolMatch[2]
	}
	
	// Extract direction
	direction := types.SignalHold
	if strings.Contains(text, "BUY") || strings.Contains(text, "LONG") {
		direction = types.SignalBuy
	} else if strings.Contains(text, "SELL") || strings.Contains(text, "SHORT") {
		direction = types.SignalSell
	}
	
	// Extract price
	priceRegex := regexp.MustCompile(`(?:PRICE|@|AT)\s*[:=]?\s*\$?(\d+\.?\d*)`)
	priceMatch := priceRegex.FindStringSubmatch(text)
	var price decimal.Decimal
	if len(priceMatch) > 1 {
		price, _ = decimal.NewFromString(priceMatch[1])
	}
	
	// Extract stop loss
	slRegex := regexp.MustCompile(`(?:SL|STOP|STOPLOSS)\s*[:=]?\s*\$?(\d+\.?\d*)`)
	slMatch := slRegex.FindStringSubmatch(text)
	var stopLoss decimal.Decimal
	if len(slMatch) > 1 {
		stopLoss, _ = decimal.NewFromString(slMatch[1])
	}
	
	// Extract take profit
	tpRegex := regexp.MustCompile(`(?:TP|TARGET|TAKEPROFIT)\s*[:=]?\s*\$?(\d+\.?\d*)`)
	tpMatch := tpRegex.FindStringSubmatch(text)
	var takeProfit decimal.Decimal
	if len(tpMatch) > 1 {
		takeProfit, _ = decimal.NewFromString(tpMatch[1])
	}
	
	signal := &types.Signal{
		ID:         fmt.Sprintf("text-%d", time.Now().UnixNano()),
		Symbol:     symbol,
		Direction:  direction,
		Price:      price,
		Strength:   decimal.NewFromFloat(0.6),
		Confidence: decimal.NewFromFloat(0.6),
		Source:     "text",
		Timestamp:  time.Now(),
		StopLoss:   stopLoss,
		TakeProfit: takeProfit,
		Metadata: map[string]interface{}{
			"rawText": text,
		},
	}
	
	return signal, nil
}

// Parse3CommasSignal parses a 3Commas webhook signal.
func (p *SignalParser) Parse3CommasSignal(data []byte) (*types.Signal, error) {
	var commasSignal struct {
		MessageType string `json:"message_type"`
		BotID       int    `json:"bot_id"`
		Pair        string `json:"pair"`
		Action      string `json:"action"`
		OrderType   string `json:"order_type"`
		Price       string `json:"price"`
		Volume      string `json:"volume"`
		StopLoss    string `json:"stop_loss_percentage"`
		TakeProfit  string `json:"take_profit_percentage"`
	}
	
	if err := json.Unmarshal(data, &commasSignal); err != nil {
		return nil, fmt.Errorf("failed to parse 3Commas signal: %w", err)
	}
	
	price, _ := decimal.NewFromString(commasSignal.Price)
	
	// Parse percentage-based SL/TP
	slPct, _ := strconv.ParseFloat(commasSignal.StopLoss, 64)
	tpPct, _ := strconv.ParseFloat(commasSignal.TakeProfit, 64)
	
	var stopLoss, takeProfit decimal.Decimal
	if !price.IsZero() {
		if slPct > 0 {
			stopLoss = price.Mul(decimal.NewFromFloat(1 - slPct/100))
		}
		if tpPct > 0 {
			takeProfit = price.Mul(decimal.NewFromFloat(1 + tpPct/100))
		}
	}
	
	direction := p.parseDirection(commasSignal.Action)
	
	signal := &types.Signal{
		ID:         fmt.Sprintf("3commas-%d-%d", commasSignal.BotID, time.Now().UnixNano()),
		Symbol:     p.normalizeSymbol(commasSignal.Pair),
		Direction:  direction,
		Price:      price,
		Strength:   decimal.NewFromFloat(0.75),
		Confidence: decimal.NewFromFloat(0.8),
		Source:     "3commas",
		Timestamp:  time.Now(),
		StopLoss:   stopLoss,
		TakeProfit: takeProfit,
		Metadata: map[string]interface{}{
			"botId":     commasSignal.BotID,
			"orderType": commasSignal.OrderType,
		},
	}
	
	return signal, nil
}

// ParseCornixSignal parses a Cornix signal format.
func (p *SignalParser) ParseCornixSignal(data []byte) (*types.Signal, error) {
	text := string(data)
	
	// Cornix format example:
	// 📊 BTCUSDT
	// Exchanges: Binance Futures
	// Signal Type: Regular (Long)
	// Leverage: Cross (10X)
	// Entry Zone: 42000 - 42500
	// Take Profit Targets:
	// 1) 43000
	// 2) 44000
	// 3) 45000
	// Stop: 40000
	
	// Extract symbol
	symbolRegex := regexp.MustCompile(`📊\s*([A-Z]+)`)
	symbolMatch := symbolRegex.FindStringSubmatch(text)
	if len(symbolMatch) < 2 {
		return nil, fmt.Errorf("could not extract symbol from Cornix signal")
	}
	symbol := p.normalizeSymbol(symbolMatch[1])
	
	// Extract direction
	direction := types.SignalHold
	if strings.Contains(strings.ToLower(text), "long") {
		direction = types.SignalBuy
	} else if strings.Contains(strings.ToLower(text), "short") {
		direction = types.SignalSell
	}
	
	// Extract entry zone
	entryRegex := regexp.MustCompile(`Entry\s*(?:Zone)?[:=]?\s*(\d+\.?\d*)\s*[-–]\s*(\d+\.?\d*)`)
	entryMatch := entryRegex.FindStringSubmatch(text)
	var entryLow, entryHigh decimal.Decimal
	if len(entryMatch) > 2 {
		entryLow, _ = decimal.NewFromString(entryMatch[1])
		entryHigh, _ = decimal.NewFromString(entryMatch[2])
	}
	
	// Use midpoint of entry zone
	price := entryLow.Add(entryHigh).Div(decimal.NewFromInt(2))
	
	// Extract stop loss
	stopRegex := regexp.MustCompile(`Stop[:=]?\s*(\d+\.?\d*)`)
	stopMatch := stopRegex.FindStringSubmatch(text)
	var stopLoss decimal.Decimal
	if len(stopMatch) > 1 {
		stopLoss, _ = decimal.NewFromString(stopMatch[1])
	}
	
	// Extract take profit targets
	tpRegex := regexp.MustCompile(`\d\)\s*(\d+\.?\d*)`)
	tpMatches := tpRegex.FindAllStringSubmatch(text, -1)
	var targets []decimal.Decimal
	for _, match := range tpMatches {
		if len(match) > 1 {
			tp, _ := decimal.NewFromString(match[1])
			targets = append(targets, tp)
		}
	}
	
	// Use first target as primary take profit
	var takeProfit decimal.Decimal
	if len(targets) > 0 {
		takeProfit = targets[0]
	}
	
	// Extract leverage
	leverageRegex := regexp.MustCompile(`(\d+)X`)
	leverageMatch := leverageRegex.FindStringSubmatch(text)
	var leverage int
	if len(leverageMatch) > 1 {
		leverage, _ = strconv.Atoi(leverageMatch[1])
	}
	
	signal := &types.Signal{
		ID:         fmt.Sprintf("cornix-%s-%d", symbol, time.Now().UnixNano()),
		Symbol:     symbol,
		Direction:  direction,
		Price:      price,
		Strength:   decimal.NewFromFloat(0.7),
		Confidence: decimal.NewFromFloat(0.7),
		Source:     "cornix",
		Timestamp:  time.Now(),
		StopLoss:   stopLoss,
		TakeProfit: takeProfit,
		Metadata: map[string]interface{}{
			"entryLow":  entryLow,
			"entryHigh": entryHigh,
			"targets":   targets,
			"leverage":  leverage,
		},
	}
	
	return signal, nil
}

// ParseTelegramSignal attempts to parse a Telegram message signal.
func (p *SignalParser) ParseTelegramSignal(text string) (*types.Signal, error) {
	// Common Telegram signal patterns:
	// 🚀 LONG SOL/USDT @ 150
	// 📉 SHORT ETH @ 3500, SL 3600, TP 3200
	// BUY BTC entry 42000-43000, targets 45000/48000, stop 40000
	
	text = strings.TrimSpace(text)
	upperText := strings.ToUpper(text)
	
	// Determine direction from emojis or keywords
	direction := types.SignalHold
	if strings.Contains(text, "🚀") || strings.Contains(text, "📈") ||
		strings.Contains(upperText, "LONG") || strings.Contains(upperText, "BUY") {
		direction = types.SignalBuy
	} else if strings.Contains(text, "📉") || strings.Contains(text, "🔻") ||
		strings.Contains(upperText, "SHORT") || strings.Contains(upperText, "SELL") {
		direction = types.SignalSell
	}
	
	// Extract symbol
	symbolRegex := regexp.MustCompile(`(?:LONG|SHORT|BUY|SELL)?\s*([A-Z]{2,10})/?([A-Z]{3,4})?`)
	symbolMatch := symbolRegex.FindStringSubmatch(upperText)
	if len(symbolMatch) < 2 {
		return nil, fmt.Errorf("could not extract symbol")
	}
	
	symbol := symbolMatch[1]
	if len(symbolMatch) > 2 && symbolMatch[2] != "" {
		symbol = symbol + "/" + symbolMatch[2]
	}
	
	// Extract numbers in order: usually entry, then SL/TP
	numberRegex := regexp.MustCompile(`\d+\.?\d*`)
	numbers := numberRegex.FindAllString(text, -1)
	
	var price, stopLoss, takeProfit decimal.Decimal
	
	if len(numbers) >= 1 {
		price, _ = decimal.NewFromString(numbers[0])
	}
	
	// Try to identify SL and TP from context
	slIdx := strings.Index(upperText, "SL")
	tpIdx := strings.Index(upperText, "TP")
	
	if slIdx >= 0 && len(numbers) >= 2 {
		stopLoss, _ = decimal.NewFromString(numbers[1])
		if tpIdx >= 0 && len(numbers) >= 3 {
			takeProfit, _ = decimal.NewFromString(numbers[2])
		}
	} else if tpIdx >= 0 && len(numbers) >= 2 {
		takeProfit, _ = decimal.NewFromString(numbers[1])
	}
	
	// Calculate strength based on signal completeness
	strength := decimal.NewFromFloat(0.5)
	if !stopLoss.IsZero() && !takeProfit.IsZero() {
		strength = decimal.NewFromFloat(0.8)
	} else if !stopLoss.IsZero() || !takeProfit.IsZero() {
		strength = decimal.NewFromFloat(0.65)
	}
	
	signal := &types.Signal{
		ID:         fmt.Sprintf("telegram-%d", time.Now().UnixNano()),
		Symbol:     symbol,
		Direction:  direction,
		Price:      price,
		Strength:   strength,
		Confidence: decimal.NewFromFloat(0.6), // Lower confidence for parsed signals
		Source:     "telegram",
		Timestamp:  time.Now(),
		StopLoss:   stopLoss,
		TakeProfit: takeProfit,
		Metadata: map[string]interface{}{
			"rawText": text,
		},
	}
	
	return signal, nil
}

// parseDirection converts string action to SignalDirection.
func (p *SignalParser) parseDirection(action string) types.SignalDirection {
	action = strings.ToUpper(strings.TrimSpace(action))
	
	switch action {
	case "BUY", "LONG", "ENTER_LONG", "OPEN_LONG":
		return types.SignalBuy
	case "SELL", "SHORT", "ENTER_SHORT", "OPEN_SHORT":
		return types.SignalSell
	case "CLOSE", "EXIT", "CLOSE_LONG", "CLOSE_SHORT":
		return types.SignalClose
	default:
		return types.SignalHold
	}
}

// normalizeSymbol converts various symbol formats to standard format.
func (p *SignalParser) normalizeSymbol(symbol string) string {
	symbol = strings.ToUpper(strings.TrimSpace(symbol))
	
	// Remove common suffixes/prefixes
	symbol = strings.TrimSuffix(symbol, "PERP")
	symbol = strings.TrimSuffix(symbol, "-PERP")
	symbol = strings.TrimSuffix(symbol, "_PERP")
	
	// Convert underscore to slash
	symbol = strings.Replace(symbol, "_", "/", 1)
	
	// If no separator, try to add one
	if !strings.Contains(symbol, "/") {
		// Common quote currencies
		quotes := []string{"USDT", "USDC", "USD", "BTC", "ETH", "BNB"}
		for _, quote := range quotes {
			if strings.HasSuffix(symbol, quote) {
				base := strings.TrimSuffix(symbol, quote)
				if len(base) >= 2 {
					return base + "/" + quote
				}
			}
		}
	}
	
	return symbol
}

// ValidateSignal validates a signal for trading.
func (p *SignalParser) ValidateSignal(signal *types.Signal) error {
	if signal == nil {
		return fmt.Errorf("signal is nil")
	}
	
	if signal.Symbol == "" {
		return fmt.Errorf("signal missing symbol")
	}
	
	if signal.Direction == types.SignalHold {
		return fmt.Errorf("signal has no actionable direction")
	}
	
	// Validate price relationships
	if !signal.Price.IsZero() && !signal.StopLoss.IsZero() {
		if signal.Direction == types.SignalBuy {
			if signal.StopLoss.GreaterThanOrEqual(signal.Price) {
				return fmt.Errorf("stop loss must be below entry for long")
			}
		} else if signal.Direction == types.SignalSell {
			if signal.StopLoss.LessThanOrEqual(signal.Price) {
				return fmt.Errorf("stop loss must be above entry for short")
			}
		}
	}
	
	if !signal.Price.IsZero() && !signal.TakeProfit.IsZero() {
		if signal.Direction == types.SignalBuy {
			if signal.TakeProfit.LessThanOrEqual(signal.Price) {
				return fmt.Errorf("take profit must be above entry for long")
			}
		} else if signal.Direction == types.SignalSell {
			if signal.TakeProfit.GreaterThanOrEqual(signal.Price) {
				return fmt.Errorf("take profit must be below entry for short")
			}
		}
	}
	
	// Validate strength and confidence
	if signal.Strength.LessThan(decimal.Zero) || signal.Strength.GreaterThan(decimal.NewFromInt(1)) {
		return fmt.Errorf("strength must be between 0 and 1")
	}
	
	if signal.Confidence.LessThan(decimal.Zero) || signal.Confidence.GreaterThan(decimal.NewFromInt(1)) {
		return fmt.Errorf("confidence must be between 0 and 1")
	}
	
	return nil
}

// EnrichSignal adds computed fields to a signal.
func (p *SignalParser) EnrichSignal(signal *types.Signal) {
	// Calculate risk/reward ratio
	if !signal.Price.IsZero() && !signal.StopLoss.IsZero() && !signal.TakeProfit.IsZero() {
		risk := signal.Price.Sub(signal.StopLoss).Abs()
		reward := signal.TakeProfit.Sub(signal.Price).Abs()
		
		if !risk.IsZero() {
			rrRatio := reward.Div(risk)
			if signal.Metadata == nil {
				signal.Metadata = make(map[string]interface{})
			}
			signal.Metadata["riskRewardRatio"] = rrRatio.String()
		}
	}
	
	// Calculate stop loss percentage
	if !signal.Price.IsZero() && !signal.StopLoss.IsZero() {
		slPct := signal.Price.Sub(signal.StopLoss).Abs().Div(signal.Price).Mul(decimal.NewFromInt(100))
		if signal.Metadata == nil {
			signal.Metadata = make(map[string]interface{})
		}
		signal.Metadata["stopLossPercent"] = slPct.String()
	}
	
	// Calculate take profit percentage
	if !signal.Price.IsZero() && !signal.TakeProfit.IsZero() {
		tpPct := signal.TakeProfit.Sub(signal.Price).Abs().Div(signal.Price).Mul(decimal.NewFromInt(100))
		if signal.Metadata == nil {
			signal.Metadata = make(map[string]interface{})
		}
		signal.Metadata["takeProfitPercent"] = tpPct.String()
	}
	
	// Set expiry if not set
	if signal.ExpiresAt.IsZero() {
		// Default 1 hour expiry
		signal.ExpiresAt = signal.Timestamp.Add(time.Hour)
	}
}
