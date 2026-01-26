/**
 * Trading Proactive Handler
 *
 * Handles proactive trading events and converts them to voice messages.
 * This is what allows Atlas to naturally share trading updates:
 * - "Just closed that ETH trade, made 340 quid"
 * - "Market regime just shifted to bearish, scaling down positions"
 * - "Nice one on that SOL trade!"
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { getTradingWebSocket, type TradeEvent, type PositionEvent, type RegimeChangeEvent, type RiskAlertEvent } from './websocket-client';
import { getTradingStateManager } from './state-manager';

const logger = createModuleLogger('TradingProactive');

// =============================================================================
// Types
// =============================================================================

export interface ProactiveMessage {
  id: string;
  type: 'trade' | 'position' | 'regime' | 'risk' | 'milestone' | 'insight';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  message: string;
  speakable: boolean;
  timestamp: number;
  data?: unknown;
}

export interface ProactiveConfig {
  /** Enable proactive messages */
  enabled: boolean;
  /** Minimum delay between messages (ms) */
  minMessageInterval: number;
  /** Only speak high-priority messages */
  onlySpeakHighPriority: boolean;
  /** Enable trade notifications */
  notifyTrades: boolean;
  /** Enable position notifications */
  notifyPositions: boolean;
  /** Enable regime change notifications */
  notifyRegimeChanges: boolean;
  /** Enable risk alert notifications */
  notifyRiskAlerts: boolean;
  /** Enable milestone notifications (e.g., daily target hit) */
  notifyMilestones: boolean;
}

const DEFAULT_CONFIG: ProactiveConfig = {
  enabled: true,
  minMessageInterval: 30000, // 30 seconds
  onlySpeakHighPriority: false,
  notifyTrades: true,
  notifyPositions: true,
  notifyRegimeChanges: true,
  notifyRiskAlerts: true,
  notifyMilestones: true,
};

// =============================================================================
// Proactive Handler
// =============================================================================

export class TradingProactiveHandler extends EventEmitter {
  private config: ProactiveConfig;
  private lastMessageTime: number = 0;
  private messageQueue: ProactiveMessage[] = [];
  private isProcessing: boolean = false;
  private milestones: {
    dailyTargetHit: boolean;
    firstWinToday: boolean;
    streakAnnounced: number;
  } = {
    dailyTargetHit: false,
    firstWinToday: false,
    streakAnnounced: 0,
  };

