/**
 * Skills Gap Analyzer
 *
 * Analyzes the gap between user's current skills and requirements
 * for target companies (especially elite companies like Palantir, FAANG).
 * Provides personalized learning roadmaps.
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { getCareerProfileManager } from './career-profile-manager';
import {
  SkillsGapAnalysis,
  SkillLearningPlan,
  LearningRoadmap,
  LearningPhase,
  SuggestedProject,
  SuggestedCertification,
  LearningResource,
  EliteCompanyProfile,
  ProficiencyLevel,
  TechnicalSkill,
} from './types';

const logger = createModuleLogger('SkillsGapAnalyzer');

// ============================================================================
// Elite Company Requirements Database
// ============================================================================

const ELITE_COMPANY_PROFILES: Record<string, EliteCompanyProfile> = {
  palantir: {
    name: 'Palantir Technologies',
    tier: 'unicorn',
    website: 'https://www.palantir.com',
    careersUrl: 'https://www.palantir.com/careers/',
    technicalRequirements: [
      {
        area: 'Languages',
        skills: ['Java', 'Python', 'TypeScript', 'Go', 'Rust'],
        minProficiency: 'advanced',
        importance: 'required',
      },
      {
        area: 'Distributed Systems',
        skills: ['Microservices', 'Event-driven architecture', 'Message queues', 'Distributed databases'],
        minProficiency: 'advanced',
        importance: 'required',
      },
      {
        area: 'Data Engineering',
        skills: ['SQL', 'Data pipelines', 'ETL', 'Data modeling', 'Big data'],
        minProficiency: 'advanced',
        importance: 'required',
      },
      {
        area: 'Cloud & Infrastructure',
        skills: ['AWS', 'Kubernetes', 'Docker', 'Terraform'],
        minProficiency: 'intermediate',
        importance: 'preferred',
      },
      {
        area: 'Security',
        skills: ['Security fundamentals', 'Encryption', 'Access control'],
        minProficiency: 'intermediate',
        importance: 'required',
      },
      {
        area: 'Algorithms',
        skills: ['Data structures', 'Algorithms', 'System design', 'Complexity analysis'],
        minProficiency: 'expert',
        importance: 'required',
      },
    ],
    experienceRequirements: [
      'Strong CS fundamentals',
      'Experience with large-scale systems',
      'Track record of shipping products',
      'Experience working with complex data',
      'Ability to work in ambiguous environments',
    ],
    softSkillRequirements: [
      'Clear communication',
      'Strong problem solving',
      'Intellectual curiosity',
      'Ability to learn quickly',
      'Ownership mentality',
    ],
    culturalFit: [
      'Mission-driven (solving hard problems for important organizations)',
      'High intensity and fast pace',
      'Direct communication style',
      'Comfortable with ambiguity',
      'Strong ownership',
    ],
    educationPreferences: [
      'BS/MS/PhD in CS, Math, Physics, or related field',
      'Top university preferred but not required',
      'Strong self-taught engineers welcome with proof of work',
    ],
    interviewProcess: [
      {
        name: 'Recruiter Screen',
        description: 'Initial conversation about background and interest',
        duration: '30 minutes',
        focus: ['Background', 'Motivation', 'Basic technical'],
        tips: ['Research Palantir products', 'Know why you want to work there'],
      },
      {
        name: 'Technical Phone Screen',
        description: 'Coding interview on shared editor',
        duration: '45-60 minutes',
        focus: ['Algorithms', 'Data structures', 'Problem solving'],
        tips: ['Practice LeetCode medium/hard', 'Think out loud'],
      },
      {
        name: 'Take-home Assignment',
        description: 'Build a small project (usually 4-8 hours)',
        duration: '1 week deadline',
        focus: ['System design', 'Code quality', 'Documentation'],
        tips: ['Focus on clean code', 'Add tests', 'Document decisions'],
      },
      {
        name: 'Super Day (Onsite)',
        description: '4-6 interviews in one day',
        duration: 'Full day',
        focus: ['System design', 'Coding', 'Behavioral', 'Product thinking'],
        tips: ['Ask clarifying questions', 'Show ownership', 'Be collaborative'],
      },
    ],
    interviewDifficulty: 'very-hard',
    typicalTimelineWeeks: 4,
    interviewTips: [
      'Focus heavily on system design - they love building large-scale systems',
      'Prepare STAR stories about working with complex data',
      'Show genuine interest in their mission (government/enterprise data)',
      'Be ready to discuss trade-offs in your designs',
      'Practice explaining complex concepts simply',
    ],
    salaryRange: {
      min: 150000,
      max: 300000,
      currency: 'GBP',
      period: 'yearly',
      includesBonus: true,
      includesEquity: true,
    },
    benefits: [
      'Competitive equity',
      'Annual bonus',
      'Health insurance',
      'Free food',
      'Gym membership',
      'Relocation assistance',
    ],
    equity: 'RSUs vesting over 4 years',
    whatGetsYouNoticed: [
      'Open source contributions to data/systems projects',
      'Publications or blog posts on distributed systems',
      'Experience at other top companies',
      'Novel projects demonstrating systems thinking',
      'Strong referral from current employee',
    ],
    redFlagsToAvoid: [
      'Lack of concrete examples in behavioral questions',
      'Unable to explain past projects deeply',
      'Poor communication or collaboration signals',
      'Not asking thoughtful questions',
      'Showing no knowledge of Palantir products',
    ],
    successStories: [
      'Many engineers join from consulting backgrounds (McKinsey, BCG)',
      'Strong showing from top universities (MIT, Stanford, Cambridge)',
      'Self-taught engineers with exceptional portfolios have succeeded',
    ],
  },

  google: {
    name: 'Google',
    tier: 'faang',
    website: 'https://www.google.com',
    careersUrl: 'https://careers.google.com',
    technicalRequirements: [
      {
        area: 'Languages',
        skills: ['Python', 'Java', 'C++', 'Go'],
        minProficiency: 'advanced',
        importance: 'required',
      },
      {
        area: 'Algorithms',
        skills: ['Data structures', 'Algorithms', 'Time/space complexity'],
        minProficiency: 'expert',
        importance: 'required',
      },
      {
        area: 'System Design',
        skills: ['Distributed systems', 'Scalability', 'Database design'],
        minProficiency: 'advanced',
        importance: 'required',
      },
    ],
    experienceRequirements: [
      'Strong coding ability',
      'Experience with large codebases',
      'Shipped production software',
    ],
    softSkillRequirements: ['Googleyness', 'Collaboration', 'Leadership'],
    culturalFit: ['Data-driven', 'User-focused', 'Innovative'],
    educationPreferences: ['CS degree preferred', 'Equivalent experience accepted'],
    interviewProcess: [
      {
        name: 'Recruiter Screen',
        description: 'Initial call',
        duration: '30 minutes',
        focus: ['Background', 'Interest'],
        tips: ['Know Google products'],
      },
      {
        name: 'Technical Screens',
        description: '2 coding interviews',
        duration: '45 minutes each',
        focus: ['Algorithms', 'Data structures'],
        tips: ['LeetCode hard practice'],
      },
      {
        name: 'Onsite',
        description: '4-5 interviews',
        duration: 'Full day',
        focus: ['Coding', 'System design', 'Behavioral', 'Googleyness'],
        tips: ['Show collaboration', 'Think out loud'],
      },
    ],
    interviewDifficulty: 'very-hard',
    typicalTimelineWeeks: 6,
    interviewTips: ['Focus on algorithms', 'Practice system design at scale'],
    salaryRange: {
      min: 140000,
      max: 400000,
      currency: 'GBP',
      period: 'yearly',
      includesBonus: true,
      includesEquity: true,
    },
    benefits: ['RSUs', '15% bonus', 'Health', 'Free food', 'Learning budget'],
    whatGetsYouNoticed: ['Open source', 'Prior FAANG', 'Strong referral'],
    redFlagsToAvoid: ['Poor algorithms', 'Not collaborative'],
    successStories: [],
  },

  stripe: {
    name: 'Stripe',
    tier: 'unicorn',
    website: 'https://stripe.com',
    careersUrl: 'https://stripe.com/jobs',
    technicalRequirements: [
      {
        area: 'Languages',
        skills: ['Ruby', 'Go', 'TypeScript', 'Java'],
        minProficiency: 'advanced',
        importance: 'required',
      },
      {
        area: 'APIs',
        skills: ['REST APIs', 'API design', 'Developer experience'],
        minProficiency: 'advanced',
        importance: 'required',
      },
      {
        area: 'Payments',
        skills: ['Payments systems', 'Financial regulations', 'Security'],
        minProficiency: 'intermediate',
        importance: 'preferred',
      },
    ],
    experienceRequirements: ['API experience', 'Attention to detail', 'User empathy'],
    softSkillRequirements: ['Writing ability', 'User focus', 'Rigor'],
    culturalFit: ['User obsessed', 'Attention to craft', 'Long-term thinking'],
    educationPreferences: ['Not required', 'Strong portfolio valued'],
    interviewProcess: [
      {
        name: 'Recruiter Screen',
        description: 'Initial call',
        duration: '30 minutes',
        focus: ['Background', 'Interest in Stripe'],
        tips: ['Know Stripe products'],
      },
      {
        name: 'Technical Screen',
        description: 'Pair programming',
        duration: '1 hour',
        focus: ['Coding', 'Collaboration'],
        tips: ['Practice pairing'],
      },
      {
        name: 'Onsite/Virtual',
        description: '4-5 interviews',
        duration: 'Full day',
        focus: ['Coding', 'System design', 'Integration', 'Values'],
        tips: ['Show craft', 'Ask good questions'],
      },
    ],
    interviewDifficulty: 'hard',
    typicalTimelineWeeks: 4,
    interviewTips: ['Focus on API design', 'Show attention to edge cases'],
    salaryRange: {
      min: 130000,
      max: 350000,
      currency: 'GBP',
      period: 'yearly',
      includesBonus: true,
      includesEquity: true,
    },
    benefits: ['RSUs', 'Remote-friendly', 'Learning'],
    whatGetsYouNoticed: ['Open source', 'Developer tools experience'],
    redFlagsToAvoid: ['Sloppy code', 'Poor communication'],
    successStories: [],
  },
};

// ============================================================================
// Skills Gap Analyzer
// ============================================================================

export class SkillsGapAnalyzer extends EventEmitter {
  private profileManager = getCareerProfileManager();

  constructor() {
    super();
  }

  // --------------------------------------------------------------------------
  // Gap Analysis
  // --------------------------------------------------------------------------

  async analyzeGapForCompany(
    companyName: string,
    targetRole?: string
  ): Promise<SkillsGapAnalysis> {
    const profile = this.profileManager.getProfile();
    if (!profile) {
      throw new Error('No career profile found. Please create one first.');
    }

    // Get company requirements
    const companyKey = companyName.toLowerCase().replace(/\s+/g, '-');
    const companyProfile = ELITE_COMPANY_PROFILES[companyKey];

    if (!companyProfile) {
      // Use generic analysis for unknown companies
      return this.analyzeGapGeneric(companyName, targetRole || 'Software Engineer');
    }

    // Extract current skills
    const currentSkills = profile.skills.technical.map((s) => s.name.toLowerCase());

    // Extract required skills
    const requiredSkills: string[] = [];
    const bonusSkills: string[] = [];

    for (const req of companyProfile.technicalRequirements) {
      for (const skill of req.skills) {
        if (req.importance === 'required' || req.importance === 'preferred') {
          requiredSkills.push(skill.toLowerCase());
        } else {
          bonusSkills.push(skill.toLowerCase());
        }
      }
    }

    // Calculate matches and gaps
    const matchedSkills = currentSkills.filter((s) => requiredSkills.includes(s));
    const gapSkills = requiredSkills.filter((s) => !currentSkills.includes(s));
    const userBonusSkills = currentSkills.filter((s) => bonusSkills.includes(s));

    // Calculate readiness scores
    const technicalReadiness = Math.round((matchedSkills.length / requiredSkills.length) * 100);

    // Experience readiness (rough heuristic)
    const yearsRequired = companyProfile.tier === 'faang' ? 3 : 2;
    const experienceReadiness = Math.min(100, Math.round((profile.yearsOfExperience / yearsRequired) * 100));

    // Soft skills readiness (estimate based on profile completeness)
    const softSkillsCount = profile.skills.soft.length;
    const softSkillsReadiness = Math.min(100, softSkillsCount * 20);

    // Overall readiness (weighted average)
    const overallReadiness = Math.round(
      technicalReadiness * 0.5 + experienceReadiness * 0.3 + softSkillsReadiness * 0.2
    );

    // Generate learning plans for gap skills
    const prioritySkillsToLearn = this.generateLearningPlans(gapSkills, companyProfile);

    // Generate suggested projects
    const projectsToComplete = this.suggestProjects(gapSkills, companyProfile);

    // Generate certification suggestions
    const certificationsToGet = this.suggestCertifications(companyProfile);

    // Build roadmap
    const roadmap = this.buildRoadmap(prioritySkillsToLearn, projectsToComplete, certificationsToGet);

    // Estimate time to readiness
    const estimatedTimeToReadiness = this.estimateTimeToReadiness(overallReadiness, gapSkills.length);

    const analysis: SkillsGapAnalysis = {
      targetCompany: companyProfile.name,
      targetRole: targetRole || 'Software Engineer',
      analyzedAt: Date.now(),
      currentSkills,
      requiredSkills,
      matchedSkills,
      gapSkills,
      bonusSkills: userBonusSkills,
      overallReadiness,
      technicalReadiness,
      experienceReadiness,
      softSkillsReadiness,
      prioritySkillsToLearn,
      projectsToComplete,
      certificationsToGet,
      experienceToGain: companyProfile.experienceRequirements.filter(
        (exp) => !this.hasExperience(profile, exp)
      ),
      estimatedTimeToReadiness,
      roadmap,
    };

    this.emit('analysis-complete', analysis);
    return analysis;
  }

  private analyzeGapGeneric(companyName: string, targetRole: string): SkillsGapAnalysis {
    const profile = this.profileManager.getProfile();
    if (!profile) throw new Error('No profile');

    // Generic software engineering requirements
    const genericRequired = [
      'javascript', 'typescript', 'python', 'sql', 'git',
      'data structures', 'algorithms', 'system design',
      'rest apis', 'testing',
    ];

    const currentSkills = profile.skills.technical.map((s) => s.name.toLowerCase());
    const matchedSkills = currentSkills.filter((s) =>
      genericRequired.some((r) => s.includes(r) || r.includes(s))
    );
    const gapSkills = genericRequired.filter((s) =>
      !currentSkills.some((c) => c.includes(s) || s.includes(c))
    );

    const technicalReadiness = Math.round((matchedSkills.length / genericRequired.length) * 100);

    return {
      targetCompany: companyName,
      targetRole,
      analyzedAt: Date.now(),
      currentSkills,
      requiredSkills: genericRequired,
      matchedSkills,
      gapSkills,
      bonusSkills: [],
      overallReadiness: technicalReadiness,
      technicalReadiness,
      experienceReadiness: Math.min(100, profile.yearsOfExperience * 25),
      softSkillsReadiness: profile.skills.soft.length * 20,
      prioritySkillsToLearn: gapSkills.map((skill) => ({
        skill,
        importance: 'important' as const,
        currentLevel: 'none' as const,
        targetLevel: 'intermediate' as ProficiencyLevel,
        estimatedTime: '2-4 weeks',
        resources: [],
        milestones: [`Complete ${skill} basics`, `Build project using ${skill}`],
      })),
      projectsToComplete: [],
      certificationsToGet: [],
      experienceToGain: [],
      estimatedTimeToReadiness: gapSkills.length > 5 ? '6-12 months' : '3-6 months',
      roadmap: {
        phases: [],
        checkpoints: [],
        estimatedCompletion: Date.now() + 180 * 24 * 60 * 60 * 1000,
      },
    };
  }

  // --------------------------------------------------------------------------
  // Learning Plan Generation
  // --------------------------------------------------------------------------

  private generateLearningPlans(
    gapSkills: string[],
    company: EliteCompanyProfile
  ): SkillLearningPlan[] {
    const plans: SkillLearningPlan[] = [];

    for (const skill of gapSkills) {
      // Find the requirement this skill belongs to
      const req = company.technicalRequirements.find((r) =>
        r.skills.some((s) => s.toLowerCase() === skill)
      );

      const importance = req?.importance === 'required' ? 'critical' : 'important';
      const targetLevel = req?.minProficiency || 'intermediate';

      const resources = this.getResourcesForSkill(skill);

      plans.push({
        skill,
        importance: importance as 'critical' | 'important' | 'nice-to-have',
        currentLevel: 'none',
        targetLevel: targetLevel as ProficiencyLevel,
        estimatedTime: this.estimateLearningTime(skill, targetLevel as ProficiencyLevel),
        resources,
        milestones: this.generateMilestones(skill, targetLevel as ProficiencyLevel),
      });
    }

    // Sort by importance
    plans.sort((a, b) => {
      const order = { critical: 0, important: 1, 'nice-to-have': 2 };
      return order[a.importance] - order[b.importance];
    });

    return plans;
  }

  private getResourcesForSkill(skill: string): LearningResource[] {
    const resources: LearningResource[] = [];
    const skillLower = skill.toLowerCase();

    // Add specific resources based on skill
    if (skillLower.includes('python')) {
      resources.push(
        { name: 'Python for Everybody (Coursera)', type: 'course', cost: 'free', estimatedHours: 60, difficulty: 'beginner' },
        { name: 'Automate the Boring Stuff with Python', type: 'book', cost: 'free', estimatedHours: 40, difficulty: 'beginner' },
        { name: 'LeetCode Python track', type: 'practice', cost: 'free', difficulty: 'intermediate' }
      );
    }

    if (skillLower.includes('system design') || skillLower.includes('distributed')) {
      resources.push(
        { name: 'Designing Data-Intensive Applications', type: 'book', cost: 'paid', estimatedHours: 50, difficulty: 'advanced' },
        { name: 'System Design Interview (Alex Xu)', type: 'book', cost: 'paid', estimatedHours: 30, difficulty: 'intermediate' },
        { name: 'Grokking System Design', type: 'course', cost: 'paid', estimatedHours: 20, difficulty: 'intermediate' }
      );
    }

    if (skillLower.includes('algorithm') || skillLower.includes('data structure')) {
      resources.push(
        { name: 'LeetCode Premium', type: 'practice', cost: 'paid', estimatedHours: 100, difficulty: 'intermediate' },
        { name: 'NeetCode.io', type: 'course', cost: 'free', estimatedHours: 50, difficulty: 'intermediate' },
        { name: 'Cracking the Coding Interview', type: 'book', cost: 'paid', estimatedHours: 40, difficulty: 'intermediate' }
      );
    }

    if (skillLower.includes('java')) {
      resources.push(
        { name: 'Java Programming Masterclass (Udemy)', type: 'course', cost: 'paid', estimatedHours: 80, difficulty: 'beginner' },
        { name: 'Effective Java', type: 'book', cost: 'paid', estimatedHours: 30, difficulty: 'intermediate' }
      );
    }

    if (skillLower.includes('kubernetes') || skillLower.includes('docker')) {
      resources.push(
        { name: 'Docker & Kubernetes: The Practical Guide', type: 'course', cost: 'paid', estimatedHours: 24, difficulty: 'intermediate' },
        { name: 'CKA Certification', type: 'certification', cost: 'paid', estimatedHours: 60, difficulty: 'advanced' }
      );
    }

    if (skillLower.includes('aws')) {
      resources.push(
        { name: 'AWS Solutions Architect Associate', type: 'certification', cost: 'paid', estimatedHours: 60, difficulty: 'intermediate' },
        { name: 'A Cloud Guru', type: 'course', cost: 'paid', estimatedHours: 40, difficulty: 'intermediate' }
      );
    }

    // Generic fallback
    if (resources.length === 0) {
      resources.push(
        { name: `${skill} official documentation`, type: 'tutorial', cost: 'free', difficulty: 'beginner' },
        { name: `Build a project with ${skill}`, type: 'project', cost: 'free', difficulty: 'intermediate' }
      );
    }

    return resources;
  }

  private estimateLearningTime(skill: string, targetLevel: ProficiencyLevel): string {
    const baseTime: Record<ProficiencyLevel, number> = {
      learning: 1,
      beginner: 2,
      intermediate: 4,
      advanced: 8,
      expert: 16,
    };

    const weeks = baseTime[targetLevel];

    if (weeks <= 2) return `${weeks} weeks`;
    if (weeks <= 8) return `${weeks} weeks`;
    return `${Math.round(weeks / 4)} months`;
  }

  private generateMilestones(skill: string, targetLevel: ProficiencyLevel): string[] {
    const milestones: string[] = [];

    milestones.push(`Complete ${skill} fundamentals`);
    milestones.push(`Build a small project using ${skill}`);

    if (targetLevel === 'intermediate' || targetLevel === 'advanced' || targetLevel === 'expert') {
      milestones.push(`Solve 20 practice problems involving ${skill}`);
      milestones.push(`Build a portfolio project showcasing ${skill}`);
    }

    if (targetLevel === 'advanced' || targetLevel === 'expert') {
      milestones.push(`Contribute to open source project using ${skill}`);
      milestones.push(`Write a blog post or give a talk about ${skill}`);
    }

    return milestones;
  }

  // --------------------------------------------------------------------------
  // Project Suggestions
  // --------------------------------------------------------------------------

  private suggestProjects(
    gapSkills: string[],
    company: EliteCompanyProfile
  ): SuggestedProject[] {
    const projects: SuggestedProject[] = [];

    // Company-specific project ideas
    if (company.name.toLowerCase().includes('palantir')) {
      projects.push({
        title: 'Data Integration Platform',
        description: 'Build a system that ingests data from multiple sources, transforms it, and provides a unified query interface.',
        skills: ['Python', 'SQL', 'Data pipelines', 'REST APIs'],
        estimatedTime: '4-6 weeks',
        difficulty: 'advanced',
        portfolioValue: 'high',
        inspiration: ['Mini Palantir Foundry', 'Apache Airflow-like workflow'],
      });

      projects.push({
        title: 'Distributed Graph Database',
        description: 'Implement a simple distributed graph database with basic query capabilities.',
        skills: ['Java', 'Distributed systems', 'Data structures'],
        estimatedTime: '6-8 weeks',
        difficulty: 'advanced',
        portfolioValue: 'high',
      });
    }

    // Generic high-value projects based on gap skills
    if (gapSkills.some((s) => s.includes('system design') || s.includes('distributed'))) {
      projects.push({
        title: 'URL Shortener at Scale',
        description: 'Build a URL shortener that can handle millions of requests, with analytics.',
        skills: ['System design', 'Databases', 'Caching', 'APIs'],
        estimatedTime: '2-3 weeks',
        difficulty: 'intermediate',
        portfolioValue: 'medium',
      });
    }

    if (gapSkills.some((s) => s.includes('data') || s.includes('etl'))) {
      projects.push({
        title: 'Real-time Analytics Dashboard',
        description: 'Build a dashboard that processes streaming data and shows real-time metrics.',
        skills: ['Data pipelines', 'Streaming', 'Visualization'],
        estimatedTime: '3-4 weeks',
        difficulty: 'intermediate',
        portfolioValue: 'high',
      });
    }

    return projects;
  }

  // --------------------------------------------------------------------------
  // Certification Suggestions
  // --------------------------------------------------------------------------

  private suggestCertifications(company: EliteCompanyProfile): SuggestedCertification[] {
    const certs: SuggestedCertification[] = [];

    // AWS certifications are universally valuable
    certs.push({
      name: 'AWS Solutions Architect Associate',
      issuer: 'Amazon Web Services',
      relevance: 'recommended',
      cost: 300,
      studyTime: '2-3 months',
      url: 'https://aws.amazon.com/certification/certified-solutions-architect-associate/',
    });

    // Kubernetes for infrastructure-heavy roles
    if (company.technicalRequirements.some((r) =>
      r.skills.some((s) => s.toLowerCase().includes('kubernetes'))
    )) {
      certs.push({
        name: 'Certified Kubernetes Administrator (CKA)',
        issuer: 'CNCF',
        relevance: 'recommended',
        cost: 395,
        studyTime: '1-2 months',
        url: 'https://www.cncf.io/certification/cka/',
      });
    }

    return certs;
  }

  // --------------------------------------------------------------------------
  // Roadmap Building
  // --------------------------------------------------------------------------

  private buildRoadmap(
    skills: SkillLearningPlan[],
    projects: SuggestedProject[],
    certs: SuggestedCertification[]
  ): LearningRoadmap {
    const phases: LearningPhase[] = [];
    const now = Date.now();

    // Phase 1: Critical skills (first 2-3 months)
    const criticalSkills = skills.filter((s) => s.importance === 'critical');
    if (criticalSkills.length > 0) {
      phases.push({
        name: 'Foundation Building',
        description: 'Master the critical skills required for your target role',
        duration: '2-3 months',
        skills: criticalSkills.slice(0, 3).map((s) => s.skill),
        projects: [],
        certifications: [],
      });
    }

    // Phase 2: Portfolio projects (months 3-5)
    if (projects.length > 0) {
      phases.push({
        name: 'Portfolio Development',
        description: 'Build impressive projects that demonstrate your skills',
        duration: '2-3 months',
        skills: [],
        projects: projects.slice(0, 2).map((p) => p.title),
        certifications: [],
      });
    }

    // Phase 3: Advanced skills + interview prep (months 5-8)
    const advancedSkills = skills.filter((s) => s.importance === 'important');
    phases.push({
      name: 'Interview Preparation',
      description: 'Polish advanced skills and prepare for interviews',
      duration: '2-3 months',
      skills: advancedSkills.slice(0, 3).map((s) => s.skill),
      projects: [],
      certifications: certs.slice(0, 1).map((c) => c.name),
    });

    // Calculate estimated completion
    const totalWeeks = phases.reduce((sum, p) => {
      const months = parseInt(p.duration.split('-')[1]) || 3;
      return sum + months * 4;
    }, 0);

    return {
      phases,
      checkpoints: [
        {
          name: 'Ready for initial applications',
          at: now + 12 * 7 * 24 * 60 * 60 * 1000, // 12 weeks
          criteria: ['Critical skills at intermediate level', 'One portfolio project complete'],
          reward: 'Can apply to mid-tier companies',
        },
        {
          name: 'Target company ready',
          at: now + totalWeeks * 7 * 24 * 60 * 60 * 1000,
          criteria: ['All critical skills at advanced level', 'Portfolio complete', 'LeetCode patterns mastered'],
          reward: 'Ready to apply to dream companies',
        },
      ],
      estimatedCompletion: now + totalWeeks * 7 * 24 * 60 * 60 * 1000,
    };
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private hasExperience(profile: any, requirement: string): boolean {
    const reqLower = requirement.toLowerCase();

    // Check work history descriptions
    for (const job of profile.workHistory) {
      if (
        job.description.toLowerCase().includes(reqLower) ||
        job.achievements.some((a: string) => a.toLowerCase().includes(reqLower))
      ) {
        return true;
      }
    }

    // Check projects
    for (const project of profile.projects) {
      if (
        project.description.toLowerCase().includes(reqLower) ||
        project.highlights.some((h: string) => h.toLowerCase().includes(reqLower))
      ) {
        return true;
      }
    }

    return false;
  }

  private estimateTimeToReadiness(currentReadiness: number, gapCount: number): string {
    if (currentReadiness >= 80 && gapCount <= 2) return '1-2 months';
    if (currentReadiness >= 60 && gapCount <= 4) return '3-6 months';
    if (currentReadiness >= 40) return '6-12 months';
    return '12-18 months';
  }

  // --------------------------------------------------------------------------
  // Company Database Access
  // --------------------------------------------------------------------------

  getEliteCompanyProfile(companyName: string): EliteCompanyProfile | undefined {
    const key = companyName.toLowerCase().replace(/\s+/g, '-');
    return ELITE_COMPANY_PROFILES[key];
  }

  getAvailableCompanies(): string[] {
    return Object.values(ELITE_COMPANY_PROFILES).map((c) => c.name);
  }

  addCustomCompanyProfile(profile: EliteCompanyProfile): void {
    const key = profile.name.toLowerCase().replace(/\s+/g, '-');
    ELITE_COMPANY_PROFILES[key] = profile;
    logger.info(`Added custom company profile: ${profile.name}`);
  }

  /**
   * Build a learning roadmap for a target company and role.
   * This is a public wrapper that runs a full gap analysis and returns just the roadmap.
   */
  async buildLearningRoadmap(
    targetCompany: string,
    targetRole?: string
  ): Promise<LearningRoadmap> {
    const analysis = await this.analyzeGapForCompany(targetCompany, targetRole);
    return analysis.roadmap;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: SkillsGapAnalyzer | null = null;

export function getSkillsGapAnalyzer(): SkillsGapAnalyzer {
  if (!instance) {
    instance = new SkillsGapAnalyzer();
  }
  return instance;
}

export default SkillsGapAnalyzer;
