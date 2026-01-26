# Go Backtesting Backend - Research Brief for Perplexity

## Project Context

I am building an **event-driven backtesting engine in Go** for an autonomous AI trading system called Atlas. This backend integrates with an Electron/TypeScript frontend via WebSocket and handles high-frequency backtesting with 70B+ historical datapoints.

---

## What Has Been Built (TypeScript Frontend)

### 1. Autonomous Trading Agent (`autonomous-agent.ts`)
- State machine with states: `idle`, `researching`, `analyzing`, `backtesting`, `trading`, `paused`, `emergency_stop`
- Perplexity API integration for AI-powered market research
- Signal validation through backtesting before execution
- Position sizing with Kelly Criterion, Fixed Fractional, and Volatility-adjusted methods
- Kill switch triggers (max drawdown, daily loss, consecutive losses, volatility spike)
- User feedback learning loop to improve strategies over time

### 2. Signal Aggregator (`signal-aggregator.ts`)
- Multi-source signal ingestion (technical, sentiment, AI research, on-chain)
- Technical indicators: RSI, MACD, Bollinger Bands, VWAP, ATR, Volume Profile
- Sentiment analysis from social/news sources
- Weighted consensus scoring across signal sources
- Signal strength and confidence calculation

### 3. Risk Manager (`risk-manager.ts`)
- Position sizing algorithms (Kelly, Fixed Fractional, Volatility-adjusted)
- Dynamic stop-loss management (fixed, trailing, ATR-based)
- MEV protection with gas price monitoring and private mempool detection
- Portfolio-level risk limits (max positions, correlation limits, sector exposure)
- Kill switch with multiple trigger conditions

### 4. Go Backend Client (`go-backend-client.ts`)
- WebSocket connection to `ws://localhost:8080/ws`
- Request/response pattern with UUID correlation
- Auto-reconnect with exponential backoff
- HTTP endpoints for large data transfers (historical data, backtest results)
- Real-time event streaming for live trading

### 5. IPC Handlers (23 methods)
```typescript
// Autonomous trading control
autonomous:start, autonomous:stop, autonomous:status, autonomous:config:get/set

// Kill switch
killswitch:trigger, killswitch:status, killswitch:reset

// Backtesting
backtest:run, backtest:status, backtest:results, backtest:cancel

// Signals
signals:list, signals:subscribe, signals:unsubscribe

// Risk management
risk:limits:get/set, risk:metrics

// Feedback learning
feedback:submit, feedback:history

// Backend connection
backend:connect, backend:disconnect, backend:status
```

---

## What Needs to Be Built (Go Backend)

### Architecture Overview
```
trading-backend/
├── cmd/server/main.go           # Entry point, CLI flags
├── internal/
│   ├── backtester/
│   │   ├── engine.go            # Core event-driven engine
│   │   ├── events.go            # Event types and queue
│   │   ├── simulator.go         # Portfolio/wallet simulation
│   │   ├── orderbook.go         # Order book simulation
│   │   └── metrics.go           # Performance metrics calculation
│   ├── blockchain/
│   │   ├── solana.go            # Solana RPC + WebSocket
│   │   ├── evm.go               # EVM chains (ETH, BSC, Arbitrum)
│   │   ├── block_tracker.go     # Real-time block monitoring
│   │   └── mempool.go           # Mempool monitoring for MEV
│   ├── data/
│   │   ├── store.go             # Historical data storage
│   │   ├── loader.go            # Data loading/streaming
│   │   └── aggregator.go        # OHLCV aggregation
│   ├── signals/
│   │   ├── aggregator.go        # Signal source management
│   │   ├── parser.go            # Signal format parsing
│   │   └── validator.go         # Signal validation
│   ├── execution/
│   │   ├── executor.go          # Order execution engine
│   │   ├── slippage.go          # Slippage modeling
│   │   └── fees.go              # Fee calculation
│   └── api/
│       ├── server.go            # HTTP/WebSocket server
│       ├── handlers.go          # Request handlers
│       ├── routes.go            # Route definitions
│       └── middleware.go        # Auth, logging, rate limiting
├── pkg/
│   ├── types/                   # Shared type definitions
│   ├── utils/                   # Utility functions
│   └── config/                  # Configuration management
├── data/                        # Historical data storage
└── go.mod
```

