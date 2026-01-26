# PRD-T3: Trading Infrastructure & Finance (Phases 5-6)

## Terminal Assignment: T3

## Phases: 5 (Trading Infrastructure), 6 (Finance & Banking)

## Estimated Tasks: 52

## Priority: HIGH - Core autonomous capability

---

## Overview

T3 is responsible for implementing full trading platform integrations (Binance, Coinbase, Charles Schwab, MetaTrader 4/5) and UK Open Banking integration (TSB via TrueLayer). This enables Atlas to monitor portfolios, execute trades, and manage finances.

**CRITICAL**: All trading operations must be tested on TESTNET/SANDBOX first. Never use real funds during development.

---

## File Ownership

```
src/main/trading/                         # Trading infrastructure
  ├── manager.ts                          # Trading manager singleton
  ├── exchanges/
  │   ├── base.ts                         # Base exchange interface
  │   ├── binance.ts                      # Binance integration
  │   ├── coinbase.ts                     # Coinbase integration
  │   ├── schwab.ts                       # Charles Schwab integration
  │   └── metaapi.ts                      # MetaTrader 4/5 via MetaApi
  ├── portfolio.ts                        # Aggregated portfolio
  ├── alerts.ts                           # Price alerts
  ├── history.ts                          # Trade history
  ├── websocket.ts                        # Real-time price streaming
  └── index.ts
src/main/finance/                         # Banking & finance (ENHANCE)
  ├── truelayer.ts                        # TrueLayer client (ENHANCE)
  ├── transactions.ts                     # Transaction categorization (ENHANCE)
  ├── budgets.ts                          # NEW: Budget tracking
  ├── insights.ts                         # NEW: Spending insights
  └── index.ts
src/main/agent/tools/trading.ts           # Trading tools (ENHANCE)
src/main/agent/tools/finance.ts           # Finance tools (ENHANCE)
src/shared/types/trading.ts               # NEW: Trading types
src/shared/types/finance.ts               # NEW: Finance types
tests/trading/                            # NEW: Trading tests
tests/finance/                            # NEW: Finance tests
```

## IPC Channels

- `trading:*` - Trading operations
- `portfolio:*` - Portfolio management
- `alerts:*` - Price alerts
- `finance:*` - Banking operations
- `budget:*` - Budget tracking

---

## Phase 5: Trading Infrastructure

### Dependencies

```bash
npm install ccxt decimal.js ws
npm install metaapi.cloud-sdk  # For MT4/MT5
# Schwab uses OAuth - no SDK needed
```

### Task T3-101: Trading Types & Base Interface [HIGH]

**File:** `src/shared/types/trading.ts`

**Requirements:**
Define comprehensive types for all trading operations:

```typescript
// Exchange types
export type ExchangeId = 'binance' | 'coinbase' | 'schwab' | 'metatrader';

export interface ExchangeCredentials {
  exchangeId: ExchangeId;
  apiKey: string;
  apiSecret: string;
  sandbox?: boolean;
  additionalConfig?: Record<string, unknown>;
}

// Balance types
export interface Balance {
  currency: string;
  total: string;
  available: string;
  locked: string;
}

export interface AggregatedBalance {
  totalUSD: string;
  byExchange: Record<ExchangeId, Balance[]>;
  byCurrency: Record<string, { total: string; exchanges: ExchangeId[] }>;
  lastUpdated: number;
}

// Position types
export interface Position {
  exchangeId: ExchangeId;
  symbol: string;
  side: 'long' | 'short';
  size: string;
  entryPrice: string;
  currentPrice: string;
  unrealizedPnL: string;
  unrealizedPnLPercent: string;
  leverage?: number;
  liquidationPrice?: string;
}

// Order types
export type OrderType = 'market' | 'limit' | 'stop' | 'stop_limit' | 'trailing_stop';
export type OrderSide = 'buy' | 'sell';
export type OrderStatus = 'open' | 'closed' | 'canceled' | 'expired' | 'rejected';

export interface OrderRequest {
  exchangeId: ExchangeId;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  amount: string;
  price?: string; // Required for limit orders
  stopPrice?: string; // Required for stop orders
  trailingPercent?: number;
  timeInForce?: 'GTC' | 'IOC' | 'FOK';
  reduceOnly?: boolean;
}

export interface Order {
  id: string;
  exchangeId: ExchangeId;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  status: OrderStatus;
  amount: string;
  filled: string;
  remaining: string;
  price: string;
  avgPrice: string;
  cost: string;
  fee: { currency: string; cost: string };
  createdAt: number;
  updatedAt: number;
}

// Price alert types
export interface PriceAlert {
  id: string;
  symbol: string;
  condition: 'above' | 'below' | 'crosses';
  targetPrice: string;
  currentPrice: string;
  triggered: boolean;
  triggeredAt?: number;
  createdAt: number;
  notifyMethod: ('voice' | 'sms' | 'push')[];
}

// Ticker types
export interface Ticker {
  symbol: string;
  bid: string;
  ask: string;
  last: string;
  high24h: string;
  low24h: string;
  volume24h: string;
  change24h: string;
  changePercent24h: string;
  timestamp: number;
}
```

**Test Checklist:**

- [ ] All types compile without errors
- [ ] Types are exported correctly
- [ ] Types are comprehensive for all operations

---

### Task T3-102: Base Exchange Interface [HIGH]

**File:** `src/main/trading/exchanges/base.ts`

