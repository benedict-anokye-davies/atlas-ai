/**
 * Trading System Initializer
 *
 * Bootstraps the autonomous trading system when Atlas starts.
 * Connects all components: API client, WebSocket, state manager,
 * research agent, and proactive handler.
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { getTradingAPI, TradingAPIClient } from './api-client';
import { getTradingWebSocket, TradingWebSocketClient } from './websocket-client';
import { getTradingStateManager, TradingStateManager } from './state-manager';
import { getTradingResearchAgent, TradingResearchAgent } from './research-agent';
import { getTradingProactiveHandler, TradingProactiveHandler } from './proactive-handler';

const logger = createModuleLogger('TradingInit');

// =============================================================================
// Types
// =============================================================================

export interface TradingSystemConfig {
  /** Go backend URL */
  backendUrl: string;
  /** WebSocket URL */
  websocketUrl: string;
  /** Auto-connect on init */
  autoConnect: boolean;
  /** Enable proactive voice messages */
  enableProactiveMessages: boolean;
  /** Perplexity API key for research */
  perplexityApiKey?: string;
}

export interface TradingSystemStatus {
  initialized: boolean;
  apiConnected: boolean;
  wsConnected: boolean;
  stateManagerReady: boolean;
  researchAgentReady: boolean;
  proactiveHandlerReady: boolean;
  lastError?: string;
}

// =============================================================================
// Trading System Initializer
// =============================================================================

class TradingSystemInitializer extends EventEmitter {
  private config: TradingSystemConfig | null = null;
  private api: TradingAPIClient | null = null;
  private ws: TradingWebSocketClient | null = null;
  private stateManager: TradingStateManager | null = null;
  private researchAgent: TradingResearchAgent | null = null;
  private proactiveHandler: TradingProactiveHandler | null = null;
  private initialized = false;

