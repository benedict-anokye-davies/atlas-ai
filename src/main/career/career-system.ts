/**
 * Atlas Career System - Career Discovery & Planning
 *
 * AI-powered career guidance for:
 * - Role discovery through structured questions
 * - Skill gap analysis
 * - Portfolio tracking
 * - Internship/job planning
 * - CV/LinkedIn optimization
 *
 * @module career/career-system
 */

import { createModuleLogger } from '../utils/logger';
import { getJarvisBrain } from '../cognitive';
import { count } from '../../shared/utils';
import * as fs from 'fs';
import * as path from 'path';

const logger = createModuleLogger('CareerSystem');

// ============================================================================
// Types
// ============================================================================

export interface CareerProfile {
  id: string;
  userId: string;
  createdAt: number;
  updatedAt: number;
  
  // Discovery Results
  interests: string[];
  strengths: string[];
  values: string[];
  preferredWorkStyle: WorkStyle;
  targetRoles: TargetRole[];
  
  // Skills
  technicalSkills: Skill[];
  softSkills: Skill[];
  certifications: Certification[];
  
  // Experience
  education: Education[];
  projects: Project[];
  experiences: Experience[];
  
  // Goals
  shortTermGoals: Goal[];
  longTermGoals: Goal[];
  
  // Progress
  milestones: Milestone[];
  weeklyReflections: WeeklyReflection[];
}

export interface WorkStyle {
  remote: 'prefer' | 'neutral' | 'avoid';
  teamSize: 'small' | 'medium' | 'large' | 'any';
  pace: 'fast' | 'moderate' | 'relaxed';
  structure: 'structured' | 'flexible' | 'autonomous';
  creativity: number; // 0-1
  technicalDepth: number; // 0-1
}

export interface TargetRole {
  id: string;
  title: string;
  industry: string;
  seniority: 'intern' | 'entry' | 'mid' | 'senior';
  matchScore: number; // 0-1
  requiredSkills: string[];
  niceToHaveSkills: string[];
  typicalSalary: { min: number; max: number; currency: string };
  growthOutlook: 'declining' | 'stable' | 'growing' | 'booming';
  notes: string;
}

export interface Skill {
  id: string;
  name: string;
  category: string;
  level: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  yearsExperience: number;
  lastUsed: number;
  evidence: string[];
  targetLevel?: 'intermediate' | 'advanced' | 'expert';
}

export interface Certification {
  name: string;
  issuer: string;
  dateObtained?: number;
  expiryDate?: number;
  inProgress: boolean;
  verificationUrl?: string;
}

export interface Education {
  institution: string;
  degree: string;
  field: string;
  startDate: number;
  endDate?: number;
  grade?: string;
  achievements: string[];
}

export interface Project {
  id: string;
  name: string;
  description: string;
  technologies: string[];
  url?: string;
  githubUrl?: string;
  startDate: number;
  endDate?: number;
  highlights: string[];
  metrics?: string[];
  isPortfolio: boolean;
}

export interface Experience {
  id: string;
  company: string;
  role: string;
  type: 'fulltime' | 'parttime' | 'internship' | 'freelance' | 'volunteer';
  startDate: number;
  endDate?: number;
  description: string;
  achievements: string[];
  technologies: string[];
}

export interface Goal {
  id: string;
  title: string;
  description: string;
  deadline?: number;
  priority: 'high' | 'medium' | 'low';
  status: 'not-started' | 'in-progress' | 'completed' | 'blocked';
  steps: GoalStep[];
}

export interface GoalStep {
  id: string;
  description: string;
  completed: boolean;
  completedAt?: number;
}

export interface Milestone {
  id: string;
  title: string;
  description: string;
  achievedAt: number;
  category: 'skill' | 'project' | 'application' | 'interview' | 'offer' | 'other';
}

export interface WeeklyReflection {
  weekStart: number;
  accomplishments: string[];
  challenges: string[];
  learnings: string[];
  nextWeekGoals: string[];
}

export interface DiscoveryQuestion {
  id: string;
  category: 'interests' | 'strengths' | 'values' | 'workstyle' | 'experience';
  question: string;
  type: 'multiple-choice' | 'scale' | 'open' | 'ranking';
  options?: string[];
  followUp?: string;
}

export interface DiscoverySession {
  id: string;
  startedAt: number;
  completedAt?: number;
  answers: DiscoveryAnswer[];
  recommendations: RoleRecommendation[];
}