**Requirements:**

```typescript
export abstract class BaseExchange extends EventEmitter {
  abstract readonly exchangeId: ExchangeId;
  abstract readonly name: string;
  protected credentials: ExchangeCredentials | null = null;
  protected sandbox: boolean = false;

  // Connection
  abstract connect(credentials: ExchangeCredentials): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract isConnected(): boolean;
  abstract testConnection(): Promise<boolean>;

  // Account
  abstract getBalances(): Promise<Balance[]>;
  abstract getPositions(): Promise<Position[]>;

  // Market data
  abstract getTicker(symbol: string): Promise<Ticker>;
  abstract getTickers(symbols?: string[]): Promise<Ticker[]>;
  abstract getOrderBook(symbol: string, limit?: number): Promise<OrderBook>;
  abstract getOHLCV(symbol: string, timeframe: string, limit?: number): Promise<OHLCV[]>;

  // Trading
  abstract placeOrder(order: OrderRequest): Promise<Order>;
  abstract cancelOrder(orderId: string, symbol: string): Promise<boolean>;
  abstract getOrder(orderId: string, symbol: string): Promise<Order>;
  abstract getOpenOrders(symbol?: string): Promise<Order[]>;
  abstract getOrderHistory(symbol?: string, limit?: number): Promise<Order[]>;

  // Websocket
  abstract subscribeToTicker(symbol: string, callback: TickerCallback): void;
  abstract subscribeToOrderBook(symbol: string, callback: OrderBookCallback): void;
  abstract subscribeToTrades(symbol: string, callback: TradeCallback): void;
  abstract unsubscribe(symbol: string, type: string): void;

  // Utility
  abstract getMarkets(): Promise<Market[]>;
  abstract getSymbolInfo(symbol: string): Promise<Market>;
  abstract formatSymbol(base: string, quote: string): string;
}
```

**Test Checklist:**

- [ ] Interface compiles
- [ ] All methods defined
- [ ] EventEmitter properly extended

---

### Task T3-103: Binance Integration [HIGH]

**File:** `src/main/trading/exchanges/binance.ts`

**Requirements:**

1. Implement BaseExchange for Binance
2. Support both spot and futures
3. Use ccxt for REST API
4. Implement WebSocket for real-time data
5. Support testnet mode
6. Handle rate limiting

**Implementation Details:**

```typescript
import ccxt from 'ccxt';

export class BinanceExchange extends BaseExchange {
  readonly exchangeId = 'binance' as const;
  readonly name = 'Binance';

  private exchange: ccxt.binance | null = null;
  private ws: WebSocket | null = null;
  private subscriptions: Map<string, Set<Function>> = new Map();

  async connect(credentials: ExchangeCredentials): Promise<void> {
    this.sandbox = credentials.sandbox ?? false;

    this.exchange = new ccxt.binance({
      apiKey: credentials.apiKey,
      secret: credentials.apiSecret,
      sandbox: this.sandbox,
      enableRateLimit: true,
      options: {
        defaultType: 'spot', // or 'future' for USDT-M futures
        adjustForTimeDifference: true,
      },
    });

    // Test connection
    await this.exchange.loadMarkets();

    // Connect WebSocket
    this.connectWebSocket();

    this.emit('connected');
  }

  private connectWebSocket(): void {
    const baseUrl = this.sandbox
      ? 'wss://testnet.binance.vision/ws'
      : 'wss://stream.binance.com:9443/ws';

    this.ws = new WebSocket(baseUrl);

    this.ws.on('open', () => {
      this.emit('ws:connected');
      // Resubscribe to all streams
      this.resubscribeAll();
    });

    this.ws.on('message', (data) => {
      this.handleWebSocketMessage(JSON.parse(data.toString()));
    });

    this.ws.on('close', () => {
      this.emit('ws:disconnected');
      // Auto-reconnect after 5 seconds
      setTimeout(() => this.connectWebSocket(), 5000);
    });
  }

  async getBalances(): Promise<Balance[]> {
    const balance = await this.exchange!.fetchBalance();
    return Object.entries(balance.total)
      .filter(([_, amount]) => parseFloat(amount as string) > 0)
      .map(([currency, total]) => ({
        currency,
        total: String(total),
        available: String(balance.free[currency] || 0),
        locked: String(balance.used[currency] || 0),
      }));
  }

  async placeOrder(order: OrderRequest): Promise<Order> {
    const ccxtOrder = await this.exchange!.createOrder(
      order.symbol,
      order.type,
      order.side,
      parseFloat(order.amount),
      order.price ? parseFloat(order.price) : undefined,
      {
        stopPrice: order.stopPrice ? parseFloat(order.stopPrice) : undefined,
        timeInForce: order.timeInForce,
        reduceOnly: order.reduceOnly,
      }
    );

    return this.mapCcxtOrder(ccxtOrder);
  }

  subscribeToTicker(symbol: string, callback: TickerCallback): void {
    const stream = `${symbol.toLowerCase().replace('/', '')}@ticker`;
    this.subscribe(stream, callback);

    // Send subscription message
    this.ws?.send(
      JSON.stringify({
        method: 'SUBSCRIBE',
        params: [stream],
        id: Date.now(),
      })
    );
  }
}
```

**Testnet Setup:**

- Binance Testnet: https://testnet.binance.vision/
- Get testnet API keys from faucet

**Test Checklist:**

