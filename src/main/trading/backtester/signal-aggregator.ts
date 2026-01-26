/**
 * Atlas Autonomous Trading - Signal Aggregator
 * 
 * Multi-source signal ingestion and aggregation:
 * - Perplexity AI research
 * - Technical indicators
 * - Social sentiment
 * - On-chain analysis
 * - External signal providers
 */

import { EventEmitter } from 'events';
import Decimal from 'decimal.js';
import { createModuleLogger } from '../../utils/logger';
import {
  Signal,
  SignalSource,
  SignalType,
  SignalSide,
  SignalTimeframe,
  TechnicalIndicator,
} from './types';

const logger = createModuleLogger('SignalAggregator');

// ============================================================================
// Technical Analysis Module
// ============================================================================

interface OHLCV {
  timestamp: number;
  open: Decimal;
  high: Decimal;
  low: Decimal;
  close: Decimal;
  volume: Decimal;
}

interface IndicatorResult {
  name: string;
  value: Decimal;
  signal: SignalSide | 'neutral';
  strength: Decimal;
}

class TechnicalAnalyzer {
  /**
   * Calculate Simple Moving Average
   */
  static sma(data: Decimal[], period: number): Decimal {
    if (data.length < period) {
      throw new Error(`Insufficient data for SMA(${period})`);
    }
    const slice = data.slice(-period);
    const sum = slice.reduce((acc, val) => acc.plus(val), new Decimal(0));
    return sum.div(period);
  }

  /**
   * Calculate Exponential Moving Average
   */
  static ema(data: Decimal[], period: number): Decimal {
    if (data.length < period) {
      throw new Error(`Insufficient data for EMA(${period})`);
    }
    
    const multiplier = new Decimal(2).div(period + 1);
    let ema = this.sma(data.slice(0, period), period);
    
    for (let i = period; i < data.length; i++) {
      ema = data[i].times(multiplier).plus(ema.times(new Decimal(1).minus(multiplier)));
    }
    
    return ema;
  }

  /**
   * Calculate RSI (Relative Strength Index)
   */
  static rsi(closes: Decimal[], period: number = 14): Decimal {
    if (closes.length < period + 1) {
      throw new Error(`Insufficient data for RSI(${period})`);
    }

    const changes: Decimal[] = [];
    for (let i = 1; i < closes.length; i++) {
      changes.push(closes[i].minus(closes[i - 1]));
    }

    const recentChanges = changes.slice(-period);
    let avgGain = new Decimal(0);
    let avgLoss = new Decimal(0);

    for (const change of recentChanges) {
      if (change.greaterThan(0)) {
        avgGain = avgGain.plus(change);
      } else {
        avgLoss = avgLoss.plus(change.abs());
      }
    }

    avgGain = avgGain.div(period);
    avgLoss = avgLoss.div(period);

    if (avgLoss.isZero()) {
      return new Decimal(100);
    }

    const rs = avgGain.div(avgLoss);
    return new Decimal(100).minus(new Decimal(100).div(new Decimal(1).plus(rs)));
  }

  /**
   * Calculate MACD
   */
  static macd(
    closes: Decimal[],
    fastPeriod: number = 12,
    slowPeriod: number = 26,
    signalPeriod: number = 9
  ): { macd: Decimal; signal: Decimal; histogram: Decimal } {
    const fastEma = this.ema(closes, fastPeriod);
    const slowEma = this.ema(closes, slowPeriod);
    const macdLine = fastEma.minus(slowEma);
    
    // Calculate signal line (EMA of MACD)
    // Simplified - in practice you'd need the full MACD history
    const signalLine = macdLine.times(new Decimal(2).div(signalPeriod + 1));
    const histogram = macdLine.minus(signalLine);
    
    return {
      macd: macdLine,
      signal: signalLine,
      histogram,
    };
  }

  /**
   * Calculate Bollinger Bands
   */
  static bollingerBands(
    closes: Decimal[],
    period: number = 20,
    stdDev: number = 2
  ): { upper: Decimal; middle: Decimal; lower: Decimal; bandwidth: Decimal } {
    const middle = this.sma(closes, period);
    
    // Calculate standard deviation
    const slice = closes.slice(-period);
    const variance = slice.reduce((acc, val) => {
      const diff = val.minus(middle);
      return acc.plus(diff.times(diff));
    }, new Decimal(0)).div(period);
    
    const std = variance.sqrt();
    const deviation = std.times(stdDev);
    
    const upper = middle.plus(deviation);
    const lower = middle.minus(deviation);
    const bandwidth = upper.minus(lower).div(middle).times(100);
    
    return { upper, middle, lower, bandwidth };
  }

