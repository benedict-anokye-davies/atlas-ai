/**
 * Atlas Intelligence Platform - Core Types
 * Palantir-style personal intelligence system
 */

// ============================================================================
// ENUMS & CONSTANTS
// ============================================================================

export type EntityType =
  | 'Person'
  | 'Project'
  | 'Task'
  | 'Event'
  | 'Organization'
  | 'Document'
  | 'Trade'
  | 'Skill';

export type RelationshipType =
  // Person relationships
  | 'works_at'
  | 'worked_at'
  | 'reports_to'
  | 'manages'
  | 'colleague_of'
  | 'collaborates_with'
  | 'knows'
  | 'mentors'
  // Project relationships
  | 'owns_project'
  | 'contributes_to'
  | 'project_for_org'
  | 'depends_on'
  // Task relationships
  | 'assigned_to'
  | 'created_by'
  | 'belongs_to_project'
  | 'blocked_by'
  // Event relationships
  | 'organized_by'
  | 'attended_by'
  | 'related_to_project'
  // Document relationships
  | 'authored_by'
  | 'document_for'
  | 'references'
  // Skill relationships
  | 'has_skill'
  | 'learning'
  | 'requires_skill'
  // Trade relationships
  | 'executed_by'
  | 'in_portfolio'
  | 'triggered_by';

export type DataSourceType =
  | 'gmail'
  | 'outlook'
  | 'google_calendar'
  | 'outlook_calendar'
  | 'local_files'
  | 'google_drive'
  | 'dropbox'
  | 'onedrive'
  | 'obsidian'
  | 'google_contacts'
  | 'open_banking'
  | 'trading_platform'
  | 'manual';

export type DataClassification = 'public' | 'internal' | 'confidential' | 'restricted';

export type SensitiveFieldType =
  | 'email'
  | 'phone'
  | 'financial_amount'
  | 'account_number'
  | 'api_key'
  | 'password';

// ============================================================================
// BASE INTERFACES
// ============================================================================

export interface SourceRecord {
  id: string;
  sourceType: DataSourceType;
  sourceId: string;
  rawData: Record<string, unknown>;
  extractedAt: Date;
  confidence: number;
}

export interface LocationReference {
  name: string;
  address?: string;
  coordinates?: { lat: number; lng: number };
  type: 'physical' | 'virtual';
}

export interface EmbeddingSet {
  [key: string]: number[];
}

export interface TimeContext {
  now: Date;
  timezone: string;
  dayOfWeek: string;
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
  isWorkHours: boolean;
}

export interface EmotionalContext {
  primary: string;
  intensity: number;
  confidence: number;
}

// ============================================================================
// ENTITY INTERFACES
// ============================================================================

export interface BaseEntity {
  id: string;
  type: EntityType;
  sourceRecords: SourceRecord[];
  createdAt: Date;
  updatedAt: Date;
  confidence: number;
}

export interface PersonEntity extends BaseEntity {
  type: 'Person';
  canonicalName: string;
  emails: EmailIdentifier[];
  phones: PhoneIdentifier[];
  socialProfiles: SocialProfile[];
  currentOrganization: string | null;
  currentRole: string | null;
  location: LocationReference | null;
  relationshipType: 'self' | 'colleague' | 'client' | 'friend' | 'family' | 'acquaintance';
  relationshipStrength: number;
  structured: {
    birthDate?: Date;
    timezone?: string;
    preferredLanguage?: string;
  };
  unstructured: {
    bio?: string;
    notes?: string;
    recentContext?: string;
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
}

export interface ProjectEntity extends BaseEntity {
  type: 'Project';
  name: string;
  description: string;
  status: 'planning' | 'active' | 'on_hold' | 'completed' | 'cancelled';
  progress: number;
  health: 'green' | 'yellow' | 'red';
  startDate: Date | null;
  targetEndDate: Date | null;
  actualEndDate: Date | null;
  ownerIds: string[];
  contributorIds: string[];
  taskIds: string[];
  documentIds: string[];
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
    completionForecast: Date | null;
    riskScore: number;
    velocityTrend: 'increasing' | 'stable' | 'decreasing';
  };
  embeddings: {
    descriptionEmbedding: number[];
  };
}