- [ ] Connect to testnet
- [ ] Fetch balances
- [ ] Get ticker for BTC/USDT
- [ ] Place limit order
- [ ] Cancel order
- [ ] Get order history
- [ ] WebSocket ticker updates
- [ ] WebSocket reconnects on disconnect

---

### Task T3-104: Coinbase Integration [HIGH]

**File:** `src/main/trading/exchanges/coinbase.ts`

**Requirements:**

1. Implement BaseExchange for Coinbase
2. Use ccxt for REST API
3. Support Coinbase Advanced Trade API
4. Implement WebSocket for real-time data
5. Handle OAuth or API key auth

**Implementation:**

```typescript
export class CoinbaseExchange extends BaseExchange {
  readonly exchangeId = 'coinbase' as const;
  readonly name = 'Coinbase';

  private exchange: ccxt.coinbase | null = null;

  async connect(credentials: ExchangeCredentials): Promise<void> {
    this.exchange = new ccxt.coinbase({
      apiKey: credentials.apiKey,
      secret: credentials.apiSecret,
      enableRateLimit: true,
    });

    await this.exchange.loadMarkets();
    this.emit('connected');
  }

  // ... implement all BaseExchange methods
}
```

**Test Checklist:**

- [ ] Connect with API key
- [ ] Fetch balances
- [ ] Get ticker
- [ ] Place order (sandbox)
- [ ] Cancel order
- [ ] WebSocket works

---

### Task T3-105: Charles Schwab Integration [HIGH]

**File:** `src/main/trading/exchanges/schwab.ts`

**Requirements:**

1. Implement BaseExchange for Schwab
2. OAuth 2.0 authentication flow
3. REST API for trading (no ccxt)
4. WebSocket for real-time quotes
5. Support stocks, options, ETFs

**Note:** Charles Schwab acquired TD Ameritrade. Use Schwab's new API.

**Implementation:**

```typescript
export class SchwabExchange extends BaseExchange {
  readonly exchangeId = 'schwab' as const;
  readonly name = 'Charles Schwab';

  private accessToken: string | null = null;
  private refreshToken: string | null = null;

  async connect(credentials: ExchangeCredentials): Promise<void> {
    // Schwab uses OAuth - need to handle browser flow
    // Store tokens in keychain
  }

  async authorize(): Promise<void> {
    // Open browser to Schwab OAuth URL
    // Handle callback with code
    // Exchange code for tokens
  }

  async getBalances(): Promise<Balance[]> {
    const response = await fetch('https://api.schwabapi.com/trader/v1/accounts', {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    // Parse and return balances
  }

  async placeOrder(order: OrderRequest): Promise<Order> {
    // Schwab-specific order format
    const schwabOrder = {
      orderType: this.mapOrderType(order.type),
      session: 'NORMAL',
      duration: 'DAY',
      orderStrategyType: 'SINGLE',
      orderLegCollection: [
        {
          instruction: order.side.toUpperCase(),
          quantity: parseFloat(order.amount),
          instrument: {
            symbol: order.symbol,
            assetType: 'EQUITY', // or OPTION
          },
        },
      ],
      price: order.price,
    };

    // POST to Schwab API
  }
}
```

**OAuth Setup:**

1. Register app at Schwab Developer Portal
2. Get client_id and client_secret
3. Implement OAuth 2.0 flow with PKCE

**Test Checklist:**

- [ ] OAuth flow completes
- [ ] Tokens stored in keychain
- [ ] Token refresh works
- [ ] Fetch account balances
- [ ] Get stock quotes
- [ ] Place paper trade
- [ ] Cancel order

---

### Task T3-106: MetaApi MT4/MT5 Integration [MEDIUM]

**File:** `src/main/trading/exchanges/metaapi.ts`

**Requirements:**

1. Connect to MetaApi.cloud service
2. Support MT4 and MT5 accounts
3. Execute forex trades
4. Real-time price streaming
5. Position management

**Implementation:**

```typescript
import MetaApi from 'metaapi.cloud-sdk';

export class MetaApiExchange extends BaseExchange {
  readonly exchangeId = 'metatrader' as const;
  readonly name = 'MetaTrader';

  private api: MetaApi | null = null;
  private account: MetatraderAccount | null = null;
  private connection: StreamingMetaApiConnection | null = null;

  async connect(credentials: ExchangeCredentials): Promise<void> {
    const { apiKey, additionalConfig } = credentials;
    const accountId = additionalConfig?.accountId as string;

    this.api = new MetaApi(apiKey);
    this.account = await this.api.metatraderAccountApi.getAccount(accountId);

    // Wait for account to deploy
    await this.account.waitDeployed();

    // Connect to account
    this.connection = this.account.getStreamingConnection();
    await this.connection.connect();
    await this.connection.waitSynchronized();

    this.emit('connected');
  }

  async getBalances(): Promise<Balance[]> {
    const accountInfo = await this.connection!.terminalState.accountInformation;
    return [
      {
        currency: accountInfo.currency,
        total: String(accountInfo.balance),
        available: String(accountInfo.freeMargin),
        locked: String(accountInfo.margin),
      },
    ];
  }

  async getPositions(): Promise<Position[]> {
    const positions = this.connection!.terminalState.positions;
    return positions.map((p) => ({
      exchangeId: this.exchangeId,
      symbol: p.symbol,
      side: p.type === 'POSITION_TYPE_BUY' ? 'long' : 'short',
      size: String(p.volume),
      entryPrice: String(p.openPrice),
      currentPrice: String(p.currentPrice),
      unrealizedPnL: String(p.unrealizedProfit),
      unrealizedPnLPercent: String((p.unrealizedProfit / (p.openPrice * p.volume)) * 100),
    }));
  }

  async placeOrder(order: OrderRequest): Promise<Order> {
    const tradeResult = await this.connection!.createMarketBuyOrder(
      order.symbol,
      parseFloat(order.amount),
      order.stopPrice ? parseFloat(order.stopPrice) : undefined,
      order.price ? parseFloat(order.price) : undefined
    );
    // Map result to Order
  }
}
```

