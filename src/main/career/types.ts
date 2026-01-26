/**
 * Career Module Types
 *
 * Comprehensive career management system for strategic job hunting,
 * skill development, and working toward elite companies.
 */

// ============================================================================
// Career Profile & Goals
// ============================================================================

export interface CareerProfile {
  id: string;
  createdAt: number;
  updatedAt: number;

  // Personal info
  name: string;
  email: string;
  location: string;
  willingToRelocate: boolean;
  preferredLocations: string[];
  timezone: string;

  // Current situation
  currentRole?: string;
  currentCompany?: string;
  yearsOfExperience: number;
  employmentStatus: EmploymentStatus;
  noticePeriod?: string; // e.g., "2 weeks", "1 month"

  // Preferences
  workPreferences: WorkPreferences;
  salaryExpectations: SalaryExpectations;

  // Goals
  careerGoals: CareerGoals;

  // Skills inventory
  skills: SkillInventory;

  // Experience
  workHistory: WorkExperience[];
  education: Education[];
  certifications: Certification[];
  projects: Project[];

  // Documents
  cvVersions: CVVersion[];
  coverLetterTemplates: CoverLetterTemplate[];

  // Online presence
  linkedInUrl?: string;
  githubUrl?: string;
  portfolioUrl?: string;
  personalWebsite?: string;
}

export type EmploymentStatus =
  | 'employed-looking'
  | 'employed-not-looking'
  | 'unemployed'
  | 'freelancing'
  | 'student'
  | 'career-break';

export interface WorkPreferences {
  remotePreference: 'remote-only' | 'hybrid' | 'office' | 'flexible';
  companySize: CompanySize[];
  industries: string[];
  roles: string[]; // Target role titles
  dealbreakers: string[]; // Things they won't accept
  mustHaves: string[]; // Non-negotiable requirements
}

export type CompanySize = 'startup' | 'small' | 'medium' | 'large' | 'enterprise' | 'faang';

export interface SalaryExpectations {
  minimum: number;
  target: number;
  currency: string;
  includesEquity: boolean;
  freelanceHourlyRate?: number;
  freelanceDayRate?: number;
}

export interface CareerGoals {
  shortTerm: string; // 6-12 months
  mediumTerm: string; // 1-3 years
  longTerm: string; // 3-5+ years

  dreamCompanies: DreamCompany[];
  targetRoles: string[];
  skillsToAcquire: string[];

  timeline: CareerTimeline;
}

export interface DreamCompany {
  name: string;
  website?: string;
  whyInterested: string;
  knownRequirements: string[];
  currentlyHiring: boolean;
  lastChecked?: number;
  notes?: string;
  difficulty: 'achievable' | 'stretch' | 'moonshot';
}

export interface CareerTimeline {
  targetCompanyReadiness: number; // timestamp when ready for dream companies
  milestones: CareerMilestone[];
}

export interface CareerMilestone {
  id: string;
  title: string;
  description: string;
  targetDate: number;
  completedDate?: number;
  status: 'not-started' | 'in-progress' | 'completed' | 'blocked';
  dependencies: string[]; // IDs of other milestones
}

// ============================================================================
// Skills System
// ============================================================================

export interface SkillInventory {
  technical: TechnicalSkill[];
  soft: SoftSkill[];
  tools: ToolSkill[];
  languages: LanguageSkill[];
  domains: DomainExpertise[];
}

export interface TechnicalSkill {
  name: string;
  category: TechCategory;
  proficiency: ProficiencyLevel;
  yearsUsed: number;
  lastUsed: number; // timestamp
  projectsUsed: string[]; // project IDs
  verified: boolean; // has proof (github, certs, etc.)
  notes?: string;
}

export type TechCategory =
  | 'language'
  | 'framework'
  | 'database'
  | 'cloud'
  | 'devops'
  | 'testing'
  | 'ai-ml'
  | 'security'
  | 'mobile'
  | 'web'
  | 'systems'
  | 'data'
  | 'blockchain'
  | 'other';

export type ProficiencyLevel =
  | 'learning' // Just started
  | 'beginner' // Can do basics with help
  | 'intermediate' // Can work independently
  | 'advanced' // Can architect solutions
  | 'expert'; // Can teach others, deep knowledge

export interface SoftSkill {
  name: string;
  selfRating: 1 | 2 | 3 | 4 | 5;
  evidence: string[]; // Examples demonstrating this skill
}

export interface ToolSkill {
  name: string;
  category: 'ide' | 'vcs' | 'ci-cd' | 'monitoring' | 'design' | 'productivity' | 'other';
  proficiency: ProficiencyLevel;
}

