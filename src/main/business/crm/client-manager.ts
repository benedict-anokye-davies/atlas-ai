/**
 * Atlas Desktop - Client Manager
 * Client CRUD operations, interaction logging, and follow-ups
 *
 * @module business/crm/client-manager
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';
import { createModuleLogger } from '../../utils/logger';
import {
  Client,
  ClientStatus,
  ClientSource,
  ClientContact,
  ClientInteraction,
  FollowUpReminder,
} from '../types';

const logger = createModuleLogger('ClientManager');

/**
 * Client Manager Events
 */
export interface ClientManagerEvents {
  'client-created': (client: Client) => void;
  'client-updated': (client: Client) => void;
  'client-deleted': (clientId: string) => void;
  'interaction-logged': (interaction: ClientInteraction) => void;
  'follow-up-due': (reminder: FollowUpReminder) => void;
}

/**
 * Client search filters
 */
export interface ClientSearchFilters {
  status?: ClientStatus[];
  source?: ClientSource[];
  tags?: string[];
  minOutstanding?: number;
  searchText?: string;
}

/**
 * Client Manager
 * Handles all client-related operations for AtlasAgency
 */
export class ClientManager extends EventEmitter {
  private clients: Map<string, Client> = new Map();
  private interactions: Map<string, ClientInteraction[]> = new Map();
  private dataDir: string;
  private initialized = false;

  constructor() {
    super();
    this.dataDir = path.join(homedir(), '.atlas', 'business');
  }

  /**
   * Initialize the client manager
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      await fs.mkdir(this.dataDir, { recursive: true });
      await this.loadData();
      this.initialized = true;
      logger.info('ClientManager initialized', { clientCount: this.clients.size });
    } catch (error) {
      logger.error('Failed to initialize ClientManager', { error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Load data from disk
   */
  private async loadData(): Promise<void> {
    const clientsPath = path.join(this.dataDir, 'clients.json');
    const interactionsPath = path.join(this.dataDir, 'interactions.json');

    try {
      const clientsData = await fs.readFile(clientsPath, 'utf-8');
      const clients = JSON.parse(clientsData) as Client[];
      for (const client of clients) {
        client.createdAt = new Date(client.createdAt);
        client.updatedAt = new Date(client.updatedAt);
        this.clients.set(client.id, client);
      }
    } catch {
      // File doesn't exist, start fresh
    }

    try {
      const interactionsData = await fs.readFile(interactionsPath, 'utf-8');
      const interactions = JSON.parse(interactionsData) as ClientInteraction[];
      for (const interaction of interactions) {
        interaction.timestamp = new Date(interaction.timestamp);
        if (interaction.followUpDate) {
          interaction.followUpDate = new Date(interaction.followUpDate);
        }
        const list = this.interactions.get(interaction.clientId) || [];
        list.push(interaction);
        this.interactions.set(interaction.clientId, list);
      }
    } catch {
      // File doesn't exist, start fresh
    }
  }

  /**
   * Save data to disk
   */
  private async saveData(): Promise<void> {
    const clientsPath = path.join(this.dataDir, 'clients.json');
    const interactionsPath = path.join(this.dataDir, 'interactions.json');

    await fs.writeFile(clientsPath, JSON.stringify([...this.clients.values()], null, 2));
    
    const allInteractions: ClientInteraction[] = [];
    for (const list of this.interactions.values()) {
      allInteractions.push(...list);
    }
    await fs.writeFile(interactionsPath, JSON.stringify(allInteractions, null, 2));
  }

  // ============================================================
  // Client CRUD
  // ============================================================

