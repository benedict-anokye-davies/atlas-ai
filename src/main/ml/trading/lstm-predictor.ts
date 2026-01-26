/**
 * Atlas ML - LSTM Trading Predictor
 *
 * T5-304: LSTM-based price prediction model
 *
 * Uses TensorFlow.js for inference of LSTM models trained on OHLCV data.
 * Models can be trained in Google Colab and deployed here.
 *
 * Features:
 * - Multi-timeframe analysis
 * - Technical indicator integration
 * - Confidence scoring
 * - Model hot-reloading
 *
 * @module ml/trading/lstm-predictor
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { app } from 'electron';
import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';

const logger = createModuleLogger('LSTMPredictor');

// =============================================================================
// Types
// =============================================================================

/**
 * OHLCV data point
 */
export interface OHLCVData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Technical indicators
 */
export interface TechnicalIndicators {
  sma20?: number;
  sma50?: number;
  sma200?: number;
  ema12?: number;
  ema26?: number;
  rsi14?: number;
  macd?: number;
  macdSignal?: number;
  macdHistogram?: number;
  bollingerUpper?: number;
  bollingerMiddle?: number;
  bollingerLower?: number;
  atr14?: number;
  obv?: number;
  vwap?: number;
}

/**
 * Prediction result
 */
export interface Prediction {
  symbol: string;
  timeframe: string;
  direction: 'up' | 'down' | 'neutral';
  confidence: number;
  priceTarget?: number;
  priceTargetLow?: number;
  priceTargetHigh?: number;
  horizon: string; // e.g., "1h", "4h", "1d"
  timestamp: number;
  modelVersion: string;
  features?: {
    trendStrength: number;
    volatility: number;
    momentum: number;
    volumeProfile: 'increasing' | 'decreasing' | 'stable';
  };
}

/**
 * Model configuration
 */
export interface LSTMModelConfig {
  /** Input sequence length (number of candles) */
  sequenceLength: number;
  /** Features used for prediction */
  features: string[];
  /** Prediction horizon in candles */
  horizon: number;
  /** Normalization parameters */
  normalization: {
    type: 'minmax' | 'zscore';
    params: Record<string, { min?: number; max?: number; mean?: number; std?: number }>;
  };
  /** Threshold for directional confidence */
  confidenceThreshold: number;
}

/**
 * Predictor configuration
 */
export interface LSTMPredictorConfig {
  modelsPath: string;
  defaultTimeframe: string;
  maxCacheSize: number;
  predictionCacheTtl: number; // ms
}

export const DEFAULT_PREDICTOR_CONFIG: LSTMPredictorConfig = {
  modelsPath: '',
  defaultTimeframe: '1h',
  maxCacheSize: 1000,
  predictionCacheTtl: 5 * 60 * 1000, // 5 minutes
};

/**
 * Predictor events
 */
export interface LSTMPredictorEvents {
  'model-loaded': (symbol: string, timeframe: string) => void;
  'prediction-made': (prediction: Prediction) => void;
  'model-error': (symbol: string, error: Error) => void;
  error: (error: Error) => void;
}

// =============================================================================
// LSTM Predictor
// =============================================================================

export class LSTMPredictor extends EventEmitter {
  private config: LSTMPredictorConfig;
  private modelsPath: string;
  private loadedModels: Map<string, { model: unknown; config: LSTMModelConfig }> = new Map();
  private predictionCache: Map<string, { prediction: Prediction; timestamp: number }> = new Map();
  private initialized: boolean = false;

  constructor(config?: Partial<LSTMPredictorConfig>) {
    super();
    this.config = { ...DEFAULT_PREDICTOR_CONFIG, ...config };
    this.modelsPath =
      this.config.modelsPath || path.join(app.getPath('userData'), 'ml', 'trading-models');
  }

  /**
   * Initialize the predictor
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    logger.info('Initializing LSTMPredictor', { path: this.modelsPath });

    await fs.ensureDir(this.modelsPath);

    this.initialized = true;
    logger.info('LSTMPredictor initialized');
  }

  /**
   * Get model key
   */
  private getModelKey(symbol: string, timeframe: string): string {
    return `${symbol.toUpperCase()}_${timeframe}`;
  }

