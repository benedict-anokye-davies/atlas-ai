/**
 * Career Module - Main Entry Point
 *
 * Comprehensive career management system for Atlas including:
 * - Career profile management
 * - Skills gap analysis for elite companies (Palantir, Google, Stripe)
 * - Multi-platform job search (remote, freelance, full-time)
 * - CV/resume optimization and ATS scoring
 * - Job application tracking
 * - Interview preparation
 */

import { EventEmitter } from 'events';
import { app } from 'electron';
import path from 'path';
import { createModuleLogger } from '../utils/logger';

// Import all career modules
import { getCareerProfileManager, CareerProfileManager } from './career-profile-manager';
import { getSkillsGapAnalyzer, SkillsGapAnalyzer } from './skills-gap-analyzer';
import { getJobSearchEngine, JobSearchEngine } from './job-search-engine';
import { getCVOptimizer, CVOptimizer } from './cv-optimizer';
import { getApplicationTracker, ApplicationTracker } from './application-tracker';
import { getInterviewPrepManager, InterviewPrepManager } from './interview-prep';
import { getCareerTools, CareerTool } from './tools';
import { registerCareerIPCHandlers } from './ipc';

// Export types
export * from './types';

// Export individual modules
export {
  getCareerProfileManager,
  CareerProfileManager,
  getSkillsGapAnalyzer,
  SkillsGapAnalyzer,
  getJobSearchEngine,
  JobSearchEngine,
  getCVOptimizer,
  CVOptimizer,
  getApplicationTracker,
  ApplicationTracker,
  getInterviewPrepManager,
  InterviewPrepManager,
  getCareerTools,
  CareerTool,
  registerCareerIPCHandlers,
};

const logger = createModuleLogger('CareerModule');

// ============================================================================
// Career Module Class
// ============================================================================

export interface CareerModuleStatus {
  initialized: boolean;
  profileLoaded: boolean;
  modulesReady: {
    profile: boolean;
    skillsGap: boolean;
    jobSearch: boolean;
    cvOptimizer: boolean;
    applicationTracker: boolean;
    interviewPrep: boolean;
  };
  stats: {
    skillCount: number;
    savedJobsCount: number;
    activeApplications: number;
    upcomingInterviews: number;
    cvVersions: number;
    starStories: number;
  };
}

export class CareerModule extends EventEmitter {
  private initialized = false;
  private dataDir: string;

  // Module instances
  private profileManager: CareerProfileManager | null = null;
  private skillsAnalyzer: SkillsGapAnalyzer | null = null;
  private jobEngine: JobSearchEngine | null = null;
  private cvOptimizer: CVOptimizer | null = null;
  private appTracker: ApplicationTracker | null = null;
  private interviewPrep: InterviewPrepManager | null = null;

  constructor() {
    super();
    this.dataDir = path.join(app.getPath('userData'), 'career');
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    logger.info('Initializing Career Module...');

    try {
      // Initialize all modules
      this.profileManager = getCareerProfileManager();
      await this.profileManager.initialize();

      this.skillsAnalyzer = getSkillsGapAnalyzer();
      this.jobEngine = getJobSearchEngine();

      this.cvOptimizer = getCVOptimizer();

      this.appTracker = getApplicationTracker();
      await this.appTracker.initialize();

      this.interviewPrep = getInterviewPrepManager();

      // Register IPC handlers
      registerCareerIPCHandlers();

      // Set up event forwarding
      this.setupEventForwarding();

      this.initialized = true;
      logger.info('Career Module initialized successfully');
      this.emit('initialized');
    } catch (error) {
      logger.error('Failed to initialize Career Module', error as Record<string, unknown>);
      throw error;
    }
  }

  private setupEventForwarding(): void {
    // Forward events from sub-modules
    if (this.profileManager) {
      this.profileManager.on('profile-updated', (profile) => {
        this.emit('profile-updated', profile);
      });
    }

    if (this.jobEngine) {
      this.jobEngine.on('job-saved', (job) => {
        this.emit('job-saved', job);
      });
    }

    if (this.appTracker) {
      this.appTracker.on('application-created', (app) => {
        this.emit('application-created', app);
      });
      this.appTracker.on('status-updated', (app, oldStatus, newStatus) => {
        this.emit('application-status-changed', app, oldStatus, newStatus);
      });
      this.appTracker.on('interview-scheduled', (app, interview) => {
        this.emit('interview-scheduled', app, interview);
      });
    }
  }

