/**
 * Atlas Desktop - Lead Manager
 * Sales pipeline management and proposal generation
 *
 * @module business/pipeline/lead-manager
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';
import { createModuleLogger } from '../../utils/logger';
import { Lead, LeadStatus, LeadSource, Proposal } from '../types';

const logger = createModuleLogger('LeadManager');

/**
 * Lead Manager Events
 */
export interface LeadManagerEvents {
  'lead-created': (lead: Lead) => void;
  'lead-updated': (lead: Lead) => void;
  'lead-converted': (lead: Lead, clientId: string) => void;
  'lead-lost': (lead: Lead) => void;
  'proposal-sent': (proposal: Proposal) => void;
  'follow-up-due': (lead: Lead) => void;
}

/**
 * Lead search filters
 */
export interface LeadSearchFilters {
  status?: LeadStatus[];
  source?: LeadSource[];
  minValue?: number;
  maxValue?: number;
  searchText?: string;
}

/**
 * Lead Manager
 * Handles sales pipeline operations for AtlasAgency
 */
export class LeadManager extends EventEmitter {
  private leads: Map<string, Lead> = new Map();
  private proposals: Map<string, Proposal[]> = new Map();
  private dataDir: string;
  private initialized = false;

  constructor() {
    super();
    this.dataDir = path.join(homedir(), '.atlas', 'business');
  }

  /**
   * Initialize the lead manager
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      await fs.mkdir(this.dataDir, { recursive: true });
      await this.loadData();
      this.initialized = true;
      logger.info('LeadManager initialized', { leadCount: this.leads.size });
    } catch (error) {
      logger.error('Failed to initialize LeadManager', { error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Load data from disk
   */
  private async loadData(): Promise<void> {
    const leadsPath = path.join(this.dataDir, 'leads.json');
    const proposalsPath = path.join(this.dataDir, 'proposals.json');

    try {
      const leadsData = await fs.readFile(leadsPath, 'utf-8');
      const leads = JSON.parse(leadsData) as Lead[];
      for (const lead of leads) {
        lead.createdAt = new Date(lead.createdAt);
        lead.updatedAt = new Date(lead.updatedAt);
        if (lead.nextFollowUp) lead.nextFollowUp = new Date(lead.nextFollowUp);
        if (lead.expectedCloseDate) lead.expectedCloseDate = new Date(lead.expectedCloseDate);
        this.leads.set(lead.id, lead);
      }
    } catch {
      // File doesn't exist, start fresh
    }

    try {
      const proposalsData = await fs.readFile(proposalsPath, 'utf-8');
      const proposals = JSON.parse(proposalsData) as Proposal[];
      for (const proposal of proposals) {
        proposal.createdAt = new Date(proposal.createdAt);
        if (proposal.sentAt) proposal.sentAt = new Date(proposal.sentAt);
        if (proposal.expiresAt) proposal.expiresAt = new Date(proposal.expiresAt);
        const list = this.proposals.get(proposal.leadId) || [];
        list.push(proposal);
        this.proposals.set(proposal.leadId, list);
      }
    } catch {
      // File doesn't exist, start fresh
    }
  }

  /**
   * Save data to disk
   */
  private async saveData(): Promise<void> {
    const leadsPath = path.join(this.dataDir, 'leads.json');
    const proposalsPath = path.join(this.dataDir, 'proposals.json');

    await fs.writeFile(leadsPath, JSON.stringify([...this.leads.values()], null, 2));
    
    const allProposals: Proposal[] = [];
    for (const list of this.proposals.values()) {
      allProposals.push(...list);
    }
    await fs.writeFile(proposalsPath, JSON.stringify(allProposals, null, 2));
  }

  // ============================================================
  // Lead CRUD
  // ============================================================

