/**
 * Atlas Desktop - Relationship Tracker
 * Track and analyze interpersonal relationships
 *
 * Features:
 * - Contact relationship mapping
 * - Interaction history tracking
 * - Relationship strength scoring
 * - Sentiment analysis over time
 * - Recommendation for follow-ups
 *
 * @module ml/relationship-tracker
 */

import { EventEmitter } from 'events';
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('RelationshipTracker');

// ============================================================================
// Types
// ============================================================================

export interface Contact {
  id: string;
  name: string;
  aliases: string[];
  email?: string;
  phone?: string;
  organization?: string;
  role?: string;
  tags: string[];
  notes: string;
  createdAt: number;
  updatedAt: number;
}

export interface Interaction {
  id: string;
  contactId: string;
  type: InteractionType;
  direction: 'inbound' | 'outbound' | 'mutual';
  channel: string;
  content?: string;
  sentiment: number;
  importance: number;
  timestamp: number;
  duration?: number;
  topics: string[];
  followUpRequired: boolean;
  followUpDate?: number;
}

export type InteractionType =
  | 'meeting'
  | 'call'
  | 'email'
  | 'message'
  | 'social'
  | 'mention'
  | 'collaboration'
  | 'other';

export interface RelationshipMetrics {
  contactId: string;
  strength: number; // 0-1
  frequency: number; // interactions per week
  recency: number; // days since last interaction
  sentiment: number; // average sentiment
  reciprocity: number; // balance of in/out
  growth: number; // trend direction
  consistency: number; // regularity of contact
}

export interface RelationshipInsight {
  contactId: string;
  contactName: string;
  type: 'warning' | 'suggestion' | 'milestone';
  message: string;
  priority: 'high' | 'medium' | 'low';
  actionable: boolean;
  suggestedAction?: string;
  createdAt: number;
}

export interface RelationshipNetwork {
  contacts: Contact[];
  interactions: Interaction[];
  clusters: ContactCluster[];
  metrics: Map<string, RelationshipMetrics>;
}

export interface ContactCluster {
  id: string;
  name: string;
  contacts: string[];
  commonTags: string[];
  interactionDensity: number;
}

export interface RelationshipTrackerConfig {
  strengthDecayDays: number;
  minInteractionsForMetrics: number;
  followUpReminderDays: number;
  sentimentWeight: number;
  frequencyWeight: number;
  recencyWeight: number;
}

// ============================================================================
// Relationship Analyzer
// ============================================================================

class RelationshipAnalyzer {
  /**
   * Calculate relationship strength
   */
  calculateStrength(
    interactions: Interaction[],
    config: RelationshipTrackerConfig
  ): number {
    if (interactions.length === 0) return 0;

    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    // Recency score (exponential decay)
    const lastInteraction = Math.max(...interactions.map((i) => i.timestamp));
    const daysSinceLast = (now - lastInteraction) / dayMs;
    const recencyScore = Math.exp(-daysSinceLast / config.strengthDecayDays);

    // Frequency score (interactions in last 30 days)
    const recentInteractions = interactions.filter((i) => now - i.timestamp < 30 * dayMs);
    const frequencyScore = Math.min(recentInteractions.length / 10, 1);

    // Sentiment score (average, normalized to 0-1)
    const avgSentiment =
      interactions.reduce((sum, i) => sum + i.sentiment, 0) / interactions.length;
    const sentimentScore = (avgSentiment + 1) / 2; // Convert -1..1 to 0..1

    // Importance weighted
    const importanceScore =
      interactions.reduce((sum, i) => sum + i.importance, 0) / interactions.length;

    // Combined score
    const strength =
      recencyScore * config.recencyWeight +
      frequencyScore * config.frequencyWeight +
      sentimentScore * config.sentimentWeight +
      importanceScore * 0.2;

    return Math.min(Math.max(strength / (config.recencyWeight + config.frequencyWeight + config.sentimentWeight + 0.2), 0), 1);
  }

  /**
   * Calculate reciprocity (balance of interactions)
   */
  calculateReciprocity(interactions: Interaction[]): number {
    const inbound = interactions.filter((i) => i.direction === 'inbound').length;
    const outbound = interactions.filter((i) => i.direction === 'outbound').length;
    const total = inbound + outbound;

    if (total === 0) return 0.5;

    // 1 = perfectly balanced, 0 = completely one-sided
    const balance = 1 - Math.abs(inbound - outbound) / total;
    return balance;
  }

