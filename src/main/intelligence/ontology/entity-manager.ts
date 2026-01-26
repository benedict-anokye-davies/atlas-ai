/**
 * Entity Manager - High-level entity operations with validation and events
 */

import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';
import { OntologyStore, getOntologyStore } from './ontology-store';
import {
  OntologyEntity,
  PersonEntity,
  ProjectEntity,
  TaskEntity,
  EventEntity,
  OrganizationEntity,
  DocumentEntity,
  TradeEntity,
  SkillEntity,
  EntityType,
  SourceRecord,
} from '../types';

const logger = createModuleLogger('EntityManager');

// ============================================================================
// ENTITY CREATION HELPERS
// ============================================================================

export function createPersonEntity(data: Partial<PersonEntity> & { canonicalName: string }): PersonEntity {
  const now = new Date();
  return {
    id: data.id || uuidv4(),
    type: 'Person',
    canonicalName: data.canonicalName,
    emails: data.emails || [],
    phones: data.phones || [],
    socialProfiles: data.socialProfiles || [],
    currentOrganization: data.currentOrganization || null,
    currentRole: data.currentRole || null,
    location: data.location || null,
    relationshipType: data.relationshipType || 'acquaintance',
    relationshipStrength: data.relationshipStrength ?? 0.5,
    structured: data.structured || {},
    unstructured: data.unstructured || {},
    modelDerived: data.modelDerived || {
      influenceScore: 0,
      responsiveness: 0,
      expertiseAreas: [],
      sentimentTowardsUser: 0,
    },
    embeddings: data.embeddings || {
      profileEmbedding: [],
      interactionEmbedding: [],
    },
    sourceRecords: data.sourceRecords || [],
    createdAt: data.createdAt || now,
    updatedAt: data.updatedAt || now,
    confidence: data.confidence ?? 1.0,
  };
}

export function createProjectEntity(data: Partial<ProjectEntity> & { name: string }): ProjectEntity {
  const now = new Date();
  return {
    id: data.id || uuidv4(),
    type: 'Project',
    name: data.name,
    description: data.description || '',
    status: data.status || 'planning',
    progress: data.progress ?? 0,
    health: data.health || 'green',
    startDate: data.startDate || null,
    targetEndDate: data.targetEndDate || null,
    actualEndDate: data.actualEndDate || null,
    ownerIds: data.ownerIds || [],
    contributorIds: data.contributorIds || [],
    taskIds: data.taskIds || [],
    documentIds: data.documentIds || [],
    structured: data.structured || { priority: 'medium', tags: [] },
    unstructured: data.unstructured || {},
    modelDerived: data.modelDerived || {
      completionForecast: null,
      riskScore: 0,
      velocityTrend: 'stable',
    },
    embeddings: data.embeddings || { descriptionEmbedding: [] },
    sourceRecords: data.sourceRecords || [],
    createdAt: data.createdAt || now,
    updatedAt: data.updatedAt || now,
    confidence: data.confidence ?? 1.0,
  };
}

export function createTaskEntity(
  data: Partial<TaskEntity> & { title: string; createdById: string }
): TaskEntity {
  const now = new Date();
  return {
    id: data.id || uuidv4(),
    type: 'Task',
    title: data.title,
    description: data.description || '',
    status: data.status || 'todo',
    priority: data.priority || 'medium',
    dueDate: data.dueDate || null,
    completedAt: data.completedAt || null,
    estimatedHours: data.estimatedHours || null,
    actualHours: data.actualHours || null,
    projectId: data.projectId || null,
    assigneeId: data.assigneeId || null,
    createdById: data.createdById,
    blockedByIds: data.blockedByIds || [],
    structured: data.structured || { tags: [] },
    unstructured: data.unstructured || {},
    modelDerived: data.modelDerived || {
      urgencyScore: 0,
      effortEstimate: 0,
      completionProbability: 0,
    },
    embeddings: data.embeddings || { titleEmbedding: [], descriptionEmbedding: [] },
    sourceRecords: data.sourceRecords || [],
    createdAt: data.createdAt || now,
    updatedAt: data.updatedAt || now,
    confidence: data.confidence ?? 1.0,
  };
}

