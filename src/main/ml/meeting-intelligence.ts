/**
 * Atlas Desktop - Meeting Intelligence
 * Analyze and summarize meetings automatically
 *
 * Features:
 * - Meeting transcription analysis
 * - Action item extraction
 * - Decision tracking
 * - Participant contribution analysis
 * - Meeting summary generation
 *
 * @module ml/meeting-intelligence
 */

import { EventEmitter } from 'events';
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('MeetingIntelligence');

// ============================================================================
// Types
// ============================================================================

export interface MeetingParticipant {
  id: string;
  name: string;
  role?: string;
  speakingTime: number; // seconds
  messageCount: number;
  sentimentScore: number;
}

export interface ActionItem {
  id: string;
  description: string;
  assignee?: string;
  deadline?: number;
  priority: 'high' | 'medium' | 'low';
  status: 'pending' | 'in-progress' | 'completed';
  mentionedAt: number; // timestamp in meeting
  context: string;
}

export interface Decision {
  id: string;
  description: string;
  madeBy?: string;
  timestamp: number;
  context: string;
  relatedTopics: string[];
}

export interface MeetingTopic {
  id: string;
  name: string;
  startTime: number;
  endTime: number;
  duration: number;
  keyPoints: string[];
  participants: string[];
}

export interface Meeting {
  id: string;
  title: string;
  startTime: number;
  endTime: number;
  duration: number;
  participants: MeetingParticipant[];
  actionItems: ActionItem[];
  decisions: Decision[];
  topics: MeetingTopic[];
  summary: string;
  transcript: MeetingSegment[];
  sentiment: number;
  engagement: number;
  tags: string[];
}

export interface MeetingSegment {
  timestamp: number;
  speaker: string;
  text: string;
  sentiment?: number;
}

export interface MeetingAnalysis {
  meetingId: string;
  participationBalance: number; // 0-1, 1 = equal participation
  topContributors: string[];
  keyTopics: string[];
  actionItemCount: number;
  decisionCount: number;
  averageSentiment: number;
  engagementScore: number;
  recommendations: string[];
}

export interface MeetingIntelligenceConfig {
  autoExtractActions: boolean;
  autoExtractDecisions: boolean;
  sentimentAnalysis: boolean;
  topicDetection: boolean;
  minSegmentLength: number;
}

// ============================================================================
// Text Analysis Utilities
// ============================================================================

class MeetingTextAnalyzer {
  /**
   * Extract action items from text
   */
  extractActionItems(text: string, speaker?: string, timestamp?: number): ActionItem[] {
    const actionItems: ActionItem[] = [];

    // Patterns that indicate action items
    const patterns = [
      /(?:I will|I'll|we will|we'll|you should|please|let's|need to|have to|must|should)\s+([^.!?]+[.!?])/gi,
      /(?:action item|todo|to-do|task):?\s*([^.!?]+[.!?])/gi,
      /(?:@\w+|[A-Z][a-z]+),?\s+(?:can you|could you|please|will you)\s+([^.!?]+[.!?])/gi,
      /(?:by|before|due|deadline)\s+(?:\w+\s+\d+|\d+\/\d+|\d+-\d+)[,:]?\s*([^.!?]+[.!?])/gi,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const description = match[1]?.trim() || match[0].trim();
        if (description.length < 10) continue;

        // Try to extract assignee
        const assigneeMatch = description.match(/@(\w+)|^([A-Z][a-z]+)/);
        const assignee = assigneeMatch ? assigneeMatch[1] || assigneeMatch[2] : speaker;

        // Try to extract deadline
        const deadlineMatch = description.match(/by\s+(\w+\s+\d+|\d+\/\d+)/i);
        const deadline = deadlineMatch ? this.parseDate(deadlineMatch[1]) : undefined;

        // Determine priority
        const priority = this.determinePriority(description);

        actionItems.push({
          id: this.generateId('action'),
          description: this.cleanActionDescription(description),
          assignee,
          deadline,
          priority,
          status: 'pending',
          mentionedAt: timestamp || Date.now(),
          context: text.substring(Math.max(0, text.indexOf(match[0]) - 50), text.indexOf(match[0]) + match[0].length + 50),
        });
      }
    }

    return this.deduplicateActions(actionItems);
  }