**MetaApi Setup:**

1. Create account at metaapi.cloud
2. Get API token
3. Connect MT4/MT5 account to MetaApi

**Test Checklist:**

- [ ] Connect to MetaApi
- [ ] Fetch account balance
- [ ] Get open positions
- [ ] Place market order (demo)
- [ ] Place limit order
- [ ] Close position
- [ ] Real-time price updates

---

### Task T3-107: Trading Manager [HIGH]

**File:** `src/main/trading/manager.ts`

**Requirements:**

1. Singleton manager for all exchanges
2. Load/save exchange credentials
3. Aggregate operations across exchanges
4. Handle connection lifecycle
5. Emit events for UI updates

```typescript
export class TradingManager extends EventEmitter {
  private static instance: TradingManager | null = null;
  private exchanges: Map<ExchangeId, BaseExchange> = new Map();
  private initialized = false;

  static getInstance(): TradingManager;

  async initialize(): Promise<void> {
    // Load saved credentials from keychain
    // Connect to each configured exchange
  }

  async addExchange(credentials: ExchangeCredentials): Promise<void> {
    const exchange = this.createExchange(credentials.exchangeId);
    await exchange.connect(credentials);
    this.exchanges.set(credentials.exchangeId, exchange);
    // Save credentials to keychain
  }

  async removeExchange(exchangeId: ExchangeId): Promise<void>;

  getExchange(exchangeId: ExchangeId): BaseExchange | undefined;

  async getAggregatedBalance(): Promise<AggregatedBalance> {
    const balances: Record<ExchangeId, Balance[]> = {};
    let totalUSD = new Decimal(0);

    for (const [id, exchange] of this.exchanges) {
      const exchangeBalances = await exchange.getBalances();
      balances[id] = exchangeBalances;

      // Convert to USD
      for (const balance of exchangeBalances) {
        const usdValue = await this.convertToUSD(balance.currency, balance.total);
        totalUSD = totalUSD.plus(usdValue);
      }
    }

    return {
      totalUSD: totalUSD.toFixed(2),
      byExchange: balances,
      byCurrency: this.aggregateByCurrency(balances),
      lastUpdated: Date.now(),
    };
  }

  async getAllPositions(): Promise<Position[]>;
  async placeOrder(order: OrderRequest): Promise<Order>;
  async cancelOrder(exchangeId: ExchangeId, orderId: string, symbol: string): Promise<boolean>;
}
```

**Test Checklist:**

- [ ] Initializes correctly
- [ ] Adds exchange
- [ ] Removes exchange
- [ ] Aggregates balances
- [ ] Places order to correct exchange
- [ ] Credentials persisted

---

### Task T3-108: Real-Time Price Streaming [HIGH]

**File:** `src/main/trading/websocket.ts`

**Requirements:**

1. Unified WebSocket manager
2. Subscribe to multiple symbols across exchanges
3. Normalize price data format
4. Handle reconnection
5. Emit price updates via IPC

```typescript
export class PriceStreamManager extends EventEmitter {
  private subscriptions: Map<string, Set<ExchangeId>> = new Map();

  async subscribe(symbol: string, exchanges?: ExchangeId[]): Promise<void> {
    // Subscribe on each exchange
    for (const exchangeId of exchanges || Array.from(this.exchanges.keys())) {
      const exchange = this.tradingManager.getExchange(exchangeId);
      exchange?.subscribeToTicker(symbol, (ticker) => {
        this.emit('price', { exchangeId, ticker });
        this.sendToRenderer('trading:price-update', { exchangeId, ticker });
      });
    }
  }

  async unsubscribe(symbol: string, exchanges?: ExchangeId[]): Promise<void>;

  getSubscriptions(): Map<string, Set<ExchangeId>>;
}
```

**Test Checklist:**

- [ ] Subscribe to BTC/USDT
- [ ] Receive real-time updates
- [ ] Updates sent to renderer
- [ ] Reconnects on disconnect
- [ ] Unsubscribe works

---

### Task T3-109: Price Alerts [MEDIUM]

**File:** `src/main/trading/alerts.ts`

**Requirements:**

1. Create price alerts
2. Persist alerts to disk
3. Monitor prices via WebSocket
4. Trigger alerts (voice, SMS, push)
5. Cooldown to prevent spam

