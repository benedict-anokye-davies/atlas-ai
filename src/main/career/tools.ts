/**
 * Career Module - LLM Tools
 *
 * 35+ tools for career management, job search, CV optimization,
 * interview prep, and skills development.
 */

import { getCareerProfileManager } from './career-profile-manager';
import { getSkillsGapAnalyzer } from './skills-gap-analyzer';
import { getJobSearchEngine } from './job-search-engine';
import { getCVOptimizer } from './cv-optimizer';
import { getApplicationTracker } from './application-tracker';
import { getInterviewPrepManager } from './interview-prep';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('CareerTools');

// ============================================================================
// Tool Definitions
// ============================================================================

export interface CareerTool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required: string[];
  };
  handler: (params: any) => Promise<any>;
}

// ============================================================================
// Profile Tools
// ============================================================================

const createCareerProfile: CareerTool = {
  name: 'career_create_profile',
  description: 'Create a new career profile with personal info, skills, and goals. Use this when the user wants to set up their career profile.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Full name' },
      email: { type: 'string', description: 'Email address' },
      location: { type: 'string', description: 'Current location' },
      currentRole: { type: 'string', description: 'Current job title' },
      yearsOfExperience: { type: 'number', description: 'Years of professional experience' },
      targetRoles: { type: 'array', items: { type: 'string' }, description: 'Target job roles' },
      dreamCompanies: { type: 'array', items: { type: 'string' }, description: 'Dream companies to work for' },
      remotePreference: { type: 'string', enum: ['remote-only', 'hybrid', 'office', 'flexible'] },
    },
    required: ['name'],
  },
  handler: async (params) => {
    const manager = getCareerProfileManager();
    await manager.initialize();

    const profile = await manager.createProfile({
      name: params.name,
      email: params.email || '',
      location: params.location || '',
      currentRole: params.currentRole,
      yearsOfExperience: params.yearsOfExperience || 0,
      workPreferences: {
        remotePreference: params.remotePreference || 'flexible',
        companySize: [],
        industries: [],
        roles: params.targetRoles || [],
        dealbreakers: [],
        mustHaves: [],
      },
      careerGoals: {
        shortTerm: '',
        mediumTerm: '',
        longTerm: '',
        dreamCompanies: (params.dreamCompanies || []).map((name: string) => ({
          name,
          whyInterested: '',
          knownRequirements: [],
          currentlyHiring: false,
          difficulty: 'stretch' as const,
        })),
        targetRoles: params.targetRoles || [],
        skillsToAcquire: [],
        timeline: {
          targetCompanyReadiness: Date.now() + 365 * 24 * 60 * 60 * 1000,
          milestones: [],
        },
      },
    });

    return {
      success: true,
      message: `Career profile created for ${profile.name}`,
      profile: {
        id: profile.id,
        name: profile.name,
        dreamCompanies: profile.careerGoals.dreamCompanies.map((c) => c.name),
        targetRoles: profile.careerGoals.targetRoles,
      },
    };
  },
};

const getCareerProfile: CareerTool = {
  name: 'career_get_profile',
  description: 'Get the current career profile including skills, experience, and goals',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  handler: async () => {
    const manager = getCareerProfileManager();
    await manager.initialize();

    const profile = manager.getProfile();
    if (!profile) {
      return { success: false, error: 'No career profile found. Create one first.' };
    }

    return {
      success: true,
      profile: {
        name: profile.name,
        currentRole: profile.currentRole,
        yearsOfExperience: profile.yearsOfExperience,
        location: profile.location,
        skills: profile.skills.technical.slice(0, 10).map((s) => ({
          name: s.name,
          proficiency: s.proficiency,
        })),
        dreamCompanies: profile.careerGoals.dreamCompanies.map((c) => c.name),
        targetRoles: profile.careerGoals.targetRoles,
        shortTermGoal: profile.careerGoals.shortTerm,
      },
    };
  },
};