  /**
   * Extract decisions from text
   */
  extractDecisions(text: string, speaker?: string, timestamp?: number): Decision[] {
    const decisions: Decision[] = [];

    const patterns = [
      /(?:we've decided|decided to|decision is|agreed to|let's go with|final decision)\s+([^.!?]+[.!?])/gi,
      /(?:consensus|agreement)\s+(?:is|was)\s+(?:that|to)\s+([^.!?]+[.!?])/gi,
      /(?:moving forward|going forward),?\s+(?:we will|we'll)\s+([^.!?]+[.!?])/gi,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const description = match[1]?.trim() || match[0].trim();
        if (description.length < 10) continue;

        decisions.push({
          id: this.generateId('decision'),
          description,
          madeBy: speaker,
          timestamp: timestamp || Date.now(),
          context: text.substring(Math.max(0, text.indexOf(match[0]) - 50), text.indexOf(match[0]) + match[0].length + 50),
          relatedTopics: this.extractTopicKeywords(description),
        });
      }
    }

    return decisions;
  }

  /**
   * Detect topic changes
   */
  detectTopics(segments: MeetingSegment[]): MeetingTopic[] {
    const topics: MeetingTopic[] = [];
    let currentTopic: MeetingTopic | null = null;
    const keywordGroups: Map<string, string[]> = new Map();

    for (const segment of segments) {
      const keywords = this.extractTopicKeywords(segment.text);
      const topicName = keywords[0] || 'General Discussion';

      // Check if topic changed significantly
      const topicChanged = currentTopic && this.hasTopicChanged(currentTopic.name, topicName, keywordGroups);

      if (!currentTopic || topicChanged) {
        // End current topic
        if (currentTopic) {
          currentTopic.endTime = segment.timestamp;
          currentTopic.duration = currentTopic.endTime - currentTopic.startTime;
          topics.push(currentTopic);
        }

        // Start new topic
        currentTopic = {
          id: this.generateId('topic'),
          name: topicName,
          startTime: segment.timestamp,
          endTime: segment.timestamp,
          duration: 0,
          keyPoints: [],
          participants: [segment.speaker],
        };

        keywordGroups.set(currentTopic.id, keywords);
      } else {
        // Continue current topic
        currentTopic.endTime = segment.timestamp;
        if (!currentTopic.participants.includes(segment.speaker)) {
          currentTopic.participants.push(segment.speaker);
        }

        // Check for key points
        const keyPoint = this.extractKeyPoint(segment.text);
        if (keyPoint && !currentTopic.keyPoints.includes(keyPoint)) {
          currentTopic.keyPoints.push(keyPoint);
        }
      }
    }

    // Close final topic
    if (currentTopic) {
      currentTopic.duration = currentTopic.endTime - currentTopic.startTime;
      topics.push(currentTopic);
    }

    return topics;
  }

  /**
   * Analyze sentiment
   */
  analyzeSentiment(text: string): number {
    const positiveWords = [
      'great', 'good', 'excellent', 'agree', 'yes', 'perfect', 'love', 'amazing', 'wonderful', 'fantastic',
      'excited', 'happy', 'success', 'progress', 'achieved', 'accomplished',
    ];

    const negativeWords = [
      'bad', 'problem', 'issue', 'disagree', 'no', 'wrong', 'hate', 'terrible', 'awful', 'concerned',
      'worried', 'failed', 'blocked', 'delayed', 'frustrated',
    ];

    const words = text.toLowerCase().split(/\s+/);
    let positive = 0;
    let negative = 0;

    for (const word of words) {
      if (positiveWords.some((pw) => word.includes(pw))) positive++;
      if (negativeWords.some((nw) => word.includes(nw))) negative++;
    }

    const total = positive + negative;
    if (total === 0) return 0;
    return (positive - negative) / total;
  }