```typescript
export class PriceAlertManager extends EventEmitter {
  private alerts: Map<string, PriceAlert> = new Map();
  private cooldowns: Map<string, number> = new Map();

  async createAlert(
    alert: Omit<PriceAlert, 'id' | 'triggered' | 'createdAt'>
  ): Promise<PriceAlert> {
    const newAlert: PriceAlert = {
      ...alert,
      id: uuid(),
      triggered: false,
      createdAt: Date.now(),
    };

    this.alerts.set(newAlert.id, newAlert);
    await this.saveAlerts();
    this.subscribeToPrice(alert.symbol);

    return newAlert;
  }

  async deleteAlert(alertId: string): Promise<boolean>;

  async getAlerts(): Promise<PriceAlert[]>;

  private checkAlert(alert: PriceAlert, currentPrice: string): boolean {
    const target = new Decimal(alert.targetPrice);
    const current = new Decimal(currentPrice);

    switch (alert.condition) {
      case 'above':
        return current.gte(target);
      case 'below':
        return current.lte(target);
      case 'crosses':
        return this.hasCrossed(alert, current);
    }
  }

  private async triggerAlert(alert: PriceAlert): Promise<void> {
    // Check cooldown
    const lastTrigger = this.cooldowns.get(alert.id);
    if (lastTrigger && Date.now() - lastTrigger < 300000) return; // 5 min cooldown

    alert.triggered = true;
    alert.triggeredAt = Date.now();
    this.cooldowns.set(alert.id, Date.now());

    // Notify
    for (const method of alert.notifyMethod) {
      switch (method) {
        case 'voice':
          await this.speakAlert(alert);
          break;
        case 'sms':
          await this.sendSMS(alert);
          break;
        case 'push':
          await this.sendPush(alert);
          break;
      }
    }

    this.emit('alert-triggered', alert);
  }
}
```

**Test Checklist:**

- [ ] Create alert
- [ ] Alert triggers correctly
- [ ] Cooldown prevents spam
- [ ] Voice notification works
- [ ] Alerts persist on restart

---

### Task T3-110: Portfolio Tracker [HIGH]

**File:** `src/main/trading/portfolio.ts`

**Requirements:**

1. Track all positions across exchanges
2. Calculate P&L (realized and unrealized)
3. Historical performance tracking
4. Portfolio breakdown by asset class
5. Risk metrics (exposure, concentration)

```typescript
export class PortfolioTracker extends EventEmitter {
  private snapshots: PortfolioSnapshot[] = [];

  async getPortfolio(): Promise<Portfolio> {
    const balances = await this.tradingManager.getAggregatedBalance();
    const positions = await this.tradingManager.getAllPositions();

    return {
      totalValue: balances.totalUSD,
      balances,
      positions,
      unrealizedPnL: this.calculateUnrealizedPnL(positions),
      dayChange: await this.getDayChange(),
      allocation: this.calculateAllocation(balances),
    };
  }

  async getPerformance(period: '1d' | '1w' | '1m' | '3m' | '1y' | 'all'): Promise<PerformanceData> {
    const snapshots = await this.getSnapshots(period);
    return {
      startValue: snapshots[0]?.totalValue || '0',
      endValue: snapshots[snapshots.length - 1]?.totalValue || '0',
      change: this.calculateChange(snapshots),
      changePercent: this.calculateChangePercent(snapshots),
      highValue: this.getHighValue(snapshots),
      lowValue: this.getLowValue(snapshots),
      chart: snapshots.map((s) => ({ timestamp: s.timestamp, value: s.totalValue })),
    };
  }

  async takeSnapshot(): Promise<void> {
    const portfolio = await this.getPortfolio();
    this.snapshots.push({
      timestamp: Date.now(),
      totalValue: portfolio.totalValue,
      positions: portfolio.positions,
    });
    await this.saveSnapshots();
  }

  // Schedule hourly snapshots
  startSnapshotScheduler(): void {
    setInterval(() => this.takeSnapshot(), 3600000);
  }
}
```

**Test Checklist:**

- [ ] Get aggregated portfolio
- [ ] Calculate P&L correctly
- [ ] Performance over time period
- [ ] Snapshot scheduler works
- [ ] Allocation breakdown correct

---

### Task T3-111: Trading History [MEDIUM]

**File:** `src/main/trading/history.ts`

**Requirements:**

1. Fetch trade history from all exchanges
2. Store locally for fast access
3. Calculate statistics (win rate, avg profit, etc.)
4. Export to CSV

```typescript
export class TradeHistoryManager {
  async getHistory(options: HistoryOptions): Promise<Trade[]> {
    const allTrades: Trade[] = [];

    for (const [id, exchange] of this.exchanges) {
      const trades = await exchange.getOrderHistory(options.symbol, options.limit);
      allTrades.push(...trades.map((t) => ({ ...t, exchangeId: id })));
    }

    return allTrades.sort((a, b) => b.createdAt - a.createdAt);
  }

  async getStatistics(period?: string): Promise<TradeStatistics> {
    const trades = await this.getHistory({ period });
    const closedTrades = trades.filter((t) => t.status === 'closed');

    return {
      totalTrades: closedTrades.length,
      winRate: this.calculateWinRate(closedTrades),
      avgProfit: this.calculateAvgProfit(closedTrades),
      totalProfit: this.calculateTotalProfit(closedTrades),
      largestWin: this.getLargestWin(closedTrades),
      largestLoss: this.getLargestLoss(closedTrades),
    };
  }

  async exportCSV(filepath: string, options?: HistoryOptions): Promise<void>;
}
```

**Test Checklist:**

- [ ] Fetch history from exchange
- [ ] Calculate win rate
- [ ] Export to CSV works

---

### Task T3-112: Trading Agent Tools [HIGH]

**File:** `src/main/agent/tools/trading.ts`