  /**
   * Create a new client
   */
  async createClient(data: {
    name: string;
    company?: string;
    email: string;
    phone?: string;
    contacts?: ClientContact[];
    source?: ClientSource;
    sourceDetails?: string;
    paymentTerms?: number;
    defaultHourlyRate?: number;
    tags?: string[];
    notes?: string;
  }): Promise<Client> {
    const client: Client = {
      id: randomUUID(),
      name: data.name,
      company: data.company,
      email: data.email,
      phone: data.phone,
      contacts: data.contacts || [{ type: 'email', value: data.email, primary: true }],
      status: 'active',
      source: data.source || 'other',
      sourceDetails: data.sourceDetails,
      paymentTerms: data.paymentTerms || 14,
      defaultHourlyRate: data.defaultHourlyRate,
      outstandingBalance: 0,
      totalPaid: 0,
      tags: data.tags || [],
      notes: data.notes || '',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.clients.set(client.id, client);
    await this.saveData();

    this.emit('client-created', client);
    logger.info('Client created', { clientId: client.id, name: client.name });

    return client;
  }

  /**
   * Get a client by ID
   */
  getClient(clientId: string): Client | undefined {
    return this.clients.get(clientId);
  }

  /**
   * Get a client by name (fuzzy match)
   */
  getClientByName(name: string): Client | undefined {
    const lowerName = name.toLowerCase();
    for (const client of this.clients.values()) {
      if (
        client.name.toLowerCase() === lowerName ||
        client.company?.toLowerCase() === lowerName ||
        client.name.toLowerCase().includes(lowerName) ||
        client.company?.toLowerCase().includes(lowerName)
      ) {
        return client;
      }
    }
    return undefined;
  }

  /**
   * Get all clients
   */
  getAllClients(): Client[] {
    return [...this.clients.values()];
  }

  /**
   * Search clients with filters
   */
  searchClients(filters: ClientSearchFilters): Client[] {
    let results = [...this.clients.values()];

    if (filters.status && filters.status.length > 0) {
      results = results.filter(c => filters.status!.includes(c.status));
    }

    if (filters.source && filters.source.length > 0) {
      results = results.filter(c => filters.source!.includes(c.source));
    }

    if (filters.tags && filters.tags.length > 0) {
      results = results.filter(c => 
        filters.tags!.some(tag => c.tags.includes(tag))
      );
    }

    if (filters.minOutstanding !== undefined) {
      results = results.filter(c => c.outstandingBalance >= filters.minOutstanding!);
    }

    if (filters.searchText) {
      const search = filters.searchText.toLowerCase();
      results = results.filter(c =>
        c.name.toLowerCase().includes(search) ||
        c.company?.toLowerCase().includes(search) ||
        c.email.toLowerCase().includes(search)
      );
    }

    return results;
  }

  /**
   * Update a client
   */
  async updateClient(clientId: string, updates: Partial<Omit<Client, 'id' | 'createdAt'>>): Promise<Client | undefined> {
    const client = this.clients.get(clientId);
    if (!client) return undefined;

    const updatedClient: Client = {
      ...client,
      ...updates,
      updatedAt: new Date(),
    };

    this.clients.set(clientId, updatedClient);
    await this.saveData();

    this.emit('client-updated', updatedClient);
    logger.info('Client updated', { clientId });

    return updatedClient;
  }

  /**
   * Update client status
   */
  async updateClientStatus(clientId: string, status: ClientStatus): Promise<Client | undefined> {
    return this.updateClient(clientId, { status });
  }

  /**
   * Delete a client
   */
  async deleteClient(clientId: string): Promise<boolean> {
    const deleted = this.clients.delete(clientId);
    if (deleted) {
      this.interactions.delete(clientId);
      await this.saveData();
      this.emit('client-deleted', clientId);
      logger.info('Client deleted', { clientId });
    }
    return deleted;
  }

  // ============================================================
  // Interaction Logging
  // ============================================================

  /**
   * Log a client interaction
   */
  async logInteraction(data: {
    clientId: string;
    type: ClientInteraction['type'];
    summary: string;
    details?: string;
    followUpDate?: Date;
  }): Promise<ClientInteraction | undefined> {
    const client = this.clients.get(data.clientId);
    if (!client) {
      logger.warn('Cannot log interaction - client not found', { clientId: data.clientId });
      return undefined;
    }

    const interaction: ClientInteraction = {
      id: randomUUID(),
      clientId: data.clientId,
      type: data.type,
      summary: data.summary,
      details: data.details,
      timestamp: new Date(),
      followUpDate: data.followUpDate,
      followUpCompleted: false,
    };

    const list = this.interactions.get(data.clientId) || [];
    list.push(interaction);
    this.interactions.set(data.clientId, list);

    await this.saveData();

    this.emit('interaction-logged', interaction);
    logger.info('Interaction logged', { clientId: data.clientId, type: data.type });

    return interaction;
  }

  /**
   * Get interactions for a client
   */
  getInteractions(clientId: string, limit?: number): ClientInteraction[] {
    const list = this.interactions.get(clientId) || [];
    const sorted = [...list].sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    return limit ? sorted.slice(0, limit) : sorted;
  }

  /**
   * Mark a follow-up as completed
   */
  async completeFollowUp(interactionId: string): Promise<boolean> {
    for (const [clientId, list] of this.interactions) {
      const interaction = list.find(i => i.id === interactionId);
      if (interaction) {
        interaction.followUpCompleted = true;
        await this.saveData();
        logger.info('Follow-up completed', { interactionId, clientId });
        return true;
      }
    }
    return false;
  }

  // ============================================================
  // Follow-up Management
  // ============================================================

  /**
   * Get pending follow-ups
   */
  getPendingFollowUps(): FollowUpReminder[] {
    const reminders: FollowUpReminder[] = [];
    const now = new Date();

    for (const [clientId, list] of this.interactions) {
      const client = this.clients.get(clientId);
      if (!client) continue;

      for (const interaction of list) {
        if (
          interaction.followUpDate &&
          !interaction.followUpCompleted &&
          new Date(interaction.followUpDate) <= now
        ) {
          reminders.push({
            id: interaction.id,
            type: 'client',
            entityId: clientId,
            entityName: client.name,
            reason: interaction.summary,
            dueDate: interaction.followUpDate,
            completed: false,
          });
        }
      }
    }

    return reminders.sort((a, b) => 
      new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
    );
  }

  /**
   * Get overdue follow-ups
   */
  getOverdueFollowUps(): FollowUpReminder[] {
    const now = new Date();
    return this.getPendingFollowUps().filter(r => 
      new Date(r.dueDate) < now
    );
  }

  // ============================================================
  // Financial Helpers
  // ============================================================

  /**
   * Update client outstanding balance
   */
  async updateOutstandingBalance(clientId: string, amount: number): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client) return;