  /**
   * Calculate Average True Range (ATR)
   */
  static atr(candles: OHLCV[], period: number = 14): Decimal {
    if (candles.length < period + 1) {
      throw new Error(`Insufficient data for ATR(${period})`);
    }

    const trueRanges: Decimal[] = [];
    for (let i = 1; i < candles.length; i++) {
      const high = candles[i].high;
      const low = candles[i].low;
      const prevClose = candles[i - 1].close;
      
      const tr = Decimal.max(
        high.minus(low),
        high.minus(prevClose).abs(),
        low.minus(prevClose).abs()
      );
      trueRanges.push(tr);
    }

    return this.sma(trueRanges, period);
  }

  /**
   * Calculate Volume Weighted Average Price (VWAP)
   */
  static vwap(candles: OHLCV[]): Decimal {
    let cumulativeTPV = new Decimal(0);
    let cumulativeVolume = new Decimal(0);

    for (const candle of candles) {
      const typicalPrice = candle.high.plus(candle.low).plus(candle.close).div(3);
      cumulativeTPV = cumulativeTPV.plus(typicalPrice.times(candle.volume));
      cumulativeVolume = cumulativeVolume.plus(candle.volume);
    }

    return cumulativeVolume.isZero() 
      ? new Decimal(0) 
      : cumulativeTPV.div(cumulativeVolume);
  }

  /**
   * Analyze all indicators and generate signals
   */
  static analyze(candles: OHLCV[]): IndicatorResult[] {
    const closes = candles.map(c => c.close);
    const results: IndicatorResult[] = [];

    try {
      // RSI
      const rsi = this.rsi(closes);
      results.push({
        name: 'RSI',
        value: rsi,
        signal: rsi.lessThan(30) ? 'long' : rsi.greaterThan(70) ? 'short' : 'neutral',
        strength: rsi.lessThan(20) || rsi.greaterThan(80) 
          ? new Decimal(0.9)
          : rsi.lessThan(30) || rsi.greaterThan(70)
            ? new Decimal(0.7)
            : new Decimal(0.3),
      });

      // MACD
      const macd = this.macd(closes);
      results.push({
        name: 'MACD',
        value: macd.histogram,
        signal: macd.histogram.greaterThan(0) ? 'long' : 'short',
        strength: macd.histogram.abs().div(closes[closes.length - 1]).times(100),
      });

      // Bollinger Bands
      const bb = this.bollingerBands(closes);
      const lastClose = closes[closes.length - 1];
      const bbPosition = lastClose.minus(bb.lower).div(bb.upper.minus(bb.lower));
      results.push({
        name: 'Bollinger',
        value: bbPosition,
        signal: bbPosition.lessThan(0.2) ? 'long' : bbPosition.greaterThan(0.8) ? 'short' : 'neutral',
        strength: bbPosition.lessThan(0.1) || bbPosition.greaterThan(0.9)
          ? new Decimal(0.8)
          : new Decimal(0.5),
      });

      // Moving Average Crossover (50/200)
      if (closes.length >= 200) {
        const sma50 = this.sma(closes, 50);
        const sma200 = this.sma(closes, 200);
        results.push({
          name: 'MA_Cross',
          value: sma50.minus(sma200),
          signal: sma50.greaterThan(sma200) ? 'long' : 'short',
          strength: new Decimal(0.6),
        });
      }

      // VWAP
      const vwap = this.vwap(candles);
      results.push({
        name: 'VWAP',
        value: vwap,
        signal: lastClose.greaterThan(vwap) ? 'long' : 'short',
        strength: lastClose.minus(vwap).abs().div(vwap).times(10),
      });

    } catch (error) {
      logger.warn('Technical analysis error', { error: (error as Error).message });
    }

    return results;
  }
}

// ============================================================================
// Sentiment Analysis Module
// ============================================================================

interface SentimentData {
  source: string;
  text: string;
  sentiment: number; // -1 to 1
  confidence: number;
  timestamp: number;
}

class SentimentAnalyzer {
  // Simple sentiment word lists (in production, use NLP/ML)
  private static bullishWords = [
    'bullish', 'moon', 'pump', 'buy', 'long', 'breakout', 'support', 'accumulate',
    'rally', 'surge', 'gain', 'profit', 'uptrend', 'bullrun', 'ath', 'strong',
  ];