**Tools to Implement/Enhance:**

| Tool                      | Description                         |
| ------------------------- | ----------------------------------- |
| `trading_get_balance`     | Get balance for exchange or all     |
| `trading_get_portfolio`   | Get aggregated portfolio            |
| `trading_get_positions`   | Get open positions                  |
| `trading_get_price`       | Get current price                   |
| `trading_place_order`     | Place order (requires confirmation) |
| `trading_cancel_order`    | Cancel open order                   |
| `trading_get_orders`      | Get open orders                     |
| `trading_get_history`     | Get trade history                   |
| `trading_set_alert`       | Create price alert                  |
| `trading_get_alerts`      | List price alerts                   |
| `trading_delete_alert`    | Delete alert                        |
| `trading_get_performance` | Get portfolio performance           |

**Voice Confirmation for Orders:**

```typescript
execute: async (params) => {
  const order = params as OrderRequest;

  // Estimate cost
  const ticker = await this.getTicker(order.symbol);
  const estimatedCost = new Decimal(order.amount).times(ticker.last);

  // Require voice confirmation for orders > $100
  if (estimatedCost.gt(100)) {
    const confirmed = await this.requestVoiceConfirmation(
      `Place ${order.side} order for ${order.amount} ${order.symbol} at approximately $${estimatedCost.toFixed(2)}?`
    );
    if (!confirmed) {
      return { success: false, error: 'Order cancelled by user' };
    }
  }

  // Execute order
  const result = await this.tradingManager.placeOrder(order);

  // Log to Obsidian brain
  await this.logTrade(result);

  return { success: true, data: result };
};
```

**Test Checklist:**

- [ ] All tools registered
- [ ] Voice confirmation works
- [ ] Trades logged to memory
- [ ] Error handling robust

---

## Phase 6: Finance & Banking

### Task T3-201: TrueLayer OAuth Setup [HIGH]

**File:** `src/main/finance/truelayer.ts` (ENHANCE)

**Requirements:**

1. Complete OAuth 2.0 flow
2. Store tokens securely
3. Handle token refresh (90-day expiry)
4. Support UK banks (TSB specifically)

**Implementation:**

```typescript
export class TrueLayerClient {
  private clientId: string;
  private clientSecret: string;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;

  async authorize(): Promise<void> {
    // Generate state and PKCE challenge
    const state = uuid();
    const codeVerifier = this.generateCodeVerifier();
    const codeChallenge = await this.generateCodeChallenge(codeVerifier);

    // Build authorization URL
    const authUrl = new URL('https://auth.truelayer.com/');
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', this.clientId);
    authUrl.searchParams.set('redirect_uri', 'http://localhost:8888/callback');
    authUrl.searchParams.set('scope', 'accounts balance transactions offline_access');
    authUrl.searchParams.set('providers', 'uk-ob-all uk-oauth-all');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');

    // Open browser and wait for callback
    await shell.openExternal(authUrl.toString());
    const code = await this.waitForCallback(state);

    // Exchange code for tokens
    await this.exchangeCode(code, codeVerifier);
  }

  async refreshAccessToken(): Promise<void> {
    const response = await fetch('https://auth.truelayer.com/connect/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: this.refreshToken!,
      }),
    });

    const data = await response.json();
    this.accessToken = data.access_token;
    this.refreshToken = data.refresh_token;
    await this.saveTokens();
  }
}
```

**TrueLayer Setup:**

1. Register at https://console.truelayer.com/
2. Create application (sandbox first)
3. Get client_id and client_secret
4. Configure redirect URI

**Test Checklist:**

- [ ] OAuth flow completes
- [ ] Tokens stored in keychain
- [ ] Token refresh works
- [ ] Handles expired tokens

---

### Task T3-202: Bank Account Connection [HIGH]

**File:** `src/main/finance/truelayer.ts`

**Requirements:**

1. List connected accounts
2. Get account details
3. Support multiple banks
4. Handle disconnection

```typescript
async getAccounts(): Promise<BankAccount[]> {
  const response = await this.fetch('/data/v1/accounts');
  return response.results.map(acc => ({
    id: acc.account_id,
    type: acc.account_type,
    displayName: acc.display_name,
    currency: acc.currency,
    provider: acc.provider.display_name,
    accountNumber: acc.account_number?.number,
    sortCode: acc.account_number?.sort_code,
  }));
}

async getAccountBalance(accountId: string): Promise<AccountBalance> {
  const response = await this.fetch(`/data/v1/accounts/${accountId}/balance`);
  return {
    current: response.results[0].current,
    available: response.results[0].available,
    currency: response.results[0].currency,
    updatedAt: response.results[0].update_timestamp,
  };
}
```

**Test Checklist:**

- [ ] List accounts
- [ ] Get account balance
- [ ] Multiple accounts work

---

### Task T3-203: Transaction History [HIGH]

**File:** `src/main/finance/transactions.ts`

**Requirements:**

1. Fetch transactions with pagination
2. Support date range filtering
3. Cache transactions locally
4. Auto-categorize transactions