  /**
   * Calculate growth trend
   */
  calculateGrowth(interactions: Interaction[]): number {
    if (interactions.length < 3) return 0;

    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    // Compare last 30 days to previous 30 days
    const recent = interactions.filter(
      (i) => now - i.timestamp < 30 * dayMs
    ).length;
    const previous = interactions.filter(
      (i) => now - i.timestamp >= 30 * dayMs && now - i.timestamp < 60 * dayMs
    ).length;

    if (previous === 0) return recent > 0 ? 1 : 0;
    return Math.min(Math.max((recent - previous) / previous, -1), 1);
  }

  /**
   * Calculate consistency score
   */
  calculateConsistency(interactions: Interaction[]): number {
    if (interactions.length < 2) return 0;

    // Sort by timestamp
    const sorted = [...interactions].sort((a, b) => a.timestamp - b.timestamp);

    // Calculate gaps between interactions
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      gaps.push(sorted[i].timestamp - sorted[i - 1].timestamp);
    }

    if (gaps.length === 0) return 0;

    // Calculate coefficient of variation (lower = more consistent)
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const variance = gaps.reduce((sum, g) => sum + Math.pow(g - mean, 2), 0) / gaps.length;
    const stdDev = Math.sqrt(variance);
    const cv = stdDev / mean;

    // Convert to 0-1 score (lower cv = higher consistency)
    return Math.max(0, 1 - cv);
  }

  /**
   * Analyze sentiment
   */
  analyzeSentiment(text: string): number {
    const positive = ['great', 'thanks', 'appreciate', 'love', 'excellent', 'happy', 'good', 'wonderful', 'amazing', 'helpful'];
    const negative = ['sorry', 'problem', 'issue', 'unfortunately', 'bad', 'disappointed', 'frustrated', 'angry', 'upset', 'hate'];

    const lowerText = text.toLowerCase();
    let score = 0;

    for (const word of positive) {
      if (lowerText.includes(word)) score += 0.1;
    }
    for (const word of negative) {
      if (lowerText.includes(word)) score -= 0.1;
    }

    return Math.max(-1, Math.min(1, score));
  }

  /**
   * Extract topics from text
   */
  extractTopics(text: string): string[] {
    const stopwords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'can', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'and', 'but', 'or', 'this', 'that', 'it', 'i', 'we', 'you', 'they']);

    const words = text.toLowerCase().match(/\b[a-z]{4,}\b/g) || [];
    const wordFreq = new Map<string, number>();

    for (const word of words) {
      if (!stopwords.has(word)) {
        wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
      }
    }

    return Array.from(wordFreq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([word]) => word);
  }
}

// ============================================================================
// Insight Generator
// ============================================================================

class InsightGenerator {
  /**
   * Generate insights for a contact
   */
  generateInsights(
    contact: Contact,
    metrics: RelationshipMetrics,
    interactions: Interaction[],
    config: RelationshipTrackerConfig
  ): RelationshipInsight[] {
    const insights: RelationshipInsight[] = [];
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    // Check for relationship decay
    if (metrics.recency > config.followUpReminderDays && metrics.strength > 0.3) {
      insights.push({
        contactId: contact.id,
        contactName: contact.name,
        type: 'warning',
        message: `You haven't interacted with ${contact.name} in ${Math.round(metrics.recency)} days`,
        priority: metrics.strength > 0.6 ? 'high' : 'medium',
        actionable: true,
        suggestedAction: 'Send a quick message or schedule a catch-up',
        createdAt: now,
      });
    }

    // Check for one-sided relationship
    if (metrics.reciprocity < 0.3 && interactions.length >= 5) {
      const direction = interactions.filter((i) => i.direction === 'outbound').length >
        interactions.filter((i) => i.direction === 'inbound').length
        ? 'You reach out more than they do'
        : 'They reach out more than you do';

      insights.push({
        contactId: contact.id,
        contactName: contact.name,
        type: 'suggestion',
        message: `Relationship with ${contact.name} is one-sided: ${direction}`,
        priority: 'low',
        actionable: false,
        createdAt: now,
      });
    }

    // Check for declining relationship
    if (metrics.growth < -0.3 && metrics.strength > 0.4) {
      insights.push({
        contactId: contact.id,
        contactName: contact.name,
        type: 'warning',
        message: `Interaction frequency with ${contact.name} has decreased significantly`,
        priority: 'medium',
        actionable: true,
        suggestedAction: 'Consider scheduling regular check-ins',
        createdAt: now,
      });
    }

    // Check for follow-up required
    const pendingFollowUp = interactions.find(
      (i) => i.followUpRequired && (!i.followUpDate || i.followUpDate < now)
    );
    if (pendingFollowUp) {
      insights.push({
        contactId: contact.id,
        contactName: contact.name,
        type: 'warning',
        message: `Follow-up with ${contact.name} is overdue`,
        priority: 'high',
        actionable: true,
        suggestedAction: 'Complete the pending follow-up',
        createdAt: now,
      });
    }

    // Milestone: Strong relationship maintained
    if (metrics.strength > 0.8 && metrics.consistency > 0.7) {
      insights.push({
        contactId: contact.id,
        contactName: contact.name,
        type: 'milestone',
        message: `Strong, consistent relationship with ${contact.name}`,
        priority: 'low',
        actionable: false,
        createdAt: now,
      });
    }

    // Anniversary/long-term relationship
    const relationshipAge = (now - contact.createdAt) / dayMs;
    if (relationshipAge > 365 && Math.floor(relationshipAge) % 365 === 0) {
      insights.push({
        contactId: contact.id,
        contactName: contact.name,
        type: 'milestone',
        message: `${Math.floor(relationshipAge / 365)} year anniversary with ${contact.name}`,
        priority: 'medium',
        actionable: true,
        suggestedAction: 'Consider acknowledging this milestone',
        createdAt: now,
      });
    }

    return insights;
  }
}