export function createEventEntity(
  data: Partial<EventEntity> & {
    title: string;
    startTime: Date;
    endTime: Date;
    organizerId: string;
  }
): EventEntity {
  const now = new Date();
  return {
    id: data.id || uuidv4(),
    type: 'Event',
    title: data.title,
    description: data.description || '',
    startTime: data.startTime,
    endTime: data.endTime,
    isAllDay: data.isAllDay ?? false,
    timezone: data.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    location: data.location || null,
    isVirtual: data.isVirtual ?? false,
    meetingLink: data.meetingLink || null,
    organizerId: data.organizerId,
    attendeeIds: data.attendeeIds || [],
    projectIds: data.projectIds || [],
    meetingType: data.meetingType || 'team',
    structured: data.structured || { status: 'confirmed' },
    unstructured: data.unstructured || {},
    modelDerived: data.modelDerived || {
      importanceScore: 0,
      prepRequired: false,
      followupNeeded: false,
    },
    embeddings: data.embeddings || { titleEmbedding: [], descriptionEmbedding: [] },
    sourceRecords: data.sourceRecords || [],
    createdAt: data.createdAt || now,
    updatedAt: data.updatedAt || now,
    confidence: data.confidence ?? 1.0,
  };
}

export function createOrganizationEntity(
  data: Partial<OrganizationEntity> & { name: string }
): OrganizationEntity {
  const now = new Date();
  return {
    id: data.id || uuidv4(),
    type: 'Organization',
    name: data.name,
    industry: data.industry || null,
    size: data.size || null,
    website: data.website || null,
    relationshipType: data.relationshipType || 'other',
    structured: data.structured || {},
    unstructured: data.unstructured || {},
    modelDerived: data.modelDerived || {
      importanceScore: 0,
      interactionFrequency: 0,
    },
    embeddings: data.embeddings || { descriptionEmbedding: [] },
    sourceRecords: data.sourceRecords || [],
    createdAt: data.createdAt || now,
    updatedAt: data.updatedAt || now,
    confidence: data.confidence ?? 1.0,
  };
}

export function createDocumentEntity(
  data: Partial<DocumentEntity> & { title: string; sourcePath: string }
): DocumentEntity {
  const now = new Date();
  return {
    id: data.id || uuidv4(),
    type: 'Document',
    title: data.title,
    sourcePath: data.sourcePath,
    sourceType: data.sourceType || 'local',
    documentType: data.documentType || 'other',
    textContent: data.textContent || '',
    wordCount: data.wordCount ?? 0,
    modifiedAt: data.modifiedAt || now,
    accessedAt: data.accessedAt || now,
    authorIds: data.authorIds || [],
    projectIds: data.projectIds || [],
    structured: data.structured || { tags: [] },
    unstructured: data.unstructured || {},
    modelDerived: data.modelDerived || {
      completionStatus: 100,
      qualityScore: 0,
      relevanceDecay: 0,
    },
    embeddings: data.embeddings || {
      titleEmbedding: [],
      contentEmbedding: [],
      summaryEmbedding: [],
    },
    sourceRecords: data.sourceRecords || [],
    createdAt: data.createdAt || now,
    updatedAt: data.updatedAt || now,
    confidence: data.confidence ?? 1.0,
  };
}

export function createTradeEntity(
  data: Partial<TradeEntity> & {
    symbol: string;
    side: 'buy' | 'sell';
    quantity: number;
    price: number;
    portfolioId: string;
  }
): TradeEntity {
  const now = new Date();
  return {
    id: data.id || uuidv4(),
    type: 'Trade',
    symbol: data.symbol,
    side: data.side,
    quantity: data.quantity,
    price: data.price,
    currency: data.currency || 'GBP',
    executedAt: data.executedAt || now,
    exchange: data.exchange || 'unknown',
    orderId: data.orderId || uuidv4(),
    positionId: data.positionId || null,
    portfolioId: data.portfolioId,
    signalSource: data.signalSource || null,
    thesis: data.thesis || null,
    structured: data.structured || { fees: 0, slippage: 0, orderType: 'market' },
    unstructured: data.unstructured || {},
    modelDerived: data.modelDerived || {
      qualityScore: 0,
      signalConfidence: 0,
      expectedReturn: 0,
    },
    embeddings: data.embeddings || {},
    sourceRecords: data.sourceRecords || [],
    createdAt: data.createdAt || now,
    updatedAt: data.updatedAt || now,
    confidence: data.confidence ?? 1.0,
  };
}