  private static bearishWords = [
    'bearish', 'dump', 'sell', 'short', 'crash', 'resistance', 'distribute',
    'decline', 'drop', 'loss', 'downtrend', 'bearmarket', 'atl', 'weak',
  ];

  /**
   * Simple sentiment scoring
   */
  static scoreSentiment(text: string): number {
    const words = text.toLowerCase().split(/\s+/);
    let score = 0;
    let matches = 0;

    for (const word of words) {
      if (this.bullishWords.includes(word)) {
        score += 1;
        matches++;
      } else if (this.bearishWords.includes(word)) {
        score -= 1;
        matches++;
      }
    }

    if (matches === 0) return 0;
    return score / matches;
  }

  /**
   * Aggregate sentiment from multiple sources
   */
  static aggregateSentiment(data: SentimentData[]): {
    overall: number;
    bullishPercent: number;
    bearishPercent: number;
    neutralPercent: number;
    confidence: number;
  } {
    if (data.length === 0) {
      return {
        overall: 0,
        bullishPercent: 0,
        bearishPercent: 0,
        neutralPercent: 100,
        confidence: 0,
      };
    }

    let bullish = 0;
    let bearish = 0;
    let neutral = 0;
    let totalScore = 0;
    let totalConfidence = 0;

    for (const item of data) {
      if (item.sentiment > 0.1) bullish++;
      else if (item.sentiment < -0.1) bearish++;
      else neutral++;

      totalScore += item.sentiment * item.confidence;
      totalConfidence += item.confidence;
    }

    const total = data.length;
    return {
      overall: totalScore / totalConfidence,
      bullishPercent: (bullish / total) * 100,
      bearishPercent: (bearish / total) * 100,
      neutralPercent: (neutral / total) * 100,
      confidence: totalConfidence / total,
    };
  }
}

// ============================================================================
// Signal Aggregator
// ============================================================================

interface SignalSourceConfig {
  id: string;
  type: SignalSource;
  enabled: boolean;
  weight: number;
  apiKey?: string;
  endpoint?: string;
}

interface AggregatorConfig {
  sources: SignalSourceConfig[];
  minimumConfidence: number;
  minimumSources: number;
  symbols: string[];
  updateIntervalMs: number;
}

const DEFAULT_CONFIG: AggregatorConfig = {
  sources: [
    { id: 'technical', type: 'technical', enabled: true, weight: 0.4 },
    { id: 'sentiment', type: 'sentiment', enabled: true, weight: 0.2 },
    { id: 'perplexity', type: 'perplexity', enabled: true, weight: 0.3 },
    { id: 'custom', type: 'custom', enabled: false, weight: 0.1 },
  ],
  minimumConfidence: 0.5,
  minimumSources: 2,
  symbols: [],
  updateIntervalMs: 60000,
};

export class SignalAggregator extends EventEmitter {
  private config: AggregatorConfig;
  private marketData: Map<string, OHLCV[]> = new Map();
  private signals: Map<string, Signal[]> = new Map();
  private updateInterval: NodeJS.Timeout | null = null;