  /**
   * Generate meeting summary
   */
  generateSummary(meeting: Partial<Meeting>): string {
    const parts: string[] = [];

    // Overview
    const duration = meeting.duration ? Math.round(meeting.duration / 60) : 0;
    parts.push(`Meeting lasted ${duration} minutes with ${meeting.participants?.length || 0} participants.`);

    // Topics covered
    if (meeting.topics && meeting.topics.length > 0) {
      const topicNames = meeting.topics.slice(0, 5).map((t) => t.name);
      parts.push(`Topics discussed: ${topicNames.join(', ')}.`);
    }

    // Key decisions
    if (meeting.decisions && meeting.decisions.length > 0) {
      parts.push(`${meeting.decisions.length} decision(s) were made.`);
      const keyDecisions = meeting.decisions.slice(0, 3).map((d) => d.description);
      parts.push(`Key decisions: ${keyDecisions.join('; ')}.`);
    }

    // Action items
    if (meeting.actionItems && meeting.actionItems.length > 0) {
      parts.push(`${meeting.actionItems.length} action item(s) were identified.`);
      const highPriority = meeting.actionItems.filter((a) => a.priority === 'high');
      if (highPriority.length > 0) {
        parts.push(`High priority: ${highPriority.map((a) => a.description).join('; ')}.`);
      }
    }

    // Sentiment
    if (meeting.sentiment !== undefined) {
      const sentimentLabel = meeting.sentiment > 0.2 ? 'positive' : meeting.sentiment < -0.2 ? 'negative' : 'neutral';
      parts.push(`Overall meeting sentiment was ${sentimentLabel}.`);
    }

    return parts.join(' ');
  }