  // ==========================================================================
  // Quick Access Methods
  // ==========================================================================

  /**
   * Get module status and statistics
   */
  getStatus(): CareerModuleStatus {
    const profile = this.profileManager?.getProfile();

    return {
      initialized: this.initialized,
      profileLoaded: !!profile,
      modulesReady: {
        profile: !!this.profileManager,
        skillsGap: !!this.skillsAnalyzer,
        jobSearch: !!this.jobEngine,
        cvOptimizer: !!this.cvOptimizer,
        applicationTracker: !!this.appTracker,
        interviewPrep: !!this.interviewPrep,
      },
      stats: {
        skillCount: profile?.skills.technical.length || 0,
        savedJobsCount: this.jobEngine?.getSavedJobs().length || 0,
        activeApplications: this.appTracker?.getActiveApplications().length || 0,
        upcomingInterviews: this.appTracker?.getUpcomingInterviews().length || 0,
        cvVersions: this.cvOptimizer?.getCVVersions().length || 0,
        starStories: this.interviewPrep?.getSTARStories().length || 0,
      },
    };
  }

  /**
   * Get all LLM-callable career tools
   */
  getTools(): CareerTool[] {
    return getCareerTools();
  }

  // ==========================================================================
  // High-Level Career Operations
  // ==========================================================================

  /**
   * Analyze readiness for a dream company
   */
  async analyzeCompanyReadiness(
    companyName: string,
    targetRole?: string
  ): Promise<{
    readiness: number;
    gaps: string[];
    strengths: string[];
    roadmap: string[];
    estimatedTime: string;
  }> {
    if (!this.initialized) {
      await this.initialize();
    }

    const analysis = await this.skillsAnalyzer!.analyzeGapForCompany(companyName, targetRole);

    return {
      readiness: analysis.overallReadiness,
      gaps: analysis.gapSkills,
      strengths: analysis.matchedSkills,
      roadmap: analysis.prioritySkillsToLearn.slice(0, 5).map(
        (s) => `Learn ${s.skill} (${s.estimatedTime})`
      ),
      estimatedTime: analysis.estimatedTimeToReadiness,
    };
  }

  /**
   * Get personalized job recommendations
   */
  async getJobRecommendations(options?: {
    remote?: boolean;
    freelance?: boolean;
    limit?: number;
  }): Promise<any[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    let jobs = await this.jobEngine!.getRecommendations();

    if (options?.remote) {
      jobs = jobs.filter((j) => j.remote);
    }

    if (options?.freelance) {
      jobs = jobs.filter((j) => j.type === 'freelance' || j.type === 'contract');
    }

    return jobs.slice(0, options?.limit || 10);
  }

  /**
   * Get career dashboard summary
   */
  async getDashboardSummary(): Promise<{
    profile: {
      name: string;
      currentRole?: string;
      topSkills: string[];
      dreamCompanies: string[];
    };
    jobSearch: {
      savedJobs: number;
      recommendations: number;
    };
    applications: {
      total: number;
      active: number;
      interviews: number;
      responseRate: number;
    };
    readiness: {
      topCompany: string;
      readinessScore: number;
      nextMilestone: string;
    };
  }> {
    if (!this.initialized) {
      await this.initialize();
    }

    const profile = this.profileManager!.getProfile();
    const analytics = this.appTracker!.getApplicationAnalytics();

    let topCompanyReadiness = { company: 'None', score: 0 };
    if (profile?.careerGoals.dreamCompanies.length) {
      const topCompany = profile.careerGoals.dreamCompanies[0].name;
      const analysis = await this.skillsAnalyzer!.analyzeGapForCompany(topCompany);
      topCompanyReadiness = { company: topCompany, score: analysis.overallReadiness };
    }

    return {
      profile: {
        name: profile?.name || 'Not set',
        currentRole: profile?.currentRole,
        topSkills: profile?.skills.technical.slice(0, 5).map((s) => s.name) || [],
        dreamCompanies: profile?.careerGoals.dreamCompanies.map((c) => c.name) || [],
      },
      jobSearch: {
        savedJobs: this.jobEngine!.getSavedJobs().length,
        recommendations: 0, // Will populate on demand
      },
      applications: {
        total: analytics.totalApplications,
        active: this.appTracker!.getActiveApplications().length,
        interviews: this.appTracker!.getUpcomingInterviews().length,
        responseRate: analytics.responseRate,
      },
      readiness: {
        topCompany: topCompanyReadiness.company,
        readinessScore: topCompanyReadiness.score,
        nextMilestone: 'Complete skills assessment',
      },
    };
  }