---

## Research Questions for Perplexity

### 1. Event-Driven Backtesting Architecture

**Question:** What are the best practices for building a high-performance event-driven backtesting engine in Go that can process 70B+ datapoints efficiently?

**Specific areas to research:**
- Event queue implementations (priority queue vs channel-based)
- Memory-mapped file access for large historical datasets
- Goroutine pooling for parallel event processing
- Lock-free data structures for order book simulation
- Comparison: Vectorized backtesting vs event-driven (when to use which)

**Reference implementations to study:**
- QuantConnect's LEAN engine architecture
- Zipline's event system
- Backtrader's cerebro pattern
- VectorBT's vectorized approach

### 2. Block-Accurate Simulation for Crypto

**Question:** How do professional trading firms implement block-accurate backtesting for cryptocurrency that accounts for MEV, slippage, and on-chain settlement delays?

**Specific areas to research:**
- Solana slot timing and transaction ordering
- EVM block gas mechanics and transaction priority
- MEV (Maximal Extractable Value) simulation
  - Sandwich attack modeling
  - Front-running detection
  - Backrunning opportunities
- Realistic slippage models for DEX liquidity
- Order book reconstruction from on-chain data

### 3. Historical Data Management at Scale

**Question:** What are the most efficient data storage and retrieval patterns for 70B+ tick-level cryptocurrency datapoints in Go?

**Specific areas to research:**
- Time-series databases comparison (TimescaleDB, QuestDB, InfluxDB, ClickHouse)
- Memory-mapped files vs database for backtesting
- Data compression techniques for tick data (delta encoding, columnar storage)
- Streaming data loading patterns to avoid memory exhaustion
- Partitioning strategies by time/symbol

### 4. Realistic Slippage and Market Impact Modeling

**Question:** What are the state-of-the-art slippage and market impact models used by quantitative trading firms?

**Specific areas to research:**
- Almgren-Chriss market impact model
- Square-root impact model
- Kyle's lambda model
- Volume-weighted slippage estimation
- DEX-specific slippage (AMM curves, liquidity depth)
- Order book simulation with realistic fill probability

### 5. WebSocket API Design for Real-Time Trading

**Question:** What are the best practices for designing a WebSocket API that handles both backtesting commands and real-time trading signals with low latency?

**Specific areas to research:**
- Message protocol design (JSON vs Protocol Buffers vs MessagePack)
- Connection multiplexing and channel management
- Heartbeat and reconnection strategies
- Backpressure handling for fast producers
- Request/response correlation patterns

### 6. Performance Optimization in Go

**Question:** What Go-specific optimizations are critical for building a low-latency trading system?

**Specific areas to research:**
- Memory allocation patterns (sync.Pool, arena allocation)
- Garbage collection tuning for real-time systems
- SIMD operations via Go assembly
- CPU cache-friendly data structures
- Profiling tools (pprof, trace) for trading systems

### 7. Kill Switch and Risk Management Implementation

**Question:** How do professional trading systems implement kill switches and circuit breakers that can halt trading within milliseconds?

**Specific areas to research:**
- Atomic operations for instant state changes
- Hardware-level timing considerations
- Distributed kill switch coordination
- Recovery procedures after kill switch activation
- Regulatory requirements for automated trading controls

### 8. Monte Carlo and Walk-Forward Validation

**Question:** What are the best implementations of Monte Carlo simulation and walk-forward optimization for strategy validation in Go?

**Specific areas to research:**
- Random path generation for Monte Carlo
- Bootstrap sampling techniques
- Walk-forward window sizing
- Out-of-sample validation metrics
- Overfitting detection methods

---

## Performance Targets

| Metric | Target | Rationale |
|--------|--------|-----------|
| Backtest throughput | 1M events/second | Process full dataset in reasonable time |
| Live latency | <50ms order placement | Competitive with other algo traders |
| Memory usage | <16GB for full backtest | Fit on typical development machine |
| Data loading | 1GB/second streaming | Don't bottleneck on I/O |
| WebSocket latency | <5ms round-trip | Real-time signal delivery |

---

## Key Go Libraries to Research

