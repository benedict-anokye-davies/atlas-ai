/**
 * Finance Intelligence Seed Data
 *
 * Pre-populated market research from Q1 2026 analysis.
 * This seeds Atlas's Finance Intelligence module with valuable research.
 *
 * Run once at initialization or call seedFinanceIntelligence() manually.
 *
 * @module trading/finance-seed
 */

import { getFinanceIntelligence, MarketResearchEntry, TechnicalSetup, Catalyst } from './finance-intelligence';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('FinanceSeed');

/**
 * Seed the finance intelligence with research data
 */
export async function seedFinanceIntelligence(): Promise<void> {
  const fi = getFinanceIntelligence();
  await fi.initialize();

  // Check if already seeded
  const existing = fi.getAllResearch();
  if (existing.some(r => r.tags.includes('seed-q1-2026'))) {
    logger.info('Finance intelligence already seeded');
    return;
  }

  logger.info('Seeding finance intelligence with Q1 2026 research...');

  // ==========================================================================
  // Macro Research: Q1 2026 Market Outlook
  // ==========================================================================

  fi.addResearch({
    type: 'macro',
    title: 'Q1 2026 Macroeconomic Outlook',
    summary: 'Soft landing confirmed but valuations stretched. Fed likely on hold Jan 28, rates at 4.25-4.50%. Core PCE at 2.8% showing sticky inflation. Labor market cooling with NFP at 50k. 79% of institutions expect 10-20% correction.',
    keyFindings: [
      'Fed Funds Rate: 4.25-4.50%, Jan 28 meeting 94-95% hold probability',
      'Core PCE: 2.8% (above 2% target), showing sticky inflation',
      'NFP: +50,000 (vs 150k avg), unemployment up to 4.4%',
      'Buffett Indicator: 221% (extreme), Shiller P/E: 40.5 (dangerous)',
      'VIX elevated at 18.5, institutional put/call ratio rising',
      'China Stimulus: 2T yuan committed, gradual implementation',
      '79% institutions expect 10-20% correction in 2025',
    ],
    riskFactors: [
      'Tariff uncertainty: 10-25% range on China, potential Mexico/Canada',
      'Geopolitical: China-Taiwan tensions, Middle East escalation',
      'Debt ceiling fight expected Q1',
      'Earnings expectations may be too high (20%+ growth priced in)',
      'Small-cap suffering (-15% from highs) showing market fragility',
    ],
    opportunities: [
      'AI infrastructure: Data centers, power, semiconductors',
      'Fintech/Crypto: Regulatory clarity under pro-crypto administration',
      'Energy: Oil neutral at $75, but geopolitical premium possible',
      'Quality defensive: Sectors with pricing power in inflationary environment',
    ],
    sources: ['Perplexity AI Research', 'CME FedWatch', 'BLS Data', 'St. Louis Fed FRED'],
    confidence: 0.85,
    tags: ['seed-q1-2026', 'macro', 'fed', 'inflation', 'valuations', 'recession-risk'],
    catalysts: [
      { date: '2025-01-28', event: 'FOMC Meeting', expectedImpact: 'high', direction: 'uncertain' },
      { date: '2025-02-07', event: 'January Jobs Report', expectedImpact: 'high', direction: 'uncertain' },
      { date: '2025-02-12', event: 'January CPI', expectedImpact: 'high', direction: 'uncertain' },
      { date: 'TBD', event: 'Debt Ceiling Resolution', expectedImpact: 'high', direction: 'bullish' },
    ],
  });

  // ==========================================================================
  // Sector Research: AI & LLM
  // ==========================================================================

  fi.addResearch({
    type: 'sector',
    title: 'AI & LLM Sector Deep Dive Q1 2026',
    summary: 'AI infrastructure remains the strongest secular trend. Data centers facing power constraints (50GW deficit). Compute demand up 10x by 2027. Key players: NVDA (chips), MSFT (cloud), power infrastructure.',
    keyFindings: [
      'Data center power demand: 50GW deficit by 2027',
      'GPU compute demand growing 10x, supply constrained',
      'Enterprise AI adoption at inflection: 65% piloting, 30% production',
      'LLM inference costs down 90% in 2 years, still falling',
      'Multi-cloud strategy becoming standard (AWS + Azure + GCP)',
      'AI Agents emerging as next major theme after RAG',
    ],
    riskFactors: [
      'NVDA margin compression as competition increases',
      'Hyperscaler capex slowdown risk if macro deteriorates',
      'Energy costs rising for data centers',
      'Regulatory risk around AI (EU AI Act, potential US legislation)',
      'Customer churn in AI services as costs fall',
    ],
    opportunities: [
      'Power infrastructure: Utilities, nuclear, grid equipment',
      'Networking: 800G switches, optical interconnects',
      'Cooling solutions: Liquid cooling becoming standard',
      'Edge AI: On-device inference chips',
      'AI software tools: Observability, security, orchestration',
    ],
    sources: ['Perplexity AI Research', 'Company 10-Ks', 'Industry Reports'],
    confidence: 0.9,
    tags: ['seed-q1-2026', 'sector', 'ai', 'llm', 'data-centers', 'semiconductors'],
    catalysts: [
      { date: '2025-02-26', event: 'NVDA Q4 Earnings', expectedImpact: 'high', direction: 'uncertain' },
      { date: '2025-01-30', event: 'MSFT Q2 Earnings', expectedImpact: 'high', direction: 'uncertain' },
      { date: 'TBD', event: 'NVDA Blackwell Ramp Updates', expectedImpact: 'high', direction: 'bullish' },
    ],
  });

  // ==========================================================================
  // Sector Research: Fintech & Crypto
  // ==========================================================================

  fi.addResearch({
    type: 'sector',
    title: 'Fintech & Crypto Sector Q1 2026',
    summary: 'Regulatory clarity emerging under pro-crypto administration. Bitcoin at $100k+, ETF flows strong ($40B+ cumulative). Stablecoin legislation expected H1 2025. COIN positioned as regulated on-ramp.',
    keyFindings: [
      'Bitcoin ETF cumulative inflows: $40B+, accelerating',
      'Bitcoin price: $100k+ established, institutional adoption growing',
      'Stablecoin market cap approaching $200B',
      'SEC chair change to crypto-friendly Gensler replacement',
      'COIN capturing 35%+ of US crypto trading volume',
      'DeFi TVL recovering, Ethereum layer-2s gaining traction',
    ],
    riskFactors: [
      'Regulatory reversal risk if administration changes priorities',
      'Crypto winter PTSD: Institutions still cautious',
      'Exchange competition increasing (Kraken, Gemini)',
      'Stablecoin regulation could fragment market',
      'Custody and security incidents damage trust',
    ],
    opportunities: [
      'Regulated exchanges: COIN dominant in US',
      'Stablecoin issuers: Circle (USDC)',
      'Bitcoin miners with low-cost power',
      'Layer-2 infrastructure plays',
      'Tokenization of real-world assets',
    ],
    sources: ['Perplexity AI Research', 'CoinGecko', 'SEC Filings', 'On-chain Data'],
    confidence: 0.85,
    tags: ['seed-q1-2026', 'sector', 'crypto', 'fintech', 'bitcoin', 'regulation'],
    catalysts: [
      { date: 'TBD', event: 'Stablecoin Legislation', expectedImpact: 'high', direction: 'bullish' },
      { date: '2025-02-13', event: 'COIN Q4 Earnings', expectedImpact: 'high', direction: 'uncertain' },
      { date: '2025-04-15', event: 'Bitcoin Halving Anniversary', expectedImpact: 'medium', direction: 'bullish' },
    ],
  });

  // ==========================================================================
  // Company Research: NVIDIA (NVDA)
  // ==========================================================================

  const nvdaTechnical: TechnicalSetup = {
    trend: 'bullish',
    pattern: 'Ascending triangle / consolidation near all-time highs',
    support: [180, 175, 160],
    resistance: [195, 200, 220],
    entryTrigger: 'Break above $188 with volume confirmation',
    entryPrice: 188,
    stopLoss: 178,
    targets: [200, 220, 250],
    riskRewardRatio: 2.4,
    probabilityBullish: 70,
    rsi: 52,
    macdSignal: 'bullish',
    volumeProfile: 'accumulation',
  };

  fi.addResearch({
    type: 'company',
    title: 'NVIDIA (NVDA) - AI Infrastructure Leader',
    ticker: 'NVDA',
    summary: 'Dominant AI semiconductor company with 80%+ data center GPU market share. Blackwell ramp providing next growth catalyst. Valuation stretched at 30x forward P/E but justified by 50%+ revenue growth.',
    keyFindings: [
      'Market cap: $4.5T, Price: $187.67',
      'Data center revenue: 85% of total, growing 50%+ YoY',
      'Blackwell GPU ramp: Demand exceeding supply through 2025',
      'Gross margins: 74% (industry-leading)',
      'Forward P/E: 30x on FY26 estimates, PEG ratio: 0.6',
      'Fair value estimate: $280-310 (DCF + peer comparison)',
    ],
    riskFactors: [
      'Valuation: High expectations priced in',
      'Competition: AMD MI350X, Intel Gaudi, custom ASICs',
      'Customer concentration: Top 5 customers = 50%+ revenue',
      'Export restrictions: China revenue at risk',
      'Margin pressure as competition intensifies',
    ],
    opportunities: [
      'Blackwell cycle: 2x performance, same power',
      'Sovereign AI: Government compute investments',
      'Robotics/autonomous: Next growth vector',
      'Networking: Spectrum-X gaining share',
      'Software moat: CUDA ecosystem stickiness',
    ],
    fairValue: 295,
    currentPrice: 187.67,
    upside: 57,
    technicalSetup: nvdaTechnical,
    sources: ['10-K Filing', 'Analyst Estimates', 'Technical Analysis'],
    confidence: 0.85,
    tags: ['seed-q1-2026', 'company', 'nvda', 'nvidia', 'semiconductors', 'ai'],
    catalysts: [
      { date: '2025-02-26', event: 'Q4 FY25 Earnings', expectedImpact: 'high', direction: 'uncertain' },
      { date: '2025-03-17', event: 'GTC 2025 (AI Developer Conference)', expectedImpact: 'high', direction: 'bullish' },
      { date: 'Q1 2025', event: 'Blackwell Production Ramp', expectedImpact: 'high', direction: 'bullish' },
    ],
  });

  // ==========================================================================
  // Company Research: Microsoft (MSFT)
  // ==========================================================================

  const msftTechnical: TechnicalSetup = {
    trend: 'bullish',
    pattern: 'Range-bound consolidation, testing resistance',
    support: [500, 480, 460],
    resistance: [530, 550, 575],
    entryTrigger: 'Pullback to $480-500 support zone',
    entryPrice: 490,
    stopLoss: 460,
    targets: [550, 600, 650],
    riskRewardRatio: 2.0,
    probabilityBullish: 65,
    rsi: 58,
    macdSignal: 'neutral',
    volumeProfile: 'neutral',
  };

  fi.addResearch({
    type: 'company',
    title: 'Microsoft (MSFT) - AI Cloud Leader',
    ticker: 'MSFT',
    summary: 'Largest cloud provider with Azure AI services growing 50%+. Copilot rollout across enterprise suite driving AI monetization. OpenAI partnership provides competitive moat.',
    keyFindings: [
      'Market cap: $3.8T, Price: $523.61',
      'Azure growth: 34% (AI services 50%+)',
      'Copilot adoption: 70% of Fortune 500 in trials',
      'Forward P/E: 32x, justified by growth profile',
      'Free cash flow: $80B+ annually',
      'Fair value estimate: $620-650',
    ],
    riskFactors: [
      'Azure growth deceleration concerns',
      'Copilot monetization slower than expected',
      'OpenAI partnership costs rising',
      'Antitrust scrutiny in EU and US',
      'Gaming division underperforming',
    ],
    opportunities: [
      'AI monetization across entire product suite',
      'Azure market share gains vs AWS',
      'Security products growing 20%+',
      'LinkedIn AI features driving engagement',
      'Autonomous agents platform launch',
    ],
    fairValue: 635,
    currentPrice: 523.61,
    upside: 21,
    technicalSetup: msftTechnical,
    sources: ['10-K Filing', 'Analyst Estimates', 'Technical Analysis'],
    confidence: 0.8,
    tags: ['seed-q1-2026', 'company', 'msft', 'microsoft', 'cloud', 'ai'],
    catalysts: [
      { date: '2025-01-30', event: 'Q2 FY25 Earnings', expectedImpact: 'high', direction: 'uncertain' },
      { date: '2025-03-25', event: 'Microsoft Ignite', expectedImpact: 'medium', direction: 'bullish' },
      { date: 'H1 2025', event: 'Copilot Enterprise Pricing Updates', expectedImpact: 'medium', direction: 'uncertain' },
    ],
  });

  // ==========================================================================
  // Company Research: Coinbase (COIN)
  // ==========================================================================

  const coinTechnical: TechnicalSetup = {
    trend: 'bullish',
    pattern: 'Breakout from consolidation, strong momentum',
    support: [200, 185, 170],
    resistance: [230, 250, 280],
    entryTrigger: 'Break above $230 resistance with volume',
    entryPrice: 230,
    stopLoss: 195,
    targets: [250, 280, 320],
    riskRewardRatio: 2.6,
    probabilityBullish: 65,
    rsi: 62,
    macdSignal: 'bullish',
    volumeProfile: 'accumulation',
  };

  fi.addResearch({
    type: 'company',
    title: 'Coinbase (COIN) - Regulated Crypto Exchange',
    ticker: 'COIN',
    summary: 'Largest US cryptocurrency exchange benefiting from regulatory clarity and institutional adoption. 35%+ US trading volume share. Subscription revenue growing faster than transaction fees.',
    keyFindings: [
      'Market cap: $53B, Price: $213.59',
      'US market share: 35%+ of trading volume',
      'Subscription revenue: 45% of total (growing faster)',
      'Institutional custody: $200B+ AUC',
      'Base chain (L2) gaining adoption',
      'Fair value estimate: $280-300',
    ],
    riskFactors: [
      'Trading volume volatility with crypto prices',
      'Competition from TradFi entering crypto',
      'Regulatory flip-flop risk',
      'Customer acquisition costs rising',
      'International expansion challenges',
    ],
    opportunities: [
      'Institutional custody growth',
      'Stablecoin revenue share (USDC)',
      'Base ecosystem development',
      'Payment rails for crypto',
      'International expansion',
    ],
    fairValue: 290,
    currentPrice: 213.59,
    upside: 36,
    technicalSetup: coinTechnical,
    sources: ['10-K Filing', 'Analyst Estimates', 'Technical Analysis'],
    confidence: 0.75,
    tags: ['seed-q1-2026', 'company', 'coin', 'coinbase', 'crypto', 'fintech'],
    catalysts: [
      { date: '2025-02-13', event: 'Q4 2024 Earnings', expectedImpact: 'high', direction: 'uncertain' },
      { date: 'H1 2025', event: 'Stablecoin Legislation', expectedImpact: 'high', direction: 'bullish' },
      { date: 'TBD', event: 'Base Ecosystem Growth Metrics', expectedImpact: 'medium', direction: 'bullish' },
    ],
  });

  // ==========================================================================
  // Add to Watchlist with Alerts
  // ==========================================================================

  fi.addToWatchlist({
    ticker: 'NVDA',
    name: 'NVIDIA Corporation',
    exchange: 'NASDAQ',
    thesis: 'AI infrastructure leader, Blackwell ramp providing next growth catalyst. Entry on breakout above $188.',
    direction: 'long',
    timeframe: 'position',
    conviction: 'high',
    entryZone: { low: 185, high: 195 },
    stopLoss: 178,
    targets: [
      { price: 220, allocation: 30 },
      { price: 250, allocation: 40 },
      { price: 280, allocation: 30 },
    ],
    status: 'watching',
    notes: ['Blackwell demand exceeding supply', 'Monitor GTC 2025 for catalysts'],
  });

  fi.addToWatchlist({
    ticker: 'MSFT',
    name: 'Microsoft Corporation',
    exchange: 'NASDAQ',
    thesis: 'AI cloud leader with Copilot monetization. Wait for pullback to $480-500 support.',
    direction: 'long',
    timeframe: 'position',
    conviction: 'medium',
    entryZone: { low: 480, high: 500 },
    stopLoss: 460,
    targets: [
      { price: 550, allocation: 40 },
      { price: 600, allocation: 40 },
      { price: 650, allocation: 20 },
    ],
    status: 'watching',
    notes: ['Azure growth key metric', 'Copilot enterprise adoption pace'],
  });

  fi.addToWatchlist({
    ticker: 'COIN',
    name: 'Coinbase Global Inc',
    exchange: 'NASDAQ',
    thesis: 'Regulated crypto play, benefiting from regulatory clarity. Entry on break above $230.',
    direction: 'long',
    timeframe: 'swing',
    conviction: 'medium',
    entryZone: { low: 220, high: 235 },
    stopLoss: 195,
    targets: [
      { price: 260, allocation: 40 },
      { price: 290, allocation: 40 },
      { price: 320, allocation: 20 },
    ],
    status: 'watching',
    notes: ['Volume correlates with BTC price', 'Stablecoin legislation catalyst'],
  });

  logger.info('Finance intelligence seeded successfully', {
    research: fi.getAllResearch().length,
    watchlist: fi.getWatchlist().length,
    alerts: fi.getActiveAlerts().length,
  });
}