  constructor(config: Partial<AggregatorConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  start(): void {
    logger.info('Starting signal aggregator');
    
    this.updateInterval = setInterval(() => {
      this.updateSignals().catch(error => {
        logger.error('Signal update failed', { error: (error as Error).message });
      });
    }, this.config.updateIntervalMs);

    // Initial update
    this.updateSignals();
  }

  stop(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    logger.info('Signal aggregator stopped');
  }

  // ===========================================================================
  // Signal Generation
  // ===========================================================================

  async updateSignals(): Promise<void> {
    for (const symbol of this.config.symbols) {
      try {
        const signals = await this.generateSignals(symbol);
        this.signals.set(symbol, signals);
        
        for (const signal of signals) {
          this.emit('signal', signal);
        }
      } catch (error) {
        logger.warn('Failed to generate signals', { 
          symbol, 
          error: (error as Error).message 
        });
      }
    }
  }

  private async generateSignals(symbol: string): Promise<Signal[]> {
    const sourceSignals: { source: SignalSource; signal: SignalSide | 'neutral'; confidence: Decimal }[] = [];

    // Technical Analysis
    const technicalSource = this.config.sources.find(s => s.type === 'technical');
    if (technicalSource?.enabled) {
      const candles = this.marketData.get(symbol);
      if (candles && candles.length > 0) {
        const indicators = TechnicalAnalyzer.analyze(candles);
        
        // Aggregate indicator signals
        let longVotes = 0;
        let shortVotes = 0;
        let totalStrength = new Decimal(0);
        
        for (const indicator of indicators) {
          if (indicator.signal === 'long') longVotes++;
          else if (indicator.signal === 'short') shortVotes++;
          totalStrength = totalStrength.plus(indicator.strength);
        }
        
        const avgStrength = totalStrength.div(indicators.length);
        sourceSignals.push({
          source: 'technical',
          signal: longVotes > shortVotes ? 'long' : shortVotes > longVotes ? 'short' : 'neutral',
          confidence: avgStrength,
        });
      }
    }

    // Perplexity Research
    const perplexitySource = this.config.sources.find(s => s.type === 'perplexity');
    if (perplexitySource?.enabled && perplexitySource.apiKey) {
      try {
        const research = await this.runPerplexityResearch(symbol, perplexitySource.apiKey);
        if (research) {
          sourceSignals.push(research);
        }
      } catch (error) {
        logger.warn('Perplexity research failed', { error: (error as Error).message });
      }
    }

    // Sentiment Analysis
    const sentimentSource = this.config.sources.find(s => s.type === 'sentiment');
    if (sentimentSource?.enabled) {
      try {
        const sentiment = await this.runSentimentAnalysis(symbol);
        if (sentiment) {
          sourceSignals.push(sentiment);
        }
      } catch (error) {
        logger.warn('Sentiment analysis failed', { error: (error as Error).message });
      }
    }

    // Aggregate signals
    if (sourceSignals.length < this.config.minimumSources) {
      return [];
    }

    return this.aggregateSourceSignals(symbol, sourceSignals);
  }

  private aggregateSourceSignals(
    symbol: string, 
    sources: { source: SignalSource; signal: SignalSide | 'neutral'; confidence: Decimal }[]
  ): Signal[] {
    // Calculate weighted consensus
    let longWeight = new Decimal(0);
    let shortWeight = new Decimal(0);
    let totalWeight = new Decimal(0);
    const usedSources: SignalSource[] = [];

    for (const item of sources) {
      const sourceConfig = this.config.sources.find(s => s.type === item.source);
      const weight = new Decimal(sourceConfig?.weight || 0.25);
      
      if (item.signal === 'long') {
        longWeight = longWeight.plus(weight.times(item.confidence));
      } else if (item.signal === 'short') {
        shortWeight = shortWeight.plus(weight.times(item.confidence));
      }
      
      totalWeight = totalWeight.plus(weight);
      usedSources.push(item.source);
    }

    const normalizedLong = longWeight.div(totalWeight);
    const normalizedShort = shortWeight.div(totalWeight);
    
    // Only generate signal if there's clear consensus
    const consensus = normalizedLong.minus(normalizedShort).abs();
    if (consensus.lessThan(this.config.minimumConfidence)) {
      return [];
    }

    const side: SignalSide = normalizedLong.greaterThan(normalizedShort) ? 'long' : 'short';
    const candles = this.marketData.get(symbol) || [];
    const currentPrice = candles.length > 0 
      ? candles[candles.length - 1].close 
      : new Decimal(0);

    // Calculate suggested stops based on ATR
    let stopLoss: Decimal | undefined;
    let takeProfit: Decimal | undefined;
    
    if (candles.length >= 15) {
      try {
        const atr = TechnicalAnalyzer.atr(candles);
        if (side === 'long') {
          stopLoss = currentPrice.minus(atr.times(2));
          takeProfit = currentPrice.plus(atr.times(3));
        } else {
          stopLoss = currentPrice.plus(atr.times(2));
          takeProfit = currentPrice.minus(atr.times(3));
        }
      } catch { /* ignore */ }
    }

    const signal: Signal = {
      id: `sig_${symbol}_${Date.now()}`,
      symbol,
      side,
      type: 'entry',
      source: usedSources[0], // Primary source
      strength: consensus.times(100).toNumber(), // Convert to 0-100
      confidence: consensus,
      timestamp: Date.now(),
      expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
      currentPrice,
      suggestedStopLoss: stopLoss,
      suggestedTakeProfit: takeProfit,
      timeframe: '1h',
      indicators: [],
      metadata: {
        longWeight: normalizedLong.toString(),
        shortWeight: normalizedShort.toString(),
        sources: usedSources,
      },
    };

    return [signal];
  }

  // ===========================================================================
  // Research Integrations
  // ===========================================================================

  private async runPerplexityResearch(
    symbol: string, 
    apiKey: string
  ): Promise<{ source: SignalSource; signal: SignalSide | 'neutral'; confidence: Decimal } | null> {
    try {
      const response = await fetch('https://api.perplexity.ai/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'llama-3.1-sonar-large-128k-online',
          messages: [
            {
              role: 'system',
              content: `You are a crypto market analyst. Analyze the current market conditions for ${symbol}. 
                       Respond with JSON only: { "sentiment": "bullish"|"bearish"|"neutral", "confidence": 0-1, "reasons": [] }`,
            },
            {
              role: 'user',
              content: `What is the current market outlook for ${symbol}? Consider recent news, on-chain metrics, and technical setup.`,
            },
          ],
          max_tokens: 500,
        }),
      });

