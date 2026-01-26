# Autonomous Strategy Discovery Research Questions

## Purpose
These questions will help Atlas become a **self-improving quant researcher** that discovers, validates, and trades its own strategies - not just execute pre-defined rules.

---

## SECTION 1: STRATEGY GENERATION

### 1.1 Genetic Algorithms for Trading

**Core Questions:**
1. How do genetic algorithms (GA) work for optimizing trading strategy parameters?
2. What's the difference between genetic algorithms and genetic programming for trading?
3. How do you represent a trading strategy as a "chromosome" for evolution?
4. What fitness functions work best for evolving trading strategies (Sharpe, profit factor, etc.)?
5. How do you prevent genetic algorithms from overfitting to historical data?
6. What's the optimal population size and generation count for strategy evolution?
7. How do you implement crossover and mutation operators for trading rules?
8. What are NEAT (NeuroEvolution of Augmenting Topologies) and how does it apply to trading?

**Implementation Questions:**
9. Show me production Go code for a genetic algorithm that evolves trading strategies
10. How do you parallelize genetic algorithm fitness evaluation across multiple cores?
11. What's the best way to encode technical indicator parameters in a genome?
12. How do you handle constraints (position limits, etc.) in genetic optimization?

---

### 1.2 Reinforcement Learning for Trading

**Core Questions:**
1. Which RL algorithms work best for trading: PPO, A2C, SAC, TD3, or DQN?
2. How do you define the state space for a trading RL agent (what inputs)?
3. What reward function should a trading RL agent optimize?
4. How do you handle the exploration-exploitation tradeoff in live trading?
5. What's the difference between model-free and model-based RL for trading?
6. How do you prevent RL agents from learning spurious patterns (overfitting)?
7. What's curriculum learning and how does it help train trading agents?
8. How do you handle non-stationarity in financial markets with RL?

**Implementation Questions:**
9. Show me production code for a PPO agent that trades crypto/stocks
10. How do you implement a custom trading environment (Gym-style) in Go or Python?
11. What neural network architectures work best for trading RL (LSTM, Transformer, CNN)?
12. How do you deploy an RL trading agent with proper risk management?

---

### 1.3 LLM-Powered Alpha Research

**Core Questions:**
1. How do quant funds use LLMs (GPT-4, Claude) for alpha research?
2. Can LLMs analyze SEC filings, earnings calls, and news for trading signals?
3. How do you use LLMs to generate trading hypotheses from market data?
4. What's the best way to combine LLM insights with quantitative backtesting?
5. How do you prevent LLM hallucinations from affecting trading decisions?
6. Can LLMs identify regime changes or market turning points?
7. How do you use LLMs to summarize academic finance papers into actionable strategies?
8. What prompt engineering techniques work best for financial analysis?

**Implementation Questions:**
9. Show me code for using Perplexity/Claude API to research trading strategies
10. How do you structure prompts to get actionable trading signals from LLMs?
11. How do you validate LLM-generated strategy ideas with backtesting?
12. What's the best architecture for combining LLM research with automated trading?

---

### 1.4 Statistical Pattern Mining

**Core Questions:**
1. What statistical methods detect predictive patterns in price data?
2. How do you test if a pattern is statistically significant vs random?
3. What's the difference between technical analysis and statistical arbitrage?
4. How do you detect mean reversion vs momentum regimes?
5. What are the most robust statistical patterns that persist across markets?
6. How do you use cointegration for pairs trading?
7. What's the Hurst exponent and how does it predict trend persistence?
8. How do you detect breakout patterns statistically?

**Implementation Questions:**
9. Show me Go code for detecting statistically significant price patterns
10. How do you implement cointegration testing (Engle-Granger, Johansen)?
11. What's the proper way to calculate and use the Hurst exponent?
12. How do you mine for mean-reverting pairs across 1000+ assets?

---

## SECTION 2: MARKET REGIME DETECTION

### 2.1 Hidden Markov Models (HMM)