export interface DiscoveryAnswer {
  questionId: string;
  answer: string | number | string[];
  timestamp: number;
}

export interface RoleRecommendation {
  role: string;
  matchScore: number;
  reasons: string[];
  skillGaps: string[];
  nextSteps: string[];
}

// ============================================================================
// Discovery Questions Bank
// ============================================================================

const DISCOVERY_QUESTIONS: DiscoveryQuestion[] = [
  // Interests
  {
    id: 'int-1',
    category: 'interests',
    question: 'Which of these activities do you find most engaging?',
    type: 'ranking',
    options: [
      'Building things from scratch',
      'Solving complex puzzles',
      'Analyzing data to find insights',
      'Designing user experiences',
      'Working with cutting-edge technology',
      'Automating repetitive tasks',
      'Teaching or explaining concepts',
      'Leading projects or teams',
    ],
  },
  {
    id: 'int-2',
    category: 'interests',
    question: 'What type of problems do you enjoy solving?',
    type: 'multiple-choice',
    options: [
      'Technical challenges (algorithms, architecture)',
      'Business problems (growth, efficiency)',
      'Research problems (unknowns, innovation)',
      'Creative problems (design, user experience)',
      'People problems (communication, collaboration)',
    ],
  },
  {
    id: 'int-3',
    category: 'interests',
    question: 'Which domain excites you the most?',
    type: 'multiple-choice',
    options: [
      'AI/Machine Learning',
      'Web/Mobile Development',
      'Systems/Infrastructure',
      'Data Science/Analytics',
      'Cybersecurity',
      'Game Development',
      'Finance/Fintech',
      'Healthcare/Biotech',
    ],
  },
  
  // Strengths
  {
    id: 'str-1',
    category: 'strengths',
    question: 'Rate your comfort with ambiguity and undefined problems.',
    type: 'scale',
    followUp: 'High comfort suggests research/startup roles; lower suggests established companies.',
  },
  {
    id: 'str-2',
    category: 'strengths',
    question: 'How do you prefer to learn new technologies?',
    type: 'multiple-choice',
    options: [
      'Deep dive into documentation and theory',
      'Build projects and learn by doing',
      'Follow tutorials and courses',
      'Pair with someone experienced',
      'Read code and reverse engineer',
    ],
  },
  {
    id: 'str-3',
    category: 'strengths',
    question: 'What do others often come to you for help with?',
    type: 'open',
  },
  
  // Values
  {
    id: 'val-1',
    category: 'values',
    question: 'Rank these workplace factors by importance to you.',
    type: 'ranking',
    options: [
      'Salary and compensation',
      'Work-life balance',
      'Learning and growth opportunities',
      'Impact and meaningful work',
      'Team culture and colleagues',
      'Job security and stability',
      'Autonomy and flexibility',
      'Prestige and recognition',
    ],
  },
  {
    id: 'val-2',
    category: 'values',
    question: 'How important is it to work on products used by millions?',
    type: 'scale',
  },
  
  // Work Style
  {
    id: 'ws-1',
    category: 'workstyle',
    question: 'Do you prefer working in a team or independently?',
    type: 'scale',
    followUp: '1 = Mostly independent, 10 = Highly collaborative',
  },
  {
    id: 'ws-2',
    category: 'workstyle',
    question: 'What pace of work suits you best?',
    type: 'multiple-choice',
    options: [
      'Fast-paced with frequent deadlines (startup energy)',
      'Moderate with structured sprints',
      'Relaxed with time for deep thinking',
      'Variable depending on project phase',
    ],
  },
  {
    id: 'ws-3',
    category: 'workstyle',
    question: 'Preferred work arrangement?',
    type: 'multiple-choice',
    options: [
      'Fully remote',
      'Hybrid (2-3 days office)',
      'Mostly office',
      'No preference',
    ],
  },
  
  // Experience
  {
    id: 'exp-1',
    category: 'experience',
    question: 'What programming languages are you most comfortable with?',
    type: 'open',
  },
  {
    id: 'exp-2',
    category: 'experience',
    question: 'Describe a project you\'re most proud of.',
    type: 'open',
  },
  {
    id: 'exp-3',
    category: 'experience',
    question: 'What\'s the most complex technical problem you\'ve solved?',
    type: 'open',
  },
];

