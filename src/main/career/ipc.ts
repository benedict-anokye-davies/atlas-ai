/**
 * Career Module - IPC Handlers
 *
 * Connects the career module to the renderer process for UI integration.
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { getCareerProfileManager } from './career-profile-manager';
import { getSkillsGapAnalyzer } from './skills-gap-analyzer';
import { getJobSearchEngine } from './job-search-engine';
import { getCVOptimizer } from './cv-optimizer';
import { getApplicationTracker } from './application-tracker';
import { getInterviewPrepManager } from './interview-prep';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('CareerIPC');

// ============================================================================
// IPC Result Type
// ============================================================================

interface IPCResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// ============================================================================
// Profile Handlers
// ============================================================================

ipcMain.handle('career:profile:get', async (): Promise<IPCResult> => {
  try {
    const manager = getCareerProfileManager();
    await manager.initialize();
    const profile = manager.getProfile();

    if (!profile) {
      return { success: false, error: 'No profile found' };
    }

    return { success: true, data: profile };
  } catch (error: any) {
    logger.error('Failed to get profile', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle(
  'career:profile:create',
  async (_event: IpcMainInvokeEvent, profileData: any): Promise<IPCResult> => {
    try {
      const manager = getCareerProfileManager();
      await manager.initialize();
      const profile = await manager.createProfile(profileData);
      return { success: true, data: profile };
    } catch (error: any) {
      logger.error('Failed to create profile', error);
      return { success: false, error: error.message };
    }
  }
);

ipcMain.handle(
  'career:profile:update',
  async (_event: IpcMainInvokeEvent, updates: any): Promise<IPCResult> => {
    try {
      const manager = getCareerProfileManager();
      await manager.initialize();
      await manager.updateProfile(updates);
      return { success: true };
    } catch (error: any) {
      logger.error('Failed to update profile', error);
      return { success: false, error: error.message };
    }
  }
);

ipcMain.handle(
  'career:profile:add-skill',
  async (_event: IpcMainInvokeEvent, skill: any): Promise<IPCResult> => {
    try {
      const manager = getCareerProfileManager();
      await manager.initialize();
      await manager.addTechnicalSkill(skill);
      return { success: true };
    } catch (error: any) {
      logger.error('Failed to add skill', error);
      return { success: false, error: error.message };
    }
  }
);

ipcMain.handle(
  'career:profile:set-goals',
  async (_event: IpcMainInvokeEvent, goals: any): Promise<IPCResult> => {
    try {
      const manager = getCareerProfileManager();
      await manager.initialize();
      await manager.setCareerGoals(goals);
      return { success: true };
    } catch (error: any) {
      logger.error('Failed to set goals', error);
      return { success: false, error: error.message };
    }
  }
);

ipcMain.handle(
  'career:profile:add-dream-company',
  async (_event: IpcMainInvokeEvent, company: any): Promise<IPCResult> => {
    try {
      const manager = getCareerProfileManager();
      await manager.initialize();
      await manager.addDreamCompany(company);
      return { success: true };
    } catch (error: any) {
      logger.error('Failed to add dream company', error);
      return { success: false, error: error.message };
    }
  }
);

ipcMain.handle('career:profile:completeness', async (): Promise<IPCResult> => {
  try {
    const manager = getCareerProfileManager();
    await manager.initialize();
    const analysis = manager.analyzeProfileCompleteness();
    return { success: true, data: analysis };
  } catch (error: any) {
    logger.error('Failed to analyze completeness', error);
    return { success: false, error: error.message };
  }
});

// ============================================================================
// Skills Gap Handlers
// ============================================================================

ipcMain.handle(
  'career:skills-gap:analyze',
  async (
    _event: IpcMainInvokeEvent,
    targetCompany: string,
    targetRole?: string
  ): Promise<IPCResult> => {
    try {
      const analyzer = getSkillsGapAnalyzer();
      const analysis = await analyzer.analyzeGapForCompany(targetCompany, targetRole);
      return { success: true, data: analysis };
    } catch (error: any) {
      logger.error('Failed to analyze skills gap', error);
      return { success: false, error: error.message };
    }
  }
);

ipcMain.handle(
  'career:skills-gap:company-profile',
  async (_event: IpcMainInvokeEvent, company: string): Promise<IPCResult> => {
    try {
      const analyzer = getSkillsGapAnalyzer();
      const profile = analyzer.getEliteCompanyProfile(company);

      if (!profile) {
        return { success: false, error: `No profile for ${company}` };
      }

      return { success: true, data: profile };
    } catch (error: any) {
      logger.error('Failed to get company profile', error);
      return { success: false, error: error.message };
    }
  }
);

ipcMain.handle('career:skills-gap:available-companies', async (): Promise<IPCResult> => {
  try {
    const analyzer = getSkillsGapAnalyzer();
    const companies = analyzer.getAvailableCompanies();
    return { success: true, data: companies };
  } catch (error: any) {
    logger.error('Failed to get available companies', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle(
  'career:skills-gap:roadmap',
  async (
    _event: IpcMainInvokeEvent,
    targetCompany: string,
    targetRole?: string
  ): Promise<IPCResult> => {
    try {
      const analyzer = getSkillsGapAnalyzer();
      const roadmap = await analyzer.buildLearningRoadmap(targetCompany, targetRole);
      return { success: true, data: roadmap };
    } catch (error: any) {
      logger.error('Failed to build roadmap', error);
      return { success: false, error: error.message };
    }
  }
);

// ============================================================================
// Job Search Handlers
// ============================================================================

ipcMain.handle(
  'career:jobs:search',
  async (_event: IpcMainInvokeEvent, query: any): Promise<IPCResult> => {
    try {
      const engine = getJobSearchEngine();
      const results = await engine.search(query);
      return { success: true, data: results };
    } catch (error: any) {
      logger.error('Failed to search jobs', error);
      return { success: false, error: error.message };
    }
  }
);

ipcMain.handle(
  'career:jobs:search-remote',
  async (_event: IpcMainInvokeEvent, keywords: string[]): Promise<IPCResult> => {
    try {
      const engine = getJobSearchEngine();
      const results = await engine.searchRemoteJobs(keywords);
      return { success: true, data: results };
    } catch (error: any) {
      logger.error('Failed to search remote jobs', error);
      return { success: false, error: error.message };
    }
  }
);

ipcMain.handle(
  'career:jobs:search-freelance',
  async (_event: IpcMainInvokeEvent, keywords: string[]): Promise<IPCResult> => {
    try {
      const engine = getJobSearchEngine();
      const results = await engine.searchFreelanceJobs(keywords);
      return { success: true, data: results };
    } catch (error: any) {
      logger.error('Failed to search freelance jobs', error);
      return { success: false, error: error.message };
    }
  }
);

ipcMain.handle('career:jobs:recommendations', async (): Promise<IPCResult> => {
  try {
    const engine = getJobSearchEngine();
    const jobs = await engine.getRecommendations();
    return { success: true, data: jobs };
  } catch (error: any) {
    logger.error('Failed to get recommendations', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle(
  'career:jobs:save',
  async (_event: IpcMainInvokeEvent, job: any): Promise<IPCResult> => {
    try {
      const engine = getJobSearchEngine();
      await engine.saveJob(job);
      return { success: true };
    } catch (error: any) {
      logger.error('Failed to save job', error);
      return { success: false, error: error.message };
    }
  }
);

ipcMain.handle('career:jobs:saved', async (): Promise<IPCResult> => {
  try {
    const engine = getJobSearchEngine();
    const jobs = engine.getSavedJobs();
    return { success: true, data: jobs };
  } catch (error: any) {
    logger.error('Failed to get saved jobs', error);
    return { success: false, error: error.message };
  }
});

// ============================================================================
// CV Handlers
// ============================================================================

ipcMain.handle(
  'career:cv:analyze',
  async (
    _event: IpcMainInvokeEvent,
    cvContent: string,
    targetRole?: string
  ): Promise<IPCResult> => {
    try {
      const optimizer = getCVOptimizer();
      const analysis = await optimizer.analyzeCV(cvContent, targetRole);
      return { success: true, data: analysis };
    } catch (error: any) {
      logger.error('Failed to analyze CV', error);
      return { success: false, error: error.message };
    }
  }
);

ipcMain.handle(
  'career:cv:tailor-for-job',
  async (
    _event: IpcMainInvokeEvent,
    cvContent: string,
    job: any
  ): Promise<IPCResult> => {
    try {
      const optimizer = getCVOptimizer();
      const tailored = await optimizer.tailorCVForJob(cvContent, job);
      return { success: true, data: tailored };
    } catch (error: any) {
      logger.error('Failed to tailor CV', error);
      return { success: false, error: error.message };
    }
  }
);

ipcMain.handle(
  'career:cv:tailor-for-company',
  async (
    _event: IpcMainInvokeEvent,
    cvContent: string,
    company: string,
    role?: string
  ): Promise<IPCResult> => {
    try {
      const optimizer = getCVOptimizer();
      const tailored = await optimizer.tailorCVForCompany(cvContent, company, role || 'Software Engineer');
      return { success: true, data: tailored };
    } catch (error: any) {
      logger.error('Failed to tailor CV for company', error);
      return { success: false, error: error.message };
    }
  }
);

ipcMain.handle(
  'career:cv:generate',
  async (_event: IpcMainInvokeEvent, template?: string): Promise<IPCResult> => {
    try {
      const optimizer = getCVOptimizer();
      const validTemplate = (['modern', 'traditional', 'creative', 'faang'].includes(template || '') 
        ? template 
        : 'modern') as 'modern' | 'traditional' | 'creative' | 'faang';
      const cv = await optimizer.generateCVFromProfile(validTemplate);
      return { success: true, data: cv };
    } catch (error: any) {
      logger.error('Failed to generate CV', error);
      return { success: false, error: error.message };
    }
  }
);

ipcMain.handle('career:cv:versions', async (): Promise<IPCResult> => {
  try {
    const optimizer = getCVOptimizer();
    const versions = optimizer.getCVVersions();
    return { success: true, data: versions };
  } catch (error: any) {
    logger.error('Failed to get CV versions', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle(
  'career:cv:save-version',
  async (
    _event: IpcMainInvokeEvent,
    content: string,
    name: string,
    targetRole?: string
  ): Promise<IPCResult> => {
    try {
      const optimizer = getCVOptimizer();
      const version = await optimizer.saveCVVersion(content, name, targetRole);
      return { success: true, data: version };
    } catch (error: any) {
      logger.error('Failed to save CV version', error);
      return { success: false, error: error.message };
    }
  }
);

// ============================================================================
// Application Tracking Handlers
// ============================================================================

ipcMain.handle(
  'career:applications:create',
  async (
    _event: IpcMainInvokeEvent,
    job: any,
    cvVersionId?: string,
    coverLetter?: string
  ): Promise<IPCResult> => {
    try {
      const tracker = getApplicationTracker();
      await tracker.initialize();
      const application = await tracker.createApplication(job, cvVersionId || 'default', coverLetter);
      return { success: true, data: application };
    } catch (error: any) {
      logger.error('Failed to create application', error);
      return { success: false, error: error.message };
    }
  }
);

ipcMain.handle(
  'career:applications:update-status',
  async (
    _event: IpcMainInvokeEvent,
    applicationId: string,
    status: string,
    notes?: string
  ): Promise<IPCResult> => {
    try {
      const tracker = getApplicationTracker();
      await tracker.initialize();
      await tracker.updateStatus(applicationId, status as any, notes);
      return { success: true };
    } catch (error: any) {
      logger.error('Failed to update application status', error);
      return { success: false, error: error.message };
    }
  }
);

ipcMain.handle(
  'career:applications:get',
  async (_event: IpcMainInvokeEvent, applicationId: string): Promise<IPCResult> => {
    try {
      const tracker = getApplicationTracker();
      await tracker.initialize();
      const application = tracker.getApplication(applicationId);

      if (!application) {
        return { success: false, error: 'Application not found' };
      }

      return { success: true, data: application };
    } catch (error: any) {
      logger.error('Failed to get application', error);
      return { success: false, error: error.message };
    }
  }
);

ipcMain.handle('career:applications:list', async (): Promise<IPCResult> => {
  try {
    const tracker = getApplicationTracker();
    await tracker.initialize();
    const applications = tracker.getActiveApplications();
    return { success: true, data: applications };
  } catch (error: any) {
    logger.error('Failed to list applications', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle(
  'career:applications:by-status',
  async (_event: IpcMainInvokeEvent, status: string): Promise<IPCResult> => {
    try {
      const tracker = getApplicationTracker();
      await tracker.initialize();
      const applications = tracker.getApplicationsByStatus(status as any);
      return { success: true, data: applications };
    } catch (error: any) {
      logger.error('Failed to get applications by status', error);
      return { success: false, error: error.message };
    }
  }
);

ipcMain.handle('career:applications:analytics', async (): Promise<IPCResult> => {
  try {
    const tracker = getApplicationTracker();
    await tracker.initialize();
    const analytics = tracker.getApplicationAnalytics();
    return { success: true, data: analytics };
  } catch (error: any) {
    logger.error('Failed to get analytics', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle(
  'career:applications:schedule-interview',
  async (
    _event: IpcMainInvokeEvent,
    applicationId: string,
    interview: any
  ): Promise<IPCResult> => {
    try {
      const tracker = getApplicationTracker();
      await tracker.initialize();
      const scheduled = await tracker.scheduleInterview(applicationId, interview);
      return { success: true, data: scheduled };
    } catch (error: any) {
      logger.error('Failed to schedule interview', error);
      return { success: false, error: error.message };
    }
  }
);

ipcMain.handle('career:applications:upcoming-interviews', async (): Promise<IPCResult> => {
  try {
    const tracker = getApplicationTracker();
    await tracker.initialize();
    const interviews = tracker.getUpcomingInterviews();
    return { success: true, data: interviews };
  } catch (error: any) {
    logger.error('Failed to get upcoming interviews', error);
    return { success: false, error: error.message };
  }
});

// ============================================================================
// Interview Prep Handlers
// ============================================================================

ipcMain.handle(
  'career:interview:generate-prep',
  async (
    _event: IpcMainInvokeEvent,
    company: string,
    role: string,
    interviewDate?: number
  ): Promise<IPCResult> => {
    try {
      const prepManager = getInterviewPrepManager();
      const plan = await prepManager.generatePrepPlan(company, role, interviewDate);
      return { success: true, data: plan };
    } catch (error: any) {
      logger.error('Failed to generate prep plan', error);
      return { success: false, error: error.message };
    }
  }
);

ipcMain.handle(
  'career:interview:mock-questions',
  async (
    _event: IpcMainInvokeEvent,
    type: 'technical' | 'behavioral' | 'system-design',
    count?: number
  ): Promise<IPCResult> => {
    try {
      const prepManager = getInterviewPrepManager();
      const questions = await prepManager.generateMockInterviewQuestions(type, count || 5);
      return { success: true, data: questions };
    } catch (error: any) {
      logger.error('Failed to generate mock questions', error);
      return { success: false, error: error.message };
    }
  }
);

ipcMain.handle(
  'career:interview:add-star-story',
  async (_event: IpcMainInvokeEvent, story: any): Promise<IPCResult> => {
    try {
      const prepManager = getInterviewPrepManager();
      const saved = await prepManager.addSTARStory(story);
      return { success: true, data: saved };
    } catch (error: any) {
      logger.error('Failed to add STAR story', error);
      return { success: false, error: error.message };
    }
  }
);

ipcMain.handle('career:interview:star-stories', async (): Promise<IPCResult> => {
  try {
    const prepManager = getInterviewPrepManager();
    const stories = prepManager.getSTARStories();
    return { success: true, data: stories };
  } catch (error: any) {
    logger.error('Failed to get STAR stories', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle(
  'career:interview:record-practice',
  async (
    _event: IpcMainInvokeEvent,
    questionId: string,
    response: string,
    rating: number
  ): Promise<IPCResult> => {
    try {
      const prepManager = getInterviewPrepManager();
      await prepManager.recordPracticeSession(questionId, response, rating);
      return { success: true };
    } catch (error: any) {
      logger.error('Failed to record practice session', error);
      return { success: false, error: error.message };
    }
  }
);

ipcMain.handle('career:interview:practice-stats', async (): Promise<IPCResult> => {
  try {
    const prepManager = getInterviewPrepManager();
    const stats = prepManager.getPracticeStats();
    return { success: true, data: stats };
  } catch (error: any) {
    logger.error('Failed to get practice stats', error);
    return { success: false, error: error.message };
  }
});

// ============================================================================
// Export Initialization Function
// ============================================================================

export function registerCareerIPCHandlers(): void {
  logger.info('Career IPC handlers registered');
}

export default registerCareerIPCHandlers;