  constructor(config: Partial<ProactiveConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize and connect to trading events
   */
  async initialize(): Promise<void> {
    logger.info('Initializing trading proactive handler');

    const ws = getTradingWebSocket();

    // Listen to trade events
    if (this.config.notifyTrades) {
      ws.on('trade', (event: TradeEvent) => this.handleTradeEvent(event));
    }

    // Listen to position events
    if (this.config.notifyPositions) {
      ws.on('position:opened', (event: PositionEvent) => this.handlePositionEvent(event, 'opened'));
      ws.on('position:closed', (event: PositionEvent) => this.handlePositionEvent(event, 'closed'));
      ws.on('position:updated', (event: PositionEvent) => this.handlePositionEvent(event, 'updated'));
    }

    // Listen to regime changes
    if (this.config.notifyRegimeChanges) {
      ws.on('regime:change', (event: RegimeChangeEvent) => this.handleRegimeChange(event));
    }

    // Listen to risk alerts
    if (this.config.notifyRiskAlerts) {
      ws.on('risk:alert', (event: RiskAlertEvent) => this.handleRiskAlert(event));
    }

    // Reset milestones at midnight
    this.scheduleDaily5AMReset();

    logger.info('Trading proactive handler initialized');
  }

  /**
   * Handle trade completion events
   */
  private handleTradeEvent(event: TradeEvent): void {
    const { trade, isWin, dayPnL } = event;
    const stateManager = getTradingStateManager();

    // Generate message based on trade outcome
    let message: string;
    let priority: ProactiveMessage['priority'] = 'medium';

    if (isWin) {
      // Winning trade
      if (trade.pnl > 100) {
        message = `Nice one! Just closed ${trade.symbol} for ${trade.pnl.toFixed(2)} quid profit. That's ${(trade.pnlPercent * 100).toFixed(1)}% on the position.`;
        priority = 'high';
      } else {
        message = `Closed ${trade.symbol} with ${trade.pnl.toFixed(2)} quid profit.`;
        priority = 'medium';
      }

      // Check for first win of the day
      if (!this.milestones.firstWinToday) {
        this.milestones.firstWinToday = true;
        message += ' First win of the day!';
      }
    } else {
      // Losing trade
      if (Math.abs(trade.pnl) > 100) {
        message = `That ${trade.symbol} trade didn't work out. Cut it for ${Math.abs(trade.pnl).toFixed(2)} quid loss. ${(trade.pnlPercent * 100).toFixed(1)}%.`;
        priority = 'high';
      } else {
        message = `Closed ${trade.symbol} for small loss of ${Math.abs(trade.pnl).toFixed(2)} quid.`;
        priority = 'low';
      }
    }

    // Check for streak milestones
    const context = stateManager.getCachedContext();
    if (context) {
      if (context.winStreak > 0 && context.winStreak % 3 === 0 && context.winStreak > this.milestones.streakAnnounced) {
        message += ` That's ${context.winStreak} in a row!`;
        this.milestones.streakAnnounced = context.winStreak;
        priority = 'high';
      }
    }

    // Check for daily target milestone
    if (!this.milestones.dailyTargetHit && dayPnL > 500) {
      this.milestones.dailyTargetHit = true;
      this.queueMessage({
        type: 'milestone',
        priority: 'high',
        message: `Daily target hit! Up ${dayPnL.toFixed(2)} quid today. Maybe time to ease off and protect the gains.`,
        speakable: true,
      });
    }

    this.queueMessage({
      type: 'trade',
      priority,
      message,
      speakable: true,
      data: { trade, isWin, dayPnL },
    });
  }

  /**
   * Handle position events
   */
  private handlePositionEvent(event: PositionEvent, action: string): void {
    const { position } = event;

    let message: string;
    let priority: ProactiveMessage['priority'] = 'low';
    let speakable = false;

    switch (action) {
      case 'opened':
        message = `Opened ${position.side} position on ${position.symbol} at ${position.entryPrice.toFixed(2)}.`;
        if (position.size > 1000) {
          priority = 'medium';
          speakable = true;
        }
        break;

      case 'closed':
        // Usually handled by trade event, skip
        return;

      case 'updated':
        // Only speak significant updates
        if (event.change?.field === 'stopLoss') {
          message = `Moved ${position.symbol} stop to ${event.change.newValue.toFixed(2)}.`;
          priority = 'low';
        } else if (event.change?.field === 'takeProfit') {
          message = `Updated ${position.symbol} target to ${event.change.newValue.toFixed(2)}.`;
          priority = 'low';
        } else {
          return; // Skip other updates
        }
        break;

      default:
        return;
    }

    this.queueMessage({
      type: 'position',
      priority,
      message,
      speakable,
      data: { position, action },
    });
  }

  /**
   * Handle regime change events
   */
  private handleRegimeChange(event: RegimeChangeEvent): void {
    const { previousRegime, newRegime, adjustments, message } = event;

    let proactiveMessage: string;
    let priority: ProactiveMessage['priority'] = 'medium';

    // Generate conversational message based on regime transition
    if (newRegime === 'Bull' && previousRegime !== 'Bull') {
      proactiveMessage = `Market regime just shifted bullish. Confidence is ${(event.confidence * 100).toFixed(0)}%. Sizing up positions now.`;
      priority = 'high';
    } else if (newRegime === 'Bear' && previousRegime !== 'Bear') {
      proactiveMessage = `Heads up - regime shifted bearish. Reducing position sizes and tightening stops.`;
      priority = 'high';
    } else if (newRegime === 'HighVol') {
      proactiveMessage = `Volatility spiking. Scaling down to ${(adjustments.positionMultiplier * 100).toFixed(0)}% of normal size.`;
      priority = 'high';
    } else if (newRegime === 'LowVol') {
      proactiveMessage = `Volatility dropped. Good for mean reversion strategies.`;
      priority = 'medium';
    } else {
      proactiveMessage = message;
      priority = 'medium';
    }

    this.queueMessage({
      type: 'regime',
      priority,
      message: proactiveMessage,
      speakable: true,
      data: event,
    });
  }

  /**
   * Handle risk alert events
   */
  private handleRiskAlert(event: RiskAlertEvent): void {
    const { severity, type, message } = event;

    let priority: ProactiveMessage['priority'];
    let proactiveMessage: string;

    switch (severity) {
      case 'critical':
        priority = 'urgent';
        proactiveMessage = `⚠️ ${message}`;
        break;
      case 'warning':
        priority = 'high';
        proactiveMessage = message;
        break;
      default:
        priority = 'medium';
        proactiveMessage = message;
    }

    // Make risk messages more conversational
    if (type === 'drawdown') {
      proactiveMessage = `Drawdown warning. ${message} Scaling back to protect capital.`;
    } else if (type === 'dailyLoss') {
      proactiveMessage = `Hit daily loss limit. Pausing new trades to protect the account.`;
    }

    this.queueMessage({
      type: 'risk',
      priority,
      message: proactiveMessage,
      speakable: true,
      data: event,
    });
  }

  /**
   * Queue a proactive message
   */
  private queueMessage(partial: Omit<ProactiveMessage, 'id' | 'timestamp'>): void {
    if (!this.config.enabled) return;

    const message: ProactiveMessage = {
      ...partial,
      id: `pm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
    };

    this.messageQueue.push(message);
    this.processQueue();
  }

  /**
   * Process the message queue
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.messageQueue.length === 0) return;

    const now = Date.now();
    const timeSinceLastMessage = now - this.lastMessageTime;

    // Respect minimum interval between messages
    if (timeSinceLastMessage < this.config.minMessageInterval) {
      const delay = this.config.minMessageInterval - timeSinceLastMessage;
      setTimeout(() => this.processQueue(), delay);
      return;
    }

    this.isProcessing = true;

    try {
      // Sort by priority (urgent > high > medium > low)
      const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
      this.messageQueue.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

      const message = this.messageQueue.shift();
      if (!message) return;

      // Check if we should speak this message
      const shouldSpeak = message.speakable &&
        (!this.config.onlySpeakHighPriority || ['urgent', 'high'].includes(message.priority));

      this.lastMessageTime = now;

      // Emit for voice pipeline integration
      this.emit('proactive-message', {
        ...message,
        shouldSpeak,
      });

      logger.info('Emitted proactive message', {
        type: message.type,
        priority: message.priority,
        shouldSpeak,
      });
    } finally {
      this.isProcessing = false;

      // Process next message if queue not empty
      if (this.messageQueue.length > 0) {
        setTimeout(() => this.processQueue(), 100);
      }
    }
  }

  /**
   * Schedule daily reset at 5 AM
   */
  private scheduleDaily5AMReset(): void {
    const now = new Date();
    const reset = new Date();
    reset.setHours(5, 0, 0, 0);

    if (now > reset) {
      reset.setDate(reset.getDate() + 1);
    }

    const msUntilReset = reset.getTime() - now.getTime();

    setTimeout(() => {
      this.resetMilestones();
      this.scheduleDaily5AMReset(); // Reschedule for next day
    }, msUntilReset);
  }

  /**
   * Reset daily milestones
   */
  private resetMilestones(): void {
    this.milestones = {
      dailyTargetHit: false,
      firstWinToday: false,
      streakAnnounced: 0,
    };
    logger.info('Reset daily milestones');
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<ProactiveConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): ProactiveConfig {
    return { ...this.config };
  }

  /**
   * Get pending messages count
   */
  getPendingCount(): number {
    return this.messageQueue.length;
  }

  /**
   * Clear the message queue
   */
  clearQueue(): void {
    this.messageQueue = [];
  }

  /**
   * Check if handler is running
   */
  isRunning(): boolean {
    return this.config.enabled;
  }

  /**
   * Stop the proactive handler
   */
  stop(): void {
    this.config.enabled = false;
    this.clearQueue();
    this.removeAllListeners();
    logger.info('Proactive handler stopped');
  }
}

// =============================================================================
// Singleton
// =============================================================================

let instance: TradingProactiveHandler | null = null;

export function getTradingProactiveHandler(): TradingProactiveHandler {
  if (!instance) {
    instance = new TradingProactiveHandler();
  }
  return instance;
}

export function createTradingProactiveHandler(config: Partial<ProactiveConfig>): TradingProactiveHandler {
  instance = new TradingProactiveHandler(config);
  return instance;
}
