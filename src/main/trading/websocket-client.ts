/**
 * Trading WebSocket Client
 *
 * Real-time connection to Go trading backend for:
 * - Trade executions
 * - Position updates
 * - Regime changes
 * - Risk alerts
 * - Signal updates
 *
 * Atlas uses this to stay informed and speak proactively about trading events.
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { createModuleLogger } from '../utils/logger';
import type {
  Trade,
  Position,
  RegimeState,
  Signal,
  Order,
  AgentStatus,
} from './api-client';

const logger = createModuleLogger('TradingWS');

// =============================================================================
// Types
// =============================================================================

export interface TradingWSConfig {
  url: string;
  apiKey?: string;
  reconnectInterval: number;
  maxReconnectAttempts: number;
  heartbeatInterval: number;
  subscriptions: TradingSubscription[];
}

export type TradingSubscription =
  | 'trades'
  | 'positions'
  | 'orders'
  | 'regime'
  | 'signals'
  | 'risk'
  | 'agent'
  | 'all';

export interface WSMessage {
  type: string;
  channel: string;
  data: unknown;
  timestamp: number;
}

// Event payloads
export interface TradeEvent {
  trade: Trade;
  isWin: boolean;
  portfolioImpact: number;
  dayPnLAfter: number;
  message: string; // Human-readable summary
}

export interface PositionEvent {
  action: 'opened' | 'updated' | 'closed';
  position: Position;
  change?: {
    field: string;
    oldValue: number;
    newValue: number;
  };
  message: string;
}

export interface RegimeChangeEvent {
  previousRegime: string;
  newRegime: string;
  confidence: number;
  adjustments: {
    positionMultiplier: number;
    stopMultiplier: number;
    targetMultiplier: number;
  };
  message: string;
}

export interface SignalEvent {
  signal: Signal;
  isActionable: boolean;
  suggestedAction?: string;
  message: string;
}

export interface RiskAlertEvent {
  severity: 'info' | 'warning' | 'critical';
  type: string;
  message: string;
  currentValue: number;
  limit: number;
  action?: string; // What the system did in response
}

export interface AgentStateEvent {
  previousState: string;
  newState: string;
  reason: string;
  message: string;
}

export interface OrderEvent {
  action: 'placed' | 'filled' | 'cancelled' | 'rejected';
  order: Order;
  fillPrice?: number;
  message: string;
}

// =============================================================================
// WebSocket Client Class
// =============================================================================

const DEFAULT_CONFIG: TradingWSConfig = {
  url: process.env.TRADING_WS_URL || 'ws://localhost:8080/ws',
  apiKey: process.env.TRADING_API_KEY,
  reconnectInterval: 5000,
  maxReconnectAttempts: 10,
  heartbeatInterval: 30000,
  subscriptions: ['all'],
};

export class TradingWebSocketClient extends EventEmitter {
  private config: TradingWSConfig;
  private ws: WebSocket | null = null;
  private reconnectAttempts: number = 0;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isIntentionallyClosed: boolean = false;
  private messageQueue: WSMessage[] = [];
  private isConnected: boolean = false;

  // State tracking for natural conversation
  private lastTradeTime: number = 0;
  private todayTrades: Trade[] = [];
  private todayPnL: number = 0;
  private currentRegime: string = 'Unknown';
  private openPositions: Position[] = [];

  constructor(config: Partial<TradingWSConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ---------------------------------------------------------------------------
  // Connection Management
  // ---------------------------------------------------------------------------

  connect(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      logger.warn('WebSocket already connected');
      return;
    }

    this.isIntentionallyClosed = false;
    this.createConnection();
  }

  private createConnection(): void {
    try {
      const url = new URL(this.config.url);
      if (this.config.apiKey) {
        url.searchParams.set('apiKey', this.config.apiKey);
      }

      this.ws = new WebSocket(url.toString());

      this.ws.on('open', () => this.handleOpen());
      this.ws.on('message', (data) => this.handleMessage(data));
      this.ws.on('close', (code, reason) => this.handleClose(code, reason.toString()));
      this.ws.on('error', (error) => this.handleError(error));
    } catch (error) {
      logger.error('Failed to create WebSocket connection', { error });
      this.scheduleReconnect();
    }
  }

  private handleOpen(): void {
    logger.info('Trading WebSocket connected');
    this.isConnected = true;
    this.reconnectAttempts = 0;

    // Subscribe to channels
    this.subscribe(this.config.subscriptions);

    // Start heartbeat
    this.startHeartbeat();

    // Flush message queue
    this.flushMessageQueue();

    this.emit('connected');
  }

  private handleMessage(data: WebSocket.Data): void {
    try {
      const message: WSMessage = JSON.parse(data.toString());
      this.routeMessage(message);
    } catch (error) {
      logger.error('Failed to parse WebSocket message', { error, data: data.toString() });
    }
  }

  private handleClose(code: number, reason: string): void {
    logger.info('Trading WebSocket closed', { code, reason });
    this.isConnected = false;
    this.stopHeartbeat();

    if (!this.isIntentionallyClosed) {
      this.scheduleReconnect();
    }

    this.emit('disconnected', { code, reason });
  }

  private handleError(error: Error): void {
    logger.error('Trading WebSocket error', { error: error.message });
    this.emit('error', error);
  }

  disconnect(): void {
    this.isIntentionallyClosed = true;
    this.stopHeartbeat();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }

    this.isConnected = false;
    logger.info('Trading WebSocket disconnected');
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      logger.error('Max reconnection attempts reached');
      this.emit('reconnect-failed');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.config.reconnectInterval * this.reconnectAttempts;

    logger.info(`Scheduling reconnect attempt ${this.reconnectAttempts} in ${delay}ms`);

    this.reconnectTimer = setTimeout(() => {
      this.createConnection();
    }, delay);
  }

  // ---------------------------------------------------------------------------
  // Heartbeat
  // ---------------------------------------------------------------------------

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, this.config.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Subscriptions
  // ---------------------------------------------------------------------------

  subscribe(channels: TradingSubscription[]): void {
    this.send({
      type: 'subscribe',
      channel: 'control',
      data: { channels },
      timestamp: Date.now(),
    });
  }

  unsubscribe(channels: TradingSubscription[]): void {
    this.send({
      type: 'unsubscribe',
      channel: 'control',
      data: { channels },
      timestamp: Date.now(),
    });
  }

  // ---------------------------------------------------------------------------
  // Message Routing
  // ---------------------------------------------------------------------------

  private routeMessage(message: WSMessage): void {
    switch (message.channel) {
      case 'trades':
        this.handleTradeMessage(message.data as TradeEvent);
        break;
      case 'positions':
        this.handlePositionMessage(message.data as PositionEvent);
        break;
      case 'orders':
        this.handleOrderMessage(message.data as OrderEvent);
        break;
      case 'regime':
        this.handleRegimeMessage(message.data as RegimeChangeEvent);
        break;
      case 'signals':
        this.handleSignalMessage(message.data as SignalEvent);
        break;
      case 'risk':
        this.handleRiskMessage(message.data as RiskAlertEvent);
        break;
      case 'agent':
        this.handleAgentMessage(message.data as AgentStateEvent);
        break;
      case 'heartbeat':
        // Heartbeat acknowledged
        break;
      default:
        logger.debug('Unknown WebSocket channel', { channel: message.channel });
    }
  }

  // ---------------------------------------------------------------------------
  // Event Handlers with Conversation Context
  // ---------------------------------------------------------------------------

  private handleTradeMessage(event: TradeEvent): void {
    logger.info('Trade executed', { trade: event.trade });

    // Update internal state
    this.lastTradeTime = event.trade.timestamp;
    this.todayTrades.push(event.trade);
    this.todayPnL = event.dayPnLAfter;

    // Generate conversational message for Atlas to potentially speak
    const conversationalMessage = this.generateTradeMessage(event);

    this.emit('trade', {
      ...event,
      conversationalMessage,
      shouldSpeak: this.shouldSpeakAboutTrade(event),
    });
  }

  private generateTradeMessage(event: TradeEvent): string {
    const { trade, isWin, portfolioImpact } = event;
    const pnlAbs = Math.abs(trade.pnl);
    const pnlWord = isWin ? 'profit' : 'loss';

    if (Math.abs(portfolioImpact) < 0.001) {
      // Very small trade, brief mention
      return `Closed ${trade.symbol} for ${pnlAbs.toFixed(2)} quid ${pnlWord}.`;
    }

    if (isWin) {
      const enthusiasm = portfolioImpact > 0.01 ? 'Nice one!' : '';
      return `${enthusiasm} Just closed ${trade.symbol} - ${pnlAbs.toFixed(2)} quid profit, about ${(trade.pnlPercent * 100).toFixed(1)}% on the position.`;
    } else {
      return `Closed ${trade.symbol} for a ${pnlAbs.toFixed(2)} quid loss. ${trade.reasoning || 'Stop got hit.'}`;
    }
  }

  private shouldSpeakAboutTrade(event: TradeEvent): boolean {
    // Speak about significant trades
    const significantPnL = Math.abs(event.portfolioImpact) > 0.005; // 0.5% portfolio impact
    const significantAmount = Math.abs(event.trade.pnl) > 50; // Over £50
    return significantPnL || significantAmount;
  }

  private handlePositionMessage(event: PositionEvent): void {
    logger.info('Position update', { action: event.action, symbol: event.position.symbol });

    // Update internal state
    if (event.action === 'opened') {
      this.openPositions.push(event.position);
    } else if (event.action === 'closed') {
      this.openPositions = this.openPositions.filter(
        (p) => p.symbol !== event.position.symbol
      );
    } else {
      const index = this.openPositions.findIndex(
        (p) => p.symbol === event.position.symbol
      );
      if (index >= 0) {
        this.openPositions[index] = event.position;
      }
    }

    const conversationalMessage = this.generatePositionMessage(event);

    this.emit('position', {
      ...event,
      conversationalMessage,
      shouldSpeak: event.action === 'opened',
    });
  }

  private generatePositionMessage(event: PositionEvent): string {
    const { action, position } = event;

    switch (action) {
      case 'opened':
        return `Opened a ${position.side} position on ${position.symbol} at ${position.entryPrice.toFixed(2)}. Size is about ${(position.size * position.entryPrice).toFixed(0)} quid.`;
      case 'closed':
        return `Closed ${position.symbol} position.`;
      case 'updated':
        if (event.change) {
          return `Updated ${position.symbol} ${event.change.field} from ${event.change.oldValue} to ${event.change.newValue}.`;
        }
        return `Updated ${position.symbol} position.`;
      default:
        return '';
    }
  }

  private handleOrderMessage(event: OrderEvent): void {
    logger.info('Order event', { action: event.action, order: event.order });

    const conversationalMessage = this.generateOrderMessage(event);

    this.emit('order', {
      ...event,
      conversationalMessage,
      shouldSpeak: event.action === 'filled' || event.action === 'rejected',
    });
  }

  private generateOrderMessage(event: OrderEvent): string {
    const { action, order } = event;

    switch (action) {
      case 'placed':
        return `Placed ${order.type} ${order.side} order for ${order.quantity} ${order.symbol}.`;
      case 'filled':
        return `Order filled - ${order.side} ${order.quantity} ${order.symbol} at ${order.averagePrice.toFixed(2)}.`;
      case 'cancelled':
        return `Cancelled ${order.symbol} order.`;
      case 'rejected':
        return `Order rejected for ${order.symbol}. Need to check why.`;
      default:
        return '';
    }
  }

  private handleRegimeMessage(event: RegimeChangeEvent): void {
    logger.info('Regime change', {
      from: event.previousRegime,
      to: event.newRegime,
      confidence: event.confidence,
    });

    this.currentRegime = event.newRegime;

    const conversationalMessage = this.generateRegimeMessage(event);

    this.emit('regime', {
      ...event,
      conversationalMessage,
      shouldSpeak: true, // Always speak about regime changes
    });
  }

  private generateRegimeMessage(event: RegimeChangeEvent): string {
    const { previousRegime, newRegime, confidence, adjustments } = event;

    let message = `Market regime just shifted from ${previousRegime} to ${newRegime}. `;

    if (confidence > 0.8) {
      message += `Pretty confident about this one at ${(confidence * 100).toFixed(0)}%. `;
    } else {
      message += `Confidence is ${(confidence * 100).toFixed(0)}% so keeping an eye on it. `;
    }

    if (adjustments.positionMultiplier < 1) {
      message += `Dialing back position sizes to ${(adjustments.positionMultiplier * 100).toFixed(0)}% of normal.`;
    } else if (adjustments.positionMultiplier > 1) {
      message += `Conditions look favorable, sizing up a bit.`;
    }

    return message;
  }

  private handleSignalMessage(event: SignalEvent): void {
    logger.debug('Signal received', { signal: event.signal });

    const conversationalMessage = this.generateSignalMessage(event);

    this.emit('signal', {
      ...event,
      conversationalMessage,
      shouldSpeak: event.isActionable && event.signal.confidence > 0.7,
    });
  }

  private generateSignalMessage(event: SignalEvent): string {
    const { signal, isActionable, suggestedAction } = event;

    if (!isActionable) {
      return `Seeing a ${signal.direction} signal on ${signal.symbol} from ${signal.source}, but not actionable right now.`;
    }

    let message = `Got a ${signal.direction} signal on ${signal.symbol}. `;
    message += `${signal.source} is showing ${(signal.strength * 100).toFixed(0)}% strength with ${(signal.confidence * 100).toFixed(0)}% confidence. `;

    if (suggestedAction) {
      message += suggestedAction;
    }

    return message;
  }

  private handleRiskMessage(event: RiskAlertEvent): void {
    logger.warn('Risk alert', { severity: event.severity, type: event.type });

    const conversationalMessage = this.generateRiskMessage(event);

    this.emit('risk', {
      ...event,
      conversationalMessage,
      shouldSpeak: event.severity !== 'info',
    });
  }

  private generateRiskMessage(event: RiskAlertEvent): string {
    const { severity, type, message, currentValue, limit, action } = event;

    let result = '';

    switch (severity) {
      case 'critical':
        result = `Heads up - ${message}. `;
        if (action) {
          result += `${action}. `;
        }
        result += 'Let me know if you want to override.';
        break;
      case 'warning':
        result = `Quick warning: ${message}. Currently at ${currentValue.toFixed(2)} against a limit of ${limit.toFixed(2)}.`;
        break;
      default:
        result = message;
    }

    return result;
  }

  private handleAgentMessage(event: AgentStateEvent): void {
    logger.info('Agent state change', {
      from: event.previousState,
      to: event.newState,
      reason: event.reason,
    });

    const conversationalMessage = this.generateAgentMessage(event);

    this.emit('agent-state', {
      ...event,
      conversationalMessage,
      shouldSpeak: true,
    });
  }

  private generateAgentMessage(event: AgentStateEvent): string {
    const { previousState, newState, reason } = event;

    switch (newState) {
      case 'paused':
        return `Pausing trading. ${reason}`;
      case 'running':
        if (previousState === 'paused') {
          return `Resuming trading now.`;
        }
        return `Trading is now active.`;
      case 'stopped':
        return `Trading stopped. ${reason}`;
      case 'error':
        return `Hit an issue with trading: ${reason}. Looking into it.`;
      default:
        return `Trading state changed to ${newState}.`;
    }
  }

  // ---------------------------------------------------------------------------
  // Send Methods
  // ---------------------------------------------------------------------------

  private send(message: WSMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      // Queue message for when connection is restored
      this.messageQueue.push(message);
    }
  }

  private flushMessageQueue(): void {
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (message) {
        this.send(message);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // State Access for Conversations
  // ---------------------------------------------------------------------------

  getConnectionStatus(): boolean {
    return this.isConnected;
  }

  getTodayTrades(): Trade[] {
    return [...this.todayTrades];
  }

  getTodayPnL(): number {
    return this.todayPnL;
  }

  getCurrentRegime(): string {
    return this.currentRegime;
  }

  getOpenPositions(): Position[] {
    return [...this.openPositions];
  }

  getLastTradeTime(): number {
    return this.lastTradeTime;
  }

  resetDailyState(): void {
    this.todayTrades = [];
    this.todayPnL = 0;
    logger.info('Daily trading state reset');
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let tradingWSInstance: TradingWebSocketClient | null = null;

export function getTradingWebSocket(config?: Partial<TradingWSConfig>): TradingWebSocketClient {
  if (!tradingWSInstance) {
    tradingWSInstance = new TradingWebSocketClient(config);
    logger.info('Trading WebSocket client created');
  }
  return tradingWSInstance;
}

export function resetTradingWebSocket(): void {
  if (tradingWSInstance) {
    tradingWSInstance.disconnect();
    tradingWSInstance = null;
  }
}