export interface LanguageSkill {
  language: string;
  speaking: 'native' | 'fluent' | 'professional' | 'conversational' | 'basic';
  writing: 'native' | 'fluent' | 'professional' | 'conversational' | 'basic';
}

export interface DomainExpertise {
  domain: string; // e.g., "fintech", "healthcare", "e-commerce"
  depth: 'exposed' | 'working-knowledge' | 'deep-expertise';
  yearsInDomain: number;
}

// ============================================================================
// Work History & Education
// ============================================================================

export interface WorkExperience {
  id: string;
  company: string;
  title: string;
  location: string;
  remote: boolean;
  startDate: number;
  endDate?: number; // undefined = current
  description: string;
  achievements: string[];
  technologies: string[];
  teamSize?: number;
  managedPeople?: number;
}

export interface Education {
  id: string;
  institution: string;
  degree: string;
  field: string;
  startDate: number;
  endDate?: number;
  grade?: string;
  achievements: string[];
  relevantCourses: string[];
}

export interface Certification {
  id: string;
  name: string;
  issuer: string;
  dateObtained: number;
  expiryDate?: number;
  credentialId?: string;
  verificationUrl?: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  role: string;
  technologies: string[];
  url?: string;
  githubUrl?: string;
  startDate: number;
  endDate?: number;
  highlights: string[];
  metrics?: string[]; // e.g., "Increased performance by 40%"
  isOpenSource: boolean;
  isPersonal: boolean;
}

// ============================================================================
// CV & Cover Letters
// ============================================================================

export interface CVVersion {
  id: string;
  name: string; // e.g., "General", "Backend Focused", "Palantir Tailored"
  content?: string; // CV content as text (for in-memory storage)
  createdAt: number;
  updatedAt: number;
  filePath?: string; // Optional file path for saved files
  format?: 'pdf' | 'docx' | 'md' | 'latex' | 'txt';
  targetRole?: string;
  targetCompany?: string;
  atsScore?: number; // 0-100
  score?: number; // Overall score 0-100
  isDefault?: boolean;
  notes?: string;
}

export interface CoverLetterTemplate {
  id: string;
  name: string;
  content: string;
  placeholders: string[]; // e.g., ["COMPANY_NAME", "ROLE", "WHY_INTERESTED"]
  targetType: 'general' | 'startup' | 'enterprise' | 'faang' | 'freelance';
  lastUsed?: number;
}

// ============================================================================
// Job Search & Applications
// ============================================================================

export interface JobListing {
  id: string;
  title: string;
  company: string;
  companyInfo?: CompanyInfo;
  location: string;
  remote: boolean;
  type?: 'full-time' | 'part-time' | 'contract' | 'freelance' | 'internship';
  salary?: SalaryRange;
  description: string;
  requirements: string[];
  niceToHaves: string[];
  responsibilities: string[];
  benefits: string[];
  postedDate: number;
  closingDate?: number;
  sourceUrl: string;
  source: JobSource;
  applicationUrl?: string;

  // Atlas analysis
  matchScore: number; // 0-100
  skillsMatched: string[];
  skillsGap: string[];
  analysis?: JobAnalysis;

  // User interaction
  savedAt?: number;
  appliedAt?: number;
  status: JobStatus;
  notes?: string;
}

export interface CompanyInfo {
  name: string;
  website?: string;
  size?: CompanySize;
  industry?: string;
  glassdoorRating?: number;
  linkedInFollowers?: number;
  techStack?: string[];
  culture?: string[];
  fundingStage?: string;
  headquarters?: string;
}

export interface SalaryRange {
  min: number;
  max: number;
  currency: string;
  period: 'hourly' | 'daily' | 'monthly' | 'yearly';
  includesBonus?: boolean;
  includesEquity?: boolean;
}

export type JobSource =
  | 'linkedin'
  | 'indeed'
  | 'glassdoor'
  | 'wellfound' // AngelList
  | 'hired'
  | 'toptal'
  | 'upwork'
  | 'fiverr'
  | 'freelancer'
  | 'remote-ok'
  | 'we-work-remotely'
  | 'arc-dev'
  | 'turing'
  | 'gun-io'
  | 'company-direct'
  | 'referral'
  | 'manual';

export type JobStatus =
  | 'saved'
  | 'applying'
  | 'applied'
  | 'screening'
  | 'phone-interview'
  | 'technical-interview'
  | 'onsite-interview'
  | 'final-interview'
  | 'offer-received'
  | 'offer-accepted'
  | 'offer-declined'
  | 'rejected'
  | 'withdrawn'
  | 'ghosted';

