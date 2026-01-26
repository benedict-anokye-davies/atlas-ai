/**
 * Semantic Layer Types
 * Types for data source parsers and semantic extraction
 */

import {
  DataSourceType,
  PersonReference,
  ProjectReference,
  DateReference,
  MoneyReference,
  Topic,
  ActionItem,
  Sentiment,
  UrgencyLevel,
  EmailIntent,
  MeetingType,
  FileType,
  TransactionCategory,
  RecurringFrequency,
  LocationReference,
  RecurrenceRule,
  OntologyEntity,
  OntologyRelationship,
  EmbeddingSet,
} from '../types';

// ============================================================================
// PARSER BASE TYPES
// ============================================================================

export interface SemanticParser<TInput, TOutput> {
  readonly name: string;
  readonly version: string;
  readonly supportedSources: DataSourceType[];

  parse(input: TInput): Promise<TOutput>;
  parseIncremental(input: TInput, lastSync: Date): Promise<TOutput[]>;
  extractEntities(output: TOutput): OntologyEntity[];
  extractRelationships(output: TOutput): OntologyRelationship[];
  generateEmbeddings(output: TOutput): Promise<EmbeddingSet>;
}

export interface DataSource {
  id: string;
  type: DataSourceType;
  name: string;
  config: Record<string, unknown>;
  enabled: boolean;
  lastSync: Date | null;
  syncStatus: 'idle' | 'syncing' | 'error';
  errorMessage?: string;
}

export interface SyncSchedule {
  interval: number; // minutes
  enabled: boolean;
  lastRun: Date | null;
  nextRun: Date | null;
}

export interface ParserConfig {
  sourceType: DataSourceType;
  enabled: boolean;
  options: Record<string, unknown>;
}

export interface SemanticLayerConfig {
  parsers: ParserConfig[];
  syncSchedule: SyncSchedule;
  embeddingModel: string;
  maxConcurrentParsers: number;
}

export interface IngestResult {
  source: DataSourceType;
  entitiesCreated: number;
  entitiesUpdated: number;
  relationshipsCreated: number;
  errors: string[];
  duration: number;
}

// ============================================================================
// EMAIL PARSER TYPES
// ============================================================================

export interface EmailRawInput {
  messageId: string;
  threadId?: string;
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
  date: Date;
  headers?: Record<string, string>;
  attachments?: EmailAttachment[];
}

export interface EmailAttachment {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  contentId?: string;
}

export interface EmailParsedOutput {
  // Direct extraction
  messageId: string;
  threadId: string;
  from: PersonReference;
  to: PersonReference[];
  cc: PersonReference[];
  subject: string;
  bodyText: string;
  bodyHtml: string;
  attachments: EmailAttachment[];
  timestamp: Date;

  // Derived entities
  mentionedPeople: PersonReference[];
  mentionedProjects: ProjectReference[];
  mentionedDates: DateReference[];
  mentionedAmounts: MoneyReference[];

  // Semantic analysis
  intent: EmailIntent;
  sentiment: Sentiment;
  urgency: UrgencyLevel;
  actionItems: ActionItem[];
  topics: Topic[];

  // Embeddings
  subjectEmbedding: number[];
  bodyEmbedding: number[];
}

// ============================================================================
// CALENDAR PARSER TYPES
// ============================================================================

export interface CalendarRawInput {
  eventId: string;
  calendarId?: string;
  title: string;
  description?: string;
  startTime: Date;
  endTime: Date;
  isAllDay?: boolean;
  location?: string;
  attendees?: CalendarAttendee[];
  organizer?: CalendarAttendee;
  recurrence?: string; // RRULE format
  status?: string;
  conferenceLink?: string;
}

export interface CalendarAttendee {
  email: string;
  name?: string;
  responseStatus?: 'accepted' | 'declined' | 'tentative' | 'needsAction';
  isOrganizer?: boolean;
}

export interface CalendarParsedOutput {
  // Direct extraction
  eventId: string;
  title: string;
  description: string;
  startTime: Date;
  endTime: Date;
  location: LocationReference | null;
  attendees: PersonReference[];
  organizer: PersonReference;
  recurrence: RecurrenceRule | null;
  status: 'confirmed' | 'tentative' | 'cancelled';

  // Derived entities
  mentionedProjects: ProjectReference[];
  meetingType: MeetingType;
  estimatedDuration: number; // minutes

