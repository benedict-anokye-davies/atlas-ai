/**
 * CV/Resume Optimizer
 *
 * AI-powered CV optimization that analyzes, scores, and improves
 * resumes for ATS compatibility and human readability.
 * Tailors CVs for specific roles and companies.
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { createModuleLogger } from '../utils/logger';
import { getCareerProfileManager } from './career-profile-manager';
import { CVVersion, JobListing, CareerProfile, TechnicalSkill } from './types';

const logger = createModuleLogger('CVOptimizer');

// ============================================================================
// CV Analysis Types
// ============================================================================

export interface CVAnalysis {
  overallScore: number; // 0-100
  atsScore: number; // ATS compatibility
  readabilityScore: number;
  impactScore: number;

  sections: CVSectionAnalysis[];
  keywords: KeywordAnalysis;
  formatting: FormattingAnalysis;
  improvements: CVImprovement[];
  warnings: string[];
}

export interface CVSectionAnalysis {
  name: string;
  present: boolean;
  score: number;
  feedback: string[];
  suggestions: string[];
}

export interface KeywordAnalysis {
  found: string[];
  missing: string[];
  overused: string[];
  industryRelevant: string[];
  actionVerbs: { used: string[]; suggested: string[] };
}

export interface FormattingAnalysis {
  length: 'too-short' | 'optimal' | 'too-long';
  pageCount: number;
  hasConsistentFormatting: boolean;
  hasBulletPoints: boolean;
  hasQuantifiedAchievements: boolean;
  issues: string[];
}

export interface CVImprovement {
  section: string;
  priority: 'high' | 'medium' | 'low';
  issue: string;
  suggestion: string;
  example?: string;
}

export interface TailoredCV {
  originalCVId: string;
  targetJob?: JobListing;
  targetCompany?: string;
  targetRole?: string;
  modifications: CVModification[];
  tailoredContent: TailoredContent;
  matchScore: number;
}

export interface CVModification {
  section: string;
  type: 'add' | 'remove' | 'reorder' | 'rewrite';
  original?: string;
  modified: string;
  reason: string;
}

export interface TailoredContent {
  summary: string;
  skills: string[];
  highlightedExperiences: string[];
  keywordsAdded: string[];
}

// ============================================================================
// CV Templates
// ============================================================================

const CV_TEMPLATES = {
  modern: {
    name: 'Modern Professional',
    sections: ['summary', 'skills', 'experience', 'projects', 'education'],
    style: 'clean, minimal, tech-focused',
  },
  traditional: {
    name: 'Traditional',
    sections: ['summary', 'experience', 'education', 'skills', 'certifications'],
    style: 'formal, comprehensive',
  },
  creative: {
    name: 'Creative Tech',
    sections: ['summary', 'projects', 'skills', 'experience', 'education'],
    style: 'portfolio-focused, visual',
  },
  faang: {
    name: 'FAANG Optimized',
    sections: ['summary', 'skills', 'experience', 'projects', 'education', 'achievements'],
    style: 'impact-focused, metrics-heavy',
  },
};

// ============================================================================
// Action Verbs Database
// ============================================================================

const ACTION_VERBS = {
  leadership: ['Led', 'Managed', 'Directed', 'Coordinated', 'Spearheaded', 'Orchestrated', 'Oversaw'],
  achievement: ['Achieved', 'Accomplished', 'Delivered', 'Exceeded', 'Surpassed', 'Attained'],
  creation: ['Built', 'Created', 'Designed', 'Developed', 'Engineered', 'Architected', 'Implemented'],
  improvement: ['Improved', 'Enhanced', 'Optimized', 'Streamlined', 'Accelerated', 'Boosted', 'Increased'],
  analysis: ['Analyzed', 'Evaluated', 'Assessed', 'Investigated', 'Researched', 'Diagnosed'],
  collaboration: ['Collaborated', 'Partnered', 'Mentored', 'Trained', 'Coached', 'Facilitated'],
  technical: ['Programmed', 'Automated', 'Integrated', 'Deployed', 'Migrated', 'Refactored', 'Debugged'],
};

// ============================================================================
// CV Optimizer
// ============================================================================

export class CVOptimizer extends EventEmitter {
  private profileManager = getCareerProfileManager();
  private cvStoragePath: string;

  constructor() {
    super();
    this.cvStoragePath = path.join(app.getPath('userData'), 'career', 'cvs');

    // Ensure directory exists
    if (!fs.existsSync(this.cvStoragePath)) {
      fs.mkdirSync(this.cvStoragePath, { recursive: true });
    }
  }

  // --------------------------------------------------------------------------
  // CV Analysis
  // --------------------------------------------------------------------------

  async analyzeCV(cvContent: string, targetRole?: string): Promise<CVAnalysis> {
    logger.info('Analyzing CV', { targetRole });

    const profile = this.profileManager.getProfile();

    // Analyze sections
    const sections = this.analyzeSections(cvContent);

    // Analyze keywords
    const keywords = this.analyzeKeywords(cvContent, targetRole, profile);

    // Analyze formatting
    const formatting = this.analyzeFormatting(cvContent);

    // Calculate scores
    const atsScore = this.calculateATSScore(sections, keywords, formatting);
    const readabilityScore = this.calculateReadabilityScore(cvContent, formatting);
    const impactScore = this.calculateImpactScore(cvContent, keywords);

    const overallScore = Math.round(
      atsScore * 0.4 + readabilityScore * 0.3 + impactScore * 0.3
    );

    // Generate improvements
    const improvements = this.generateImprovements(sections, keywords, formatting, cvContent);

    // Collect warnings
    const warnings = this.collectWarnings(cvContent, sections, formatting);

    const analysis: CVAnalysis = {
      overallScore,
      atsScore,
      readabilityScore,
      impactScore,
      sections,
      keywords,
      formatting,
      improvements,
      warnings,
    };

    this.emit('cv-analyzed', analysis);
    return analysis;
  }

  private analyzeSections(content: string): CVSectionAnalysis[] {
    const contentLower = content.toLowerCase();
    const sections: CVSectionAnalysis[] = [];

    const expectedSections = [
      { name: 'Contact Information', patterns: ['email', 'phone', 'linkedin', 'github'] },
      { name: 'Professional Summary', patterns: ['summary', 'profile', 'objective', 'about'] },
      { name: 'Skills', patterns: ['skills', 'technologies', 'technical skills', 'competencies'] },
      { name: 'Experience', patterns: ['experience', 'employment', 'work history', 'career'] },
      { name: 'Education', patterns: ['education', 'academic', 'degree', 'university'] },
      { name: 'Projects', patterns: ['projects', 'portfolio', 'personal projects'] },
      { name: 'Certifications', patterns: ['certifications', 'certificates', 'credentials'] },
    ];

    for (const section of expectedSections) {
      const present = section.patterns.some((p) => contentLower.includes(p));
      const feedback: string[] = [];
      const suggestions: string[] = [];
      let score = present ? 70 : 0;

      if (!present) {
        feedback.push(`Missing ${section.name} section`);
        suggestions.push(`Add a ${section.name} section to improve completeness`);
      } else {
        // Section-specific analysis
        if (section.name === 'Professional Summary') {
          const summaryLength = this.extractSectionLength(content, section.patterns);
          if (summaryLength < 50) {
            feedback.push('Summary is too brief');
            suggestions.push('Expand summary to 3-4 impactful sentences');
            score -= 10;
          } else if (summaryLength > 300) {
            feedback.push('Summary is too long');
            suggestions.push('Condense summary to 50-150 words');
            score -= 5;
          } else {
            score += 15;
          }
        }

        if (section.name === 'Experience') {
          const hasMetrics = /\d+%|\d+x|£\d+|\$\d+/i.test(content);
          if (!hasMetrics) {
            feedback.push('No quantified achievements found');
            suggestions.push('Add metrics: "Improved performance by X%", "Reduced costs by £X"');
            score -= 15;
          } else {
            score += 20;
            feedback.push('Good use of quantified achievements');
          }
        }

        if (section.name === 'Skills') {
          const skillCount = this.countSkills(content);
          if (skillCount < 5) {
            feedback.push('Limited skills listed');
            suggestions.push('Add more relevant technical skills');
            score -= 10;
          } else if (skillCount > 25) {
            feedback.push('Too many skills listed');
            suggestions.push('Focus on most relevant 15-20 skills');
            score -= 5;
          } else {
            score += 15;
          }
        }
      }

      sections.push({
        name: section.name,
        present,
        score: Math.max(0, Math.min(100, score)),
        feedback,
        suggestions,
      });
    }

    return sections;
  }

  private analyzeKeywords(
    content: string,
    targetRole?: string,
    profile?: CareerProfile | null
  ): KeywordAnalysis {
    const contentLower = content.toLowerCase();
    const words = contentLower.split(/\s+/);

    // Common tech keywords
    const techKeywords = [
      'javascript', 'typescript', 'python', 'java', 'react', 'node', 'aws',
      'docker', 'kubernetes', 'sql', 'nosql', 'api', 'rest', 'graphql',
      'ci/cd', 'agile', 'scrum', 'git', 'testing', 'microservices',
    ];

    const found = techKeywords.filter((kw) => contentLower.includes(kw));
    const missing = techKeywords.filter((kw) => !contentLower.includes(kw));

    // Find overused words
    const wordCounts = new Map<string, number>();
    for (const word of words) {
      if (word.length > 4) {
        wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
      }
    }
    const overused = Array.from(wordCounts.entries())
      .filter(([_, count]) => count > 5)
      .map(([word]) => word);

    // Check action verbs
    const allActionVerbs = Object.values(ACTION_VERBS).flat();
    const usedVerbs = allActionVerbs.filter((verb) =>
      contentLower.includes(verb.toLowerCase())
    );
    const suggestedVerbs = allActionVerbs
      .filter((verb) => !usedVerbs.includes(verb))
      .slice(0, 10);

    // Industry-relevant keywords based on profile
    const industryRelevant: string[] = [];
    if (profile) {
      for (const skill of profile.skills.technical) {
        if (contentLower.includes(skill.name.toLowerCase())) {
          industryRelevant.push(skill.name);
        }
      }
    }

    return {
      found,
      missing: missing.slice(0, 10), // Limit suggestions
      overused,
      industryRelevant,
      actionVerbs: {
        used: usedVerbs,
        suggested: suggestedVerbs,
      },
    };
  }

  private analyzeFormatting(content: string): FormattingAnalysis {
    const lines = content.split('\n');
    const words = content.split(/\s+/).length;
    const issues: string[] = [];

    // Estimate page count (roughly 500 words per page)
    const pageCount = Math.ceil(words / 500);

    // Check length
    let length: 'too-short' | 'optimal' | 'too-long' = 'optimal';
    if (words < 200) {
      length = 'too-short';
      issues.push('CV is too short - aim for 400-800 words');
    } else if (words > 1200) {
      length = 'too-long';
      issues.push('CV is too long - consider condensing to 2 pages max');
    }

    // Check for bullet points
    const hasBulletPoints = /^[\s]*[•\-\*]/m.test(content);
    if (!hasBulletPoints) {
      issues.push('No bullet points detected - use bullets for better readability');
    }

    // Check for quantified achievements
    const hasQuantifiedAchievements = /\d+%|\d+x|reduced|increased|improved|saved/i.test(content);
    if (!hasQuantifiedAchievements) {
      issues.push('Add quantified achievements (percentages, numbers, impact)');
    }

    // Check consistent formatting (rough heuristic)
    const hasConsistentFormatting = lines.length > 10 && !content.includes('  \n\n\n');

    return {
      length,
      pageCount,
      hasConsistentFormatting,
      hasBulletPoints,
      hasQuantifiedAchievements,
      issues,
    };
  }

  // --------------------------------------------------------------------------
  // Score Calculations
  // --------------------------------------------------------------------------

  private calculateATSScore(
    sections: CVSectionAnalysis[],
    keywords: KeywordAnalysis,
    formatting: FormattingAnalysis
  ): number {
    let score = 50;

    // Section presence (up to +25)
    const presentSections = sections.filter((s) => s.present).length;
    score += Math.min(25, presentSections * 4);

    // Keywords (up to +25)
    score += Math.min(25, keywords.found.length * 2);

    // Formatting
    if (formatting.hasBulletPoints) score += 5;
    if (formatting.length === 'optimal') score += 5;
    if (!formatting.hasConsistentFormatting) score -= 10;

    return Math.max(0, Math.min(100, score));
  }

  private calculateReadabilityScore(content: string, formatting: FormattingAnalysis): number {
    let score = 60;

    // Formatting factors
    if (formatting.hasBulletPoints) score += 15;
    if (formatting.length === 'optimal') score += 10;
    if (formatting.hasConsistentFormatting) score += 10;

    // Sentence length (simple check)
    const sentences = content.split(/[.!?]+/);
    const avgSentenceLength = content.split(/\s+/).length / sentences.length;
    if (avgSentenceLength > 25) {
      score -= 10; // Sentences too long
    } else if (avgSentenceLength < 8) {
      score -= 5; // Sentences too short
    }

    return Math.max(0, Math.min(100, score));
  }

  private calculateImpactScore(content: string, keywords: KeywordAnalysis): number {
    let score = 50;

    // Action verbs usage
    score += Math.min(20, keywords.actionVerbs.used.length * 2);

    // Quantified achievements
    const metrics = content.match(/\d+%|\d+x|£[\d,]+|\$[\d,]+/g) || [];
    score += Math.min(20, metrics.length * 4);

    // Strong impact words
    const impactWords = ['led', 'achieved', 'delivered', 'launched', 'built', 'created', 'improved'];
    const impactCount = impactWords.filter((w) => content.toLowerCase().includes(w)).length;
    score += Math.min(10, impactCount * 2);

    return Math.max(0, Math.min(100, score));
  }

  // --------------------------------------------------------------------------
  // Improvement Generation
  // --------------------------------------------------------------------------

  private generateImprovements(
    sections: CVSectionAnalysis[],
    keywords: KeywordAnalysis,
    formatting: FormattingAnalysis,
    content: string
  ): CVImprovement[] {
    const improvements: CVImprovement[] = [];

    // Section-based improvements
    for (const section of sections) {
      if (!section.present) {
        improvements.push({
          section: section.name,
          priority: section.name === 'Experience' || section.name === 'Skills' ? 'high' : 'medium',
          issue: `Missing ${section.name} section`,
          suggestion: `Add a ${section.name} section`,
          example: this.getSectionExample(section.name),
        });
      } else if (section.score < 70) {
        for (const suggestion of section.suggestions) {
          improvements.push({
            section: section.name,
            priority: 'medium',
            issue: section.feedback[0] || 'Section needs improvement',
            suggestion,
          });
        }
      }
    }

    // Keyword improvements
    if (keywords.missing.length > 5) {
      improvements.push({
        section: 'Skills',
        priority: 'high',
        issue: 'Missing important technical keywords',
        suggestion: `Consider adding: ${keywords.missing.slice(0, 5).join(', ')}`,
      });
    }

    if (keywords.actionVerbs.used.length < 5) {
      improvements.push({
        section: 'Experience',
        priority: 'medium',
        issue: 'Limited use of action verbs',
        suggestion: `Start bullet points with verbs like: ${keywords.actionVerbs.suggested.slice(0, 5).join(', ')}`,
      });
    }

    // Formatting improvements
    for (const issue of formatting.issues) {
      improvements.push({
        section: 'Formatting',
        priority: 'low',
        issue,
        suggestion: 'Improve document formatting for better readability',
      });
    }

    // Sort by priority
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    improvements.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    return improvements;
  }

  private getSectionExample(sectionName: string): string {
    const examples: Record<string, string> = {
      'Professional Summary':
        'Results-driven software engineer with 5+ years of experience building scalable web applications. Expertise in TypeScript, React, and Node.js. Led teams that delivered products serving 1M+ users.',
      'Skills':
        'Languages: TypeScript, Python, Java | Frameworks: React, Node.js, Django | Cloud: AWS, GCP | Tools: Docker, Kubernetes, Git',
      'Experience':
        '**Senior Software Engineer** | TechCorp | 2022-Present\n• Led migration to microservices, reducing deployment time by 60%\n• Mentored 3 junior developers, improving team velocity by 25%',
      'Projects':
        '**Open Source CLI Tool** | github.com/user/project\n• Built a CLI tool with 500+ GitHub stars\n• Implemented plugin system used by 50+ contributors',
    };

    return examples[sectionName] || '';
  }

  private collectWarnings(
    content: string,
    sections: CVSectionAnalysis[],
    formatting: FormattingAnalysis
  ): string[] {
    const warnings: string[] = [];
    const contentLower = content.toLowerCase();

    // Check for common issues
    if (contentLower.includes('references available')) {
      warnings.push('Remove "References available upon request" - it\'s outdated');
    }

    if (contentLower.includes('objective:')) {
      warnings.push('Replace "Objective" with "Professional Summary" for modern CVs');
    }

    if (/\b(i am|i have|i was)\b/i.test(content)) {
      warnings.push('Avoid first-person pronouns (I, me, my) in CV');
    }

    if (formatting.pageCount > 2) {
      warnings.push('CV exceeds 2 pages - consider condensing');
    }

    const missingSections = sections.filter((s) => !s.present && s.name !== 'Certifications');
    if (missingSections.length > 2) {
      warnings.push(`Missing ${missingSections.length} important sections`);
    }

    return warnings;
  }

  // --------------------------------------------------------------------------
  // CV Tailoring
  // --------------------------------------------------------------------------

  async tailorCVForJob(cvContent: string, job: JobListing): Promise<TailoredCV> {
    logger.info('Tailoring CV for job', { jobTitle: job.title, company: job.company });

    const modifications: CVModification[] = [];
    const profile = this.profileManager.getProfile();

    // Extract job keywords
    const jobKeywords = this.extractJobKeywords(job);

    // Generate tailored summary
    const tailoredSummary = this.generateTailoredSummary(job, profile);
    modifications.push({
      section: 'Summary',
      type: 'rewrite',
      modified: tailoredSummary,
      reason: `Tailored for ${job.title} at ${job.company}`,
    });

    // Prioritize relevant skills
    const relevantSkills = this.prioritizeSkills(job, profile);
    modifications.push({
      section: 'Skills',
      type: 'reorder',
      modified: relevantSkills.join(', '),
      reason: 'Reordered skills to highlight job-relevant ones first',
    });

    // Identify experiences to highlight
    const highlightedExperiences = this.identifyRelevantExperiences(job, profile);

    // Keywords to add
    const currentKeywords = cvContent.toLowerCase();
    const keywordsToAdd = jobKeywords.filter((kw) => !currentKeywords.includes(kw.toLowerCase()));

    const matchScore = this.calculateJobMatchScore(cvContent, job, jobKeywords);

    return {
      originalCVId: '',
      targetJob: job,
      targetCompany: job.company,
      targetRole: job.title,
      modifications,
      tailoredContent: {
        summary: tailoredSummary,
        skills: relevantSkills,
        highlightedExperiences,
        keywordsAdded: keywordsToAdd.slice(0, 10),
      },
      matchScore,
    };
  }

  async tailorCVForCompany(cvContent: string, companyName: string, role: string): Promise<TailoredCV> {
    // Create a synthetic job listing for the company
    const syntheticJob: JobListing = {
      id: `synthetic_${Date.now()}`,
      title: role,
      company: companyName,
      location: 'Remote',
      remote: true,
      description: `${role} position at ${companyName}`,
      requirements: [],
      niceToHaves: [],
      responsibilities: [],
      benefits: [],
      postedDate: Date.now(),
      sourceUrl: '',
      source: 'manual',
      matchScore: 0,
      skillsMatched: [],
      skillsGap: [],
      status: 'saved',
    };

    return this.tailorCVForJob(cvContent, syntheticJob);
  }

  private extractJobKeywords(job: JobListing): string[] {
    const text = [
      job.title,
      job.description,
      ...job.requirements,
      ...job.niceToHaves,
      ...job.responsibilities,
    ].join(' ').toLowerCase();

    // Extract technical terms and skills
    const keywords: string[] = [];

    // Common tech patterns
    const techPatterns = [
      /\b(javascript|typescript|python|java|go|rust|c\+\+|ruby|php|swift|kotlin)\b/gi,
      /\b(react|angular|vue|node|express|django|flask|spring|rails)\b/gi,
      /\b(aws|gcp|azure|docker|kubernetes|terraform|ansible)\b/gi,
      /\b(sql|postgresql|mysql|mongodb|redis|elasticsearch)\b/gi,
      /\b(rest|graphql|grpc|microservices|api)\b/gi,
      /\b(agile|scrum|kanban|ci\/cd|devops)\b/gi,
    ];

    for (const pattern of techPatterns) {
      const matches = text.match(pattern) || [];
      keywords.push(...matches.map((m) => m.toLowerCase()));
    }

    return [...new Set(keywords)];
  }

  private generateTailoredSummary(job: JobListing, profile: CareerProfile | null): string {
    if (!profile) {
      return `Experienced software engineer seeking ${job.title} role at ${job.company}.`;
    }

    const years = profile.yearsOfExperience;
    const topSkills = profile.skills.technical.slice(0, 3).map((s) => s.name).join(', ');

    return `Results-driven software engineer with ${years}+ years of experience specializing in ${topSkills}. ` +
      `Proven track record of delivering high-quality solutions in fast-paced environments. ` +
      `Eager to contribute to ${job.company}'s mission as a ${job.title}.`;
  }

  private prioritizeSkills(job: JobListing, profile: CareerProfile | null): string[] {
    if (!profile) return [];

    const jobText = [job.title, job.description, ...job.requirements].join(' ').toLowerCase();
    const skills = [...profile.skills.technical];

    // Sort by relevance to job
    skills.sort((a, b) => {
      const aRelevant = jobText.includes(a.name.toLowerCase()) ? 1 : 0;
      const bRelevant = jobText.includes(b.name.toLowerCase()) ? 1 : 0;
      return bRelevant - aRelevant;
    });

    return skills.map((s) => s.name);
  }

  private identifyRelevantExperiences(job: JobListing, profile: CareerProfile | null): string[] {
    if (!profile) return [];

    const experiences: string[] = [];
    const jobText = [job.description, ...job.requirements].join(' ').toLowerCase();

    for (const exp of profile.workHistory) {
      // Check if experience is relevant
      const expText = [exp.description, ...exp.achievements, ...exp.technologies].join(' ').toLowerCase();
      const relevance = this.calculateTextSimilarity(jobText, expText);

      if (relevance > 0.1) {
        experiences.push(`${exp.title} at ${exp.company}: ${exp.achievements[0] || exp.description}`);
      }
    }

    return experiences.slice(0, 3);
  }

  private calculateJobMatchScore(cvContent: string, job: JobListing, jobKeywords: string[]): number {
    const cvLower = cvContent.toLowerCase();
    let matchedKeywords = 0;

    for (const keyword of jobKeywords) {
      if (cvLower.includes(keyword)) {
        matchedKeywords++;
      }
    }

    return jobKeywords.length > 0
      ? Math.round((matchedKeywords / jobKeywords.length) * 100)
      : 50;
  }

  private calculateTextSimilarity(text1: string, text2: string): number {
    const words1 = new Set(text1.split(/\s+/).filter((w) => w.length > 3));
    const words2 = new Set(text2.split(/\s+/).filter((w) => w.length > 3));

    let intersection = 0;
    for (const word of words1) {
      if (words2.has(word)) intersection++;
    }

    const union = words1.size + words2.size - intersection;
    return union > 0 ? intersection / union : 0;
  }

  // --------------------------------------------------------------------------
  // CV Generation
  // --------------------------------------------------------------------------

  async generateCVFromProfile(template: keyof typeof CV_TEMPLATES = 'modern'): Promise<string> {
    const profile = this.profileManager.getProfile();
    if (!profile) {
      throw new Error('No career profile found. Please create one first.');
    }

    const templateConfig = CV_TEMPLATES[template];
    let cv = '';

    // Header
    cv += `# ${profile.name}\n\n`;
    cv += `${profile.email}`;
    if (profile.location) cv += ` | ${profile.location}`;
    if (profile.linkedInUrl) cv += ` | [LinkedIn](${profile.linkedInUrl})`;
    if (profile.githubUrl) cv += ` | [GitHub](${profile.githubUrl})`;
    cv += '\n\n';

    // Generate sections in template order
    for (const section of templateConfig.sections) {
      switch (section) {
        case 'summary':
          cv += this.generateSummarySection(profile);
          break;
        case 'skills':
          cv += this.generateSkillsSection(profile);
          break;
        case 'experience':
          cv += this.generateExperienceSection(profile);
          break;
        case 'projects':
          cv += this.generateProjectsSection(profile);
          break;
        case 'education':
          cv += this.generateEducationSection(profile);
          break;
        case 'certifications':
          cv += this.generateCertificationsSection(profile);
          break;
      }
    }

    return cv;
  }

  private generateSummarySection(profile: CareerProfile): string {
    const years = profile.yearsOfExperience;
    const topSkills = profile.skills.technical
      .filter((s) => s.proficiency === 'advanced' || s.proficiency === 'expert')
      .slice(0, 5)
      .map((s) => s.name)
      .join(', ');

    const goal = profile.careerGoals.shortTerm || 'building impactful software';

    return `## Professional Summary\n\n` +
      `Results-driven software engineer with ${years}+ years of experience. ` +
      `Expert in ${topSkills}. ` +
      `Passionate about ${goal}.\n\n`;
  }

  private generateSkillsSection(profile: CareerProfile): string {
    let section = `## Technical Skills\n\n`;

    // Group by category
    const byCategory = new Map<string, TechnicalSkill[]>();
    for (const skill of profile.skills.technical) {
      const cat = skill.category;
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat)!.push(skill);
    }

    for (const [category, skills] of byCategory) {
      const skillNames = skills.map((s) => s.name).join(', ');
      section += `**${category}**: ${skillNames}\n`;
    }

    section += '\n';
    return section;
  }

  private generateExperienceSection(profile: CareerProfile): string {
    let section = `## Experience\n\n`;

    for (const job of profile.workHistory.slice(0, 4)) {
      const endDate = job.endDate
        ? new Date(job.endDate).toLocaleDateString('en-GB', { year: 'numeric', month: 'short' })
        : 'Present';
      const startDate = new Date(job.startDate).toLocaleDateString('en-GB', { year: 'numeric', month: 'short' });

      section += `### ${job.title}\n`;
      section += `**${job.company}** | ${job.location} | ${startDate} - ${endDate}\n\n`;

      for (const achievement of job.achievements.slice(0, 4)) {
        section += `• ${achievement}\n`;
      }

      section += '\n';
    }

    return section;
  }

  private generateProjectsSection(profile: CareerProfile): string {
    let section = `## Projects\n\n`;

    const portfolioProjects = profile.projects.filter((p) => p.isPersonal || p.isOpenSource);

    for (const project of portfolioProjects.slice(0, 3)) {
      section += `### ${project.name}`;
      if (project.url) section += ` | [Link](${project.url})`;
      if (project.githubUrl) section += ` | [GitHub](${project.githubUrl})`;
      section += '\n\n';

      section += `${project.description}\n\n`;
      section += `**Technologies**: ${project.technologies.join(', ')}\n\n`;

      for (const highlight of project.highlights.slice(0, 2)) {
        section += `• ${highlight}\n`;
      }

      section += '\n';
    }

    return section;
  }

  private generateEducationSection(profile: CareerProfile): string {
    let section = `## Education\n\n`;

    for (const edu of profile.education) {
      const endDate = edu.endDate
        ? new Date(edu.endDate).getFullYear()
        : 'Present';

      section += `### ${edu.degree} in ${edu.field}\n`;
      section += `**${edu.institution}** | ${endDate}\n`;
      if (edu.grade) section += `Grade: ${edu.grade}\n`;
      section += '\n';
    }

    return section;
  }

  private generateCertificationsSection(profile: CareerProfile): string {
    if (profile.certifications.length === 0) return '';

    let section = `## Certifications\n\n`;

    for (const cert of profile.certifications) {
      const date = new Date(cert.dateObtained).toLocaleDateString('en-GB', {
        year: 'numeric',
        month: 'short',
      });
      section += `• **${cert.name}** - ${cert.issuer} (${date})\n`;
    }

    section += '\n';
    return section;
  }

  // --------------------------------------------------------------------------
  // Helper Methods
  // --------------------------------------------------------------------------

  private extractSectionLength(content: string, patterns: string[]): number {
    // Simple heuristic - find section and count words until next section
    const contentLower = content.toLowerCase();

    for (const pattern of patterns) {
      const index = contentLower.indexOf(pattern);
      if (index >= 0) {
        const sectionContent = content.substring(index, index + 500);
        return sectionContent.split(/\s+/).length;
      }
    }

    return 0;
  }

  private countSkills(content: string): number {
    // Count items that look like skills (comma or bullet separated)
    const skillsMatch = content.match(/skills[:\s]*([\s\S]*?)(?=\n\n|$)/i);
    if (skillsMatch) {
      const skillsText = skillsMatch[1];
      const items = skillsText.split(/[,•\-\n]/);
      return items.filter((i) => i.trim().length > 2).length;
    }
    return 0;
  }

  // --------------------------------------------------------------------------
  // CV Version Management
  // --------------------------------------------------------------------------

  private cvVersions: CVVersion[] = [];

  /**
   * Get all saved CV versions
   */
  getCVVersions(): CVVersion[] {
    // Load from disk if needed
    const versionsPath = path.join(this.cvStoragePath, 'versions.json');
    if (fs.existsSync(versionsPath)) {
      try {
        this.cvVersions = JSON.parse(fs.readFileSync(versionsPath, 'utf-8'));
      } catch {
        this.cvVersions = [];
      }
    }
    return this.cvVersions;
  }

  /**
   * Save a new CV version
   */
  async saveCVVersion(
    content: string,
    name: string,
    targetRole?: string
  ): Promise<CVVersion> {
    const version: CVVersion = {
      id: `cv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      content,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      targetRole,
      score: 0,
      isDefault: this.cvVersions.length === 0,
    };

    // Analyze the CV to get a score
    const analysis = await this.analyzeCV(content, targetRole);
    version.score = analysis.overallScore;

    this.cvVersions.push(version);

    // Save to disk
    const versionsPath = path.join(this.cvStoragePath, 'versions.json');
    fs.writeFileSync(versionsPath, JSON.stringify(this.cvVersions, null, 2));

    // Also save the CV content to a separate file
    const cvPath = path.join(this.cvStoragePath, `${version.id}.txt`);
    fs.writeFileSync(cvPath, content);

    this.emit('cv-saved', version);
    return version;
  }

  /**
   * Get a specific CV version by ID
   */
  getCVVersion(versionId: string): CVVersion | undefined {
    return this.getCVVersions().find((v) => v.id === versionId);
  }

  /**
   * Delete a CV version
   */
  deleteCVVersion(versionId: string): boolean {
    const versions = this.getCVVersions();
    const index = versions.findIndex((v) => v.id === versionId);
    if (index === -1) return false;

    versions.splice(index, 1);
    this.cvVersions = versions;

    // Save to disk
    const versionsPath = path.join(this.cvStoragePath, 'versions.json');
    fs.writeFileSync(versionsPath, JSON.stringify(this.cvVersions, null, 2));

    // Delete the content file
    const cvPath = path.join(this.cvStoragePath, `${versionId}.txt`);
    if (fs.existsSync(cvPath)) {
      fs.unlinkSync(cvPath);
    }

    return true;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: CVOptimizer | null = null;

export function getCVOptimizer(): CVOptimizer {
  if (!instance) {
    instance = new CVOptimizer();
  }
  return instance;
}

export default CVOptimizer;
