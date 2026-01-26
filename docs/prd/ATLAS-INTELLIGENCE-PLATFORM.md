# ATLAS INTELLIGENCE PLATFORM
## Product Requirements Document (PRD)
### Palantir-Style Personal Intelligence System

**Version:** 1.0  
**Date:** January 22, 2026  
**Status:** Draft  
**Author:** Atlas Development Team

---

## Executive Summary

Atlas Intelligence Platform transforms Atlas Desktop from a voice assistant into a **personal intelligence operating system** - a unified platform that integrates all personal data sources into a coherent ontology, enables multi-hop knowledge queries, provides real-time situational awareness, and drives autonomous agents for trading, project management, finance, and relationship management.

This PRD defines the implementation of a **three-layer architecture** inspired by Palantir Foundry, adapted for personal use with voice-first interaction and local-first privacy.

### Key Differentiators vs Palantir

| Dimension | Palantir | Atlas |
|-----------|----------|-------|
| **Interface** | Web dashboard | Voice-native |
| **Architecture** | Cloud-dependent | Local-first, privacy-preserving |
| **Setup Time** | 6+ months | < 5 minutes |
| **Cost** | $2.5M - $7.5M | Free / Freemium |
| **Specialization** | Enterprise operations | Personal productivity + Trading |
| **Data Scale** | 100GB+ enterprise | 1-50GB personal |

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Layer 1: Semantic Layer (Data → Objects)](#2-layer-1-semantic-layer)
3. [Layer 2: Unified Ontology](#3-layer-2-unified-ontology)
4. [Layer 3: Kinetic Layer (Objects → Actions)](#4-layer-3-kinetic-layer)
5. [Layer 4: Dynamic Layer (Actions → Learning)](#5-layer-4-dynamic-layer)
6. [Entity Resolution Engine](#6-entity-resolution-engine)
7. [Knowledge Graph & Temporal Reasoning](#7-knowledge-graph--temporal-reasoning)
8. [Common Operating Picture (COP)](#8-common-operating-picture-cop)
9. [Playbook Engine](#9-playbook-engine)
10. [Security & Privacy](#10-security--privacy)
11. [Technical Specifications](#11-technical-specifications)
12. [Implementation Roadmap](#12-implementation-roadmap)
13. [Success Metrics](#13-success-metrics)

---

## 1. Architecture Overview

### 1.1 Three-Layer Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ATLAS INTELLIGENCE PLATFORM                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     DATA SOURCES (Raw Inputs)                        │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────────┐   │   │
│  │  │  Email  │ │Calendar │ │  Files  │ │Contacts │ │Transactions │   │   │
│  │  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └──────┬──────┘   │   │
│  └───────┼──────────┼──────────┼──────────┼───────────────┼──────────┘   │
│          │          │          │          │               │              │
│          ▼          ▼          ▼          ▼               ▼              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    SEMANTIC LAYER (Parsers)                          │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────────┐   │   │
│  │  │ Email   │ │Calendar │ │  File   │ │Contact  │ │ Transaction │   │   │
│  │  │ Parser  │ │Extractor│ │ Indexer │ │Resolver │ │  Analyzer   │   │   │
│  │  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └──────┬──────┘   │   │
│  └───────┼──────────┼──────────┼──────────┼───────────────┼──────────┘   │
│          │          │          │          │               │              │
│          └──────────┴──────────┴────┬─────┴───────────────┘              │
│                                     ▼                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                      UNIFIED ONTOLOGY (Core)                         │   │
│  │                                                                      │   │
│  │   ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐     │   │
│  │   │  Person  │◄──►│  Project │◄──►│   Task   │◄──►│  Event   │     │   │
│  │   └──────────┘    └──────────┘    └──────────┘    └──────────┘     │   │
│  │        ▲               ▲               ▲               ▲           │   │
│  │        │               │               │               │           │   │
│  │        ▼               ▼               ▼               ▼           │   │
│  │   ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐     │   │
│  │   │   Org    │◄──►│   Skill  │◄──►│ Document │◄──►│  Trade   │     │   │
│  │   └──────────┘    └──────────┘    └──────────┘    └──────────┘     │   │
│  │                                                                      │   │
│  │   Entity Resolution │ Knowledge Graph │ Temporal Reasoning          │   │
│  └─────────────────────────────┬───────────────────────────────────────┘   │
│                                │                                          │
│          ┌─────────────────────┼─────────────────────┐                    │
│          ▼                     ▼                     ▼                    │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     KINETIC LAYER (Agents)                           │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────────┐   │   │
│  │  │Trading  │ │Project  │ │Financial│ │Relation-│ │  Research   │   │   │
│  │  │ Agent   │ │Mgr Agent│ │  Agent  │ │ship Agent│ │   Agent    │   │   │
│  │  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └──────┬──────┘   │   │
│  └───────┼──────────┼──────────┼──────────┼───────────────┼──────────┘   │
│          │          │          │          │               │              │
│          └──────────┴──────────┴────┬─────┴───────────────┘              │
│                                     ▼                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    DYNAMIC LAYER (Learning)                          │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────────┐   │   │
│  │  │Decision │ │Outcome  │ │ Model   │ │Feedback │ │  Anomaly    │   │   │
│  │  │ Logging │ │Tracking │ │Retrain  │ │Integratn│ │ Detection   │   │   │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Core Principles

1. **Voice-Native**: All features accessible via natural language voice commands
2. **Local-First**: Data stored locally with optional cloud sync
3. **Privacy-Preserving**: User controls what data leaves the device
4. **Incrementally Adoptable**: Start with one data source, add more over time
5. **Agent-Driven**: Autonomous agents take actions with human approval
6. **Continuously Learning**: System improves from every interaction

---

## 2. Layer 1: Semantic Layer

The Semantic Layer transforms raw data from various sources into structured ontology objects.

### 2.1 Data Source Parsers

#### 2.1.1 Email Parser

**Purpose:** Extract entities, relationships, and context from email communications.

**Input Sources:**
- Gmail API
- Microsoft Graph API (Outlook)
- IMAP/POP3 (generic)
- Local .eml/.mbox files

**Extracted Entities:**
```typescript
interface EmailParsedOutput {
  // Direct extraction
  messageId: string;
  threadId: string;
  from: PersonReference;
  to: PersonReference[];
  cc: PersonReference[];
  subject: string;
  bodyText: string;
  bodyHtml: string;
  attachments: Attachment[];
  timestamp: Date;
  
  // Derived entities
  mentionedPeople: PersonReference[];
  mentionedProjects: ProjectReference[];
  mentionedDates: DateReference[];
  mentionedAmounts: MoneyReference[];
  
  // Semantic analysis
  intent: EmailIntent; // request, inform, question, followup
  sentiment: Sentiment; // positive, negative, neutral
  urgency: UrgencyLevel; // low, medium, high, critical
  actionItems: ActionItem[];
  topics: Topic[];
  
  // Embeddings
  subjectEmbedding: number[];
  bodyEmbedding: number[];
}
```

**Processing Pipeline:**
```
Raw Email → Header Parser → Body Parser → NLP Extractor → Entity Linker → Ontology Writer
```

**Voice Commands:**
- "Show me emails from Sarah about Project Alpha"
- "What action items came from yesterday's emails?"
- "Find emails mentioning the budget review"

---

#### 2.1.2 Calendar Extractor

**Purpose:** Extract events, attendees, and scheduling patterns.

**Input Sources:**
- Google Calendar API
- Microsoft Graph API (Outlook Calendar)
- CalDAV (generic)
- Local .ics files

**Extracted Entities:**
```typescript
interface CalendarParsedOutput {
  // Direct extraction
  eventId: string;
  title: string;
  description: string;
  startTime: Date;
  endTime: Date;
  location: LocationReference;
  attendees: PersonReference[];
  organizer: PersonReference;
  recurrence: RecurrenceRule;
  status: EventStatus; // confirmed, tentative, cancelled
  
  // Derived entities
  mentionedProjects: ProjectReference[];
  meetingType: MeetingType; // 1on1, team, external, personal
  estimatedDuration: number;
  
  // Patterns
  attendeeOverlap: PersonReference[]; // Who you meet with often
  timeBlockCategory: TimeCategory; // deep_work, meetings, personal
  
  // Embeddings
  titleEmbedding: number[];
  descriptionEmbedding: number[];
}
```

**Derived Insights:**
- Meeting load (hours/week in meetings)
- Collaboration patterns (who you meet with most)
- Time allocation (deep work vs meetings)
- Schedule conflicts and overcommitment

**Voice Commands:**
- "What meetings do I have with the engineering team this week?"
- "Show my collaboration pattern with Sarah"
- "When was my last 1-on-1 with my manager?"

---

#### 2.1.3 File Indexer

**Purpose:** Index documents, extract content, and track file activity.

**Input Sources:**
- Local filesystem (configurable paths)
- Google Drive
- Dropbox
- OneDrive
- Obsidian vault

**Extracted Entities:**
```typescript
interface FileParsedOutput {
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
  
  // Content extraction (for supported types)
  textContent: string;
  headings: string[];
  links: LinkReference[];
  images: ImageReference[];
  tables: TableReference[];
  
  // Derived entities
  mentionedPeople: PersonReference[];
  mentionedProjects: ProjectReference[];
  relatedDocuments: DocumentReference[];
  topics: Topic[];
  
  // Document intelligence
  documentType: DocumentType; // report, notes, code, presentation
  completionStatus: number; // 0-100% for drafts
  
  // Embeddings
  contentEmbedding: number[];
  titleEmbedding: number[];
}
```

**Supported File Types:**
- Text: .txt, .md, .rtf
- Documents: .docx, .pdf, .odt
- Spreadsheets: .xlsx, .csv
- Presentations: .pptx
- Code: .ts, .js, .py, .go, etc.
- Images: .png, .jpg (OCR extraction)

**Voice Commands:**
- "Find documents about Q1 planning"
- "Show files I modified this week related to Project Alpha"
- "What's the status of my report draft?"

---

#### 2.1.4 Contact Resolver

**Purpose:** Unify contact information across all sources into canonical person records.

**Input Sources:**
- Google Contacts
- Microsoft People
- Phone contacts (via mobile sync)
- LinkedIn connections (manual import)
- Email signatures
- Calendar attendees

**Output:**
```typescript
interface ContactParsedOutput {
  // Golden record (canonical)
  personId: string;
  canonicalName: string;
  primaryEmail: string;
  
  // All known identifiers
  emails: EmailIdentifier[];
  phones: PhoneIdentifier[];
  socialProfiles: SocialProfile[];
  
  // Relationship context
  relationship: RelationshipType; // colleague, client, friend, family
  organization: OrganizationReference;
  role: string;
  
  // Interaction history
  firstInteraction: Date;
  lastInteraction: Date;
  interactionCount: number;
  averageResponseTime: number;
  
  // Source records
  sourceRecords: SourceRecord[]; // Original records before merge
  mergeConfidence: number;
  
  // Embeddings
  profileEmbedding: number[];
}
```

**Voice Commands:**
- "Who is John Smith at Acme Corp?"
- "Show me everyone I know at Google"
- "When did I last talk to Sarah?"

---

#### 2.1.5 Transaction Analyzer

**Purpose:** Parse financial transactions and extract spending patterns.

**Input Sources:**
- Open Banking APIs (TrueLayer, Plaid)
- Bank statement imports (CSV, OFX, QIF)
- Manual transaction entry
- Trading platform data

**Output:**
```typescript
interface TransactionParsedOutput {
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
  recurringFrequency: RecurringFrequency;
  
  // Derived context
  location: LocationReference;
  relatedPerson: PersonReference;
  relatedProject: ProjectReference;
  
  // Analysis
  anomalyScore: number; // 0-1, higher = more unusual
  budgetImpact: BudgetImpact;
  
  // Embeddings
  descriptionEmbedding: number[];
}
```

**Voice Commands:**
- "How much did I spend on subscriptions this month?"
- "Show unusual transactions this week"
- "What's my spending trend for restaurants?"

---

### 2.2 Semantic Layer Architecture

```typescript
// src/main/intelligence/semantic/types.ts

export interface SemanticParser<TInput, TOutput> {
  readonly name: string;
  readonly version: string;
  readonly supportedSources: DataSourceType[];
  
  // Core parsing
  parse(input: TInput): Promise<TOutput>;
  parseIncremental(input: TInput, lastSync: Date): Promise<TOutput[]>;
  
  // Entity extraction
  extractEntities(output: TOutput): OntologyEntity[];
  extractRelationships(output: TOutput): OntologyRelationship[];
  
  // Embeddings
  generateEmbeddings(output: TOutput): Promise<EmbeddingSet>;
}

export interface SemanticLayerConfig {
  parsers: ParserConfig[];
  syncSchedule: SyncSchedule;
  embeddingModel: string;
  maxConcurrentParsers: number;
}

export class SemanticLayerManager {
  private parsers: Map<DataSourceType, SemanticParser<any, any>>;
  private ontologyWriter: OntologyWriter;
  private embeddingService: EmbeddingService;
  
  async ingestFromSource(source: DataSource): Promise<IngestResult> {
    const parser = this.parsers.get(source.type);
    const rawData = await source.fetch();
    const parsed = await parser.parse(rawData);
    const entities = parser.extractEntities(parsed);
    const relationships = parser.extractRelationships(parsed);
    const embeddings = await parser.generateEmbeddings(parsed);
    
    await this.ontologyWriter.writeEntities(entities);
    await this.ontologyWriter.writeRelationships(relationships);
    await this.ontologyWriter.writeEmbeddings(embeddings);
    
    return { entitiesCreated: entities.length, relationshipsCreated: relationships.length };
  }
  
  async syncAll(): Promise<SyncReport> {
    // Parallel sync of all configured sources
  }
}
```

---

## 3. Layer 2: Unified Ontology

The Unified Ontology is the **single source of truth** for all personal data. It defines entity types, relationships, and multi-modal properties.

### 3.1 Core Entity Types

#### 3.1.1 Person Entity

```typescript
interface PersonEntity {
  // Identity
  id: string;
  type: 'Person';
  canonicalName: string;
  
  // Contact info
  emails: Email[];
  phones: Phone[];
  socialProfiles: SocialProfile[];
  
  // Context
  currentOrganization: string | null;
  currentRole: string | null;
  location: LocationReference | null;
  
  // Relationship to user
  relationshipType: 'self' | 'colleague' | 'client' | 'friend' | 'family' | 'acquaintance';
  relationshipStrength: number; // 0-1 based on interaction frequency
  
  // Multi-modal properties
  structured: {
    birthDate?: Date;
    timezone?: string;
    preferredLanguage?: string;
  };
  unstructured: {
    bio?: string;
    notes?: string;
    recentContext?: string; // LLM-summarized recent interactions
  };
  modelDerived: {
    influenceScore: number;
    responsiveness: number;
    expertiseAreas: string[];
    sentimentTowardsUser: number;
  };
  embeddings: {
    profileEmbedding: number[];
    interactionEmbedding: number[];
  };
  
  // Provenance
  sourceRecords: SourceRecord[];
  createdAt: Date;
  updatedAt: Date;
  confidence: number;
}
```

#### 3.1.2 Project Entity

```typescript
interface ProjectEntity {
  id: string;
  type: 'Project';
  name: string;
  description: string;
  
  // Status
  status: 'planning' | 'active' | 'on_hold' | 'completed' | 'cancelled';
  progress: number; // 0-100
  health: 'green' | 'yellow' | 'red';
  
  // Timeline
  startDate: Date | null;
  targetEndDate: Date | null;
  actualEndDate: Date | null;
  
  // Relationships (stored separately but summarized here)
  ownerIds: string[];
  contributorIds: string[];
  taskIds: string[];
  documentIds: string[];
  
  // Multi-modal
  structured: {
    budget?: number;
    priority: 'low' | 'medium' | 'high' | 'critical';
    tags: string[];
  };
  unstructured: {
    objectives?: string;
    risks?: string;
    recentUpdates?: string;
  };
  modelDerived: {
    completionForecast: Date;
    riskScore: number;
    velocityTrend: 'increasing' | 'stable' | 'decreasing';
  };
  embeddings: {
    descriptionEmbedding: number[];
  };
  
  provenance: SourceRecord[];
  createdAt: Date;
  updatedAt: Date;
}
```

#### 3.1.3 Task Entity

```typescript
interface TaskEntity {
  id: string;
  type: 'Task';
  title: string;
  description: string;
  
  // Status
  status: 'todo' | 'in_progress' | 'blocked' | 'done' | 'cancelled';
  priority: 'low' | 'medium' | 'high' | 'critical';
  
  // Timeline
  dueDate: Date | null;
  completedAt: Date | null;
  estimatedHours: number | null;
  actualHours: number | null;
  
  // Context
  projectId: string | null;
  assigneeId: string | null;
  createdById: string;
  blockedByIds: string[];
  
  // Multi-modal
  structured: {
    tags: string[];
    recurrence?: RecurrenceRule;
  };
  unstructured: {
    notes?: string;
    blockerDescription?: string;
  };
  modelDerived: {
    urgencyScore: number;
    effortEstimate: number;
    completionProbability: number;
  };
  embeddings: {
    titleEmbedding: number[];
    descriptionEmbedding: number[];
  };
  
  provenance: SourceRecord[];
  createdAt: Date;
  updatedAt: Date;
}
```

#### 3.1.4 Event Entity

```typescript
interface EventEntity {
  id: string;
  type: 'Event';
  title: string;
  description: string;
  
  // Time
  startTime: Date;
  endTime: Date;
  isAllDay: boolean;
  timezone: string;
  
  // Location
  location: LocationReference | null;
  isVirtual: boolean;
  meetingLink: string | null;
  
  // Participants
  organizerId: string;
  attendeeIds: string[];
  
  // Context
  projectIds: string[];
  meetingType: 'one_on_one' | 'team' | 'external' | 'personal' | 'focus_time';
  
  // Multi-modal
  structured: {
    recurrence?: RecurrenceRule;
    status: 'confirmed' | 'tentative' | 'cancelled';
  };
  unstructured: {
    agenda?: string;
    notes?: string;
    outcomes?: string;
    actionItems?: string[];
  };
  modelDerived: {
    importanceScore: number;
    prepRequired: boolean;
    followupNeeded: boolean;
  };
  embeddings: {
    titleEmbedding: number[];
    descriptionEmbedding: number[];
  };
  
  provenance: SourceRecord[];
  createdAt: Date;
  updatedAt: Date;
}
```

#### 3.1.5 Organization Entity

```typescript
interface OrganizationEntity {
  id: string;
  type: 'Organization';
  name: string;
  
  // Details
  industry: string | null;
  size: 'startup' | 'small' | 'medium' | 'large' | 'enterprise' | null;
  website: string | null;
  
  // Your relationship
  relationshipType: 'employer' | 'client' | 'vendor' | 'partner' | 'prospect' | 'other';
  
  // Multi-modal
  structured: {
    headquarters?: LocationReference;
    founded?: number;
  };
  unstructured: {
    description?: string;
    notes?: string;
  };
  modelDerived: {
    importanceScore: number;
    interactionFrequency: number;
  };
  embeddings: {
    descriptionEmbedding: number[];
  };
  
  provenance: SourceRecord[];
  createdAt: Date;
  updatedAt: Date;
}
```

#### 3.1.6 Document Entity

```typescript
interface DocumentEntity {
  id: string;
  type: 'Document';
  title: string;
  
  // Location
  sourcePath: string;
  sourceType: 'local' | 'google_drive' | 'dropbox' | 'onedrive' | 'obsidian';
  
  // Content
  documentType: 'report' | 'notes' | 'presentation' | 'spreadsheet' | 'code' | 'other';
  textContent: string;
  wordCount: number;
  
  // Timeline
  createdAt: Date;
  modifiedAt: Date;
  accessedAt: Date;
  
  // Context
  authorIds: string[];
  projectIds: string[];
  
  // Multi-modal
  structured: {
    tags: string[];
    version?: string;
  };
  unstructured: {
    summary?: string;
    keyPoints?: string[];
  };
  modelDerived: {
    completionStatus: number; // For drafts
    qualityScore: number;
    relevanceDecay: number; // How outdated
  };
  embeddings: {
    titleEmbedding: number[];
    contentEmbedding: number[];
    summaryEmbedding: number[];
  };
  
  provenance: SourceRecord[];
}
```

#### 3.1.7 Trade Entity

```typescript
interface TradeEntity {
  id: string;
  type: 'Trade';
  
  // Core trade data
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
  currency: string;
  
  // Execution
  executedAt: Date;
  exchange: string;
  orderId: string;
  
  // Position context
  positionId: string | null;
  portfolioId: string;
  
  // Strategy
  signalSource: string | null;
  thesis: string | null;
  
  // Multi-modal
  structured: {
    fees: number;
    slippage: number;
    orderType: 'market' | 'limit' | 'stop';
  };
  unstructured: {
    notes?: string;
    marketContext?: string;
  };
  modelDerived: {
    qualityScore: number;
    signalConfidence: number;
    expectedReturn: number;
  };
  
  provenance: SourceRecord[];
  createdAt: Date;
}
```

#### 3.1.8 Skill Entity

```typescript
interface SkillEntity {
  id: string;
  type: 'Skill';
  name: string;
  category: 'technical' | 'domain' | 'soft' | 'language';
  
  // Proficiency
  level: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  yearsExperience: number | null;
  
  // Evidence
  projectIds: string[]; // Projects using this skill
  documentIds: string[]; // Documents demonstrating skill
  
  // Multi-modal
  modelDerived: {
    demandScore: number; // Market demand
    growthTrajectory: 'declining' | 'stable' | 'growing';
    relatedSkills: string[];
  };
  embeddings: {
    skillEmbedding: number[];
  };
  
  provenance: SourceRecord[];
  createdAt: Date;
  updatedAt: Date;
}
```

### 3.2 Relationship Types

```typescript
// All relationships are directional with optional properties

interface OntologyRelationship {
  id: string;
  sourceId: string;
  sourceType: EntityType;
  targetId: string;
  targetType: EntityType;
  relationshipType: RelationshipType;
  
  // Temporal
  startDate: Date | null;
  endDate: Date | null;
  
  // Strength/confidence
  strength: number; // 0-1
  confidence: number; // 0-1
  
  // Properties (relationship-specific)
  properties: Record<string, unknown>;
  
  provenance: SourceRecord[];
  createdAt: Date;
  updatedAt: Date;
}

type RelationshipType =
  // Person relationships
  | 'works_at'           // Person → Organization
  | 'worked_at'          // Person → Organization (past)
  | 'reports_to'         // Person → Person
  | 'manages'            // Person → Person
  | 'colleague_of'       // Person ↔ Person
  | 'collaborates_with'  // Person ↔ Person
  | 'knows'              // Person ↔ Person
  | 'mentors'            // Person → Person
  
  // Project relationships
  | 'owns_project'       // Person → Project
  | 'contributes_to'     // Person → Project
  | 'project_for_org'    // Project → Organization
  | 'depends_on'         // Project → Project
  
  // Task relationships
  | 'assigned_to'        // Task → Person
  | 'created_by'         // Task → Person
  | 'belongs_to_project' // Task → Project
  | 'blocked_by'         // Task → Task
  
  // Event relationships
  | 'organized_by'       // Event → Person
  | 'attended_by'        // Event → Person
  | 'related_to_project' // Event → Project
  
  // Document relationships
  | 'authored_by'        // Document → Person
  | 'document_for'       // Document → Project
  | 'references'         // Document → Document
  
  // Skill relationships
  | 'has_skill'          // Person → Skill
  | 'learning'           // Person → Skill
  | 'requires_skill'     // Project → Skill
  
  // Trade relationships
  | 'executed_by'        // Trade → Person (always self)
  | 'in_portfolio'       // Trade → Portfolio
  | 'triggered_by'       // Trade → Signal
```

### 3.3 Ontology Storage

```typescript
// src/main/intelligence/ontology/ontology-store.ts

export interface OntologyStore {
  // Entity operations
  createEntity<T extends OntologyEntity>(entity: T): Promise<T>;
  getEntity<T extends OntologyEntity>(id: string, type: EntityType): Promise<T | null>;
  updateEntity<T extends OntologyEntity>(id: string, updates: Partial<T>): Promise<T>;
  deleteEntity(id: string, type: EntityType): Promise<void>;
  
  // Relationship operations
  createRelationship(rel: OntologyRelationship): Promise<OntologyRelationship>;
  getRelationships(entityId: string, direction: 'incoming' | 'outgoing' | 'both'): Promise<OntologyRelationship[]>;
  deleteRelationship(id: string): Promise<void>;
  
  // Query operations
  query(cypher: string, params?: Record<string, unknown>): Promise<QueryResult>;
  searchByEmbedding(embedding: number[], entityTypes: EntityType[], limit: number): Promise<SearchResult[]>;
  searchByText(text: string, entityTypes: EntityType[], limit: number): Promise<SearchResult[]>;
  
  // Temporal queries
  getEntityAtTime<T extends OntologyEntity>(id: string, type: EntityType, timestamp: Date): Promise<T | null>;
  getRelationshipsAtTime(entityId: string, timestamp: Date): Promise<OntologyRelationship[]>;
  
  // Bulk operations
  bulkCreateEntities(entities: OntologyEntity[]): Promise<void>;
  bulkCreateRelationships(relationships: OntologyRelationship[]): Promise<void>;
  
  // Maintenance
  rebuildIndices(): Promise<void>;
  computeStatistics(): Promise<OntologyStatistics>;
}

// Implementation options:
// 1. SQLite + better-sqlite3 (current, good for <1GB)
// 2. LanceDB (current, good for embeddings)
// 3. Neo4j embedded (best for complex graph queries)
// 4. DuckDB (good for analytics queries)
```

---

## 4. Layer 3: Kinetic Layer (Objects → Actions)

The Kinetic Layer contains specialized agents that take actions based on ontology data.

### 4.1 Agent Architecture

```typescript
// src/main/intelligence/agents/types.ts

export interface IntelligenceAgent {
  readonly name: string;
  readonly domain: AgentDomain;
  readonly capabilities: AgentCapability[];
  
  // Core operations
  initialize(): Promise<void>;
  processQuery(query: string, context: AgentContext): Promise<AgentResponse>;
  executeAction(action: AgentAction): Promise<ActionResult>;
  
  // Proactive features
  generateInsights(trigger: InsightTrigger): Promise<Insight[]>;
  getRecommendations(context: AgentContext): Promise<Recommendation[]>;
  
  // Learning
  provideFeedback(actionId: string, feedback: Feedback): Promise<void>;
}

type AgentDomain = 
  | 'trading'
  | 'project_management'
  | 'financial'
  | 'relationship'
  | 'research'
  | 'health'
  | 'career';

interface AgentContext {
  currentFocus: OntologyEntity | null;
  recentEntities: OntologyEntity[];
  userIntent: string;
  timeContext: TimeContext;
  emotionalContext: EmotionalContext | null;
}
```

### 4.2 Trading Agent

**Domain:** Autonomous and assisted trading operations

```typescript
// src/main/intelligence/agents/trading-agent.ts

export class TradingAgent implements IntelligenceAgent {
  readonly name = 'TradingAgent';
  readonly domain = 'trading' as const;
  readonly capabilities = [
    'portfolio_analysis',
    'trade_execution',
    'signal_aggregation',
    'backtesting',
    'risk_management',
    'market_research'
  ];
  
  // Query examples:
  // "What's my portfolio performance this month?"
  // "Should I exit my ETH position?"
  // "Run backtest on momentum strategy"
  // "What signals are active right now?"
  
  async processQuery(query: string, context: AgentContext): Promise<AgentResponse> {
    const intent = await this.classifyIntent(query);
    
    switch (intent.type) {
      case 'portfolio_status':
        return this.getPortfolioStatus();
      case 'position_analysis':
        return this.analyzePosition(intent.symbol);
      case 'trade_recommendation':
        return this.getTradeRecommendation(intent.symbol);
      case 'backtest_request':
        return this.runBacktest(intent.strategy, intent.params);
      case 'signal_query':
        return this.getActiveSignals();
      case 'risk_check':
        return this.assessRisk();
    }
  }
  
  async executeAction(action: AgentAction): Promise<ActionResult> {
    switch (action.type) {
      case 'open_position':
        return this.openPosition(action.params);
      case 'close_position':
        return this.closePosition(action.params);
      case 'set_stop_loss':
        return this.setStopLoss(action.params);
      case 'start_autonomous':
        return this.startAutonomousTrading(action.params);
    }
  }
  
  async generateInsights(trigger: InsightTrigger): Promise<Insight[]> {
    // Proactive insights:
    // - "Your ETH position is up 15%, consider taking profits"
    // - "Unusual volume detected in SOL"
    // - "Market regime shifted to bearish"
    // - "Daily loss limit approaching"
  }
}
```

### 4.3 Project Management Agent

**Domain:** Project tracking, task management, deadline monitoring

```typescript
export class ProjectManagementAgent implements IntelligenceAgent {
  readonly name = 'ProjectManagementAgent';
  readonly domain = 'project_management' as const;
  readonly capabilities = [
    'project_status',
    'task_management',
    'deadline_tracking',
    'resource_allocation',
    'risk_detection',
    'progress_reporting'
  ];
  
  // Query examples:
  // "What's the status of Project Alpha?"
  // "What tasks are overdue?"
  // "Who's blocked right now?"
  // "Show project timeline"
  
  async processQuery(query: string, context: AgentContext): Promise<AgentResponse> {
    const intent = await this.classifyIntent(query);
    
    switch (intent.type) {
      case 'project_status':
        return this.getProjectStatus(intent.projectId);
      case 'task_list':
        return this.getTaskList(intent.filters);
      case 'blockers':
        return this.getBlockers();
      case 'timeline':
        return this.getTimeline(intent.projectId);
      case 'workload':
        return this.getWorkloadAnalysis();
    }
  }
  
  async generateInsights(trigger: InsightTrigger): Promise<Insight[]> {
    // Proactive insights:
    // - "Project Alpha deadline in 3 days, 2 tasks incomplete"
    // - "You're overcommitted this week"
    // - "Task X has been in progress for 5 days"
  }
}
```

### 4.4 Financial Agent

**Domain:** Personal finance, budgeting, spending analysis

```typescript
export class FinancialAgent implements IntelligenceAgent {
  readonly name = 'FinancialAgent';
  readonly domain = 'financial' as const;
  readonly capabilities = [
    'spending_analysis',
    'budget_tracking',
    'anomaly_detection',
    'cashflow_forecast',
    'subscription_management',
    'tax_summary'
  ];
  
  // Query examples:
  // "How much did I spend this month?"
  // "What's my budget status?"
  // "Show unusual transactions"
  // "Predict my end-of-month balance"
  
  async processQuery(query: string, context: AgentContext): Promise<AgentResponse> {
    const intent = await this.classifyIntent(query);
    
    switch (intent.type) {
      case 'spending_summary':
        return this.getSpendingSummary(intent.period);
      case 'budget_status':
        return this.getBudgetStatus();
      case 'anomalies':
        return this.getAnomalies(intent.period);
      case 'forecast':
        return this.forecastBalance(intent.targetDate);
      case 'subscriptions':
        return this.getSubscriptionAnalysis();
    }
  }
  
  async generateInsights(trigger: InsightTrigger): Promise<Insight[]> {
    // Proactive insights:
    // - "Spending is 23% over budget this month"
    // - "Unusual £350 transaction detected"
    // - "New subscription detected: Netflix"
  }
}
```

### 4.5 Relationship Agent

**Domain:** Contact management, network analysis, relationship health

```typescript
export class RelationshipAgent implements IntelligenceAgent {
  readonly name = 'RelationshipAgent';
  readonly domain = 'relationship' as const;
  readonly capabilities = [
    'contact_lookup',
    'relationship_health',
    'network_analysis',
    'introduction_suggestions',
    'followup_reminders',
    'collaboration_patterns'
  ];
  
  // Query examples:
  // "Who do I know at Google?"
  // "When did I last talk to Sarah?"
  // "Who can introduce me to someone in AI?"
  // "Show my collaboration network"
  
  async processQuery(query: string, context: AgentContext): Promise<AgentResponse> {
    const intent = await this.classifyIntent(query);
    
    switch (intent.type) {
      case 'contact_search':
        return this.searchContacts(intent.query);
      case 'last_interaction':
        return this.getLastInteraction(intent.personId);
      case 'introduction_path':
        return this.findIntroductionPath(intent.targetPerson);
      case 'network_analysis':
        return this.analyzeNetwork(intent.filters);
      case 'neglected_contacts':
        return this.getNeglectedContacts();
    }
  }
  
  async generateInsights(trigger: InsightTrigger): Promise<Insight[]> {
    // Proactive insights:
    // - "You haven't contacted John in 3 months"
    // - "Sarah has expertise in the topic you're researching"
    // - "Meeting with new contact tomorrow - here's context"
  }
}
```

### 4.6 Research Agent

**Domain:** Information synthesis, knowledge management, learning

```typescript
export class ResearchAgent implements IntelligenceAgent {
  readonly name = 'ResearchAgent';
  readonly domain = 'research' as const;
  readonly capabilities = [
    'knowledge_search',
    'document_synthesis',
    'topic_research',
    'source_aggregation',
    'insight_extraction',
    'knowledge_gaps'
  ];
  
  // Query examples:
  // "What do I know about distributed systems?"
  // "Summarize my notes on Project Alpha"
  // "Find experts in my network for topic X"
  // "What are my knowledge gaps for goal Y?"
  
  async processQuery(query: string, context: AgentContext): Promise<AgentResponse> {
    const intent = await this.classifyIntent(query);
    
    switch (intent.type) {
      case 'knowledge_search':
        return this.searchKnowledge(intent.query);
      case 'document_summary':
        return this.summarizeDocuments(intent.documentIds);
      case 'topic_research':
        return this.researchTopic(intent.topic);
      case 'expert_finder':
        return this.findExperts(intent.topic);
      case 'knowledge_gaps':
        return this.identifyKnowledgeGaps(intent.goal);
    }
  }
}
```

---

## 5. Layer 4: Dynamic Layer (Actions → Learning)

The Dynamic Layer enables continuous improvement through feedback loops and learning.

### 5.1 Decision Logging

```typescript
// src/main/intelligence/dynamic/decision-logger.ts

export interface DecisionLog {
  id: string;
  timestamp: Date;
  
  // Context
  agentName: string;
  queryText: string;
  context: AgentContext;
  
  // Decision
  decisionType: string;
  chosenAction: AgentAction;
  alternativeActions: AgentAction[];
  reasoning: string;
  confidence: number;
  
  // Outcome (filled later)
  outcome: DecisionOutcome | null;
  userFeedback: UserFeedback | null;
  
  // Learning
  lessonsLearned: string[];
  modelUpdates: ModelUpdate[];
}

export class DecisionLogger {
  async logDecision(decision: DecisionLog): Promise<void>;
  async updateOutcome(decisionId: string, outcome: DecisionOutcome): Promise<void>;
  async recordFeedback(decisionId: string, feedback: UserFeedback): Promise<void>;
  
  // Analytics
  async getDecisionAccuracy(agentName: string, period: DateRange): Promise<AccuracyMetrics>;
  async getCommonFailures(agentName: string): Promise<FailurePattern[]>;
}
```

### 5.2 Outcome Tracking

```typescript
// src/main/intelligence/dynamic/outcome-tracker.ts

export interface OutcomeTracker {
  // Track outcomes of actions
  trackActionOutcome(actionId: string, result: ActionResult): Promise<void>;
  
  // Trading-specific
  trackTradeOutcome(tradeId: string, pnl: number, holdingPeriod: number): Promise<void>;
  
  // Project-specific
  trackProjectOutcome(projectId: string, completedOnTime: boolean, quality: number): Promise<void>;
  
  // General
  trackPredictionAccuracy(predictionId: string, actual: number, predicted: number): Promise<void>;
  
  // Analytics
  getOutcomeDistribution(actionType: string, period: DateRange): Promise<Distribution>;
  getWinRate(agentName: string, actionType: string): Promise<number>;
}
```

### 5.3 Model Retraining

```typescript
// src/main/intelligence/dynamic/model-retrainer.ts

export interface ModelRetrainer {
  // Schedule retraining
  scheduleRetraining(modelId: string, trigger: RetrainingTrigger): Promise<void>;
  
  // Manual retraining
  retrainModel(modelId: string, newData: TrainingData): Promise<RetrainingResult>;
  
  // Incremental updates
  updateModelIncremental(modelId: string, newSamples: Sample[]): Promise<void>;
  
  // Model management
  getModelPerformance(modelId: string): Promise<ModelPerformance>;
  rollbackModel(modelId: string, version: string): Promise<void>;
}

type RetrainingTrigger =
  | { type: 'scheduled'; interval: string } // e.g., 'weekly'
  | { type: 'performance_drop'; threshold: number }
  | { type: 'data_volume'; minNewSamples: number }
  | { type: 'manual' };
```

### 5.4 Feedback Integration

```typescript
// src/main/intelligence/dynamic/feedback-integrator.ts

export interface UserFeedback {
  id: string;
  timestamp: Date;
  
  // What feedback is about
  targetType: 'decision' | 'recommendation' | 'insight' | 'action';
  targetId: string;
  
  // Feedback content
  rating: 1 | 2 | 3 | 4 | 5; // 1=terrible, 5=excellent
  helpful: boolean;
  actionTaken: 'accepted' | 'rejected' | 'modified' | 'ignored';
  
  // Optional
  comment: string | null;
  correction: unknown | null; // What the right answer was
}

export class FeedbackIntegrator {
  async recordFeedback(feedback: UserFeedback): Promise<void>;
  
  // Learning from feedback
  async extractLessons(feedbackBatch: UserFeedback[]): Promise<Lesson[]>;
  async updateAgentBehavior(agentName: string, lessons: Lesson[]): Promise<void>;
  
  // Voice feedback
  async processVoiceFeedback(transcript: string, context: FeedbackContext): Promise<UserFeedback>;
}
```

### 5.5 Anomaly Detection

```typescript
// src/main/intelligence/dynamic/anomaly-detector.ts

export interface AnomalyDetector {
  // Register patterns to monitor
  registerPattern(pattern: AnomalyPattern): Promise<void>;
  
  // Check for anomalies
  checkAnomaly(entityType: EntityType, entityId: string, newValue: unknown): Promise<AnomalyResult>;
  
  // Batch checking
  runAnomalyDetection(scope: AnomalyScope): Promise<AnomalyReport>;
  
  // Alerting
  onAnomaly(callback: (anomaly: Anomaly) => void): void;
}

interface AnomalyPattern {
  id: string;
  name: string;
  entityType: EntityType;
  field: string;
  
  // Detection method
  method: 'zscore' | 'isolation_forest' | 'autoencoder' | 'rule_based';
  threshold: number;
  
  // Context
  baselineWindow: string; // e.g., '30d'
  minimumDataPoints: number;
}

// Examples:
// - Spending anomaly: Transaction amount > 3 standard deviations
// - Schedule anomaly: Unusually high meeting load
// - Trading anomaly: Position size outside normal range
// - Communication anomaly: Response time much slower than usual
```

---

## 6. Entity Resolution Engine

### 6.1 Overview

The Entity Resolution Engine automatically detects and links duplicate records across data sources, creating **Golden Records** (canonical, authoritative versions).

### 6.2 Architecture

```typescript
// src/main/intelligence/entity-resolution/types.ts

export interface EntityResolutionEngine {
  // Automatic discovery
  findDuplicates(entityType: EntityType): Promise<DuplicateCandidate[]>;
  
  // Matching
  calculateMatchScore(entity1: OntologyEntity, entity2: OntologyEntity): Promise<MatchScore>;
  
  // Merging
  createGoldenRecord(sourceRecords: SourceRecord[]): Promise<OntologyEntity>;
  mergeEntities(entityIds: string[]): Promise<OntologyEntity>;
  
  // User-guided
  suggestMerges(): Promise<MergeSuggestion[]>;
  confirmMerge(suggestionId: string): Promise<void>;
  rejectMerge(suggestionId: string, reason: string): Promise<void>;
  
  // Rules
  addMatchingRule(rule: MatchingRule): Promise<void>;
  getMatchingRules(): Promise<MatchingRule[]>;
}

interface MatchScore {
  overall: number; // 0-1
  components: {
    field: string;
    score: number;
    method: string;
  }[];
  confidence: 'low' | 'medium' | 'high';
  recommendation: 'merge' | 'review' | 'separate';
}

interface DuplicateCandidate {
  entity1Id: string;
  entity2Id: string;
  matchScore: MatchScore;
  sharedAttributes: string[];
  conflictingAttributes: string[];
}
```

### 6.3 Matching Methods

```typescript
// src/main/intelligence/entity-resolution/matchers.ts

// Deterministic matchers (exact matches)
export const deterministicMatchers = {
  exactEmail: (a: string, b: string) => a.toLowerCase() === b.toLowerCase(),
  exactPhone: (a: string, b: string) => normalizePhone(a) === normalizePhone(b),
  exactId: (a: string, b: string) => a === b,
};

// Probabilistic matchers (fuzzy matches)
export const probabilisticMatchers = {
  // Name matching
  nameMatch: (name1: string, name2: string): number => {
    const jaroWinkler = calculateJaroWinkler(name1, name2);
    const soundex = compareSoundex(name1, name2);
    const nicknames = checkNicknameMatch(name1, name2);
    return weightedAverage([jaroWinkler * 0.4, soundex * 0.3, nicknames * 0.3]);
  },
  
  // Email domain matching
  emailDomainMatch: (email1: string, email2: string): number => {
    const domain1 = email1.split('@')[1];
    const domain2 = email2.split('@')[1];
    return domain1 === domain2 ? 1.0 : 0.0;
  },
  
  // Organization matching
  orgMatch: (org1: string, org2: string): number => {
    const normalized1 = normalizeOrgName(org1);
    const normalized2 = normalizeOrgName(org2);
    return calculateJaroWinkler(normalized1, normalized2);
  },
  
  // Context proximity (same project, same meeting)
  contextProximity: async (id1: string, id2: string): Promise<number> => {
    const sharedProjects = await getSharedProjects(id1, id2);
    const sharedEvents = await getSharedEvents(id1, id2);
    return Math.min(1.0, (sharedProjects.length + sharedEvents.length) * 0.2);
  },
};
```

### 6.4 Golden Record Creation

```typescript
// src/main/intelligence/entity-resolution/golden-record.ts

export class GoldenRecordCreator {
  async createGoldenRecord(sources: SourceRecord[]): Promise<PersonEntity> {
    // 1. Determine canonical values for each field
    const canonicalName = this.selectCanonicalName(sources);
    const primaryEmail = this.selectPrimaryEmail(sources);
    const allEmails = this.aggregateEmails(sources);
    const allPhones = this.aggregatePhones(sources);
    
    // 2. Merge multi-modal properties
    const structured = this.mergeStructured(sources);
    const unstructured = this.mergeUnstructured(sources);
    
    // 3. Compute derived properties
    const modelDerived = await this.computeDerived(sources);
    
    // 4. Generate embeddings
    const embeddings = await this.generateEmbeddings(canonicalName, unstructured);
    
    // 5. Build golden record
    return {
      id: generateId(),
      type: 'Person',
      canonicalName,
      emails: allEmails,
      phones: allPhones,
      // ... rest of properties
      sourceRecords: sources,
      confidence: this.calculateOverallConfidence(sources),
    };
  }
  
  private selectCanonicalName(sources: SourceRecord[]): string {
    // Priority: Most complete name > Most frequent > Most recent
    const names = sources.map(s => s.name).filter(Boolean);
    const byCompleteness = names.sort((a, b) => b.split(' ').length - a.split(' ').length);
    return byCompleteness[0] || 'Unknown';
  }
  
  private selectPrimaryEmail(sources: SourceRecord[]): string {
    // Priority: Work email > Personal email > Most recent
    const emails = sources.flatMap(s => s.emails || []);
    const workEmail = emails.find(e => !e.includes('gmail') && !e.includes('hotmail'));
    return workEmail || emails[0] || '';
  }
}
```

### 6.5 Voice Commands for Entity Resolution

```
"Link J Smith to John Smith"
"Are John Smith and Jonathan Smith the same person?"
"Show duplicate contacts"
"Merge these two records"
"This is a different person, don't merge"
```

---

## 7. Knowledge Graph & Temporal Reasoning

### 7.1 Knowledge Graph Store

```typescript
// src/main/intelligence/knowledge-graph/graph-store.ts

export interface KnowledgeGraphStore {
  // Graph operations
  addNode(entity: OntologyEntity): Promise<void>;
  addEdge(relationship: OntologyRelationship): Promise<void>;
  removeNode(entityId: string): Promise<void>;
  removeEdge(relationshipId: string): Promise<void>;
  
  // Traversal
  getNeighbors(entityId: string, depth: number): Promise<GraphNeighborhood>;
  findPath(fromId: string, toId: string, maxHops: number): Promise<GraphPath[]>;
  
  // Pattern matching
  matchPattern(pattern: GraphPattern): Promise<PatternMatch[]>;
  
  // Analytics
  getNodeCentrality(entityId: string): Promise<CentralityMetrics>;
  getCommunities(): Promise<Community[]>;
  
  // Temporal
  getGraphAtTime(timestamp: Date): Promise<TemporalSnapshot>;
  getGraphChanges(from: Date, to: Date): Promise<GraphChange[]>;
}
```

### 7.2 Natural Language to Cypher

```typescript
// src/main/intelligence/knowledge-graph/nl-to-cypher.ts

export class NLToCypherTranslator {
  private llm: LLMClient;
  private schema: OntologySchema;
  
  async translate(naturalLanguage: string): Promise<CypherQuery> {
    const prompt = `
      Given the following ontology schema:
      ${JSON.stringify(this.schema, null, 2)}
      
      Translate this natural language query to Cypher:
      "${naturalLanguage}"
      
      Return only the Cypher query, no explanation.
    `;
    
    const cypher = await this.llm.generate(prompt);
    const validated = await this.validateCypher(cypher);
    
    return { cypher: validated, originalQuery: naturalLanguage };
  }
  
  // Example translations:
  // "Who do I know at Google?" →
  // MATCH (me:Person {id: 'self'})-[:knows|colleague_of*1..2]-(p:Person)-[:works_at]->(o:Organization {name: 'Google'})
  // RETURN p
  
  // "What projects did I work on with Sarah?" →
  // MATCH (me:Person {id: 'self'})-[:contributes_to]->(proj:Project)<-[:contributes_to]-(sarah:Person {name: 'Sarah'})
  // RETURN proj
  
  // "Show my collaboration network" →
  // MATCH (me:Person {id: 'self'})-[r:collaborates_with|colleague_of]-(p:Person)
  // RETURN me, r, p
}
```

### 7.3 Timeline Reconstruction

```typescript
// src/main/intelligence/temporal/timeline-engine.ts

export interface TimelineEngine {
  // Create timeline for a topic/entity
  reconstructTimeline(query: TimelineQuery): Promise<Timeline>;
  
  // Causal inference
  inferCausality(events: TemporalEvent[]): Promise<CausalChain[]>;
  
  // Narrative generation
  generateNarrative(timeline: Timeline): Promise<string>;
}

interface TimelineQuery {
  topic: string;
  entityIds?: string[];
  startDate?: Date;
  endDate?: Date;
  maxEvents?: number;
}

interface Timeline {
  id: string;
  query: TimelineQuery;
  events: TimelineEvent[];
  causalChains: CausalChain[];
  narrative: string;
  confidence: number;
}

interface TimelineEvent {
  timestamp: Date;
  entityId: string;
  entityType: EntityType;
  eventType: string;
  description: string;
  source: SourceRecord;
  
  // Relationships
  causedBy: string[]; // Event IDs
  ledTo: string[]; // Event IDs
}

// Example output:
// Query: "What led to Project Alpha's delay?"
// Timeline:
// 1. [Jan 10] Project Alpha started (calendar: kickoff meeting)
// 2. [Jan 12] Dependency on external API identified (email: Sarah flagged)
// 3. [Jan 14] External API documentation missing (document: meeting notes)
// 4. [Jan 15] Escalation meeting scheduled (calendar: urgent meeting)
// 5. [Jan 17] API provider confirmed 1-week delay (email: vendor response)
// 6. [Jan 18] Project timeline revised to Feb 5 (document: revised plan)
// 
// Causal Chain: [2] → [3] → [4] → [5] → [6]
// Narrative: "Project Alpha was delayed due to missing documentation from the external API provider, 
//             which was identified on Jan 12 and confirmed on Jan 17, resulting in a 1-week slip."
```

### 7.4 Voice Commands for Knowledge Graph

```
"Who do I know at [company]?"
"Show my network for [topic]"
"What's the connection between [person1] and [person2]?"
"How did [person] get involved in [project]?"
"What led to [event/decision]?"
"Show timeline for [project/topic]"
"Who introduced me to [person]?"
```

---

## 8. Common Operating Picture (COP)

### 8.1 Overview

The Common Operating Picture provides a **real-time unified view** of all operational data, enabling situational awareness and proactive decision-making.

### 8.2 COP Architecture

```typescript
// src/main/intelligence/cop/types.ts

export interface CommonOperatingPicture {
  // Real-time state
  getCurrentState(): Promise<COPState>;
  
  // Subscriptions
  subscribe(section: COPSection, callback: (update: COPUpdate) => void): Unsubscribe;
  
  // Alerts
  getActiveAlerts(): Promise<COPAlert[]>;
  acknowledgeAlert(alertId: string): Promise<void>;
  
  // Focus
  setFocusArea(area: FocusArea): Promise<void>;
  getFocusRecommendation(): Promise<FocusArea>;
}

interface COPState {
  timestamp: Date;
  
  sections: {
    focus: FocusSection;
    health: HealthSection;
    work: WorkSection;
    finance: FinanceSection;
    relationships: RelationshipSection;
    trading: TradingSection;
  };
  
  alerts: COPAlert[];
  recommendations: COPRecommendation[];
}

interface FocusSection {
  topPriorities: FocusItem[]; // Top 3 things to focus on
  blockers: BlockerItem[];
  upcomingDeadlines: DeadlineItem[];
  timeAllocation: TimeAllocation; // How time is being spent
}

interface HealthSection {
  sleepHours: number;
  sleepQuality: number;
  exerciseMinutes: number;
  stressLevel: number;
  recommendations: string[];
}

interface WorkSection {
  activeProjects: ProjectSummary[];
  overdueItems: TaskSummary[];
  todaysMeetings: EventSummary[];
  focusTimeAvailable: number;
}

interface FinanceSection {
  currentBalance: number;
  monthlySpending: number;
  budgetStatus: BudgetStatus;
  anomalies: TransactionAnomaly[];
}

interface RelationshipSection {
  recentInteractions: InteractionSummary[];
  neglectedContacts: PersonSummary[];
  upcomingBirthdays: PersonSummary[];
}

interface TradingSection {
  portfolioValue: number;
  dailyPnL: number;
  openPositions: PositionSummary[];
  activeSignals: SignalSummary[];
  marketRegime: MarketRegime;
}
```

### 8.3 COP UI Component

```typescript
// src/renderer/components/COP/CommonOperatingPicture.tsx

export const CommonOperatingPicture: React.FC = () => {
  const [copState, setCopState] = useState<COPState | null>(null);
  
  useEffect(() => {
    const unsubscribe = window.atlas.cop.subscribe('all', setCopState);
    return unsubscribe;
  }, []);
  
  return (
    <div className="cop-container">
      <header className="cop-header">
        <h1>Atlas Operating Picture</h1>
        <span className="timestamp">{copState?.timestamp.toLocaleString()}</span>
      </header>
      
      <section className="cop-alerts">
        {copState?.alerts.map(alert => (
          <AlertCard key={alert.id} alert={alert} />
        ))}
      </section>
      
      <div className="cop-grid">
        <FocusPanel data={copState?.sections.focus} />
        <WorkPanel data={copState?.sections.work} />
        <FinancePanel data={copState?.sections.finance} />
        <TradingPanel data={copState?.sections.trading} />
        <RelationshipsPanel data={copState?.sections.relationships} />
        <HealthPanel data={copState?.sections.health} />
      </div>
      
      <section className="cop-recommendations">
        {copState?.recommendations.map(rec => (
          <RecommendationCard key={rec.id} recommendation={rec} />
        ))}
      </section>
    </div>
  );
};
```

### 8.4 Voice Commands for COP

```
"What should I focus on right now?"
"Show my operating picture"
"What's urgent today?"
"Any alerts I should know about?"
"How am I doing on my goals?"
"Show my workload this week"
```

---

## 9. Playbook Engine

### 9.1 Overview

Playbooks are **configurable, automated workflows** that trigger based on conditions and execute sequences of actions with optional human approval.

### 9.2 Playbook Structure

```typescript
// src/main/intelligence/playbooks/types.ts

export interface Playbook {
  id: string;
  name: string;
  description: string;
  domain: AgentDomain;
  
  // Trigger conditions
  trigger: PlaybookTrigger;
  
  // Workflow steps
  steps: PlaybookStep[];
  
  // Human-in-the-loop
  requiresApproval: boolean;
  approvalPrompt?: string;
  
  // Feedback
  feedbackEnabled: boolean;
  
  // Metadata
  createdAt: Date;
  updatedAt: Date;
  runCount: number;
  successRate: number;
}

interface PlaybookTrigger {
  type: 'event' | 'schedule' | 'condition' | 'manual';
  
  // Event-based
  eventType?: string;
  eventFilter?: Record<string, unknown>;
  
  // Schedule-based
  schedule?: string; // cron expression
  
  // Condition-based
  condition?: {
    entityType: EntityType;
    field: string;
    operator: 'gt' | 'lt' | 'eq' | 'contains' | 'changed';
    value: unknown;
  };
}

interface PlaybookStep {
  id: string;
  name: string;
  type: 'action' | 'decision' | 'llm_analysis' | 'notification' | 'wait';
  
  // Action step
  action?: {
    agentName: string;
    actionType: string;
    params: Record<string, unknown>;
  };
  
  // Decision step (branching)
  decision?: {
    condition: string;
    ifTrue: string; // Next step ID
    ifFalse: string; // Next step ID
  };
  
  // LLM analysis step
  llmAnalysis?: {
    prompt: string;
    outputVariable: string;
  };
  
  // Notification step
  notification?: {
    type: 'voice' | 'toast' | 'email';
    message: string;
  };
  
  // Wait step
  wait?: {
    duration: number;
    unit: 'seconds' | 'minutes' | 'hours';
  };
  
  // Next step
  nextStepId: string | null;
}
```

### 9.3 Built-in Playbooks

#### 9.3.1 Budget Anomaly Playbook

```yaml
name: Budget Anomaly Response
trigger:
  type: condition
  condition:
    entityType: Transaction
    field: amount
    operator: gt
    value: 500  # Or 3x average for category

steps:
  - id: analyze
    name: Analyze Transaction
    type: llm_analysis
    llmAnalysis:
      prompt: |
        Analyze this unusual transaction:
        Amount: {{transaction.amount}}
        Merchant: {{transaction.merchantName}}
        Category: {{transaction.category}}
        User's average for this category: {{categoryAverage}}
        
        Provide:
        1. Is this likely legitimate or suspicious?
        2. Possible explanation
        3. Recommended action
      outputVariable: analysis
    nextStepId: decision

  - id: decision
    name: Determine Severity
    type: decision
    decision:
      condition: "{{analysis.suspiciousScore}} > 0.7"
      ifTrue: alert_urgent
      ifFalse: alert_info

  - id: alert_urgent
    name: Urgent Alert
    type: notification
    notification:
      type: voice
      message: "Heads up - I detected an unusual transaction of £{{transaction.amount}} at {{transaction.merchantName}}. {{analysis.explanation}}. Want me to flag this for review?"
    nextStepId: null

  - id: alert_info
    name: Info Alert
    type: notification
    notification:
      type: toast
      message: "Large transaction: £{{transaction.amount}} at {{transaction.merchantName}}"
    nextStepId: null
```

#### 9.3.2 Project Risk Playbook

```yaml
name: Project Risk Mitigation
trigger:
  type: condition
  condition:
    entityType: Project
    field: health
    operator: changed
    value: 'red'

steps:
  - id: analyze_risk
    name: Analyze Project Risk
    type: llm_analysis
    llmAnalysis:
      prompt: |
        Project {{project.name}} health has changed to RED.
        
        Current status:
        - Progress: {{project.progress}}%
        - Deadline: {{project.targetEndDate}}
        - Overdue tasks: {{project.overdueTasks}}
        - Blockers: {{project.blockers}}
        
        Analyze:
        1. Root cause of risk
        2. Impact assessment
        3. Top 3 mitigation actions
      outputVariable: riskAnalysis
    nextStepId: notify_user

  - id: notify_user
    name: Alert User
    type: notification
    notification:
      type: voice
      message: "Project {{project.name}} is now at risk. {{riskAnalysis.summary}}. The top recommended action is: {{riskAnalysis.topAction}}. Want me to help with mitigation?"
    nextStepId: null
```

#### 9.3.3 Meeting Prep Playbook

```yaml
name: Meeting Preparation
trigger:
  type: schedule
  schedule: "*/15 * * * *"  # Every 15 minutes
  condition:
    # Check if meeting starts in next 30 minutes
    expression: "nextMeeting.startTime - now < 30m AND !prepCompleted"

steps:
  - id: gather_context
    name: Gather Meeting Context
    type: action
    action:
      agentName: ResearchAgent
      actionType: gather_meeting_context
      params:
        eventId: "{{nextMeeting.id}}"
    nextStepId: analyze

  - id: analyze
    name: Generate Prep Summary
    type: llm_analysis
    llmAnalysis:
      prompt: |
        Meeting: {{nextMeeting.title}}
        Attendees: {{nextMeeting.attendees}}
        Time: {{nextMeeting.startTime}}
        
        Context:
        - Recent emails with attendees: {{context.recentEmails}}
        - Shared projects: {{context.sharedProjects}}
        - Last meeting notes: {{context.lastMeetingNotes}}
        
        Generate a brief prep summary:
        1. Key topics likely to be discussed
        2. Action items from last meeting
        3. Things to prepare or bring up
      outputVariable: prepSummary
    nextStepId: notify

  - id: notify
    name: Send Prep Reminder
    type: notification
    notification:
      type: voice
      message: "You have a meeting with {{nextMeeting.attendees[0]}} in 30 minutes. {{prepSummary.keyPoint}}. Would you like the full context?"
    nextStepId: null
```

### 9.4 Voice Commands for Playbooks

```
"Run the meeting prep playbook"
"Create a playbook for [scenario]"
"What playbooks triggered today?"
"Disable the budget alert playbook"
"Show playbook history"
```

---

## 10. Security & Privacy

### 10.1 Encryption Architecture

```typescript
// src/main/intelligence/security/encryption.ts

export interface EncryptionService {
  // Key management
  initializeMasterKey(password: string): Promise<void>;
  changeMasterKey(oldPassword: string, newPassword: string): Promise<void>;
  
  // Encryption
  encrypt(data: Buffer, classification: DataClassification): Promise<EncryptedData>;
  decrypt(encrypted: EncryptedData): Promise<Buffer>;
  
  // Field-level encryption
  encryptField(value: string, fieldType: SensitiveFieldType): Promise<string>;
  decryptField(encrypted: string, fieldType: SensitiveFieldType): Promise<string>;
}

type DataClassification = 'public' | 'internal' | 'confidential' | 'restricted';

type SensitiveFieldType = 
  | 'email'
  | 'phone'
  | 'financial_amount'
  | 'account_number'
  | 'api_key'
  | 'password';
```

### 10.2 Audit Logging

```typescript
// src/main/intelligence/security/audit-log.ts

export interface AuditLog {
  id: string;
  timestamp: Date;
  
  // Actor
  actorType: 'user' | 'agent' | 'system';
  actorId: string;
  
  // Action
  action: AuditAction;
  entityType: EntityType;
  entityId: string;
  
  // Context
  reason: string;
  queryText?: string;
  
  // Result
  success: boolean;
  errorMessage?: string;
  
  // Data accessed (for compliance)
  fieldsAccessed: string[];
  sensitiveDataAccessed: boolean;
}

type AuditAction =
  | 'create'
  | 'read'
  | 'update'
  | 'delete'
  | 'query'
  | 'export'
  | 'share'
  | 'agent_decision'
  | 'llm_inference';
```

### 10.3 Privacy Controls

```typescript
// src/main/intelligence/security/privacy-controls.ts

export interface PrivacyControls {
  // Data minimization
  setDataRetentionPolicy(entityType: EntityType, days: number): Promise<void>;
  purgeOldData(): Promise<PurgeReport>;
  
  // Consent management
  getDataSources(): Promise<DataSourceConsent[]>;
  revokeConsent(sourceId: string): Promise<void>;
  
  // Data subject rights (GDPR)
  exportAllData(): Promise<DataExport>;
  deleteAllData(): Promise<void>;
  
  // Cloud data control
  setCloudSharingPolicy(policy: CloudSharingPolicy): Promise<void>;
  getCloudDataLog(): Promise<CloudDataLog[]>;
}

interface CloudSharingPolicy {
  allowLLMInference: boolean;
  allowSTT: boolean;
  allowTTS: boolean;
  
  // Data sanitization
  redactPII: boolean;
  redactFinancial: boolean;
  anonymizeNames: boolean;
  
  // Retention
  cloudRetentionHours: number;
}
```

### 10.4 Voice Commands for Security

```
"Show my privacy settings"
"What data have you shared with the cloud?"
"Delete all my financial data"
"Export my data"
"Who accessed my calendar data this week?"
```

---

## 11. Technical Specifications

### 11.1 File Structure

```
src/main/intelligence/
├── index.ts                           # Main exports
├── types.ts                           # Shared types
│
├── semantic/                          # Layer 1: Semantic Layer
│   ├── types.ts
│   ├── semantic-layer-manager.ts
│   ├── parsers/
│   │   ├── email-parser.ts
│   │   ├── calendar-extractor.ts
│   │   ├── file-indexer.ts
│   │   ├── contact-resolver.ts
│   │   └── transaction-analyzer.ts
│   └── connectors/
│       ├── gmail-connector.ts
│       ├── google-calendar-connector.ts
│       ├── local-files-connector.ts
│       └── open-banking-connector.ts
│
├── ontology/                          # Layer 2: Unified Ontology
│   ├── types.ts
│   ├── schema.ts
│   ├── ontology-store.ts
│   ├── entity-manager.ts
│   ├── relationship-manager.ts
│   └── embedding-service.ts
│
├── agents/                            # Layer 3: Kinetic Layer
│   ├── types.ts
│   ├── agent-manager.ts
│   ├── trading-agent.ts
│   ├── project-management-agent.ts
│   ├── financial-agent.ts
│   ├── relationship-agent.ts
│   └── research-agent.ts
│
├── dynamic/                           # Layer 4: Dynamic Layer
│   ├── types.ts
│   ├── decision-logger.ts
│   ├── outcome-tracker.ts
│   ├── model-retrainer.ts
│   ├── feedback-integrator.ts
│   └── anomaly-detector.ts
│
├── entity-resolution/                 # Entity Resolution Engine
│   ├── types.ts
│   ├── resolution-engine.ts
│   ├── matchers/
│   │   ├── deterministic-matcher.ts
│   │   └── probabilistic-matcher.ts
│   ├── golden-record-creator.ts
│   └── merge-suggester.ts
│
├── knowledge-graph/                   # Knowledge Graph
│   ├── types.ts
│   ├── graph-store.ts
│   ├── nl-to-cypher.ts
│   ├── path-finder.ts
│   └── community-detector.ts
│
├── temporal/                          # Temporal Reasoning
│   ├── types.ts
│   ├── timeline-engine.ts
│   ├── causal-inference.ts
│   └── narrative-generator.ts
│
├── cop/                               # Common Operating Picture
│   ├── types.ts
│   ├── cop-manager.ts
│   ├── data-aggregator.ts
│   ├── alert-engine.ts
│   └── recommendation-engine.ts
│
├── playbooks/                         # Playbook Engine
│   ├── types.ts
│   ├── playbook-engine.ts
│   ├── trigger-evaluator.ts
│   ├── step-executor.ts
│   └── builtin/
│       ├── budget-anomaly.yaml
│       ├── project-risk.yaml
│       ├── meeting-prep.yaml
│       └── trading-alert.yaml
│
├── security/                          # Security & Privacy
│   ├── encryption-service.ts
│   ├── audit-logger.ts
│   ├── privacy-controls.ts
│   └── access-control.ts
│
└── ipc/                               # IPC Handlers
    ├── semantic-handlers.ts
    ├── ontology-handlers.ts
    ├── agent-handlers.ts
    ├── cop-handlers.ts
    └── playbook-handlers.ts
```

### 11.2 Database Schema

```sql
-- Core entities (SQLite with JSON columns)

CREATE TABLE entities (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  data JSON NOT NULL,
  embedding BLOB,  -- Vector embedding
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  confidence REAL DEFAULT 1.0
);

CREATE INDEX idx_entities_type ON entities(type);
CREATE INDEX idx_entities_updated ON entities(updated_at);

-- Relationships
CREATE TABLE relationships (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  relationship_type TEXT NOT NULL,
  properties JSON,
  start_date INTEGER,
  end_date INTEGER,
  strength REAL DEFAULT 1.0,
  confidence REAL DEFAULT 1.0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  
  FOREIGN KEY (source_id) REFERENCES entities(id),
  FOREIGN KEY (target_id) REFERENCES entities(id)
);

CREATE INDEX idx_rel_source ON relationships(source_id);
CREATE INDEX idx_rel_target ON relationships(target_id);
CREATE INDEX idx_rel_type ON relationships(relationship_type);

-- Source records (provenance)
CREATE TABLE source_records (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  raw_data JSON,
  created_at INTEGER NOT NULL,
  
  FOREIGN KEY (entity_id) REFERENCES entities(id)
);

-- Audit log
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  timestamp INTEGER NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  reason TEXT,
  query_text TEXT,
  success INTEGER NOT NULL,
  error_message TEXT,
  fields_accessed JSON,
  sensitive_data_accessed INTEGER DEFAULT 0
);

CREATE INDEX idx_audit_timestamp ON audit_log(timestamp);
CREATE INDEX idx_audit_entity ON audit_log(entity_id);

-- Decision log
CREATE TABLE decision_log (
  id TEXT PRIMARY KEY,
  timestamp INTEGER NOT NULL,
  agent_name TEXT NOT NULL,
  query_text TEXT,
  context JSON,
  decision_type TEXT NOT NULL,
  chosen_action JSON NOT NULL,
  alternative_actions JSON,
  reasoning TEXT,
  confidence REAL,
  outcome JSON,
  user_feedback JSON,
  lessons_learned JSON
);

CREATE INDEX idx_decision_agent ON decision_log(agent_name);
CREATE INDEX idx_decision_timestamp ON decision_log(timestamp);

-- Playbook runs
CREATE TABLE playbook_runs (
  id TEXT PRIMARY KEY,
  playbook_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  status TEXT NOT NULL,
  trigger_data JSON,
  step_results JSON,
  final_outcome JSON,
  user_feedback JSON
);

CREATE INDEX idx_playbook_runs_playbook ON playbook_runs(playbook_id);
CREATE INDEX idx_playbook_runs_status ON playbook_runs(status);
```

### 11.3 Performance Targets

| Operation | Target Latency | Notes |
|-----------|---------------|-------|
| Entity lookup by ID | < 5ms | Cached |
| Full-text search | < 50ms | Indexed |
| Semantic search | < 200ms | Vector similarity |
| Knowledge graph query (2 hops) | < 100ms | Optimized Cypher |
| Knowledge graph query (5 hops) | < 500ms | Complex traversal |
| Timeline reconstruction | < 2s | LLM-assisted |
| COP full refresh | < 500ms | Parallel aggregation |
| Playbook trigger evaluation | < 10ms | Real-time |
| Entity resolution (batch) | < 5s/1000 records | Background |

### 11.4 Memory Budget

| Component | Max Memory | Notes |
|-----------|------------|-------|
| Ontology cache | 256 MB | Hot entities |
| Embedding index | 512 MB | HNSW index |
| Knowledge graph cache | 128 MB | Recent traversals |
| COP state | 64 MB | Real-time state |
| Agent context | 128 MB | Per active agent |
| Total intelligence layer | < 1.5 GB | With all features active |

---

## 12. Implementation Roadmap

### Phase 1: Foundation (Weeks 1-4)

**Goal:** Establish core ontology and data ingestion

| Week | Deliverables |
|------|--------------|
| 1 | Ontology types, schema definition, SQLite store |
| 2 | Email parser, calendar extractor |
| 3 | Entity resolution engine (deterministic) |
| 4 | Basic knowledge graph queries |

**Exit Criteria:**
- [ ] Can ingest emails and calendar from Google/Microsoft
- [ ] Entities created with proper typing
- [ ] Basic deduplication working
- [ ] Simple graph queries functional
- [ ] `npm run typecheck` passes

### Phase 2: Intelligence Layer (Weeks 5-8)

**Goal:** Add knowledge graph, temporal reasoning, and COP

| Week | Deliverables |
|------|--------------|
| 5 | Full knowledge graph with NL-to-Cypher |
| 6 | Timeline reconstruction engine |
| 7 | Common Operating Picture v1 |
| 8 | Integration testing, voice commands |

**Exit Criteria:**
- [ ] Multi-hop graph queries working
- [ ] Timeline narratives generated
- [ ] COP dashboard showing real data
- [ ] Voice commands for all features

### Phase 3: Agents & Playbooks (Weeks 9-12)

**Goal:** Specialized agents and automated workflows

| Week | Deliverables |
|------|--------------|
| 9 | Agent framework, Trading Agent |
| 10 | Project Management Agent, Financial Agent |
| 11 | Playbook engine, 3 built-in playbooks |
| 12 | Feedback loop, decision logging |

**Exit Criteria:**
- [ ] All 5 agents operational
- [ ] Playbooks triggering correctly
- [ ] Feedback improving recommendations
- [ ] End-to-end voice workflows

### Phase 4: Polish & Scale (Weeks 13-16)

**Goal:** Performance, security, and production readiness

| Week | Deliverables |
|------|--------------|
| 13 | Performance optimization |
| 14 | Security hardening, audit logging |
| 15 | Mobile integration, offline sync |
| 16 | Documentation, testing, release |

**Exit Criteria:**
- [ ] All latency targets met
- [ ] Encryption and audit logging complete
- [ ] Offline mode working
- [ ] Documentation complete

---

## 13. Success Metrics

### 13.1 Adoption Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Data sources connected | 3+ per user | Count connected sources |
| Entities in ontology | 10,000+ | Database count |
| Daily active voice queries | 20+ | Query log count |
| Playbook executions/week | 50+ | Playbook run count |

### 13.2 Quality Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Entity resolution accuracy | > 95% | Manual audit sample |
| Agent recommendation accuracy | > 80% | User feedback |
| Timeline reconstruction accuracy | > 85% | User corrections |
| Query relevance | > 90% | User ratings |

### 13.3 Performance Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Query latency P50 | < 100ms | APM tracking |
| Query latency P99 | < 500ms | APM tracking |
| COP refresh time | < 500ms | Performance monitoring |
| Memory usage | < 1.5GB | Resource monitoring |

### 13.4 Business Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Time saved/week | 5+ hours | User survey |
| Decisions improved | 10+ recommendations/week followed | Feedback tracking |
| Trading performance improvement | +10% Sharpe | Backtest comparison |
| User satisfaction (NPS) | > 50 | Quarterly survey |

---

## Appendix A: Voice Command Reference

### Data & Ontology
- "Show my contacts at [company]"
- "Who is [person]?"
- "Link [record1] to [record2]"
- "Show duplicate records"
- "What do I know about [topic]?"

### Knowledge Graph
- "Who do I know that knows about [topic]?"
- "What's the connection between [A] and [B]?"
- "Show my network for [project/topic]"
- "Who introduced me to [person]?"

### Timeline & History
- "What led to [event/decision]?"
- "Show timeline for [project]"
- "When did I start working on [project]?"
- "What happened with [topic] last month?"

### COP & Focus
- "What should I focus on?"
- "Show my operating picture"
- "What's urgent today?"
- "Any alerts?"
- "How am I doing on my goals?"

### Agents
- "How's my portfolio?"
- "What's the status of Project Alpha?"
- "How much did I spend this month?"
- "When did I last talk to Sarah?"
- "Find research on [topic]"

### Playbooks
- "Run meeting prep"
- "What playbooks ran today?"
- "Create a playbook for [scenario]"

### Privacy & Security
- "Show privacy settings"
- "What data was shared with cloud?"
- "Export my data"
- "Delete [data type]"

---

## Appendix B: Glossary

| Term | Definition |
|------|------------|
| **Ontology** | Formal representation of knowledge as entities, relationships, and properties |
| **Golden Record** | Canonical, authoritative version of an entity after deduplication |
| **Entity Resolution** | Process of identifying duplicate records across data sources |
| **Knowledge Graph** | Network of entities connected by typed relationships |
| **COP (Common Operating Picture)** | Real-time unified view of operational data |
| **Playbook** | Automated workflow triggered by conditions |
| **Semantic Layer** | Data parsing and transformation layer |
| **Kinetic Layer** | Agent execution and action layer |
| **Dynamic Layer** | Learning and feedback layer |
| **Multi-modal Properties** | Properties from structured, unstructured, and model-derived sources |

---

**Document Version:** 1.0  
**Last Updated:** January 22, 2026  
**Status:** Draft - Pending Review  
**Next Review:** February 1, 2026