export interface JobAnalysis {
  overallFit: 'excellent' | 'good' | 'moderate' | 'poor';
  strengthsForRole: string[];
  areasToImprove: string[];
  interviewTopics: string[];
  questionsToAsk: string[];
  redFlags: string[];
  recommendations: string[];
}

// ============================================================================
// Application Tracking
// ============================================================================

export interface JobApplication {
  id: string;
  jobId: string;
  job: JobListing;

  // Application details
  appliedAt: number;
  cvVersionUsed: string; // CV version ID
  coverLetter?: string;
  applicationMethod: 'online' | 'email' | 'referral' | 'recruiter' | 'direct';
  referralContact?: string;

  // Status tracking
  status: JobStatus;
  statusHistory: StatusChange[];

  // Interviews
  interviews: Interview[];

  // Communication
  communications: Communication[];

  // Outcome
  outcome?: ApplicationOutcome;

  // Notes
  notes: string;
  lessonsLearned?: string;
}

export interface StatusChange {
  from: JobStatus;
  to: JobStatus;
  at: number;
  notes?: string;
}

export interface Interview {
  id: string;
  type: InterviewType;
  scheduledAt: number;
  duration: number; // minutes
  interviewers: Interviewer[];
  format: 'video' | 'phone' | 'onsite';
  location?: string;
  meetingLink?: string;

  // Prep
  prepNotes?: string;
  questionsToAsk: string[];
  expectedTopics: string[];

  // Post-interview
  completedAt?: number;
  feedback?: string;
  performance?: 1 | 2 | 3 | 4 | 5;
  questionsAsked?: string[];
  lessonsLearned?: string;
}

export type InterviewType =
  | 'recruiter-screen'
  | 'hiring-manager'
  | 'technical-phone'
  | 'coding-challenge'
  | 'system-design'
  | 'behavioral'
  | 'take-home'
  | 'pair-programming'
  | 'presentation'
  | 'panel'
  | 'culture-fit'
  | 'final-round';

export interface Interviewer {
  name: string;
  title?: string;
  linkedInUrl?: string;
  notes?: string;
}

export interface Communication {
  id: string;
  type: 'email' | 'call' | 'message' | 'meeting';
  direction: 'inbound' | 'outbound';
  at: number;
  with: string; // Person/role
  subject?: string;
  summary: string;
  followUpNeeded: boolean;
  followUpDate?: number;
}

export interface ApplicationOutcome {
  result: 'offer' | 'rejected' | 'withdrawn' | 'ghosted';
  at: number;
  offer?: JobOffer;
  rejectionReason?: string;
  feedback?: string;
}

export interface JobOffer {
  salary: number;
  currency: string;
  bonus?: number;
  equity?: string;
  benefits: string[];
  startDate: number;
  deadline: number;
  negotiated: boolean;
  counterOffer?: number;
  finalOffer?: number;
  accepted: boolean;
}

// ============================================================================
// Freelance Management
// ============================================================================

export interface FreelanceProfile {
  platforms: FreelancePlatform[];
  rates: FreelanceRates;
  availability: FreelanceAvailability;
  services: FreelanceService[];
  clients: FreelanceClient[];
  projects: FreelanceProject[];
}

export interface FreelancePlatform {
  name: string;
  profileUrl: string;
  rating?: number;
  reviews?: number;
  earnings?: number;
  level?: string; // e.g., "Top Rated", "Rising Talent"
  lastActive: number;
}

export interface FreelanceRates {
  hourlyRate: number;
  dayRate: number;
  currency: string;
  minimumProject: number; // Minimum project value
  rushMultiplier: number; // e.g., 1.5 for rush jobs
}

export interface FreelanceAvailability {
  hoursPerWeek: number;
  availableFrom: number;
  bookedUntil?: number;
  blackoutDates: { start: number; end: number }[];
}

export interface FreelanceService {
  name: string;
  description: string;
  deliverables: string[];
  pricing: 'hourly' | 'fixed' | 'milestone';
  typicalDuration: string;
  startingPrice?: number;
}

export interface FreelanceClient {
  id: string;
  name: string;
  company?: string;
  contact: string;
  source: JobSource;
  firstProject: number;
  totalProjects: number;
  totalEarnings: number;
  rating: 1 | 2 | 3 | 4 | 5;
  notes?: string;
  canContact: boolean;
  wouldRehire: boolean;
}