  /**
   * Initialize the trading system
   */
  async initialize(config: TradingSystemConfig): Promise<void> {
    if (this.initialized) {
      logger.warn('Trading system already initialized');
      return;
    }

    logger.info('Initializing trading system...', {
      backendUrl: config.backendUrl,
      autoConnect: config.autoConnect,
    });

    this.config = config;

    try {
      // 1. Initialize API client
      this.api = getTradingAPI();
      await this.api.initialize({
        baseUrl: config.backendUrl,
        timeout: 30000,
      });
      logger.info('API client initialized');

      // 2. Initialize WebSocket
      this.ws = getTradingWebSocket();
      if (config.autoConnect) {
        await this.ws.connect(config.websocketUrl);
        logger.info('WebSocket connected');
      }

      // 3. Initialize state manager
      this.stateManager = getTradingStateManager();
      await this.stateManager.initialize();
      logger.info('State manager initialized');

      // 4. Initialize research agent
      this.researchAgent = getTradingResearchAgent();
      await this.researchAgent.initialize({
        perplexityApiKey: config.perplexityApiKey,
      });
      logger.info('Research agent initialized');

      // 5. Initialize proactive handler (connects to WebSocket events)
      if (config.enableProactiveMessages) {
        this.proactiveHandler = getTradingProactiveHandler();
        await this.proactiveHandler.initialize();
        
        // Forward proactive messages to event emitter
        this.proactiveHandler.on('proactive-message', (message) => {
          this.emit('proactive-message', message);
        });
        logger.info('Proactive handler initialized');
      }

      // 6. Wire up WebSocket events to state manager
      this.wireWebSocketEvents();

      this.initialized = true;
      this.emit('initialized');
      logger.info('Trading system fully initialized');

    } catch (error) {
      logger.error('Failed to initialize trading system', { error });
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Wire WebSocket events for forwarding to main process
   * Note: State manager handles its own event subscriptions internally
   */
  private wireWebSocketEvents(): void {
    if (!this.ws) return;

    // Forward events to main process for renderer
    this.ws.on('trade', (trade) => {
      this.emit('trade', trade);
    });

    this.ws.on('position', (position) => {
      this.emit('position', position);
    });

    this.ws.on('regime', (regime) => {
      this.emit('regime-change', regime);
    });

    this.ws.on('risk', (alert) => {
      this.emit('risk-alert', alert);
    });

    this.ws.on('agent-state', (status) => {
      this.emit('agent-status', status);
    });

    this.ws.on('signal', (signal) => {
      this.emit('signal', signal);
    });

    // Connection status
    this.ws.on('connected', () => {
      this.emit('ws-connected');
    });

    this.ws.on('disconnected', () => {
      this.emit('ws-disconnected');
    });

    this.ws.on('error', (error) => {
      logger.error('WebSocket error', { error });
      this.emit('ws-error', error);
    });
  }

  /**
   * Get current system status
   */
  getStatus(): TradingSystemStatus {
    return {
      initialized: this.initialized,
      apiConnected: this.api?.getConnectionStatus() ?? false,
      wsConnected: this.ws?.isConnected() ?? false,
      stateManagerReady: this.stateManager?.isReady() ?? false,
      researchAgentReady: this.researchAgent?.isReady() ?? false,
      proactiveHandlerReady: this.proactiveHandler?.isRunning() ?? false,
    };
  }

  /**
   * Get trading context for LLM conversations
   */
  async getTradingContext(): Promise<string> {
    if (!this.stateManager) {
      return '';
    }

    try {
      const context = await this.stateManager.getFullContext();
      const summary = this.stateManager.generateStatusSummary();
      
      // Build context string for system prompt injection
      let contextStr = `\n\n[TRADING CONTEXT]\n`;
      contextStr += `Status: ${context.agentStatus}\n`;
      contextStr += `Today's PnL: ${context.todayPnL >= 0 ? '+' : ''}£${context.todayPnL.toFixed(2)}\n`;
      contextStr += `Open positions: ${context.openPositions.length}\n`;
      
      if (context.currentRegime) {
        contextStr += `Market regime: ${context.currentRegime.regime} (${(context.currentRegime.confidence * 100).toFixed(0)}% confident)\n`;
      }
      
      if (context.openPositions.length > 0) {
        contextStr += `Positions: ${context.openPositions.map(p => `${p.symbol} (${p.direction})`).join(', ')}\n`;
      }
      
      contextStr += `Mood: ${context.mood}\n`;
      contextStr += `Summary: ${summary}\n`;
      
      return contextStr;
    } catch (error) {
      logger.error('Failed to get trading context', { error });
      return '';
    }
  }

  /**
   * Shutdown the trading system
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down trading system...');

    if (this.proactiveHandler) {
      this.proactiveHandler.stop();
    }

    if (this.ws) {
      await this.ws.disconnect();
    }

    this.initialized = false;
    this.emit('shutdown');
    logger.info('Trading system shut down');
  }

  /**
   * Check if system is ready for operations
   */
  isReady(): boolean {
    return this.initialized && (this.api?.isConnected() ?? false);
  }
}

// =============================================================================
// Singleton
// =============================================================================

let instance: TradingSystemInitializer | null = null;

export function getTradingSystem(): TradingSystemInitializer {
  if (!instance) {
    instance = new TradingSystemInitializer();
  }
  return instance;
}

export function createTradingSystem(): TradingSystemInitializer {
  instance = new TradingSystemInitializer();
  return instance;
}

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Initialize trading with environment config
 */
export async function initializeTradingSystem(): Promise<void> {
  const system = getTradingSystem();
  
  await system.initialize({
    backendUrl: process.env.TRADING_BACKEND_URL || 'http://localhost:8080',
    websocketUrl: process.env.TRADING_WS_URL || 'ws://localhost:8080/ws',
    autoConnect: true,
    enableProactiveMessages: true,
    perplexityApiKey: process.env.PERPLEXITY_API_KEY,
  });
}

/**
 * Get trading context for LLM injection
 */
export async function getTradingContextForLLM(): Promise<string> {
  const system = getTradingSystem();
  if (!system.isReady()) {
    return '';
  }
  return system.getTradingContext();
}

export { TradingSystemInitializer };
