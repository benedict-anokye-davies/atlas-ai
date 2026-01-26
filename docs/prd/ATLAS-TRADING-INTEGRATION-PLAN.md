# Atlas Trading Integration Plan

## Executive Summary

This document outlines how Atlas (the voice-first AI desktop assistant) integrates with and autonomously enhances the PhD-level Go trading backend. Atlas serves three roles:

1. **Operator** - Execute trades via voice commands, monitor positions, manage risk
2. **Strategist** - Discover, backtest, and deploy new trading strategies autonomously
3. **Engineer** - Continuously improve the trading system's code and architecture

---

## Part 1: Atlas as Trading Operator

### 1.1 Voice Command Interface

Atlas provides natural language control over all trading operations:

```
Voice Commands (Examples):
─────────────────────────────────────────────────────────────────
"Atlas, what's the current market regime?"
"Show me my open positions"
"What's my PnL today?"
"Buy 0.1 BTC with a 2% stop loss"
"Close all losing positions"
"Pause trading until tomorrow"
"What signals are we seeing on ETH?"
"Run a Monte Carlo validation on momentum strategy"
"Optimize the RSI parameters"
"How robust is the current strategy?"
"Set max daily loss to 500 dollars"
"Emergency stop all trading"
```

### 1.2 IPC Channels Required

Add these channels to `src/main/ipc/handlers.ts`:

```typescript
// Trading Backend IPC Channels
const TRADING_IPC_CHANNELS = {
  // Market State
  'trading:regime:current': () => GET /api/v1/regime/current,
  'trading:regime:history': (limit) => GET /api/v1/regime/history?limit={limit},
  
  // Positions & Orders
  'trading:positions:list': () => GET /api/v1/positions,
  'trading:positions:close': (symbol) => POST /api/v1/positions/{symbol}/close,
  'trading:orders:place': (order) => POST /api/v1/orders,
  'trading:orders:cancel': (id) => DELETE /api/v1/orders/{id},
  
  // Risk & PnL
  'trading:pnl:daily': () => GET /api/v1/pnl/daily,
  'trading:pnl:total': () => GET /api/v1/pnl/total,
  'trading:risk:status': () => GET /api/v1/risk/status,
  'trading:risk:set-limit': (type, value) => PUT /api/v1/risk/limits/{type},
  
  // Agent Control
  'trading:agent:start': () => POST /api/v1/agent/enhanced/start,
  'trading:agent:stop': () => POST /api/v1/agent/enhanced/stop,
  'trading:agent:pause': () => POST /api/v1/agent/enhanced/pause,
  'trading:agent:resume': () => POST /api/v1/agent/enhanced/resume,
  'trading:agent:status': () => GET /api/v1/agent/enhanced/status,
  'trading:agent:emergency-stop': () => POST /api/v1/agent/emergency-stop,
  
  // Signals & Analysis
  'trading:signals:current': (symbol) => GET /api/v1/signals/{symbol},
  'trading:signals:aggregate': () => GET /api/v1/signals/aggregate,
  
  // Position Sizing
  'trading:sizing:calculate': (params) => POST /api/v1/sizing/calculate,
  'trading:sizing:kelly': (params) => POST /api/v1/sizing/kelly,
  
  // Monte Carlo
  'trading:montecarlo:validate': (trades) => POST /api/v1/montecarlo/validate,
  'trading:montecarlo:sensitivity': (params) => POST /api/v1/montecarlo/sensitivity,
  
  // Optimization
  'trading:optimize:walkforward': (params) => POST /api/v1/optimization/walkforward,
  'trading:optimize:status': (jobId) => GET /api/v1/optimization/status?jobId={jobId},
  
  // Strategies
  'trading:strategies:list': () => GET /api/v1/strategies,
  'trading:strategies:viability': (id) => GET /api/v1/strategies/{id}/viability,
  'trading:strategies:register': (config) => POST /api/v1/strategies,
  'trading:strategies:activate': (id) => PUT /api/v1/strategies/{id}/activate,
};
```

### 1.3 Agent Tools for Trading

Add to `src/main/agent/tools/trading.ts`:

```typescript
export const tradingTools: ToolDefinition[] = [
  {
    name: 'get_market_regime',
    description: 'Get the current detected market regime (Bull, Bear, HighVol, etc.)',
    parameters: {},
    execute: async () => {
      const result = await tradingAPI.get('/regime/current');
      return {
        regime: result.regime,
        confidence: result.confidence,
        adjustments: result.adjustments,
      };
    },
  },
  
  {
    name: 'get_trading_status',
    description: 'Get current trading agent status including positions and PnL',
    parameters: {},
    execute: async () => {
      const [status, positions, pnl] = await Promise.all([
        tradingAPI.get('/agent/enhanced/status'),
        tradingAPI.get('/positions'),
        tradingAPI.get('/pnl/daily'),
      ]);
      return { status, positions, pnl };
    },
  },
  
  {
    name: 'place_trade',
    description: 'Place a trade with optional stop loss and take profit',
    parameters: {
      symbol: { type: 'string', required: true },
      side: { type: 'string', enum: ['buy', 'sell'], required: true },
      amount: { type: 'number', required: true },
      stopLossPercent: { type: 'number' },
      takeProfitPercent: { type: 'number' },
    },
    requireConfirmation: true, // Always confirm trades
    execute: async (params) => {
      // Calculate position size using Kelly if not specified
      const sizing = await tradingAPI.post('/sizing/calculate', {
        symbol: params.symbol,
        direction: params.side === 'buy' ? 'long' : 'short',
        portfolioValue: await getPortfolioValue(),
      });
      
      return tradingAPI.post('/orders', {
        symbol: params.symbol,
        side: params.side,
        quantity: params.amount || sizing.positionSize,
        stopLoss: params.stopLossPercent,
        takeProfit: params.takeProfitPercent,
      });
    },
  },
  
  {
    name: 'close_position',
    description: 'Close an open position',
    parameters: {
      symbol: { type: 'string', required: true },
    },
    requireConfirmation: true,
    execute: async (params) => {
      return tradingAPI.post(`/positions/${params.symbol}/close`);
    },
  },
  
  {
    name: 'emergency_stop_trading',
    description: 'Emergency stop all trading and close all positions',
    parameters: {},
    requireConfirmation: true,
    execute: async () => {
      return tradingAPI.post('/agent/emergency-stop');
    },
  },
  
  {
    name: 'run_backtest',
    description: 'Run a backtest on a strategy with given parameters',
    parameters: {
      strategyId: { type: 'string', required: true },
      startDate: { type: 'string' },
      endDate: { type: 'string' },
      parameters: { type: 'object' },
    },
    execute: async (params) => {
      return tradingAPI.post('/backtest/run', params);
    },
  },
  
  {
    name: 'validate_strategy_robustness',
    description: 'Run Monte Carlo validation to check strategy robustness',
    parameters: {
      strategyId: { type: 'string', required: true },
      simulations: { type: 'number', default: 1000 },
    },
    execute: async (params) => {
      const trades = await tradingAPI.get(`/strategies/${params.strategyId}/trades`);
      return tradingAPI.post('/montecarlo/validate', {
        trades: trades.map(t => t.pnl),
        simulations: params.simulations,
      });
    },
  },
  
  {
    name: 'optimize_strategy',
    description: 'Run walk-forward optimization on a strategy',
    parameters: {
      strategyId: { type: 'string', required: true },
      parameters: { type: 'object', required: true }, // { paramName: [min, max, step] }
    },
    execute: async (params) => {
      return tradingAPI.post('/optimization/walkforward', {
        strategyId: params.strategyId,
        parameters: params.parameters,
        windows: 5,
        inSampleDays: 180,
        outSampleDays: 30,
      });
    },
  },
];
```

### 1.4 Real-Time Notifications

Atlas receives WebSocket updates for:
- Trade executions
- Position changes
- Risk alerts
- Regime changes
- Kill switch activations

```typescript
// In src/main/trading/websocket-client.ts
tradingWS.on('trade', (trade) => {
  notificationManager.show({
    title: `Trade Executed: ${trade.symbol}`,
    body: `${trade.side} ${trade.quantity} @ ${trade.price}`,
    priority: 'high',
  });
  
  // Speak if significant
  if (trade.pnl !== 0) {
    atlas.speak(`Trade on ${trade.symbol}. ${trade.pnl > 0 ? 'Profit' : 'Loss'} of ${Math.abs(trade.pnl)} dollars.`);
  }
});

tradingWS.on('regime_change', (event) => {
  atlas.speak(`Market regime changed to ${event.regime} with ${Math.round(event.confidence * 100)}% confidence.`);
});

tradingWS.on('risk_alert', (alert) => {
  if (alert.severity === 'critical') {
    atlas.speak(`Critical risk alert: ${alert.message}. Trading has been paused.`);
  }
});
```

