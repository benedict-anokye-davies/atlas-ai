# Atlas Trading Backend

High-performance event-driven autonomous trading system written in Go for Atlas Desktop.

## Features

- **Event-Driven Backtesting**: Process 1M+ events/second with accurate order execution simulation
- **8 Trading Strategies**: Momentum, Mean Reversion, Breakout, Trend Following, RSI Divergence, VWAP Reversion, Grid, DCA
- **Realistic Slippage Models**: Fixed, volume-weighted, order book, and MEV-aware slippage
- **Multi-Chain Support**: Solana (Jupiter DEX) and EVM (Ethereum, BSC, Polygon, Arbitrum, etc.)
- **Real-Time Market Data**: WebSocket-based price feeds from Binance
- **Autonomous Trading Agent**: Signal-driven automated trading with position sizing
- **ML-Based Learning**: Feedback engine and strategy optimizer that learns from trades
- **Risk Management**: Position limits, kill switch, correlation groups, drawdown protection
- **Advanced Validation**: Monte Carlo simulation and walk-forward analysis
- **WebSocket API**: Real-time communication with Atlas Desktop frontend

## Architecture

```
trading-backend/
├── cmd/server/          # Entry point
├── internal/
│   ├── api/            # HTTP/WebSocket server
│   ├── autonomous/     # Trading agent
│   ├── backtester/     # Backtesting engine
│   ├── blockchain/     # Solana/EVM clients
│   ├── data/           # Market data service
│   ├── execution/      # Order management, risk, slippage
│   ├── learning/       # Feedback and optimization
│   ├── signals/        # Signal aggregation
│   └── strategy/       # Trading strategies
├── pkg/
│   ├── types/          # Shared types
│   └── utils/          # Utilities
└── tests/              # Integration tests
```

## Quick Start

```bash
# Install dependencies
go mod download

# Run in paper trading mode (default)
go run cmd/server/main.go --host localhost --port 8080 --data ./data --paper

# Run with live trading (CAUTION)
go run cmd/server/main.go --paper=false

# Build
go build -o trading-backend cmd/server/main.go
```

## Environment Variables

```bash
# Blockchain RPC
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_WS_URL=wss://api.mainnet-beta.solana.com
ETH_RPC_URL=https://eth.llamarpc.com
POLYGON_RPC_URL=https://polygon.llamarpc.com
ARBITRUM_RPC_URL=https://arbitrum.llamarpc.com

# Exchange APIs
BINANCE_API_KEY=your_key
BINANCE_API_SECRET=your_secret

# AI Signals
PERPLEXITY_API_KEY=your_key
```

## API Endpoints

### HTTP

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/health` | GET | Health check |
| `/api/v1/data/symbols` | GET | List available symbols |
| `/api/v1/data/history/{symbol}` | GET | Get historical OHLCV data |
| `/api/v1/backtest/run` | POST | Start a backtest |
| `/api/v1/backtest/{id}` | GET | Get backtest status/results |
| `/api/v1/backtest/{id}/trades` | GET | Get backtest trades |
| `/api/v1/backtest/{id}/cancel` | POST | Cancel running backtest |
| `/api/v1/agent/status` | GET | Get agent status |
| `/api/v1/agent/start` | POST | Start trading agent |
| `/api/v1/agent/stop` | POST | Stop trading agent |
| `/api/v1/agent/pause` | POST | Pause trading |
| `/api/v1/agent/resume` | POST | Resume trading |
| `/api/v1/agent/emergency-stop` | POST | Emergency stop |
| `/api/v1/orders` | GET | Get open orders |
| `/api/v1/positions` | GET | Get positions |
| `/api/v1/risk/status` | GET | Risk manager status |
| `/api/v1/risk/kill-switch` | POST | Activate kill switch |
| `/api/v1/signals/aggregate/{symbol}` | GET | Get aggregated signal |
| `/api/v1/feedback` | POST | Submit trade feedback |
| `/api/v1/performance/report` | GET | Get performance report |

### WebSocket

Connect to `ws://localhost:8080/ws`

**Subscribe to channels:**
```json
{"type": "subscribe", "channel": "prices:BTCUSDT"}
{"type": "subscribe", "channel": "orders"}
{"type": "subscribe", "channel": "trades"}
{"type": "subscribe", "channel": "signals"}
```

**Events:**
- `price_update` - Real-time prices
- `order_update` - Order status changes
- `trade_update` - Trade executions
- `signal_update` - New signals
- `risk_alert` - Risk violations
- `agent_status` - Agent state changes