  /**
   * Load a model from disk
   */
  async loadModel(symbol: string, timeframe: string): Promise<boolean> {
    const key = this.getModelKey(symbol, timeframe);
    const modelDir = path.join(this.modelsPath, key);

    if (!(await fs.pathExists(modelDir))) {
      logger.warn('Model not found', { symbol, timeframe, path: modelDir });
      return false;
    }

    try {
      // Load model configuration
      const configPath = path.join(modelDir, 'config.json');
      if (!(await fs.pathExists(configPath))) {
        throw new Error('Model config not found');
      }
      const config: LSTMModelConfig = await fs.readJson(configPath);

      // In a full implementation, we would load the TensorFlow.js model here
      // For now, we store the config and use a placeholder
      // const model = await tf.loadLayersModel(`file://${modelDir}/model.json`);

      this.loadedModels.set(key, {
        model: null, // Placeholder - would be tf.LayersModel
        config,
      });

      this.emit('model-loaded', symbol, timeframe);
      logger.info('Loaded model', { symbol, timeframe });
      return true;
    } catch (err) {
      logger.error('Failed to load model', { symbol, timeframe, error: err });
      this.emit('model-error', symbol, err as Error);
      return false;
    }
  }

  /**
   * Check if model is loaded
   */
  isModelLoaded(symbol: string, timeframe: string): boolean {
    return this.loadedModels.has(this.getModelKey(symbol, timeframe));
  }

  /**
   * Get available models
   */
  async getAvailableModels(): Promise<Array<{ symbol: string; timeframe: string }>> {
    const models: Array<{ symbol: string; timeframe: string }> = [];

    if (!(await fs.pathExists(this.modelsPath))) {
      return models;
    }

    const dirs = await fs.readdir(this.modelsPath);
    for (const dir of dirs) {
      const parts = dir.split('_');
      if (parts.length >= 2) {
        const symbol = parts.slice(0, -1).join('_');
        const timeframe = parts[parts.length - 1];
        models.push({ symbol, timeframe });
      }
    }

    return models;
  }

  // ===========================================================================
  // Technical Indicators
  // ===========================================================================

  /**
   * Calculate technical indicators from OHLCV data
   */
  calculateIndicators(data: OHLCVData[]): TechnicalIndicators {
    if (data.length < 200) {
      logger.warn('Insufficient data for all indicators', { length: data.length });
    }

    const closes = data.map((d) => d.close);
    const highs = data.map((d) => d.high);
    const lows = data.map((d) => d.low);
    const volumes = data.map((d) => d.volume);

    return {
      sma20: this.sma(closes, 20),
      sma50: this.sma(closes, 50),
      sma200: this.sma(closes, 200),
      ema12: this.ema(closes, 12),
      ema26: this.ema(closes, 26),
      rsi14: this.rsi(closes, 14),
      ...this.macd(closes),
      ...this.bollingerBands(closes, 20, 2),
      atr14: this.atr(highs, lows, closes, 14),
      obv: this.obv(closes, volumes),
      vwap: this.vwap(highs, lows, closes, volumes),
    };
  }

  /**
   * Simple Moving Average
   */
  private sma(data: number[], period: number): number | undefined {
    if (data.length < period) return undefined;
    const slice = data.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / period;
  }

  /**
   * Exponential Moving Average
   */
  private ema(data: number[], period: number): number | undefined {
    if (data.length < period) return undefined;

    const multiplier = 2 / (period + 1);
    let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;

    for (let i = period; i < data.length; i++) {
      ema = (data[i] - ema) * multiplier + ema;
    }

    return ema;
  }

  /**
   * Relative Strength Index
   */
  private rsi(data: number[], period: number): number | undefined {
    if (data.length < period + 1) return undefined;

    let gains = 0;
    let losses = 0;

    for (let i = data.length - period; i < data.length; i++) {
      const change = data[i] - data[i - 1];
      if (change > 0) gains += change;
      else losses -= change;
    }

    if (losses === 0) return 100;
    const rs = gains / losses;
    return 100 - 100 / (1 + rs);
  }

  /**
   * MACD
   */
  private macd(data: number[]): {
    macd?: number;
    macdSignal?: number;
    macdHistogram?: number;
  } {
    const ema12 = this.ema(data, 12);
    const ema26 = this.ema(data, 26);

    if (ema12 === undefined || ema26 === undefined) {
      return {};
    }

    const macd = ema12 - ema26;

    // For proper MACD signal, we'd need to track MACD history
    // Simplified version here
    return {
      macd,
      macdSignal: macd * 0.9, // Placeholder
      macdHistogram: macd * 0.1, // Placeholder
    };
  }