export function createSkillEntity(data: Partial<SkillEntity> & { name: string }): SkillEntity {
  const now = new Date();
  return {
    id: data.id || uuidv4(),
    type: 'Skill',
    name: data.name,
    category: data.category || 'technical',
    level: data.level || 'beginner',
    yearsExperience: data.yearsExperience || null,
    projectIds: data.projectIds || [],
    documentIds: data.documentIds || [],
    modelDerived: data.modelDerived || {
      demandScore: 0,
      growthTrajectory: 'stable',
      relatedSkills: [],
    },
    embeddings: data.embeddings || { skillEmbedding: [] },
    sourceRecords: data.sourceRecords || [],
    createdAt: data.createdAt || now,
    updatedAt: data.updatedAt || now,
    confidence: data.confidence ?? 1.0,
  };
}

// ============================================================================
// ENTITY MANAGER CLASS
// ============================================================================

export class EntityManager extends EventEmitter {
  private store: OntologyStore;

  constructor(store?: OntologyStore) {
    super();
    this.store = store || getOntologyStore();
  }

  // --------------------------------------------------------------------------
  // GENERIC CRUD
  // --------------------------------------------------------------------------

  async create<T extends OntologyEntity>(entity: T): Promise<T> {
    logger.debug('Creating entity', { id: entity.id, type: entity.type });
    const created = await this.store.createEntity(entity);
    this.emit('created', created);
    return created;
  }

  async get<T extends OntologyEntity>(id: string): Promise<T | null> {
    return this.store.getEntity<T>(id);
  }

  async update<T extends OntologyEntity>(id: string, updates: Partial<T>): Promise<T | null> {
    logger.debug('Updating entity', { id });
    const updated = await this.store.updateEntity<T>(id, updates);
    if (updated) {
      this.emit('updated', updated);
    }
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    logger.debug('Deleting entity', { id });
    const deleted = await this.store.deleteEntity(id);
    if (deleted) {
      this.emit('deleted', { id });
    }
    return deleted;
  }

  async bulkCreate(entities: OntologyEntity[]): Promise<number> {
    logger.info('Bulk creating entities', { count: entities.length });
    return this.store.bulkCreateEntities(entities);
  }

  // --------------------------------------------------------------------------
  // TYPE-SPECIFIC QUERIES
  // --------------------------------------------------------------------------

  async getPeople(filter?: { organization?: string; relationship?: string }): Promise<PersonEntity[]> {
    let entities = await this.store.getEntities<PersonEntity>({ type: 'Person' });

    if (filter?.organization) {
      entities = entities.filter(e => e.currentOrganization === filter.organization);
    }
    if (filter?.relationship) {
      entities = entities.filter(e => e.relationshipType === filter.relationship);
    }

    return entities;
  }

  async getProjects(filter?: { status?: string; health?: string }): Promise<ProjectEntity[]> {
    let entities = await this.store.getEntities<ProjectEntity>({ type: 'Project' });

    if (filter?.status) {
      entities = entities.filter(e => e.status === filter.status);
    }
    if (filter?.health) {
      entities = entities.filter(e => e.health === filter.health);
    }

    return entities;
  }

  async getTasks(filter?: {
    status?: string;
    projectId?: string;
    assigneeId?: string;
  }): Promise<TaskEntity[]> {
    let entities = await this.store.getEntities<TaskEntity>({ type: 'Task' });

    if (filter?.status) {
      entities = entities.filter(e => e.status === filter.status);
    }
    if (filter?.projectId) {
      entities = entities.filter(e => e.projectId === filter.projectId);
    }
    if (filter?.assigneeId) {
      entities = entities.filter(e => e.assigneeId === filter.assigneeId);
    }

    return entities;
  }

