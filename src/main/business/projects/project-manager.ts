/**
 * Atlas Desktop - Project Manager
 * Project lifecycle, milestone tracking, and deliverable management
 *
 * @module business/projects/project-manager
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';
import { createModuleLogger } from '../../utils/logger';
import {
  Project,
  ProjectStatus,
  Milestone,
  MilestoneStatus,
} from '../types';

const logger = createModuleLogger('ProjectManager');

/**
 * Project Manager Events
 */
export interface ProjectManagerEvents {
  'project-created': (project: Project) => void;
  'project-updated': (project: Project) => void;
  'project-status-changed': (project: Project, oldStatus: ProjectStatus) => void;
  'milestone-created': (milestone: Milestone) => void;
  'milestone-completed': (milestone: Milestone) => void;
  'deadline-approaching': (project: Project, daysUntil: number) => void;
}

/**
 * Project search filters
 */
export interface ProjectSearchFilters {
  status?: ProjectStatus[];
  clientId?: string;
  tags?: string[];
  hasOverdueMilestones?: boolean;
  searchText?: string;
}

/**
 * Project Manager
 * Handles all project-related operations for AtlasAgency
 */
export class ProjectManager extends EventEmitter {
  private projects: Map<string, Project> = new Map();
  private milestones: Map<string, Milestone[]> = new Map();
  private dataDir: string;
  private initialized = false;

  constructor() {
    super();
    this.dataDir = path.join(homedir(), '.atlas', 'business');
  }

  /**
   * Initialize the project manager
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      await fs.mkdir(this.dataDir, { recursive: true });
      await this.loadData();
      this.initialized = true;
      logger.info('ProjectManager initialized', { projectCount: this.projects.size });
    } catch (error) {
      logger.error('Failed to initialize ProjectManager', { error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Load data from disk
   */
  private async loadData(): Promise<void> {
    const projectsPath = path.join(this.dataDir, 'projects.json');
    const milestonesPath = path.join(this.dataDir, 'milestones.json');

    try {
      const projectsData = await fs.readFile(projectsPath, 'utf-8');
      const projects = JSON.parse(projectsData) as Project[];
      for (const project of projects) {
        project.createdAt = new Date(project.createdAt);
        project.updatedAt = new Date(project.updatedAt);
        if (project.startDate) project.startDate = new Date(project.startDate);
        if (project.endDate) project.endDate = new Date(project.endDate);
        if (project.deadline) project.deadline = new Date(project.deadline);
        this.projects.set(project.id, project);
      }
    } catch {
      // File doesn't exist, start fresh
    }

    try {
      const milestonesData = await fs.readFile(milestonesPath, 'utf-8');
      const milestones = JSON.parse(milestonesData) as Milestone[];
      for (const milestone of milestones) {
        if (milestone.dueDate) milestone.dueDate = new Date(milestone.dueDate);
        if (milestone.completedAt) milestone.completedAt = new Date(milestone.completedAt);
        const list = this.milestones.get(milestone.projectId) || [];
        list.push(milestone);
        this.milestones.set(milestone.projectId, list);
      }
    } catch {
      // File doesn't exist, start fresh
    }
  }

  /**
   * Save data to disk
   */
  private async saveData(): Promise<void> {
    const projectsPath = path.join(this.dataDir, 'projects.json');
    const milestonesPath = path.join(this.dataDir, 'milestones.json');

    await fs.writeFile(projectsPath, JSON.stringify([...this.projects.values()], null, 2));
    
    const allMilestones: Milestone[] = [];
    for (const list of this.milestones.values()) {
      allMilestones.push(...list);
    }
    await fs.writeFile(milestonesPath, JSON.stringify(allMilestones, null, 2));
  }

  // ============================================================
  // Project CRUD
  // ============================================================