## Trading Strategies

| Strategy | Description |
|----------|-------------|
| `momentum` | Trades based on price momentum over lookback period |
| `mean_reversion` | Bollinger Band reversion to mean |
| `breakout` | Breakout from consolidation with volume confirmation |
| `trend_following` | EMA crossover trend following |
| `rsi_divergence` | RSI divergence detection |
| `vwap_reversion` | Reversion to VWAP |
| `grid` | Grid trading at multiple price levels |
| `dca` | Dollar Cost Averaging with dip buying |

## Backtest Configuration

```json
{
  "id": "my-backtest",
  "strategy": {
    "name": "momentum",
    "type": "technical",
    "parameters": {
      "period": 14,
      "threshold": 0.02
    }
  },
  "symbols": ["BTCUSDT", "ETHUSDT"],
  "startDate": "2023-01-01T00:00:00Z",
  "endDate": "2024-01-01T00:00:00Z",
  "timeframe": "1h",
  "initialCapital": "10000",
  "commission": "0.001",
  "slippage": {
    "model": "volume_weighted",
    "fixedBps": "10",
    "impactFactor": "0.1"
  }
  },
  "riskLimits": {
    "maxPositionSize": "0.1",
    "maxDrawdown": "0.2",
    "maxDailyLoss": "0.05",
    "maxOpenPositions": 5
  },
  "validation": {
    "walkForward": {
      "enabled": true,
      "windowSize": 30,
      "stepSize": 7
    },
    "monteCarlo": {
      "enabled": true,
      "iterations": 1000,
      "confidenceLevel": "0.95"
    }
  }
}
```

## Performance Metrics

The backtest results include:

- **Returns**: Total return, annualized return
- **Risk-Adjusted**: Sharpe ratio, Sortino ratio, Calmar ratio
- **Drawdown**: Max drawdown, max drawdown date
- **Trading**: Win rate, profit factor, expectancy
- **Trade Stats**: Total trades, winning/losing trades, avg win/loss
- **VaR**: Value at Risk (95% and 99%)
- **Monte Carlo**: Median return, P5/P95 returns, probability of ruin
- **Walk-Forward**: Window results, robustness ratio

## Architecture

```
trading-backend/
├── cmd/server/main.go       # Entry point
├── internal/
│   ├── api/                 # HTTP/WebSocket server
│   ├── backtester/          # Core backtesting engine
│   │   ├── engine.go        # Event-driven engine
│   │   ├── events.go        # Event types and queue
│   │   ├── portfolio.go     # Portfolio simulation
│   │   ├── orders.go        # Order management
│   │   ├── risk.go          # Risk management
│   │   ├── metrics.go       # Performance metrics
│   │   ├── slippage.go      # Slippage models
│   │   ├── montecarlo.go    # Monte Carlo simulation
│   │   └── walkforward.go   # Walk-forward analysis
│   ├── blockchain/          # Chain integrations
│   │   ├── solana.go        # Solana RPC/WebSocket
│   │   └── evm.go           # EVM chains (ETH, etc.)
│   └── data/                # Data storage
│       └── store.go         # OHLCV data management
└── pkg/types/               # Shared types
    ├── types.go             # Core types
    └── config.go            # Configuration types
```

## Integration with Atlas Desktop

The backend communicates with Atlas Desktop via WebSocket:

```typescript
// In Atlas (TypeScript)
const ws = new WebSocket('ws://localhost:8080/ws');

ws.send(JSON.stringify({
  id: uuid(),
  type: 'request',
  method: 'backtest:run',
  payload: backtestConfig,
  timestamp: Date.now()
}));

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.method === 'backtest:progress') {
    updateProgress(msg.payload);
  }
};
```

## Slippage Models

### Fixed Slippage
Simple fixed percentage slippage (e.g., 10 basis points).

### Volume-Weighted Slippage
Square-root market impact model based on order size relative to volume:
```
slippage = base_slippage + impact_factor * sqrt(order_size / volume)
```

### Order Book Slippage
Simulates order book traversal to estimate realistic fill prices.

### MEV-Aware Slippage
Detects potential MEV attacks and applies additional buffer.

## Development

```bash
# Run tests
go test ./...

# Run with race detection
go run -race cmd/server/main.go

# Build for production
CGO_ENABLED=0 go build -ldflags="-s -w" -o trading-backend cmd/server/main.go
```

## License

MIT
