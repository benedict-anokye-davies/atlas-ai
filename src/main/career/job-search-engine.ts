/**
 * Job Search Engine
 *
 * Multi-platform job search aggregator that finds opportunities
 * matching user's profile and preferences. Supports remote work,
 * freelance, and full-time positions.
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { getCareerProfileManager } from './career-profile-manager';
import {
  JobListing,
  JobSource,
  JobAnalysis,
  JobStatus,
  SalaryRange,
  CompanyInfo,
  CareerProfile,
} from './types';

const logger = createModuleLogger('JobSearchEngine');

// ============================================================================
// Job Search Configuration
// ============================================================================

interface JobSearchQuery {
  keywords: string[];
  location?: string;
  remote?: boolean;
  salaryMin?: number;
  salaryMax?: number;
  experienceLevel?: 'entry' | 'mid' | 'senior' | 'lead' | 'principal';
  jobType?: 'full-time' | 'part-time' | 'contract' | 'freelance' | 'internship';
  sources?: JobSource[];
  excludeCompanies?: string[];
  postedWithin?: number; // days
}

interface SearchResult {
  jobs: JobListing[];
  totalFound: number;
  sources: { source: JobSource; count: number }[];
  searchedAt: number;
  query: JobSearchQuery;
}

// ============================================================================
// Job Boards Configuration
// ============================================================================

const JOB_BOARD_URLS: Record<JobSource, string> = {
  linkedin: 'https://www.linkedin.com/jobs/search/',
  indeed: 'https://uk.indeed.com/jobs',
  glassdoor: 'https://www.glassdoor.co.uk/Job/',
  wellfound: 'https://wellfound.com/jobs',
  hired: 'https://hired.com/jobs',
  toptal: 'https://www.toptal.com/freelance-jobs',
  upwork: 'https://www.upwork.com/freelance-jobs/',
  fiverr: 'https://www.fiverr.com/jobs',
  freelancer: 'https://www.freelancer.com/jobs/',
  'remote-ok': 'https://remoteok.com/',
  'we-work-remotely': 'https://weworkremotely.com/',
  'arc-dev': 'https://arc.dev/remote-jobs',
  turing: 'https://www.turing.com/jobs',
  'gun-io': 'https://gun.io/',
  'company-direct': '',
  referral: '',
  manual: '',
};

// ============================================================================
// Job Search Engine
// ============================================================================

export class JobSearchEngine extends EventEmitter {
  private profileManager = getCareerProfileManager();
  private savedJobs: Map<string, JobListing> = new Map();
  private searchHistory: SearchResult[] = [];

  constructor() {
    super();
  }

  // --------------------------------------------------------------------------
  // Job Search
  // --------------------------------------------------------------------------

  async search(query: JobSearchQuery): Promise<SearchResult> {
    const profile = this.profileManager.getProfile();
    logger.info('Starting job search', { query });

    // Build search URLs for each source
    const sources = query.sources || ['linkedin', 'indeed', 'remote-ok', 'wellfound'];
    const searchUrls = this.buildSearchUrls(query, sources);

    // For now, we'll generate mock results
    // In production, this would use the browser agent to scrape job boards
    const jobs = this.generateMockJobs(query, profile);

    // Analyze and score each job
    const analyzedJobs = jobs.map((job) => this.analyzeJob(job, profile));

    // Sort by match score
    analyzedJobs.sort((a, b) => b.matchScore - a.matchScore);

    const result: SearchResult = {
      jobs: analyzedJobs,
      totalFound: analyzedJobs.length,
      sources: sources.map((source) => ({
        source,
        count: analyzedJobs.filter((j) => j.source === source).length,
      })),
      searchedAt: Date.now(),
      query,
    };

    this.searchHistory.push(result);
    this.emit('search-complete', result);

    return result;
  }

  async searchRemoteJobs(keywords: string[]): Promise<SearchResult> {
    return this.search({
      keywords,
      remote: true,
      sources: ['remote-ok', 'we-work-remotely', 'wellfound', 'arc-dev', 'linkedin'],
    });
  }

  async searchFreelanceJobs(keywords: string[]): Promise<SearchResult> {
    return this.search({
      keywords,
      jobType: 'freelance',
      sources: ['toptal', 'upwork', 'freelancer', 'gun-io', 'arc-dev'],
    });
  }

  async searchByCompany(companyName: string): Promise<JobListing[]> {
    const results = await this.search({
      keywords: [companyName],
      sources: ['linkedin', 'glassdoor', 'company-direct'],
    });

    return results.jobs.filter((j) =>
      j.company.toLowerCase().includes(companyName.toLowerCase())
    );
  }

  // --------------------------------------------------------------------------
  // Job Analysis
  // --------------------------------------------------------------------------

  private analyzeJob(job: JobListing, profile: CareerProfile | null): JobListing {
    if (!profile) {
      return { ...job, matchScore: 50 };
    }

    const userSkills = profile.skills.technical.map((s) => s.name.toLowerCase());
    const userTools = profile.skills.tools.map((t) => t.name.toLowerCase());
    const allUserSkills = [...userSkills, ...userTools];

    // Extract required skills from job
    const jobSkills = [
      ...job.requirements,
      ...job.niceToHaves,
    ]
      .join(' ')
      .toLowerCase()
      .split(/[\s,;]+/)
      .filter((word) => word.length > 2);

    // Find matches
    const matchedSkills: string[] = [];
    const gapSkills: string[] = [];

    for (const skill of allUserSkills) {
      if (jobSkills.some((js) => js.includes(skill) || skill.includes(js))) {
        matchedSkills.push(skill);
      }
    }

    for (const req of job.requirements) {
      const reqLower = req.toLowerCase();
      if (!allUserSkills.some((s) => reqLower.includes(s) || s.includes(reqLower))) {
        gapSkills.push(req);
      }
    }

    // Calculate match score
    let matchScore = 50; // Base score

    // Skills match (up to +30)
    const skillMatchRatio = job.requirements.length > 0
      ? matchedSkills.length / job.requirements.length
      : 0.5;
    matchScore += Math.round(skillMatchRatio * 30);

    // Experience match (up to +10)
    const requiredExp = this.extractRequiredExperience(job.requirements);
    if (requiredExp && profile.yearsOfExperience >= requiredExp) {
      matchScore += 10;
    } else if (requiredExp && profile.yearsOfExperience >= requiredExp - 1) {
      matchScore += 5;
    }

    // Location/remote match (up to +10)
    if (job.remote && profile.workPreferences.remotePreference !== 'office') {
      matchScore += 10;
    } else if (
      job.location.toLowerCase().includes(profile.location.toLowerCase())
    ) {
      matchScore += 10;
    }

    // Salary match (binary)
    if (job.salary && profile.salaryExpectations.minimum > 0) {
      if (job.salary.max >= profile.salaryExpectations.minimum) {
        matchScore += 5;
      }
    }

    // Cap at 100
    matchScore = Math.min(100, Math.max(0, matchScore));

    // Generate analysis
    const analysis: JobAnalysis = {
      overallFit: matchScore >= 80 ? 'excellent' : matchScore >= 60 ? 'good' : matchScore >= 40 ? 'moderate' : 'poor',
      strengthsForRole: matchedSkills.slice(0, 5),
      areasToImprove: gapSkills.slice(0, 3),
      interviewTopics: this.predictInterviewTopics(job),
      questionsToAsk: this.generateQuestionsToAsk(job),
      redFlags: this.detectRedFlags(job),
      recommendations: this.generateRecommendations(job, matchedSkills, gapSkills),
    };

    return {
      ...job,
      matchScore,
      skillsMatched: matchedSkills,
      skillsGap: gapSkills,
      analysis,
    };
  }

  private extractRequiredExperience(requirements: string[]): number | null {
    for (const req of requirements) {
      const match = req.match(/(\d+)\+?\s*years?/i);
      if (match) {
        return parseInt(match[1]);
      }
    }
    return null;
  }

  private predictInterviewTopics(job: JobListing): string[] {
    const topics: string[] = [];

    const description = job.description.toLowerCase();

    if (description.includes('algorithm') || description.includes('data structure')) {
      topics.push('Algorithms and data structures');
    }
    if (description.includes('system design') || description.includes('architecture')) {
      topics.push('System design');
    }
    if (description.includes('leadership') || description.includes('team')) {
      topics.push('Leadership and collaboration');
    }
    if (description.includes('api') || description.includes('rest')) {
      topics.push('API design');
    }
    if (description.includes('database') || description.includes('sql')) {
      topics.push('Database design');
    }

    // Add role-specific topics
    if (job.title.toLowerCase().includes('frontend')) {
      topics.push('Frontend frameworks', 'Performance optimization', 'Accessibility');
    }
    if (job.title.toLowerCase().includes('backend')) {
      topics.push('Backend architecture', 'Scalability', 'Security');
    }

    return topics.slice(0, 5);
  }

  private generateQuestionsToAsk(job: JobListing): string[] {
    return [
      "What does a typical day look like for this role?",
      "How do you measure success in this position?",
      "What are the biggest challenges the team is facing?",
      "What's the team's approach to technical debt?",
      "How does the company support professional development?",
      "What's the on-call/support rotation like?",
      "Can you tell me about the team I'd be working with?",
    ];
  }

  private detectRedFlags(job: JobListing): string[] {
    const redFlags: string[] = [];
    const description = job.description.toLowerCase();

    if (description.includes('fast-paced') && description.includes('wear many hats')) {
      redFlags.push('May indicate understaffing');
    }
    if (description.includes('competitive salary') && !job.salary) {
      redFlags.push('Salary not disclosed');
    }
    if (description.includes('rockstar') || description.includes('ninja') || description.includes('guru')) {
      redFlags.push('Buzzword-heavy job posting');
    }
    if (description.includes('unlimited pto') || description.includes('unlimited vacation')) {
      redFlags.push('Unlimited PTO can mean pressure not to take time off');
    }
    if (job.requirements.length > 15) {
      redFlags.push('Unrealistic number of requirements');
    }

    return redFlags;
  }

  private generateRecommendations(
    job: JobListing,
    matched: string[],
    gaps: string[]
  ): string[] {
    const recs: string[] = [];

    if (matched.length > 0) {
      recs.push(`Highlight your experience with: ${matched.slice(0, 3).join(', ')}`);
    }

    if (gaps.length > 0 && gaps.length <= 2) {
      recs.push(`Consider learning: ${gaps.join(', ')} before applying`);
    }

    if (gaps.length > 2) {
      recs.push('This role may be a stretch - consider applying anyway for practice');
    }

    recs.push('Tailor your CV to match the job description keywords');
    recs.push('Prepare STAR stories relevant to the responsibilities');

    return recs;
  }

  // --------------------------------------------------------------------------
  // URL Building
  // --------------------------------------------------------------------------

  private buildSearchUrls(
    query: JobSearchQuery,
    sources: JobSource[]
  ): { source: JobSource; url: string }[] {
    const urls: { source: JobSource; url: string }[] = [];

    for (const source of sources) {
      const baseUrl = JOB_BOARD_URLS[source];
      if (!baseUrl) continue;

      let url = baseUrl;
      const keywords = query.keywords.join(' ');

      switch (source) {
        case 'linkedin':
          url += `?keywords=${encodeURIComponent(keywords)}`;
          if (query.location) url += `&location=${encodeURIComponent(query.location)}`;
          if (query.remote) url += '&f_WRA=true'; // Work from home filter
          break;

        case 'indeed':
          url += `?q=${encodeURIComponent(keywords)}`;
          if (query.location) url += `&l=${encodeURIComponent(query.location)}`;
          if (query.remote) url += '&remotejob=032b3046-06a3-4876-8dfd-474eb5e7ed11';
          break;

        case 'remote-ok':
          url += `?tag=${encodeURIComponent(keywords.replace(/\s+/g, '-'))}`;
          break;

        case 'we-work-remotely':
          url += `remote-jobs/search?term=${encodeURIComponent(keywords)}`;
          break;

        case 'wellfound':
          url += `?keywords=${encodeURIComponent(keywords)}`;
          if (query.remote) url += '&remote=true';
          break;

        default:
          url += `?q=${encodeURIComponent(keywords)}`;
      }

      urls.push({ source, url });
    }

    return urls;
  }

  // --------------------------------------------------------------------------
  // Mock Data Generation (for development)
  // --------------------------------------------------------------------------

  private generateMockJobs(query: JobSearchQuery, profile: CareerProfile | null): JobListing[] {
    const keywords = query.keywords.join(' ').toLowerCase();
    const jobs: JobListing[] = [];

    // Generate relevant mock jobs based on search
    const mockJobTemplates = [
      {
        title: 'Senior TypeScript Developer',
        company: 'TechCorp',
        requirements: ['TypeScript', 'React', 'Node.js', '5+ years experience', 'REST APIs'],
        niceToHaves: ['AWS', 'GraphQL', 'Docker'],
        salary: { min: 80000, max: 120000 },
      },
      {
        title: 'Full Stack Engineer',
        company: 'StartupXYZ',
        requirements: ['JavaScript', 'Python', 'PostgreSQL', '3+ years experience'],
        niceToHaves: ['Machine Learning', 'Kubernetes'],
        salary: { min: 70000, max: 100000 },
      },
      {
        title: 'Backend Engineer',
        company: 'FinTech Inc',
        requirements: ['Node.js', 'TypeScript', 'SQL', 'Microservices', '4+ years experience'],
        niceToHaves: ['Kafka', 'Redis', 'AWS'],
        salary: { min: 90000, max: 130000 },
      },
      {
        title: 'Software Engineer - Platform',
        company: 'Palantir Technologies',
        requirements: ['Java', 'Python', 'Distributed Systems', 'Data Structures', '3+ years experience'],
        niceToHaves: ['Spark', 'Kubernetes', 'Security clearance eligible'],
        salary: { min: 150000, max: 250000 },
      },
      {
        title: 'Frontend Developer (Contract)',
        company: 'Design Agency',
        requirements: ['React', 'TypeScript', 'CSS', '2+ years experience'],
        niceToHaves: ['Figma', 'Testing Library'],
        salary: { min: 400, max: 600 },
        isContract: true,
      },
    ];

    let id = 1;
    for (const template of mockJobTemplates) {
      // Only include if keywords match
      const templateText = `${template.title} ${template.requirements.join(' ')}`.toLowerCase();
      if (keywords && !templateText.includes(keywords.split(' ')[0])) {
        continue;
      }

      const job: JobListing = {
        id: `job_${id++}`,
        title: template.title,
        company: template.company,
        location: query.remote ? 'Remote' : 'London, UK',
        remote: query.remote || Math.random() > 0.5,
        salary: {
          min: template.salary.min,
          max: template.salary.max,
          currency: 'GBP',
          period: (template as any).isContract ? 'daily' : 'yearly',
        },
        description: `We're looking for a ${template.title} to join our team. You'll work on exciting projects and have the opportunity to make a real impact.`,
        requirements: template.requirements,
        niceToHaves: template.niceToHaves,
        responsibilities: [
          'Design and implement new features',
          'Write clean, maintainable code',
          'Participate in code reviews',
          'Collaborate with cross-functional teams',
        ],
        benefits: ['Health insurance', 'Remote work', 'Learning budget', 'Stock options'],
        postedDate: Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000,
        sourceUrl: `https://example.com/jobs/${id}`,
        source: query.sources?.[0] || 'linkedin',
        matchScore: 0,
        skillsMatched: [],
        skillsGap: [],
        status: 'saved',
      };

      jobs.push(job);
    }

    return jobs;
  }

  // --------------------------------------------------------------------------
  // Saved Jobs
  // --------------------------------------------------------------------------

  saveJob(job: JobListing): void {
    job.savedAt = Date.now();
    job.status = 'saved';
    this.savedJobs.set(job.id, job);
    this.emit('job-saved', job);
  }

  unsaveJob(jobId: string): void {
    this.savedJobs.delete(jobId);
    this.emit('job-unsaved', jobId);
  }

  getSavedJobs(): JobListing[] {
    return Array.from(this.savedJobs.values())
      .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  }

  updateJobStatus(jobId: string, status: JobStatus): void {
    const job = this.savedJobs.get(jobId);
    if (job) {
      job.status = status;
      this.emit('job-status-updated', job);
    }
  }

  // --------------------------------------------------------------------------
  // Search History
  // --------------------------------------------------------------------------

  getSearchHistory(): SearchResult[] {
    return this.searchHistory.slice(-20);
  }

  clearSearchHistory(): void {
    this.searchHistory = [];
  }

  // --------------------------------------------------------------------------
  // Job Recommendations
  // --------------------------------------------------------------------------

  async getRecommendations(): Promise<JobListing[]> {
    const profile = this.profileManager.getProfile();
    if (!profile) {
      return [];
    }

    // Build query from profile
    const keywords = [
      ...profile.workPreferences.roles.slice(0, 2),
      ...profile.skills.technical.slice(0, 3).map((s) => s.name),
    ];

    const result = await this.search({
      keywords,
      remote: profile.workPreferences.remotePreference === 'remote-only',
      salaryMin: profile.salaryExpectations.minimum,
    });

    return result.jobs.filter((j) => j.matchScore >= 60);
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: JobSearchEngine | null = null;

export function getJobSearchEngine(): JobSearchEngine {
  if (!instance) {
    instance = new JobSearchEngine();
  }
  return instance;
}

export default JobSearchEngine;