export interface FreelanceProject {
  id: string;
  clientId: string;
  title: string;
  description: string;
  services: string[];
  startDate: number;
  endDate?: number;
  status: 'proposal' | 'negotiating' | 'active' | 'completed' | 'cancelled';
  pricing: 'hourly' | 'fixed' | 'milestone';
  totalValue: number;
  hoursWorked?: number;
  milestones: FreelanceMilestone[];
  feedback?: string;
  rating?: number;
  testimonial?: string;
  canUseAsPortfolio: boolean;
}

export interface FreelanceMilestone {
  id: string;
  name: string;
  description: string;
  dueDate: number;
  completedAt?: number;
  amount: number;
  paid: boolean;
}

// ============================================================================
// Skills Gap Analysis
// ============================================================================

export interface SkillsGapAnalysis {
  targetCompany: string;
  targetRole: string;
  analyzedAt: number;

  // Current vs Required
  currentSkills: string[];
  requiredSkills: string[];
  matchedSkills: string[];
  gapSkills: string[];
  bonusSkills: string[]; // Skills you have that are nice-to-have

  // Scoring
  overallReadiness: number; // 0-100
  technicalReadiness: number;
  experienceReadiness: number;
  softSkillsReadiness: number;

  // Recommendations
  prioritySkillsToLearn: SkillLearningPlan[];
  projectsToComplete: SuggestedProject[];
  certificationsToGet: SuggestedCertification[];
  experienceToGain: string[];

  // Timeline
  estimatedTimeToReadiness: string; // e.g., "6-12 months"
  roadmap: LearningRoadmap;
}

export interface SkillLearningPlan {
  skill: string;
  importance: 'critical' | 'important' | 'nice-to-have';
  currentLevel: ProficiencyLevel | 'none';
  targetLevel: ProficiencyLevel;
  estimatedTime: string;
  resources: LearningResource[];
  milestones: string[];
}

export interface LearningResource {
  name: string;
  type: 'course' | 'book' | 'tutorial' | 'project' | 'certification' | 'practice';
  url?: string;
  cost: 'free' | 'paid';
  estimatedHours?: number;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
}

export interface SuggestedProject {
  title: string;
  description: string;
  skills: string[];
  estimatedTime: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  portfolioValue: 'low' | 'medium' | 'high';
  inspiration?: string[];
}

export interface SuggestedCertification {
  name: string;
  issuer: string;
  relevance: 'essential' | 'recommended' | 'nice-to-have';
  cost: number;
  studyTime: string;
  url?: string;
}

export interface LearningRoadmap {
  phases: LearningPhase[];
  checkpoints: RoadmapCheckpoint[];
  estimatedCompletion: number; // timestamp
}

export interface LearningPhase {
  name: string;
  description: string;
  duration: string;
  skills: string[];
  projects: string[];
  certifications: string[];
  startDate?: number;
  completedDate?: number;
}

export interface RoadmapCheckpoint {
  name: string;
  at: number;
  criteria: string[];
  reward?: string; // What they can do after this checkpoint
}

// ============================================================================
// Interview Prep
// ============================================================================

export interface InterviewPrepPlan {
  company: string;
  role: string;
  interviewDate?: number;

  // Company research
  companyResearch: CompanyResearch;

  // Technical prep
  technicalTopics: TechnicalPrepTopic[];
  codingChallenges: CodingChallengePlan;
  systemDesignTopics: SystemDesignTopic[];

  // Behavioral prep
  starStories: STARStory[];
  commonQuestions: PreparedQuestion[];
  questionsToAsk: string[];

  // Logistics
  dresscode?: string;
  interviewFormat?: string;
  tips: string[];
}

export interface CompanyResearch {
  mission: string;
  values: string[];
  products: string[];
  recentNews: string[];
  techStack: string[];
  interviewProcess: string[];
  glassdoorInsights: string[];
  commonInterviewQuestions: string[];
}

export interface TechnicalPrepTopic {
  topic: string;
  importance: 'critical' | 'important' | 'mentioned';
  confidence: 1 | 2 | 3 | 4 | 5;
  resources: LearningResource[];
  practiceProblems?: string[];
}

export interface CodingChallengePlan {
  patterns: string[]; // e.g., "Two Pointers", "Dynamic Programming"
  problemsToSolve: CodingProblem[];
  mockInterviewsCompleted: number;
  targetProblemsPerDay: number;
}

export interface CodingProblem {
  name: string;
  platform: 'leetcode' | 'hackerrank' | 'codewars' | 'other';
  difficulty: 'easy' | 'medium' | 'hard';
  pattern: string;
  url?: string;
  completed: boolean;
  notes?: string;
}