  /**
   * Generate a complete career action plan
   */
  async generateCareerPlan(): Promise<{
    shortTermActions: string[];
    skillsToLearn: string[];
    jobsToApply: number;
    interviewPrepNeeded: string[];
    estimatedTimeToGoal: string;
  }> {
    if (!this.initialized) {
      await this.initialize();
    }

    const profile = this.profileManager!.getProfile();
    if (!profile) {
      throw new Error('Create a career profile first');
    }

    const shortTermActions: string[] = [];
    const skillsToLearn: string[] = [];
    const interviewPrepNeeded: string[] = [];

    // Analyze gaps for dream companies
    for (const dreamCompany of profile.careerGoals.dreamCompanies.slice(0, 3)) {
      try {
        const analysis = await this.skillsAnalyzer!.analyzeGapForCompany(dreamCompany.name);

        // Add priority skills
        for (const skill of analysis.prioritySkillsToLearn.slice(0, 3)) {
          if (!skillsToLearn.includes(skill.skill)) {
            skillsToLearn.push(skill.skill);
          }
        }
      } catch {
        // Company not in database, skip
      }
    }

    // Generate short-term actions
    if (skillsToLearn.length > 0) {
      shortTermActions.push(`Start learning ${skillsToLearn[0]}`);
    }

    if (this.jobEngine!.getSavedJobs().length === 0) {
      shortTermActions.push('Save 5-10 interesting job listings');
    }

    if (this.interviewPrep!.getSTARStories().length < 5) {
      shortTermActions.push('Write 5 STAR stories for behavioral interviews');
      interviewPrepNeeded.push('STAR stories');
    }

    shortTermActions.push('Apply to 3-5 jobs per week');
    interviewPrepNeeded.push('System design practice', 'Coding challenge practice');

    return {
      shortTermActions,
      skillsToLearn: skillsToLearn.slice(0, 5),
      jobsToApply: 15, // 3-5 per week for 4 weeks
      interviewPrepNeeded,
      estimatedTimeToGoal: '6-12 months',
    };
  }

  // ==========================================================================
  // Module Accessors
  // ==========================================================================

  getProfileManager(): CareerProfileManager {
    if (!this.profileManager) {
      throw new Error('Career module not initialized');
    }
    return this.profileManager;
  }

  getSkillsAnalyzer(): SkillsGapAnalyzer {
    if (!this.skillsAnalyzer) {
      throw new Error('Career module not initialized');
    }
    return this.skillsAnalyzer;
  }

  getJobEngine(): JobSearchEngine {
    if (!this.jobEngine) {
      throw new Error('Career module not initialized');
    }
    return this.jobEngine;
  }

  getCVOptimizer(): CVOptimizer {
    if (!this.cvOptimizer) {
      throw new Error('Career module not initialized');
    }
    return this.cvOptimizer;
  }

  getApplicationTracker(): ApplicationTracker {
    if (!this.appTracker) {
      throw new Error('Career module not initialized');
    }
    return this.appTracker;
  }

  getInterviewPrepManager(): InterviewPrepManager {
    if (!this.interviewPrep) {
      throw new Error('Career module not initialized');
    }
    return this.interviewPrep;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let careerModuleInstance: CareerModule | null = null;

export function getCareerModule(): CareerModule {
  if (!careerModuleInstance) {
    careerModuleInstance = new CareerModule();
  }
  return careerModuleInstance;
}

/**
 * Initialize the career module (call during app startup)
 */
export async function initializeCareerModule(): Promise<CareerModule> {
  const module = getCareerModule();
  await module.initialize();
  return module;
}

export default getCareerModule;
