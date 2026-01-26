/**
 * Email Parser
 * Parses email data and extracts entities and relationships
 */

import { createModuleLogger } from '../../../utils/logger';
import { OntologyEntity, OntologyRelationship, PersonEntity, DocumentEntity } from '../../types';
import {
  SemanticParser,
  EmailParsedOutput,
  EmailInput,
  EmailThread,
  EmailAttachment,
  Sentiment,
} from '../types';

const logger = createModuleLogger('EmailParser');

// ============================================================================
// EMAIL PARSER IMPLEMENTATION
// ============================================================================

export class EmailParser implements SemanticParser<EmailInput | EmailInput[], EmailParsedOutput> {
  readonly name = 'EmailParser';
  readonly version = '1.0.0';
  readonly sourceTypes = ['email'] as const;

  // --------------------------------------------------------------------------
  // MAIN PARSE
  // --------------------------------------------------------------------------

  async parse(input: EmailInput | EmailInput[]): Promise<EmailParsedOutput> {
    const emails = Array.isArray(input) ? input : [input];
    logger.debug('Parsing emails', { count: emails.length });

    const threads = this.groupIntoThreads(emails);
    const contacts: Map<string, { email: string; name?: string; count: number }> = new Map();
    const topics: Map<string, number> = new Map();

    for (const email of emails) {
      // Extract contacts
      this.extractContacts(email, contacts);

      // Extract topics from subject and body
      this.extractTopics(email, topics);
    }

    const output: EmailParsedOutput = {
      sourceType: 'email',
      parsedAt: new Date(),
      emails,
      threads,
      contacts: Array.from(contacts.values()).sort((a, b) => b.count - a.count),
      topics: Array.from(topics.entries())
        .map(([topic, count]) => ({ topic, count }))
        .sort((a, b) => b.count - a.count),
    };

    logger.info('Email parsing completed', {
      emailCount: emails.length,
      threadCount: threads.length,
      contactCount: contacts.size,
      topicCount: topics.size,
    });

    return output;
  }

  // --------------------------------------------------------------------------
  // THREAD GROUPING
  // --------------------------------------------------------------------------

  private groupIntoThreads(emails: EmailInput[]): EmailThread[] {
    const threadMap: Map<string, EmailInput[]> = new Map();

    for (const email of emails) {
      // Use conversationId if available, otherwise generate from subject
      const threadId = email.conversationId || this.generateThreadId(email.subject);

      if (!threadMap.has(threadId)) {
        threadMap.set(threadId, []);
      }
      threadMap.get(threadId)!.push(email);
    }

    const threads: EmailThread[] = [];

    for (const [threadId, threadEmails] of threadMap) {
      // Sort by date
      threadEmails.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      // Get unique participants
      const participants = new Set<string>();
      for (const email of threadEmails) {
        participants.add(email.from.email.toLowerCase());
        for (const to of email.to) {
          participants.add(to.email.toLowerCase());
        }
        for (const cc of email.cc || []) {
          participants.add(cc.email.toLowerCase());
        }
      }

      // Determine thread subject (from first email, removing Re:, Fwd: prefixes)
      const subject = this.normalizeSubject(threadEmails[0].subject);

      threads.push({
        id: threadId,
        subject,
        participants: Array.from(participants),
        messageCount: threadEmails.length,
        lastMessage: threadEmails[threadEmails.length - 1].date,
        hasAttachments: threadEmails.some(e => (e.attachments?.length || 0) > 0),
      });
    }

    return threads.sort(
      (a, b) => new Date(b.lastMessage).getTime() - new Date(a.lastMessage).getTime()
    );
  }

  private generateThreadId(subject: string): string {
    const normalized = this.normalizeSubject(subject).toLowerCase();
    // Simple hash for thread grouping
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return `thread_${Math.abs(hash).toString(36)}`;
  }