export interface TaskEntity extends BaseEntity {
  type: 'Task';
  title: string;
  description: string;
  status: 'todo' | 'in_progress' | 'blocked' | 'done' | 'cancelled';
  priority: 'low' | 'medium' | 'high' | 'critical';
  dueDate: Date | null;
  completedAt: Date | null;
  estimatedHours: number | null;
  actualHours: number | null;
  projectId: string | null;
  assigneeId: string | null;
  createdById: string;
  blockedByIds: string[];
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
}

export interface EventEntity extends BaseEntity {
  type: 'Event';
  title: string;
  description: string;
  startTime: Date;
  endTime: Date;
  isAllDay: boolean;
  timezone: string;
  location: LocationReference | null;
  isVirtual: boolean;
  meetingLink: string | null;
  organizerId: string;
  attendeeIds: string[];
  projectIds: string[];
  meetingType: 'one_on_one' | 'team' | 'external' | 'personal' | 'focus_time';
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
}

export interface OrganizationEntity extends BaseEntity {
  type: 'Organization';
  name: string;
  industry: string | null;
  size: 'startup' | 'small' | 'medium' | 'large' | 'enterprise' | null;
  website: string | null;
  relationshipType: 'employer' | 'client' | 'vendor' | 'partner' | 'prospect' | 'other';
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
}

export interface DocumentEntity extends BaseEntity {
  type: 'Document';
  title: string;
  sourcePath: string;
  sourceType: 'local' | 'google_drive' | 'dropbox' | 'onedrive' | 'obsidian';
  documentType: 'report' | 'notes' | 'presentation' | 'spreadsheet' | 'code' | 'other';
  textContent: string;
  wordCount: number;
  modifiedAt: Date;
  accessedAt: Date;
  authorIds: string[];
  projectIds: string[];
  structured: {
    tags: string[];
    version?: string;
  };
  unstructured: {
    summary?: string;
    keyPoints?: string[];
  };
  modelDerived: {
    completionStatus: number;
    qualityScore: number;
    relevanceDecay: number;
  };
  embeddings: {
    titleEmbedding: number[];
    contentEmbedding: number[];
    summaryEmbedding: number[];
  };
}

export interface TradeEntity extends BaseEntity {
  type: 'Trade';
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
  currency: string;
  executedAt: Date;
  exchange: string;
  orderId: string;
  positionId: string | null;
  portfolioId: string;
  signalSource: string | null;
  thesis: string | null;
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
  embeddings: {
    thesisEmbedding?: number[];
  };
}

export interface SkillEntity extends BaseEntity {
  type: 'Skill';
  name: string;
  category: 'technical' | 'domain' | 'soft' | 'language';
  level: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  yearsExperience: number | null;
  projectIds: string[];
  documentIds: string[];
  modelDerived: {
    demandScore: number;
    growthTrajectory: 'declining' | 'stable' | 'growing';
    relatedSkills: string[];
  };
  embeddings: {
    skillEmbedding: number[];
  };
}

export type OntologyEntity =
  | PersonEntity
  | ProjectEntity
  | TaskEntity
  | EventEntity
  | OrganizationEntity
  | DocumentEntity
  | TradeEntity
  | SkillEntity;

// ============================================================================
// RELATIONSHIP INTERFACE
// ============================================================================