    client.outstandingBalance = amount;
    client.updatedAt = new Date();
    await this.saveData();
  }

  /**
   * Record a payment received
   */
  async recordPayment(clientId: string, amount: number): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client) return;

    client.outstandingBalance = Math.max(0, client.outstandingBalance - amount);
    client.totalPaid += amount;
    client.updatedAt = new Date();
    await this.saveData();

    logger.info('Payment recorded', { clientId, amount, newOutstanding: client.outstandingBalance });
  }

  /**
   * Get total outstanding across all clients
   */
  getTotalOutstanding(): number {
    let total = 0;
    for (const client of this.clients.values()) {
      total += client.outstandingBalance;
    }
    return total;
  }

  /**
   * Get clients with outstanding balances
   */
  getClientsWithOutstanding(): Client[] {
    return [...this.clients.values()].filter(c => c.outstandingBalance > 0);
  }

  // ============================================================
  // Statistics
  // ============================================================

  /**
   * Get client statistics
   */
  getStats(): {
    total: number;
    byStatus: Record<ClientStatus, number>;
    bySource: Record<ClientSource, number>;
    totalOutstanding: number;
    totalPaid: number;
  } {
    const byStatus: Record<ClientStatus, number> = {
      lead: 0,
      prospect: 0,
      active: 0,
      past: 0,
      lost: 0,
    };
    const bySource: Record<ClientSource, number> = {
      referral: 0,
      website: 0,
      linkedin: 0,
      cold_outreach: 0,
      upwork: 0,
      toptal: 0,
      other: 0,
    };
    let totalOutstanding = 0;
    let totalPaid = 0;

    for (const client of this.clients.values()) {
      byStatus[client.status]++;
      bySource[client.source]++;
      totalOutstanding += client.outstandingBalance;
      totalPaid += client.totalPaid;
    }

    return {
      total: this.clients.size,
      byStatus,
      bySource,
      totalOutstanding,
      totalPaid,
    };
  }
}

// Singleton instance
let instance: ClientManager | null = null;

/**
 * Get the singleton Client Manager instance
 */
export function getClientManager(): ClientManager {
  if (!instance) {
    instance = new ClientManager();
  }
  return instance;
}

/**
 * Initialize the Client Manager (call on app startup)
 */
export async function initializeClientManager(): Promise<ClientManager> {
  const manager = getClientManager();
  await manager.initialize();
  return manager;
}