  private normalizeSubject(subject: string): string {
    return subject
      .replace(/^(re|fwd|fw):\s*/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // --------------------------------------------------------------------------
  // CONTACT EXTRACTION
  // --------------------------------------------------------------------------

  private extractContacts(
    email: EmailInput,
    contacts: Map<string, { email: string; name?: string; count: number }>
  ): void {
    const addContact = (addr: { email: string; name?: string }) => {
      const key = addr.email.toLowerCase();
      const existing = contacts.get(key);
      if (existing) {
        existing.count++;
        if (!existing.name && addr.name) {
          existing.name = addr.name;
        }
      } else {
        contacts.set(key, {
          email: addr.email,
          name: addr.name,
          count: 1,
        });
      }
    };

    addContact(email.from);
    for (const to of email.to) addContact(to);
    for (const cc of email.cc || []) addContact(cc);
  }

  // --------------------------------------------------------------------------
  // TOPIC EXTRACTION
  // --------------------------------------------------------------------------

  private extractTopics(email: EmailInput, topics: Map<string, number>): void {
    // Simple keyword extraction from subject and body
    const text = `${email.subject} ${email.body}`.toLowerCase();

    // Remove common stop words and extract keywords
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
      'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
      'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need',
      'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it',
      'we', 'they', 'what', 'which', 'who', 'when', 'where', 'why', 'how',
      're', 'fwd', 'fw', 'sent', 'received', 'please', 'thanks', 'thank',
    ]);

    const words = text
      .replace(/[^a-zA-Z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !stopWords.has(w));

    // Count word frequency
    const wordCounts = new Map<string, number>();
    for (const word of words) {
      wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
    }

    // Add frequent words as topics
    for (const [word, count] of wordCounts) {
      if (count >= 2) {
        topics.set(word, (topics.get(word) || 0) + count);
      }
    }
  }

  // --------------------------------------------------------------------------
  // ENTITY EXTRACTION
  // --------------------------------------------------------------------------

  extractEntities(output: EmailParsedOutput): OntologyEntity[] {
    const entities: OntologyEntity[] = [];
    const personMap = new Map<string, PersonEntity>();

    // Create Person entities from contacts
    for (const contact of output.contacts) {
      const personId = `person_${contact.email.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;

      if (!personMap.has(personId)) {
        const nameParts = this.parseContactName(contact.name || contact.email);

        const person: PersonEntity = {
          id: personId,
          type: 'Person',
          name: contact.name || contact.email.split('@')[0],
          createdAt: new Date(),
          updatedAt: new Date(),
          sources: ['email'],
          confidence: 0.7,
          firstName: nameParts.firstName,
          lastName: nameParts.lastName,
          emails: [{ email: contact.email, type: 'work', primary: true }],
          phones: [],
          socialProfiles: [],
          addresses: [],
          tags: [],
          communicationFrequency: this.calculateFrequency(contact.count),
          lastContactDate: new Date(), // Would be set from actual email dates
        };

        personMap.set(personId, person);
        entities.push(person);
      }
    }

    // Create Document entities for emails with attachments
    for (const email of output.emails) {
      if (email.attachments && email.attachments.length > 0) {
        for (const attachment of email.attachments) {
          const docId = `doc_email_${email.id}_${attachment.filename.replace(/[^a-z0-9]/gi, '_')}`;

          const doc: DocumentEntity = {
            id: docId,
            type: 'Document',
            name: attachment.filename,
            createdAt: new Date(email.date),
            updatedAt: new Date(email.date),
            sources: ['email'],
            confidence: 0.9,
            documentType: this.getDocumentType(attachment.contentType),
            path: `email://${email.id}/${attachment.filename}`,
            mimeType: attachment.contentType,
            size: attachment.size,
            tags: [],
            mentions: [],
            relatedEntities: [],
            accessLevel: 'private',
          };

          entities.push(doc);
        }
      }
    }

    logger.debug('Extracted entities from emails', {
      personCount: personMap.size,
      documentCount: entities.length - personMap.size,
    });

    return entities;
  }

  private parseContactName(name: string): { firstName?: string; lastName?: string } {
    if (!name || name.includes('@')) {
      return {};
    }

    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) {
      return { firstName: parts[0] };
    }

    return {
      firstName: parts[0],
      lastName: parts.slice(1).join(' '),
    };
  }

  private calculateFrequency(count: number): 'daily' | 'weekly' | 'monthly' | 'rarely' {
    if (count >= 20) return 'daily';
    if (count >= 5) return 'weekly';
    if (count >= 2) return 'monthly';
    return 'rarely';
  }

  private getDocumentType(mimeType: string): string {
    if (mimeType.includes('pdf')) return 'pdf';
    if (mimeType.includes('word') || mimeType.includes('document')) return 'document';
    if (mimeType.includes('sheet') || mimeType.includes('excel')) return 'spreadsheet';
    if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return 'presentation';
    if (mimeType.includes('image')) return 'image';
    return 'other';
  }

  // --------------------------------------------------------------------------
  // RELATIONSHIP EXTRACTION
  // --------------------------------------------------------------------------

  extractRelationships(output: EmailParsedOutput): OntologyRelationship[] {
    const relationships: OntologyRelationship[] = [];
    const relMap = new Map<string, OntologyRelationship>();

    for (const email of output.emails) {
      const fromId = `person_${email.from.email.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;

      // Create COMMUNICATED_WITH relationships
      for (const to of email.to) {
        const toId = `person_${to.email.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
        const relKey = `${fromId}_communicated_${toId}`;

        if (!relMap.has(relKey)) {
          const rel: OntologyRelationship = {
            id: relKey,
            sourceId: fromId,
            sourceType: 'Person',
            targetId: toId,
            targetType: 'Person',
            relationshipType: 'COMMUNICATED_WITH',
            properties: {
              emailCount: 1,
              lastEmail: email.date,
            },
            createdAt: new Date(),
            strength: 0.5,
            confidence: 0.9,
          };
          relMap.set(relKey, rel);
        } else {
          const existing = relMap.get(relKey)!;
          existing.properties!.emailCount = (existing.properties!.emailCount as number) + 1;
          existing.properties!.lastEmail = email.date;
          existing.strength = Math.min(1, existing.strength + 0.1);
        }
      }

      // Link attachments to sender
      if (email.attachments) {
        for (const attachment of email.attachments) {
          const docId = `doc_email_${email.id}_${attachment.filename.replace(/[^a-z0-9]/gi, '_')}`;

          relationships.push({
            id: `${fromId}_authored_${docId}`,
            sourceId: fromId,
            sourceType: 'Person',
            targetId: docId,
            targetType: 'Document',
            relationshipType: 'AUTHORED',
            createdAt: new Date(),
            strength: 0.8,
            confidence: 0.9,
          });
        }
      }
    }

    relationships.push(...relMap.values());

    logger.debug('Extracted relationships from emails', { count: relationships.length });
    return relationships;
  }

  // --------------------------------------------------------------------------
  // EMBEDDING GENERATION
  // --------------------------------------------------------------------------

  async generateEmbeddings(output: EmailParsedOutput): Promise<Map<string, number[]>> {
    const embeddings = new Map<string, number[]>();

    // Placeholder - would integrate with actual embedding model
    // For now, return empty map
    logger.debug('Embedding generation skipped (placeholder)', {
      emailCount: output.emails.length,
    });

    return embeddings;
  }

  // --------------------------------------------------------------------------
  // SENTIMENT ANALYSIS
  // --------------------------------------------------------------------------

  analyzeSentiment(text: string): Sentiment {
    // Simple keyword-based sentiment analysis
    const positiveWords = [
      'great', 'good', 'excellent', 'thanks', 'thank', 'appreciate',
      'pleased', 'happy', 'wonderful', 'fantastic', 'amazing', 'love',
    ];
    const negativeWords = [
      'bad', 'poor', 'terrible', 'sorry', 'unfortunately', 'problem',
      'issue', 'concern', 'disappointed', 'frustrated', 'angry', 'upset',
    ];

    const lowerText = text.toLowerCase();
    let positiveCount = 0;
    let negativeCount = 0;

    for (const word of positiveWords) {
      if (lowerText.includes(word)) positiveCount++;
    }
    for (const word of negativeWords) {
      if (lowerText.includes(word)) negativeCount++;
    }

    const total = positiveCount + negativeCount;
    if (total === 0) {
      return { score: 0, label: 'neutral', confidence: 0.5 };
    }

    const score = (positiveCount - negativeCount) / total;
    const confidence = Math.min(0.9, 0.5 + total * 0.05);

    let label: Sentiment['label'];
    if (score > 0.3) label = 'positive';
    else if (score < -0.3) label = 'negative';
    else label = 'neutral';

    return { score, label, confidence };
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let instance: EmailParser | null = null;

export function getEmailParser(): EmailParser {
  if (!instance) {
    instance = new EmailParser();
  }
  return instance;
}