export interface SystemDesignTopic {
  name: string;
  description: string;
  exampleSystems: string[];
  keyComponents: string[];
  practiceQuestion?: string;
  confidence: 1 | 2 | 3 | 4 | 5;
}

export interface STARStory {
  id: string;
  title: string;
  situation: string;
  task: string;
  action: string;
  result: string;
  skills: string[]; // Skills this demonstrates
  useFor: string[]; // Types of questions this answers
}

export interface PreparedQuestion {
  id: string; // Unique identifier for tracking
  question: string;
  category: 'behavioral' | 'situational' | 'technical' | 'culture';
  suggestedAnswer: string;
  starStoryId?: string; // Link to STAR story
  practiced: boolean;
}

// ============================================================================
// Career Analytics
// ============================================================================

export interface CareerAnalytics {
  applications: ApplicationAnalytics;
  interviews: InterviewAnalytics;
  skills: SkillsAnalytics;
  freelance?: FreelanceAnalytics;
}

export interface ApplicationAnalytics {
  totalApplications: number;
  byStatus: Record<JobStatus, number>;
  bySource: Record<JobSource, number>;
  responseRate: number; // % that got past "applied"
  interviewRate: number; // % that got to interview
  offerRate: number; // % that got offers
  averageTimeToResponse: number; // days
  topPerformingCVVersion?: string;
}

export interface InterviewAnalytics {
  totalInterviews: number;
  byType: Record<InterviewType, number>;
  averagePerformance: number;
  passRate: number;
  strongAreas: string[];
  weakAreas: string[];
  commonQuestions: string[];
}

export interface SkillsAnalytics {
  mostRequestedSkills: { skill: string; count: number }[];
  skillsGapFrequency: { skill: string; count: number }[];
  skillsThatGotInterviews: string[];
  recommendedFocus: string[];
}

export interface FreelanceAnalytics {
  totalEarnings: number;
  totalProjects: number;
  averageProjectValue: number;
  averageHourlyRate: number;
  topClients: string[];
  bestPerformingServices: string[];
  utilizationRate: number; // % of available time that's billable
}

// ============================================================================
// Elite Company Requirements
// ============================================================================

export interface EliteCompanyProfile {
  name: string;
  tier: 'faang' | 'unicorn' | 'top-startup' | 'prestigious';
  website: string;
  careersUrl: string;

  // What they look for
  technicalRequirements: EliteTechnicalReq[];
  experienceRequirements: string[];
  softSkillRequirements: string[];
  culturalFit: string[];
  educationPreferences: string[];

  // Interview process
  interviewProcess: InterviewStage[];
  interviewDifficulty: 'very-hard' | 'hard' | 'medium';
  typicalTimelineWeeks: number;
  interviewTips: string[];

  // Compensation
  salaryRange: SalaryRange;
  benefits: string[];
  equity?: string;

  // Insider info
  whatGetsYouNoticed: string[];
  redFlagsToAvoid: string[];
  successStories: string[];
}

export interface EliteTechnicalReq {
  area: string;
  skills: string[];
  minProficiency: ProficiencyLevel;
  importance: 'required' | 'preferred' | 'bonus';
}

export interface InterviewStage {
  name: string;
  description: string;
  duration: string;
  focus: string[];
  tips: string[];
}

// ============================================================================
// Module Configuration
// ============================================================================

export interface CareerModuleConfig {
  // Job search settings
  jobSearchSources: JobSource[];
  searchKeywords: string[];
  excludeCompanies: string[];
  salaryMinimum: number;
  remoteOnly: boolean;

  // Notifications
  notifyNewJobs: boolean;
  notifyApplicationUpdates: boolean;
  notifyInterviewReminders: boolean;
  notifySkillMilestones: boolean;

  // Auto-features
  autoMatchJobs: boolean;
  autoUpdateCVScore: boolean;
  autoGenerateCoverLetters: boolean;

  // Analytics
  trackApplicationMetrics: boolean;
  weeklyReportEnabled: boolean;
}

export const DEFAULT_CAREER_CONFIG: CareerModuleConfig = {
  jobSearchSources: ['linkedin', 'indeed', 'remote-ok', 'wellfound', 'toptal'],
  searchKeywords: [],
  excludeCompanies: [],
  salaryMinimum: 0,
  remoteOnly: false,
  notifyNewJobs: true,
  notifyApplicationUpdates: true,
  notifyInterviewReminders: true,
  notifySkillMilestones: true,
  autoMatchJobs: true,
  autoUpdateCVScore: false,
  autoGenerateCoverLetters: false,
  trackApplicationMetrics: true,
  weeklyReportEnabled: true,
};