| Library | Purpose | Why |
|---------|---------|-----|
| `gorilla/websocket` | WebSocket server | Industry standard, well-tested |
| `fasthttp` | HTTP server | Lower latency than net/http |
| `go-redis/redis` | Caching | For signal/result caching |
| `jackc/pgx` | PostgreSQL | For historical data if using SQL |
| `shopify/sarama` | Kafka | For event streaming if needed |
| `prometheus/client_golang` | Metrics | Performance monitoring |
| `uber-go/zap` | Logging | High-performance structured logging |
| `spf13/viper` | Config | Configuration management |
| `stretchr/testify` | Testing | Better test assertions |

---

## Integration Points with TypeScript Frontend

### WebSocket Message Format
```json
{
  "id": "uuid-v4",
  "type": "request|response|event",
  "method": "backtest:run|signals:subscribe|...",
  "payload": { ... },
  "timestamp": 1705708800000
}
```

### HTTP Endpoints
```
GET  /api/v1/health              # Health check
GET  /api/v1/data/symbols        # Available symbols
GET  /api/v1/data/history/:symbol # Historical data
POST /api/v1/backtest/run        # Start backtest (large payload)
GET  /api/v1/backtest/:id        # Get backtest results
GET  /api/v1/backtest/:id/trades # Get individual trades
```

### Event Types from Backend
```go
type EventType string
const (
    EventBacktestProgress  EventType = "backtest:progress"
    EventBacktestComplete  EventType = "backtest:complete"
    EventSignalNew         EventType = "signal:new"
    EventSignalExpired     EventType = "signal:expired"
    EventTradeExecuted     EventType = "trade:executed"
    EventKillSwitchTriggered EventType = "killswitch:triggered"
    EventBlockUpdate       EventType = "block:update"
)
```

---

## Existing Data Sources

The system should support ingesting data from:

1. **Binance** - Spot and futures tick data
2. **Coinbase** - US market data
3. **Solana RPC** - On-chain transaction history
4. **Helius/Shyft** - Solana indexed data
5. **The Graph** - EVM DEX data
6. **Dune Analytics** - Historical on-chain queries

---

## Example Backtest Configuration

```json
{
  "strategy": {
    "name": "momentum_breakout",
    "entryRules": [
      { "indicator": "rsi", "condition": "crosses_above", "value": 30 },
      { "indicator": "volume", "condition": "greater_than", "value": "sma_20" }
    ],
    "exitRules": [
      { "type": "take_profit", "value": 0.02 },
      { "type": "stop_loss", "value": 0.05 },
      { "type": "trailing_stop", "activation": 0.01, "distance": 0.005 }
    ]
  },
  "backtest": {
    "startDate": "2023-01-01",
    "endDate": "2024-01-01",
    "symbols": ["SOL/USDT", "ETH/USDT"],
    "timeframe": "1m",
    "initialCapital": 10000,
    "commission": 0.001,
    "slippageModel": "volume_weighted"
  },
  "validation": {
    "walkForward": true,
    "windowSize": 30,
    "stepSize": 7,
    "monteCarlo": {
      "enabled": true,
      "iterations": 1000,
      "confidenceLevel": 0.95
    }
  }
}
```

---

## Success Metrics

After research, the Go backend should achieve:

1. **Accuracy** - Backtest results within 5% of live trading results
2. **Speed** - Full year backtest on 1-minute data completes in <60 seconds
3. **Reliability** - Zero crashes during 24/7 operation
4. **Latency** - Signal-to-order latency <100ms
5. **Scalability** - Handle 100+ concurrent backtests

---

## Questions Summary for Perplexity

1. Event-driven vs vectorized backtesting trade-offs in Go?
2. Block-accurate crypto simulation with MEV modeling?
3. Efficient storage/retrieval for 70B+ tick datapoints?
4. State-of-the-art slippage and market impact models?
5. Low-latency WebSocket API design patterns?
6. Go-specific optimizations for trading systems?
7. Professional-grade kill switch implementations?
8. Monte Carlo and walk-forward validation in Go?

Please research these topics thoroughly and provide:
- Code examples where possible
- Links to open-source implementations
- Academic papers for financial models
- Performance benchmarks from real systems
- Common pitfalls and how to avoid them
