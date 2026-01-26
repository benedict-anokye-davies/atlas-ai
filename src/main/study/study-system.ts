/**
 * Atlas Study System - University Learning Assistant
 *
 * AI-powered study system for:
 * - PDF lecture ingestion
 * - Note generation (Obsidian/Notion format)
 * - Concept explanation
 * - Spaced repetition flashcards
 * - Practice questions
 * - Study scheduling
 *
 * @module study/study-system
 */

import { createModuleLogger } from '../utils/logger';
import { getJarvisBrain } from '../cognitive';
import * as fs from 'fs';
import * as path from 'path';

const logger = createModuleLogger('StudySystem');

// ============================================================================
// Types
// ============================================================================

export interface Course {
  id: string;
  name: string;
  code: string;
  term: 'autumn' | 'spring' | 'summer';
  year: number;
  modules: Module[];
  notes: string[]; // Note IDs
  createdAt: number;
}

export interface Module {
  id: string;
  courseId: string;
  name: string;
  weekNumber?: number;
  topics: string[];
  lectureFiles: string[];
  notes: string[];
  concepts: Concept[];
  flashcards: Flashcard[];
  practiceQuestions: PracticeQuestion[];
}

export interface Concept {
  id: string;
  moduleId: string;
  name: string;
  definition: string;
  explanation: string;
  examples: string[];
  relatedConcepts: string[];
  difficulty: 'basic' | 'intermediate' | 'advanced';
  masteryLevel: number; // 0-1
  lastReviewed?: number;
  nextReview?: number;
}

export interface Flashcard {
  id: string;
  moduleId: string;
  conceptId?: string;
  front: string;
  back: string;
  difficulty: number; // 1-5
  easeFactor: number; // SM-2 algorithm
  interval: number; // Days
  repetitions: number;
  nextReview: number;
  lastReview?: number;
}

export interface PracticeQuestion {
  id: string;
  moduleId: string;
  conceptIds: string[];
  type: 'multiple-choice' | 'short-answer' | 'code' | 'essay';
  question: string;
  options?: string[]; // For multiple choice
  answer: string;
  explanation: string;
  difficulty: 'easy' | 'medium' | 'hard';
  timesAttempted: number;
  timesCorrect: number;
}

export interface StudySession {
  id: string;
  startTime: number;
  endTime?: number;
  moduleId: string;
  activities: StudyActivity[];
  conceptsReviewed: string[];
  flashcardsReviewed: number;
  questionsAttempted: number;
  questionsCorrect: number;
}

export interface StudyActivity {
  timestamp: number;
  type: 'read' | 'flashcard' | 'question' | 'explain' | 'practice';
  itemId: string;
  success?: boolean;
  timeSpent: number;
}

export interface LectureContent {
  title: string;
  content: string;
  sections: LectureSection[];
  concepts: ExtractedConcept[];
  keyPoints: string[];
  summary: string;
}

export interface LectureSection {
  title: string;
  content: string;
  pageNumbers?: number[];
}

export interface ExtractedConcept {
  name: string;
  definition: string;
  context: string;
}

export interface StudyPlan {
  id: string;
  userId: string;
  weeklyGoal: number; // Hours
  dailySchedule: DailyStudySlot[];
  priorityModules: string[];
  examDates: ExamDate[];
}

export interface DailyStudySlot {
  dayOfWeek: number; // 0-6
  startTime: string; // HH:mm
  endTime: string;
  focusArea?: string;
}

export interface ExamDate {
  moduleId: string;
  date: number;
  weight: number; // Percentage of grade
}

// ============================================================================
// Study System
// ============================================================================

export class StudySystem {
  private courses: Map<string, Course> = new Map();
  private modules: Map<string, Module> = new Map();
  private concepts: Map<string, Concept> = new Map();
  private flashcards: Map<string, Flashcard> = new Map();
  private questions: Map<string, PracticeQuestion> = new Map();
  private currentSession: StudySession | null = null;
  private dataDir: string;