  async getEvents(filter?: { afterDate?: Date; beforeDate?: Date }): Promise<EventEntity[]> {
    let entities = await this.store.getEntities<EventEntity>({ type: 'Event' });

    if (filter?.afterDate) {
      entities = entities.filter(e => e.startTime >= filter.afterDate!);
    }
    if (filter?.beforeDate) {
      entities = entities.filter(e => e.startTime <= filter.beforeDate!);
    }

    return entities;
  }

  async getOrganizations(): Promise<OrganizationEntity[]> {
    return this.store.getEntities<OrganizationEntity>({ type: 'Organization' });
  }

  async getDocuments(filter?: { projectId?: string; authorId?: string }): Promise<DocumentEntity[]> {
    let entities = await this.store.getEntities<DocumentEntity>({ type: 'Document' });

    if (filter?.projectId) {
      entities = entities.filter(e => e.projectIds.includes(filter.projectId!));
    }
    if (filter?.authorId) {
      entities = entities.filter(e => e.authorIds.includes(filter.authorId!));
    }

    return entities;
  }

  async getTrades(filter?: { portfolioId?: string; symbol?: string }): Promise<TradeEntity[]> {
    let entities = await this.store.getEntities<TradeEntity>({ type: 'Trade' });

    if (filter?.portfolioId) {
      entities = entities.filter(e => e.portfolioId === filter.portfolioId);
    }
    if (filter?.symbol) {
      entities = entities.filter(e => e.symbol === filter.symbol);
    }

    return entities;
  }

  async getSkills(filter?: { category?: string }): Promise<SkillEntity[]> {
    let entities = await this.store.getEntities<SkillEntity>({ type: 'Skill' });

    if (filter?.category) {
      entities = entities.filter(e => e.category === filter.category);
    }

    return entities;
  }

  // --------------------------------------------------------------------------
  // SEARCH
  // --------------------------------------------------------------------------

  async search(query: string, entityTypes?: EntityType[], limit = 20): Promise<OntologyEntity[]> {
    const results = await this.store.searchByText(query, entityTypes, limit);
    return results.map(r => r.entity);
  }

  // --------------------------------------------------------------------------
  // CONVENIENCE METHODS
  // --------------------------------------------------------------------------

  async getPersonByEmail(email: string): Promise<PersonEntity | null> {
    const people = await this.getPeople();
    return people.find(p => p.emails.some(e => e.email.toLowerCase() === email.toLowerCase())) || null;
  }

  async getProjectByName(name: string): Promise<ProjectEntity | null> {
    const projects = await this.getProjects();
    return projects.find(p => p.name.toLowerCase() === name.toLowerCase()) || null;
  }

  async getOverdueTasks(): Promise<TaskEntity[]> {
    const now = new Date();
    const tasks = await this.getTasks({ status: 'todo' });
    return tasks.filter(t => t.dueDate && t.dueDate < now);
  }

  async getUpcomingEvents(days = 7): Promise<EventEntity[]> {
    const now = new Date();
    const future = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    return this.getEvents({ afterDate: now, beforeDate: future });
  }

  async getSelf(): Promise<PersonEntity | null> {
    const people = await this.getPeople({ relationship: 'self' });
    return people[0] || null;
  }

  async getOrCreateSelf(name: string, email: string): Promise<PersonEntity> {
    let self = await this.getSelf();
    if (!self) {
      self = createPersonEntity({
        canonicalName: name,
        emails: [{ email, type: 'personal', isPrimary: true, verified: true }],
        relationshipType: 'self',
        relationshipStrength: 1.0,
      });
      await this.create(self);
    }
    return self;
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let instance: EntityManager | null = null;

export function getEntityManager(): EntityManager {
  if (!instance) {
    instance = new EntityManager();
  }
  return instance;
}