---

## Part 2: Atlas as Autonomous Strategist

### 2.1 Strategy Discovery Pipeline

Atlas autonomously discovers new trading strategies through:

```
┌─────────────────────────────────────────────────────────────────┐
│                 Autonomous Strategy Discovery                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. RESEARCH PHASE                                               │
│     ├── Perplexity API: Latest market research                   │
│     ├── Academic papers: arXiv quantitative finance              │
│     ├── Social sentiment: Twitter/Reddit crypto sentiment        │
│     └── On-chain data: Whale movements, DEX flows                │
│                                                                  │
│  2. HYPOTHESIS GENERATION                                        │
│     ├── LLM generates strategy hypotheses from research          │
│     ├── Pattern recognition on historical data                   │
│     └── Regime-specific opportunity identification               │
│                                                                  │
│  3. STRATEGY CODING                                              │
│     ├── Atlas writes Go strategy code                            │
│     ├── Implements entry/exit rules                              │
│     └── Defines parameter ranges for optimization                │
│                                                                  │
│  4. VALIDATION PIPELINE                                          │
│     ├── Initial backtest (reject if Sharpe < 0.3)                │
│     ├── Walk-forward optimization (reject if OOS degrade > 40%)  │
│     ├── Monte Carlo validation (reject if robustness < 0.5)      │
│     └── Regime analysis (check performance per regime)           │
│                                                                  │
│  5. PAPER TRADING                                                │
│     ├── Deploy to paper trading for 2 weeks minimum              │
│     ├── Compare live vs backtest performance                     │
│     └── Monitor for regime changes                               │
│                                                                  │
│  6. LIVE DEPLOYMENT (Requires Human Approval)                    │
│     ├── Present strategy report to Ben                           │
│     ├── Request deployment approval                              │
│     └── Start with minimal position sizing                       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Strategy Discovery Agent

```typescript
// src/main/trading/strategy-discovery-agent.ts

interface StrategyHypothesis {
  name: string;
  description: string;
  entryRules: string[];
  exitRules: string[];
  timeframe: string;
  markets: string[];
  expectedEdge: string;
  riskFactors: string[];
  parameterRanges: Record<string, [number, number, number]>;
}

class StrategyDiscoveryAgent {
  private llm: LLMManager;
  private perplexity: PerplexityClient;
  private tradingAPI: TradingAPIClient;
  
  async discoverStrategies(): Promise<void> {
    // 1. Research phase
    const research = await this.conductResearch();
    
    // 2. Generate hypotheses
    const hypotheses = await this.generateHypotheses(research);
    
    // 3. For each hypothesis, attempt to create and validate
    for (const hypothesis of hypotheses) {
      try {
        const strategy = await this.implementStrategy(hypothesis);
        const validation = await this.validateStrategy(strategy);
        
        if (validation.passed) {
          await this.deployToPaperTrading(strategy);
          this.notifyBen(strategy, validation);
        }
      } catch (error) {
        logger.info(`Hypothesis ${hypothesis.name} failed: ${error.message}`);
      }
    }
  }
  
  private async conductResearch(): Promise<ResearchResults> {
    const [marketResearch, academicPapers, sentiment, onChain] = await Promise.all([
      this.perplexity.search('current crypto market trends technical analysis'),
      this.perplexity.search('quantitative trading strategies academic research 2025'),
      this.getSocialSentiment(),
      this.getOnChainMetrics(),
    ]);
    
    return { marketResearch, academicPapers, sentiment, onChain };
  }
  
  private async generateHypotheses(research: ResearchResults): Promise<StrategyHypothesis[]> {
    const prompt = `
      Based on the following market research, generate 3 trading strategy hypotheses.
      
      Research:
      ${JSON.stringify(research, null, 2)}
      
      Current regime: ${await this.tradingAPI.get('/regime/current')}
      
      Requirements:
      - Each strategy must have clear entry/exit rules
      - Must be implementable with available indicators
      - Must have defined risk parameters
      - Should exploit current market regime
      
      Output as JSON array of StrategyHypothesis objects.
    `;
    
    return this.llm.generateJSON(prompt);
  }
  