// ============================================================================
// Relationship Tracker
// ============================================================================

export class RelationshipTracker extends EventEmitter {
  private config: RelationshipTrackerConfig;
  private contacts: Map<string, Contact> = new Map();
  private interactions: Map<string, Interaction[]> = new Map();
  private metrics: Map<string, RelationshipMetrics> = new Map();
  private analyzer: RelationshipAnalyzer;
  private insightGenerator: InsightGenerator;
  private dataPath: string;

  // Stats
  private stats = {
    contactsTracked: 0,
    interactionsLogged: 0,
    insightsGenerated: 0,
    avgRelationshipStrength: 0,
  };

  constructor(config?: Partial<RelationshipTrackerConfig>) {
    super();
    this.config = {
      strengthDecayDays: 30,
      minInteractionsForMetrics: 3,
      followUpReminderDays: 14,
      sentimentWeight: 0.2,
      frequencyWeight: 0.3,
      recencyWeight: 0.5,
      ...config,
    };

    this.analyzer = new RelationshipAnalyzer();
    this.insightGenerator = new InsightGenerator();
    this.dataPath = path.join(app.getPath('userData'), 'relationship-tracker.json');

    this.loadData();
    logger.info('RelationshipTracker initialized', { config: this.config });
  }

  // ============================================================================
  // Data Persistence
  // ============================================================================

  private loadData(): void {
    try {
      if (fs.existsSync(this.dataPath)) {
        const data = JSON.parse(fs.readFileSync(this.dataPath, 'utf-8'));

        for (const contact of data.contacts || []) {
          this.contacts.set(contact.id, contact);
        }

        for (const [contactId, interactions] of Object.entries(data.interactions || {})) {
          this.interactions.set(contactId, interactions as Interaction[]);
        }

        if (data.stats) {
          this.stats = data.stats;
        }

        // Recalculate metrics
        for (const contact of this.contacts.values()) {
          this.updateMetrics(contact.id);
        }

        logger.info('Loaded relationship data', { contacts: this.contacts.size });
      }
    } catch (error) {
      logger.warn('Failed to load relationship data', { error });
    }
  }

  private saveData(): void {
    try {
      const data = {
        contacts: Array.from(this.contacts.values()),
        interactions: Object.fromEntries(this.interactions),
        stats: this.stats,
        savedAt: Date.now(),
      };
      fs.writeFileSync(this.dataPath, JSON.stringify(data, null, 2));
    } catch (error) {
      logger.warn('Failed to save relationship data', { error });
    }
  }

  // ============================================================================
  // Contact Management
  // ============================================================================