**Core Questions:**
1. How do Hidden Markov Models detect market regimes (bull/bear/sideways)?
2. What features should you feed into an HMM for regime detection?
3. How many hidden states should an HMM have for trading (2, 3, 4+)?
4. How do you handle regime changes in real-time trading?
5. What's the difference between HMM and Markov Switching models?
6. How do you combine HMM regime detection with strategy selection?
7. How long does it take to detect a regime change (lag)?
8. How do you validate that detected regimes are meaningful?

**Implementation Questions:**
9. Show me production Go/Python code for HMM regime detection
10. How do you implement online (streaming) HMM updates?
11. What libraries work best for HMM in trading (hmmlearn, pomegranate)?
12. How do you backtest regime-aware strategies?

---

### 2.2 Volatility Regime Detection

**Core Questions:**
1. How do you detect high vs low volatility regimes?
2. What's the VIX and how do professional traders use it?
3. How do GARCH models predict volatility regimes?
4. What's realized volatility vs implied volatility?
5. How do you adjust position sizing based on volatility regime?
6. What strategies work in high volatility vs low volatility?
7. How do you detect volatility clustering?
8. What's the relationship between volatility and returns?

**Implementation Questions:**
9. Show me code for real-time volatility regime classification
10. How do you implement GARCH(1,1) in Go?
11. What's the best rolling window for volatility calculation?
12. How do you build a volatility-adjusted position sizing system?

---

### 2.3 Sentiment and Flow Analysis

**Core Questions:**
1. How do you measure market sentiment (fear/greed)?
2. What's order flow analysis and how does it predict price moves?
3. How do you analyze social media sentiment for trading signals?
4. What's the put/call ratio and how do you use it?
5. How do you detect institutional vs retail order flow?
6. What's the relationship between funding rates and price (crypto)?
7. How do you use on-chain data for crypto regime detection?
8. What sentiment indicators predict market tops and bottoms?

**Implementation Questions:**
9. Show me code for real-time sentiment analysis using Twitter/Reddit
10. How do you implement order flow imbalance detection?
11. What APIs provide sentiment data for trading?
12. How do you combine multiple sentiment signals into one indicator?

---

## SECTION 3: STRATEGY PORTFOLIO MANAGEMENT

### 3.1 Multi-Strategy Allocation

**Core Questions:**
1. How do quant funds allocate capital across multiple strategies?
2. What's the Kelly Criterion and how do you use it for position sizing?
3. How do you measure correlation between trading strategies?
4. What's risk parity and how does it allocate between strategies?
5. How do you build a portfolio of uncorrelated strategies?
6. What's the optimal number of strategies to run simultaneously?
7. How do you rebalance between strategies over time?
8. What's mean-variance optimization for strategy allocation?

**Implementation Questions:**
9. Show me code for Kelly Criterion position sizing
10. How do you calculate rolling correlation between strategy returns?
11. How do you implement risk parity allocation in Go?
12. What's the best rebalancing frequency (daily, weekly, monthly)?

---

### 3.2 Strategy Rotation

**Core Questions:**
1. How do you decide when to turn a strategy on or off?
2. What metrics signal that a strategy is failing?
3. How do you rotate between momentum and mean reversion strategies?
4. What's adaptive strategy allocation?
5. How do you prevent whipsawing (turning strategies on/off too often)?
6. How do you blend strategy signals vs hard switching?
7. What's the lookback period for evaluating strategy performance?
8. How do you handle strategy drawdowns (reduce size vs stop completely)?

**Implementation Questions:**
9. Show me code for automatic strategy rotation based on performance
10. How do you implement a strategy "health score" for allocation?
11. What's the best way to fade allocation during drawdowns?
12. How do you backtest a strategy rotation system?

---

### 3.3 Risk Budgeting

**Core Questions:**
1. How do you set a total risk budget for your trading system?
2. What's Value at Risk (VaR) budgeting for multi-strategy systems?
3. How do you allocate risk across strategies vs across assets?
4. What's marginal risk contribution?
5. How do you handle correlation spikes during market stress?
6. What's tail risk and how do you budget for it?
7. How do you set strategy-level stop losses?
8. What's the relationship between leverage and risk budget?

