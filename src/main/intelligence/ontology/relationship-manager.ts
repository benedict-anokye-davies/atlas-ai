/**
 * Relationship Manager - High-level relationship operations
 */

import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';
import { OntologyStore, getOntologyStore } from './ontology-store';
import {
  OntologyRelationship,
  RelationshipType,
  EntityType,
  OntologyEntity,
} from '../types';

const logger = createModuleLogger('RelationshipManager');

// ============================================================================
// TYPES
// ============================================================================

export interface CreateRelationshipParams {
  sourceId: string;
  sourceType: EntityType;
  targetId: string;
  targetType: EntityType;
  relationshipType: RelationshipType;
  properties?: Record<string, unknown>;
  startDate?: Date;
  endDate?: Date;
  strength?: number;
  confidence?: number;
}

// ============================================================================
// RELATIONSHIP MANAGER CLASS
// ============================================================================

export class RelationshipManager extends EventEmitter {
  private store: OntologyStore;

  constructor(store?: OntologyStore) {
    super();
    this.store = store || getOntologyStore();
  }

  // --------------------------------------------------------------------------
  // CRUD OPERATIONS
  // --------------------------------------------------------------------------

  async create(params: CreateRelationshipParams): Promise<OntologyRelationship> {
    const now = new Date();
    const relationship: OntologyRelationship = {
      id: uuidv4(),
      sourceId: params.sourceId,
      sourceType: params.sourceType,
      targetId: params.targetId,
      targetType: params.targetType,
      relationshipType: params.relationshipType,
      properties: params.properties || {},
      startDate: params.startDate || null,
      endDate: params.endDate || null,
      strength: params.strength ?? 1.0,
      confidence: params.confidence ?? 1.0,
      sourceRecords: [],
      createdAt: now,
      updatedAt: now,
    };

    logger.debug('Creating relationship', {
      type: relationship.relationshipType,
      source: relationship.sourceId,
      target: relationship.targetId,
    });

    const created = await this.store.createRelationship(relationship);
    this.emit('created', created);
    return created;
  }

  async getForEntity(
    entityId: string,
    direction: 'incoming' | 'outgoing' | 'both' = 'both'
  ): Promise<OntologyRelationship[]> {
    return this.store.getRelationships(entityId, direction);
  }

  async getByType(type: RelationshipType): Promise<OntologyRelationship[]> {
    return this.store.getRelationshipsByType(type);
  }

  async delete(id: string): Promise<boolean> {
    logger.debug('Deleting relationship', { id });
    const deleted = await this.store.deleteRelationship(id);
    if (deleted) {
      this.emit('deleted', { id });
    }
    return deleted;
  }

  async bulkCreate(relationships: CreateRelationshipParams[]): Promise<number> {
    const now = new Date();
    const fullRelationships: OntologyRelationship[] = relationships.map(params => ({
      id: uuidv4(),
      sourceId: params.sourceId,
      sourceType: params.sourceType,
      targetId: params.targetId,
      targetType: params.targetType,
      relationshipType: params.relationshipType,
      properties: params.properties || {},
      startDate: params.startDate || null,
      endDate: params.endDate || null,
      strength: params.strength ?? 1.0,
      confidence: params.confidence ?? 1.0,
      sourceRecords: [],
      createdAt: now,
      updatedAt: now,
    }));

    return this.store.bulkCreateRelationships(fullRelationships);
  }

  // --------------------------------------------------------------------------
  // CONVENIENCE METHODS
  // --------------------------------------------------------------------------

  async linkPersonToOrganization(
    personId: string,
    orgId: string,
    isCurrent = true
  ): Promise<OntologyRelationship> {
    return this.create({
      sourceId: personId,
      sourceType: 'Person',
      targetId: orgId,
      targetType: 'Organization',
      relationshipType: isCurrent ? 'works_at' : 'worked_at',
    });
  }

  async linkPersonToProject(
    personId: string,
    projectId: string,
    isOwner = false
  ): Promise<OntologyRelationship> {
    return this.create({
      sourceId: personId,
      sourceType: 'Person',
      targetId: projectId,
      targetType: 'Project',
      relationshipType: isOwner ? 'owns_project' : 'contributes_to',
    });
  }

  async linkTaskToProject(taskId: string, projectId: string): Promise<OntologyRelationship> {
    return this.create({
      sourceId: taskId,
      sourceType: 'Task',
      targetId: projectId,
      targetType: 'Project',
      relationshipType: 'belongs_to_project',
    });
  }