  /**
   * Create a new project
   */
  async createProject(data: {
    name: string;
    clientId: string;
    description?: string;
    type: Project['type'];
    pricing: Project['pricing'];
    budget?: number;
    hourlyRate?: number;
    deadline?: Date;
    tags?: string[];
  }): Promise<Project> {
    const project: Project = {
      id: randomUUID(),
      clientId: data.clientId,
      name: data.name,
      description: data.description || '',
      type: data.type,
      status: 'planning',
      pricing: data.pricing,
      budget: data.budget || 0,
      hourlyRate: data.hourlyRate,
      hoursLogged: 0,
      hoursEstimated: 0,
      amountInvoiced: 0,
      amountPaid: 0,
      startDate: undefined,
      endDate: undefined,
      deadline: data.deadline,
      completionPercentage: 0,
      tags: data.tags || [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.projects.set(project.id, project);
    await this.saveData();

    this.emit('project-created', project);
    logger.info('Project created', { projectId: project.id, name: project.name });

    return project;
  }

  /**
   * Get a project by ID
   */
  getProject(projectId: string): Project | undefined {
    return this.projects.get(projectId);
  }

  /**
   * Get projects for a client
   */
  getClientProjects(clientId: string): Project[] {
    return [...this.projects.values()].filter(p => p.clientId === clientId);
  }

  /**
   * Get all projects
   */
  getAllProjects(): Project[] {
    return [...this.projects.values()];
  }

  /**
   * Search projects with filters
   */
  searchProjects(filters: ProjectSearchFilters): Project[] {
    let results = [...this.projects.values()];

    if (filters.status && filters.status.length > 0) {
      results = results.filter(p => filters.status!.includes(p.status));
    }

    if (filters.clientId) {
      results = results.filter(p => p.clientId === filters.clientId);
    }

    if (filters.tags && filters.tags.length > 0) {
      results = results.filter(p => 
        filters.tags!.some(tag => p.tags.includes(tag))
      );
    }

    if (filters.hasOverdueMilestones) {
      const now = new Date();
      results = results.filter(p => {
        const milestones = this.milestones.get(p.id) || [];
        return milestones.some(m => 
          m.status !== 'completed' && 
          m.dueDate && 
          new Date(m.dueDate) < now
        );
      });
    }

    if (filters.searchText) {
      const search = filters.searchText.toLowerCase();
      results = results.filter(p =>
        p.name.toLowerCase().includes(search) ||
        p.description.toLowerCase().includes(search)
      );
    }

    return results;
  }

  /**
   * Update a project
   */
  async updateProject(projectId: string, updates: Partial<Omit<Project, 'id' | 'createdAt'>>): Promise<Project | undefined> {
    const project = this.projects.get(projectId);
    if (!project) return undefined;

    const oldStatus = project.status;
    const updatedProject: Project = {
      ...project,
      ...updates,
      updatedAt: new Date(),
    };

    this.projects.set(projectId, updatedProject);
    await this.saveData();

    this.emit('project-updated', updatedProject);
    
    if (updates.status && updates.status !== oldStatus) {
      this.emit('project-status-changed', updatedProject, oldStatus);
    }

    logger.info('Project updated', { projectId });

    return updatedProject;
  }

  /**
   * Update project status
   */
  async updateProjectStatus(projectId: string, status: ProjectStatus): Promise<Project | undefined> {
    const project = this.projects.get(projectId);
    if (!project) return undefined;

    const updates: Partial<Project> = { status };

    // Handle status-specific updates
    if (status === 'in_progress' && !project.startDate) {
      updates.startDate = new Date();
    }

    if (status === 'completed' || status === 'cancelled') {
      updates.endDate = new Date();
      if (status === 'completed') {
        updates.completionPercentage = 100;
      }
    }

    return this.updateProject(projectId, updates);
  }

  /**
   * Delete a project
   */
  async deleteProject(projectId: string): Promise<boolean> {
    const deleted = this.projects.delete(projectId);
    if (deleted) {
      this.milestones.delete(projectId);
      await this.saveData();
      logger.info('Project deleted', { projectId });
    }
    return deleted;
  }

  // ============================================================
  // Milestone Management
  // ============================================================

  /**
   * Add a milestone to a project
   */
  async addMilestone(data: {
    projectId: string;
    name: string;
    description?: string;
    dueDate?: Date;
    deliverables?: string[];
    amount?: number;
  }): Promise<Milestone | undefined> {
    const project = this.projects.get(data.projectId);
    if (!project) return undefined;

    const milestone: Milestone = {
      id: randomUUID(),
      projectId: data.projectId,
      name: data.name,
      description: data.description,
      status: 'pending',
      dueDate: data.dueDate,
      completedAt: undefined,
      deliverables: data.deliverables || [],
      amount: data.amount,
    };

    const list = this.milestones.get(data.projectId) || [];
    list.push(milestone);
    this.milestones.set(data.projectId, list);

    await this.saveData();

    this.emit('milestone-created', milestone);
    logger.info('Milestone created', { projectId: data.projectId, milestoneId: milestone.id });

    return milestone;
  }

  /**
   * Get milestones for a project
   */
  getProjectMilestones(projectId: string): Milestone[] {
    return this.milestones.get(projectId) || [];
  }

  /**
   * Update a milestone
   */
  async updateMilestone(milestoneId: string, updates: Partial<Omit<Milestone, 'id' | 'projectId'>>): Promise<Milestone | undefined> {
    for (const [projectId, list] of this.milestones) {
      const index = list.findIndex(m => m.id === milestoneId);
      if (index !== -1) {
        const milestone = { ...list[index], ...updates };
        list[index] = milestone;
        await this.saveData();

        if (updates.status === 'completed') {
          milestone.completedAt = new Date();
          this.emit('milestone-completed', milestone);
          await this.updateProjectCompletion(projectId);
        }

        return milestone;
      }
    }
    return undefined;
  }

  /**
   * Complete a milestone
   */
  async completeMilestone(milestoneId: string): Promise<Milestone | undefined> {
    return this.updateMilestone(milestoneId, { 
      status: 'completed',
      completedAt: new Date(),
    });
  }

  /**
   * Update project completion percentage based on milestones
   */
  private async updateProjectCompletion(projectId: string): Promise<void> {
    const project = this.projects.get(projectId);
    const milestones = this.milestones.get(projectId);
    
    if (!project || !milestones || milestones.length === 0) return;

    const completed = milestones.filter(m => m.status === 'completed').length;
    const percentage = Math.round((completed / milestones.length) * 100);

    await this.updateProject(projectId, { completionPercentage: percentage });
  }

  // ============================================================
  // Time & Financial Tracking
  // ============================================================

  /**
   * Add hours to a project
   */
  async addHours(projectId: string, hours: number): Promise<void> {
    const project = this.projects.get(projectId);
    if (!project) return;

    project.hoursLogged += hours;
    project.updatedAt = new Date();
    await this.saveData();

    logger.info('Hours added to project', { projectId, hours, totalHours: project.hoursLogged });
  }

  /**
   * Record amount invoiced
   */
  async recordInvoiced(projectId: string, amount: number): Promise<void> {
    const project = this.projects.get(projectId);
    if (!project) return;

    project.amountInvoiced += amount;
    project.updatedAt = new Date();
    await this.saveData();
  }

  /**
   * Record amount paid
   */
  async recordPaid(projectId: string, amount: number): Promise<void> {
    const project = this.projects.get(projectId);
    if (!project) return;

    project.amountPaid += amount;
    project.updatedAt = new Date();
    await this.saveData();
  }

  // ============================================================
  // Deadlines & Warnings
  // ============================================================

  /**
   * Get projects with approaching deadlines
   */
  getProjectsWithApproachingDeadlines(daysAhead: number = 7): Array<{ project: Project; daysUntil: number }> {
    const results: Array<{ project: Project; daysUntil: number }> = [];
    const now = new Date();

    for (const project of this.projects.values()) {
      if (
        project.deadline &&
        project.status !== 'completed' &&
        project.status !== 'cancelled'
      ) {
        const deadline = new Date(project.deadline);
        const daysUntil = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        
        if (daysUntil <= daysAhead && daysUntil >= 0) {
          results.push({ project, daysUntil });
        }
      }
    }

    return results.sort((a, b) => a.daysUntil - b.daysUntil);
  }

  /**
   * Get overdue projects
   */
  getOverdueProjects(): Project[] {
    const now = new Date();
    return [...this.projects.values()].filter(p =>
      p.deadline &&
      p.status !== 'completed' &&
      p.status !== 'cancelled' &&
      new Date(p.deadline) < now
    );
  }

  /**
   * Get overdue milestones
   */
  getOverdueMilestones(): Array<{ milestone: Milestone; project: Project }> {
    const results: Array<{ milestone: Milestone; project: Project }> = [];
    const now = new Date();

    for (const [projectId, milestones] of this.milestones) {
      const project = this.projects.get(projectId);
      if (!project) continue;

      for (const milestone of milestones) {
        if (
          milestone.dueDate &&
          milestone.status !== 'completed' &&
          new Date(milestone.dueDate) < now
        ) {
          results.push({ milestone, project });
        }
      }
    }

    return results;
  }

  // ============================================================
  // Statistics
  // ============================================================

  /**
   * Get project statistics
   */
  getStats(): {
    total: number;
    byStatus: Record<ProjectStatus, number>;
    totalHours: number;
    totalBudget: number;
    totalInvoiced: number;
    totalPaid: number;
    activeProjects: number;
  } {
    const byStatus: Record<ProjectStatus, number> = {
      planning: 0,
      in_progress: 0,
      on_hold: 0,
      completed: 0,
      cancelled: 0,
    };
    let totalHours = 0;
    let totalBudget = 0;
    let totalInvoiced = 0;
    let totalPaid = 0;

    for (const project of this.projects.values()) {
      byStatus[project.status]++;
      totalHours += project.hoursLogged;
      totalBudget += project.budget;
      totalInvoiced += project.amountInvoiced;
      totalPaid += project.amountPaid;
    }

    return {
      total: this.projects.size,
      byStatus,
      totalHours,
      totalBudget,
      totalInvoiced,
      totalPaid,
      activeProjects: byStatus.in_progress + byStatus.planning,
    };
  }
}

// Singleton instance
let instance: ProjectManager | null = null;

/**
 * Get the singleton Project Manager instance
 */
export function getProjectManager(): ProjectManager {
  if (!instance) {
    instance = new ProjectManager();
  }
  return instance;
}

/**
 * Initialize the Project Manager (call on app startup)
 */
export async function initializeProjectManager(): Promise<ProjectManager> {
  const manager = getProjectManager();
  await manager.initialize();
  return manager;
}