      if (!response.ok) {
        throw new Error(`Perplexity API error: ${response.status}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      
      if (!content) return null;

      // Parse JSON response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;

      const analysis = JSON.parse(jsonMatch[0]);
      
      return {
        source: 'perplexity',
        signal: analysis.sentiment === 'bullish' ? 'long' 
              : analysis.sentiment === 'bearish' ? 'short' 
              : 'neutral',
        confidence: new Decimal(analysis.confidence || 0.5),
      };

    } catch (error) {
      logger.warn('Perplexity research failed', { symbol, error: (error as Error).message });
      return null;
    }
  }

  private async runSentimentAnalysis(
    symbol: string
  ): Promise<{ source: SignalSource; signal: SignalSide | 'neutral'; confidence: Decimal } | null> {
    // In production, this would fetch data from Twitter/Discord/Reddit APIs
    // For now, return null (no data)
    return null;
  }

  // ===========================================================================
  // Market Data Management
  // ===========================================================================

  updateMarketData(symbol: string, candles: OHLCV[]): void {
    this.marketData.set(symbol, candles);
  }

  addCandle(symbol: string, candle: OHLCV): void {
    const existing = this.marketData.get(symbol) || [];
    existing.push(candle);
    
    // Keep last 500 candles
    if (existing.length > 500) {
      existing.shift();
    }
    
    this.marketData.set(symbol, existing);
  }

  // ===========================================================================
  // Signal Access
  // ===========================================================================

  getSignals(symbol?: string): Signal[] {
    if (symbol) {
      return this.signals.get(symbol) || [];
    }
    
    const allSignals: Signal[] = [];
    for (const signals of this.signals.values()) {
      allSignals.push(...signals);
    }
    return allSignals;
  }

  getActiveSignals(): Signal[] {
    const now = Date.now();
    return this.getSignals().filter(s => !s.expiresAt || s.expiresAt > now);
  }

  addExternalSignal(signal: Signal): void {
    const existing = this.signals.get(signal.symbol) || [];
    existing.push(signal);
    this.signals.set(signal.symbol, existing);
    this.emit('signal', signal);
  }

  // ===========================================================================
  // Configuration
  // ===========================================================================

  addSymbol(symbol: string): void {
    if (!this.config.symbols.includes(symbol)) {
      this.config.symbols.push(symbol);
    }
  }

  removeSymbol(symbol: string): void {
    this.config.symbols = this.config.symbols.filter(s => s !== symbol);
    this.signals.delete(symbol);
    this.marketData.delete(symbol);
  }

  setSourceEnabled(sourceId: string, enabled: boolean): void {
    const source = this.config.sources.find(s => s.id === sourceId);
    if (source) {
      source.enabled = enabled;
    }
  }

  setSourceApiKey(sourceId: string, apiKey: string): void {
    const source = this.config.sources.find(s => s.id === sourceId);
    if (source) {
      source.apiKey = apiKey;
    }
  }
}

// Singleton
let signalAggregator: SignalAggregator | null = null;

export function getSignalAggregator(): SignalAggregator {
  if (!signalAggregator) {
    signalAggregator = new SignalAggregator();
  }
  return signalAggregator;
}

export function createSignalAggregator(config: Partial<AggregatorConfig>): SignalAggregator {
  signalAggregator = new SignalAggregator(config);
  return signalAggregator;
}

// Export analyzer for direct use
export { TechnicalAnalyzer, SentimentAnalyzer };
export type { OHLCV, IndicatorResult, SentimentData };
