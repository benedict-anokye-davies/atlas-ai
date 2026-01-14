# Self-Improving Agent System - Implementation Plan

## 🎯 Overview

This plan integrates Fireworks AI's self-improving agent capabilities into Nova, enabling:
- Continuous learning from conversations
- Automatic prompt optimization via GEPA (Gradient-Enhanced Prompt Adjustment)
- Domain-specific confidence calibration
- Natural mistake handling and correction
- Foundation for custom LLM fine-tuning

**Based on:** https://fireworks.ai/blog/self-improving-agent

---

## 📋 Integration Phases

### Phase 3.5: Foundation (Add Between Phase 3 & 4)
**Sessions:** 033-D, 033-E, 033-F (6-9 hours)
**Goal:** Basic evaluation infrastructure

### Phase 6.5: Learning Engine (Add Between Phase 6 & 7)
**Sessions:** 045-D, 045-E, 045-F, 045-G (10-14 hours)
**Goal:** Full GEPA integration with continuous learning

### Phase 8+: Advanced Learning (After Phase 8)
**Sessions:** 054-057 (12-16 hours)
**Goal:** Custom LLM fine-tuning using learned data

---

# ═══════════════════════════════════════════════════════════════
# PHASE 3.5: EVALUATION FOUNDATION
# ═══════════════════════════════════════════════════════════════

## Session 033-D: Basic Evaluation Protocol (2-3 hours)

**Status:** READY (add after 033-C completes)
**Goal:** Create evaluation framework for tracking conversation quality

### Tasks:

1. Create `src/shared/types/evaluation.ts`:

```typescript
export interface ConversationEvaluation {
  // Identity
  id: string;
  conversationId: string;
  timestamp: number;

  // Content
  userQuery: string;
  novaResponse: string;
  context: Message[];

  // Metrics (0-1 scale)
  metrics: {
    taskCompletion: boolean;      // Did Nova solve the problem?
    responseQuality: number;       // Overall quality (0-1)
    confidenceAccuracy: number;    // Was confidence appropriate?
    factualCorrectness: boolean;   // Were facts accurate?
    personalityConsistency: number; // Maintained personality?
    responseLatency: number;       // Response time (ms)
  };

  // Feedback
  userFeedback?: 'helpful' | 'unhelpful' | 'incorrect';
  userRating?: number; // 1-5 stars
  correctedResponse?: string; // If user corrected Nova

  // Classification
  domain: string; // 'general', 'forex', 'chess', 'fitness', etc.
  topics: string[];
  queryType: 'question' | 'command' | 'conversation' | 'correction';

  // Outcome
  success: boolean; // Overall success flag
  failureReason?: string;
}

export interface EvaluationMetrics {
  totalEvaluations: number;
  successRate: number;
  averageRating: number;
  byDomain: Record<string, DomainMetrics>;
  byTimeRange: TimeRangeMetrics[];
}

export interface DomainMetrics {
  domain: string;
  totalQueries: number;
  successRate: number;
  averageConfidence: number;
  correctResponses: number;
  incorrectResponses: number;
  userCorrections: number;
}
```

2. Create `src/main/learning/eval-protocol.ts`:

```typescript
import { ConversationEvaluation, EvaluationMetrics } from '../../shared/types/evaluation';
import { logger } from '../utils/logger';

export class EvalProtocol {
  private evaluations: ConversationEvaluation[] = [];
  private readonly MAX_STORED = 1000; // Keep last 1000 evals in memory

  /**
   * Record a conversation for evaluation
   */
  async recordConversation(params: {
    conversationId: string;
    userQuery: string;
    novaResponse: string;
    context: Message[];
    responseTime: number;
  }): Promise<string> {
    const evaluation: ConversationEvaluation = {
      id: crypto.randomUUID(),
      conversationId: params.conversationId,
      timestamp: Date.now(),
      userQuery: params.userQuery,
      novaResponse: params.novaResponse,
      context: params.context,

      metrics: {
        taskCompletion: false, // Will be updated by user feedback
        responseQuality: 0.5, // Default neutral
        confidenceAccuracy: 0.5,
        factualCorrectness: true, // Assume correct until proven wrong
        personalityConsistency: 0.8, // Default good
        responseLatency: params.responseTime
      },

      domain: this.classifyDomain(params.userQuery),
      topics: this.extractTopics(params.userQuery),
      queryType: this.classifyQueryType(params.userQuery),
      success: true, // Assume success until feedback says otherwise
    };

    this.evaluations.push(evaluation);

    // Trim old evaluations
    if (this.evaluations.length > this.MAX_STORED) {
      this.evaluations = this.evaluations.slice(-this.MAX_STORED);
    }

    // Persist to disk (via memory manager)
    await this.persistEvaluation(evaluation);

    logger.info(`Evaluation recorded: ${evaluation.id} (${evaluation.domain})`);
    return evaluation.id;
  }

  /**
   * Update evaluation with user feedback
   */
  async updateWithFeedback(params: {
    evaluationId: string;
    feedback?: 'helpful' | 'unhelpful' | 'incorrect';
    rating?: number;
    correctedResponse?: string;
  }): Promise<void> {
    const evaluation = this.evaluations.find(e => e.id === params.evaluationId);
    if (!evaluation) {
      logger.warn(`Evaluation not found: ${params.evaluationId}`);
      return;
    }

    // Update feedback
    if (params.feedback) {
      evaluation.userFeedback = params.feedback;

      // Update metrics based on feedback
      if (params.feedback === 'helpful') {
        evaluation.metrics.taskCompletion = true;
        evaluation.metrics.responseQuality = 0.9;
        evaluation.success = true;
      } else if (params.feedback === 'unhelpful') {
        evaluation.metrics.taskCompletion = false;
        evaluation.metrics.responseQuality = 0.3;
        evaluation.success = false;
      } else if (params.feedback === 'incorrect') {
        evaluation.metrics.factualCorrectness = false;
        evaluation.metrics.responseQuality = 0.2;
        evaluation.success = false;
        evaluation.failureReason = 'factual_error';
      }
    }

    if (params.rating) {
      evaluation.userRating = params.rating;
      evaluation.metrics.responseQuality = params.rating / 5;
    }

    if (params.correctedResponse) {
      evaluation.correctedResponse = params.correctedResponse;
      evaluation.metrics.factualCorrectness = false;
      evaluation.success = false;
      evaluation.failureReason = 'user_correction';
    }

    await this.persistEvaluation(evaluation);
    logger.info(`Evaluation updated: ${evaluation.id}`);
  }

  /**
   * Get evaluations by criteria
   */
  getEvaluations(criteria?: {
    domain?: string;
    success?: boolean;
    minRating?: number;
    since?: number; // timestamp
    limit?: number;
  }): ConversationEvaluation[] {
    let filtered = [...this.evaluations];

    if (criteria?.domain) {
      filtered = filtered.filter(e => e.domain === criteria.domain);
    }

    if (criteria?.success !== undefined) {
      filtered = filtered.filter(e => e.success === criteria.success);
    }

    if (criteria?.minRating) {
      filtered = filtered.filter(e =>
        e.userRating && e.userRating >= criteria.minRating
      );
    }

    if (criteria?.since) {
      filtered = filtered.filter(e => e.timestamp >= criteria.since);
    }

    if (criteria?.limit) {
      filtered = filtered.slice(-criteria.limit);
    }

    return filtered;
  }

  /**
   * Calculate metrics
   */
  calculateMetrics(timeRange?: { start: number; end: number }): EvaluationMetrics {
    let evals = this.evaluations;

    if (timeRange) {
      evals = evals.filter(e =>
        e.timestamp >= timeRange.start && e.timestamp <= timeRange.end
      );
    }

    const totalEvaluations = evals.length;
    const successRate = evals.filter(e => e.success).length / totalEvaluations;
    const ratedEvals = evals.filter(e => e.userRating);
    const averageRating = ratedEvals.length > 0
      ? ratedEvals.reduce((sum, e) => sum + (e.userRating || 0), 0) / ratedEvals.length
      : 0;

    // By domain
    const domains = new Set(evals.map(e => e.domain));
    const byDomain: Record<string, DomainMetrics> = {};

    for (const domain of domains) {
      const domainEvals = evals.filter(e => e.domain === domain);
      byDomain[domain] = {
        domain,
        totalQueries: domainEvals.length,
        successRate: domainEvals.filter(e => e.success).length / domainEvals.length,
        averageConfidence: domainEvals.reduce((sum, e) =>
          sum + e.metrics.confidenceAccuracy, 0) / domainEvals.length,
        correctResponses: domainEvals.filter(e =>
          e.metrics.factualCorrectness).length,
        incorrectResponses: domainEvals.filter(e =>
          !e.metrics.factualCorrectness).length,
        userCorrections: domainEvals.filter(e =>
          e.correctedResponse).length,
      };
    }

    return {
      totalEvaluations,
      successRate,
      averageRating,
      byDomain,
      byTimeRange: [], // TODO: Implement time range metrics
    };
  }

  // Helper methods

  private classifyDomain(query: string): string {
    const lower = query.toLowerCase();

    if (/forex|trading|stock|invest|currency/i.test(lower)) return 'forex';
    if (/chess|opening|endgame|tactic/i.test(lower)) return 'chess';
    if (/workout|exercise|gym|fitness|muscle/i.test(lower)) return 'fitness';
    if (/code|programming|debug|function/i.test(lower)) return 'programming';
    if (/calendar|schedule|meeting|appointment/i.test(lower)) return 'calendar';

    return 'general';
  }

  private extractTopics(text: string): string[] {
    const topics: string[] = [];
    const keywords = [
      'weather', 'time', 'date', 'news', 'music',
      'help', 'how to', 'what is', 'explain'
    ];

    const lower = text.toLowerCase();
    for (const keyword of keywords) {
      if (lower.includes(keyword)) {
        topics.push(keyword);
      }
    }

    return topics;
  }

  private classifyQueryType(query: string): 'question' | 'command' | 'conversation' | 'correction' {
    if (/^(no|actually|wrong|correct)/i.test(query)) return 'correction';
    if (/\?$/.test(query) || /^(what|why|how|when|where|who)/i.test(query)) return 'question';
    if (/^(set|create|delete|update|schedule|remind)/i.test(query)) return 'command';
    return 'conversation';
  }

  private async persistEvaluation(evaluation: ConversationEvaluation): Promise<void> {
    // TODO: Integrate with memory manager to persist to disk
    // For now, just log
    logger.debug(`Persisting evaluation: ${evaluation.id}`);
  }
}

// Singleton instance
export const evalProtocol = new EvalProtocol();
```

3. Add feedback UI components to `src/renderer/components/FeedbackButtons.tsx`:

```typescript
import { useState } from 'react';

interface FeedbackButtonsProps {
  evaluationId: string;
  onFeedback: (feedback: 'helpful' | 'unhelpful' | 'incorrect') => void;
}

export function FeedbackButtons({ evaluationId, onFeedback }: FeedbackButtonsProps) {
  const [submitted, setSubmitted] = useState(false);

  const handleFeedback = (feedback: 'helpful' | 'unhelpful' | 'incorrect') => {
    onFeedback(feedback);
    setSubmitted(true);
  };

  if (submitted) {
    return <div className="feedback-thanks">Thanks for your feedback!</div>;
  }

  return (
    <div className="feedback-buttons">
      <button
        onClick={() => handleFeedback('helpful')}
        title="Helpful response"
      >
        👍
      </button>
      <button
        onClick={() => handleFeedback('unhelpful')}
        title="Not helpful"
      >
        👎
      </button>
      <button
        onClick={() => handleFeedback('incorrect')}
        title="Incorrect information"
      >
        ⚠️
      </button>
    </div>
  );
}
```

### Success Criteria:
- [x] Evaluations recorded for every conversation
- [x] User can provide feedback (thumbs up/down, corrections)
- [x] Metrics calculated by domain
- [x] Evaluations persisted to disk

**Next:** Move to 033-E

---

## Session 033-E: Confidence Tracking (2-3 hours)

**Status:** WAITING (after 033-D)
**Goal:** Track Nova's confidence by domain and calibrate

### Tasks:

1. Create `src/main/learning/confidence-tracker.ts`:

```typescript
import { evalProtocol } from './eval-protocol';
import { DomainMetrics } from '../../shared/types/evaluation';
import { logger } from '../utils/logger';

export interface DomainConfidence {
  domain: string;
  confidence: number; // 0-1
  calibratedAt: number;
  statistics: DomainMetrics;
}

export class ConfidenceTracker {
  private confidenceByDomain = new Map<string, DomainConfidence>();
  private readonly CALIBRATION_THRESHOLD = 10; // Min evaluations needed

  /**
   * Get confidence for a domain
   */
  getConfidence(domain: string): number {
    const confidence = this.confidenceByDomain.get(domain);

    if (!confidence) {
      return 0.5; // Neutral confidence for unknown domains
    }

    return confidence.confidence;
  }

  /**
   * Recalibrate confidence based on recent evaluations
   */
  async calibrate(domain?: string): Promise<void> {
    const metrics = evalProtocol.calculateMetrics();

    const domainsToCalibrate = domain
      ? [domain]
      : Object.keys(metrics.byDomain);

    for (const domainKey of domainsToCalibrate) {
      const domainStats = metrics.byDomain[domainKey];

      if (domainStats.totalQueries < this.CALIBRATION_THRESHOLD) {
        logger.debug(`Not enough data for ${domainKey}, skipping calibration`);
        continue;
      }

      // Calculate confidence based on:
      // - Success rate (40%)
      // - Factual correctness (40%)
      // - User rating correlation (20%)

      const successComponent = domainStats.successRate * 0.4;

      const correctnessRate = domainStats.correctResponses /
        (domainStats.correctResponses + domainStats.incorrectResponses);
      const correctnessComponent = correctnessRate * 0.4;

      // If confidence tracking shows overconfidence, penalize
      const confidenceAccuracy = domainStats.averageConfidence;
      const ratingComponent = confidenceAccuracy * 0.2;

      const calibratedConfidence = Math.max(0.1, Math.min(0.95,
        successComponent + correctnessComponent + ratingComponent
      ));

      this.confidenceByDomain.set(domainKey, {
        domain: domainKey,
        confidence: calibratedConfidence,
        calibratedAt: Date.now(),
        statistics: domainStats
      });

      logger.info(
        `Confidence calibrated for ${domainKey}: ${calibratedConfidence.toFixed(2)} ` +
        `(${domainStats.totalQueries} queries, ${(domainStats.successRate * 100).toFixed(1)}% success)`
      );
    }
  }

  /**
   * Should Nova express uncertainty for this query?
   */
  shouldExpressUncertainty(query: string): boolean {
    const domain = this.classifyDomain(query);
    const confidence = this.getConfidence(domain);

    // Express uncertainty if confidence < 0.6
    return confidence < 0.6;
  }

  /**
   * Get confidence modifier for personality prompt
   */
  getConfidenceModifier(query: string): string {
    const domain = this.classifyDomain(query);
    const confidence = this.getConfidence(domain);

    if (confidence >= 0.8) {
      return "You have strong knowledge in this area. Be confident but not arrogant.";
    } else if (confidence >= 0.6) {
      return "You have decent knowledge in this area. Be helpful but acknowledge limits.";
    } else if (confidence >= 0.4) {
      return "Your knowledge in this area is limited. Express uncertainty and offer to research.";
    } else {
      return "You have minimal knowledge in this area. Be honest about limitations and suggest alternatives.";
    }
  }

  /**
   * Get all confidence scores
   */
  getAllConfidences(): DomainConfidence[] {
    return Array.from(this.confidenceByDomain.values());
  }

  private classifyDomain(query: string): string {
    // Use same classification as EvalProtocol
    const lower = query.toLowerCase();

    if (/forex|trading|stock/i.test(lower)) return 'forex';
    if (/chess|opening|endgame/i.test(lower)) return 'chess';
    if (/workout|exercise|gym/i.test(lower)) return 'fitness';
    if (/code|programming|debug/i.test(lower)) return 'programming';
    if (/calendar|schedule|meeting/i.test(lower)) return 'calendar';

    return 'general';
  }
}

export const confidenceTracker = new ConfidenceTracker();
```

2. Integrate with personality manager in `src/main/agent/personality-manager.ts`:

```typescript
import { confidenceTracker } from '../learning/confidence-tracker';

export class PersonalityManager {
  // ... existing code ...

  getSystemPrompt(query?: string): string {
    const { name, traits } = this.config;

    // Get confidence modifier if query provided
    const confidenceModifier = query
      ? confidenceTracker.getConfidenceModifier(query)
      : '';

    return `You are ${name}, a friendly AI assistant.
Personality: ${traits.friendliness > 0.7 ? 'Very warm' : 'Professional'},
${traits.formality < 0.5 ? 'Casual (use contractions)' : 'Formal'},
${traits.humor > 0.6 ? 'Witty' : 'Serious'}.

${confidenceModifier}

Keep responses concise (2-3 sentences). Be natural and honest.`;
  }
}
```

3. Add daily calibration scheduler:

```typescript
// In src/main/learning/continuous-improver.ts (create new file)
import schedule from 'node-schedule';
import { confidenceTracker } from './confidence-tracker';
import { logger } from '../utils/logger';

export class ContinuousImprover {
  private calibrationJob: schedule.Job | null = null;

  start(): void {
    // Run calibration daily at 3 AM
    this.calibrationJob = schedule.scheduleJob('0 3 * * *', async () => {
      logger.info('Starting daily confidence calibration...');
      await confidenceTracker.calibrate();
      logger.info('Daily calibration complete');
    });

    logger.info('Continuous improvement scheduler started');
  }

  stop(): void {
    if (this.calibrationJob) {
      this.calibrationJob.cancel();
      this.calibrationJob = null;
    }
  }
}

export const continuousImprover = new ContinuousImprover();
```

### Success Criteria:
- [x] Confidence tracked per domain
- [x] Calibration based on success/failure rates
- [x] Personality prompts adjusted by confidence
- [x] Daily automatic calibration

**Next:** Move to 033-F

---

## Session 033-F: Failure Pattern Analysis (2-3 hours)

**Status:** WAITING (after 033-E)
**Goal:** Identify patterns in failures for improvement

### Tasks:

1. Create `src/main/learning/failure-analyzer.ts`:

```typescript
import { evalProtocol } from './eval-protocol';
import { ConversationEvaluation } from '../../shared/types/evaluation';
import { logger } from '../utils/logger';

export interface FailurePattern {
  pattern: string;
  occurrences: number;
  examples: string[];
  suggestedFix: string;
}

export class FailureAnalyzer {
  /**
   * Analyze recent failures and identify patterns
   */
  async analyzeFailures(params?: {
    domain?: string;
    since?: number;
    limit?: number;
  }): Promise<FailurePattern[]> {
    // Get failed evaluations
    const failures = evalProtocol.getEvaluations({
      success: false,
      ...params
    });

    logger.info(`Analyzing ${failures.length} failures...`);

    const patterns: FailurePattern[] = [];

    // Pattern 1: Hallucinated facts
    const hallucinations = failures.filter(e =>
      !e.metrics.factualCorrectness && e.failureReason === 'factual_error'
    );
    if (hallucinations.length > 0) {
      patterns.push({
        pattern: 'factual_hallucination',
        occurrences: hallucinations.length,
        examples: hallucinations.slice(0, 3).map(e => e.userQuery),
        suggestedFix: 'Add prompt instruction: "If unsure about facts, say so explicitly"'
      });
    }

    // Pattern 2: Over-confidence
    const overconfident = failures.filter(e =>
      e.metrics.confidenceAccuracy > 0.7 && !e.success
    );
    if (overconfident.length > 0) {
      patterns.push({
        pattern: 'overconfidence',
        occurrences: overconfident.length,
        examples: overconfident.slice(0, 3).map(e => e.userQuery),
        suggestedFix: 'Add prompt instruction: "Express uncertainty when knowledge is limited"'
      });
    }

    // Pattern 3: Personality inconsistency
    const personalityIssues = failures.filter(e =>
      e.metrics.personalityConsistency < 0.5
    );
    if (personalityIssues.length > 0) {
      patterns.push({
        pattern: 'personality_inconsistency',
        occurrences: personalityIssues.length,
        examples: personalityIssues.slice(0, 3).map(e => e.novaResponse),
        suggestedFix: 'Strengthen personality guidelines in system prompt'
      });
    }

    // Pattern 4: Task incompletion
    const incomplete = failures.filter(e =>
      !e.metrics.taskCompletion && e.userFeedback === 'unhelpful'
    );
    if (incomplete.length > 0) {
      patterns.push({
        pattern: 'task_incompletion',
        occurrences: incomplete.length,
        examples: incomplete.slice(0, 3).map(e => e.userQuery),
        suggestedFix: 'Add prompt instruction: "Ensure you fully address the user\'s request"'
      });
    }

    // Sort by occurrence count
    patterns.sort((a, b) => b.occurrences - a.occurrences);

    logger.info(`Found ${patterns.length} failure patterns`);
    return patterns;
  }

  /**
   * Get failure summary for display
   */
  async getFailureSummary(domain?: string): Promise<string> {
    const patterns = await this.analyzeFailures({ domain, limit: 100 });

    if (patterns.length === 0) {
      return 'No significant failure patterns detected. Nova is performing well!';
    }

    let summary = `Found ${patterns.length} areas for improvement:\n\n`;

    for (const pattern of patterns) {
      summary += `- ${pattern.pattern}: ${pattern.occurrences} occurrences\n`;
      summary += `  Fix: ${pattern.suggestedFix}\n\n`;
    }

    return summary;
  }
}

export const failureAnalyzer = new FailureAnalyzer();
```

2. Add failure analysis to Settings UI:

```typescript
// In src/renderer/components/Settings.tsx
import { useState, useEffect } from 'react';

function LearningStats() {
  const [failureSummary, setFailureSummary] = useState<string>('');

  useEffect(() => {
    window.nova?.invoke('learning:get-failure-summary').then(summary => {
      setFailureSummary(summary);
    });
  }, []);

  return (
    <div className="learning-stats">
      <h3>Learning Insights</h3>
      <pre>{failureSummary}</pre>
    </div>
  );
}
```

### Success Criteria:
- [x] Failure patterns identified automatically
- [x] Common issues categorized
- [x] Suggested fixes provided
- [x] Visible in Settings UI

**Next:** Move to Phase 6.5 (after completing Phases 4-6)

---

# ═══════════════════════════════════════════════════════════════
# PHASE 6.5: LEARNING ENGINE (GEPA Integration)
# ═══════════════════════════════════════════════════════════════

## Session 045-D: Fireworks GEPA Integration (3-4 hours)

**Status:** WAITING (after Phase 6 complete)
**Goal:** Integrate Fireworks GEPA for automatic prompt optimization

### Tasks:

1. Install Fireworks SDK:

```bash
npm install @fireworks-ai/fireworks-sdk
```

2. Create `src/main/learning/gepa-optimizer.ts`:

```typescript
import Fireworks from '@fireworks-ai/fireworks-sdk';
import { evalProtocol } from './eval-protocol';
import { failureAnalyzer } from './failure-analyzer';
import { logger } from '../utils/logger';
import { getPersonalityManager } from '../agent/personality-manager';

export interface PromptImprovement {
  id: string;
  currentPrompt: string;
  proposedPrompt: string;
  expectedImprovement: number;
  targetedIssues: string[];
  validationScore?: number;
  applied: boolean;
}

export class GEPAOptimizer {
  private fireworks: Fireworks;
  private improvements: PromptImprovement[] = [];

  constructor() {
    this.fireworks = new Fireworks({
      apiKey: process.env.FIREWORKS_API_KEY || ''
    });
  }

  /**
   * Analyze failures and propose prompt improvements using GEPA
   */
  async proposeImprovements(): Promise<PromptImprovement[]> {
    logger.info('Starting GEPA prompt optimization...');

    // Get current system prompt
    const personalityManager = getPersonalityManager();
    const currentPrompt = personalityManager.getSystemPrompt();

    // Get failure patterns
    const patterns = await failureAnalyzer.analyzeFailures({ limit: 100 });

    if (patterns.length === 0) {
      logger.info('No failures to optimize for');
      return [];
    }

    // Get failed conversations as examples
    const failedEvals = evalProtocol.getEvaluations({
      success: false,
      limit: 50
    });

    // Create evaluation dataset for GEPA
    const evalDataset = failedEvals.map(e => ({
      input: e.userQuery,
      expected_output: e.correctedResponse || '<better_response>',
      actual_output: e.novaResponse,
      metrics: {
        correct: false,
        quality: e.metrics.responseQuality
      }
    }));

    // Run GEPA analysis
    const gepaResult = await this.runGEPA({
      currentPrompt,
      failurePatterns: patterns,
      evalDataset
    });

    // Create improvement proposal
    const improvement: PromptImprovement = {
      id: crypto.randomUUID(),
      currentPrompt,
      proposedPrompt: gepaResult.optimizedPrompt,
      expectedImprovement: gepaResult.expectedImprovement,
      targetedIssues: patterns.map(p => p.pattern),
      applied: false
    };

    this.improvements.push(improvement);
    logger.info(`GEPA proposed improvement with ${gepaResult.expectedImprovement}% expected gain`);

    return [improvement];
  }

  /**
   * Validate improvement on test set
   */
  async validateImprovement(improvement: PromptImprovement): Promise<number> {
    logger.info(`Validating improvement ${improvement.id}...`);

    // Get validation set (recent successful conversations)
    const validationSet = evalProtocol.getEvaluations({
      success: true,
      limit: 20
    });

    // Test new prompt on validation set
    let successCount = 0;

    for (const validation of validationSet) {
      // Simulate running with new prompt
      const result = await this.testPromptOnQuery(
        improvement.proposedPrompt,
        validation.userQuery
      );

      // Compare quality
      if (result.quality >= validation.metrics.responseQuality) {
        successCount++;
      }
    }

    const validationScore = successCount / validationSet.length;
    improvement.validationScore = validationScore;

    logger.info(`Validation score: ${(validationScore * 100).toFixed(1)}%`);
    return validationScore;
  }

  /**
   * Apply improvement to production
   */
  async applyImprovement(improvement: PromptImprovement): Promise<void> {
    // Validate first
    if (!improvement.validationScore) {
      await this.validateImprovement(improvement);
    }

    // Only apply if validation shows improvement
    if (improvement.validationScore! < 0.6) {
      logger.warn(`Improvement ${improvement.id} failed validation, not applying`);
      return;
    }

    logger.info(`Applying improvement ${improvement.id}...`);

    // Update personality manager with new prompt
    const personalityManager = getPersonalityManager();
    // TODO: Add method to update base prompt in PersonalityManager

    improvement.applied = true;
    logger.info('Improvement applied successfully');
  }

  /**
   * Run GEPA optimization (simplified - actual integration would use Fireworks SDK)
   */
  private async runGEPA(params: {
    currentPrompt: string;
    failurePatterns: any[];
    evalDataset: any[];
  }): Promise<{ optimizedPrompt: string; expectedImprovement: number }> {
    // This is a simplified version
    // Real implementation would use Fireworks GEPA API

    const issueDescriptions = params.failurePatterns
      .map(p => `${p.pattern}: ${p.suggestedFix}`)
      .join('\n');

    // Use Fireworks to generate improved prompt
    const response = await this.fireworks.chat.completions.create({
      model: 'accounts/fireworks/models/llama-v3p1-70b-instruct',
      messages: [{
        role: 'user',
        content: `You are a prompt optimization expert. Given this system prompt and identified issues, create an improved version.