  constructor(dataDir?: string) {
    this.dataDir = dataDir || path.join(process.env.APPDATA || '', 'atlas-desktop', 'study');
    this.ensureDataDir();
    this.loadData();
    logger.info('StudySystem initialized', { dataDir: this.dataDir });
  }

  private ensureDataDir(): void {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  private loadData(): void {
    try {
      const coursesPath = path.join(this.dataDir, 'courses.json');
      if (fs.existsSync(coursesPath)) {
        const data = JSON.parse(fs.readFileSync(coursesPath, 'utf-8'));
        for (const course of data.courses || []) {
          this.courses.set(course.id, course);
        }
        for (const module of data.modules || []) {
          this.modules.set(module.id, module);
        }
        for (const concept of data.concepts || []) {
          this.concepts.set(concept.id, concept);
        }
        for (const flashcard of data.flashcards || []) {
          this.flashcards.set(flashcard.id, flashcard);
        }
        for (const question of data.questions || []) {
          this.questions.set(question.id, question);
        }
        logger.info('Study data loaded', {
          courses: this.courses.size,
          modules: this.modules.size,
          concepts: this.concepts.size,
        });
      }
    } catch (error) {
      logger.error('Failed to load study data', { error: (error as Error).message });
    }
  }

  private saveData(): void {
    try {
      const data = {
        courses: Array.from(this.courses.values()),
        modules: Array.from(this.modules.values()),
        concepts: Array.from(this.concepts.values()),
        flashcards: Array.from(this.flashcards.values()),
        questions: Array.from(this.questions.values()),
      };
      fs.writeFileSync(
        path.join(this.dataDir, 'courses.json'),
        JSON.stringify(data, null, 2)
      );
    } catch (error) {
      logger.error('Failed to save study data', { error: (error as Error).message });
    }
  }

  // ==========================================================================
  // Course Management
  // ==========================================================================

  createCourse(name: string, code: string, term: 'autumn' | 'spring' | 'summer', year: number): Course {
    const course: Course = {
      id: `course-${Date.now()}`,
      name,
      code,
      term,
      year,
      modules: [],
      notes: [],
      createdAt: Date.now(),
    };
    this.courses.set(course.id, course);
    this.saveData();

    // Learn to brain
    const brain = getJarvisBrain();
    if (brain) {
      brain.learn({
        subject: 'Ben',
        predicate: 'is studying course',
        object: `${name} (${code}) at University of Nottingham`,
        confidence: 0.9,
        source: 'study-system',
      });
    }

    logger.info('Course created', { id: course.id, name, code });
    return course;
  }

  getCourse(id: string): Course | undefined {
    return this.courses.get(id);
  }

  getAllCourses(): Course[] {
    return Array.from(this.courses.values());
  }

  // ==========================================================================
  // Module Management
  // ==========================================================================

  createModule(courseId: string, name: string, weekNumber?: number): Module {
    const module: Module = {
      id: `module-${Date.now()}`,
      courseId,
      name,
      weekNumber,
      topics: [],
      lectureFiles: [],
      notes: [],
      concepts: [],
      flashcards: [],
      practiceQuestions: [],
    };
    this.modules.set(module.id, module);

    const course = this.courses.get(courseId);
    if (course) {
      course.modules.push(module);
    }

    this.saveData();
    logger.info('Module created', { id: module.id, name, courseId });
    return module;
  }

  getModule(id: string): Module | undefined {
    return this.modules.get(id);
  }

  // ==========================================================================
  // PDF Ingestion
  // ==========================================================================

  async ingestLecturePDF(pdfPath: string, moduleId: string): Promise<LectureContent> {
    logger.info('Ingesting lecture PDF', { path: pdfPath, moduleId });

    // Extract text from PDF (using pdf-parse or similar)
    const pdfText = await this.extractPDFText(pdfPath);
    
    // Parse and structure content
    const content = await this.parseLectureContent(pdfText, path.basename(pdfPath));

    // Extract concepts
    const concepts = await this.extractConcepts(content);
    content.concepts = concepts;

    // Generate summary
    content.summary = await this.generateSummary(content);

    // Store in module
    const module = this.modules.get(moduleId);
    if (module) {
      module.lectureFiles.push(pdfPath);
      
      // Add concepts to module
      for (const extractedConcept of concepts) {
        const concept = this.createConcept(moduleId, extractedConcept);
        module.concepts.push(concept);
      }

      // Generate flashcards
      const flashcards = await this.generateFlashcards(content, moduleId);
      module.flashcards.push(...flashcards);

      // Generate practice questions
      const questions = await this.generatePracticeQuestions(content, moduleId);
      module.practiceQuestions.push(...questions);
    }

    this.saveData();

    // Learn to brain
    const brain = getJarvisBrain();
    if (brain) {
      brain.learn({
        subject: 'Lecture',
        predicate: 'covers',
        object: `${content.title} - ${content.summary}`,
        confidence: 0.8,
        source: 'study-system',
      });
      
      for (const concept of concepts) {
        brain.learn({
          subject: concept.name,
          predicate: 'is defined as',
          object: concept.definition,
          confidence: 0.9,
          source: 'study-system',
        });
      }
    }

    logger.info('Lecture ingested', {
      title: content.title,
      sections: content.sections.length,
      concepts: concepts.length,
    });

    return content;
  }

  private async extractPDFText(pdfPath: string): Promise<string> {
    // Use pdf-parse library for PDF text extraction
    try {
      const pdfParseModule = await import('pdf-parse');
      const dataBuffer = fs.readFileSync(pdfPath);
      // pdf-parse may export as default or directly - handle both cases
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parseFn = (pdfParseModule as any).default ?? pdfParseModule;
      const data = await parseFn(dataBuffer);
      return data.text;
    } catch (error) {
      logger.error('PDF parsing failed, using fallback', { error: (error as Error).message });
      // Fallback: read as text if possible
      return fs.readFileSync(pdfPath, 'utf-8');
    }
  }

  private async parseLectureContent(text: string, filename: string): Promise<LectureContent> {
    // Split into sections based on common patterns
    const lines = text.split('\n').filter(l => l.trim());
    const sections: LectureSection[] = [];
    let currentSection: LectureSection | null = null;
    const keyPoints: string[] = [];

    for (const line of lines) {
      // Detect section headers (numbered, capitalized, etc.)
      if (this.isSectionHeader(line)) {
        if (currentSection) {
          sections.push(currentSection);
        }
        currentSection = {
          title: line.trim(),
          content: '',
        };
      } else if (currentSection) {
        currentSection.content += line + '\n';
      }

      // Extract bullet points as key points
      if (line.trim().startsWith('•') || line.trim().startsWith('-') || line.trim().match(/^\d+\./)) {
        keyPoints.push(line.trim().replace(/^[•\-\d.]+\s*/, ''));
      }
    }

    if (currentSection) {
      sections.push(currentSection);
    }

    return {
      title: this.extractTitle(filename, lines),
      content: text,
      sections,
      concepts: [],
      keyPoints: keyPoints.slice(0, 20), // Top 20 key points
      summary: '',
    };
  }

  private isSectionHeader(line: string): boolean {
    const trimmed = line.trim();
    // Check for numbered sections
    if (/^\d+(\.\d+)*\s+[A-Z]/.test(trimmed)) return true;
    // Check for all caps headers
    if (trimmed === trimmed.toUpperCase() && trimmed.length > 3 && trimmed.length < 100) return true;
    // Check for markdown-style headers
    if (/^#+\s/.test(trimmed)) return true;
    return false;
  }

  private extractTitle(filename: string, lines: string[]): string {
    // Try to find title from first few lines
    for (let i = 0; i < Math.min(5, lines.length); i++) {
      const line = lines[i].trim();
      if (line.length > 10 && line.length < 100 && !line.includes('http')) {
        return line;
      }
    }
    // Fallback to filename
    return filename.replace(/\.pdf$/i, '').replace(/[_-]/g, ' ');
  }

  private async extractConcepts(content: LectureContent): Promise<ExtractedConcept[]> {
    const concepts: ExtractedConcept[] = [];
    const seenNames = new Set<string>();

    // Pattern matching for definitions
    const definitionPatterns = [
      /([A-Z][a-z]+(?:\s+[A-Z]?[a-z]+)*)\s+(?:is|are|refers to|means|denotes|represents)\s+([^.]+\.)/g,
      /([A-Z][a-z]+(?:\s+[A-Z]?[a-z]+)*):\s+([^.]+\.)/g,
      /Definition[:\s]+([^:]+):\s+([^.]+\.)/gi,
    ];

    for (const pattern of definitionPatterns) {
      const matches = content.content.matchAll(pattern);
      for (const match of matches) {
        const name = match[1].trim();
        const definition = match[2].trim();
        
        if (!seenNames.has(name.toLowerCase()) && name.length > 2 && definition.length > 10) {
          seenNames.add(name.toLowerCase());
          concepts.push({
            name,
            definition,
            context: this.findContext(content.content, match.index || 0),
          });
        }
      }
    }

    // Also extract emphasized terms
    const emphasisPatterns = [
      /\*\*([^*]+)\*\*/g, // Bold
      /''([^']+)''/g, // Italic
      /"([A-Z][^"]+)"/g, // Quoted terms
    ];

    for (const pattern of emphasisPatterns) {
      const matches = content.content.matchAll(pattern);
      for (const match of matches) {
        const name = match[1].trim();
        if (!seenNames.has(name.toLowerCase()) && name.length > 2) {
          seenNames.add(name.toLowerCase());
          concepts.push({
            name,
            definition: 'See context for details.',
            context: this.findContext(content.content, match.index || 0),
          });
        }
      }
    }

    return concepts.slice(0, 50); // Limit to 50 concepts per lecture
  }

  private findContext(text: string, position: number, radius: number = 200): string {
    const start = Math.max(0, position - radius);
    const end = Math.min(text.length, position + radius);
    return text.slice(start, end).replace(/\s+/g, ' ').trim();
  }

  private async generateSummary(content: LectureContent): Promise<string> {
    // Generate a concise summary
    const keyPoints = content.keyPoints.slice(0, 5).join(' ');
    const conceptNames = content.concepts.map(c => c.name).slice(0, 10).join(', ');
    
    return `This lecture covers: ${conceptNames}. Key takeaways: ${keyPoints}`;
  }

  // ==========================================================================
  // Concept Management
  // ==========================================================================

  createConcept(moduleId: string, extracted: ExtractedConcept): Concept {
    const concept: Concept = {
      id: `concept-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      moduleId,
      name: extracted.name,
      definition: extracted.definition,
      explanation: extracted.context,
      examples: [],
      relatedConcepts: [],
      difficulty: 'intermediate',
      masteryLevel: 0,
    };
    this.concepts.set(concept.id, concept);
    return concept;
  }

  getConcept(id: string): Concept | undefined {
    return this.concepts.get(id);
  }

  async explainConcept(conceptId: string, depth: 'simple' | 'detailed' | 'expert' = 'detailed'): Promise<string> {
    const concept = this.concepts.get(conceptId);
    if (!concept) return 'Concept not found.';

    const brain = getJarvisBrain();
    if (brain) {
      const response = await brain.ask(`Explain ${concept.name}: ${concept.definition}`);
      return response?.answer || concept.explanation;
    }

    // Fallback explanation
    let explanation = `**${concept.name}**\n\n`;
    explanation += `**Definition:** ${concept.definition}\n\n`;
    
    if (depth !== 'simple') {
      explanation += `**Explanation:** ${concept.explanation}\n\n`;
    }
    
    if (depth === 'expert' && concept.examples.length > 0) {
      explanation += `**Examples:**\n`;
      for (const example of concept.examples) {
        explanation += `- ${example}\n`;
      }
    }

    return explanation;
  }

  // ==========================================================================
  // Flashcard System (SM-2 Algorithm)
  // ==========================================================================

  private async generateFlashcards(content: LectureContent, moduleId: string): Promise<Flashcard[]> {
    const flashcards: Flashcard[] = [];

    // Create flashcards from concepts
    for (const concept of content.concepts) {
      // Definition card
      flashcards.push(this.createFlashcard(moduleId, undefined, 
        `What is ${concept.name}?`,
        concept.definition
      ));

      // Reverse card
      flashcards.push(this.createFlashcard(moduleId, undefined,
        concept.definition,
        concept.name
      ));
    }

    // Create flashcards from key points
    for (let i = 0; i < content.keyPoints.length; i += 2) {
      if (content.keyPoints[i + 1]) {
        flashcards.push(this.createFlashcard(moduleId, undefined,
          content.keyPoints[i],
          content.keyPoints[i + 1]
        ));
      }
    }

    return flashcards;
  }

  createFlashcard(moduleId: string, conceptId: string | undefined, front: string, back: string): Flashcard {
    const flashcard: Flashcard = {
      id: `flashcard-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      moduleId,
      conceptId,
      front,
      back,
      difficulty: 3,
      easeFactor: 2.5, // SM-2 default
      interval: 1,
      repetitions: 0,
      nextReview: Date.now(),
    };
    this.flashcards.set(flashcard.id, flashcard);
    return flashcard;
  }

  reviewFlashcard(flashcardId: string, quality: number): void {
    // quality: 0-5 (0=complete blackout, 5=perfect response)
    const card = this.flashcards.get(flashcardId);
    if (!card) return;

    // SM-2 Algorithm
    if (quality < 3) {
      // Failed - reset
      card.repetitions = 0;
      card.interval = 1;
    } else {
      // Passed
      if (card.repetitions === 0) {
        card.interval = 1;
      } else if (card.repetitions === 1) {
        card.interval = 6;
      } else {
        card.interval = Math.round(card.interval * card.easeFactor);
      }
      card.repetitions++;
    }

    // Update ease factor
    card.easeFactor = Math.max(1.3,
      card.easeFactor + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)
    );

    // Set next review
    card.lastReview = Date.now();
    card.nextReview = Date.now() + card.interval * 24 * 60 * 60 * 1000;

    this.saveData();
  }

  getDueFlashcards(moduleId?: string, limit: number = 20): Flashcard[] {
    const now = Date.now();
    let cards = Array.from(this.flashcards.values())
      .filter(c => c.nextReview <= now);

    if (moduleId) {
      cards = cards.filter(c => c.moduleId === moduleId);
    }

    // Sort by overdue time
    cards.sort((a, b) => a.nextReview - b.nextReview);

    return cards.slice(0, limit);
  }

  // ==========================================================================
  // Practice Questions
  // ==========================================================================

  private async generatePracticeQuestions(content: LectureContent, moduleId: string): Promise<PracticeQuestion[]> {
    const questions: PracticeQuestion[] = [];

    // Generate questions from concepts
    for (const concept of content.concepts) {
      // Multiple choice
      questions.push({
        id: `question-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        moduleId,
        conceptIds: [],
        type: 'short-answer',
        question: `Define ${concept.name} and explain its significance.`,
        answer: concept.definition,
        explanation: concept.context,
        difficulty: 'medium',
        timesAttempted: 0,
        timesCorrect: 0,
      });
    }

    return questions;
  }

  answerQuestion(questionId: string, correct: boolean): void {
    const question = this.questions.get(questionId);
    if (!question) return;

    question.timesAttempted++;
    if (correct) {
      question.timesCorrect++;
    }

    this.saveData();
  }

  // ==========================================================================
  // Study Sessions
  // ==========================================================================

  startStudySession(moduleId: string): StudySession {
    this.currentSession = {
      id: `session-${Date.now()}`,
      startTime: Date.now(),
      moduleId,
      activities: [],
      conceptsReviewed: [],
      flashcardsReviewed: 0,
      questionsAttempted: 0,
      questionsCorrect: 0,
    };
    logger.info('Study session started', { sessionId: this.currentSession.id, moduleId });
    return this.currentSession;
  }

  endStudySession(): StudySession | null {
    if (!this.currentSession) return null;

    this.currentSession.endTime = Date.now();
    const session = this.currentSession;
    this.currentSession = null;

    // Log to brain
    const brain = getJarvisBrain();
    if (brain) {
      const duration = Math.round((session.endTime! - session.startTime) / 60000);
      brain.learn({
        subject: 'Ben',
        predicate: 'studied for',
        object: `${duration} minutes, reviewed ${session.flashcardsReviewed} flashcards`,
        confidence: 1.0,
        source: 'study-system',
      });
    }

    logger.info('Study session ended', {
      sessionId: session.id,
      duration: (session.endTime ?? Date.now()) - session.startTime,
      flashcards: session.flashcardsReviewed,
    });

    return session;
  }

  // ==========================================================================
  // Note Generation
  // ==========================================================================

  async generateObsidianNote(moduleId: string): Promise<string> {
    const module = this.modules.get(moduleId);
    if (!module) return '';

    const course = this.courses.get(module.courseId);
    
    let note = `# ${module.name}\n\n`;
    note += `**Course:** ${course?.name || 'Unknown'}\n`;
    note += `**Week:** ${module.weekNumber || 'N/A'}\n`;
    note += `**Topics:** ${module.topics.join(', ') || 'TBD'}\n\n`;
    note += `---\n\n`;

    // Concepts
    note += `## Key Concepts\n\n`;
    for (const concept of module.concepts) {
      note += `### ${concept.name}\n`;
      note += `${concept.definition}\n\n`;
      if (concept.examples.length > 0) {
        note += `**Examples:**\n`;
        for (const example of concept.examples) {
          note += `- ${example}\n`;
        }
        note += '\n';
      }
      note += `---\n\n`;
    }

    // Links
    note += `## Related\n`;
    for (const relatedConcept of module.concepts.slice(0, 5)) {
      note += `- [[${relatedConcept.name}]]\n`;
    }

    return note;
  }

  // ==========================================================================
  // Statistics
  // ==========================================================================

  getStudyStats(): {
    totalCourses: number;
    totalModules: number;
    totalConcepts: number;
    totalFlashcards: number;
    dueFlashcards: number;
    averageMastery: number;
  } {
    const dueCards = this.getDueFlashcards().length;
    const concepts = Array.from(this.concepts.values());
    const avgMastery = concepts.length > 0
      ? concepts.reduce((sum, c) => sum + c.masteryLevel, 0) / concepts.length
      : 0;

    return {
      totalCourses: this.courses.size,
      totalModules: this.modules.size,
      totalConcepts: this.concepts.size,
      totalFlashcards: this.flashcards.size,
      dueFlashcards: dueCards,
      averageMastery: avgMastery,
    };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let studySystemInstance: StudySystem | null = null;

export function getStudySystem(): StudySystem {
  if (!studySystemInstance) {
    studySystemInstance = new StudySystem();
  }
  return studySystemInstance;
}

export function initializeStudySystem(dataDir?: string): StudySystem {
  studySystemInstance = new StudySystem(dataDir);
  return studySystemInstance;
}
