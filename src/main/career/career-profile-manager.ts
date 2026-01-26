/**
 * Career Profile Manager
 *
 * Manages user's career profile, goals, skills inventory,
 * and work history. Persists to disk with encryption for sensitive data.
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import {
  CareerProfile,
  CareerGoals,
  SkillInventory,
  TechnicalSkill,
  WorkExperience,
  Education,
  Project,
  CVVersion,
  DreamCompany,
  CareerMilestone,
  ProficiencyLevel,
  EmploymentStatus,
  WorkPreferences,
  SalaryExpectations,
} from './types';

const logger = createModuleLogger('CareerProfileManager');

// ============================================================================
// Career Profile Manager
// ============================================================================

export class CareerProfileManager extends EventEmitter {
  private profile: CareerProfile | null = null;
  private dataPath: string;
  private initialized = false;

  constructor() {
    super();
    this.dataPath = path.join(app.getPath('userData'), 'career');
  }

  // --------------------------------------------------------------------------
  // Initialization
  // --------------------------------------------------------------------------

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Ensure directory exists
      if (!fs.existsSync(this.dataPath)) {
        fs.mkdirSync(this.dataPath, { recursive: true });
      }

      // Load existing profile
      await this.loadProfile();
      this.initialized = true;
      logger.info('Career profile manager initialized');
    } catch (error) {
      logger.error('Failed to initialize career profile manager', error as Record<string, unknown>);
      throw error;
    }
  }

  // --------------------------------------------------------------------------
  // Profile Management
  // --------------------------------------------------------------------------

  async loadProfile(): Promise<CareerProfile | null> {
    const profilePath = path.join(this.dataPath, 'profile.json');

    if (!fs.existsSync(profilePath)) {
      logger.info('No existing career profile found');
      return null;
    }

    try {
      const data = fs.readFileSync(profilePath, 'utf-8');
      this.profile = JSON.parse(data);
      logger.info('Loaded career profile');
      return this.profile;
    } catch (error) {
      logger.error('Failed to load career profile', error as Record<string, unknown>);
      return null;
    }
  }

  async saveProfile(): Promise<void> {
    if (!this.profile) return;

    const profilePath = path.join(this.dataPath, 'profile.json');
    this.profile.updatedAt = Date.now();

    try {
      fs.writeFileSync(profilePath, JSON.stringify(this.profile, null, 2));
      this.emit('profile-updated', this.profile);
      logger.info('Saved career profile');
    } catch (error) {
      logger.error('Failed to save career profile', error as Record<string, unknown>);
      throw error;
    }
  }

  getProfile(): CareerProfile | null {
    return this.profile;
  }

  hasProfile(): boolean {
    return this.profile !== null;
  }

  // --------------------------------------------------------------------------
  // Profile Creation & Updates
  // --------------------------------------------------------------------------

  async createProfile(initialData: Partial<CareerProfile>): Promise<CareerProfile> {
    const now = Date.now();

    this.profile = {
      id: `profile_${now}`,
      createdAt: now,
      updatedAt: now,

      // Personal info
      name: initialData.name || '',
      email: initialData.email || '',
      location: initialData.location || '',
      willingToRelocate: initialData.willingToRelocate ?? false,
      preferredLocations: initialData.preferredLocations || [],
      timezone: initialData.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,

      // Current situation
      currentRole: initialData.currentRole,
      currentCompany: initialData.currentCompany,
      yearsOfExperience: initialData.yearsOfExperience || 0,
      employmentStatus: initialData.employmentStatus || 'employed-looking',
      noticePeriod: initialData.noticePeriod,

      // Preferences
      workPreferences: initialData.workPreferences || {
        remotePreference: 'flexible',
        companySize: [],
        industries: [],
        roles: [],
        dealbreakers: [],
        mustHaves: [],
      },
      salaryExpectations: initialData.salaryExpectations || {
        minimum: 0,
        target: 0,
        currency: 'GBP',
        includesEquity: false,
      },

      // Goals
      careerGoals: initialData.careerGoals || {
        shortTerm: '',
        mediumTerm: '',
        longTerm: '',
        dreamCompanies: [],
        targetRoles: [],
        skillsToAcquire: [],
        timeline: {
          targetCompanyReadiness: now + 365 * 24 * 60 * 60 * 1000, // 1 year
          milestones: [],
        },
      },

      // Skills
      skills: initialData.skills || {
        technical: [],
        soft: [],
        tools: [],
        languages: [],
        domains: [],
      },

      // Experience
      workHistory: initialData.workHistory || [],
      education: initialData.education || [],
      certifications: initialData.certifications || [],
      projects: initialData.projects || [],

      // Documents
      cvVersions: initialData.cvVersions || [],
      coverLetterTemplates: initialData.coverLetterTemplates || [],

      // Online presence
      linkedInUrl: initialData.linkedInUrl,
      githubUrl: initialData.githubUrl,
      portfolioUrl: initialData.portfolioUrl,
      personalWebsite: initialData.personalWebsite,
    };

    await this.saveProfile();
    this.emit('profile-created', this.profile);
    logger.info('Created new career profile');

    return this.profile;
  }

  async updateProfile(updates: Partial<CareerProfile>): Promise<CareerProfile> {
    if (!this.profile) {
      throw new Error('No profile exists. Create one first.');
    }

    this.profile = {
      ...this.profile,
      ...updates,
      updatedAt: Date.now(),
    };

    await this.saveProfile();
    return this.profile;
  }

  // --------------------------------------------------------------------------
  // Skills Management
  // --------------------------------------------------------------------------

  async addTechnicalSkill(skill: TechnicalSkill): Promise<void> {
    if (!this.profile) throw new Error('No profile exists');

    // Check if skill already exists
    const existingIndex = this.profile.skills.technical.findIndex(
      (s) => s.name.toLowerCase() === skill.name.toLowerCase()
    );

    if (existingIndex >= 0) {
      // Update existing
      this.profile.skills.technical[existingIndex] = skill;
    } else {
      // Add new
      this.profile.skills.technical.push(skill);
    }

    await this.saveProfile();
    this.emit('skill-added', skill);
  }

  async updateSkillProficiency(
    skillName: string,
    proficiency: ProficiencyLevel
  ): Promise<void> {
    if (!this.profile) throw new Error('No profile exists');

    const skill = this.profile.skills.technical.find(
      (s) => s.name.toLowerCase() === skillName.toLowerCase()
    );

    if (skill) {
      skill.proficiency = proficiency;
      skill.lastUsed = Date.now();
      await this.saveProfile();
      this.emit('skill-updated', skill);
    }
  }

  getSkillsByCategory(category: string): TechnicalSkill[] {
    if (!this.profile) return [];
    return this.profile.skills.technical.filter((s) => s.category === category);
  }

  getTopSkills(limit = 10): TechnicalSkill[] {
    if (!this.profile) return [];

    const proficiencyOrder: Record<ProficiencyLevel, number> = {
      expert: 5,
      advanced: 4,
      intermediate: 3,
      beginner: 2,
      learning: 1,
    };

    return [...this.profile.skills.technical]
      .sort((a, b) => {
        const profDiff = proficiencyOrder[b.proficiency] - proficiencyOrder[a.proficiency];
        if (profDiff !== 0) return profDiff;
        return b.yearsUsed - a.yearsUsed;
      })
      .slice(0, limit);
  }

  // --------------------------------------------------------------------------
  // Work History Management
  // --------------------------------------------------------------------------

  async addWorkExperience(experience: WorkExperience): Promise<void> {
    if (!this.profile) throw new Error('No profile exists');

    this.profile.workHistory.push(experience);
    // Sort by start date, most recent first
    this.profile.workHistory.sort((a, b) => b.startDate - a.startDate);

    await this.saveProfile();
    this.emit('experience-added', experience);
  }

  async updateWorkExperience(id: string, updates: Partial<WorkExperience>): Promise<void> {
    if (!this.profile) throw new Error('No profile exists');

    const index = this.profile.workHistory.findIndex((w) => w.id === id);
    if (index >= 0) {
      this.profile.workHistory[index] = {
        ...this.profile.workHistory[index],
        ...updates,
      };
      await this.saveProfile();
    }
  }

  calculateTotalExperience(): number {
    if (!this.profile) return 0;

    const now = Date.now();
    let totalMonths = 0;

    for (const job of this.profile.workHistory) {
      const endDate = job.endDate || now;
      const months = Math.floor((endDate - job.startDate) / (30 * 24 * 60 * 60 * 1000));
      totalMonths += months;
    }

    return Math.round(totalMonths / 12 * 10) / 10; // Years with 1 decimal
  }

  // --------------------------------------------------------------------------
  // Career Goals Management
  // --------------------------------------------------------------------------

  async setCareerGoals(goals: Partial<CareerGoals>): Promise<void> {
    if (!this.profile) throw new Error('No profile exists');

    this.profile.careerGoals = {
      ...this.profile.careerGoals,
      ...goals,
    };

    await this.saveProfile();
    this.emit('goals-updated', this.profile.careerGoals);
  }

  async addDreamCompany(company: DreamCompany): Promise<void> {
    if (!this.profile) throw new Error('No profile exists');

    // Check if already exists
    const existingIndex = this.profile.careerGoals.dreamCompanies.findIndex(
      (c) => c.name.toLowerCase() === company.name.toLowerCase()
    );

    if (existingIndex >= 0) {
      this.profile.careerGoals.dreamCompanies[existingIndex] = company;
    } else {
      this.profile.careerGoals.dreamCompanies.push(company);
    }

    await this.saveProfile();
    this.emit('dream-company-added', company);
  }

  async addMilestone(milestone: CareerMilestone): Promise<void> {
    if (!this.profile) throw new Error('No profile exists');

    this.profile.careerGoals.timeline.milestones.push(milestone);
    await this.saveProfile();
    this.emit('milestone-added', milestone);
  }

  async completeMilestone(milestoneId: string): Promise<void> {
    if (!this.profile) throw new Error('No profile exists');

    const milestone = this.profile.careerGoals.timeline.milestones.find(
      (m) => m.id === milestoneId
    );

    if (milestone) {
      milestone.status = 'completed';
      milestone.completedDate = Date.now();
      await this.saveProfile();
      this.emit('milestone-completed', milestone);
    }
  }

  getUpcomingMilestones(): CareerMilestone[] {
    if (!this.profile) return [];

    return this.profile.careerGoals.timeline.milestones
      .filter((m) => m.status !== 'completed')
      .sort((a, b) => a.targetDate - b.targetDate);
  }

  // --------------------------------------------------------------------------
  // CV Management
  // --------------------------------------------------------------------------

  async addCVVersion(cv: CVVersion): Promise<void> {
    if (!this.profile) throw new Error('No profile exists');

    this.profile.cvVersions.push(cv);
    await this.saveProfile();
    this.emit('cv-added', cv);
  }

  async updateCVScore(cvId: string, score: number): Promise<void> {
    if (!this.profile) throw new Error('No profile exists');

    const cv = this.profile.cvVersions.find((c) => c.id === cvId);
    if (cv) {
      cv.atsScore = score;
      cv.updatedAt = Date.now();
      await this.saveProfile();
    }
  }

  getCVForRole(targetRole?: string, targetCompany?: string): CVVersion | undefined {
    if (!this.profile) return undefined;

    // Try to find tailored CV first
    if (targetCompany) {
      const companyCV = this.profile.cvVersions.find(
        (cv) => cv.targetCompany?.toLowerCase() === targetCompany.toLowerCase()
      );
      if (companyCV) return companyCV;
    }

    if (targetRole) {
      const roleCV = this.profile.cvVersions.find(
        (cv) => cv.targetRole?.toLowerCase().includes(targetRole.toLowerCase())
      );
      if (roleCV) return roleCV;
    }

    // Return the most recently updated general CV
    return this.profile.cvVersions
      .filter((cv) => !cv.targetCompany)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  }

  // --------------------------------------------------------------------------
  // Projects Management
  // --------------------------------------------------------------------------

  async addProject(project: Project): Promise<void> {
    if (!this.profile) throw new Error('No profile exists');

    this.profile.projects.push(project);
    await this.saveProfile();
    this.emit('project-added', project);

    // Auto-update skills based on project technologies
    for (const tech of project.technologies) {
      const existingSkill = this.profile.skills.technical.find(
        (s) => s.name.toLowerCase() === tech.toLowerCase()
      );

      if (existingSkill) {
        if (!existingSkill.projectsUsed.includes(project.id)) {
          existingSkill.projectsUsed.push(project.id);
          existingSkill.lastUsed = project.endDate || Date.now();
        }
      }
    }

    await this.saveProfile();
  }

  getPortfolioProjects(): Project[] {
    if (!this.profile) return [];

    return this.profile.projects
      .filter((p) => p.isPersonal || p.isOpenSource)
      .sort((a, b) => (b.endDate || Date.now()) - (a.endDate || Date.now()));
  }

  // --------------------------------------------------------------------------
  // Profile Analysis
  // --------------------------------------------------------------------------

  analyzeProfileCompleteness(): {
    score: number;
    missing: string[];
    suggestions: string[];
  } {
    if (!this.profile) {
      return { score: 0, missing: ['No profile created'], suggestions: ['Create a career profile'] };
    }

    const missing: string[] = [];
    const suggestions: string[] = [];
    let totalFields = 0;
    let filledFields = 0;

    // Check basic info
    const basicFields = ['name', 'email', 'location', 'currentRole', 'yearsOfExperience'];
    for (const field of basicFields) {
      totalFields++;
      if (this.profile[field as keyof CareerProfile]) {
        filledFields++;
      } else {
        missing.push(field);
      }
    }

    // Check skills
    totalFields += 3;
    if (this.profile.skills.technical.length >= 5) filledFields++;
    else suggestions.push('Add at least 5 technical skills');

    if (this.profile.skills.soft.length >= 3) filledFields++;
    else suggestions.push('Add at least 3 soft skills');

    if (this.profile.skills.tools.length >= 3) filledFields++;
    else suggestions.push('Add tools you regularly use');

    // Check work history
    totalFields++;
    if (this.profile.workHistory.length > 0) filledFields++;
    else missing.push('workHistory');

    // Check goals
    totalFields += 2;
    if (this.profile.careerGoals.shortTerm) filledFields++;
    else missing.push('shortTerm goal');

    if (this.profile.careerGoals.dreamCompanies.length > 0) filledFields++;
    else suggestions.push('Add your dream companies');

    // Check CV
    totalFields++;
    if (this.profile.cvVersions.length > 0) filledFields++;
    else missing.push('CV');

    // Check online presence
    totalFields += 2;
    if (this.profile.linkedInUrl) filledFields++;
    else suggestions.push('Add your LinkedIn profile');

    if (this.profile.githubUrl) filledFields++;
    else suggestions.push('Add your GitHub profile');

    const score = Math.round((filledFields / totalFields) * 100);

    return { score, missing, suggestions };
  }

  // --------------------------------------------------------------------------
  // Export / Import
  // --------------------------------------------------------------------------

  async exportProfile(): Promise<string> {
    if (!this.profile) throw new Error('No profile to export');
    return JSON.stringify(this.profile, null, 2);
  }

  async importProfile(data: string): Promise<CareerProfile> {
    try {
      const imported = JSON.parse(data) as CareerProfile;
      imported.id = `profile_${Date.now()}`;
      imported.updatedAt = Date.now();

      this.profile = imported;
      await this.saveProfile();

      return this.profile;
    } catch (error) {
      logger.error('Failed to import profile', error as Record<string, unknown>);
      throw new Error('Invalid profile data');
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: CareerProfileManager | null = null;

export function getCareerProfileManager(): CareerProfileManager {
  if (!instance) {
    instance = new CareerProfileManager();
  }
  return instance;
}

export default CareerProfileManager;