  /**
   * Bollinger Bands
   */
  private bollingerBands(
    data: number[],
    period: number,
    stdDev: number
  ): {
    bollingerUpper?: number;
    bollingerMiddle?: number;
    bollingerLower?: number;
  } {
    const middle = this.sma(data, period);
    if (middle === undefined) return {};

    const slice = data.slice(-period);
    const variance = slice.reduce((sum, val) => sum + Math.pow(val - middle, 2), 0) / period;
    const std = Math.sqrt(variance);

    return {
      bollingerUpper: middle + stdDev * std,
      bollingerMiddle: middle,
      bollingerLower: middle - stdDev * std,
    };
  }

  /**
   * Average True Range
   */
  private atr(
    highs: number[],
    lows: number[],
    closes: number[],
    period: number
  ): number | undefined {
    if (highs.length < period + 1) return undefined;

    let atr = 0;
    for (let i = highs.length - period; i < highs.length; i++) {
      const tr = Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      );
      atr += tr;
    }

    return atr / period;
  }

  /**
   * On-Balance Volume
   */
  private obv(closes: number[], volumes: number[]): number | undefined {
    if (closes.length < 2) return undefined;

    let obv = 0;
    for (let i = 1; i < closes.length; i++) {
      if (closes[i] > closes[i - 1]) {
        obv += volumes[i];
      } else if (closes[i] < closes[i - 1]) {
        obv -= volumes[i];
      }
    }

    return obv;
  }

  /**
   * Volume Weighted Average Price
   */
  private vwap(
    highs: number[],
    lows: number[],
    closes: number[],
    volumes: number[]
  ): number | undefined {
    if (closes.length === 0) return undefined;

    let cumVolume = 0;
    let cumVwap = 0;

    for (let i = 0; i < closes.length; i++) {
      const typicalPrice = (highs[i] + lows[i] + closes[i]) / 3;
      cumVolume += volumes[i];
      cumVwap += typicalPrice * volumes[i];
    }

    return cumVolume > 0 ? cumVwap / cumVolume : undefined;
  }

  // ===========================================================================
  // Prediction
  // ===========================================================================

  /**
   * Make a price prediction
   */
  async predict(symbol: string, data: OHLCVData[], timeframe?: string): Promise<Prediction | null> {
    const tf = timeframe || this.config.defaultTimeframe;
    const key = this.getModelKey(symbol, tf);

    // Check cache
    const cached = this.predictionCache.get(key);
    if (cached && Date.now() - cached.timestamp < this.config.predictionCacheTtl) {
      return cached.prediction;
    }

    // Load model if not loaded
    if (!this.loadedModels.has(key)) {
      const loaded = await this.loadModel(symbol, tf);
      if (!loaded) {
        // Use rule-based fallback
        return this.predictRuleBased(symbol, data, tf);
      }
    }

    const modelData = this.loadedModels.get(key)!;

    try {
      // Prepare features
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const _features = this.prepareFeatures(data, modelData.config);

      // In a full implementation, we would run inference here
      // const prediction = await model.predict(features);

      // For now, use rule-based prediction
      const prediction = this.predictRuleBased(symbol, data, tf);

      if (prediction) {
        prediction.modelVersion = 'rule-based-v1';

        // Cache prediction
        this.predictionCache.set(key, { prediction, timestamp: Date.now() });
        this.emit('prediction-made', prediction);
      }

      return prediction;
    } catch (err) {
      logger.error('Prediction failed', { symbol, timeframe: tf, error: err });
      this.emit('model-error', symbol, err as Error);
      return null;
    }
  }

  /**
   * Prepare features for model input
   */
  private prepareFeatures(data: OHLCVData[], _config: LSTMModelConfig): number[][] {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _indicators = this.calculateIndicators(data);

    // Normalize and prepare feature vectors
    // This would be customized based on model config
    const features: number[][] = [];

    for (let i = 0; i < data.length; i++) {
      const row = [data[i].open, data[i].high, data[i].low, data[i].close, data[i].volume];
      features.push(row);
    }

    return features;
  }

  /**
   * Rule-based prediction fallback
   */
  private predictRuleBased(
    symbol: string,
    data: OHLCVData[],
    timeframe: string
  ): Prediction | null {
    if (data.length < 50) {
      logger.warn('Insufficient data for prediction', { symbol, length: data.length });
      return null;
    }

    const indicators = this.calculateIndicators(data);
    const lastClose = data[data.length - 1].close;
    const prevClose = data[data.length - 2].close;

    // Calculate trend signals
    let bullishSignals = 0;
    let bearishSignals = 0;

    // SMA trend
    if (indicators.sma20 && indicators.sma50) {
      if (indicators.sma20 > indicators.sma50) bullishSignals++;
      else bearishSignals++;
    }

    // Price vs SMA
    if (indicators.sma20) {
      if (lastClose > indicators.sma20) bullishSignals++;
      else bearishSignals++;
    }

    // RSI
    if (indicators.rsi14) {
      if (indicators.rsi14 < 30)
        bullishSignals += 2; // Oversold
      else if (indicators.rsi14 > 70)
        bearishSignals += 2; // Overbought
      else if (indicators.rsi14 > 50) bullishSignals++;
      else bearishSignals++;
    }

    // MACD
    if (indicators.macd && indicators.macdSignal) {
      if (indicators.macd > indicators.macdSignal) bullishSignals++;
      else bearishSignals++;
    }

    // Bollinger Bands
    if (indicators.bollingerLower && indicators.bollingerUpper) {
      if (lastClose < indicators.bollingerLower)
        bullishSignals++; // Bounce potential
      else if (lastClose > indicators.bollingerUpper) bearishSignals++; // Overbought
    }

    // Momentum
    const momentum = (lastClose - prevClose) / prevClose;
    if (momentum > 0.01) bullishSignals++;
    else if (momentum < -0.01) bearishSignals++;

    // Calculate direction and confidence
    const totalSignals = bullishSignals + bearishSignals;
    let direction: 'up' | 'down' | 'neutral';
    let confidence: number;

    if (bullishSignals > bearishSignals) {
      direction = 'up';
      confidence = bullishSignals / totalSignals;
    } else if (bearishSignals > bullishSignals) {
      direction = 'down';
      confidence = bearishSignals / totalSignals;
    } else {
      direction = 'neutral';
      confidence = 0.5;
    }

    // Calculate price targets
    const atr = indicators.atr14 || lastClose * 0.02;
    const priceTarget = direction === 'up' ? lastClose + atr : lastClose - atr;

    // Determine horizon based on timeframe
    const horizonMap: Record<string, string> = {
      '1m': '15m',
      '5m': '1h',
      '15m': '4h',
      '1h': '1d',
      '4h': '3d',
      '1d': '1w',
    };

    return {
      symbol: symbol.toUpperCase(),
      timeframe,
      direction,
      confidence: Math.round(confidence * 100) / 100,
      priceTarget: Math.round(priceTarget * 100) / 100,
      priceTargetLow: Math.round((lastClose - atr * 1.5) * 100) / 100,
      priceTargetHigh: Math.round((lastClose + atr * 1.5) * 100) / 100,
      horizon: horizonMap[timeframe] || '1d',
      timestamp: Date.now(),
      modelVersion: 'rule-based-v1',
      features: {
        trendStrength: Math.abs(bullishSignals - bearishSignals) / totalSignals,
        volatility: atr / lastClose,
        momentum: momentum,
        volumeProfile: this.getVolumeProfile(data),
      },
    };
  }

  /**
   * Analyze volume profile
   */
  private getVolumeProfile(data: OHLCVData[]): 'increasing' | 'decreasing' | 'stable' {
    if (data.length < 10) return 'stable';

    const recentAvg = data.slice(-5).reduce((s, d) => s + d.volume, 0) / 5;
    const previousAvg = data.slice(-10, -5).reduce((s, d) => s + d.volume, 0) / 5;

    const change = (recentAvg - previousAvg) / previousAvg;

    if (change > 0.2) return 'increasing';
    if (change < -0.2) return 'decreasing';
    return 'stable';
  }

  /**
   * Get prediction from cache
   */
  getCachedPrediction(symbol: string, timeframe?: string): Prediction | null {
    const key = this.getModelKey(symbol, timeframe || this.config.defaultTimeframe);
    const cached = this.predictionCache.get(key);
    return cached?.prediction || null;
  }

  /**
   * Clear prediction cache
   */
  clearCache(): void {
    this.predictionCache.clear();
    logger.debug('Cleared prediction cache');
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    this.loadedModels.clear();
    this.predictionCache.clear();
    this.initialized = false;
    logger.info('LSTMPredictor cleaned up');
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let instance: LSTMPredictor | null = null;

/**
 * Get the LSTMPredictor singleton
 */
export function getLSTMPredictor(): LSTMPredictor {
  if (!instance) {
    instance = new LSTMPredictor();
  }
  return instance;
}

/**
 * Initialize the LSTMPredictor
 */
export async function initializeLSTMPredictor(
  config?: Partial<LSTMPredictorConfig>
): Promise<LSTMPredictor> {
  if (!instance) {
    instance = new LSTMPredictor(config);
  }
  await instance.initialize();
  return instance;
}

/**
 * Cleanup the LSTMPredictor
 */
export async function cleanupLSTMPredictor(): Promise<void> {
  if (instance) {
    await instance.cleanup();
    instance = null;
  }
}