```typescript
export class TransactionManager {
  async getTransactions(options: TransactionOptions): Promise<Transaction[]> {
    const { accountId, from, to, limit } = options;

    // Check cache first
    const cached = await this.getFromCache(accountId, from, to);
    if (cached) return cached;

    // Fetch from TrueLayer
    const response = await this.trueLayer.fetch(`/data/v1/accounts/${accountId}/transactions`, {
      from: from.toISOString(),
      to: to.toISOString(),
    });

    const transactions = response.results.map((t) => ({
      id: t.transaction_id,
      accountId,
      timestamp: new Date(t.timestamp),
      amount: t.amount,
      currency: t.currency,
      type: t.transaction_type,
      category: t.transaction_category,
      description: t.description,
      merchantName: t.merchant_name,
      running_balance: t.running_balance?.amount,
    }));

    // Cache and return
    await this.cacheTransactions(accountId, transactions);
    return transactions;
  }

  async categorize(transaction: Transaction): Promise<string> {
    // Use LLM to categorize if not already categorized
    if (transaction.category) return transaction.category;

    const prompt = `Categorize this transaction:
    Description: ${transaction.description}
    Merchant: ${transaction.merchantName}
    Amount: ${transaction.amount} ${transaction.currency}
    
    Categories: Food, Transport, Shopping, Bills, Entertainment, Income, Transfer, Other`;

    const category = await this.llm.complete(prompt);
    return category.trim();
  }
}
```

**Test Checklist:**

- [ ] Fetch last 30 days
- [ ] Pagination works
- [ ] Cache works
- [ ] Categorization works

---

### Task T3-204: Spending Insights [MEDIUM]

**File:** `src/main/finance/insights.ts`

**Requirements:**

1. Spending by category
2. Spending trends over time
3. Unusual spending detection
4. Income vs expenses

```typescript
export class SpendingInsights {
  async getSpendingByCategory(period: 'week' | 'month' | 'year'): Promise<CategorySpending[]> {
    const transactions = await this.getTransactionsForPeriod(period);

    const byCategory = new Map<string, Decimal>();
    for (const t of transactions) {
      if (t.amount < 0) {
        // Only expenses
        const category = await this.categorize(t);
        const current = byCategory.get(category) || new Decimal(0);
        byCategory.set(category, current.plus(Math.abs(t.amount)));
      }
    }

    return Array.from(byCategory.entries())
      .map(([category, amount]) => ({ category, amount: amount.toFixed(2) }))
      .sort((a, b) => parseFloat(b.amount) - parseFloat(a.amount));
  }

  async getMonthlyTrend(months: number = 6): Promise<MonthlyTrend[]> {
    const trends: MonthlyTrend[] = [];

    for (let i = 0; i < months; i++) {
      const month = subMonths(new Date(), i);
      const transactions = await this.getTransactionsForMonth(month);

      const income = transactions.filter((t) => t.amount > 0).reduce((sum, t) => sum + t.amount, 0);

      const expenses = transactions
        .filter((t) => t.amount < 0)
        .reduce((sum, t) => sum + Math.abs(t.amount), 0);

      trends.push({
        month: format(month, 'MMM yyyy'),
        income,
        expenses,
        net: income - expenses,
      });
    }

    return trends.reverse();
  }

  async detectUnusualSpending(): Promise<UnusualSpending[]> {
    // Compare current week to average
    const currentWeek = await this.getSpendingByCategory('week');
    const avgWeek = await this.getAverageWeeklySpending();

    return currentWeek
      .filter((c) => {
        const avg = avgWeek.find((a) => a.category === c.category);
        return avg && parseFloat(c.amount) > parseFloat(avg.amount) * 1.5;
      })
      .map((c) => ({
        category: c.category,
        current: c.amount,
        average: avgWeek.find((a) => a.category === c.category)!.amount,
        percentOver:
          (parseFloat(c.amount) /
            parseFloat(avgWeek.find((a) => a.category === c.category)!.amount) -
            1) *
          100,
      }));
  }
}
```

**Test Checklist:**

- [ ] Spending by category works
- [ ] Monthly trend correct
- [ ] Unusual spending detected

---

### Task T3-205: Budget Tracking [LOW]

**File:** `src/main/finance/budgets.ts`

**Requirements:**

1. Set budgets per category
2. Track spending against budget
3. Alert when approaching limit
4. Monthly reset

```typescript
export class BudgetManager {
  private budgets: Map<string, Budget> = new Map();

  async setBudget(category: string, monthlyLimit: number): Promise<Budget> {
    const budget: Budget = {
      id: uuid(),
      category,
      monthlyLimit,
      spent: 0,
      remaining: monthlyLimit,
      period: format(new Date(), 'yyyy-MM'),
    };

    this.budgets.set(category, budget);
    await this.saveBudgets();
    return budget;
  }

  async checkBudget(category: string): Promise<BudgetStatus> {
    const budget = this.budgets.get(category);
    if (!budget) return { exists: false };

    const spent = await this.calculateSpent(category);
    const percentUsed = (spent / budget.monthlyLimit) * 100;

    return {
      exists: true,
      budget: budget.monthlyLimit,
      spent,
      remaining: budget.monthlyLimit - spent,
      percentUsed,
      status: percentUsed >= 100 ? 'over' : percentUsed >= 80 ? 'warning' : 'ok',
    };
  }

  async checkAllBudgets(): Promise<BudgetStatus[]> {
    return Promise.all(Array.from(this.budgets.keys()).map((cat) => this.checkBudget(cat)));
  }
}
```

**Test Checklist:**

- [ ] Set budget works
- [ ] Tracking is accurate
- [ ] Warning at 80%
- [ ] Monthly reset works

---

### Task T3-206: Voice Purchase Confirmation [HIGH]