// ============================================================================
// Role Database
// ============================================================================

interface RoleDefinition {
  title: string;
  aliases: string[];
  industry: string;
  description: string;
  requiredSkills: string[];
  niceToHaveSkills: string[];
  matchCriteria: {
    interests: string[];
    strengths: string[];
    values: string[];
  };
  typicalPath: string[];
  salaryRange: { min: number; max: number; currency: string };
  growthOutlook: 'declining' | 'stable' | 'growing' | 'booming';
}

const ROLE_DATABASE: RoleDefinition[] = [
  {
    title: 'Software Engineer',
    aliases: ['SWE', 'Developer', 'Programmer'],
    industry: 'Technology',
    description: 'Design, develop, and maintain software systems.',
    requiredSkills: ['Programming', 'Data Structures', 'Algorithms', 'Git'],
    niceToHaveSkills: ['System Design', 'Cloud', 'Testing'],
    matchCriteria: {
      interests: ['Building things from scratch', 'Solving complex puzzles'],
      strengths: ['Technical challenges'],
      values: ['Learning and growth opportunities'],
    },
    typicalPath: ['Intern', 'Junior SWE', 'SWE', 'Senior SWE', 'Staff/Principal'],
    salaryRange: { min: 35000, max: 150000, currency: 'GBP' },
    growthOutlook: 'growing',
  },
  {
    title: 'Machine Learning Engineer',
    aliases: ['ML Engineer', 'AI Engineer'],
    industry: 'AI/ML',
    description: 'Build and deploy machine learning models in production.',
    requiredSkills: ['Python', 'ML Frameworks', 'Linear Algebra', 'Statistics'],
    niceToHaveSkills: ['Deep Learning', 'MLOps', 'Distributed Systems'],
    matchCriteria: {
      interests: ['AI/Machine Learning', 'Analyzing data'],
      strengths: ['Research problems'],
      values: ['Impact and meaningful work'],
    },
    typicalPath: ['ML Intern', 'Junior ML Engineer', 'ML Engineer', 'Senior ML Engineer'],
    salaryRange: { min: 45000, max: 180000, currency: 'GBP' },
    growthOutlook: 'booming',
  },
  {
    title: 'Quantitative Developer',
    aliases: ['Quant Dev', 'Algo Developer'],
    industry: 'Finance',
    description: 'Build trading systems and financial models.',
    requiredSkills: ['C++', 'Python', 'Mathematics', 'Statistics'],
    niceToHaveSkills: ['Finance Knowledge', 'Low Latency Systems', 'ML'],
    matchCriteria: {
      interests: ['Finance/Fintech', 'Solving complex puzzles'],
      strengths: ['Technical challenges'],
      values: ['Salary and compensation'],
    },
    typicalPath: ['Quant Intern', 'Junior Quant', 'Quant Developer', 'Senior Quant'],
    salaryRange: { min: 60000, max: 300000, currency: 'GBP' },
    growthOutlook: 'growing',
  },
  {
    title: 'Data Scientist',
    aliases: ['DS'],
    industry: 'Data/Analytics',
    description: 'Extract insights from data to drive business decisions.',
    requiredSkills: ['Python/R', 'Statistics', 'SQL', 'Data Visualization'],
    niceToHaveSkills: ['ML', 'Business Acumen', 'Communication'],
    matchCriteria: {
      interests: ['Analyzing data to find insights'],
      strengths: ['Business problems'],
      values: ['Impact and meaningful work'],
    },
    typicalPath: ['Data Analyst', 'Junior DS', 'Data Scientist', 'Senior DS', 'Lead DS'],
    salaryRange: { min: 40000, max: 130000, currency: 'GBP' },
    growthOutlook: 'growing',
  },
  {
    title: 'Full-Stack Developer',
    aliases: ['Full-Stack Engineer'],
    industry: 'Web Development',
    description: 'Build both frontend and backend of web applications.',
    requiredSkills: ['JavaScript', 'HTML/CSS', 'Backend Framework', 'Databases'],
    niceToHaveSkills: ['React/Vue', 'Node.js', 'Cloud', 'DevOps'],
    matchCriteria: {
      interests: ['Building things from scratch', 'Web/Mobile Development'],
      strengths: ['Build projects and learn by doing'],
      values: ['Learning and growth opportunities'],
    },
    typicalPath: ['Intern', 'Junior Developer', 'Developer', 'Senior Developer'],
    salaryRange: { min: 35000, max: 120000, currency: 'GBP' },
    growthOutlook: 'growing',
  },
  {
    title: 'DevOps Engineer',
    aliases: ['Site Reliability Engineer', 'SRE', 'Platform Engineer'],
    industry: 'Infrastructure',
    description: 'Build and maintain CI/CD pipelines and infrastructure.',
    requiredSkills: ['Linux', 'Cloud (AWS/GCP/Azure)', 'Docker', 'CI/CD'],
    niceToHaveSkills: ['Kubernetes', 'Terraform', 'Monitoring'],
    matchCriteria: {
      interests: ['Systems/Infrastructure', 'Automating repetitive tasks'],
      strengths: ['Technical challenges'],
      values: ['Autonomy and flexibility'],
    },
    typicalPath: ['Junior DevOps', 'DevOps Engineer', 'Senior DevOps', 'Staff/Principal'],
    salaryRange: { min: 45000, max: 140000, currency: 'GBP' },
    growthOutlook: 'booming',
  },
];