**Implementation Questions:**
9. Show me code for real-time portfolio VaR calculation
10. How do you implement risk budgets with hard limits in Go?
11. What's the best way to calculate strategy correlation in real-time?
12. How do you implement a portfolio-level kill switch?

---

## SECTION 4: CONTINUOUS LEARNING & ADAPTATION

### 4.1 Strategy Decay Detection

**Core Questions:**
1. How do you detect when a strategy stops working?
2. What's alpha decay and why do strategies lose edge over time?
3. What metrics signal strategy degradation (Sharpe decline, hit rate drop)?
4. How long should you wait before concluding a strategy has failed?
5. What causes strategies to decay (crowding, regime change, data snooping)?
6. How do you distinguish drawdown from decay?
7. Can you predict strategy decay before it happens?
8. How do quant funds handle decaying strategies?

**Implementation Questions:**
9. Show me code for real-time strategy health monitoring
10. How do you implement statistical tests for strategy decay (CUSUM, Page-Hinkley)?
11. What's the best rolling window for decay detection?
12. How do you automate strategy retirement decisions?

---

### 4.2 Online Learning & Adaptation

**Core Questions:**
1. What's online learning and how does it apply to trading?
2. How do you retrain models without overfitting to recent data?
3. What's concept drift and how do you handle it in trading?
4. How often should you retrain/update trading models?
5. What's the difference between incremental learning and periodic retraining?
6. How do you balance stability vs adaptability in trading systems?
7. What's catastrophic forgetting and how do you prevent it?
8. How do you validate model updates before deploying?

**Implementation Questions:**
9. Show me code for incremental model updates in a trading system
10. How do you implement safe model deployment (A/B testing, shadow mode)?
11. What's the best architecture for continuous learning trading systems?
12. How do you track model versions and rollback if needed?

---

### 4.3 Live vs Backtest Monitoring

**Core Questions:**
1. How do you compare live performance to backtest expectations?
2. What's acceptable deviation between live and backtest results?
3. How do you detect execution problems (slippage, latency)?
4. What's paper trading and how long should you paper trade?
5. How do you attribute performance differences (market impact, timing, fees)?
6. What dashboards do quant funds use to monitor live trading?
7. How do you detect data feed problems in live trading?
8. What alerts should trigger human intervention?

**Implementation Questions:**
9. Show me code for live vs backtest performance comparison dashboard
10. How do you implement real-time P&L attribution?
11. What metrics should be tracked tick-by-tick vs daily?
12. How do you build a trading system health dashboard?

---

## SECTION 5: ADVANCED ALPHA RESEARCH

### 5.1 Alternative Data Sources

**Core Questions:**
1. What alternative data sources do quant funds use (satellite, credit card, etc.)?
2. How do you use web scraping for trading signals?
3. What's the value of news sentiment data?
4. How do you use earnings estimates and analyst ratings?
5. What blockchain/on-chain data predicts crypto prices?
6. How do you use Google Trends for trading signals?
7. What's the latency of different alternative data sources?
8. How do you evaluate if alternative data has alpha?

**Implementation Questions:**
9. Show me code for collecting and processing alternative data
10. How do you normalize alternative data for backtesting?
11. What APIs provide alternative data for trading?
12. How do you combine alternative data with price data?

---

### 5.2 Factor Investing

**Core Questions:**
1. What are the main factors (value, momentum, quality, size, volatility)?
2. How do you calculate factor exposures for assets?
3. What's factor timing and does it work?
4. How do you build a multi-factor trading strategy?
5. What's factor crowding and how do you detect it?
6. How do you neutralize unwanted factor exposures?
7. What's the difference between cross-sectional and time-series momentum?
8. How do you combine factors (linear combination, machine learning)?

**Implementation Questions:**
9. Show me code for calculating momentum and value factors
10. How do you implement factor-neutral portfolio construction?
11. What's the best lookback period for momentum (1m, 3m, 12m)?
12. How do you backtest a multi-factor strategy properly?

---

### 5.3 Machine Learning for Alpha