  /**
   * Add a contact
   */
  addContact(contact: Omit<Contact, 'id' | 'createdAt' | 'updatedAt'>): Contact {
    const fullContact: Contact = {
      ...contact,
      id: this.generateId('contact'),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.contacts.set(fullContact.id, fullContact);
    this.interactions.set(fullContact.id, []);
    this.stats.contactsTracked++;

    this.emit('contact-added', fullContact);
    this.saveData();

    return fullContact;
  }

  /**
   * Update a contact
   */
  updateContact(contactId: string, updates: Partial<Contact>): Contact | null {
    const contact = this.contacts.get(contactId);
    if (!contact) return null;

    Object.assign(contact, updates, { updatedAt: Date.now() });
    this.saveData();

    return contact;
  }

  /**
   * Find contact by name or alias
   */
  findContact(nameOrAlias: string): Contact | null {
    const lower = nameOrAlias.toLowerCase();

    for (const contact of this.contacts.values()) {
      if (
        contact.name.toLowerCase() === lower ||
        contact.aliases.some((a) => a.toLowerCase() === lower)
      ) {
        return contact;
      }
    }

    return null;
  }

  /**
   * Delete a contact
   */
  deleteContact(contactId: string): boolean {
    const deleted = this.contacts.delete(contactId);
    if (deleted) {
      this.interactions.delete(contactId);
      this.metrics.delete(contactId);
      this.stats.contactsTracked--;
      this.saveData();
    }
    return deleted;
  }

  // ============================================================================
  // Interaction Management
  // ============================================================================

  /**
   * Log an interaction
   */
  logInteraction(
    contactId: string,
    interaction: Omit<Interaction, 'id' | 'contactId' | 'timestamp' | 'sentiment' | 'topics'>
  ): Interaction | null {
    const contact = this.contacts.get(contactId);
    if (!contact) return null;

    // Analyze content if provided
    const sentiment = interaction.content
      ? this.analyzer.analyzeSentiment(interaction.content)
      : 0;
    const topics = interaction.content ? this.analyzer.extractTopics(interaction.content) : [];

    const fullInteraction: Interaction = {
      ...interaction,
      id: this.generateId('interaction'),
      contactId,
      timestamp: Date.now(),
      sentiment,
      topics,
    };

    const contactInteractions = this.interactions.get(contactId) || [];
    contactInteractions.push(fullInteraction);
    this.interactions.set(contactId, contactInteractions);

    // Update metrics
    this.updateMetrics(contactId);
    this.stats.interactionsLogged++;

    this.emit('interaction-logged', fullInteraction);
    this.saveData();

    return fullInteraction;
  }

  /**
   * Update metrics for a contact
   */
  private updateMetrics(contactId: string): void {
    const contact = this.contacts.get(contactId);
    const interactions = this.interactions.get(contactId) || [];

    if (!contact || interactions.length < this.config.minInteractionsForMetrics) {
      return;
    }

    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    const lastInteraction = Math.max(...interactions.map((i) => i.timestamp));
    const recentInteractions = interactions.filter((i) => now - i.timestamp < 7 * dayMs);

    const metrics: RelationshipMetrics = {
      contactId,
      strength: this.analyzer.calculateStrength(interactions, this.config),
      frequency: recentInteractions.length,
      recency: (now - lastInteraction) / dayMs,
      sentiment: interactions.reduce((sum, i) => sum + i.sentiment, 0) / interactions.length,
      reciprocity: this.analyzer.calculateReciprocity(interactions),
      growth: this.analyzer.calculateGrowth(interactions),
      consistency: this.analyzer.calculateConsistency(interactions),
    };

    this.metrics.set(contactId, metrics);

    // Update average strength
    const allStrengths = Array.from(this.metrics.values()).map((m) => m.strength);
    this.stats.avgRelationshipStrength =
      allStrengths.reduce((a, b) => a + b, 0) / allStrengths.length;
  }

  // ============================================================================
  // Insights
  // ============================================================================

  /**
   * Get insights for a contact
   */
  getInsights(contactId: string): RelationshipInsight[] {
    const contact = this.contacts.get(contactId);
    const metrics = this.metrics.get(contactId);
    const interactions = this.interactions.get(contactId) || [];

    if (!contact || !metrics) return [];

    const insights = this.insightGenerator.generateInsights(
      contact,
      metrics,
      interactions,
      this.config
    );

    this.stats.insightsGenerated += insights.length;
    return insights;
  }

  /**
   * Get all insights
   */
  getAllInsights(): RelationshipInsight[] {
    const allInsights: RelationshipInsight[] = [];

    for (const contactId of this.contacts.keys()) {
      allInsights.push(...this.getInsights(contactId));
    }

    // Sort by priority
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    allInsights.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    return allInsights;
  }

  // ============================================================================
  // Network Analysis
  // ============================================================================

  /**
   * Get relationship network
   */
  getNetwork(): RelationshipNetwork {
    return {
      contacts: Array.from(this.contacts.values()),
      interactions: Array.from(this.interactions.values()).flat(),
      clusters: this.detectClusters(),
      metrics: this.metrics,
    };
  }

  /**
   * Detect contact clusters based on tags and interactions
   */
  private detectClusters(): ContactCluster[] {
    const clusters: ContactCluster[] = [];
    const tagGroups = new Map<string, string[]>();

    // Group by common tags
    for (const contact of this.contacts.values()) {
      for (const tag of contact.tags) {
        const group = tagGroups.get(tag) || [];
        group.push(contact.id);
        tagGroups.set(tag, group);
      }
    }

    // Create clusters from tag groups
    for (const [tag, contactIds] of tagGroups) {
      if (contactIds.length >= 2) {
        // Calculate interaction density within cluster
        let internalInteractions = 0;
        for (const contactId of contactIds) {
          const interactions = this.interactions.get(contactId) || [];
          // Would need cross-contact interaction tracking for full density
          internalInteractions += interactions.length;
        }

        clusters.push({
          id: this.generateId('cluster'),
          name: tag,
          contacts: contactIds,
          commonTags: [tag],
          interactionDensity: internalInteractions / contactIds.length,
        });
      }
    }

    return clusters;
  }

  /**
   * Get contacts that need attention
   */
  getContactsNeedingAttention(): Contact[] {
    const needsAttention: Contact[] = [];
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    for (const contact of this.contacts.values()) {
      const metrics = this.metrics.get(contact.id);
      if (!metrics) continue;

      // Check if needs attention
      const daysSinceLast = metrics.recency;
      const isImportant = metrics.strength > 0.5;

      if (
        (daysSinceLast > this.config.followUpReminderDays && isImportant) ||
        metrics.growth < -0.5
      ) {
        needsAttention.push(contact);
      }
    }

    // Sort by relationship strength (prioritize stronger relationships)
    needsAttention.sort((a, b) => {
      const metricsA = this.metrics.get(a.id);
      const metricsB = this.metrics.get(b.id);
      return (metricsB?.strength || 0) - (metricsA?.strength || 0);
    });

    return needsAttention;
  }

  // ============================================================================
  // Query Methods
  // ============================================================================

  /**
   * Get contact by ID
   */
  getContact(contactId: string): Contact | undefined {
    return this.contacts.get(contactId);
  }

  /**
   * Get all contacts
   */
  getAllContacts(): Contact[] {
    return Array.from(this.contacts.values());
  }

  /**
   * Get contact metrics
   */
  getMetrics(contactId: string): RelationshipMetrics | undefined {
    return this.metrics.get(contactId);
  }

  /**
   * Get contact interactions
   */
  getInteractions(contactId: string): Interaction[] {
    return this.interactions.get(contactId) || [];
  }

  /**
   * Search contacts
   */
  searchContacts(query: string): Contact[] {
    const lower = query.toLowerCase();

    return Array.from(this.contacts.values()).filter(
      (contact) =>
        contact.name.toLowerCase().includes(lower) ||
        contact.aliases.some((a) => a.toLowerCase().includes(lower)) ||
        contact.organization?.toLowerCase().includes(lower) ||
        contact.tags.some((t) => t.toLowerCase().includes(lower))
    );
  }

  /**
   * Get contacts by tag
   */
  getContactsByTag(tag: string): Contact[] {
    return Array.from(this.contacts.values()).filter((contact) =>
      contact.tags.some((t) => t.toLowerCase() === tag.toLowerCase())
    );
  }

  /**
   * Get strongest relationships
   */
  getStrongestRelationships(limit: number = 10): Contact[] {
    const sorted = Array.from(this.contacts.values())
      .filter((c) => this.metrics.has(c.id))
      .sort((a, b) => {
        const metricsA = this.metrics.get(a.id)!;
        const metricsB = this.metrics.get(b.id)!;
        return metricsB.strength - metricsA.strength;
      });

    return sorted.slice(0, limit);
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  private generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get statistics
   */
  getStats(): typeof this.stats {
    return { ...this.stats };
  }

  /**
   * Export data
   */
  exportData(): {
    contacts: Contact[];
    interactions: Record<string, Interaction[]>;
    metrics: Record<string, RelationshipMetrics>;
  } {
    return {
      contacts: Array.from(this.contacts.values()),
      interactions: Object.fromEntries(this.interactions),
      metrics: Object.fromEntries(this.metrics),
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<RelationshipTrackerConfig>): void {
    this.config = { ...this.config, ...config };

    // Recalculate all metrics with new config
    for (const contactId of this.contacts.keys()) {
      this.updateMetrics(contactId);
    }

    logger.info('Config updated', { config: this.config });
  }
}

// ============================================================================
// Singleton
// ============================================================================

let relationshipTracker: RelationshipTracker | null = null;

export function getRelationshipTracker(): RelationshipTracker {
  if (!relationshipTracker) {
    relationshipTracker = new RelationshipTracker();
  }
  return relationshipTracker;
}