  // Helper methods
  private extractTopicKeywords(text: string): string[] {
    const stopwords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 's', 't', 'just', 'don', 'now', 'and', 'but', 'or', 'this', 'that', 'it', 'i', 'we', 'you', 'they', 'he', 'she']);

    const words = text.toLowerCase().match(/\b[a-z]{3,}\b/g) || [];
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

  private hasTopicChanged(oldTopic: string, newTopic: string, _keywordGroups: Map<string, string[]>): boolean {
    // Simple check: different primary keywords
    return oldTopic.toLowerCase() !== newTopic.toLowerCase();
  }

  private extractKeyPoint(text: string): string | null {
    // Look for statements that sound like key points
    const patterns = [
      /(?:key point|important|note that|remember)\s*:?\s*([^.!?]+[.!?])/i,
      /(?:in summary|to summarize|main takeaway)\s*:?\s*([^.!?]+[.!?])/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }

    return null;
  }

  private determinePriority(description: string): 'high' | 'medium' | 'low' {
    const highPriorityTerms = ['urgent', 'asap', 'critical', 'immediately', 'today', 'priority'];
    const lowPriorityTerms = ['eventually', 'when possible', 'nice to have', 'optional'];

    const lowerDesc = description.toLowerCase();

    if (highPriorityTerms.some((term) => lowerDesc.includes(term))) {
      return 'high';
    }
    if (lowPriorityTerms.some((term) => lowerDesc.includes(term))) {
      return 'low';
    }
    return 'medium';
  }

  private cleanActionDescription(description: string): string {
    return description
      .replace(/^(?:I will|I'll|we will|we'll|please|let's)\s+/i, '')
      .replace(/^(?:to|and)\s+/i, '')
      .trim();
  }

  private parseDate(dateStr: string): number | undefined {
    const parsed = Date.parse(dateStr);
    return isNaN(parsed) ? undefined : parsed;
  }

  private deduplicateActions(actions: ActionItem[]): ActionItem[] {
    const seen = new Set<string>();
    return actions.filter((action) => {
      const key = action.description.toLowerCase().substring(0, 50);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// ============================================================================
// Meeting Intelligence
// ============================================================================

export class MeetingIntelligence extends EventEmitter {
  private config: MeetingIntelligenceConfig;
  private meetings: Map<string, Meeting> = new Map();
  private activeMeeting: Meeting | null = null;
  private analyzer: MeetingTextAnalyzer;
  private dataPath: string;

  // Stats
  private stats = {
    meetingsAnalyzed: 0,
    actionItemsExtracted: 0,
    decisionsExtracted: 0,
    totalMeetingTime: 0,
  };

  constructor(config?: Partial<MeetingIntelligenceConfig>) {
    super();
    this.config = {
      autoExtractActions: true,
      autoExtractDecisions: true,
      sentimentAnalysis: true,
      topicDetection: true,
      minSegmentLength: 10,
      ...config,
    };

    this.analyzer = new MeetingTextAnalyzer();
    this.dataPath = path.join(app.getPath('userData'), 'meeting-intelligence.json');

    this.loadData();
    logger.info('MeetingIntelligence initialized', { config: this.config });
  }

  // ============================================================================
  // Data Persistence
  // ============================================================================

  private loadData(): void {
    try {
      if (fs.existsSync(this.dataPath)) {
        const data = JSON.parse(fs.readFileSync(this.dataPath, 'utf-8'));

        for (const meeting of data.meetings || []) {
          this.meetings.set(meeting.id, meeting);
        }

        if (data.stats) {
          this.stats = data.stats;
        }

        logger.info('Loaded meeting data', { count: this.meetings.size });
      }
    } catch (error) {
      logger.warn('Failed to load meeting data', { error });
    }
  }

  private saveData(): void {
    try {
      const data = {
        meetings: Array.from(this.meetings.values()),
        stats: this.stats,
        savedAt: Date.now(),
      };
      fs.writeFileSync(this.dataPath, JSON.stringify(data, null, 2));
    } catch (error) {
      logger.warn('Failed to save meeting data', { error });
    }
  }

  // ============================================================================
  // Meeting Lifecycle
  // ============================================================================

  /**
   * Start a new meeting
   */
  startMeeting(title: string, participants?: string[]): Meeting {
    if (this.activeMeeting) {
      this.endMeeting();
    }

    const meeting: Meeting = {
      id: this.generateId('meeting'),
      title,
      startTime: Date.now(),
      endTime: 0,
      duration: 0,
      participants: (participants || []).map((name) => ({
        id: this.generateId('participant'),
        name,
        speakingTime: 0,
        messageCount: 0,
        sentimentScore: 0,
      })),
      actionItems: [],
      decisions: [],
      topics: [],
      summary: '',
      transcript: [],
      sentiment: 0,
      engagement: 0,
      tags: [],
    };

    this.activeMeeting = meeting;
    this.emit('meeting-started', meeting);
    logger.info('Meeting started', { id: meeting.id, title });

    return meeting;
  }

  /**
   * Add a transcript segment
   */
  addSegment(speaker: string, text: string, timestamp?: number): void {
    if (!this.activeMeeting) return;
    if (text.length < this.config.minSegmentLength) return;

    const segment: MeetingSegment = {
      timestamp: timestamp || Date.now(),
      speaker,
      text,
      sentiment: this.config.sentimentAnalysis ? this.analyzer.analyzeSentiment(text) : undefined,
    };

    this.activeMeeting.transcript.push(segment);

    // Update participant stats
    let participant = this.activeMeeting.participants.find((p) => p.name === speaker);
    if (!participant) {
      participant = {
        id: this.generateId('participant'),
        name: speaker,
        speakingTime: 0,
        messageCount: 0,
        sentimentScore: 0,
      };
      this.activeMeeting.participants.push(participant);
    }
    participant.messageCount++;
    participant.speakingTime += this.estimateSpeakingTime(text);
    if (segment.sentiment !== undefined) {
      participant.sentimentScore =
        (participant.sentimentScore * (participant.messageCount - 1) + segment.sentiment) / participant.messageCount;
    }

    // Auto-extract action items
    if (this.config.autoExtractActions) {
      const actions = this.analyzer.extractActionItems(text, speaker, segment.timestamp);
      this.activeMeeting.actionItems.push(...actions);
      this.stats.actionItemsExtracted += actions.length;
    }

    // Auto-extract decisions
    if (this.config.autoExtractDecisions) {
      const decisions = this.analyzer.extractDecisions(text, speaker, segment.timestamp);
      this.activeMeeting.decisions.push(...decisions);
      this.stats.decisionsExtracted += decisions.length;
    }

    this.emit('segment-added', segment);
  }

  /**
   * End the active meeting
   */
  endMeeting(): Meeting | null {
    if (!this.activeMeeting) return null;

    const meeting = this.activeMeeting;
    meeting.endTime = Date.now();
    meeting.duration = meeting.endTime - meeting.startTime;

    // Detect topics
    if (this.config.topicDetection) {
      meeting.topics = this.analyzer.detectTopics(meeting.transcript);
    }

    // Calculate overall sentiment
    if (this.config.sentimentAnalysis && meeting.transcript.length > 0) {
      const sentiments = meeting.transcript.filter((s) => s.sentiment !== undefined).map((s) => s.sentiment!);

      meeting.sentiment = sentiments.length > 0 ? sentiments.reduce((a, b) => a + b, 0) / sentiments.length : 0;
    }

    // Calculate engagement
    meeting.engagement = this.calculateEngagement(meeting);

    // Generate summary
    meeting.summary = this.analyzer.generateSummary(meeting);

    // Store meeting
    this.meetings.set(meeting.id, meeting);
    this.stats.meetingsAnalyzed++;
    this.stats.totalMeetingTime += meeting.duration;

    this.activeMeeting = null;
    this.emit('meeting-ended', meeting);
    this.saveData();

    logger.info('Meeting ended', {
      id: meeting.id,
      duration: Math.round(meeting.duration / 60000),
      actionItems: meeting.actionItems.length,
      decisions: meeting.decisions.length,
    });

    return meeting;
  }

  // ============================================================================
  // Analysis
  // ============================================================================

  /**
   * Analyze a completed meeting
   */
  analyzeMeeting(meetingId: string): MeetingAnalysis | null {
    const meeting = this.meetings.get(meetingId);
    if (!meeting) return null;

    // Calculate participation balance (Gini coefficient style)
    const totalTime = meeting.participants.reduce((sum, p) => sum + p.speakingTime, 0);
    const participationBalance = this.calculateParticipationBalance(
      meeting.participants.map((p) => p.speakingTime),
      totalTime
    );

    // Top contributors
    const sortedParticipants = [...meeting.participants].sort((a, b) => b.speakingTime - a.speakingTime);
    const topContributors = sortedParticipants.slice(0, 3).map((p) => p.name);

    // Key topics
    const keyTopics = meeting.topics.sort((a, b) => b.duration - a.duration).slice(0, 5).map((t) => t.name);

    // Generate recommendations
    const recommendations = this.generateRecommendations(meeting, participationBalance);

    return {
      meetingId,
      participationBalance,
      topContributors,
      keyTopics,
      actionItemCount: meeting.actionItems.length,
      decisionCount: meeting.decisions.length,
      averageSentiment: meeting.sentiment,
      engagementScore: meeting.engagement,
      recommendations,
    };
  }

  /**
   * Process a full transcript
   */
  processTranscript(title: string, segments: MeetingSegment[]): Meeting {
    const meeting = this.startMeeting(title);

    for (const segment of segments) {
      this.addSegment(segment.speaker, segment.text, segment.timestamp);
    }

    return this.endMeeting()!;
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private calculateEngagement(meeting: Meeting): number {
    // Factors: participation balance, segment frequency, topic changes
    const participationScore = this.calculateParticipationBalance(
      meeting.participants.map((p) => p.speakingTime),
      meeting.participants.reduce((sum, p) => sum + p.speakingTime, 0)
    );

    const segmentFrequency = Math.min((meeting.transcript.length / (meeting.duration / 60000)) * 10, 1);

    const topicVariety = Math.min(meeting.topics.length / 5, 1);

    return (participationScore + segmentFrequency + topicVariety) / 3;
  }

  private calculateParticipationBalance(values: number[], total: number): number {
    if (values.length === 0 || total === 0) return 0;

    const n = values.length;
    const idealShare = total / n;
    const deviations = values.map((v) => Math.abs(v - idealShare));
    const avgDeviation = deviations.reduce((a, b) => a + b, 0) / n;

    return 1 - avgDeviation / idealShare;
  }

  private generateRecommendations(meeting: Meeting, participationBalance: number): string[] {
    const recommendations: string[] = [];

    if (participationBalance < 0.5) {
      recommendations.push('Consider encouraging more equal participation in future meetings');
    }

    if (meeting.actionItems.filter((a) => !a.assignee).length > 0) {
      recommendations.push('Some action items lack assignees - ensure clear ownership');
    }

    if (meeting.duration > 3600000) {
      // > 1 hour
      recommendations.push('Meeting was over an hour - consider breaking into shorter sessions');
    }

    if (meeting.decisions.length === 0 && meeting.duration > 1800000) {
      recommendations.push('No decisions recorded - ensure meetings have clear outcomes');
    }

    if (meeting.sentiment < -0.2) {
      recommendations.push('Meeting had negative sentiment - consider follow-up to address concerns');
    }

    return recommendations;
  }

  private estimateSpeakingTime(text: string): number {
    // Estimate ~150 words per minute
    const words = text.split(/\s+/).length;
    return (words / 150) * 60; // seconds
  }

  private generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // ============================================================================
  // Query Methods
  // ============================================================================

  /**
   * Get meeting by ID
   */
  getMeeting(meetingId: string): Meeting | undefined {
    return this.meetings.get(meetingId);
  }

  /**
   * Get all meetings
   */
  getAllMeetings(): Meeting[] {
    return Array.from(this.meetings.values());
  }

  /**
   * Get action items across all meetings
   */
  getActionItems(status?: ActionItem['status']): ActionItem[] {
    const items: ActionItem[] = [];

    for (const meeting of this.meetings.values()) {
      const filtered = status ? meeting.actionItems.filter((a) => a.status === status) : meeting.actionItems;

      items.push(...filtered);
    }

    return items.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  }

  /**
   * Get active meeting
   */
  getActiveMeeting(): Meeting | null {
    return this.activeMeeting;
  }

  /**
   * Update action item status
   */
  updateActionItem(meetingId: string, actionId: string, status: ActionItem['status']): boolean {
    const meeting = this.meetings.get(meetingId);
    if (!meeting) return false;

    const action = meeting.actionItems.find((a) => a.id === actionId);
    if (!action) return false;

    action.status = status;
    this.saveData();
    return true;
  }

  /**
   * Search meetings
   */
  searchMeetings(query: string): Meeting[] {
    const lowerQuery = query.toLowerCase();

    return Array.from(this.meetings.values()).filter(
      (meeting) =>
        meeting.title.toLowerCase().includes(lowerQuery) ||
        meeting.summary.toLowerCase().includes(lowerQuery) ||
        meeting.topics.some((t) => t.name.toLowerCase().includes(lowerQuery)) ||
        meeting.transcript.some((s) => s.text.toLowerCase().includes(lowerQuery))
    );
  }

  /**
   * Get statistics
   */
  getStats(): typeof this.stats & { totalMeetings: number; avgMeetingDuration: number } {
    const avgDuration = this.stats.meetingsAnalyzed > 0 ? this.stats.totalMeetingTime / this.stats.meetingsAnalyzed : 0;

    return {
      ...this.stats,
      totalMeetings: this.meetings.size,
      avgMeetingDuration: avgDuration,
    };
  }

  /**
   * Delete meeting
   */
  deleteMeeting(meetingId: string): boolean {
    const deleted = this.meetings.delete(meetingId);
    if (deleted) {
      this.saveData();
    }
    return deleted;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let meetingIntelligence: MeetingIntelligence | null = null;

export function getMeetingIntelligence(): MeetingIntelligence {
  if (!meetingIntelligence) {
    meetingIntelligence = new MeetingIntelligence();
  }
  return meetingIntelligence;
}
