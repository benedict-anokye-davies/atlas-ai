/**
 * Atlas ML Training - Data Collector
 *
 * Collects training data from various sources:
 * - Conversations from ConversationMemory
 * - Voice samples from voice pipeline
 * - Trading data from exchanges
 *
 * Data is stored locally and can be exported for training.
 *
 * @module ml/training/data-collector
 */

import { EventEmitter } from 'events';
import * as fs from 'fs-extra';
import * as path from 'path';
import { app } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { createModuleLogger } from '../../utils/logger';
import {
  DatasetType,
  ConversationSample,
  VoiceSample,
  TradingDataPoint,
  DatasetStats,
  ExportOptions,
  ExportResult,
  CollectionConfig,
  DEFAULT_COLLECTION_CONFIG,
  ConversationTrainingRow,
} from './types';

const logger = createModuleLogger('TrainingDataCollector');

/**
 * Training Data Collector
 *
 * Manages collection, storage, and export of training data
 * for ML model fine-tuning.
 */
export class TrainingDataCollector extends EventEmitter {
  private config: CollectionConfig;
  private dataPath: string;
  private initialized: boolean = false;

  // In-memory caches for recent samples
  private conversationCache: ConversationSample[] = [];
  private voiceCache: VoiceSample[] = [];
  private tradingCache: Map<string, TradingDataPoint[]> = new Map(); // key: symbol:timeframe

  // Dataset stats
  private stats: Map<DatasetType, DatasetStats> = new Map();

  constructor(config?: Partial<CollectionConfig>) {
    super();
    this.config = { ...DEFAULT_COLLECTION_CONFIG, ...config };
    this.dataPath = this.config.storagePath || path.join(app.getPath('userData'), 'training-data');
  }

  /**
   * Initialize the data collector
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    logger.info('Initializing TrainingDataCollector', { dataPath: this.dataPath });

    // Create directory structure
    await this.ensureDirectories();

    // Load existing stats
    await this.loadStats();

    this.initialized = true;
    logger.info('TrainingDataCollector initialized');
  }

  /**
   * Ensure all required directories exist
   */
  private async ensureDirectories(): Promise<void> {
    const dirs = [
      this.dataPath,
      path.join(this.dataPath, 'conversations'),
      path.join(this.dataPath, 'voice'),
      path.join(this.dataPath, 'trading'),
      path.join(this.dataPath, 'exports'),
      path.join(this.dataPath, 'labels'),
    ];

    for (const dir of dirs) {
      await fs.ensureDir(dir);
    }
  }