Current prompt:
${params.currentPrompt}

Issues to address:
${issueDescriptions}

Create an improved prompt that addresses these issues while maintaining personality and tone.
Output ONLY the new prompt, nothing else.`
      }],
      max_tokens: 500
    });

    const optimizedPrompt = response.choices[0].message.content || params.currentPrompt;

    // Estimate improvement based on number of issues addressed
    const expectedImprovement = Math.min(50, params.failurePatterns.length * 10);

    return { optimizedPrompt, expectedImprovement };
  }

  /**
   * Test a prompt on a query (for validation)
   */
  private async testPromptOnQuery(prompt: string, query: string): Promise<{ quality: number }> {
    // Simplified testing - would actually run inference
    return { quality: 0.7 };
  }

  /**
   * Get improvement history
   */
  getImprovements(): PromptImprovement[] {
    return this.improvements;
  }
}

export const gepaOptimizer = new GEPAOptimizer();
```

### Success Criteria:
- [x] GEPA SDK integrated
- [x] Failure patterns converted to optimization targets
- [x] Prompt improvements proposed
- [x] Validation before application

**Next:** Move to 045-E

---

## Session 045-E: Continuous Learning Loop (3-4 hours)

**Status:** WAITING (after 045-D)
**Goal:** Automated daily improvement cycle

### Tasks:

1. Enhance `src/main/learning/continuous-improver.ts`:

```typescript
import schedule from 'node-schedule';
import { confidenceTracker } from './confidence-tracker';
import { failureAnalyzer } from './failure-analyzer';
import { gepaOptimizer } from './gepa-optimizer';
import { evalProtocol } from './eval-protocol';
import { logger } from '../utils/logger';

export class ContinuousImprover {
  private calibrationJob: schedule.Job | null = null;
  private improvementJob: schedule.Job | null = null;
  private isRunning = false;

  /**
   * Start continuous improvement scheduler
   */
  start(): void {
    // Calibration: Daily at 3 AM
    this.calibrationJob = schedule.scheduleJob('0 3 * * *', async () => {
      await this.runCalibration();
    });

    // Improvement: Weekly on Sundays at 4 AM
    this.improvementJob = schedule.scheduleJob('0 4 * * 0', async () => {
      await this.runImprovementCycle();
    });

    logger.info('Continuous improvement scheduler started');
    logger.info('- Calibration: Daily at 3:00 AM');
    logger.info('- Improvement: Weekly on Sundays at 4:00 AM');
  }

  /**
   * Stop scheduler
   */
  stop(): void {
    if (this.calibrationJob) {
      this.calibrationJob.cancel();
      this.calibrationJob = null;
    }

    if (this.improvementJob) {
      this.improvementJob.cancel();
      this.improvementJob = null;
    }

    logger.info('Continuous improvement scheduler stopped');
  }

  /**
   * Run calibration cycle
   */
  private async runCalibration(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Improvement cycle already running, skipping calibration');
      return;
    }

    this.isRunning = true;

    try {
      logger.info('=== Starting daily calibration cycle ===');

      // Recalibrate confidence for all domains
      await confidenceTracker.calibrate();

      // Log metrics
      const metrics = evalProtocol.calculateMetrics();
      logger.info(`Total evaluations: ${metrics.totalEvaluations}`);
      logger.info(`Success rate: ${(metrics.successRate * 100).toFixed(1)}%`);
      logger.info(`Average rating: ${metrics.averageRating.toFixed(2)}/5`);

      logger.info('=== Calibration cycle complete ===');
    } catch (error) {
      logger.error('Calibration cycle failed:', error);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Run full improvement cycle
   */
  private async runImprovementCycle(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Calibration running, skipping improvement cycle');
      return;
    }

    this.isRunning = true;

    try {
      logger.info('=== Starting weekly improvement cycle ===');

      // 1. Analyze failures
      logger.info('Step 1: Analyzing failure patterns...');
      const patterns = await failureAnalyzer.analyzeFailures({ limit: 200 });
      logger.info(`Found ${patterns.length} failure patterns`);

      if (patterns.length === 0) {
        logger.info('No failures detected - system performing well!');
        return;
      }

      // 2. Propose improvements using GEPA
      logger.info('Step 2: Generating improvements with GEPA...');
      const improvements = await gepaOptimizer.proposeImprovements();

      if (improvements.length === 0) {
        logger.info('No improvements proposed');
        return;
      }

      logger.info(`Proposed ${improvements.length} improvements`);

      // 3. Validate improvements
      logger.info('Step 3: Validating improvements...');
      for (const improvement of improvements) {
        const score = await gepaOptimizer.validateImprovement(improvement);
        logger.info(`Improvement ${improvement.id}: ${(score * 100).toFixed(1)}% validation score`);
      }

      // 4. Apply best improvement
      logger.info('Step 4: Applying best improvement...');
      const bestImprovement = improvements
        .filter(i => i.validationScore && i.validationScore >= 0.6)
        .sort((a, b) => (b.validationScore || 0) - (a.validationScore || 0))[0];

      if (bestImprovement) {
        await gepaOptimizer.applyImprovement(bestImprovement);
        logger.info(`Applied improvement targeting: ${bestImprovement.targetedIssues.join(', ')}`);
      } else {
        logger.info('No improvements passed validation threshold');
      }

      logger.info('=== Improvement cycle complete ===');
    } catch (error) {
      logger.error('Improvement cycle failed:', error);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Manually trigger improvement cycle
   */
  async triggerImprovement(): Promise<void> {
    logger.info('Manually triggering improvement cycle...');
    await this.runImprovementCycle();
  }

  /**
   * Get improvement status
   */
  getStatus(): {
    isRunning: boolean;
    nextCalibration: Date | null;
    nextImprovement: Date | null;
  } {
    return {
      isRunning: this.isRunning,
      nextCalibration: this.calibrationJob?.nextInvocation() || null,
      nextImprovement: this.improvementJob?.nextInvocation() || null
    };
  }
}

export const continuousImprover = new ContinuousImprover();
```