**Core Questions:**
1. What ML algorithms work best for return prediction (XGBoost, Neural Nets)?
2. How do you prevent overfitting in ML trading models?
3. What features (inputs) are most predictive of returns?
4. How do you handle class imbalance (few big moves, many small moves)?
5. What's the best target variable (next return, direction, magnitude)?
6. How do you do proper cross-validation for time series data?
7. What's feature importance and how do you interpret ML trading models?
8. How do you combine ML predictions with traditional rules?

**Implementation Questions:**
9. Show me production code for an XGBoost return prediction model
10. How do you implement walk-forward optimization for ML models?
11. What's the best way to do feature engineering for trading ML?
12. How do you deploy ML models for real-time trading predictions?

---

## SECTION 6: IMPLEMENTATION ARCHITECTURE

### 6.1 Research Pipeline Architecture

**Core Questions:**
1. How do you structure a quant research pipeline (data → features → models → backtest)?
2. What's the best way to version control trading research?
3. How do you manage the "research debt" of many strategy ideas?
4. What tools do quant funds use for research (Python, R, Jupyter, etc.)?
5. How do you track experiment results systematically?
6. What's reproducibility in quant research and how do you ensure it?
7. How do you collaborate on trading research in a team?
8. What's the typical time from idea to live trading?

**Implementation Questions:**
9. Show me code for a structured research pipeline
10. How do you use MLflow/Weights&Biases for trading research tracking?
11. What's the best way to store and query backtest results?
12. How do you automate the research-to-production pipeline?

---

### 6.2 Autonomous Research Agent

**Core Questions:**
1. How do you build an AI agent that conducts trading research autonomously?
2. What's the feedback loop for an autonomous research agent?
3. How do you prevent an autonomous agent from overfitting or data snooping?
4. What guardrails should an autonomous trading researcher have?
5. How do you incorporate human oversight in autonomous research?
6. What's the role of LLMs in autonomous quant research?
7. How do you measure research productivity of an autonomous system?
8. What's the state of the art in AI-driven quant research (2025-2026)?

**Implementation Questions:**
9. Show me architecture for an autonomous strategy discovery system
10. How do you implement a research agent that uses Perplexity for market analysis?
11. What's the best way to combine LLM insights with programmatic backtesting?
12. How do you build a "strategy factory" that generates and tests ideas continuously?

---

## QUICK REFERENCE: KEY CONCEPTS TO RESEARCH

| Concept | Why It Matters | Priority |
|---------|---------------|----------|
| Genetic Algorithms | Generate strategies automatically | HIGH |
| PPO/SAC Reinforcement Learning | Learn optimal policies | HIGH |
| Hidden Markov Models | Detect market regimes | HIGH |
| Kelly Criterion | Optimal position sizing | HIGH |
| Walk-Forward Optimization | Prevent overfitting | HIGH |
| Factor Investing | Proven alpha sources | MEDIUM |
| Alternative Data | Unique edge | MEDIUM |
| Online Learning | Adapt to markets | MEDIUM |
| Strategy Decay Detection | Know when to stop | MEDIUM |
| LLM Alpha Research | Novel insights | MEDIUM |

---

## SUGGESTED RESEARCH ORDER

### Phase 1: Core Strategy Generation (Research First)
1. Genetic Algorithms for trading
2. Statistical pattern mining
3. Factor investing basics

### Phase 2: Regime Awareness
4. HMM regime detection
5. Volatility regimes
6. Sentiment analysis

### Phase 3: Portfolio Management
7. Multi-strategy allocation
8. Kelly Criterion
9. Risk budgeting

### Phase 4: Continuous Improvement
10. Strategy decay detection
11. Online learning
12. Autonomous research agents

---

## EXPECTED OUTCOME

After researching these topics, Atlas will be able to:

1. **Generate** new strategy ideas using genetic algorithms and LLM research
2. **Detect** market regimes and select appropriate strategies
3. **Allocate** capital across multiple uncorrelated strategies
4. **Monitor** strategy health and detect decay
5. **Adapt** to changing market conditions
6. **Research** autonomously while you sleep

This transforms Atlas from a **strategy executor** into a **strategy factory**.