  // Patterns
  attendeeOverlap: PersonReference[];
  timeBlockCategory: 'deep_work' | 'meetings' | 'personal' | 'admin';

  // Embeddings
  titleEmbedding: number[];
  descriptionEmbedding: number[];
}

// ============================================================================
// FILE INDEXER TYPES
// ============================================================================

export interface FileRawInput {
  filePath: string;
  fileName: string;
  fileExtension: string;
  mimeType?: string;
  sizeBytes: number;
  createdAt: Date;
  modifiedAt: Date;
  accessedAt?: Date;
  content?: string; // For text-based files
}

export interface FileParsedOutput {
  // Metadata
  fileId: string;
  fileName: string;
  filePath: string;
  fileType: FileType;
  mimeType: string;
  sizeBytes: number;
  createdAt: Date;
  modifiedAt: Date;
  accessedAt: Date;

  // Content extraction
  textContent: string;
  headings: string[];
  links: LinkReference[];
  tables: TableReference[];

  // Derived entities
  mentionedPeople: PersonReference[];
  mentionedProjects: ProjectReference[];
  relatedDocuments: DocumentReference[];
  topics: Topic[];

  // Document intelligence
  documentType: 'report' | 'notes' | 'code' | 'presentation' | 'spreadsheet' | 'other';
  completionStatus: number;

  // Embeddings
  contentEmbedding: number[];
  titleEmbedding: number[];
}

export interface LinkReference {
  url: string;
  text: string;
  type: 'internal' | 'external' | 'anchor';
}

export interface TableReference {
  headers: string[];
  rowCount: number;
  preview: string[][];
}

export interface DocumentReference {
  path: string;
  title: string;
  type: string;
}

// ============================================================================
// CONTACT RESOLVER TYPES
// ============================================================================

export interface ContactRawInput {
  sourceId: string;
  sourceType: DataSourceType;
  name?: string;
  firstName?: string;
  lastName?: string;
  emails?: string[];
  phones?: string[];
  organization?: string;
  jobTitle?: string;
  notes?: string;
  socialProfiles?: { platform: string; url: string }[];
  lastModified?: Date;
}

export interface ContactParsedOutput {
  // Golden record (canonical)
  personId: string;
  canonicalName: string;
  primaryEmail: string;

  // All known identifiers
  emails: { email: string; type: 'work' | 'personal' | 'other'; isPrimary: boolean }[];
  phones: { phone: string; type: 'mobile' | 'work' | 'home' | 'other'; isPrimary: boolean }[];
  socialProfiles: { platform: string; url: string; username: string }[];

  // Relationship context
  relationship: 'colleague' | 'client' | 'friend' | 'family' | 'acquaintance';
  organization: string | null;
  role: string | null;

  // Interaction history
  firstInteraction: Date | null;
  lastInteraction: Date | null;
  interactionCount: number;
  averageResponseTime: number | null;

  // Source records
  sourceRecords: ContactSourceRecord[];
  mergeConfidence: number;

  // Embeddings
  profileEmbedding: number[];
}

export interface ContactSourceRecord {
  sourceType: DataSourceType;
  sourceId: string;
  data: ContactRawInput;
  extractedAt: Date;
}

// ============================================================================
// TRANSACTION ANALYZER TYPES
// ============================================================================

export interface TransactionRawInput {
  transactionId: string;
  accountId: string;
  amount: number;
  currency: string;
  date: Date;
  description: string;
  merchantName?: string;
  category?: string;
  pending?: boolean;
  counterpartyName?: string;
  counterpartyAccount?: string;
  reference?: string;
  metadata?: Record<string, unknown>;
}

export interface TransactionParsedOutput {
  // Core transaction
  transactionId: string;
  accountId: string;
  amount: number;
  currency: string;
  date: Date;
  description: string;
  merchantName: string;

  // Categorization
  category: TransactionCategory;
  subcategory: string;
  isRecurring: boolean;
  recurringFrequency: RecurringFrequency | null;

  // Derived context
  location: LocationReference | null;
  relatedPerson: PersonReference | null;
  relatedProject: ProjectReference | null;

  // Analysis
  anomalyScore: number;
  budgetImpact: BudgetImpact;

  // Embeddings
  descriptionEmbedding: number[];
}

export interface BudgetImpact {
  category: string;
  budgetAmount: number;
  spentBeforeThis: number;
  spentAfterThis: number;
  percentUsed: number;
  overBudget: boolean;
}