  private async implementStrategy(hypothesis: StrategyHypothesis): Promise<Strategy> {
    // Atlas writes Go code for the strategy
    const codePrompt = `
      Implement this trading strategy in Go:
      
      ${JSON.stringify(hypothesis, null, 2)}
      
      Use the existing strategy interface:
      - Implement Strategy interface from internal/strategy/strategy.go
      - Use existing indicators from internal/strategy/indicators.go
      - Follow existing code patterns
      
      Output the complete Go file.
    `;
    
    const code = await this.llm.generate(codePrompt);
    
    // Save to strategies directory
    const filename = `${hypothesis.name.toLowerCase().replace(/ /g, '_')}.go`;
    await fs.writeFile(`trading-backend/internal/strategy/${filename}`, code);
    
    // Register with backend
    return this.tradingAPI.post('/strategies', {
      id: hypothesis.name,
      code: filename,
      parameters: hypothesis.parameterRanges,
    });
  }
  
  private async validateStrategy(strategy: Strategy): Promise<ValidationResult> {
    // Step 1: Initial backtest
    const backtest = await this.tradingAPI.post('/backtest/run', {
      strategyId: strategy.id,
      startDate: '2023-01-01',
      endDate: '2025-01-01',
    });
    
    if (backtest.sharpeRatio < 0.3) {
      return { passed: false, reason: 'Sharpe ratio too low' };
    }
    
    // Step 2: Walk-forward optimization
    const optimization = await this.tradingAPI.post('/optimization/walkforward', {
      strategyId: strategy.id,
      parameters: strategy.parameterRanges,
      windows: 5,
    });
    
    if (optimization.degradation > 0.4) {
      return { passed: false, reason: 'Out-of-sample degradation too high' };
    }
    
    // Step 3: Monte Carlo validation
    const monteCarlo = await this.tradingAPI.post('/montecarlo/validate', {
      trades: backtest.trades.map(t => t.pnl),
      simulations: 1000,
    });
    
    if (monteCarlo.robustnessScore < 0.5) {
      return { passed: false, reason: 'Robustness score too low' };
    }
    
    // Step 4: Check viability
    const viability = await this.tradingAPI.get(`/strategies/${strategy.id}/viability`);
    
    return {
      passed: viability.isViable,
      backtest,
      optimization,
      monteCarlo,
      viability,
    };
  }
}
```

### 2.3 Continuous Strategy Improvement

Atlas monitors live strategies and improves them:

```typescript
// Runs every hour
async function monitorAndImproveStrategies(): Promise<void> {
  const strategies = await tradingAPI.get('/strategies');
  
  for (const strategy of strategies) {
    // Get recent performance
    const performance = await tradingAPI.get(`/strategies/${strategy.id}/performance`);
    
    // Check if performance is degrading
    if (performance.recentSharpe < performance.historicalSharpe * 0.7) {
      logger.warn(`Strategy ${strategy.id} performance degrading`);
      
      // Re-optimize with recent data
      const reOptimization = await tradingAPI.post('/optimization/walkforward', {
        strategyId: strategy.id,
        parameters: strategy.parameterRanges,
        startDate: getDateMonthsAgo(6),
      });
      
      if (reOptimization.improvement > 0.1) {
        // Propose parameter update to Ben
        notifyBen({
          type: 'strategy_improvement',
          strategyId: strategy.id,
          currentParams: strategy.currentParams,
          proposedParams: reOptimization.bestParams,
          expectedImprovement: reOptimization.improvement,
        });
      }
    }
    
    // Check regime suitability
    const currentRegime = await tradingAPI.get('/regime/current');
    const regimePerformance = performance.byRegime[currentRegime.regime];
    
    if (regimePerformance?.sharpe < 0) {
      // Strategy performs poorly in current regime - reduce allocation
      await tradingAPI.put(`/strategies/${strategy.id}/allocation`, {
        multiplier: 0.5,
        reason: `Poor performance in ${currentRegime.regime} regime`,
      });
      
      atlas.speak(`Reducing allocation to ${strategy.id} strategy due to poor ${currentRegime.regime} regime performance.`);
    }
  }
}
```

---

## Part 3: Atlas as Trading System Engineer

### 3.1 Self-Improvement Capabilities

Atlas can enhance the trading system itself:

```
┌─────────────────────────────────────────────────────────────────┐
│              Atlas Self-Improvement Capabilities                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  CODE IMPROVEMENTS                                               │
│  ├── Fix bugs reported in logs                                   │
│  ├── Optimize slow code paths (profiler-guided)                  │
│  ├── Add new indicators and features                             │
│  ├── Improve error handling and recovery                         │
│  └── Write tests for uncovered code                              │
│                                                                  │
│  ARCHITECTURE IMPROVEMENTS                                       │
│  ├── Add new signal sources (news, social, on-chain)             │
│  ├── Implement new execution venues                              │
│  ├── Add new position sizing methods                             │
│  ├── Enhance regime detection (more regimes, faster detection)   │
│  └── Improve backtester accuracy                                 │
│                                                                  │
│  DATA IMPROVEMENTS                                               │
│  ├── Add new data sources                                        │
│  ├── Improve data quality checks                                 │
│  ├── Optimize data storage                                       │
│  └── Add real-time alternative data                              │
│                                                                  │
│  RESEARCH INTEGRATION                                            │
│  ├── Implement papers from arXiv                                 │
│  ├── Add techniques from Perplexity research                     │
│  ├── Integrate new ML models                                     │
│  └── Test academic anomalies                                     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Improvement Workflow