  /**
   * Load stats from disk
   */
  private async loadStats(): Promise<void> {
    const statsPath = path.join(this.dataPath, 'stats.json');

    try {
      if (await fs.pathExists(statsPath)) {
        const data = await fs.readJson(statsPath);
        for (const [type, stats] of Object.entries(data)) {
          this.stats.set(type as DatasetType, stats as DatasetStats);
        }
      }
    } catch (err) {
      logger.warn('Failed to load stats, starting fresh', { error: err });
    }

    // Initialize missing stats
    const types: DatasetType[] = ['conversation', 'voice', 'trading', 'emotion', 'preference'];
    for (const type of types) {
      if (!this.stats.has(type)) {
        this.stats.set(type, {
          type,
          totalSamples: 0,
          labeledSamples: 0,
          unlabeledSamples: 0,
          sizeBytes: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
    }
  }

  /**
   * Save stats to disk
   */
  private async saveStats(): Promise<void> {
    const statsPath = path.join(this.dataPath, 'stats.json');
    const data: Record<string, DatasetStats> = {};

    for (const [type, stats] of this.stats.entries()) {
      data[type] = stats;
    }

    await fs.writeJson(statsPath, data, { spaces: 2 });
  }

  // ==========================================================================
  // Conversation Collection
  // ==========================================================================

  /**
   * Collect a conversation sample
   */
  async collectConversation(sample: Omit<ConversationSample, 'id' | 'timestamp'>): Promise<string> {
    if (!this.config.collectConversations) {
      return '';
    }

    const fullSample: ConversationSample = {
      ...sample,
      id: uuidv4(),
      timestamp: Date.now(),
    };

    // Add to cache
    this.conversationCache.push(fullSample);

    // Persist to disk
    const filePath = path.join(this.dataPath, 'conversations', `${fullSample.id}.json`);
    await fs.writeJson(filePath, fullSample, { spaces: 2 });

    // Update stats
    const stats = this.stats.get('conversation')!;
    stats.totalSamples++;
    stats.updatedAt = Date.now();
    if (fullSample.quality !== undefined) {
      stats.labeledSamples++;
    } else {
      stats.unlabeledSamples++;
    }
    await this.saveStats();

    logger.debug('Collected conversation sample', { id: fullSample.id });
    this.emit('sample-collected', fullSample);

    return fullSample.id;
  }

  /**
   * Collect conversations from memory manager
   */
  async collectConversationsFromMemory(limit?: number): Promise<number> {
    try {
      const convDir = path.join(this.dataPath, 'conversations');
      const existingIds = new Set<string>();

      // Get existing IDs to avoid duplicates
      const files = await fs.readdir(convDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          existingIds.add(file.replace('.json', ''));
        }
      }

      // Import from Obsidian vault conversations folder
      const vaultPath = path.join(app.getPath('userData'), 'brain', 'conversations');
      if (await fs.pathExists(vaultPath)) {
        const convFiles = await fs.readdir(vaultPath);
        let collected = 0;

        for (const file of convFiles) {
          if (limit && collected >= limit) break;
          if (!file.endsWith('.md')) continue;

          const id = path.basename(file, '.md');
          if (existingIds.has(id)) continue;

          const content = await fs.readFile(path.join(vaultPath, file), 'utf-8');
          const sample = this.parseConversationFromMarkdown(content, id);

          if (sample) {
            await this.collectConversation(sample);
            collected++;
          }
        }

        logger.info('Collected conversations from memory', { count: collected });
        return collected;
      }

      return 0;
    } catch (err) {
      logger.error('Failed to collect conversations from memory', { error: err });
      return 0;
    }
  }

  /**
   * Parse a conversation from markdown format
   */
  private parseConversationFromMarkdown(
    content: string,
    _id: string
  ): Omit<ConversationSample, 'id' | 'timestamp'> | null {
    try {
      const lines = content.split('\n');
      let userMessage = '';
      let assistantResponse = '';
      let inUser = false;
      let inAssistant = false;

      for (const line of lines) {
        if (line.startsWith('## User:') || line.startsWith('**User:**')) {
          inUser = true;
          inAssistant = false;
          continue;
        }
        if (line.startsWith('## Atlas:') || line.startsWith('**Atlas:**')) {
          inUser = false;
          inAssistant = true;
          continue;
        }

        if (inUser) {
          userMessage += line + '\n';
        } else if (inAssistant) {
          assistantResponse += line + '\n';
        }
      }

      if (!userMessage.trim() || !assistantResponse.trim()) {
        return null;
      }

      return {
        userMessage: userMessage.trim(),
        assistantResponse: assistantResponse.trim(),
        topics: this.extractTopics(userMessage + ' ' + assistantResponse),
      };
    } catch {
      return null;
    }
  }

  /**
   * Extract topics from text
   */
  private extractTopics(text: string): string[] {
    const topics: string[] = [];
    const textLower = text.toLowerCase();

    const topicKeywords: Record<string, string[]> = {
      coding: ['code', 'programming', 'function', 'error', 'bug', 'debug'],
      trading: ['trade', 'stock', 'crypto', 'bitcoin', 'price', 'market'],
      email: ['email', 'inbox', 'send', 'reply', 'message'],
      calendar: ['calendar', 'meeting', 'schedule', 'appointment', 'event'],
      music: ['music', 'song', 'play', 'spotify', 'playlist'],
      files: ['file', 'folder', 'document', 'save', 'open'],
      browser: ['browser', 'website', 'search', 'google', 'url'],
      system: ['system', 'computer', 'restart', 'shutdown', 'settings'],
    };

    for (const [topic, keywords] of Object.entries(topicKeywords)) {
      if (keywords.some((kw) => textLower.includes(kw))) {
        topics.push(topic);
      }
    }

    return topics;
  }

  // ==========================================================================
  // Voice Sample Collection
  // ==========================================================================

  /**
   * Collect a voice sample
   */
  async collectVoiceSample(audioBuffer: Buffer, metadata: Partial<VoiceSample>): Promise<string> {
    if (!this.config.collectVoice) {
      return '';
    }

    const id = uuidv4();
    const audioPath = path.join(this.dataPath, 'voice', `${id}.wav`);

    // Write audio file
    await fs.writeFile(audioPath, audioBuffer);

    const sample: VoiceSample = {
      id,
      timestamp: Date.now(),
      audioPath,
      durationSeconds: metadata.durationSeconds || 0,
      sampleRate: metadata.sampleRate || 16000,
      speakerId: metadata.speakerId,
      speakerName: metadata.speakerName,
      transcript: metadata.transcript,
      isWakeWord: metadata.isWakeWord || false,
      wakeWordPhrase: metadata.wakeWordPhrase,
      emotion: metadata.emotion,
      quality: metadata.quality,
      noiseLevel: metadata.noiseLevel,
    };

    // Save metadata
    const metadataPath = path.join(this.dataPath, 'voice', `${id}.json`);
    await fs.writeJson(metadataPath, sample, { spaces: 2 });

    // Add to cache
    this.voiceCache.push(sample);

    // Update stats
    const stats = this.stats.get('voice')!;
    stats.totalSamples++;
    stats.updatedAt = Date.now();
    stats.sizeBytes += audioBuffer.length;
    if (sample.speakerId || sample.emotion) {
      stats.labeledSamples++;
    } else {
      stats.unlabeledSamples++;
    }
    await this.saveStats();

    logger.debug('Collected voice sample', { id, duration: sample.durationSeconds });
    this.emit('sample-collected', sample);

    return id;
  }

  // ==========================================================================
  // Trading Data Collection
  // ==========================================================================

  /**
   * Collect trading data points
   */
  async collectTradingData(dataPoints: TradingDataPoint[]): Promise<number> {
    if (!this.config.collectTrading || dataPoints.length === 0) {
      return 0;
    }

    // Group by symbol:exchange:timeframe
    const grouped = new Map<string, TradingDataPoint[]>();

    for (const dp of dataPoints) {
      const key = `${dp.symbol}:${dp.exchange}:${dp.timeframe}`;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(dp);
    }

    let totalCollected = 0;

    for (const [key, points] of grouped.entries()) {
      // Load existing data
      const filePath = path.join(this.dataPath, 'trading', `${key.replace(/[:/]/g, '_')}.json`);
      let existingData: TradingDataPoint[] = [];

      if (await fs.pathExists(filePath)) {
        existingData = await fs.readJson(filePath);
      }

      // Merge and dedupe by timestamp
      const timestamps = new Set(existingData.map((d) => d.timestamp));
      const newPoints = points.filter((p) => !timestamps.has(p.timestamp));

      if (newPoints.length > 0) {
        const merged = [...existingData, ...newPoints].sort((a, b) => a.timestamp - b.timestamp);

        // Limit to max samples
        const limited = merged.slice(-this.config.maxSamples);

        await fs.writeJson(filePath, limited, { spaces: 2 });

        // Update cache
        this.tradingCache.set(key, limited);

        totalCollected += newPoints.length;
      }
    }

    if (totalCollected > 0) {
      // Update stats
      const stats = this.stats.get('trading')!;
      stats.totalSamples += totalCollected;
      stats.updatedAt = Date.now();
      await this.saveStats();

      logger.debug('Collected trading data', { count: totalCollected });
    }

    return totalCollected;
  }

  /**
   * Collect trading data from exchange history
   */
  async collectFromExchangeHistory(
    exchange: string,
    symbol: string,
    timeframe: string,
    _since?: number
  ): Promise<number> {
    try {
      // This would integrate with the trading module
      // For now, we'll return 0 - actual integration happens when trading module is available
      logger.info('Collecting from exchange history', { exchange, symbol, timeframe });

      // TODO: Integrate with src/main/trading/history.ts
      // const history = await getTradingHistory();
      // const ohlcv = await history.getOHLCV(exchange, symbol, timeframe, since);
      // return this.collectTradingData(ohlcv);

      return 0;
    } catch (err) {
      logger.error('Failed to collect from exchange history', { error: err });
      return 0;
    }
  }

  /**
   * Add technical indicators to trading data
   */
  calculateIndicators(data: TradingDataPoint[]): TradingDataPoint[] {
    if (data.length < 200) {
      return data; // Not enough data for indicators
    }

    const result = [...data];

    for (let i = 199; i < result.length; i++) {
      const slice = result.slice(i - 199, i + 1);
      const closes = slice.map((d) => d.close);

      result[i].indicators = {
        sma20: this.sma(closes, 20),
        sma50: this.sma(closes, 50),
        sma200: this.sma(closes, 200),
        ema12: this.ema(closes, 12),
        ema26: this.ema(closes, 26),
        rsi14: this.rsi(closes, 14),
        ...this.macd(closes),
        ...this.bollingerBands(closes, 20),
        atr14: this.atr(slice, 14),
      };
    }

    return result;
  }

  // Technical indicator helpers
  private sma(values: number[], period: number): number {
    const slice = values.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / period;
  }

  private ema(values: number[], period: number): number {
    const multiplier = 2 / (period + 1);
    let ema = values[0];
    for (let i = 1; i < values.length; i++) {
      ema = (values[i] - ema) * multiplier + ema;
    }
    return ema;
  }

  private rsi(values: number[], period: number): number {
    const changes: number[] = [];
    for (let i = 1; i < values.length; i++) {
      changes.push(values[i] - values[i - 1]);
    }

    const gains = changes.slice(-period).filter((c) => c > 0);
    const losses = changes
      .slice(-period)
      .filter((c) => c < 0)
      .map(Math.abs);

    const avgGain = gains.length > 0 ? gains.reduce((a, b) => a + b, 0) / period : 0;
    const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / period : 0;

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }

  private macd(values: number[]): { macd: number; macdSignal: number; macdHistogram: number } {
    const ema12 = this.ema(values, 12);
    const ema26 = this.ema(values, 26);
    const macd = ema12 - ema26;
    const macdSignal = this.ema(values.slice(-9), 9); // Simplified
    return {
      macd,
      macdSignal,
      macdHistogram: macd - macdSignal,
    };
  }

  private bollingerBands(
    values: number[],
    period: number
  ): { bollingerUpper: number; bollingerMiddle: number; bollingerLower: number } {
    const slice = values.slice(-period);
    const middle = this.sma(slice, period);
    const squaredDiffs = slice.map((v) => Math.pow(v - middle, 2));
    const stdDev = Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / period);

    return {
      bollingerUpper: middle + 2 * stdDev,
      bollingerMiddle: middle,
      bollingerLower: middle - 2 * stdDev,
    };
  }

  private atr(data: TradingDataPoint[], period: number): number {
    const slice = data.slice(-period);
    let sum = 0;

    for (let i = 1; i < slice.length; i++) {
      const tr = Math.max(
        slice[i].high - slice[i].low,
        Math.abs(slice[i].high - slice[i - 1].close),
        Math.abs(slice[i].low - slice[i - 1].close)
      );
      sum += tr;
    }

    return sum / (period - 1);
  }

  // ==========================================================================
  // Dataset Export
  // ==========================================================================

  /**
   * Export dataset to file
   */
  async exportDataset(options: ExportOptions): Promise<ExportResult> {
    logger.info('Exporting dataset', { type: options.type, format: options.format });

    await fs.ensureDir(options.outputPath);

    switch (options.type) {
      case 'conversation':
        return this.exportConversations(options);
      case 'voice':
        return this.exportVoiceSamples(options);
      case 'trading':
        return this.exportTradingData(options);
      default:
        throw new Error(`Unsupported dataset type: ${options.type}`);
    }
  }

  /**
   * Export conversations for LLM fine-tuning
   */
  private async exportConversations(options: ExportOptions): Promise<ExportResult> {
    const convDir = path.join(this.dataPath, 'conversations');
    const files = await fs.readdir(convDir);
    const samples: ConversationSample[] = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      const sample: ConversationSample = await fs.readJson(path.join(convDir, file));

      // Apply filters
      if (options.minQuality && (sample.quality || 0) < options.minQuality) continue;
      if (options.since && sample.timestamp < options.since) continue;
      if (options.until && sample.timestamp > options.until) continue;
      if (options.labeledOnly && sample.quality === undefined) continue;

      samples.push(sample);
    }

    // Shuffle if requested
    if (options.shuffle) {
      for (let i = samples.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [samples[i], samples[j]] = [samples[j], samples[i]];
      }
    }

    // Convert to training format
    const rows: ConversationTrainingRow[] = samples.map((s) => ({
      messages: [
        ...(s.systemPrompt ? [{ role: 'system' as const, content: s.systemPrompt }] : []),
        { role: 'user' as const, content: s.userMessage },
        { role: 'assistant' as const, content: s.assistantResponse },
      ],
    }));

    // Handle splits
    if (options.split) {
      return this.exportWithSplits(rows, options, 'conversation');
    }

    // Single file export
    const outputFile = path.join(
      options.outputPath,
      `conversations.${options.format === 'jsonl' ? 'jsonl' : 'json'}`
    );

    if (options.format === 'jsonl') {
      const content = rows.map((r) => JSON.stringify(r)).join('\n');
      await fs.writeFile(outputFile, content);
    } else {
      await fs.writeJson(outputFile, rows, { spaces: 2 });
    }

    const stats = await fs.stat(outputFile);

    const result: ExportResult = {
      type: 'conversation',
      format: options.format,
      outputPath: outputFile,
      totalSamples: rows.length,
      sizeBytes: stats.size,
      exportedAt: Date.now(),
    };

    this.emit('export-complete', result);
    return result;
  }

