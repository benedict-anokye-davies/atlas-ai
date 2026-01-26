/**
 * Interview Preparation System
 *
 * Generates personalized interview prep plans based on
 * target company, role, and user's profile.
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { getCareerProfileManager } from './career-profile-manager';
import { getSkillsGapAnalyzer } from './skills-gap-analyzer';
import {
  InterviewPrepPlan,
  CompanyResearch,
  TechnicalPrepTopic,
  CodingChallengePlan,
  SystemDesignTopic,
  STARStory,
  PreparedQuestion,
  CareerProfile,
  LearningResource,
} from './types';

const logger = createModuleLogger('InterviewPrep');

// ============================================================================
// Common Interview Questions Database
// ============================================================================

const BEHAVIORAL_QUESTIONS = {
  leadership: [
    'Tell me about a time you led a project',
    'Describe a situation where you had to motivate a team',
    'How do you handle conflicts within your team?',
    'Tell me about a time you had to make a difficult decision',
  ],
  problemSolving: [
    'Describe a challenging technical problem you solved',
    'Tell me about a time you had to debug a complex issue',
    'How do you approach problems you\'ve never seen before?',
    'Describe a situation where you had to learn something quickly',
  ],
  collaboration: [
    'Tell me about a time you worked with a difficult colleague',
    'Describe a successful cross-team collaboration',
    'How do you handle disagreements about technical decisions?',
    'Tell me about receiving constructive feedback',
  ],
  failure: [
    'Tell me about a project that failed',
    'Describe a mistake you made and what you learned',
    'How do you handle setbacks?',
    'Tell me about a time you missed a deadline',
  ],
  growth: [
    'What\'s the most recent thing you learned?',
    'How do you stay updated with technology?',
    'Tell me about a skill you developed recently',
    'Where do you see yourself in 5 years?',
  ],
};

const SYSTEM_DESIGN_TOPICS = [
  {
    name: 'URL Shortener',
    description: 'Design a URL shortening service like bit.ly',
    keyComponents: ['Hash generation', 'Database design', 'Caching', 'Analytics'],
    exampleSystems: ['bit.ly', 'tinyurl'],
  },
  {
    name: 'Rate Limiter',
    description: 'Design a distributed rate limiting system',
    keyComponents: ['Token bucket', 'Sliding window', 'Distributed counters'],
    exampleSystems: ['API gateways', 'CDN rate limits'],
  },
  {
    name: 'Chat System',
    description: 'Design a real-time messaging system',
    keyComponents: ['WebSockets', 'Message queues', 'Presence system', 'Storage'],
    exampleSystems: ['WhatsApp', 'Slack', 'Discord'],
  },
  {
    name: 'News Feed',
    description: 'Design a social media news feed',
    keyComponents: ['Fan-out', 'Ranking', 'Caching', 'Real-time updates'],
    exampleSystems: ['Facebook', 'Twitter', 'LinkedIn'],
  },
  {
    name: 'Distributed Cache',
    description: 'Design a distributed caching system',
    keyComponents: ['Consistent hashing', 'Replication', 'Eviction policies'],
    exampleSystems: ['Redis', 'Memcached'],
  },
  {
    name: 'Search Autocomplete',
    description: 'Design a typeahead suggestion system',
    keyComponents: ['Trie', 'Ranking', 'Personalization', 'Caching'],
    exampleSystems: ['Google Search', 'Amazon'],
  },
  {
    name: 'Video Streaming',
    description: 'Design a video streaming platform',
    keyComponents: ['CDN', 'Encoding', 'Adaptive bitrate', 'Storage'],
    exampleSystems: ['YouTube', 'Netflix'],
  },
  {
    name: 'Payment System',
    description: 'Design a payment processing system',
    keyComponents: ['Idempotency', 'Transactions', 'Fraud detection', 'Reconciliation'],
    exampleSystems: ['Stripe', 'PayPal'],
  },
];

const CODING_PATTERNS = [
  { pattern: 'Two Pointers', difficulty: 'easy', topics: ['Arrays', 'Strings'] },
  { pattern: 'Sliding Window', difficulty: 'medium', topics: ['Arrays', 'Strings'] },
  { pattern: 'Binary Search', difficulty: 'easy', topics: ['Arrays', 'Search'] },
  { pattern: 'BFS/DFS', difficulty: 'medium', topics: ['Graphs', 'Trees'] },
  { pattern: 'Dynamic Programming', difficulty: 'hard', topics: ['Optimization'] },
  { pattern: 'Backtracking', difficulty: 'medium', topics: ['Recursion', 'Combinations'] },
  { pattern: 'Heap/Priority Queue', difficulty: 'medium', topics: ['Scheduling', 'Top K'] },
  { pattern: 'Trie', difficulty: 'medium', topics: ['Strings', 'Autocomplete'] },
  { pattern: 'Union Find', difficulty: 'medium', topics: ['Graphs', 'Connected Components'] },
  { pattern: 'Monotonic Stack', difficulty: 'medium', topics: ['Arrays', 'Next Greater Element'] },
];

// ============================================================================
// Interview Prep Manager
// ============================================================================

export class InterviewPrepManager extends EventEmitter {
  private profileManager = getCareerProfileManager();
  private gapAnalyzer = getSkillsGapAnalyzer();
  private starStories: Map<string, STARStory> = new Map();
  private prepPlans: Map<string, InterviewPrepPlan> = new Map();

  constructor() {
    super();
  }

  // --------------------------------------------------------------------------
  // Prep Plan Generation
  // --------------------------------------------------------------------------

  async generatePrepPlan(
    company: string,
    role: string,
    interviewDate?: number
  ): Promise<InterviewPrepPlan> {
    logger.info('Generating interview prep plan', { company, role });

    const profile = this.profileManager.getProfile();

    // Get company profile if available
    const companyProfile = this.gapAnalyzer.getEliteCompanyProfile(company);

    // Research company
    const companyResearch = await this.researchCompany(company, companyProfile);

    // Generate technical prep topics
    const technicalTopics = this.generateTechnicalTopics(role, profile, companyProfile);

    // Generate coding challenge plan
    const codingChallenges = this.generateCodingPlan(role, profile);

    // Generate system design topics
    const systemDesignTopics = this.generateSystemDesignTopics(role);

    // Get relevant STAR stories
    const starStories = this.getRelevantSTARStories(role);

    // Generate common questions with suggested answers
    const commonQuestions = this.generatePreparedQuestions(role, company, profile);

    // Questions to ask the interviewer
    const questionsToAsk = this.generateQuestionsToAsk(company, role);

    const plan: InterviewPrepPlan = {
      company,
      role,
      interviewDate,
      companyResearch,
      technicalTopics,
      codingChallenges,
      systemDesignTopics,
      starStories,
      commonQuestions,
      questionsToAsk,
      dresscode: companyProfile?.culturalFit?.includes('casual') ? 'Smart casual' : 'Business casual',
      interviewFormat: companyProfile?.interviewProcess?.map((s) => s.name).join(' → '),
      tips: companyProfile?.interviewTips || [
        'Research the company thoroughly',
        'Prepare specific examples from your experience',
        'Practice coding problems out loud',
        'Get a good night\'s sleep before the interview',
      ],
    };

    // Cache the plan
    const planId = `${company.toLowerCase()}_${role.toLowerCase()}`;
    this.prepPlans.set(planId, plan);

    this.emit('prep-plan-generated', plan);
    return plan;
  }

  // --------------------------------------------------------------------------
  // Company Research
  // --------------------------------------------------------------------------

  private async researchCompany(company: string, companyProfile?: any): Promise<CompanyResearch> {
    // In production, this would use web search to get real data
    // For now, return structured data from our profiles or generic placeholders

    if (companyProfile) {
      return {
        mission: `${company} is focused on solving important problems with technology`,
        values: companyProfile.culturalFit || ['Innovation', 'Excellence', 'Collaboration'],
        products: [],
        recentNews: [],
        techStack: companyProfile.technicalRequirements?.flatMap((r: any) => r.skills) || [],
        interviewProcess: companyProfile.interviewProcess?.map((s: any) => s.name) || [],
        glassdoorInsights: [],
        commonInterviewQuestions: [],
      };
    }

    return {
      mission: `Research ${company}'s mission statement`,
      values: ['Research company values'],
      products: ['Research main products/services'],
      recentNews: ['Check recent news about the company'],
      techStack: [],
      interviewProcess: ['Typical: Phone screen → Technical → Onsite'],
      glassdoorInsights: ['Check Glassdoor for interview experiences'],
      commonInterviewQuestions: [],
    };
  }

  // --------------------------------------------------------------------------
  // Technical Prep Topics
  // --------------------------------------------------------------------------

  private generateTechnicalTopics(
    role: string,
    profile: CareerProfile | null,
    companyProfile?: any
  ): TechnicalPrepTopic[] {
    const topics: TechnicalPrepTopic[] = [];
    const roleLower = role.toLowerCase();

    // Core topics based on role
    if (roleLower.includes('backend') || roleLower.includes('software engineer')) {
      topics.push(
        this.createTechnicalTopic('Data Structures', 'critical', profile),
        this.createTechnicalTopic('Algorithms', 'critical', profile),
        this.createTechnicalTopic('System Design', 'critical', profile),
        this.createTechnicalTopic('Databases', 'important', profile),
        this.createTechnicalTopic('API Design', 'important', profile)
      );
    }

    if (roleLower.includes('frontend')) {
      topics.push(
        this.createTechnicalTopic('JavaScript/TypeScript', 'critical', profile),
        this.createTechnicalTopic('React/Vue/Angular', 'critical', profile),
        this.createTechnicalTopic('CSS/Styling', 'important', profile),
        this.createTechnicalTopic('Performance Optimization', 'important', profile),
        this.createTechnicalTopic('Accessibility', 'mentioned', profile)
      );
    }

    if (roleLower.includes('fullstack') || roleLower.includes('full stack')) {
      topics.push(
        this.createTechnicalTopic('Frontend Technologies', 'critical', profile),
        this.createTechnicalTopic('Backend Technologies', 'critical', profile),
        this.createTechnicalTopic('Databases', 'important', profile),
        this.createTechnicalTopic('System Design', 'important', profile),
        this.createTechnicalTopic('DevOps Basics', 'mentioned', profile)
      );
    }

    // Add company-specific topics
    if (companyProfile) {
      for (const req of companyProfile.technicalRequirements || []) {
        for (const skill of req.skills) {
          if (!topics.find((t) => t.topic.toLowerCase() === skill.toLowerCase())) {
            topics.push(
              this.createTechnicalTopic(
                skill,
                req.importance === 'required' ? 'important' : 'mentioned',
                profile
              )
            );
          }
        }
      }
    }

    return topics.slice(0, 10); // Limit to top 10
  }

  private createTechnicalTopic(
    topic: string,
    importance: 'critical' | 'important' | 'mentioned',
    profile: CareerProfile | null
  ): TechnicalPrepTopic {
    // Check user's confidence based on skills
    let confidence: 1 | 2 | 3 | 4 | 5 = 3;
    if (profile) {
      const skill = profile.skills.technical.find(
        (s) => s.name.toLowerCase().includes(topic.toLowerCase()) ||
          topic.toLowerCase().includes(s.name.toLowerCase())
      );
      if (skill) {
        const profToConf: Record<string, number> = {
          learning: 1,
          beginner: 2,
          intermediate: 3,
          advanced: 4,
          expert: 5,
        };
        confidence = (profToConf[skill.proficiency] || 3) as 1 | 2 | 3 | 4 | 5;
      }
    }

    return {
      topic,
      importance,
      confidence,
      resources: this.getTopicResources(topic),
      practiceProblems: this.getPracticeProblems(topic),
    };
  }

  private getTopicResources(topic: string): LearningResource[] {
    const resources: LearningResource[] = [];
    const topicLower = topic.toLowerCase();

    if (topicLower.includes('algorithm') || topicLower.includes('data structure')) {
      resources.push(
        { name: 'NeetCode Roadmap', type: 'course', url: 'https://neetcode.io/roadmap', cost: 'free', difficulty: 'intermediate' },
        { name: 'LeetCode', type: 'practice', url: 'https://leetcode.com', cost: 'free', difficulty: 'intermediate' }
      );
    }

    if (topicLower.includes('system design')) {
      resources.push(
        { name: 'System Design Primer', type: 'tutorial', url: 'https://github.com/donnemartin/system-design-primer', cost: 'free', difficulty: 'intermediate' },
        { name: 'Designing Data-Intensive Applications', type: 'book', cost: 'paid', difficulty: 'advanced' }
      );
    }

    return resources;
  }

  private getPracticeProblems(topic: string): string[] {
    const topicLower = topic.toLowerCase();

    if (topicLower.includes('algorithm') || topicLower.includes('data structure')) {
      return [
        'Two Sum',
        'Valid Parentheses',
        'Merge Two Sorted Lists',
        'Best Time to Buy and Sell Stock',
        'Valid Palindrome',
      ];
    }

    if (topicLower.includes('system design')) {
      return [
        'Design a URL shortener',
        'Design a rate limiter',
        'Design a chat system',
      ];
    }

    return [];
  }

  // --------------------------------------------------------------------------
  // Coding Challenge Plan
  // --------------------------------------------------------------------------

  private generateCodingPlan(role: string, profile: CareerProfile | null): CodingChallengePlan {
    const problems: any[] = [];

    // Add problems for each pattern
    for (const pattern of CODING_PATTERNS) {
      problems.push({
        name: `Practice ${pattern.pattern}`,
        platform: 'leetcode',
        difficulty: pattern.difficulty,
        pattern: pattern.pattern,
        url: 'https://leetcode.com',
        completed: false,
      });
    }

    return {
      patterns: CODING_PATTERNS.map((p) => p.pattern),
      problemsToSolve: problems,
      mockInterviewsCompleted: 0,
      targetProblemsPerDay: 2,
    };
  }

  // --------------------------------------------------------------------------
  // System Design Topics
  // --------------------------------------------------------------------------

  private generateSystemDesignTopics(role: string): SystemDesignTopic[] {
    const roleLower = role.toLowerCase();

    // Select relevant topics based on role
    let relevantTopics = [...SYSTEM_DESIGN_TOPICS];

    if (roleLower.includes('backend')) {
      // Prioritize backend-heavy topics
      relevantTopics = relevantTopics.sort((a, b) => {
        const backendTopics = ['Rate Limiter', 'Distributed Cache', 'Payment System'];
        const aIsBackend = backendTopics.includes(a.name) ? -1 : 0;
        const bIsBackend = backendTopics.includes(b.name) ? -1 : 0;
        return aIsBackend - bIsBackend;
      });
    }

    return relevantTopics.slice(0, 5).map((topic) => ({
      ...topic,
      confidence: 3 as 1 | 2 | 3 | 4 | 5,
      practiceQuestion: `Design ${topic.name.toLowerCase()}`,
    }));
  }

  // --------------------------------------------------------------------------
  // STAR Stories
  // --------------------------------------------------------------------------

  async addSTARStory(story: Omit<STARStory, 'id'>): Promise<STARStory> {
    const newStory: STARStory = {
      ...story,
      id: `star_${Date.now()}`,
    };

    this.starStories.set(newStory.id, newStory);
    this.emit('star-story-added', newStory);

    return newStory;
  }

  getSTARStories(): STARStory[] {
    return Array.from(this.starStories.values());
  }

  private getRelevantSTARStories(role: string): STARStory[] {
    const stories = this.getSTARStories();

    // If no stories, return templates
    if (stories.length === 0) {
      return [
        {
          id: 'template_1',
          title: 'Leadership Example',
          situation: '[Describe the context and background]',
          task: '[What was your responsibility?]',
          action: '[What specific steps did you take?]',
          result: '[What was the outcome? Use metrics if possible]',
          skills: ['Leadership', 'Communication'],
          useFor: ['Tell me about a time you led a project'],
        },
        {
          id: 'template_2',
          title: 'Technical Challenge',
          situation: '[Describe a difficult technical problem]',
          task: '[What did you need to accomplish?]',
          action: '[How did you solve it?]',
          result: '[What was the impact?]',
          skills: ['Problem Solving', 'Technical'],
          useFor: ['Describe a challenging technical problem'],
        },
      ];
    }

    return stories;
  }

  // --------------------------------------------------------------------------
  // Prepared Questions
  // --------------------------------------------------------------------------

  private generatePreparedQuestions(
    role: string,
    company: string,
    profile: CareerProfile | null
  ): PreparedQuestion[] {
    const questions: PreparedQuestion[] = [];

    // Add behavioral questions
    for (const [category, categoryQuestions] of Object.entries(BEHAVIORAL_QUESTIONS)) {
      for (const question of categoryQuestions.slice(0, 2)) {
        questions.push({
          id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          question,
          category: 'behavioral',
          suggestedAnswer: this.generateSuggestedAnswer(question, profile),
          practiced: false,
        });
      }
    }

    // Add role-specific questions
    const roleLower = role.toLowerCase();
    if (roleLower.includes('senior') || roleLower.includes('lead')) {
      questions.push({
        id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        question: 'How do you mentor junior developers?',
        category: 'behavioral',
        suggestedAnswer: 'Focus on: code reviews, pair programming, knowledge sharing, creating growth opportunities',
        practiced: false,
      });
    }

    // Add company-specific questions
    questions.push({
      id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      question: `Why do you want to work at ${company}?`,
      category: 'culture',
      suggestedAnswer: `Research ${company}'s mission, products, and culture. Connect to your personal goals and values.`,
      practiced: false,
    });

    return questions;
  }

  private generateSuggestedAnswer(question: string, profile: CareerProfile | null): string {
    if (!profile) {
      return 'Prepare a specific example from your experience using the STAR method';
    }

    const questionLower = question.toLowerCase();

    if (questionLower.includes('led') || questionLower.includes('leadership')) {
      return `Use an example from your experience. Focus on: defining the vision, organizing the team, overcoming obstacles, and measuring success.`;
    }

    if (questionLower.includes('difficult') || questionLower.includes('challenging')) {
      return `Choose a genuine challenge. Explain: the complexity, your systematic approach, what you learned, and the positive outcome.`;
    }

    if (questionLower.includes('mistake') || questionLower.includes('failed')) {
      return `Be honest about a real mistake. Focus on: taking responsibility, what you learned, how you prevented it from happening again.`;
    }

    return 'Prepare a specific example from your experience using the STAR method';
  }

  // --------------------------------------------------------------------------
  // Questions to Ask
  // --------------------------------------------------------------------------

  private generateQuestionsToAsk(company: string, role: string): string[] {
    return [
      "What does a typical day look like for this role?",
      "What are the biggest challenges the team is currently facing?",
      "How do you measure success in this position?",
      "What's the team's approach to code reviews and quality?",
      "How does the company support professional development?",
      "What's the on-call/support rotation like?",
      "Can you tell me about the team I'd be working with?",
      "What's the roadmap for this product/team?",
      "How does the engineering team collaborate with product?",
      `What's your favorite thing about working at ${company}?`,
    ];
  }

  // --------------------------------------------------------------------------
  // Mock Interview
  // --------------------------------------------------------------------------

  async generateMockInterviewQuestions(
    type: 'technical' | 'behavioral' | 'system-design',
    count: number = 5
  ): Promise<string[]> {
    const questions: string[] = [];

    switch (type) {
      case 'behavioral':
        const allBehavioral = Object.values(BEHAVIORAL_QUESTIONS).flat();
        for (let i = 0; i < count && i < allBehavioral.length; i++) {
          const randomIndex = Math.floor(Math.random() * allBehavioral.length);
          const question = allBehavioral[randomIndex];
          if (!questions.includes(question)) {
            questions.push(question);
          }
        }
        break;

      case 'system-design':
        const topics = SYSTEM_DESIGN_TOPICS.slice(0, count);
        for (const topic of topics) {
          questions.push(`Design a ${topic.name.toLowerCase()}`);
        }
        break;

      case 'technical':
        const patterns = CODING_PATTERNS.slice(0, count);
        for (const pattern of patterns) {
          questions.push(`Solve a ${pattern.pattern} problem (${pattern.difficulty})`);
        }
        break;
    }

    return questions;
  }

  // --------------------------------------------------------------------------
  // Progress Tracking
  // --------------------------------------------------------------------------

  async markQuestionPracticed(planId: string, questionIndex: number): Promise<void> {
    const plan = this.prepPlans.get(planId);
    if (plan && plan.commonQuestions[questionIndex]) {
      plan.commonQuestions[questionIndex].practiced = true;
      this.emit('progress-updated', plan);
    }
  }

  async updateTopicConfidence(
    planId: string,
    topicName: string,
    confidence: 1 | 2 | 3 | 4 | 5
  ): Promise<void> {
    const plan = this.prepPlans.get(planId);
    if (plan) {
      const topic = plan.technicalTopics.find((t) => t.topic === topicName);
      if (topic) {
        topic.confidence = confidence;
        this.emit('progress-updated', plan);
      }
    }
  }

  getPrepProgress(planId: string): {
    questionsProgress: number;
    topicsProgress: number;
    overallReadiness: number;
  } {
    const plan = this.prepPlans.get(planId);
    if (!plan) {
      return { questionsProgress: 0, topicsProgress: 0, overallReadiness: 0 };
    }

    const practicedQuestions = plan.commonQuestions.filter((q) => q.practiced).length;
    const questionsProgress = plan.commonQuestions.length > 0
      ? Math.round((practicedQuestions / plan.commonQuestions.length) * 100)
      : 0;

    const confidentTopics = plan.technicalTopics.filter((t) => t.confidence >= 4).length;
    const topicsProgress = plan.technicalTopics.length > 0
      ? Math.round((confidentTopics / plan.technicalTopics.length) * 100)
      : 0;

    const overallReadiness = Math.round((questionsProgress + topicsProgress) / 2);

    return { questionsProgress, topicsProgress, overallReadiness };
  }

  // --------------------------------------------------------------------------
  // Practice Session Tracking
  // --------------------------------------------------------------------------

  private practiceSessions: Array<{
    id: string;
    questionId: string;
    response: string;
    rating: number;
    timestamp: number;
  }> = [];

  /**
   * Record a practice session for a question
   */
  async recordPracticeSession(
    questionId: string,
    response: string,
    rating: number
  ): Promise<void> {
    this.practiceSessions.push({
      id: `practice_${Date.now()}`,
      questionId,
      response,
      rating: Math.max(1, Math.min(5, rating)),
      timestamp: Date.now(),
    });

    // Update the question as practiced in all plans
    for (const plan of this.prepPlans.values()) {
      const question = plan.commonQuestions.find((q) => q.id === questionId);
      if (question) {
        question.practiced = true;
      }
    }

    this.emit('practice-recorded', { questionId, rating });
  }

  /**
   * Get practice statistics
   */
  getPracticeStats(): {
    totalSessions: number;
    averageRating: number;
    questionsPracticed: number;
    lastPracticeDate: number | null;
    ratingDistribution: Record<number, number>;
  } {
    const totalSessions = this.practiceSessions.length;
    
    if (totalSessions === 0) {
      return {
        totalSessions: 0,
        averageRating: 0,
        questionsPracticed: 0,
        lastPracticeDate: null,
        ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      };
    }

    const averageRating = this.practiceSessions.reduce((sum, s) => sum + s.rating, 0) / totalSessions;
    const uniqueQuestions = new Set(this.practiceSessions.map((s) => s.questionId)).size;
    const lastPractice = this.practiceSessions.reduce((max, s) => Math.max(max, s.timestamp), 0);

    const ratingDistribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const session of this.practiceSessions) {
      ratingDistribution[session.rating]++;
    }

    return {
      totalSessions,
      averageRating: Math.round(averageRating * 10) / 10,
      questionsPracticed: uniqueQuestions,
      lastPracticeDate: lastPractice,
      ratingDistribution,
    };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: InterviewPrepManager | null = null;

export function getInterviewPrepManager(): InterviewPrepManager {
  if (!instance) {
    instance = new InterviewPrepManager();
  }
  return instance;
}

export default InterviewPrepManager;