**File:** `src/main/finance/voice-auth.ts`

**Requirements:**

1. Voice confirmation for financial actions
2. Speaker verification (matches enrolled user)
3. Confirmation phrase detection
4. Timeout handling

```typescript
export class VoicePurchaseAuth {
  async requestConfirmation(action: string, amount: number): Promise<boolean> {
    // Speak the request
    await this.tts.speak(
      `This will ${action} for ${amount} pounds. Please say "confirm" to proceed.`
    );

    // Listen for response with 10 second timeout
    const response = await this.stt.listen({ timeout: 10000 });

    // Verify speaker is enrolled user
    const speaker = await this.speakerIdentifier.identify(response.audio);
    if (!speaker.isEnrolledUser) {
      await this.tts.speak("I don't recognize your voice. Action cancelled.");
      return false;
    }

    // Check for confirmation phrase
    const text = response.text.toLowerCase();
    if (text.includes('confirm') || text.includes('yes') || text.includes('proceed')) {
      await this.tts.speak('Confirmed. Processing now.');
      return true;
    }

    await this.tts.speak('Action cancelled.');
    return false;
  }
}
```

**Test Checklist:**

- [ ] Confirmation prompt speaks
- [ ] "Confirm" detected
- [ ] Speaker verified
- [ ] Timeout works
- [ ] Cancel works

---

### Task T3-207: Finance Agent Tools [HIGH]

**File:** `src/main/agent/tools/finance.ts`

**Tools to Implement/Enhance:**

| Tool                       | Description                      |
| -------------------------- | -------------------------------- |
| `finance_get_accounts`     | List connected bank accounts     |
| `finance_get_balance`      | Get account balance              |
| `finance_get_transactions` | Get recent transactions          |
| `finance_get_spending`     | Get spending by category         |
| `finance_set_budget`       | Set category budget              |
| `finance_check_budget`     | Check budget status              |
| `finance_get_insights`     | Get spending insights            |
| `finance_get_trend`        | Get monthly income/expense trend |

**Test Checklist:**

- [ ] All tools registered
- [ ] Works with real TrueLayer data
- [ ] Error handling robust

---

## Task Summary

| ID     | Task                           | Phase | Priority | Est. Hours |
| ------ | ------------------------------ | ----- | -------- | ---------- |
| T3-101 | Trading types & base interface | 5     | HIGH     | 4          |
| T3-102 | Base exchange interface        | 5     | HIGH     | 4          |
| T3-103 | Binance integration            | 5     | HIGH     | 8          |
| T3-104 | Coinbase integration           | 5     | HIGH     | 6          |
| T3-105 | Charles Schwab integration     | 5     | HIGH     | 8          |
| T3-106 | MetaApi MT4/MT5 integration    | 5     | MEDIUM   | 6          |
| T3-107 | Trading manager                | 5     | HIGH     | 6          |
| T3-108 | Real-time price streaming      | 5     | HIGH     | 6          |
| T3-109 | Price alerts                   | 5     | MEDIUM   | 4          |
| T3-110 | Portfolio tracker              | 5     | HIGH     | 6          |
| T3-111 | Trading history                | 5     | MEDIUM   | 4          |
| T3-112 | Trading agent tools            | 5     | HIGH     | 6          |
| T3-201 | TrueLayer OAuth setup          | 6     | HIGH     | 4          |
| T3-202 | Bank account connection        | 6     | HIGH     | 4          |
| T3-203 | Transaction history            | 6     | HIGH     | 4          |
| T3-204 | Spending insights              | 6     | MEDIUM   | 4          |
| T3-205 | Budget tracking                | 6     | LOW      | 4          |
| T3-206 | Voice purchase confirmation    | 6     | HIGH     | 4          |
| T3-207 | Finance agent tools            | 6     | HIGH     | 4          |

**Total Estimated Hours: 96**

---

## Quality Gates

Before marking ANY task DONE:

1. [ ] `npm run typecheck` passes
2. [ ] `npm run lint` passes
3. [ ] Tested on TESTNET/SANDBOX (never real funds)
4. [ ] API keys stored in keychain (never in code)
5. [ ] All trades logged to Obsidian brain
6. [ ] Tool registered in index.ts
7. [ ] IPC handlers added
8. [ ] Error handling is robust
9. [ ] Voice confirmation for orders > $100

---

## Execution Order

1. **First**: T3-101, T3-102 (Types and base interface)
2. **Then**: T3-103 (Binance - most common)
3. **Then**: T3-107, T3-108 (Manager and streaming)
4. **Then**: T3-112 (Trading tools)
5. **Then**: T3-104, T3-105, T3-106 (Other exchanges)
6. **Then**: T3-109, T3-110, T3-111 (Alerts, portfolio, history)
7. **Then**: T3-201, T3-202, T3-203 (TrueLayer basics)
8. **Then**: T3-206, T3-207 (Voice auth and tools)
9. **Finally**: T3-204, T3-205 (Insights and budgets)

---

## Notes

- **ALWAYS use testnet/sandbox for development**
- Binance Testnet: https://testnet.binance.vision/
- Coinbase Sandbox: https://sandbox.coinbase.com/
- TrueLayer Sandbox: https://console.truelayer.com/ (sandbox mode)
- Charles Schwab requires production app for paper trading
- MetaApi has demo accounts
- All credentials in OS keychain via keytar
- Order confirmation required for amounts > $100