  /**
   * Export with train/val/test splits
   */
  private async exportWithSplits<T>(
    data: T[],
    options: ExportOptions,
    type: DatasetType
  ): Promise<ExportResult> {
    const split = options.split!;
    const total = data.length;

    const trainEnd = Math.floor(total * split.train);
    const valEnd = trainEnd + Math.floor(total * split.validation);

    const trainData = data.slice(0, trainEnd);
    const valData = data.slice(trainEnd, valEnd);
    const testData = data.slice(valEnd);

    const ext = options.format === 'jsonl' ? 'jsonl' : 'json';

    const trainPath = path.join(options.outputPath, `train.${ext}`);
    const valPath = path.join(options.outputPath, `validation.${ext}`);
    const testPath = path.join(options.outputPath, `test.${ext}`);

    const writeData = async (filePath: string, items: T[]) => {
      if (options.format === 'jsonl') {
        await fs.writeFile(filePath, items.map((i) => JSON.stringify(i)).join('\n'));
      } else {
        await fs.writeJson(filePath, items, { spaces: 2 });
      }
    };

    await Promise.all([
      writeData(trainPath, trainData),
      writeData(valPath, valData),
      writeData(testPath, testData),
    ]);

    const stats = await fs.stat(trainPath);

    return {
      type,
      format: options.format,
      outputPath: options.outputPath,
      totalSamples: total,
      splits: {
        train: trainPath,
        validation: valPath,
        test: testPath,
      },
      sizeBytes: stats.size * 3, // Approximate
      exportedAt: Date.now(),
    };
  }

