/**
 * Contact Resolver
 * Resolves and deduplicates contact information across sources
 */

import { createModuleLogger } from '../../../utils/logger';
import { OntologyEntity, OntologyRelationship, PersonEntity, OrganizationEntity } from '../../types';
import {
  SemanticParser,
  ContactParsedOutput,
  ContactInput,
  ContactMergeCandidate,
} from '../types';

const logger = createModuleLogger('ContactResolver');

// ============================================================================
// CONTACT RESOLVER IMPLEMENTATION
// ============================================================================

export class ContactResolver implements SemanticParser<ContactInput | ContactInput[], ContactParsedOutput> {
  readonly name = 'ContactResolver';
  readonly version = '1.0.0';
  readonly sourceTypes = ['contacts'] as const;

  // --------------------------------------------------------------------------
  // MAIN PARSE
  // --------------------------------------------------------------------------

  async parse(input: ContactInput | ContactInput[]): Promise<ContactParsedOutput> {
    const contacts = Array.isArray(input) ? input : [input];
    logger.debug('Resolving contacts', { count: contacts.length });

    // Find merge candidates
    const mergeCandidates = this.findMergeCandidates(contacts);

    // Perform merging
    const mergedContacts = this.mergeContacts(contacts, mergeCandidates);

    // Extract organizations
    const organizations = this.extractOrganizations(mergedContacts);

    // Build relationship graph
    const relationships = this.buildRelationshipGraph(mergedContacts);

    const output: ContactParsedOutput = {
      sourceType: 'contacts',
      parsedAt: new Date(),
      contacts: mergedContacts,
      organizations,
      mergeCandidates,
      relationships,
    };

    logger.info('Contact resolution completed', {
      inputCount: contacts.length,
      outputCount: mergedContacts.length,
      mergeCount: mergeCandidates.length,
      orgCount: organizations.length,
    });

    return output;
  }

  // --------------------------------------------------------------------------
  // MERGE CANDIDATE DETECTION
  // --------------------------------------------------------------------------

  private findMergeCandidates(contacts: ContactInput[]): ContactMergeCandidate[] {
    const candidates: ContactMergeCandidate[] = [];

    for (let i = 0; i < contacts.length; i++) {
      for (let j = i + 1; j < contacts.length; j++) {
        const match = this.compareContacts(contacts[i], contacts[j]);

        if (match.confidence >= 0.6) {
          candidates.push({
            contact1Id: contacts[i].id,
            contact2Id: contacts[j].id,
            confidence: match.confidence,
            matchReasons: match.reasons,
          });
        }
      }
    }

    // Sort by confidence descending
    return candidates.sort((a, b) => b.confidence - a.confidence);
  }

  private compareContacts(
    c1: ContactInput,
    c2: ContactInput
  ): { confidence: number; reasons: string[] } {
    const reasons: string[] = [];
    let score = 0;

    // Email match (strongest signal)
    const emails1 = new Set(c1.emails.map(e => e.email.toLowerCase()));
    const emails2 = new Set(c2.emails.map(e => e.email.toLowerCase()));
    const emailOverlap = [...emails1].filter(e => emails2.has(e));

    if (emailOverlap.length > 0) {
      score += 0.5;
      reasons.push(`email_match: ${emailOverlap.join(', ')}`);
    }

    // Phone match (strong signal)
    const phones1 = new Set(c1.phones?.map(p => this.normalizePhone(p.number)) || []);
    const phones2 = new Set(c2.phones?.map(p => this.normalizePhone(p.number)) || []);
    const phoneOverlap = [...phones1].filter(p => phones2.has(p));

    if (phoneOverlap.length > 0) {
      score += 0.4;
      reasons.push('phone_match');
    }

    // Name similarity
    const nameSimilarity = this.compareNames(c1.name, c2.name);
    if (nameSimilarity > 0.8) {
      score += 0.3;
      reasons.push(`name_similarity: ${Math.round(nameSimilarity * 100)}%`);
    }

    // Organization match
    if (c1.organization && c2.organization) {
      const orgSimilarity = this.stringSimilarity(
        c1.organization.toLowerCase(),
        c2.organization.toLowerCase()
      );
      if (orgSimilarity > 0.8) {
        score += 0.2;
        reasons.push('same_organization');
      }
    }

    // Cap at 1.0
    return { confidence: Math.min(1, score), reasons };
  }