export interface OntologyRelationship {
  id: string;
  sourceId: string;
  sourceType: EntityType;
  targetId: string;
  targetType: EntityType;
  relationshipType: RelationshipType;
  startDate: Date | null;
  endDate: Date | null;
  strength: number;
  confidence: number;
  properties: Record<string, unknown>;
  sourceRecords: SourceRecord[];
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// SUPPORTING TYPES
// ============================================================================

export interface EmailIdentifier {
  email: string;
  type: 'work' | 'personal' | 'other';
  isPrimary: boolean;
  verified: boolean;
}

export interface PhoneIdentifier {
  phone: string;
  type: 'mobile' | 'work' | 'home' | 'other';
  isPrimary: boolean;
}

export interface SocialProfile {
  platform: 'linkedin' | 'twitter' | 'github' | 'other';
  url: string;
  username: string;
}

export interface RecurrenceRule {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
  daysOfWeek?: number[];
  dayOfMonth?: number;
  endDate?: Date;
  count?: number;
}

// ============================================================================
// SEMANTIC LAYER TYPES
// ============================================================================

export interface PersonReference {
  name: string;
  email?: string;
  entityId?: string;
}

export interface ProjectReference {
  name: string;
  entityId?: string;
}

export interface DateReference {
  text: string;
  resolved: Date | null;
  isRelative: boolean;
}

export interface MoneyReference {
  amount: number;
  currency: string;
  text: string;
}

export interface Topic {
  name: string;
  confidence: number;
}

export interface ActionItem {
  text: string;
  assignee?: PersonReference;
  dueDate?: DateReference;
  priority?: 'low' | 'medium' | 'high';
}

export interface Sentiment {
  score: number;
  label: 'positive' | 'negative' | 'neutral';
  confidence: number;
}

export type UrgencyLevel = 'low' | 'medium' | 'high' | 'critical';

export type EmailIntent = 'request' | 'inform' | 'question' | 'followup' | 'other';

export type MeetingType = 'one_on_one' | 'team' | 'external' | 'personal' | 'focus_time';

export type FileType = 
  | 'text'
  | 'document'
  | 'spreadsheet'
  | 'presentation'
  | 'code'
  | 'image'
  | 'other';

export type TransactionCategory =
  | 'income'
  | 'housing'
  | 'utilities'
  | 'groceries'
  | 'dining'
  | 'transport'
  | 'entertainment'
  | 'shopping'
  | 'health'
  | 'subscriptions'
  | 'transfers'
  | 'other';

export type RecurringFrequency = 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'yearly';

// ============================================================================
// AGENT TYPES
// ============================================================================

export type AgentDomain =
  | 'trading'
  | 'project_management'
  | 'financial'
  | 'relationship'
  | 'research'
  | 'health'
  | 'career';

export type AgentCapability =
  // Trading
  | 'portfolio_analysis'
  | 'trade_execution'
  | 'signal_aggregation'
  | 'backtesting'
  | 'risk_management'
  | 'market_research'
  // Project management
  | 'project_status'
  | 'task_management'
  | 'deadline_tracking'
  | 'resource_allocation'
  | 'risk_detection'
  | 'progress_reporting'
  // Financial
  | 'spending_analysis'
  | 'budget_tracking'
  | 'anomaly_detection'
  | 'cashflow_forecast'
  | 'subscription_management'
  | 'tax_summary'
  // Relationship
  | 'contact_lookup'
  | 'relationship_health'
  | 'network_analysis'
  | 'introduction_suggestions'
  | 'followup_reminders'
  | 'collaboration_patterns'
  // Research
  | 'knowledge_search'
  | 'document_synthesis'
  | 'topic_research'
  | 'source_aggregation'
  | 'insight_extraction'
  | 'knowledge_gaps';

export interface AgentContext {
  currentFocus: OntologyEntity | null;
  recentEntities: OntologyEntity[];
  userIntent: string;
  timeContext: TimeContext;
  emotionalContext: EmotionalContext | null;
}

export interface AgentResponse {
  success: boolean;
  responseType: 'data' | 'action' | 'clarification' | 'error';
  data?: unknown;
  message: string;
  voiceResponse?: string;
  suggestedActions?: AgentAction[];
  confidence: number;
}

export interface AgentAction {
  id: string;
  type: string;
  params: Record<string, unknown>;
  requiresApproval: boolean;
  description: string;
}

export interface ActionResult {
  success: boolean;
  actionId: string;
  result?: unknown;
  error?: string;
  duration: number;
}

export interface Insight {
  id: string;
  type: string;
  title: string;
  description: string;
  severity: 'info' | 'warning' | 'critical';
  entityIds: string[];
  suggestedAction?: AgentAction;
  generatedAt: Date;
  expiresAt?: Date;
}

export interface Recommendation {
  id: string;
  type: string;
  title: string;
  description: string;
  priority: number;
  action: AgentAction;
  reasoning: string;
  confidence: number;
}

export interface InsightTrigger {
  type: 'scheduled' | 'event' | 'threshold' | 'manual';
  source: string;
  data?: Record<string, unknown>;
}

export interface Feedback {
  rating: 1 | 2 | 3 | 4 | 5;
  helpful: boolean;
  actionTaken: 'accepted' | 'rejected' | 'modified' | 'ignored';
  comment?: string;
  correction?: unknown;
}

// ============================================================================
// DYNAMIC LAYER TYPES
// ============================================================================

export interface DecisionLog {
  id: string;
  timestamp: Date;
  agentName: string;
  queryText: string;
  context: AgentContext;
  decisionType: string;
  chosenAction: AgentAction;
  alternativeActions: AgentAction[];
  reasoning: string;
  confidence: number;
  outcome: DecisionOutcome | null;
  userFeedback: UserFeedback | null;
  lessonsLearned: string[];
}

export interface DecisionOutcome {
  success: boolean;
  result?: unknown;
  error?: string;
  duration: number;
  timestamp: Date;
}

export interface UserFeedback {
  id: string;
  timestamp: Date;
  targetType: 'decision' | 'recommendation' | 'insight' | 'action';
  targetId: string;
  rating: 1 | 2 | 3 | 4 | 5;
  helpful: boolean;
  actionTaken: 'accepted' | 'rejected' | 'modified' | 'ignored';
  comment: string | null;
  correction: unknown | null;
}

export interface AnomalyPattern {
  id: string;
  name: string;
  entityType: EntityType;
  field: string;
  method: 'zscore' | 'isolation_forest' | 'autoencoder' | 'rule_based';
  threshold: number;
  baselineWindow: string;
  minimumDataPoints: number;
}

export interface Anomaly {
  id: string;
  patternId: string;
  entityType: EntityType;
  entityId: string;
  field: string;
  observedValue: unknown;
  expectedValue: unknown;
  deviationScore: number;
  detectedAt: Date;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

// ============================================================================
// COP TYPES
// ============================================================================

export interface COPState {
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

export interface FocusSection {
  topPriorities: FocusItem[];
  blockers: BlockerItem[];
  upcomingDeadlines: DeadlineItem[];
  timeAllocation: TimeAllocation;
}

export interface FocusItem {
  id: string;
  title: string;
  type: EntityType;
  entityId: string;
  urgency: number;
  importance: number;
  reason: string;
}

export interface BlockerItem {
  id: string;
  title: string;
  taskId: string;
  blockedSince: Date;
  impact: string;
}

export interface DeadlineItem {
  id: string;
  title: string;
  entityType: EntityType;
  entityId: string;
  deadline: Date;
  daysRemaining: number;
  progress: number;
}

export interface TimeAllocation {
  meetings: number;
  focusWork: number;
  administrative: number;
  personal: number;
  unallocated: number;
}

export interface HealthSection {
  sleepHours: number | null;
  sleepQuality: number | null;
  exerciseMinutes: number | null;
  stressLevel: number | null;
  recommendations: string[];
}

export interface WorkSection {
  activeProjects: ProjectSummary[];
  overdueItems: TaskSummary[];
  todaysMeetings: EventSummary[];
  focusTimeAvailable: number;
}

export interface ProjectSummary {
  id: string;
  name: string;
  status: string;
  health: string;
  progress: number;
}

export interface TaskSummary {
  id: string;
  title: string;
  dueDate: Date | null;
  priority: string;
  projectName?: string;
}

export interface EventSummary {
  id: string;
  title: string;
  startTime: Date;
  endTime: Date;
  attendeeCount: number;
}

export interface FinanceSection {
  currentBalance: number | null;
  monthlySpending: number | null;
  budgetStatus: BudgetStatus | null;
  anomalies: TransactionAnomaly[];
}

export interface BudgetStatus {
  totalBudget: number;
  spent: number;
  remaining: number;
  percentUsed: number;
  daysRemaining: number;
  projectedOverrun: number | null;
}

export interface TransactionAnomaly {
  id: string;
  amount: number;
  merchant: string;
  date: Date;
  reason: string;
}

export interface RelationshipSection {
  recentInteractions: InteractionSummary[];
  neglectedContacts: PersonSummary[];
  upcomingBirthdays: PersonSummary[];
}

export interface InteractionSummary {
  personId: string;
  personName: string;
  type: 'email' | 'meeting' | 'call';
  date: Date;
  summary: string;
}

export interface PersonSummary {
  id: string;
  name: string;
  organization?: string;
  lastInteraction?: Date;
  daysSinceContact?: number;
}

export interface TradingSection {
  portfolioValue: number | null;
  dailyPnL: number | null;
  openPositions: PositionSummary[];
  activeSignals: SignalSummary[];
  marketRegime: MarketRegime | null;
}

export interface PositionSummary {
  symbol: string;
  side: 'long' | 'short';
  size: number;
  entryPrice: number;
  currentPrice: number;
  pnl: number;
  pnlPercent: number;
}

export interface SignalSummary {
  id: string;
  symbol: string;
  direction: 'buy' | 'sell';
  strength: number;
  source: string;
}

export interface MarketRegime {
  type: 'bull' | 'bear' | 'neutral' | 'volatile';
  confidence: number;
  since: Date;
}

export interface COPAlert {
  id: string;
  type: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  entityType?: EntityType;
  entityId?: string;
  timestamp: Date;
  acknowledged: boolean;
  actions?: COPAlertAction[];
}

export interface COPAlertAction {
  id: string;
  label: string;
  action: AgentAction;
}

export interface COPRecommendation {
  id: string;
  type: string;
  title: string;
  description: string;
  priority: number;
  action: AgentAction;
  reasoning: string;
}

// ============================================================================
// PLAYBOOK TYPES
// ============================================================================

export interface Playbook {
  id: string;
  name: string;
  description: string;
  domain: AgentDomain;
  trigger: PlaybookTrigger;
  steps: PlaybookStep[];
  requiresApproval: boolean;
  approvalPrompt?: string;
  feedbackEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  runCount: number;
  successRate: number;
  enabled: boolean;
}

export interface PlaybookTrigger {
  type: 'event' | 'schedule' | 'condition' | 'manual';
  eventType?: string;
  eventFilter?: Record<string, unknown>;
  schedule?: string;
  condition?: {
    entityType: EntityType;
    field: string;
    operator: 'gt' | 'lt' | 'eq' | 'contains' | 'changed';
    value: unknown;
  };
}

export interface PlaybookStep {
  id: string;
  name: string;
  type: 'action' | 'decision' | 'llm_analysis' | 'notification' | 'wait';
  action?: {
    agentName: string;
    actionType: string;
    params: Record<string, unknown>;
  };
  decision?: {
    condition: string;
    ifTrue: string;
    ifFalse: string;
  };
  llmAnalysis?: {
    prompt: string;
    outputVariable: string;
  };
  notification?: {
    type: 'voice' | 'toast' | 'email';
    message: string;
  };
  wait?: {
    duration: number;
    unit: 'seconds' | 'minutes' | 'hours';
  };
  nextStepId: string | null;
}

export interface PlaybookRun {
  id: string;
  playbookId: string;
  startedAt: Date;
  completedAt: Date | null;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  triggerData: Record<string, unknown>;
  stepResults: PlaybookStepResult[];
  finalOutcome: unknown;
  userFeedback: UserFeedback | null;
}

export interface PlaybookStepResult {
  stepId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  startedAt: Date | null;
  completedAt: Date | null;
  result: unknown;
  error?: string;
}

// ============================================================================
// ENTITY RESOLUTION TYPES
// ============================================================================

export interface MatchScore {
  overall: number;
  components: MatchComponent[];
  confidence: 'low' | 'medium' | 'high';
  recommendation: 'merge' | 'review' | 'separate';
}

export interface MatchComponent {
  field: string;
  score: number;
  method: string;
}

export interface DuplicateCandidate {
  entity1Id: string;
  entity2Id: string;
  matchScore: MatchScore;
  sharedAttributes: string[];
  conflictingAttributes: string[];
}

export interface MergeSuggestion {
  id: string;
  entityType: EntityType;
  entities: string[];
  matchScore: MatchScore;
  suggestedGoldenRecord: Partial<OntologyEntity>;
  createdAt: Date;
  status: 'pending' | 'accepted' | 'rejected';
}

// ============================================================================
// KNOWLEDGE GRAPH TYPES
// ============================================================================

export interface GraphNeighborhood {
  centerEntity: OntologyEntity;
  nodes: OntologyEntity[];
  edges: OntologyRelationship[];
  depth: number;
}

export interface GraphPath {
  nodes: OntologyEntity[];
  edges: OntologyRelationship[];
  length: number;
  totalWeight: number;
}

export interface GraphPattern {
  nodes: PatternNode[];
  edges: PatternEdge[];
}

export interface PatternNode {
  variable: string;
  type?: EntityType;
  properties?: Record<string, unknown>;
}

export interface PatternEdge {
  sourceVariable: string;
  targetVariable: string;
  relationshipType?: RelationshipType;
  properties?: Record<string, unknown>;
}

export interface PatternMatch {
  bindings: Record<string, OntologyEntity>;
  edges: OntologyRelationship[];
  confidence: number;
}

export interface CentralityMetrics {
  degree: number;
  betweenness: number;
  closeness: number;
  pageRank: number;
}

export interface Community {
  id: string;
  name: string;
  memberIds: string[];
  cohesion: number;
  topics: string[];
}

// ============================================================================
// TEMPORAL TYPES
// ============================================================================

export interface Timeline {
  id: string;
  query: TimelineQuery;
  events: TimelineEvent[];
  causalChains: CausalChain[];
  narrative: string;
  confidence: number;
}

export interface TimelineQuery {
  topic: string;
  entityIds?: string[];
  startDate?: Date;
  endDate?: Date;
  maxEvents?: number;
}

export interface TimelineEvent {
  id: string;
  timestamp: Date;
  entityId: string;
  entityType: EntityType;
  eventType: string;
  description: string;
  source: SourceRecord;
  causedBy: string[];
  ledTo: string[];
}

export interface CausalChain {
  id: string;
  events: string[];
  confidence: number;
  explanation: string;
}

// ============================================================================
// SECURITY TYPES
// ============================================================================

export interface EncryptedData {
  data: Buffer;
  iv: Buffer;
  authTag: Buffer;
  classification: DataClassification;
  encryptedAt: Date;
}

export interface AuditLog {
  id: string;
  timestamp: Date;
  actorType: 'user' | 'agent' | 'system';
  actorId: string;
  action: AuditAction;
  entityType?: EntityType;
  entityId?: string;
  reason: string;
  queryText?: string;
  success: boolean;
  errorMessage?: string;
  fieldsAccessed: string[];
  sensitiveDataAccessed: boolean;
}

export type AuditAction =
  | 'create'
  | 'read'
  | 'update'
  | 'delete'
  | 'query'
  | 'export'
  | 'share'
  | 'agent_decision'
  | 'llm_inference';

export interface CloudSharingPolicy {
  allowLLMInference: boolean;
  allowSTT: boolean;
  allowTTS: boolean;
  redactPII: boolean;
  redactFinancial: boolean;
  anonymizeNames: boolean;
  cloudRetentionHours: number;
}

// ============================================================================
// QUERY & RESULT TYPES
// ============================================================================

export interface QueryResult {
  rows: Record<string, unknown>[];
  columns: string[];
  rowCount: number;
  executionTime: number;
}

export interface SearchResult {
  entity: OntologyEntity;
  score: number;
  highlights: string[];
}

export interface IngestResult {
  source: DataSourceType;
  entitiesCreated: number;
  entitiesUpdated: number;
  relationshipsCreated: number;
  errors: string[];
  duration: number;
}

export interface SyncReport {
  startedAt: Date;
  completedAt: Date;
  sources: IngestResult[];
  totalEntities: number;
  totalRelationships: number;
  success: boolean;
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

export type Unsubscribe = () => void;

export interface DateRange {
  start: Date;
  end: Date;
}

export interface PaginationOptions {
  offset: number;
  limit: number;
}

export interface SortOptions {
  field: string;
  direction: 'asc' | 'desc';
}