```typescript
// src/main/trading/self-improvement-agent.ts

class TradingSystemImprovementAgent {
  async runImprovementCycle(): Promise<void> {
    // 1. Analyze current system performance
    const systemAnalysis = await this.analyzeSystem();
    
    // 2. Identify improvement opportunities
    const opportunities = await this.identifyOpportunities(systemAnalysis);
    
    // 3. Prioritize by expected impact
    const prioritized = this.prioritize(opportunities);
    
    // 4. Implement highest priority improvements
    for (const opportunity of prioritized.slice(0, 3)) {
      await this.implementImprovement(opportunity);
    }
  }
  
  private async analyzeSystem(): Promise<SystemAnalysis> {
    return {
      // Performance bottlenecks
      slowEndpoints: await this.profileEndpoints(),
      memoryUsage: await this.getMemoryProfile(),
      
      // Error patterns
      recentErrors: await this.getRecentErrors(),
      errorPatterns: await this.analyzeErrorPatterns(),
      
      // Trading performance
      tradingMetrics: await tradingAPI.get('/metrics'),
      strategyPerformance: await tradingAPI.get('/strategies/performance'),
      
      // Code quality
      testCoverage: await this.getTestCoverage(),
      lintIssues: await this.runLinter(),
      
      // Research gaps
      missingFeatures: await this.identifyMissingFeatures(),
    };
  }
  
  private async identifyOpportunities(analysis: SystemAnalysis): Promise<Improvement[]> {
    const prompt = `
      Analyze this trading system state and identify improvement opportunities:
      
      ${JSON.stringify(analysis, null, 2)}
      
      Consider:
      - Bug fixes (high priority if causing losses)
      - Performance optimizations (if causing latency issues)
      - New features (if research suggests alpha)
      - Code quality (if test coverage < 80%)
      
      For each opportunity, estimate:
      - Expected impact (1-10)
      - Implementation effort (hours)
      - Risk level (low/medium/high)
      
      Output as JSON array.
    `;
    
    return this.llm.generateJSON(prompt);
  }
  
  private async implementImprovement(improvement: Improvement): Promise<void> {
    logger.info(`Implementing improvement: ${improvement.title}`);
    
    // Read relevant source files
    const sourceFiles = await this.getRelevantFiles(improvement);
    
    // Generate implementation
    const implementation = await this.llm.generate(`
      Implement this improvement to the trading system:
      
      ${improvement.description}
      
      Current code:
      ${sourceFiles.map(f => `--- ${f.path} ---\n${f.content}`).join('\n\n')}
      
      Requirements:
      - Follow existing code patterns
      - Add appropriate error handling
      - Include tests if adding new functionality
      - Keep changes minimal and focused
      
      Output the file changes as JSON: { path: string, content: string }[]
    `);
    
    // Apply changes
    for (const change of implementation) {
      await fs.writeFile(change.path, change.content);
    }
    
    // Run tests
    const testResult = await this.runTests();
    
    if (testResult.passed) {
      // Commit changes
      await git.commit(`feat(trading): ${improvement.title}`);
      logger.info(`Improvement implemented: ${improvement.title}`);
    } else {
      // Revert changes
      await git.reset('--hard', 'HEAD');
      logger.warn(`Improvement failed tests, reverted: ${improvement.title}`);
    }
  }
}
```

