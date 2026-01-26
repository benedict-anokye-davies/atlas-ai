/**
 * Knowledge Management System
 * Entry point for personal knowledge management
 */

export * from './types';
export { getAutoJournaling, AutoJournaling } from './auto-journaling';
export { getInsightExtractor, InsightExtractor } from './insight-extractor';
export { getSpacedReview, SpacedReview } from './spaced-review';

import { getAutoJournaling } from './auto-journaling';
import { getInsightExtractor } from './insight-extractor';
import { getSpacedReview } from './spaced-review';
import { createModuleLogger } from '../utils/logger';
import { DailyDigest } from './types';

const logger = createModuleLogger('Knowledge');

/**
 * Initialize the knowledge management system
 */
export async function initializeKnowledge(): Promise<void> {
  logger.info('Initializing knowledge management system');
  
  const journaling = getAutoJournaling();
  const insights = getInsightExtractor();
  const spacedReview = getSpacedReview();
  
  await Promise.all([
    journaling.initialize(),
    insights.initialize(),
    spacedReview.initialize()
  ]);
  
  logger.info('Knowledge management system initialized');
}

/**
 * Generate daily digest
 */
export function getDailyDigest(): DailyDigest {
  const journaling = getAutoJournaling();
  const insights = getInsightExtractor();
  const spacedReview = getSpacedReview();
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const todayEntries = journaling.getEntriesByDateRange(today, new Date());
  const recentInsights = insights.getActionableInsights().slice(0, 5);
  const dueItems = spacedReview.getDueItems(10);
  const stats = spacedReview.getStatistics();
  
  return {
    date: today,
    summary: todayEntries.length > 0 
      ? todayEntries[0].summary || 'Journal entry available'
      : 'No journal entries today yet',
    highlights: todayEntries.flatMap(e => e.insights).slice(0, 5),
    insights: recentInsights.map(i => ({
      id: i.id,
      type: i.type,
      title: i.title,
      content: i.content,
      confidence: i.confidence,
      source: i.source,
      tags: i.tags,
      actionable: i.actionable,
      suggestedActions: i.suggestedActions,
      createdAt: i.createdAt,
      dismissed: i.dismissed
    })),
    upcomingReviews: dueItems,
    stats: {
      conversationCount: journaling.getStatus().bufferedConversations,
      tasksCompleted: 0, // Would integrate with task system
      newKnowledge: spacedReview.getAllItems().filter(i => 
        i.createdAt >= today
      ).length,
      reviewsCompleted: stats.reviewedToday
    }
  };
}

/**
 * Get knowledge system status
 */
export function getKnowledgeStatus() {
  return {
    journaling: getAutoJournaling().getStatus(),
    insights: getInsightExtractor().getStatus(),
    spacedReview: getSpacedReview().getStatus()
  };
}