const addSkillToProfile: CareerTool = {
  name: 'career_add_skill',
  description: 'Add a technical skill to the career profile',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Skill name (e.g., TypeScript, React, AWS)' },
      proficiency: { type: 'string', enum: ['learning', 'beginner', 'intermediate', 'advanced', 'expert'] },
      yearsUsed: { type: 'number', description: 'Years of experience with this skill' },
      category: { type: 'string', enum: ['language', 'framework', 'database', 'cloud', 'devops', 'testing', 'ai-ml', 'other'] },
    },
    required: ['name', 'proficiency'],
  },
  handler: async (params) => {
    const manager = getCareerProfileManager();
    await manager.initialize();

    await manager.addTechnicalSkill({
      name: params.name,
      proficiency: params.proficiency,
      yearsUsed: params.yearsUsed || 1,
      category: params.category || 'other',
      lastUsed: Date.now(),
      projectsUsed: [],
      verified: false,
    });

    return {
      success: true,
      message: `Added ${params.name} (${params.proficiency}) to your skills`,
    };
  },
};

const setCareerGoals: CareerTool = {
  name: 'career_set_goals',
  description: 'Set short-term, medium-term, and long-term career goals',
  parameters: {
    type: 'object',
    properties: {
      shortTerm: { type: 'string', description: 'Goal for next 6-12 months' },
      mediumTerm: { type: 'string', description: 'Goal for 1-3 years' },
      longTerm: { type: 'string', description: 'Goal for 3-5+ years' },
      dreamCompanies: { type: 'array', items: { type: 'string' }, description: 'Companies you want to work for' },
    },
    required: [],
  },
  handler: async (params) => {
    const manager = getCareerProfileManager();
    await manager.initialize();

    await manager.setCareerGoals({
      shortTerm: params.shortTerm,
      mediumTerm: params.mediumTerm,
      longTerm: params.longTerm,
    });

    if (params.dreamCompanies) {
      for (const company of params.dreamCompanies) {
        await manager.addDreamCompany({
          name: company,
          whyInterested: '',
          knownRequirements: [],
          currentlyHiring: false,
          difficulty: 'stretch',
        });
      }
    }

    return { success: true, message: 'Career goals updated' };
  },
};

// ============================================================================
// Skills Gap Analysis Tools
// ============================================================================

