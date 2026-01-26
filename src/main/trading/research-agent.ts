/**
 * Trading Research Agent
 *
 * Atlas's research brain for trading. Integrates with:
 * - Perplexity AI for deep market research
 * - Twitter/X for real-time sentiment
 * - Reddit for retail sentiment
 * - On-chain data for whale movements
 *
 * This is how Atlas stays informed and discovers new opportunities.
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { getLLMManager } from '../llm/manager';

const logger = createModuleLogger('TradingResearch');

// =============================================================================
// Types
// =============================================================================

export interface ResearchConfig {
  perplexityApiKey?: string;
  twitterBearerToken?: string;
  redditClientId?: string;
  redditClientSecret?: string;
  enablePerplexity: boolean;
  enableTwitter: boolean;
  enableReddit: boolean;
  enableOnChain: boolean;
  researchIntervalMinutes: number;
}

export interface ResearchQuery {
  topic: string;
  context?: string;
  sources: ('perplexity' | 'twitter' | 'reddit' | 'onchain')[];
  maxResults?: number;
}

export interface ResearchResult {
  query: string;
  source: string;
  timestamp: number;
  summary: string;
  insights: string[];
  sentiment?: {
    score: number; // -1 to 1
    label: 'bearish' | 'neutral' | 'bullish';
    confidence: number;
  };
  relevantLinks?: string[];
  rawData?: unknown;
}

export interface MarketResearch {
  topic: string;
  timestamp: number;
  results: ResearchResult[];
  synthesizedInsight: string;
  actionableItems: string[];
  confidence: number;
}

export interface SentimentSnapshot {
  symbol: string;
  timestamp: number;
  twitter: {
    score: number;
    volume: number;
    trending: boolean;
    topMentions: string[];
  };
  reddit: {
    score: number;
    volume: number;
    topPosts: string[];
  };
  combined: {
    score: number;
    label: 'bearish' | 'neutral' | 'bullish';
    confidence: number;
  };
}

export interface OnChainData {
  symbol: string;
  timestamp: number;
  whaleActivity: {
    largeTransfers: number;
    netFlow: number; // positive = accumulation
    topWallets: Array<{
      address: string;
      change: number;
      direction: 'in' | 'out';
    }>;
  };
  exchangeFlow: {
    inflow: number;
    outflow: number;
    netFlow: number; // negative = bullish (leaving exchanges)
  };
  defiMetrics: {
    tvlChange: number;
    dexVolume: number;
    borrowingRate: number;
  };
  interpretation: string;
}

export interface StrategyIdea {
  name: string;
  description: string;
  hypothesis: string;
  entryRules: string[];
  exitRules: string[];
  expectedEdge: string;
  marketConditions: string[];
  riskFactors: string[];
  source: string;
  confidence: number;
  status: 'idea' | 'researching' | 'backtesting' | 'validated' | 'rejected';
}

// =============================================================================
// Research Agent Class
// =============================================================================

const DEFAULT_CONFIG: ResearchConfig = {
  perplexityApiKey: process.env.PERPLEXITY_API_KEY,
  twitterBearerToken: process.env.TWITTER_BEARER_TOKEN,
  redditClientId: process.env.REDDIT_CLIENT_ID,
  redditClientSecret: process.env.REDDIT_CLIENT_SECRET,
  enablePerplexity: true,
  enableTwitter: true,
  enableReddit: true,
  enableOnChain: true,
  researchIntervalMinutes: 30,
};

export class TradingResearchAgent extends EventEmitter {
  private config: ResearchConfig;
  private llm = getLLMManager();
  private researchCache: Map<string, MarketResearch> = new Map();
  private sentimentCache: Map<string, SentimentSnapshot> = new Map();
  private strategyIdeas: StrategyIdea[] = [];
  private researchInterval: NodeJS.Timeout | null = null;
  private isResearching: boolean = false;
  private initialized: boolean = false;

  // Tracked symbols for continuous monitoring
  private watchedSymbols: string[] = ['BTC', 'ETH', 'SOL'];

  constructor(config: Partial<ResearchConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Initialize the research agent with optional config
   */
  async initialize(config?: Partial<ResearchConfig>): Promise<void> {
    if (config) {
      this.config = { ...this.config, ...config };
    }
    this.initialized = true;
    logger.info('Trading research agent initialized', {
      perplexity: !!this.config.perplexityApiKey,
      twitter: !!this.config.twitterBearerToken,
    });
  }

  /**
   * Check if research agent is ready
   */
  isReady(): boolean {
    return this.initialized;
  }

  start(): void {
    logger.info('Starting trading research agent');

    // Initial research
    this.runResearchCycle().catch((err) => {
      logger.error('Initial research cycle failed', { error: err });
    });

    // Periodic research
    this.researchInterval = setInterval(
      () => this.runResearchCycle(),
      this.config.researchIntervalMinutes * 60 * 1000
    );
  }

  stop(): void {
    if (this.researchInterval) {
      clearInterval(this.researchInterval);
      this.researchInterval = null;
    }
    logger.info('Trading research agent stopped');
  }

  // ---------------------------------------------------------------------------
  // Perplexity Integration
  // ---------------------------------------------------------------------------

  async searchPerplexity(query: string, context?: string): Promise<ResearchResult> {
    if (!this.config.perplexityApiKey) {
      throw new Error('Perplexity API key not configured');
    }

    const systemPrompt = `You are a quantitative trading research assistant. Provide concise, actionable insights focused on:
- Market trends and momentum
- Technical analysis patterns
- Sentiment indicators
- Risk factors
- Potential trading opportunities

${context ? `Context: ${context}` : ''}

Format your response as JSON with these fields:
- summary: Brief 2-3 sentence overview
- insights: Array of specific, actionable insights
- sentiment: Object with score (-1 to 1), label (bearish/neutral/bullish), confidence (0-1)
- sources: Array of relevant source URLs if any`;

    try {
      const response = await fetch('https://api.perplexity.ai/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.perplexityApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'llama-3.1-sonar-large-128k-online',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: query },
          ],
          temperature: 0.2,
          max_tokens: 1500,
        }),
      });

      if (!response.ok) {
        throw new Error(`Perplexity API error: ${response.status}`);
      }

      const data = await response.json();
      const content = data.choices[0]?.message?.content || '';

      // Parse the JSON response
      let parsed;
      try {
        // Extract JSON from the response
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        } else {
          parsed = {
            summary: content,
            insights: [],
            sentiment: { score: 0, label: 'neutral', confidence: 0.5 },
          };
        }
      } catch {
        parsed = {
          summary: content,
          insights: [],
          sentiment: { score: 0, label: 'neutral', confidence: 0.5 },
        };
      }

      return {
        query,
        source: 'perplexity',
        timestamp: Date.now(),
        summary: parsed.summary,
        insights: parsed.insights || [],
        sentiment: parsed.sentiment,
        relevantLinks: parsed.sources || [],
        rawData: data,
      };
    } catch (error) {
      logger.error('Perplexity search failed', { error, query });
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Twitter/X Integration
  // ---------------------------------------------------------------------------

  async searchTwitter(symbol: string, maxResults: number = 100): Promise<ResearchResult> {
    if (!this.config.twitterBearerToken) {
      throw new Error('Twitter API key not configured');
    }

    const query = `${symbol} crypto (trade OR trading OR price OR bullish OR bearish) -is:retweet lang:en`;

    try {
      const response = await fetch(
        `https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(query)}&max_results=${maxResults}&tweet.fields=created_at,public_metrics,author_id`,
        {
          headers: {
            'Authorization': `Bearer ${this.config.twitterBearerToken}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Twitter API error: ${response.status}`);
      }

      const data = await response.json();
      const tweets = data.data || [];

      // Analyze sentiment
      const sentimentAnalysis = await this.analyzeSentiment(
        tweets.map((t: { text: string }) => t.text).join('\n\n'),
        symbol
      );

      // Extract top mentions
      const topMentions = tweets
        .sort((a: { public_metrics: { like_count: number } }, b: { public_metrics: { like_count: number } }) => 
          (b.public_metrics?.like_count || 0) - (a.public_metrics?.like_count || 0)
        )
        .slice(0, 5)
        .map((t: { text: string }) => t.text);

      return {
        query: symbol,
        source: 'twitter',
        timestamp: Date.now(),
        summary: `Found ${tweets.length} recent tweets about ${symbol}. ${sentimentAnalysis.label} sentiment with ${(sentimentAnalysis.confidence * 100).toFixed(0)}% confidence.`,
        insights: topMentions,
        sentiment: sentimentAnalysis,
        rawData: { tweets: tweets.length, topMentions },
      };
    } catch (error) {
      logger.error('Twitter search failed', { error, symbol });
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Reddit Integration
  // ---------------------------------------------------------------------------

  async searchReddit(symbol: string, subreddits: string[] = ['cryptocurrency', 'Bitcoin', 'ethfinance']): Promise<ResearchResult> {
    const results: Array<{ title: string; score: number; body: string }> = [];

    for (const subreddit of subreddits) {
      try {
        const response = await fetch(
          `https://www.reddit.com/r/${subreddit}/search.json?q=${symbol}&restrict_sr=1&sort=new&limit=25`,
          {
            headers: {
              'User-Agent': 'Atlas Trading Research/1.0',
            },
          }
        );

        if (response.ok) {
          const data = await response.json();
          const posts = data.data?.children || [];
          
          for (const post of posts) {
            results.push({
              title: post.data.title,
              score: post.data.score,
              body: post.data.selftext?.slice(0, 500) || '',
            });
          }
        }
      } catch (error) {
        logger.warn(`Reddit search failed for r/${subreddit}`, { error });
      }
    }

    // Sort by score and analyze sentiment
    const sortedResults = results.sort((a, b) => b.score - a.score);
    const topPosts = sortedResults.slice(0, 10);
    
    const sentimentText = topPosts.map(p => `${p.title}\n${p.body}`).join('\n\n');
    const sentimentAnalysis = await this.analyzeSentiment(sentimentText, symbol);

    return {
      query: symbol,
      source: 'reddit',
      timestamp: Date.now(),
      summary: `Found ${results.length} Reddit posts about ${symbol}. ${sentimentAnalysis.label} sentiment.`,
      insights: topPosts.map(p => p.title),
      sentiment: sentimentAnalysis,
      rawData: { totalPosts: results.length, topPosts },
    };
  }

  // ---------------------------------------------------------------------------
  // On-Chain Data Integration
  // ---------------------------------------------------------------------------

  async getOnChainData(symbol: string): Promise<OnChainData> {
    // This would integrate with services like:
    // - Glassnode
    // - Nansen
    // - Dune Analytics
    // - DefiLlama
    
    // For now, return mock structure that can be filled in
    logger.info('Fetching on-chain data', { symbol });

    // In production, integrate with actual APIs
    const mockData: OnChainData = {
      symbol,
      timestamp: Date.now(),
      whaleActivity: {
        largeTransfers: 0,
        netFlow: 0,
        topWallets: [],
      },
      exchangeFlow: {
        inflow: 0,
        outflow: 0,
        netFlow: 0,
      },
      defiMetrics: {
        tvlChange: 0,
        dexVolume: 0,
        borrowingRate: 0,
      },
      interpretation: 'On-chain data integration pending. Connect to Glassnode/Nansen APIs.',
    };

    return mockData;
  }

  // ---------------------------------------------------------------------------
  // Sentiment Analysis
  // ---------------------------------------------------------------------------

  private async analyzeSentiment(
    text: string,
    context: string
  ): Promise<{ score: number; label: 'bearish' | 'neutral' | 'bullish'; confidence: number }> {
    if (!text || text.trim().length === 0) {
      return { score: 0, label: 'neutral', confidence: 0.5 };
    }

    try {
      const prompt = `Analyze the sentiment of the following text related to ${context} trading.
      
Text:
${text.slice(0, 3000)}

Respond with JSON only:
{
  "score": <number from -1 (very bearish) to 1 (very bullish)>,
  "label": "<bearish|neutral|bullish>",
  "confidence": <number from 0 to 1>
}`;

      const response = await this.llm.generateResponse({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        maxTokens: 100,
      });

      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (error) {
      logger.warn('Sentiment analysis failed, using default', { error });
    }

    return { score: 0, label: 'neutral', confidence: 0.5 };
  }

  // ---------------------------------------------------------------------------
  // Research Synthesis
  // ---------------------------------------------------------------------------

  async conductResearch(query: ResearchQuery): Promise<MarketResearch> {
    logger.info('Conducting research', { topic: query.topic, sources: query.sources });

    const results: ResearchResult[] = [];

    // Gather from all requested sources in parallel
    const promises: Promise<ResearchResult>[] = [];

    if (query.sources.includes('perplexity') && this.config.enablePerplexity) {
      promises.push(
        this.searchPerplexity(query.topic, query.context).catch((err) => ({
          query: query.topic,
          source: 'perplexity',
          timestamp: Date.now(),
          summary: `Error: ${err.message}`,
          insights: [],
        }))
      );
    }

    if (query.sources.includes('twitter') && this.config.enableTwitter) {
      // Extract symbol from topic if possible
      const symbolMatch = query.topic.match(/\b(BTC|ETH|SOL|MATIC|AVAX)\b/i);
      if (symbolMatch) {
        promises.push(
          this.searchTwitter(symbolMatch[0]).catch((err) => ({
            query: symbolMatch[0],
            source: 'twitter',
            timestamp: Date.now(),
            summary: `Error: ${err.message}`,
            insights: [],
          }))
        );
      }
    }

    if (query.sources.includes('reddit') && this.config.enableReddit) {
      const symbolMatch = query.topic.match(/\b(BTC|ETH|SOL|MATIC|AVAX)\b/i);
      if (symbolMatch) {
        promises.push(
          this.searchReddit(symbolMatch[0]).catch((err) => ({
            query: symbolMatch[0],
            source: 'reddit',
            timestamp: Date.now(),
            summary: `Error: ${err.message}`,
            insights: [],
          }))
        );
      }
    }

    const settledResults = await Promise.all(promises);
    results.push(...settledResults);

    // Synthesize insights
    const synthesis = await this.synthesizeResearch(query.topic, results);

    const research: MarketResearch = {
      topic: query.topic,
      timestamp: Date.now(),
      results,
      synthesizedInsight: synthesis.insight,
      actionableItems: synthesis.actions,
      confidence: synthesis.confidence,
    };

    // Cache the result
    this.researchCache.set(query.topic, research);

    this.emit('research-complete', research);
    return research;
  }

  private async synthesizeResearch(
    topic: string,
    results: ResearchResult[]
  ): Promise<{ insight: string; actions: string[]; confidence: number }> {
    const summaries = results.map(r => `[${r.source}]: ${r.summary}`).join('\n\n');
    const allInsights = results.flatMap(r => r.insights);

    const prompt = `You are Atlas, an AI trading assistant. Synthesize the following research about "${topic}" into a cohesive insight.

Research summaries:
${summaries}

Key insights found:
${allInsights.map((i, idx) => `${idx + 1}. ${i}`).join('\n')}

Respond as JSON:
{
  "insight": "<2-3 sentence synthesis speaking as Atlas - use first person, be conversational>",
  "actions": ["<specific actionable item 1>", "<specific actionable item 2>", ...],
  "confidence": <0-1 how confident you are in this analysis>
}`;

    try {
      const response = await this.llm.generateResponse({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        maxTokens: 500,
      });

      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (error) {
      logger.error('Research synthesis failed', { error });
    }

    return {
      insight: `Research on ${topic} gathered from ${results.length} sources. Review individual results for details.`,
      actions: [],
      confidence: 0.5,
    };
  }

  // ---------------------------------------------------------------------------
  // Strategy Discovery
  // ---------------------------------------------------------------------------

  async discoverStrategyIdeas(): Promise<StrategyIdea[]> {
    logger.info('Discovering new strategy ideas');

    // Research latest quantitative trading techniques
    const research = await this.searchPerplexity(
      'latest quantitative trading strategies crypto 2025 momentum mean reversion machine learning',
      'Looking for novel trading strategies with edge in crypto markets'
    );

    // Generate strategy ideas from research
    const prompt = `Based on this research, generate 2-3 specific trading strategy ideas that could be implemented.

Research:
${research.summary}

Insights:
${research.insights.join('\n')}

For each strategy, provide:
- name: Short descriptive name
- description: What the strategy does
- hypothesis: Why it should work
- entryRules: Specific entry conditions
- exitRules: Specific exit conditions
- expectedEdge: Where the edge comes from
- marketConditions: When it works best
- riskFactors: What could go wrong

Respond as JSON array of strategy objects.`;

    try {
      const response = await this.llm.generateResponse({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.4,
        maxTokens: 2000,
      });

      const jsonMatch = response.content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const ideas: StrategyIdea[] = JSON.parse(jsonMatch[0]).map((idea: Partial<StrategyIdea>) => ({
          ...idea,
          source: 'perplexity-research',
          confidence: 0.5,
          status: 'idea' as const,
        }));

        this.strategyIdeas.push(...ideas);
        this.emit('strategy-ideas', ideas);
        return ideas;
      }
    } catch (error) {
      logger.error('Strategy discovery failed', { error });
    }

    return [];
  }

  // ---------------------------------------------------------------------------
  // Periodic Research Cycle
  // ---------------------------------------------------------------------------

  private async runResearchCycle(): Promise<void> {
    if (this.isResearching) {
      logger.debug('Research cycle already running, skipping');
      return;
    }

    this.isResearching = true;
    logger.info('Starting research cycle');

    try {
      // 1. Update sentiment for watched symbols
      for (const symbol of this.watchedSymbols) {
        try {
          const sentiment = await this.getSentimentSnapshot(symbol);
          this.sentimentCache.set(symbol, sentiment);
          this.emit('sentiment-update', sentiment);
        } catch (error) {
          logger.warn(`Failed to get sentiment for ${symbol}`, { error });
        }
      }

      // 2. Conduct general market research
      await this.conductResearch({
        topic: 'crypto market outlook momentum trends',
        sources: ['perplexity'],
      });

      // 3. Look for new strategy ideas (weekly)
      const lastStrategyResearch = this.strategyIdeas[this.strategyIdeas.length - 1]?.source;
      if (!lastStrategyResearch || Date.now() - (this.strategyIdeas[this.strategyIdeas.length - 1] as unknown as { timestamp: number })?.timestamp > 7 * 24 * 60 * 60 * 1000) {
        await this.discoverStrategyIdeas();
      }

      logger.info('Research cycle completed');
    } catch (error) {
      logger.error('Research cycle failed', { error });
    } finally {
      this.isResearching = false;
    }
  }

  async getSentimentSnapshot(symbol: string): Promise<SentimentSnapshot> {
    const [twitter, reddit] = await Promise.all([
      this.config.enableTwitter ? this.searchTwitter(symbol, 50).catch(() => null) : null,
      this.config.enableReddit ? this.searchReddit(symbol).catch(() => null) : null,
    ]);

    const twitterScore = twitter?.sentiment?.score || 0;
    const redditScore = reddit?.sentiment?.score || 0;
    const combinedScore = (twitterScore * 0.6 + redditScore * 0.4); // Weight Twitter higher

    return {
      symbol,
      timestamp: Date.now(),
      twitter: {
        score: twitterScore,
        volume: (twitter?.rawData as { tweets?: number })?.tweets || 0,
        trending: (twitter?.rawData as { tweets?: number })?.tweets > 80,
        topMentions: (twitter?.insights || []).slice(0, 3),
      },
      reddit: {
        score: redditScore,
        volume: (reddit?.rawData as { totalPosts?: number })?.totalPosts || 0,
        topPosts: (reddit?.insights || []).slice(0, 3),
      },
      combined: {
        score: combinedScore,
        label: combinedScore > 0.2 ? 'bullish' : combinedScore < -0.2 ? 'bearish' : 'neutral',
        confidence: Math.max(twitter?.sentiment?.confidence || 0, reddit?.sentiment?.confidence || 0),
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Natural Language Interface
  // ---------------------------------------------------------------------------

  async answerQuestion(question: string): Promise<string> {
    // First, check if we have relevant cached research
    const relevantCache = Array.from(this.researchCache.values())
      .filter(r => Date.now() - r.timestamp < 3600000) // Last hour
      .filter(r => question.toLowerCase().includes(r.topic.toLowerCase().split(' ')[0]));

    if (relevantCache.length > 0) {
      return relevantCache[0].synthesizedInsight;
    }

    // Conduct new research
    const research = await this.conductResearch({
      topic: question,
      sources: ['perplexity'],
    });

    return research.synthesizedInsight;
  }

  async getMarketBrief(): Promise<string> {
    const sentiments = Array.from(this.sentimentCache.values());
    
    if (sentiments.length === 0) {
      return "Haven't gathered market sentiment yet. Give me a moment to research.";
    }

    const parts: string[] = [];
    
    for (const s of sentiments) {
      const emoji = s.combined.label === 'bullish' ? '📈' : s.combined.label === 'bearish' ? '📉' : '➡️';
      parts.push(`${s.symbol}: ${s.combined.label} sentiment (${(s.combined.score * 100).toFixed(0)}% score)`);
    }

    return `Current market sentiment:\n\n${parts.join('\n')}\n\nBased on Twitter and Reddit analysis from the last ${this.config.researchIntervalMinutes} minutes.`;
  }

  // ---------------------------------------------------------------------------
  // State Access
  // ---------------------------------------------------------------------------

  getWatchedSymbols(): string[] {
    return [...this.watchedSymbols];
  }

  addWatchedSymbol(symbol: string): void {
    if (!this.watchedSymbols.includes(symbol.toUpperCase())) {
      this.watchedSymbols.push(symbol.toUpperCase());
    }
  }

  removeWatchedSymbol(symbol: string): void {
    this.watchedSymbols = this.watchedSymbols.filter(s => s !== symbol.toUpperCase());
  }

  getStrategyIdeas(): StrategyIdea[] {
    return [...this.strategyIdeas];
  }

  getCachedResearch(topic: string): MarketResearch | undefined {
    return this.researchCache.get(topic);
  }

  getCachedSentiment(symbol: string): SentimentSnapshot | undefined {
    return this.sentimentCache.get(symbol);
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let researchAgentInstance: TradingResearchAgent | null = null;

export function getTradingResearchAgent(config?: Partial<ResearchConfig>): TradingResearchAgent {
  if (!researchAgentInstance) {
    researchAgentInstance = new TradingResearchAgent(config);
    logger.info('Trading research agent created');
  }
  return researchAgentInstance;
}

export function resetTradingResearchAgent(): void {
  if (researchAgentInstance) {
    researchAgentInstance.stop();
    researchAgentInstance = null;
  }
}