  private normalizePhone(phone: string): string {
    return phone.replace(/[^0-9]/g, '');
  }

  private compareNames(name1: string, name2: string): number {
    const n1 = name1.toLowerCase().trim();
    const n2 = name2.toLowerCase().trim();

    // Exact match
    if (n1 === n2) return 1;

    // Split into parts
    const parts1 = n1.split(/\s+/);
    const parts2 = n2.split(/\s+/);

    // Check for partial matches (first name or last name)
    let matchingParts = 0;
    for (const p1 of parts1) {
      for (const p2 of parts2) {
        if (p1 === p2 || this.stringSimilarity(p1, p2) > 0.8) {
          matchingParts++;
          break;
        }
      }
    }

    const totalParts = Math.max(parts1.length, parts2.length);
    return matchingParts / totalParts;
  }

  private stringSimilarity(s1: string, s2: string): number {
    // Levenshtein distance normalized
    const len1 = s1.length;
    const len2 = s2.length;

    if (len1 === 0) return len2 === 0 ? 1 : 0;
    if (len2 === 0) return 0;

    const matrix: number[][] = [];

    for (let i = 0; i <= len1; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= len2; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );
      }
    }

    const distance = matrix[len1][len2];
    const maxLen = Math.max(len1, len2);
    return 1 - distance / maxLen;
  }

  // --------------------------------------------------------------------------
  // CONTACT MERGING
  // --------------------------------------------------------------------------

  private mergeContacts(
    contacts: ContactInput[],
    candidates: ContactMergeCandidate[]
  ): ContactInput[] {
    // Build merge groups
    const mergeGroups = new Map<string, Set<string>>();
    const merged = new Set<string>();

    for (const candidate of candidates) {
      if (candidate.confidence < 0.7) continue; // Only merge high-confidence matches

      const group1 = this.findMergeGroup(mergeGroups, candidate.contact1Id);
      const group2 = this.findMergeGroup(mergeGroups, candidate.contact2Id);

      if (group1 && group2 && group1 !== group2) {
        // Merge the groups
        for (const id of group2) {
          group1.add(id);
        }
        mergeGroups.delete(candidate.contact2Id);
        mergeGroups.set(candidate.contact1Id, group1);
      } else if (group1) {
        group1.add(candidate.contact2Id);
      } else if (group2) {
        group2.add(candidate.contact1Id);
      } else {
        mergeGroups.set(candidate.contact1Id, new Set([candidate.contact1Id, candidate.contact2Id]));
      }
    }

    // Merge each group
    const result: ContactInput[] = [];

    for (const [_, group] of mergeGroups) {
      const groupContacts = contacts.filter(c => group.has(c.id));
      if (groupContacts.length > 0) {
        const mergedContact = this.mergeContactGroup(groupContacts);
        result.push(mergedContact);
        for (const c of groupContacts) {
          merged.add(c.id);
        }
      }
    }

    // Add unmerged contacts
    for (const contact of contacts) {
      if (!merged.has(contact.id)) {
        result.push(contact);
      }
    }

    return result;
  }

  private findMergeGroup(groups: Map<string, Set<string>>, id: string): Set<string> | null {
    for (const [_, group] of groups) {
      if (group.has(id)) return group;
    }
    return null;
  }

  private mergeContactGroup(contacts: ContactInput[]): ContactInput {
    // Sort by confidence/quality - prefer contacts with more data
    const sorted = [...contacts].sort((a, b) => {
      const aScore = (a.emails.length * 2) + (a.phones?.length || 0) + (a.organization ? 1 : 0);
      const bScore = (b.emails.length * 2) + (b.phones?.length || 0) + (b.organization ? 1 : 0);
      return bScore - aScore;
    });

    const primary = sorted[0];

    // Merge data from all contacts
    const allEmails = new Map<string, ContactInput['emails'][0]>();
    const allPhones = new Map<string, NonNullable<ContactInput['phones']>[0]>();
    const allSources = new Set<string>();
    const allTags = new Set<string>();

    for (const contact of contacts) {
      for (const email of contact.emails) {
        const key = email.email.toLowerCase();
        if (!allEmails.has(key) || email.primary) {
          allEmails.set(key, email);
        }
      }

      for (const phone of contact.phones || []) {
        const key = this.normalizePhone(phone.number);
        if (!allPhones.has(key) || phone.primary) {
          allPhones.set(key, phone);
        }
      }

      allSources.add(contact.source);
      for (const tag of contact.tags || []) {
        allTags.add(tag);
      }
    }

    return {
      id: primary.id,
      name: primary.name,
      firstName: primary.firstName || sorted.find(c => c.firstName)?.firstName,
      lastName: primary.lastName || sorted.find(c => c.lastName)?.lastName,
      emails: Array.from(allEmails.values()),
      phones: Array.from(allPhones.values()),
      organization: primary.organization || sorted.find(c => c.organization)?.organization,
      title: primary.title || sorted.find(c => c.title)?.title,
      addresses: primary.addresses || sorted.find(c => c.addresses)?.addresses,
      socialProfiles: primary.socialProfiles || sorted.find(c => c.socialProfiles)?.socialProfiles,
      birthday: primary.birthday || sorted.find(c => c.birthday)?.birthday,
      notes: contacts.map(c => c.notes).filter(Boolean).join('\n---\n'),
      tags: Array.from(allTags),
      source: Array.from(allSources).join(','),
      lastUpdated: new Date().toISOString(),
    };
  }

  // --------------------------------------------------------------------------
  // ORGANIZATION EXTRACTION
  // --------------------------------------------------------------------------

  private extractOrganizations(
    contacts: ContactInput[]
  ): Array<{ name: string; contactCount: number; domain?: string }> {
    const orgMap = new Map<string, { name: string; contacts: Set<string>; domains: Set<string> }>();

    for (const contact of contacts) {
      if (contact.organization) {
        const key = contact.organization.toLowerCase();

        if (!orgMap.has(key)) {
          orgMap.set(key, {
            name: contact.organization,
            contacts: new Set(),
            domains: new Set(),
          });
        }

        orgMap.get(key)!.contacts.add(contact.id);

        // Extract domain from email
        for (const email of contact.emails) {
          const domain = email.email.split('@')[1];
          if (domain && !this.isPersonalDomain(domain)) {
            orgMap.get(key)!.domains.add(domain);
          }
        }
      }
    }

    return Array.from(orgMap.values())
      .map(org => ({
        name: org.name,
        contactCount: org.contacts.size,
        domain: org.domains.size > 0 ? Array.from(org.domains)[0] : undefined,
      }))
      .sort((a, b) => b.contactCount - a.contactCount);
  }

  private isPersonalDomain(domain: string): boolean {
    const personalDomains = new Set([
      'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com',
      'aol.com', 'mail.com', 'protonmail.com', 'live.com', 'msn.com',
    ]);
    return personalDomains.has(domain.toLowerCase());
  }

  // --------------------------------------------------------------------------
  // RELATIONSHIP GRAPH BUILDING
  // --------------------------------------------------------------------------

  private buildRelationshipGraph(
    contacts: ContactInput[]
  ): Array<{ person1Id: string; person2Id: string; type: string; strength: number }> {
    const relationships: Array<{ person1Id: string; person2Id: string; type: string; strength: number }> = [];

    // Group by organization
    const orgContacts = new Map<string, ContactInput[]>();
    for (const contact of contacts) {
      if (contact.organization) {
        const key = contact.organization.toLowerCase();
        if (!orgContacts.has(key)) {
          orgContacts.set(key, []);
        }
        orgContacts.get(key)!.push(contact);
      }
    }

    // Create COLLEAGUE relationships
    for (const [_, orgMembers] of orgContacts) {
      if (orgMembers.length > 1 && orgMembers.length <= 50) {
        for (let i = 0; i < orgMembers.length; i++) {
          for (let j = i + 1; j < orgMembers.length; j++) {
            relationships.push({
              person1Id: orgMembers[i].id,
              person2Id: orgMembers[j].id,
              type: 'COLLEAGUE',
              strength: 0.6,
            });
          }
        }
      }
    }

    return relationships;
  }

  // --------------------------------------------------------------------------
  // ENTITY EXTRACTION
  // --------------------------------------------------------------------------

  extractEntities(output: ContactParsedOutput): OntologyEntity[] {
    const entities: OntologyEntity[] = [];

    // Create Person entities
    for (const contact of output.contacts) {
      const person: PersonEntity = {
        id: `person_${contact.id}`,
        type: 'Person',
        name: contact.name,
        createdAt: new Date(),
        updatedAt: new Date(contact.lastUpdated || Date.now()),
        sources: contact.source.split(',') as any[],
        confidence: 0.9,
        firstName: contact.firstName,
        lastName: contact.lastName,
        emails: contact.emails.map(e => ({
          email: e.email,
          type: e.type || 'work',
          primary: e.primary || false,
        })),
        phones: contact.phones?.map(p => ({
          number: p.number,
          type: p.type || 'mobile',
          primary: p.primary || false,
        })) || [],
        socialProfiles: contact.socialProfiles?.map(s => ({
          platform: s.platform,
          username: s.username,
          url: s.url,
        })) || [],
        addresses: contact.addresses?.map(a => ({
          type: a.type || 'work',
          street: a.street,
          city: a.city,
          state: a.state,
          country: a.country,
          postalCode: a.postalCode,
        })) || [],
        tags: contact.tags || [],
        birthday: contact.birthday ? new Date(contact.birthday) : undefined,
        notes: contact.notes,
        currentRole: contact.title,
        currentCompany: contact.organization,
      };

      entities.push(person);
    }

    // Create Organization entities
    for (const org of output.organizations) {
      const orgEntity: OrganizationEntity = {
        id: `org_${org.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
        type: 'Organization',
        name: org.name,
        createdAt: new Date(),
        updatedAt: new Date(),
        sources: ['contacts'],
        confidence: 0.7,
        organizationType: 'company',
        industry: undefined,
        size: org.contactCount > 10 ? 'large' : org.contactCount > 3 ? 'medium' : 'small',
        website: org.domain ? `https://${org.domain}` : undefined,
        domains: org.domain ? [org.domain] : [],
        tags: [],
        contacts: [],
        socialProfiles: [],
      };

      entities.push(orgEntity);
    }

    logger.debug('Extracted entities from contacts', {
      personCount: output.contacts.length,
      orgCount: output.organizations.length,
    });

    return entities;
  }

  // --------------------------------------------------------------------------
  // RELATIONSHIP EXTRACTION
  // --------------------------------------------------------------------------

  extractRelationships(output: ContactParsedOutput): OntologyRelationship[] {
    const relationships: OntologyRelationship[] = [];

    // Add pre-built relationships
    for (const rel of output.relationships) {
      relationships.push({
        id: `${rel.person1Id}_${rel.type.toLowerCase()}_${rel.person2Id}`,
        sourceId: `person_${rel.person1Id}`,
        sourceType: 'Person',
        targetId: `person_${rel.person2Id}`,
        targetType: 'Person',
        relationshipType: rel.type as any,
        createdAt: new Date(),
        strength: rel.strength,
        confidence: 0.7,
      });
    }

    // Link people to organizations
    for (const contact of output.contacts) {
      if (contact.organization) {
        const orgId = `org_${contact.organization.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;

        relationships.push({
          id: `person_${contact.id}_works_at_${orgId}`,
          sourceId: `person_${contact.id}`,
          sourceType: 'Person',
          targetId: orgId,
          targetType: 'Organization',
          relationshipType: 'WORKS_AT',
          createdAt: new Date(),
          strength: 0.9,
          confidence: 0.9,
          properties: {
            title: contact.title,
          },
        });
      }
    }

    logger.debug('Extracted relationships from contacts', { count: relationships.length });
    return relationships;
  }

  // --------------------------------------------------------------------------
  // EMBEDDING GENERATION
  // --------------------------------------------------------------------------

  async generateEmbeddings(output: ContactParsedOutput): Promise<Map<string, number[]>> {
    const embeddings = new Map<string, number[]>();

    // Placeholder - would integrate with actual embedding model
    logger.debug('Embedding generation skipped (placeholder)', {
      contactCount: output.contacts.length,
    });

    return embeddings;
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let instance: ContactResolver | null = null;

export function getContactResolver(): ContactResolver {
  if (!instance) {
    instance = new ContactResolver();
  }
  return instance;
}