  async assignTaskToPerson(taskId: string, personId: string): Promise<OntologyRelationship> {
    return this.create({
      sourceId: taskId,
      sourceType: 'Task',
      targetId: personId,
      targetType: 'Person',
      relationshipType: 'assigned_to',
    });
  }

  async linkDocumentToProject(
    documentId: string,
    projectId: string
  ): Promise<OntologyRelationship> {
    return this.create({
      sourceId: documentId,
      sourceType: 'Document',
      targetId: projectId,
      targetType: 'Project',
      relationshipType: 'document_for',
    });
  }

  async linkDocumentToAuthor(
    documentId: string,
    authorId: string
  ): Promise<OntologyRelationship> {
    return this.create({
      sourceId: documentId,
      sourceType: 'Document',
      targetId: authorId,
      targetType: 'Person',
      relationshipType: 'authored_by',
    });
  }

  async linkEventToPerson(
    eventId: string,
    personId: string,
    isOrganizer = false
  ): Promise<OntologyRelationship> {
    return this.create({
      sourceId: eventId,
      sourceType: 'Event',
      targetId: personId,
      targetType: 'Person',
      relationshipType: isOrganizer ? 'organized_by' : 'attended_by',
    });
  }

  async linkEventToProject(eventId: string, projectId: string): Promise<OntologyRelationship> {
    return this.create({
      sourceId: eventId,
      sourceType: 'Event',
      targetId: projectId,
      targetType: 'Project',
      relationshipType: 'related_to_project',
    });
  }

  async linkPersonToSkill(
    personId: string,
    skillId: string,
    isLearning = false
  ): Promise<OntologyRelationship> {
    return this.create({
      sourceId: personId,
      sourceType: 'Person',
      targetId: skillId,
      targetType: 'Skill',
      relationshipType: isLearning ? 'learning' : 'has_skill',
    });
  }

  async linkPersons(
    person1Id: string,
    person2Id: string,
    type: 'knows' | 'colleague_of' | 'collaborates_with' | 'mentors' | 'manages' | 'reports_to'
  ): Promise<OntologyRelationship> {
    return this.create({
      sourceId: person1Id,
      sourceType: 'Person',
      targetId: person2Id,
      targetType: 'Person',
      relationshipType: type,
    });
  }

  // --------------------------------------------------------------------------
  // QUERY HELPERS
  // --------------------------------------------------------------------------

  async getColleagues(personId: string): Promise<string[]> {
    const rels = await this.getForEntity(personId, 'both');
    const colleagueTypes: RelationshipType[] = ['colleague_of', 'collaborates_with', 'manages', 'reports_to'];
    return rels
      .filter(r => colleagueTypes.includes(r.relationshipType))
      .map(r => (r.sourceId === personId ? r.targetId : r.sourceId));
  }

  async getProjectMembers(projectId: string): Promise<string[]> {
    const rels = await this.getForEntity(projectId, 'incoming');
    return rels
      .filter(r => r.relationshipType === 'owns_project' || r.relationshipType === 'contributes_to')
      .map(r => r.sourceId);
  }

  async getPersonProjects(personId: string): Promise<string[]> {
    const rels = await this.getForEntity(personId, 'outgoing');
    return rels
      .filter(r => r.relationshipType === 'owns_project' || r.relationshipType === 'contributes_to')
      .map(r => r.targetId);
  }

  async getPersonOrganization(personId: string): Promise<string | null> {
    const rels = await this.getForEntity(personId, 'outgoing');
    const workRel = rels.find(r => r.relationshipType === 'works_at');
    return workRel?.targetId || null;
  }

  async getOrganizationMembers(orgId: string): Promise<string[]> {
    const rels = await this.getForEntity(orgId, 'incoming');
    return rels.filter(r => r.relationshipType === 'works_at').map(r => r.sourceId);
  }

  async getPersonSkills(personId: string): Promise<string[]> {
    const rels = await this.getForEntity(personId, 'outgoing');
    return rels.filter(r => r.relationshipType === 'has_skill').map(r => r.targetId);
  }

  async getEventAttendees(eventId: string): Promise<string[]> {
    const rels = await this.getForEntity(eventId, 'outgoing');
    return rels
      .filter(r => r.relationshipType === 'attended_by' || r.relationshipType === 'organized_by')
      .map(r => r.targetId);
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let instance: RelationshipManager | null = null;

export function getRelationshipManager(): RelationshipManager {
  if (!instance) {
    instance = new RelationshipManager();
  }
  return instance;
}