// ============================================================================
// Career System
// ============================================================================

export class CareerSystem {
  private profile: CareerProfile | null = null;
  private currentDiscovery: DiscoverySession | null = null;
  private dataDir: string;

  constructor(dataDir?: string) {
    this.dataDir = dataDir || path.join(process.env.APPDATA || '', 'atlas-desktop', 'career');
    this.ensureDataDir();
    this.loadProfile();
    logger.info('CareerSystem initialized', { dataDir: this.dataDir });
  }

  private ensureDataDir(): void {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  private async loadProfile(): Promise<void> {
    try {
      const profilePath = path.join(this.dataDir, 'profile.json');
      // Use async file operations to avoid blocking main thread
      const exists = await fs.promises.access(profilePath).then(() => true).catch(() => false);
      if (exists) {
        const data = await fs.promises.readFile(profilePath, 'utf-8');
        this.profile = JSON.parse(data);
        logger.info('Career profile loaded');
      }
    } catch (error) {
      logger.error('Failed to load career profile', { error: (error as Error).message });
    }
  }

  private async saveProfile(): Promise<void> {
    if (!this.profile) return;
    try {
      // Use async file operations to avoid blocking main thread
      await fs.promises.writeFile(
        path.join(this.dataDir, 'profile.json'),
        JSON.stringify(this.profile, null, 2)
      );
    } catch (error) {
      logger.error('Failed to save career profile', { error: (error as Error).message });
    }
  }

  // ==========================================================================
  // Profile Management
  // ==========================================================================

  initializeProfile(userId: string): CareerProfile {
    this.profile = {
      id: `profile-${Date.now()}`,
      userId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      interests: [],
      strengths: [],
      values: [],
      preferredWorkStyle: {
        remote: 'neutral',
        teamSize: 'any',
        pace: 'moderate',
        structure: 'flexible',
        creativity: 0.5,
        technicalDepth: 0.5,
      },
      targetRoles: [],
      technicalSkills: [],
      softSkills: [],
      certifications: [],
      education: [{
        institution: 'University of Nottingham',
        degree: 'BSc',
        field: 'Computer Science with AI',
        startDate: Date.now() - 4 * 30 * 24 * 60 * 60 * 1000, // ~4 months ago
        achievements: [],
      }],
      projects: [],
      experiences: [],
      shortTermGoals: [],
      longTermGoals: [],
      milestones: [],
      weeklyReflections: [],
    };

    this.saveProfile();
    
    // Learn to brain
    const brain = getJarvisBrain();
    if (brain) {
      brain.learn({
        subject: 'Ben',
        predicate: 'is studying',
        object: 'Computer Science with AI at University of Nottingham, first year',
        confidence: 1.0,
        source: 'career-system',
      });
    }

    logger.info('Career profile initialized', { userId });
    return this.profile;
  }

  getProfile(): CareerProfile | null {
    return this.profile;
  }

  // ==========================================================================
  // Career Discovery
  // ==========================================================================

  startDiscoverySession(): DiscoverySession {
    this.currentDiscovery = {
      id: `discovery-${Date.now()}`,
      startedAt: Date.now(),
      answers: [],
      recommendations: [],
    };
    logger.info('Discovery session started');
    return this.currentDiscovery;
  }

  getNextQuestion(): DiscoveryQuestion | null {
    if (!this.currentDiscovery) return null;
    
    const answeredIds = new Set(this.currentDiscovery.answers.map(a => a.questionId));
    const nextQuestion = DISCOVERY_QUESTIONS.find(q => !answeredIds.has(q.id));
    
    return nextQuestion || null;
  }

  getQuestion(id: string): DiscoveryQuestion | undefined {
    return DISCOVERY_QUESTIONS.find(q => q.id === id);
  }

  answerQuestion(questionId: string, answer: string | number | string[]): void {
    if (!this.currentDiscovery) return;

    this.currentDiscovery.answers.push({
      questionId,
      answer,
      timestamp: Date.now(),
    });

    // Check if discovery is complete
    if (this.currentDiscovery.answers.length >= DISCOVERY_QUESTIONS.length) {
      this.completeDiscovery();
    }
  }

  private completeDiscovery(): void {
    if (!this.currentDiscovery || !this.profile) return;

    this.currentDiscovery.completedAt = Date.now();

    // Analyze answers and generate recommendations
    const recommendations = this.analyzeAndRecommend();
    this.currentDiscovery.recommendations = recommendations;

    // Update profile with discovered traits
    this.updateProfileFromDiscovery();

    // Learn to brain
    const brain = getJarvisBrain();
    if (brain && recommendations.length > 0) {
      const topRoles = recommendations.slice(0, 3).map(r => r.role).join(', ');
      brain.learn({
        subject: 'Ben',
        predicate: 'has career matches',
        object: topRoles,
        confidence: 0.95,
        source: 'career-discovery',
      });
    }

    this.saveProfile();
    logger.info('Discovery completed', { recommendations: recommendations.length });
  }

  private analyzeAndRecommend(): RoleRecommendation[] {
    if (!this.currentDiscovery) return [];

    const recommendations: RoleRecommendation[] = [];
    const answerMap = new Map(
      this.currentDiscovery.answers.map(a => [a.questionId, a.answer])
    );

    for (const role of ROLE_DATABASE) {
      let matchScore = 0;
      const reasons: string[] = [];
      const skillGaps: string[] = [];

      // Check interest alignment
      const interestAnswer = answerMap.get('int-1') as string[] | undefined;
      if (interestAnswer && Array.isArray(interestAnswer)) {
        const interestMatches = role.matchCriteria.interests.filter(
          i => interestAnswer.includes(i)
        ).length;
        matchScore += (interestMatches / role.matchCriteria.interests.length) * 30;
        if (interestMatches > 0) {
          reasons.push('Matches your interests');
        }
      }

      // Check domain interest
      const domainAnswer = answerMap.get('int-3') as string | undefined;
      if (domainAnswer && role.industry.toLowerCase().includes(domainAnswer.toLowerCase())) {
        matchScore += 20;
        reasons.push(`Interested in ${role.industry}`);
      }

      // Check values alignment
      const valueAnswer = answerMap.get('val-1') as string[] | undefined;
      if (valueAnswer && Array.isArray(valueAnswer)) {
        const topValues = valueAnswer.slice(0, 3);
        const valueMatches = role.matchCriteria.values.filter(
          v => topValues.includes(v)
        ).length;
        matchScore += (valueMatches / 3) * 20;
        if (valueMatches > 0) {
          reasons.push('Aligns with your values');
        }
      }

      // Growth outlook bonus
      if (role.growthOutlook === 'booming') {
        matchScore += 15;
        reasons.push('High-growth field');
      } else if (role.growthOutlook === 'growing') {
        matchScore += 10;
        reasons.push('Growing demand');
      }

      // Check skills (from experience questions)
      const skillsAnswer = answerMap.get('exp-1') as string | undefined;
      if (skillsAnswer) {
        for (const skill of role.requiredSkills) {
          if (!skillsAnswer.toLowerCase().includes(skill.toLowerCase())) {
            skillGaps.push(skill);
          }
        }
      } else {
        skillGaps.push(...role.requiredSkills);
      }

      // Penalty for skill gaps
      matchScore -= (skillGaps.length / role.requiredSkills.length) * 15;

      // Normalize score
      matchScore = Math.max(0, Math.min(100, matchScore));

      recommendations.push({
        role: role.title,
        matchScore: matchScore / 100,
        reasons,
        skillGaps,
        nextSteps: this.generateNextSteps(role, skillGaps),
      });
    }

    // Sort by match score
    recommendations.sort((a, b) => b.matchScore - a.matchScore);

    return recommendations;
  }

  private generateNextSteps(role: RoleDefinition, skillGaps: string[]): string[] {
    const steps: string[] = [];

    // Skill development
    if (skillGaps.length > 0) {
      steps.push(`Learn: ${skillGaps.slice(0, 3).join(', ')}`);
    }

    // Project suggestion
    steps.push(`Build a project showcasing ${role.requiredSkills[0]} skills`);

    // Networking
    steps.push(`Connect with ${role.title}s on LinkedIn`);

    // Application prep
    steps.push(`Research ${role.title} interview questions`);

    return steps;
  }

  private updateProfileFromDiscovery(): void {
    if (!this.currentDiscovery || !this.profile) return;

    const answerMap = new Map(
      this.currentDiscovery.answers.map(a => [a.questionId, a.answer])
    );

    // Update interests
    const interests = answerMap.get('int-1') as string[] | undefined;
    if (interests) {
      this.profile.interests = interests;
    }

    // Update work style
    const workPace = answerMap.get('ws-2') as string | undefined;
    if (workPace) {
      if (workPace.includes('Fast')) this.profile.preferredWorkStyle.pace = 'fast';
      else if (workPace.includes('Relaxed')) this.profile.preferredWorkStyle.pace = 'relaxed';
    }

    const workArrangement = answerMap.get('ws-3') as string | undefined;
    if (workArrangement) {
      if (workArrangement.includes('remote')) this.profile.preferredWorkStyle.remote = 'prefer';
      else if (workArrangement.includes('office')) this.profile.preferredWorkStyle.remote = 'avoid';
    }

    // Update target roles from top recommendations
    this.profile.targetRoles = this.currentDiscovery.recommendations
      .slice(0, 3)
      .map(r => ({
        id: `role-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        title: r.role,
        industry: ROLE_DATABASE.find(rd => rd.title === r.role)?.industry || 'Technology',
        seniority: 'intern',
        matchScore: r.matchScore,
        requiredSkills: r.skillGaps,
        niceToHaveSkills: [],
        typicalSalary: ROLE_DATABASE.find(rd => rd.title === r.role)?.salaryRange || { min: 30000, max: 50000, currency: 'GBP' },
        growthOutlook: ROLE_DATABASE.find(rd => rd.title === r.role)?.growthOutlook || 'growing',
        notes: r.reasons.join('; '),
      }));

    this.profile.updatedAt = Date.now();
  }

  getDiscoveryResults(): RoleRecommendation[] {
    return this.currentDiscovery?.recommendations || [];
  }

  // ==========================================================================
  // Skill Gap Analysis
  // ==========================================================================

  analyzeSkillGaps(): {
    required: Array<{ skill: string; importance: 'critical' | 'important' | 'nice-to-have' }>;
    current: string[];
    gapScore: number;
    recommendations: string[];
  } {
    if (!this.profile) {
      return { required: [], current: [], gapScore: 100, recommendations: [] };
    }

    const currentSkills = this.profile.technicalSkills.map(s => s.name.toLowerCase());
    const requiredSkills: Array<{ skill: string; importance: 'critical' | 'important' | 'nice-to-have' }> = [];

    for (const targetRole of this.profile.targetRoles) {
      for (const skill of targetRole.requiredSkills) {
        if (!requiredSkills.find(s => s.skill.toLowerCase() === skill.toLowerCase())) {
          requiredSkills.push({ skill, importance: 'critical' });
        }
      }
      for (const skill of targetRole.niceToHaveSkills) {
        if (!requiredSkills.find(s => s.skill.toLowerCase() === skill.toLowerCase())) {
          requiredSkills.push({ skill, importance: 'nice-to-have' });
        }
      }
    }

    const criticalGaps = requiredSkills
      .filter(s => s.importance === 'critical')
      .filter(s => !currentSkills.includes(s.skill.toLowerCase()));

    const gapScore = requiredSkills.length > 0
      ? (criticalGaps.length / count(requiredSkills, s => s.importance === 'critical')) * 100
      : 0;

    const recommendations = criticalGaps.slice(0, 5).map(g => 
      `Priority: Learn ${g.skill} through projects and online courses`
    );

    return {
      required: requiredSkills,
      current: currentSkills,
      gapScore,
      recommendations,
    };
  }

  // ==========================================================================
  // Project & Portfolio
  // ==========================================================================

  addProject(project: Omit<Project, 'id'>): Project {
    if (!this.profile) throw new Error('Profile not initialized');

    const newProject: Project = {
      ...project,
      id: `project-${Date.now()}`,
    };

    this.profile.projects.push(newProject);
    this.profile.updatedAt = Date.now();
    this.saveProfile();

    // Learn to brain
    const brain = getJarvisBrain();
    if (brain) {
      brain.learn({
        subject: 'Ben',
        predicate: 'built project',
        object: `${project.name}: ${project.description}`,
        confidence: 0.85,
        source: 'career-system',
      });
    }

    logger.info('Project added', { id: newProject.id, name: newProject.name });
    return newProject;
  }

  getPortfolioProjects(): Project[] {
    return this.profile?.projects.filter(p => p.isPortfolio) || [];
  }

  // ==========================================================================
  // Goal Management
  // ==========================================================================

  addGoal(goal: Omit<Goal, 'id' | 'status' | 'steps'>, isLongTerm: boolean = false): Goal {
    if (!this.profile) throw new Error('Profile not initialized');

    const newGoal: Goal = {
      ...goal,
      id: `goal-${Date.now()}`,
      status: 'not-started',
      steps: [],
    };

    if (isLongTerm) {
      this.profile.longTermGoals.push(newGoal);
    } else {
      this.profile.shortTermGoals.push(newGoal);
    }

    this.saveProfile();
    logger.info('Goal added', { id: newGoal.id, title: newGoal.title });
    return newGoal;
  }

  updateGoalStatus(goalId: string, status: Goal['status']): void {
    if (!this.profile) return;

    const goal = [...this.profile.shortTermGoals, ...this.profile.longTermGoals]
      .find(g => g.id === goalId);
    
    if (goal) {
      goal.status = status;
      this.saveProfile();

      if (status === 'completed') {
        this.addMilestone({
          title: `Completed: ${goal.title}`,
          description: goal.description,
          achievedAt: Date.now(),
          category: 'other',
        });
      }
    }
  }

  addMilestone(milestone: Omit<Milestone, 'id'>): Milestone {
    if (!this.profile) throw new Error('Profile not initialized');

    const newMilestone: Milestone = {
      ...milestone,
      id: `milestone-${Date.now()}`,
    };

    this.profile.milestones.push(newMilestone);
    this.saveProfile();

    // Celebrate in brain
    const brain = getJarvisBrain();
    if (brain) {
      brain.learn({
        subject: 'Ben',
        predicate: 'achieved milestone',
        object: milestone.title,
        confidence: 0.9,
        source: 'career-system',
      });
    }

    logger.info('Milestone added', { id: newMilestone.id, title: newMilestone.title });
    return newMilestone;
  }

  // ==========================================================================
  // Statistics
  // ==========================================================================

  getCareerStats(): {
    targetRoles: number;
    skillsCovered: number;
    skillGaps: number;
    projectsCompleted: number;
    goalsCompleted: number;
    milestones: number;
  } {
    if (!this.profile) {
      return {
        targetRoles: 0,
        skillsCovered: 0,
        skillGaps: 0,
        projectsCompleted: 0,
        goalsCompleted: 0,
        milestones: 0,
      };
    }

    const gapAnalysis = this.analyzeSkillGaps();

    return {
      targetRoles: this.profile.targetRoles.length,
      skillsCovered: this.profile.technicalSkills.length,
      skillGaps: gapAnalysis.required.filter(r => 
        !gapAnalysis.current.includes(r.skill.toLowerCase())
      ).length,
      projectsCompleted: this.profile.projects.length,
      goalsCompleted: count([...this.profile.shortTermGoals, ...this.profile.longTermGoals],
        g => g.status === 'completed'),
      milestones: this.profile.milestones.length,
    };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let careerSystemInstance: CareerSystem | null = null;

export function getCareerSystem(): CareerSystem {
  if (!careerSystemInstance) {
    careerSystemInstance = new CareerSystem();
  }
  return careerSystemInstance;
}

export function initializeCareerSystem(dataDir?: string): CareerSystem {
  careerSystemInstance = new CareerSystem(dataDir);
  return careerSystemInstance;
}