  /**
   * Create a new lead
   */
  async createLead(data: {
    name: string;
    company?: string;
    email: string;
    phone?: string;
    source: LeadSource;
    sourceDetails?: string;
    projectDescription: string;
    estimatedValue?: number;
    probability?: number;
    expectedCloseDate?: Date;
    nextFollowUp?: Date;
    notes?: string;
  }): Promise<Lead> {
    const lead: Lead = {
      id: randomUUID(),
      name: data.name,
      company: data.company,
      email: data.email,
      phone: data.phone,
      source: data.source,
      sourceDetails: data.sourceDetails,
      status: 'new',
      projectDescription: data.projectDescription,
      estimatedValue: data.estimatedValue || 0,
      probability: data.probability || 10,
      expectedCloseDate: data.expectedCloseDate,
      nextFollowUp: data.nextFollowUp,
      notes: data.notes || '',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.leads.set(lead.id, lead);
    await this.saveData();

    this.emit('lead-created', lead);
    logger.info('Lead created', { leadId: lead.id, name: lead.name });

    return lead;
  }

  /**
   * Get a lead by ID
   */
  getLead(leadId: string): Lead | undefined {
    return this.leads.get(leadId);
  }

  /**
   * Get all leads
   */
  getAllLeads(): Lead[] {
    return [...this.leads.values()].sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  /**
   * Search leads with filters
   */
  searchLeads(filters: LeadSearchFilters): Lead[] {
    let results = [...this.leads.values()];

    if (filters.status && filters.status.length > 0) {
      results = results.filter(l => filters.status!.includes(l.status));
    }

    if (filters.source && filters.source.length > 0) {
      results = results.filter(l => filters.source!.includes(l.source));
    }

    if (filters.minValue !== undefined) {
      results = results.filter(l => l.estimatedValue >= filters.minValue!);
    }

    if (filters.maxValue !== undefined) {
      results = results.filter(l => l.estimatedValue <= filters.maxValue!);
    }

    if (filters.searchText) {
      const search = filters.searchText.toLowerCase();
      results = results.filter(l =>
        l.name.toLowerCase().includes(search) ||
        l.company?.toLowerCase().includes(search) ||
        l.projectDescription.toLowerCase().includes(search)
      );
    }

    return results.sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  /**
   * Update a lead
   */
  async updateLead(leadId: string, updates: Partial<Omit<Lead, 'id' | 'createdAt'>>): Promise<Lead | undefined> {
    const lead = this.leads.get(leadId);
    if (!lead) return undefined;

    const updatedLead: Lead = {
      ...lead,
      ...updates,
      updatedAt: new Date(),
    };

    this.leads.set(leadId, updatedLead);
    await this.saveData();

    this.emit('lead-updated', updatedLead);
    return updatedLead;
  }

  /**
   * Update lead status
   */
  async updateLeadStatus(leadId: string, status: LeadStatus): Promise<Lead | undefined> {
    return this.updateLead(leadId, { status });
  }

  /**
   * Delete a lead
   */
  async deleteLead(leadId: string): Promise<boolean> {
    const deleted = this.leads.delete(leadId);
    if (deleted) {
      this.proposals.delete(leadId);
      await this.saveData();
      logger.info('Lead deleted', { leadId });
    }
    return deleted;
  }

  // ============================================================
  // Pipeline Stage Management
  // ============================================================

  /**
   * Move lead to contacted stage
   */
  async markContacted(leadId: string, notes?: string): Promise<Lead | undefined> {
    return this.updateLead(leadId, {
      status: 'contacted',
      probability: 20,
      notes: notes ? `${this.getLead(leadId)?.notes}\n\n[Contacted] ${notes}` : undefined,
    });
  }

  /**
   * Move lead to qualified stage
   */
  async markQualified(leadId: string, notes?: string): Promise<Lead | undefined> {
    return this.updateLead(leadId, {
      status: 'qualified',
      probability: 40,
      notes: notes ? `${this.getLead(leadId)?.notes}\n\n[Qualified] ${notes}` : undefined,
    });
  }

  /**
   * Move lead to proposal stage
   */
  async moveToProposalStage(leadId: string, proposalId?: string): Promise<Lead | undefined> {
    return this.updateLead(leadId, {
      status: 'proposal',
      probability: 60,
    });
  }

  /**
   * Move lead to negotiation stage
   */
  async markNegotiating(leadId: string, notes?: string): Promise<Lead | undefined> {
    return this.updateLead(leadId, {
      status: 'negotiation',
      probability: 80,
      notes: notes ? `${this.getLead(leadId)?.notes}\n\n[Negotiation] ${notes}` : undefined,
    });
  }

  /**
   * Convert lead to client
   */
  async convertToClient(leadId: string, clientId: string): Promise<Lead | undefined> {
    const lead = await this.updateLead(leadId, {
      status: 'won',
      probability: 100,
      convertedClientId: clientId,
    });

    if (lead) {
      this.emit('lead-converted', lead, clientId);
      logger.info('Lead converted to client', { leadId, clientId });
    }

    return lead;
  }

  /**
   * Mark lead as lost
   */
  async markLost(leadId: string, reason?: string): Promise<Lead | undefined> {
    const lead = await this.updateLead(leadId, {
      status: 'lost',
      probability: 0,
      notes: reason ? `${this.getLead(leadId)?.notes}\n\n[Lost] ${reason}` : undefined,
    });

    if (lead) {
      this.emit('lead-lost', lead);
      logger.info('Lead marked as lost', { leadId, reason });
    }

    return lead;
  }

  // ============================================================
  // Follow-up Management
  // ============================================================

  /**
   * Set next follow-up date
   */
  async setFollowUp(leadId: string, date: Date, notes?: string): Promise<Lead | undefined> {
    return this.updateLead(leadId, {
      nextFollowUp: date,
      notes: notes ? `${this.getLead(leadId)?.notes}\n\n[Follow-up scheduled: ${date.toLocaleDateString()}] ${notes}` : undefined,
    });
  }

  /**
   * Get leads with due follow-ups
   */
  getDueFollowUps(): Lead[] {
    const now = new Date();
    return [...this.leads.values()].filter(l =>
      l.nextFollowUp &&
      new Date(l.nextFollowUp) <= now &&
      !['won', 'lost'].includes(l.status)
    ).sort((a, b) =>
      new Date(a.nextFollowUp!).getTime() - new Date(b.nextFollowUp!).getTime()
    );
  }

  /**
   * Get upcoming follow-ups
   */
  getUpcomingFollowUps(daysAhead: number = 7): Lead[] {
    const now = new Date();
    const future = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
    
    return [...this.leads.values()].filter(l =>
      l.nextFollowUp &&
      new Date(l.nextFollowUp) > now &&
      new Date(l.nextFollowUp) <= future &&
      !['won', 'lost'].includes(l.status)
    ).sort((a, b) =>
      new Date(a.nextFollowUp!).getTime() - new Date(b.nextFollowUp!).getTime()
    );
  }

  // ============================================================
  // Proposal Management
  // ============================================================

  /**
   * Create a proposal for a lead
   */
  async createProposal(data: {
    leadId: string;
    title: string;
    description: string;
    scope: string[];
    deliverables: string[];
    timeline: string;
    pricing: {
      type: 'fixed' | 'hourly' | 'retainer';
      amount: number;
      hourlyRate?: number;
      estimatedHours?: number;
    };
    validityDays?: number;
    terms?: string;
  }): Promise<Proposal | undefined> {
    const lead = this.leads.get(data.leadId);
    if (!lead) return undefined;

    const proposal: Proposal = {
      id: randomUUID(),
      leadId: data.leadId,
      title: data.title,
      description: data.description,
      scope: data.scope,
      deliverables: data.deliverables,
      timeline: data.timeline,
      pricing: data.pricing,
      status: 'draft',
      expiresAt: data.validityDays 
        ? new Date(Date.now() + data.validityDays * 24 * 60 * 60 * 1000)
        : undefined,
      terms: data.terms,
      createdAt: new Date(),
    };

    const list = this.proposals.get(data.leadId) || [];
    list.push(proposal);
    this.proposals.set(data.leadId, list);

    await this.saveData();
    logger.info('Proposal created', { proposalId: proposal.id, leadId: data.leadId });

    return proposal;
  }

  /**
   * Get proposals for a lead
   */
  getLeadProposals(leadId: string): Proposal[] {
    return this.proposals.get(leadId) || [];
  }

  /**
   * Mark proposal as sent
   */
  async markProposalSent(proposalId: string): Promise<Proposal | undefined> {
    for (const [leadId, list] of this.proposals) {
      const index = list.findIndex(p => p.id === proposalId);
      if (index !== -1) {
        list[index].status = 'sent';
        list[index].sentAt = new Date();
        await this.saveData();

        // Also update lead status
        await this.updateLead(leadId, { status: 'proposal', probability: 60 });

        this.emit('proposal-sent', list[index]);
        return list[index];
      }
    }
    return undefined;
  }

  /**
   * Mark proposal as accepted
   */
  async markProposalAccepted(proposalId: string): Promise<Proposal | undefined> {
    for (const [leadId, list] of this.proposals) {
      const index = list.findIndex(p => p.id === proposalId);
      if (index !== -1) {
        list[index].status = 'accepted';
        await this.saveData();

        // Update lead to negotiation
        await this.updateLead(leadId, { status: 'negotiation', probability: 80 });

        return list[index];
      }
    }
    return undefined;
  }

  /**
   * Mark proposal as rejected
   */
  async markProposalRejected(proposalId: string): Promise<Proposal | undefined> {
    for (const list of this.proposals.values()) {
      const index = list.findIndex(p => p.id === proposalId);
      if (index !== -1) {
        list[index].status = 'rejected';
        await this.saveData();
        return list[index];
      }
    }
    return undefined;
  }

  /**
   * Generate proposal text
   */
  generateProposalText(proposalId: string): string | undefined {
    for (const list of this.proposals.values()) {
      const proposal = list.find(p => p.id === proposalId);
      if (proposal) {
        const lead = this.leads.get(proposal.leadId);
        const lines: string[] = [
          `PROPOSAL`,
          ``,
          `${proposal.title}`,
          ``,
          `Prepared for: ${lead?.name}${lead?.company ? ` - ${lead.company}` : ''}`,
          `Date: ${new Date(proposal.createdAt).toLocaleDateString('en-GB')}`,
          proposal.expiresAt ? `Valid until: ${new Date(proposal.expiresAt).toLocaleDateString('en-GB')}` : '',
          ``,
          `DESCRIPTION`,
          proposal.description,
          ``,
          `SCOPE`,
          ...proposal.scope.map(s => `- ${s}`),
          ``,
          `DELIVERABLES`,
          ...proposal.deliverables.map(d => `- ${d}`),
          ``,
          `TIMELINE`,
          proposal.timeline,
          ``,
          `PRICING`,
          proposal.pricing.type === 'fixed' 
            ? `Fixed Price: £${proposal.pricing.amount.toLocaleString()}`
            : proposal.pricing.type === 'hourly'
              ? `Hourly Rate: £${proposal.pricing.hourlyRate}/hour (Est. ${proposal.pricing.estimatedHours} hours = £${proposal.pricing.amount.toLocaleString()})`
              : `Monthly Retainer: £${proposal.pricing.amount.toLocaleString()}/month`,
          ``,
          proposal.terms ? `TERMS\n${proposal.terms}` : '',
        ];

        return lines.filter(l => l !== '').join('\n');
      }
    }
    return undefined;
  }

  // ============================================================
  // Pipeline Statistics
  // ============================================================

  /**
   * Get leads by stage
   */
  getLeadsByStage(): Record<LeadStatus, Lead[]> {
    const byStage: Record<LeadStatus, Lead[]> = {
      new: [],
      contacted: [],
      qualified: [],
      proposal: [],
      negotiation: [],
      won: [],
      lost: [],
    };

    for (const lead of this.leads.values()) {
      byStage[lead.status].push(lead);
    }

    return byStage;
  }

  /**
   * Get pipeline value (weighted by probability)
   */
  getPipelineValue(): {
    total: number;
    weighted: number;
    byStage: Record<LeadStatus, { count: number; value: number; weighted: number }>;
  } {
    const byStage: Record<LeadStatus, { count: number; value: number; weighted: number }> = {
      new: { count: 0, value: 0, weighted: 0 },
      contacted: { count: 0, value: 0, weighted: 0 },
      qualified: { count: 0, value: 0, weighted: 0 },
      proposal: { count: 0, value: 0, weighted: 0 },
      negotiation: { count: 0, value: 0, weighted: 0 },
      won: { count: 0, value: 0, weighted: 0 },
      lost: { count: 0, value: 0, weighted: 0 },
    };

    let total = 0;
    let weighted = 0;

    for (const lead of this.leads.values()) {
      const leadWeighted = lead.estimatedValue * (lead.probability / 100);
      byStage[lead.status].count++;
      byStage[lead.status].value += lead.estimatedValue;
      byStage[lead.status].weighted += leadWeighted;

      if (!['won', 'lost'].includes(lead.status)) {
        total += lead.estimatedValue;
        weighted += leadWeighted;
      }
    }

    return { total, weighted, byStage };
  }

  /**
   * Get conversion rate
   */
  getConversionRate(): { rate: number; won: number; lost: number; total: number } {
    const all = [...this.leads.values()];
    const won = all.filter(l => l.status === 'won').length;
    const lost = all.filter(l => l.status === 'lost').length;
    const closed = won + lost;

    return {
      rate: closed > 0 ? (won / closed) * 100 : 0,
      won,
      lost,
      total: all.length,
    };
  }

  /**
   * Get lead statistics
   */
  getStats(): {
    total: number;
    active: number;
    pipelineValue: number;
    weightedValue: number;
    conversionRate: number;
    dueFollowUps: number;
    byStatus: Record<LeadStatus, number>;
    bySource: Record<LeadSource, number>;
  } {
    const byStatus: Record<LeadStatus, number> = {
      new: 0,
      contacted: 0,
      qualified: 0,
      proposal: 0,
      negotiation: 0,
      won: 0,
      lost: 0,
    };
    const bySource: Record<LeadSource, number> = {
      referral: 0,
      website: 0,
      linkedin: 0,
      cold_outreach: 0,
      upwork: 0,
      toptal: 0,
      other: 0,
    };

    for (const lead of this.leads.values()) {
      byStatus[lead.status]++;
      bySource[lead.source]++;
    }

    const pipeline = this.getPipelineValue();
    const conversion = this.getConversionRate();

    return {
      total: this.leads.size,
      active: this.leads.size - byStatus.won - byStatus.lost,
      pipelineValue: pipeline.total,
      weightedValue: pipeline.weighted,
      conversionRate: conversion.rate,
      dueFollowUps: this.getDueFollowUps().length,
      byStatus,
      bySource,
    };
  }
}

// Singleton instance
let instance: LeadManager | null = null;

/**
 * Get the singleton Lead Manager instance
 */
export function getLeadManager(): LeadManager {
  if (!instance) {
    instance = new LeadManager();
  }
  return instance;
}

/**
 * Initialize the Lead Manager (call on app startup)
 */
export async function initializeLeadManager(): Promise<LeadManager> {
  const manager = getLeadManager();
  await manager.initialize();
  return manager;
}