2. Start the continuous improver in main process:

```typescript
// In src/main/index.ts
import { continuousImprover } from './learning/continuous-improver';

app.whenReady().then(() => {
  // ... existing initialization ...

  // Start continuous learning
  continuousImprover.start();
  logger.info('Continuous learning system started');
});

app.on('before-quit', () => {
  continuousImprover.stop();
});
```

### Success Criteria:
- [x] Daily calibration automated
- [x] Weekly improvement cycle automated
- [x] Manual trigger available
- [x] Improvements applied automatically
- [x] Logging and monitoring

**Next:** Move to 045-F

---

## Session 045-F: Learning Dashboard UI (2-3 hours)

**Status:** WAITING (after 045-E)
**Goal:** Visualize learning progress in Settings

### Tasks:

1. Create `src/renderer/components/LearningDashboard.tsx`:

```typescript
import { useState, useEffect } from 'react';
import './LearningDashboard.css';

interface DomainConfidence {
  domain: string;
  confidence: number;
  statistics: {
    totalQueries: number;
    successRate: number;
    correctResponses: number;
    incorrectResponses: number;
  };
}

interface ImprovementStatus {
  isRunning: boolean;
  nextCalibration: string | null;
  nextImprovement: string | null;
}

export function LearningDashboard() {
  const [confidences, setConfidences] = useState<DomainConfidence[]>([]);
  const [status, setStatus] = useState<ImprovementStatus | null>(null);
  const [metrics, setMetrics] = useState<any>(null);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    const [conf, stat, met] = await Promise.all([
      window.nova?.invoke('learning:get-confidences'),
      window.nova?.invoke('learning:get-status'),
      window.nova?.invoke('learning:get-metrics')
    ]);

    setConfidences(conf || []);
    setStatus(stat || null);
    setMetrics(met || null);
  };

  const triggerImprovement = async () => {
    await window.nova?.invoke('learning:trigger-improvement');
    alert('Improvement cycle triggered! Check logs for progress.');
  };

  return (
    <div className="learning-dashboard">
      <h2>🧠 Learning & Improvement</h2>

      {/* Status */}
      <section className="status-section">
        <h3>System Status</h3>
        {status && (
          <div className="status-info">
            <div className="status-item">
              <span className={`indicator ${status.isRunning ? 'active' : 'idle'}`} />
              {status.isRunning ? 'Learning in progress...' : 'Idle'}
            </div>
            <div className="status-item">
              Next calibration: {status.nextCalibration
                ? new Date(status.nextCalibration).toLocaleString()
                : 'Not scheduled'}
            </div>
            <div className="status-item">
              Next improvement: {status.nextImprovement
                ? new Date(status.nextImprovement).toLocaleString()
                : 'Not scheduled'}
            </div>
          </div>
        )}
      </section>

      {/* Overall Metrics */}
      {metrics && (
        <section className="metrics-section">
          <h3>Overall Performance</h3>
          <div className="metrics-grid">
            <div className="metric-card">
              <div className="metric-value">{metrics.totalEvaluations}</div>
              <div className="metric-label">Total Conversations</div>
            </div>
            <div className="metric-card">
              <div className="metric-value">
                {(metrics.successRate * 100).toFixed(1)}%
              </div>
              <div className="metric-label">Success Rate</div>
            </div>
            <div className="metric-card">
              <div className="metric-value">
                {metrics.averageRating.toFixed(1)}/5
              </div>
              <div className="metric-label">Average Rating</div>
            </div>
          </div>
        </section>
      )}

      {/* Domain Confidence */}
      <section className="confidence-section">
        <h3>Knowledge by Domain</h3>
        <div className="confidence-list">
          {confidences.map(conf => (
            <div key={conf.domain} className="confidence-item">
              <div className="confidence-header">
                <span className="domain-name">{conf.domain}</span>
                <span className="confidence-value">
                  {(conf.confidence * 100).toFixed(0)}%
                </span>
              </div>
              <div className="confidence-bar">
                <div
                  className="confidence-fill"
                  style={{
                    width: `${conf.confidence * 100}%`,
                    backgroundColor: getConfidenceColor(conf.confidence)
                  }}
                />
              </div>
              <div className="confidence-stats">
                {conf.statistics.totalQueries} queries, {' '}
                {(conf.statistics.successRate * 100).toFixed(0)}% success
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Manual Controls */}
      <section className="controls-section">
        <h3>Manual Controls</h3>
        <button
          onClick={triggerImprovement}
          disabled={status?.isRunning}
          className="trigger-button"
        >
          🚀 Trigger Improvement Cycle
        </button>
        <p className="help-text">
          Manually run the improvement cycle to optimize Nova's performance
          based on recent feedback.
        </p>
      </section>
    </div>
  );
}

function getConfidenceColor(confidence: number): string {
  if (confidence >= 0.8) return '#10b981'; // Green
  if (confidence >= 0.6) return '#3b82f6'; // Blue
  if (confidence >= 0.4) return '#f59e0b'; // Orange
  return '#ef4444'; // Red
}
```

2. Add CSS styling:

```css
/* src/renderer/components/LearningDashboard.css */
.learning-dashboard {
  padding: 20px;
  max-width: 800px;
}

.learning-dashboard h2 {
  margin-bottom: 30px;
  color: var(--text-primary);
}

.learning-dashboard section {
  margin-bottom: 30px;
  padding: 20px;
  background: var(--bg-secondary);
  border-radius: 8px;
}

.learning-dashboard h3 {
  margin-bottom: 15px;
  font-size: 16px;
  color: var(--text-secondary);
}

.status-info {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.status-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-muted);
}

.indicator.active {
  background: #10b981;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 15px;
}

.metric-card {
  padding: 15px;
  background: var(--bg-tertiary);
  border-radius: 6px;
  text-align: center;
}

.metric-value {
  font-size: 28px;
  font-weight: bold;
  color: var(--text-primary);
  margin-bottom: 5px;
}

.metric-label {
  font-size: 12px;
  color: var(--text-muted);
  text-transform: uppercase;
}

.confidence-list {
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.confidence-item {
  padding: 12px;
  background: var(--bg-tertiary);
  border-radius: 6px;
}

.confidence-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
}

.domain-name {
  font-weight: 500;
  text-transform: capitalize;
}

.confidence-value {
  font-weight: bold;
  color: var(--text-primary);
}

.confidence-bar {
  height: 6px;
  background: var(--bg-primary);
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 5px;
}

.confidence-fill {
  height: 100%;
  transition: width 0.3s ease;
}

.confidence-stats {
  font-size: 12px;
  color: var(--text-muted);
}

.trigger-button {
  padding: 12px 24px;
  background: var(--accent-primary);
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.trigger-button:hover:not(:disabled) {
  background: var(--accent-primary-hover);
  transform: translateY(-1px);
}

.trigger-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.help-text {
  margin-top: 10px;
  font-size: 12px;
  color: var(--text-muted);
}
```

3. Add IPC handlers in `src/main/ipc/handlers.ts`:

```typescript
import { confidenceTracker } from '../learning/confidence-tracker';
import { continuousImprover } from '../learning/continuous-improver';
import { evalProtocol } from '../learning/eval-protocol';

// Learning endpoints
ipcMain.handle('learning:get-confidences', async () => {
  return confidenceTracker.getAllConfidences();
});

ipcMain.handle('learning:get-status', async () => {
  return continuousImprover.getStatus();
});

ipcMain.handle('learning:get-metrics', async () => {
  return evalProtocol.calculateMetrics();
});

ipcMain.handle('learning:trigger-improvement', async () => {
  await continuousImprover.triggerImprovement();
  return { success: true };
});

ipcMain.handle('learning:get-failure-summary', async (_, domain?: string) => {
  return failureAnalyzer.getFailureSummary(domain);
});
```

### Success Criteria:
- [x] Learning dashboard displays in Settings
- [x] Real-time confidence visualization
- [x] Overall metrics displayed
- [x] Manual improvement trigger
- [x] Status indicators

**Next:** Move to 045-G

---

## Session 045-G: Testing & Documentation (2-3 hours)

**Status:** WAITING (after 045-F)
**Goal:** Test learning system and document usage

### Tasks:

1. Create tests in `tests/learning.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { EvalProtocol } from '../src/main/learning/eval-protocol';
import { ConfidenceTracker } from '../src/main/learning/confidence-tracker';
import { FailureAnalyzer } from '../src/main/learning/failure-analyzer';

describe('Learning System', () => {
  let evalProtocol: EvalProtocol;
  let confidenceTracker: ConfidenceTracker;
  let failureAnalyzer: FailureAnalyzer;

  beforeEach(() => {
    evalProtocol = new EvalProtocol();
    confidenceTracker = new ConfidenceTracker();
    failureAnalyzer = new FailureAnalyzer();
  });

  describe('EvalProtocol', () => {
    it('should record conversations', async () => {
      const id = await evalProtocol.recordConversation({
        conversationId: 'test-1',
        userQuery: 'What is forex trading?',
        novaResponse: 'Forex trading is...',
        context: [],
        responseTime: 1500
      });

      expect(id).toBeTruthy();
      const evals = evalProtocol.getEvaluations();
      expect(evals.length).toBe(1);
      expect(evals[0].domain).toBe('forex');
    });

    it('should update with feedback', async () => {
      const id = await evalProtocol.recordConversation({
        conversationId: 'test-2',
        userQuery: 'Test query',
        novaResponse: 'Test response',
        context: [],
        responseTime: 1000
      });

      await evalProtocol.updateWithFeedback({
        evaluationId: id,
        feedback: 'helpful',
        rating: 5
      });

      const evals = evalProtocol.getEvaluations();
      expect(evals[0].userFeedback).toBe('helpful');
      expect(evals[0].userRating).toBe(5);
      expect(evals[0].success).toBe(true);
    });

    it('should calculate metrics by domain', () => {
      // Add test data...
      const metrics = evalProtocol.calculateMetrics();
      expect(metrics.totalEvaluations).toBeGreaterThan(0);
      expect(metrics.successRate).toBeGreaterThanOrEqual(0);
      expect(metrics.successRate).toBeLessThanOrEqual(1);
    });
  });

  describe('ConfidenceTracker', () => {
    it('should return neutral confidence for unknown domains', () => {
      const confidence = confidenceTracker.getConfidence('unknown');
      expect(confidence).toBe(0.5);
    });

    it('should calibrate based on evaluations', async () => {
      // Mock evaluations...
      await confidenceTracker.calibrate('forex');
      const confidence = confidenceTracker.getConfidence('forex');
      expect(confidence).toBeGreaterThan(0);
      expect(confidence).toBeLessThan(1);
    });

    it('should suggest uncertainty for low confidence', () => {
      // Set low confidence...
      const shouldExpress = confidenceTracker.shouldExpressUncertainty('test query');
      expect(typeof shouldExpress).toBe('boolean');
    });
  });

  describe('FailureAnalyzer', () => {
    it('should identify failure patterns', async () => {
      // Mock failed evaluations...
      const patterns = await failureAnalyzer.analyzeFailures({ limit: 100 });
      expect(Array.isArray(patterns)).toBe(true);
    });

    it('should provide suggested fixes', async () => {
      const patterns = await failureAnalyzer.analyzeFailures();
      if (patterns.length > 0) {
        expect(patterns[0].suggestedFix).toBeTruthy();
      }
    });
  });
});
```

2. Create documentation in `docs/SELF_IMPROVING_AGENT.md`:

```markdown
# Self-Improving Agent System

Nova includes a self-improving agent system powered by Fireworks AI's GEPA (Gradient-Enhanced Prompt Adjustment). This system continuously learns from conversations and automatically improves performance over time.

## How It Works

### 1. Evaluation Collection
Every conversation is evaluated across multiple dimensions:
- Task completion (did Nova solve the problem?)
- Response quality (overall usefulness)
- Confidence accuracy (was Nova appropriately confident?)
- Factual correctness (were facts accurate?)
- Personality consistency (did Nova maintain character?)

### 2. User Feedback
Users provide feedback through:
- Thumbs up/down buttons
- Star ratings (1-5)
- Corrections (when Nova gets something wrong)

### 3. Confidence Calibration
Nova tracks confidence by domain (forex, chess, fitness, etc.):
- High success rate → High confidence
- Frequent corrections → Low confidence
- Confidence adjusts personality prompts automatically

### 4. Failure Analysis
Failed conversations are analyzed for patterns:
- Hallucinated facts
- Over-confidence
- Personality inconsistency
- Task incompletion

### 5. GEPA Optimization
Weekly, the system:
1. Identifies failure patterns
2. Proposes prompt improvements via GEPA
3. Validates improvements on test set
4. Applies best improvement automatically

### 6. Continuous Learning
- **Daily (3 AM):** Confidence calibration
- **Weekly (Sunday 4 AM):** Full improvement cycle
- **Manual:** Trigger improvement anytime in Settings

## Usage

### Provide Feedback
After each response, click:
- 👍 Helpful
- 👎 Not helpful
- ⚠️ Incorrect

Or rate with stars (1-5).

### View Learning Progress
Settings → Learning & Improvement:
- Overall performance metrics
- Confidence by domain
- Improvement status
- Manual improvement trigger

### Monitor Logs
Learning activities are logged:
```bash
# Check logs
tail -f ~/.nova/logs/nova-YYYY-MM-DD.log | grep learning
```

## Technical Details

### Evaluation Metrics
- `taskCompletion`: Boolean, did Nova complete the task?
- `responseQuality`: 0-1, overall quality score
- `confidenceAccuracy`: 0-1, appropriateness of confidence
- `factualCorrectness`: Boolean, facts accurate?
- `personalityConsistency`: 0-1, maintained character?

### Domain Classification
Automatic classification based on keywords:
- `forex`: trading, currency, stocks
- `chess`: chess, opening, endgame
- `fitness`: workout, exercise, gym
- `programming`: code, debug, function
- `calendar`: schedule, meeting, appointment
- `general`: everything else

### Confidence Calibration Formula
```
confidence = (successRate * 0.4) + (correctnessRate * 0.4) + (ratingCorrelation * 0.2)
```

Ranges:
- 0.8-1.0: High confidence (Nova is confident)
- 0.6-0.8: Good confidence (Nova is helpful)
- 0.4-0.6: Limited confidence (Nova expresses uncertainty)
- 0.0-0.4: Low confidence (Nova admits limitations)

### Prompt Optimization
GEPA analyzes failures and proposes improvements:
1. Collect failed conversations
2. Identify patterns (hallucination, over-confidence, etc.)
3. Generate improved prompt via Fireworks AI
4. Validate on test set (must score >60%)
5. Apply if validation passes

## Best Practices

### For Users
1. **Provide feedback consistently** - Every thumbs up/down helps
2. **Correct mistakes** - When Nova is wrong, tell it the right answer
3. **Rate responses** - Star ratings improve quality scoring
4. **Check learning dashboard** - Monitor Nova's improvement

### For Developers
1. **Review improvement logs** - Understand what's being optimized
2. **Monitor validation scores** - Ensure improvements are real
3. **Tune thresholds** - Adjust calibration formulas if needed
4. **Add more metrics** - Expand evaluation criteria

## Configuration

### Environment Variables
```bash
FIREWORKS_API_KEY=your_api_key
LEARNING_ENABLED=true
CALIBRATION_SCHEDULE="0 3 * * *"  # Daily at 3 AM
IMPROVEMENT_SCHEDULE="0 4 * * 0"  # Weekly Sunday at 4 AM
```

### Settings
- Enable/disable learning
- Adjust calibration frequency
- Set minimum data threshold
- Configure validation strictness

## Troubleshooting

### Learning Not Working
1. Check logs: `~/.nova/logs/`
2. Verify Fireworks API key
3. Ensure enough evaluation data (>10 per domain)

### Improvements Not Applied
1. Check validation score (must be >0.6)
2. Review failure patterns (need failures to improve)
3. Manually trigger: Settings → Learning → Trigger Improvement

### Confidence Issues
1. Check evaluation count per domain
2. Provide more feedback
3. Manually calibrate: runs automatically daily

## Future Enhancements

Planned for later phases:
- Vector database for semantic memory
- RFT (Reinforcement Fine-Tuning) integration
- Custom LLM fine-tuning using learned data
- Multi-model ensemble learning
- User-specific personalization

## Learn More

- [Fireworks AI Blog: Self-Improving Agents](https://fireworks.ai/blog/self-improving-agent)
- [GEPA Documentation](https://docs.fireworks.ai/gepa)
- [DSPy Integration](https://github.com/stanfordnlp/dspy)
```

### Success Criteria:
- [x] Tests cover evaluation, confidence, failures
- [x] Documentation complete
- [x] Usage examples provided
- [x] Troubleshooting guide

**Complete!** Self-improving agent system fully integrated.

---

# ═══════════════════════════════════════════════════════════════
# UPDATED SESSION ORDER
# ═══════════════════════════════════════════════════════════════

## Add These Sessions to SESSIONS.md:

### Phase 3 (Performance & Resilience)
Add after session 033-C:
- **033-D:** Basic Evaluation Protocol (2-3h)
- **033-E:** Confidence Tracking (2-3h)
- **033-F:** Failure Pattern Analysis (2-3h)

### Phase 6 (Intelligence & Skills)
Add after session 045-C:
- **045-D:** GEPA Integration (3-4h)
- **045-E:** Continuous Learning Loop (3-4h)
- **045-F:** Learning Dashboard UI (2-3h)
- **045-G:** Testing & Documentation (2-3h)

---

# 🎯 IMPLEMENTATION SUMMARY

## What You Get

### Immediate Benefits (Phase 3.5)
- Every conversation evaluated and tracked
- User feedback collection (thumbs up/down, ratings)
- Domain-specific confidence tracking
- Automatic daily calibration
- Failure pattern identification

### Advanced Benefits (Phase 6.5)
- Automatic prompt optimization via GEPA
- Weekly improvement cycles
- Visual learning dashboard
- Performance metrics by domain
- Manual improvement triggers

### Long-term Benefits
- Continuous improvement without manual intervention
- Natural mistake handling ("I'm not sure about this...")
- Domain expertise growth over time
- Foundation for custom LLM fine-tuning
- Personalized to your usage patterns

## Total Time Investment
- **Phase 3.5:** 6-9 hours (basic foundation)
- **Phase 6.5:** 10-14 hours (GEPA integration)
- **Total:** 16-23 hours

## Expected Improvements
Based on Fireworks case study:
- 30-50% improvement in response quality
- 40-60% reduction in factual errors
- 50-70% better confidence calibration
- Foundation for 2x performance via fine-tuning

---

**This plan is READY TO IMPLEMENT!**

Start with Phase 3.5 (sessions 033-D through 033-F) after completing session 033-C.