### 3.3 Research-Driven Enhancement

Atlas continuously researches and implements new techniques:

```typescript
// Weekly research cycle
async function conductWeeklyResearch(): Promise<void> {
  // 1. Search for new quantitative finance research
  const papers = await perplexity.search(`
    quantitative trading research 2025
    site:arxiv.org OR site:ssrn.com
    machine learning crypto momentum mean reversion
  `);
  
  // 2. Search for market microstructure insights
  const microstructure = await perplexity.search(`
    market microstructure high frequency trading
    order flow imbalance price impact
    latest research 2025
  `);
  
  // 3. Search for alternative data sources
  const altData = await perplexity.search(`
    alternative data trading signals
    on-chain analytics social sentiment
    new data providers 2025
  `);
  
  // 4. Analyze and extract actionable insights
  const insights = await llm.generate(`
    Analyze these research findings and extract actionable trading system improvements:
    
    Papers: ${papers}
    Microstructure: ${microstructure}
    Alt Data: ${altData}
    
    Current system capabilities:
    - HMM regime detection (6 regimes)
    - Kelly Criterion position sizing
    - Monte Carlo validation
    - Walk-forward optimization
    - Signal aggregation (technical, sentiment, on-chain, AI)
    
    Identify:
    1. New techniques we should implement
    2. Improvements to existing components
    3. New data sources to integrate
    4. Potential alpha sources
    
    Prioritize by expected impact on trading performance.
  `);
  
  // 5. Create implementation tasks
  for (const insight of insights) {
    await createImprovementTask(insight);
  }
}
```

---

## Part 4: Safety & Governance

### 4.1 Human-in-the-Loop Requirements

```
┌─────────────────────────────────────────────────────────────────┐
│                 Actions Requiring Ben's Approval                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ALWAYS REQUIRE APPROVAL:                                        │
│  ├── Deploy new strategy to live trading                         │
│  ├── Increase position sizing limits                             │
│  ├── Disable risk controls                                       │
│  ├── Add new exchange connections                                │
│  ├── Modify kill switch parameters                               │
│  └── Large code changes (>100 lines)                             │
│                                                                  │
│  NOTIFY BUT DON'T REQUIRE APPROVAL:                              │
│  ├── Strategy parameter adjustments within bounds                │
│  ├── Regime-based allocation changes                             │
│  ├── Paper trading deployments                                   │
│  ├── Bug fixes under 20 lines                                    │
│  └── Test additions                                              │
│                                                                  │
│  AUTONOMOUS (NO APPROVAL NEEDED):                                │
│  ├── Research and hypothesis generation                          │
│  ├── Backtesting and validation                                  │
│  ├── Paper trading execution                                     │
│  ├── Monitoring and alerting                                     │
│  └── Code analysis and suggestions                               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 Risk Guardrails

```typescript
// Hard limits that Atlas cannot override
const HARD_LIMITS = {
  // Position limits
  maxPositionSizePercent: 0.10,     // 10% of portfolio max
  maxTotalExposure: 0.50,           // 50% of portfolio max
  maxConcurrentPositions: 10,
  
  // Loss limits
  maxDailyLossPercent: 0.05,        // 5% max daily loss
  maxWeeklyLossPercent: 0.10,       // 10% max weekly loss
  maxDrawdownPercent: 0.20,         // 20% max drawdown
  
  // Trade limits
  maxTradesPerDay: 50,
  maxSlippagePercent: 0.02,         // 2% max slippage
  
  // Strategy limits
  minBacktestSharpe: 0.3,           // Minimum Sharpe for deployment
  minRobustnessScore: 0.5,          // Minimum MC robustness
  maxOOSDegradation: 0.40,          // Maximum OOS degradation
  
  // Paper trading requirements
  minPaperTradingDays: 14,          // 2 weeks minimum
  minPaperTrades: 50,               // 50 trades minimum
};