  /**
   * Export voice samples
   */
  private async exportVoiceSamples(options: ExportOptions): Promise<ExportResult> {
    const voiceDir = path.join(this.dataPath, 'voice');
    const files = await fs.readdir(voiceDir);
    const samples: VoiceSample[] = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      const sample: VoiceSample = await fs.readJson(path.join(voiceDir, file));

      // Apply filters
      if (options.minQuality && (sample.quality || 0) < options.minQuality) continue;
      if (options.since && sample.timestamp < options.since) continue;
      if (options.until && sample.timestamp > options.until) continue;
      if (options.labeledOnly && !sample.speakerId && !sample.emotion) continue;

      samples.push(sample);
    }

    // For voice, we create a manifest file and copy audio files
    const manifestPath = path.join(options.outputPath, 'manifest.json');
    const audioDir = path.join(options.outputPath, 'audio');
    await fs.ensureDir(audioDir);

    for (const sample of samples) {
      if (await fs.pathExists(sample.audioPath)) {
        const destPath = path.join(audioDir, path.basename(sample.audioPath));
        await fs.copy(sample.audioPath, destPath);
      }
    }

    await fs.writeJson(manifestPath, samples, { spaces: 2 });

    return {
      type: 'voice',
      format: options.format,
      outputPath: options.outputPath,
      totalSamples: samples.length,
      sizeBytes: 0, // Would need to calculate
      exportedAt: Date.now(),
    };
  }

  /**
   * Export trading data
   */
  private async exportTradingData(options: ExportOptions): Promise<ExportResult> {
    const tradingDir = path.join(this.dataPath, 'trading');
    const files = await fs.readdir(tradingDir);
    const allData: TradingDataPoint[] = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      const data: TradingDataPoint[] = await fs.readJson(path.join(tradingDir, file));

      // Apply filters
      const filtered = data.filter((d) => {
        if (options.since && d.timestamp < options.since) return false;
        if (options.until && d.timestamp > options.until) return false;
        return true;
      });

      allData.push(...filtered);
    }

    // Sort by timestamp
    allData.sort((a, b) => a.timestamp - b.timestamp);

    const outputFile = path.join(
      options.outputPath,
      `trading.${options.format === 'csv' ? 'csv' : 'json'}`
    );

    if (options.format === 'csv') {
      const headers = [
        'timestamp',
        'symbol',
        'exchange',
        'timeframe',
        'open',
        'high',
        'low',
        'close',
        'volume',
      ];
      const rows = allData.map((d) =>
        [
          d.timestamp,
          d.symbol,
          d.exchange,
          d.timeframe,
          d.open,
          d.high,
          d.low,
          d.close,
          d.volume,
        ].join(',')
      );
      await fs.writeFile(outputFile, [headers.join(','), ...rows].join('\n'));
    } else {
      await fs.writeJson(outputFile, allData, { spaces: 2 });
    }

    const stats = await fs.stat(outputFile);

    return {
      type: 'trading',
      format: options.format,
      outputPath: outputFile,
      totalSamples: allData.length,
      sizeBytes: stats.size,
      exportedAt: Date.now(),
    };
  }

  // ==========================================================================
  // Stats and Queries
  // ==========================================================================

  /**
   * Get dataset statistics
   */
  async getDatasetStats(type?: DatasetType): Promise<DatasetStats | DatasetStats[] | null> {
    if (type) {
      return this.stats.get(type) || null;
    }
    return Array.from(this.stats.values());
  }

  /**
   * Get conversation samples
   */
  async getConversations(options?: {
    limit?: number;
    offset?: number;
    topics?: string[];
  }): Promise<ConversationSample[]> {
    const convDir = path.join(this.dataPath, 'conversations');
    const files = await fs.readdir(convDir);
    const samples: ConversationSample[] = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const sample = await fs.readJson(path.join(convDir, file));
      samples.push(sample);
    }

    // Sort by timestamp (newest first)
    samples.sort((a, b) => b.timestamp - a.timestamp);

    // Apply filters
    let result = samples;

    if (options?.topics?.length) {
      result = result.filter((s) => s.topics.some((t) => options.topics!.includes(t)));
    }

    // Apply pagination
    const offset = options?.offset || 0;
    const limit = options?.limit || 100;

    return result.slice(offset, offset + limit);
  }

  /**
   * Get trading data for a symbol
   */
  async getTradingData(
    symbol: string,
    exchange: string,
    timeframe: string
  ): Promise<TradingDataPoint[]> {
    const key = `${symbol}:${exchange}:${timeframe}`.replace(/[:/]/g, '_');
    const filePath = path.join(this.dataPath, 'trading', `${key}.json`);

    if (await fs.pathExists(filePath)) {
      return fs.readJson(filePath);
    }

    return [];
  }

  /**
   * Clear all collected data
   */
  async clearDataset(type?: DatasetType): Promise<void> {
    if (type) {
      const dir = path.join(this.dataPath, type === 'conversation' ? 'conversations' : type);
      await fs.emptyDir(dir);

      const stats = this.stats.get(type);
      if (stats) {
        stats.totalSamples = 0;
        stats.labeledSamples = 0;
        stats.unlabeledSamples = 0;
        stats.sizeBytes = 0;
        stats.updatedAt = Date.now();
      }
    } else {
      // Clear all
      await fs.emptyDir(path.join(this.dataPath, 'conversations'));
      await fs.emptyDir(path.join(this.dataPath, 'voice'));
      await fs.emptyDir(path.join(this.dataPath, 'trading'));

      for (const stats of this.stats.values()) {
        stats.totalSamples = 0;
        stats.labeledSamples = 0;
        stats.unlabeledSamples = 0;
        stats.sizeBytes = 0;
        stats.updatedAt = Date.now();
      }
    }

    await this.saveStats();
    logger.info('Cleared dataset', { type: type || 'all' });
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    await this.saveStats();
    this.conversationCache = [];
    this.voiceCache = [];
    this.tradingCache.clear();
    this.initialized = false;
    logger.info('TrainingDataCollector cleaned up');
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let instance: TrainingDataCollector | null = null;

/**
 * Get the TrainingDataCollector singleton
 */
export function getTrainingDataCollector(): TrainingDataCollector {
  if (!instance) {
    instance = new TrainingDataCollector();
  }
  return instance;
}

/**
 * Initialize the TrainingDataCollector
 */
export async function initializeTrainingDataCollector(
  config?: Partial<CollectionConfig>
): Promise<TrainingDataCollector> {
  if (!instance) {
    instance = new TrainingDataCollector(config);
  }
  await instance.initialize();
  return instance;
}

/**
 * Cleanup the TrainingDataCollector
 */
export async function cleanupTrainingDataCollector(): Promise<void> {
  if (instance) {
    await instance.cleanup();
    instance = null;
  }
}