const analyzeSkillsGap: CareerTool = {
  name: 'career_analyze_skills_gap',
  description: 'Analyze the gap between current skills and what\'s needed for a target company like Palantir, Google, or Stripe. Provides a learning roadmap.',
  parameters: {
    type: 'object',
    properties: {
      targetCompany: { type: 'string', description: 'Target company name (e.g., Palantir, Google, Stripe)' },
      targetRole: { type: 'string', description: 'Target role (e.g., Software Engineer, Backend Engineer)' },
    },
    required: ['targetCompany'],
  },
  handler: async (params) => {
    const analyzer = getSkillsGapAnalyzer();
    const manager = getCareerProfileManager();
    await manager.initialize();

    try {
      const analysis = await analyzer.analyzeGapForCompany(
        params.targetCompany,
        params.targetRole
      );

      return {
        success: true,
        analysis: {
          targetCompany: analysis.targetCompany,
          targetRole: analysis.targetRole,
          overallReadiness: `${analysis.overallReadiness}%`,
          technicalReadiness: `${analysis.technicalReadiness}%`,
          experienceReadiness: `${analysis.experienceReadiness}%`,
          matchedSkills: analysis.matchedSkills,
          skillsToLearn: analysis.gapSkills,
          prioritySkills: analysis.prioritySkillsToLearn.slice(0, 5).map((s) => ({
            skill: s.skill,
            importance: s.importance,
            estimatedTime: s.estimatedTime,
          })),
          suggestedProjects: analysis.projectsToComplete.slice(0, 3).map((p) => ({
            title: p.title,
            skills: p.skills,
            estimatedTime: p.estimatedTime,
          })),
          estimatedTimeToReadiness: analysis.estimatedTimeToReadiness,
        },
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

const getEliteCompanyRequirements: CareerTool = {
  name: 'career_get_company_requirements',
  description: 'Get detailed requirements and interview process for elite companies like Palantir, Google, Stripe',
  parameters: {
    type: 'object',
    properties: {
      company: { type: 'string', description: 'Company name' },
    },
    required: ['company'],
  },
  handler: async (params) => {
    const analyzer = getSkillsGapAnalyzer();
    const profile = analyzer.getEliteCompanyProfile(params.company);

    if (!profile) {
      return {
        success: false,
        error: `No detailed profile for ${params.company}. Available: ${analyzer.getAvailableCompanies().join(', ')}`,
      };
    }

    return {
      success: true,
      company: {
        name: profile.name,
        tier: profile.tier,
        technicalRequirements: profile.technicalRequirements.map((r) => ({
          area: r.area,
          skills: r.skills,
          importance: r.importance,
        })),
        experienceRequirements: profile.experienceRequirements,
        softSkills: profile.softSkillRequirements,
        interviewProcess: profile.interviewProcess.map((s) => ({
          name: s.name,
          duration: s.duration,
          focus: s.focus,
        })),
        interviewDifficulty: profile.interviewDifficulty,
        salaryRange: profile.salaryRange,
        tips: profile.interviewTips,
        whatGetsYouNoticed: profile.whatGetsYouNoticed,
      },
    };
  },
};

// ============================================================================
// Job Search Tools
// ============================================================================

const searchJobs: CareerTool = {
  name: 'career_search_jobs',
  description: 'Search for jobs across multiple platforms. Use for finding remote, freelance, or full-time positions.',
  parameters: {
    type: 'object',
    properties: {
      keywords: { type: 'array', items: { type: 'string' }, description: 'Search keywords (e.g., ["TypeScript", "React", "Remote"])' },
      remote: { type: 'boolean', description: 'Only remote jobs' },
      jobType: { type: 'string', enum: ['full-time', 'part-time', 'contract', 'freelance'] },
      location: { type: 'string', description: 'Location filter' },
      salaryMin: { type: 'number', description: 'Minimum salary' },
    },
    required: ['keywords'],
  },
  handler: async (params) => {
    const engine = getJobSearchEngine();

    const results = await engine.search({
      keywords: params.keywords,
      remote: params.remote,
      jobType: params.jobType,
      location: params.location,
      salaryMin: params.salaryMin,
    });

    return {
      success: true,
      totalFound: results.totalFound,
      jobs: results.jobs.slice(0, 10).map((job) => ({
        title: job.title,
        company: job.company,
        location: job.location,
        remote: job.remote,
        salary: job.salary ? `${job.salary.currency} ${job.salary.min}-${job.salary.max}` : 'Not disclosed',
        matchScore: `${job.matchScore}%`,
        skillsMatched: job.skillsMatched,
        skillsGap: job.skillsGap,
        source: job.source,
      })),
    };
  },
};

const searchRemoteJobs: CareerTool = {
  name: 'career_search_remote_jobs',
  description: 'Search specifically for remote programming jobs',
  parameters: {
    type: 'object',
    properties: {
      keywords: { type: 'array', items: { type: 'string' }, description: 'Skills/technologies to search for' },
    },
    required: ['keywords'],
  },
  handler: async (params) => {
    const engine = getJobSearchEngine();
    const results = await engine.searchRemoteJobs(params.keywords);

    return {
      success: true,
      totalFound: results.totalFound,
      jobs: results.jobs.slice(0, 10).map((job) => ({
        title: job.title,
        company: job.company,
        salary: job.salary ? `${job.salary.currency} ${job.salary.min}-${job.salary.max}` : 'Not disclosed',
        matchScore: `${job.matchScore}%`,
        source: job.source,
      })),
    };
  },
};

const searchFreelanceJobs: CareerTool = {
  name: 'career_search_freelance_jobs',
  description: 'Search for freelance/contract programming opportunities on Toptal, Upwork, etc.',
  parameters: {
    type: 'object',
    properties: {
      keywords: { type: 'array', items: { type: 'string' }, description: 'Skills to search for' },
    },
    required: ['keywords'],
  },
  handler: async (params) => {
    const engine = getJobSearchEngine();
    const results = await engine.searchFreelanceJobs(params.keywords);

    return {
      success: true,
      totalFound: results.totalFound,
      jobs: results.jobs.slice(0, 10).map((job) => ({
        title: job.title,
        company: job.company,
        rate: job.salary ? `${job.salary.currency} ${job.salary.min}-${job.salary.max}/${job.salary.period}` : 'Not disclosed',
        matchScore: `${job.matchScore}%`,
        source: job.source,
      })),
    };
  },
};

const getJobRecommendations: CareerTool = {
  name: 'career_get_job_recommendations',
  description: 'Get personalized job recommendations based on profile and skills',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  handler: async () => {
    const engine = getJobSearchEngine();
    const jobs = await engine.getRecommendations();

    return {
      success: true,
      recommendations: jobs.slice(0, 10).map((job) => ({
        title: job.title,
        company: job.company,
        matchScore: `${job.matchScore}%`,
        whyRecommended: job.skillsMatched.slice(0, 3).join(', '),
        location: job.remote ? 'Remote' : job.location,
      })),
    };
  },
};

// ============================================================================
// CV Tools
// ============================================================================

const analyzeCV: CareerTool = {
  name: 'career_analyze_cv',
  description: 'Analyze a CV/resume and get improvement suggestions, ATS score, and optimization tips',
  parameters: {
    type: 'object',
    properties: {
      cvContent: { type: 'string', description: 'The CV content as text' },
      targetRole: { type: 'string', description: 'Target role to optimize for' },
    },
    required: ['cvContent'],
  },
  handler: async (params) => {
    const optimizer = getCVOptimizer();

    const analysis = await optimizer.analyzeCV(params.cvContent, params.targetRole);

    return {
      success: true,
      analysis: {
        overallScore: `${analysis.overallScore}/100`,
        atsScore: `${analysis.atsScore}/100`,
        readabilityScore: `${analysis.readabilityScore}/100`,
        impactScore: `${analysis.impactScore}/100`,
        sections: analysis.sections.map((s) => ({
          name: s.name,
          present: s.present,
          score: s.score,
          feedback: s.feedback,
        })),
        keywordsFound: analysis.keywords.found,
        keywordsMissing: analysis.keywords.missing.slice(0, 5),
        topImprovements: analysis.improvements.slice(0, 5).map((i) => ({
          priority: i.priority,
          issue: i.issue,
          suggestion: i.suggestion,
        })),
        warnings: analysis.warnings,
      },
    };
  },
};

const generateCV: CareerTool = {
  name: 'career_generate_cv',
  description: 'Generate a CV from the career profile using a professional template',
  parameters: {
    type: 'object',
    properties: {
      template: { type: 'string', enum: ['modern', 'traditional', 'creative', 'faang'], description: 'CV template style' },
    },
    required: [],
  },
  handler: async (params) => {
    const optimizer = getCVOptimizer();

    try {
      const cv = await optimizer.generateCVFromProfile(params.template || 'modern');
      return {
        success: true,
        cv,
        message: 'CV generated from your profile. Review and customize as needed.',
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

const tailorCVForJob: CareerTool = {
  name: 'career_tailor_cv_for_job',
  description: 'Tailor a CV for a specific job posting, highlighting relevant skills and experience',
  parameters: {
    type: 'object',
    properties: {
      cvContent: { type: 'string', description: 'Current CV content' },
      jobTitle: { type: 'string', description: 'Job title' },
      company: { type: 'string', description: 'Company name' },
      jobDescription: { type: 'string', description: 'Job description/requirements' },
    },
    required: ['cvContent', 'jobTitle', 'company'],
  },
  handler: async (params) => {
    const optimizer = getCVOptimizer();

    const job = {
      id: `job_${Date.now()}`,
      title: params.jobTitle,
      company: params.company,
      description: params.jobDescription || '',
      requirements: params.jobDescription?.split('\n').filter((l: string) => l.trim()) || [],
      niceToHaves: [],
      responsibilities: [],
      benefits: [],
      location: 'Remote',
      remote: true,
      postedDate: Date.now(),
      sourceUrl: '',
      source: 'manual' as const,
      matchScore: 0,
      skillsMatched: [],
      skillsGap: [],
      status: 'saved' as const,
    };

    const tailored = await optimizer.tailorCVForJob(params.cvContent, job);

    return {
      success: true,
      tailored: {
        matchScore: `${tailored.matchScore}%`,
        suggestedSummary: tailored.tailoredContent.summary,
        prioritizedSkills: tailored.tailoredContent.skills.slice(0, 10),
        experiencesToHighlight: tailored.tailoredContent.highlightedExperiences,
        keywordsToAdd: tailored.tailoredContent.keywordsAdded,
        modifications: tailored.modifications.map((m) => ({
          section: m.section,
          action: m.type,
          suggestion: m.modified,
          reason: m.reason,
        })),
      },
    };
  },
};

// ============================================================================
// Application Tracking Tools
// ============================================================================

const trackApplication: CareerTool = {
  name: 'career_track_application',
  description: 'Track a new job application',
  parameters: {
    type: 'object',
    properties: {
      jobTitle: { type: 'string', description: 'Job title' },
      company: { type: 'string', description: 'Company name' },
      source: { type: 'string', description: 'Where you found the job' },
      notes: { type: 'string', description: 'Any notes about the application' },
    },
    required: ['jobTitle', 'company'],
  },
  handler: async (params) => {
    const tracker = getApplicationTracker();
    await tracker.initialize();

    const job = {
      id: `job_${Date.now()}`,
      title: params.jobTitle,
      company: params.company,
      location: 'Remote',
      remote: true,
      description: '',
      requirements: [],
      niceToHaves: [],
      responsibilities: [],
      benefits: [],
      postedDate: Date.now(),
      sourceUrl: '',
      source: (params.source || 'manual') as any,
      matchScore: 0,
      skillsMatched: [],
      skillsGap: [],
      status: 'saved' as const,
    };

    const application = await tracker.createApplication(job, 'default', undefined);

    if (params.notes) {
      await tracker.updateNotes(application.id, params.notes);
    }

    return {
      success: true,
      applicationId: application.id,
      message: `Tracking application for ${params.jobTitle} at ${params.company}`,
    };
  },
};

const updateApplicationStatus: CareerTool = {
  name: 'career_update_application_status',
  description: 'Update the status of a job application',
  parameters: {
    type: 'object',
    properties: {
      applicationId: { type: 'string', description: 'Application ID' },
      status: {
        type: 'string',
        enum: ['applied', 'screening', 'phone-interview', 'technical-interview', 'onsite-interview', 'offer-received', 'rejected', 'withdrawn'],
      },
      notes: { type: 'string', description: 'Notes about this status change' },
    },
    required: ['applicationId', 'status'],
  },
  handler: async (params) => {
    const tracker = getApplicationTracker();
    await tracker.initialize();

    await tracker.updateStatus(params.applicationId, params.status, params.notes);

    return {
      success: true,
      message: `Application status updated to ${params.status}`,
    };
  },
};

const getApplications: CareerTool = {
  name: 'career_get_applications',
  description: 'Get all tracked job applications and their statuses',
  parameters: {
    type: 'object',
    properties: {
      status: { type: 'string', description: 'Filter by status' },
    },
    required: [],
  },
  handler: async (params) => {
    const tracker = getApplicationTracker();
    await tracker.initialize();

    const apps = params.status
      ? tracker.getApplicationsByStatus(params.status)
      : tracker.getActiveApplications();

    return {
      success: true,
      applications: apps.map((app) => ({
        id: app.id,
        title: app.job.title,
        company: app.job.company,
        status: app.status,
        appliedAt: new Date(app.appliedAt).toLocaleDateString(),
        interviewCount: app.interviews.length,
      })),
    };
  },
};

const getApplicationAnalytics: CareerTool = {
  name: 'career_get_application_analytics',
  description: 'Get analytics on job applications: response rates, interview rates, offer rates',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  handler: async () => {
    const tracker = getApplicationTracker();
    await tracker.initialize();

    const analytics = tracker.getApplicationAnalytics();

    return {
      success: true,
      analytics: {
        totalApplications: analytics.totalApplications,
        responseRate: `${analytics.responseRate}%`,
        interviewRate: `${analytics.interviewRate}%`,
        offerRate: `${analytics.offerRate}%`,
        averageTimeToResponse: `${analytics.averageTimeToResponse} days`,
        byStatus: analytics.byStatus,
      },
    };
  },
};

// ============================================================================
// Interview Prep Tools
// ============================================================================

const generateInterviewPrepPlan: CareerTool = {
  name: 'career_generate_interview_prep',
  description: 'Generate a personalized interview preparation plan for a specific company and role',
  parameters: {
    type: 'object',
    properties: {
      company: { type: 'string', description: 'Company name' },
      role: { type: 'string', description: 'Role title' },
      interviewDate: { type: 'string', description: 'Interview date (optional)' },
    },
    required: ['company', 'role'],
  },
  handler: async (params) => {
    const prepManager = getInterviewPrepManager();

    const interviewDate = params.interviewDate ? new Date(params.interviewDate).getTime() : undefined;
    const plan = await prepManager.generatePrepPlan(params.company, params.role, interviewDate);

    return {
      success: true,
      plan: {
        company: plan.company,
        role: plan.role,
        companyValues: plan.companyResearch.values,
        technicalTopics: plan.technicalTopics.map((t) => ({
          topic: t.topic,
          importance: t.importance,
          yourConfidence: t.confidence,
        })),
        codingPatterns: plan.codingChallenges.patterns,
        systemDesignTopics: plan.systemDesignTopics.map((t) => t.name),
        behavioralQuestions: plan.commonQuestions.slice(0, 5).map((q) => q.question),
        questionsToAsk: plan.questionsToAsk.slice(0, 5),
        tips: plan.tips,
      },
    };
  },
};

const getMockInterviewQuestions: CareerTool = {
  name: 'career_get_mock_interview_questions',
  description: 'Get mock interview questions for practice',
  parameters: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['technical', 'behavioral', 'system-design'] },
      count: { type: 'number', description: 'Number of questions' },
    },
    required: ['type'],
  },
  handler: async (params) => {
    const prepManager = getInterviewPrepManager();
    const questions = await prepManager.generateMockInterviewQuestions(
      params.type,
      params.count || 5
    );

    return {
      success: true,
      type: params.type,
      questions,
    };
  },
};

const addSTARStory: CareerTool = {
  name: 'career_add_star_story',
  description: 'Add a STAR (Situation, Task, Action, Result) story for behavioral interviews',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Story title' },
      situation: { type: 'string', description: 'The situation/context' },
      task: { type: 'string', description: 'Your responsibility' },
      action: { type: 'string', description: 'What you did' },
      result: { type: 'string', description: 'The outcome (with metrics)' },
      skills: { type: 'array', items: { type: 'string' }, description: 'Skills this demonstrates' },
    },
    required: ['title', 'situation', 'task', 'action', 'result'],
  },
  handler: async (params) => {
    const prepManager = getInterviewPrepManager();

    const story = await prepManager.addSTARStory({
      title: params.title,
      situation: params.situation,
      task: params.task,
      action: params.action,
      result: params.result,
      skills: params.skills || [],
      useFor: [],
    });

    return {
      success: true,
      message: 'STAR story added',
      storyId: story.id,
    };
  },
};

// ============================================================================
// Export All Tools
// ============================================================================

export function getCareerTools(): CareerTool[] {
  return [
    // Profile tools
    createCareerProfile,
    getCareerProfile,
    addSkillToProfile,
    setCareerGoals,

    // Skills gap tools
    analyzeSkillsGap,
    getEliteCompanyRequirements,

    // Job search tools
    searchJobs,
    searchRemoteJobs,
    searchFreelanceJobs,
    getJobRecommendations,

    // CV tools
    analyzeCV,
    generateCV,
    tailorCVForJob,

    // Application tracking tools
    trackApplication,
    updateApplicationStatus,
    getApplications,
    getApplicationAnalytics,

    // Interview prep tools
    generateInterviewPrepPlan,
    getMockInterviewQuestions,
    addSTARStory,
  ];
}

export default getCareerTools;