// Atlas cannot modify these limits - they're hardcoded
function validateAction(action: TradingAction): ValidationResult {
  // Check all hard limits
  for (const [limit, value] of Object.entries(HARD_LIMITS)) {
    if (action.wouldViolate(limit, value)) {
      return {
        allowed: false,
        reason: `Would violate hard limit: ${limit} (${value})`,
      };
    }
  }
  
  return { allowed: true };
}
```

### 4.3 Audit Trail

All trading actions are logged with full context:

```typescript
interface TradingAuditLog {
  timestamp: Date;
  actor: 'atlas' | 'ben' | 'system';
  action: string;
  params: Record<string, unknown>;
  result: 'success' | 'failure' | 'rejected';
  reason?: string;
  
  // Context
  regime: string;
  portfolioValue: number;
  openPositions: number;
  dailyPnL: number;
  
  // For strategy changes
  strategyId?: string;
  oldParams?: Record<string, number>;
  newParams?: Record<string, number>;
  
  // For code changes
  filesChanged?: string[];
  linesChanged?: number;
  testsPassed?: boolean;
}
```

---

## Part 5: Implementation Roadmap

### Phase 1: Basic Integration (Week 1-2)

- [ ] Create IPC handlers for trading API
- [ ] Implement basic voice commands (status, positions, PnL)
- [ ] Add WebSocket client for real-time updates
- [ ] Create agent tools for trading operations
- [ ] Setup audit logging

### Phase 2: Operator Features (Week 3-4)

- [ ] Voice command for placing trades with confirmation
- [ ] Emergency stop functionality
- [ ] Risk limit management via voice
- [ ] Real-time notifications (trades, alerts)
- [ ] Position sizing calculator

### Phase 3: Strategist Features (Week 5-6)

- [ ] Strategy discovery agent
- [ ] Perplexity research integration
- [ ] Automated backtesting pipeline
- [ ] Monte Carlo validation automation
- [ ] Paper trading deployment

### Phase 4: Engineer Features (Week 7-8)

- [ ] System analysis automation
- [ ] Improvement identification
- [ ] Automated code changes with testing
- [ ] Research-driven enhancement
- [ ] Self-improvement cycles

### Phase 5: Advanced Autonomy (Week 9-10)

- [ ] Full strategy discovery loop
- [ ] Live deployment with approval workflow
- [ ] Continuous optimization
- [ ] Regime-adaptive allocation
- [ ] Performance-based strategy rotation

---

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Voice command accuracy | >95% | Successful command execution rate |
| Strategy discovery rate | 2/month | New validated strategies per month |
| System uptime | >99.5% | Trading system availability |
| Bug fix time | <24h | Time from detection to fix |
| Research latency | <1 week | Time from paper to implementation |
| Risk compliance | 100% | Hard limit violations (must be zero) |
| PnL improvement | >10%/year | Year-over-year return improvement |

---

## Appendix: Voice Command Reference

```
STATUS COMMANDS
───────────────
"What's my trading status?"
"How are my positions?"
"What's my PnL today/this week/this month?"
"What's the current regime?"
"How robust is [strategy]?"
"What signals are active?"

TRADING COMMANDS
────────────────
"Buy [amount] [symbol]"
"Sell [amount] [symbol]"
"Close my [symbol] position"
"Close all positions"
"Set stop loss at [price/%] for [symbol]"
"Take profit at [price/%] for [symbol]"

CONTROL COMMANDS
────────────────
"Start trading"
"Stop trading"
"Pause trading"
"Resume trading"
"Emergency stop"
"Set max daily loss to [amount]"

ANALYSIS COMMANDS
─────────────────
"Run backtest on [strategy]"
"Optimize [strategy] parameters"
"Validate [strategy] robustness"
"Show regime history"
"What's the Kelly size for [trade]?"

RESEARCH COMMANDS
─────────────────
"Research new strategies"
"Find alpha opportunities"
"What's happening in crypto markets?"
"Analyze [symbol] technicals"
```
