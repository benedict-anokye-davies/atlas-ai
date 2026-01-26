/**
 * Atlas Desktop - Cross-Project Learning System
 * 
 * Learns from ALL your projects and applies that knowledge everywhere:
 * - Recognizes similar problems you've solved before
 * - Builds a personal library of coding patterns
 * - Suggests code from your other repositories
 * - Tracks your coding style preferences
 * - Remembers debugging solutions
 * 
 * @module memory/cross-project-learning
 */

import { EventEmitter } from 'events';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import Database from 'better-sqlite3';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('CrossProjectLearning');

// ============================================================================
// Types
// ============================================================================

export interface Project {
  id: string;
  name: string;
  path: string;
  languages: string[];
  frameworks: string[];
  lastAccessed: number;
  stats: ProjectStats;
}

export interface ProjectStats {
  filesAnalyzed: number;
  patternsLearned: number;
  problemsSolved: number;
  timeSpent: number; // minutes
}

export interface CodePattern {
  id: string;
  name: string;
  description: string;
  category: PatternCategory;
  code: string;
  language: string;
  framework?: string;
  usage: PatternUsage;
  projects: string[]; // project IDs
  created: number;
  lastUsed: number;
  quality: number; // 0-1 based on usage
}

export type PatternCategory =
  | 'component'
  | 'hook'
  | 'api'
  | 'utility'
  | 'config'
  | 'test'
  | 'error-handling'
  | 'data-fetching'
  | 'state-management'
  | 'authentication'
  | 'styling'
  | 'animation'
  | 'other';

export interface PatternUsage {
  timesUsed: number;
  timesModified: number;
  timesSuggested: number;
  timesAccepted: number;
}

export interface ProblemSolution {
  id: string;
  problem: string;
  problemHash: string;
  solution: string;
  solutionType: 'code' | 'command' | 'config' | 'explanation';
  category: string;
  projects: string[];
  successRate: number; // 0-1
  timesApplied: number;
  created: number;
  lastUsed: number;
}

export interface StylePreference {
  id: string;
  category: string;
  preference: string;
  value: any;
  confidence: number;
  occurrences: number;
}

export interface SimilarityMatch {
  item: CodePattern | ProblemSolution;
  score: number;
  matchType: 'exact' | 'similar' | 'related';
}

// ============================================================================
// Database Schema
// ============================================================================

const SCHEMA = `
  -- Projects table
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT UNIQUE NOT NULL,
    languages TEXT NOT NULL, -- JSON array
    frameworks TEXT NOT NULL, -- JSON array
    last_accessed INTEGER NOT NULL,
    stats TEXT NOT NULL -- JSON object
  );

  -- Code patterns table
  CREATE TABLE IF NOT EXISTS patterns (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    code TEXT NOT NULL,
    language TEXT NOT NULL,
    framework TEXT,
    usage TEXT NOT NULL, -- JSON object
    projects TEXT NOT NULL, -- JSON array
    created INTEGER NOT NULL,
    last_used INTEGER NOT NULL,
    quality REAL NOT NULL DEFAULT 0.5
  );

  -- Problem solutions table
  CREATE TABLE IF NOT EXISTS solutions (
    id TEXT PRIMARY KEY,
    problem TEXT NOT NULL,
    problem_hash TEXT NOT NULL,
    solution TEXT NOT NULL,
    solution_type TEXT NOT NULL,
    category TEXT NOT NULL,
    projects TEXT NOT NULL, -- JSON array
    success_rate REAL NOT NULL DEFAULT 0.5,
    times_applied INTEGER NOT NULL DEFAULT 0,
    created INTEGER NOT NULL,
    last_used INTEGER NOT NULL
  );

  -- Style preferences table
  CREATE TABLE IF NOT EXISTS style_preferences (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    preference TEXT NOT NULL,
    value TEXT NOT NULL, -- JSON
    confidence REAL NOT NULL DEFAULT 0.5,
    occurrences INTEGER NOT NULL DEFAULT 1
  );

  -- Full-text search for patterns
  CREATE VIRTUAL TABLE IF NOT EXISTS patterns_fts USING fts5(
    id,
    name,
    description,
    code,
    content='patterns'
  );

  -- Full-text search for solutions
  CREATE VIRTUAL TABLE IF NOT EXISTS solutions_fts USING fts5(
    id,
    problem,
    solution,
    content='solutions'
  );

  -- Triggers to keep FTS in sync
  CREATE TRIGGER IF NOT EXISTS patterns_ai AFTER INSERT ON patterns BEGIN
    INSERT INTO patterns_fts(id, name, description, code) 
    VALUES (new.id, new.name, new.description, new.code);
  END;

  CREATE TRIGGER IF NOT EXISTS patterns_ad AFTER DELETE ON patterns BEGIN
    INSERT INTO patterns_fts(patterns_fts, id, name, description, code) 
    VALUES ('delete', old.id, old.name, old.description, old.code);
  END;

  CREATE TRIGGER IF NOT EXISTS solutions_ai AFTER INSERT ON solutions BEGIN
    INSERT INTO solutions_fts(id, problem, solution) 
    VALUES (new.id, new.problem, new.solution);
  END;

  CREATE TRIGGER IF NOT EXISTS solutions_ad AFTER DELETE ON solutions BEGIN
    INSERT INTO solutions_fts(solutions_fts, id, problem, solution) 
    VALUES ('delete', old.id, old.problem, old.solution);
  END;

  -- Indexes
  CREATE INDEX IF NOT EXISTS idx_patterns_category ON patterns(category);
  CREATE INDEX IF NOT EXISTS idx_patterns_language ON patterns(language);
  CREATE INDEX IF NOT EXISTS idx_patterns_quality ON patterns(quality DESC);
  CREATE INDEX IF NOT EXISTS idx_solutions_hash ON solutions(problem_hash);
  CREATE INDEX IF NOT EXISTS idx_solutions_category ON solutions(category);
`;

// ============================================================================
// Cross-Project Learning Class
// ============================================================================

export class CrossProjectLearning extends EventEmitter {
  private db: Database.Database | null = null;
  private dbPath: string;
  private isInitialized: boolean = false;
  
  constructor(dbPath?: string) {
    super();
    this.dbPath = dbPath || path.join(
      process.env.APPDATA || process.env.HOME || '.',
      '.atlas',
      'cross-project-learning.db'
    );
  }
  
  // ==========================================================================
  // Initialization
  // ==========================================================================
  
  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    
    logger.info('Initializing Cross-Project Learning System');
    
    // Ensure directory exists
    await fs.mkdir(path.dirname(this.dbPath), { recursive: true });
    
    // Open database
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    
    // Create schema
    this.db.exec(SCHEMA);
    
    this.isInitialized = true;
    this.emit('initialized');
    
    logger.info('Cross-Project Learning initialized', { dbPath: this.dbPath });
  }
  
  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.isInitialized = false;
  }
  
  private ensureInitialized(): void {
    if (!this.db) throw new Error('CrossProjectLearning not initialized');
  }
  
  // ==========================================================================
  // Project Management
  // ==========================================================================
  
  registerProject(projectPath: string, info: Partial<Project> = {}): Project {
    this.ensureInitialized();
    
    const id = crypto.createHash('md5').update(projectPath).digest('hex').slice(0, 16);
    const name = info.name || path.basename(projectPath);
    
    const project: Project = {
      id,
      name,
      path: projectPath,
      languages: info.languages || [],
      frameworks: info.frameworks || [],
      lastAccessed: Date.now(),
      stats: info.stats || {
        filesAnalyzed: 0,
        patternsLearned: 0,
        problemsSolved: 0,
        timeSpent: 0,
      },
    };
    
    const stmt = this.db!.prepare(`
      INSERT OR REPLACE INTO projects (id, name, path, languages, frameworks, last_accessed, stats)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      project.id,
      project.name,
      project.path,
      JSON.stringify(project.languages),
      JSON.stringify(project.frameworks),
      project.lastAccessed,
      JSON.stringify(project.stats)
    );
    
    this.emit('projectRegistered', project);
    logger.info('Project registered', { name: project.name, id: project.id });
    
    return project;
  }
  
  getProject(projectPath: string): Project | null {
    this.ensureInitialized();
    
    const stmt = this.db!.prepare('SELECT * FROM projects WHERE path = ?');
    const row = stmt.get(projectPath) as any;
    
    if (!row) return null;
    
    return {
      id: row.id,
      name: row.name,
      path: row.path,
      languages: JSON.parse(row.languages),
      frameworks: JSON.parse(row.frameworks),
      lastAccessed: row.last_accessed,
      stats: JSON.parse(row.stats),
    };
  }
  
  getAllProjects(): Project[] {
    this.ensureInitialized();
    
    const stmt = this.db!.prepare('SELECT * FROM projects ORDER BY last_accessed DESC');
    const rows = stmt.all() as any[];
    
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      path: row.path,
      languages: JSON.parse(row.languages),
      frameworks: JSON.parse(row.frameworks),
      lastAccessed: row.last_accessed,
      stats: JSON.parse(row.stats),
    }));
  }
  
  // ==========================================================================
  // Pattern Learning
  // ==========================================================================
  
  learnPattern(pattern: Omit<CodePattern, 'id' | 'created' | 'lastUsed' | 'quality'>): CodePattern {
    this.ensureInitialized();
    
    const id = `pat_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const now = Date.now();
    
    const fullPattern: CodePattern = {
      ...pattern,
      id,
      created: now,
      lastUsed: now,
      quality: 0.5,
    };
    
    const stmt = this.db!.prepare(`
      INSERT INTO patterns (id, name, description, category, code, language, framework, usage, projects, created, last_used, quality)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      fullPattern.id,
      fullPattern.name,
      fullPattern.description,
      fullPattern.category,
      fullPattern.code,
      fullPattern.language,
      fullPattern.framework || null,
      JSON.stringify(fullPattern.usage),
      JSON.stringify(fullPattern.projects),
      fullPattern.created,
      fullPattern.lastUsed,
      fullPattern.quality
    );
    
    this.emit('patternLearned', fullPattern);
    logger.info('Pattern learned', { name: fullPattern.name, category: fullPattern.category });
    
    return fullPattern;
  }
  
  findSimilarPatterns(query: string, options: {
    limit?: number;
    category?: PatternCategory;
    language?: string;
    minQuality?: number;
  } = {}): SimilarityMatch[] {
    this.ensureInitialized();
    
    const { limit = 10, category, language, minQuality = 0 } = options;
    
    // Use FTS for search
    let sql = `
      SELECT p.*, patterns_fts.rank
      FROM patterns p
      JOIN patterns_fts ON p.id = patterns_fts.id
      WHERE patterns_fts MATCH ?
      AND p.quality >= ?
    `;
    
    const params: any[] = [query, minQuality];
    
    if (category) {
      sql += ' AND p.category = ?';
      params.push(category);
    }
    
    if (language) {
      sql += ' AND p.language = ?';
      params.push(language);
    }
    
    sql += ' ORDER BY rank LIMIT ?';
    params.push(limit);
    
    try {
      const stmt = this.db!.prepare(sql);
      const rows = stmt.all(...params) as any[];
      
      return rows.map(row => ({
        item: {
          id: row.id,
          name: row.name,
          description: row.description,
          category: row.category as PatternCategory,
          code: row.code,
          language: row.language,
          framework: row.framework,
          usage: JSON.parse(row.usage),
          projects: JSON.parse(row.projects),
          created: row.created,
          lastUsed: row.last_used,
          quality: row.quality,
        } as CodePattern,
        score: Math.abs(row.rank),
        matchType: row.rank > -5 ? 'exact' : row.rank > -10 ? 'similar' : 'related',
      }));
    } catch (error) {
      logger.debug('Pattern search failed, falling back to LIKE', { error });
      
      // Fallback to LIKE search
      const likeStmt = this.db!.prepare(`
        SELECT * FROM patterns 
        WHERE (name LIKE ? OR description LIKE ? OR code LIKE ?)
        AND quality >= ?
        ${category ? 'AND category = ?' : ''}
        ${language ? 'AND language = ?' : ''}
        ORDER BY quality DESC
        LIMIT ?
      `);
      
      const likeParams = [
        `%${query}%`,
        `%${query}%`,
        `%${query}%`,
        minQuality,
        ...(category ? [category] : []),
        ...(language ? [language] : []),
        limit,
      ];
      
      const rows = likeStmt.all(...likeParams) as any[];
      
      return rows.map(row => ({
        item: {
          id: row.id,
          name: row.name,
          description: row.description,
          category: row.category as PatternCategory,
          code: row.code,
          language: row.language,
          framework: row.framework,
          usage: JSON.parse(row.usage),
          projects: JSON.parse(row.projects),
          created: row.created,
          lastUsed: row.last_used,
          quality: row.quality,
        } as CodePattern,
        score: 0.5,
        matchType: 'similar' as const,
      }));
    }
  }
  
  markPatternUsed(patternId: string, accepted: boolean): void {
    this.ensureInitialized();
    
    const pattern = this.getPatternById(patternId);
    if (!pattern) return;
    
    const usage = pattern.usage;
    usage.timesUsed++;
    usage.timesSuggested++;
    if (accepted) usage.timesAccepted++;
    
    // Update quality based on acceptance rate
    const quality = usage.timesAccepted / usage.timesSuggested;
    
    const stmt = this.db!.prepare(`
      UPDATE patterns SET usage = ?, last_used = ?, quality = ? WHERE id = ?
    `);
    
    stmt.run(JSON.stringify(usage), Date.now(), quality, patternId);
    
    this.emit('patternUsed', { patternId, accepted });
  }
  
  private getPatternById(id: string): CodePattern | null {
    const stmt = this.db!.prepare('SELECT * FROM patterns WHERE id = ?');
    const row = stmt.get(id) as any;
    if (!row) return null;
    
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      category: row.category,
      code: row.code,
      language: row.language,
      framework: row.framework,
      usage: JSON.parse(row.usage),
      projects: JSON.parse(row.projects),
      created: row.created,
      lastUsed: row.last_used,
      quality: row.quality,
    };
  }
  
  // ==========================================================================
  // Problem Solutions
  // ==========================================================================
  
  learnSolution(solution: Omit<ProblemSolution, 'id' | 'problemHash' | 'created' | 'lastUsed'>): ProblemSolution {
    this.ensureInitialized();
    
    const id = `sol_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const problemHash = crypto.createHash('md5').update(solution.problem.toLowerCase()).digest('hex');
    const now = Date.now();
    
    const fullSolution: ProblemSolution = {
      ...solution,
      id,
      problemHash,
      created: now,
      lastUsed: now,
    };
    
    const stmt = this.db!.prepare(`
      INSERT INTO solutions (id, problem, problem_hash, solution, solution_type, category, projects, success_rate, times_applied, created, last_used)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      fullSolution.id,
      fullSolution.problem,
      fullSolution.problemHash,
      fullSolution.solution,
      fullSolution.solutionType,
      fullSolution.category,
      JSON.stringify(fullSolution.projects),
      fullSolution.successRate,
      fullSolution.timesApplied,
      fullSolution.created,
      fullSolution.lastUsed
    );
    
    this.emit('solutionLearned', fullSolution);
    logger.info('Solution learned', { category: fullSolution.category });
    
    return fullSolution;
  }
  
  findSolution(problem: string): SimilarityMatch[] {
    this.ensureInitialized();
    
    // First try exact hash match
    const problemHash = crypto.createHash('md5').update(problem.toLowerCase()).digest('hex');
    
    const exactStmt = this.db!.prepare('SELECT * FROM solutions WHERE problem_hash = ?');
    const exactMatch = exactStmt.get(problemHash) as any;
    
    if (exactMatch) {
      return [{
        item: this.rowToSolution(exactMatch),
        score: 1.0,
        matchType: 'exact',
      }];
    }
    
    // Try FTS search
    try {
      const ftsStmt = this.db!.prepare(`
        SELECT s.*, solutions_fts.rank
        FROM solutions s
        JOIN solutions_fts ON s.id = solutions_fts.id
        WHERE solutions_fts MATCH ?
        ORDER BY rank
        LIMIT 5
      `);
      
      const rows = ftsStmt.all(problem) as any[];
      
      return rows.map(row => ({
        item: this.rowToSolution(row),
        score: Math.abs(row.rank) / 10, // Normalize
        matchType: row.rank > -5 ? 'similar' : 'related',
      }));
    } catch (error) {
      // Fallback to LIKE
      const likeStmt = this.db!.prepare(`
        SELECT * FROM solutions WHERE problem LIKE ? OR solution LIKE ?
        ORDER BY success_rate DESC LIMIT 5
      `);
      
      const rows = likeStmt.all(`%${problem}%`, `%${problem}%`) as any[];
      
      return rows.map(row => ({
        item: this.rowToSolution(row),
        score: 0.5,
        matchType: 'related' as const,
      }));
    }
  }
  
  markSolutionApplied(solutionId: string, success: boolean): void {
    this.ensureInitialized();
    
    const stmt = this.db!.prepare('SELECT * FROM solutions WHERE id = ?');
    const row = stmt.get(solutionId) as any;
    if (!row) return;
    
    const timesApplied = row.times_applied + 1;
    const successRate = success
      ? (row.success_rate * row.times_applied + 1) / timesApplied
      : (row.success_rate * row.times_applied) / timesApplied;
    
    const updateStmt = this.db!.prepare(`
      UPDATE solutions SET times_applied = ?, success_rate = ?, last_used = ? WHERE id = ?
    `);
    
    updateStmt.run(timesApplied, successRate, Date.now(), solutionId);
    
    this.emit('solutionApplied', { solutionId, success });
  }
  
  private rowToSolution(row: any): ProblemSolution {
    return {
      id: row.id,
      problem: row.problem,
      problemHash: row.problem_hash,
      solution: row.solution,
      solutionType: row.solution_type,
      category: row.category,
      projects: JSON.parse(row.projects),
      successRate: row.success_rate,
      timesApplied: row.times_applied,
      created: row.created,
      lastUsed: row.last_used,
    };
  }
  
  // ==========================================================================
  // Style Preferences
  // ==========================================================================
  
  recordStylePreference(category: string, preference: string, value: any): void {
    this.ensureInitialized();
    
    const id = `${category}:${preference}`;
    
    // Check if exists
    const existingStmt = this.db!.prepare('SELECT * FROM style_preferences WHERE id = ?');
    const existing = existingStmt.get(id) as any;
    
    if (existing) {
      // Update
      const occurrences = existing.occurrences + 1;
      const confidence = Math.min(1, 0.5 + (occurrences * 0.1)); // Increases with usage
      
      const updateStmt = this.db!.prepare(`
        UPDATE style_preferences SET value = ?, confidence = ?, occurrences = ? WHERE id = ?
      `);
      updateStmt.run(JSON.stringify(value), confidence, occurrences, id);
    } else {
      // Insert
      const insertStmt = this.db!.prepare(`
        INSERT INTO style_preferences (id, category, preference, value, confidence, occurrences)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      insertStmt.run(id, category, preference, JSON.stringify(value), 0.5, 1);
    }
    
    this.emit('stylePreferenceRecorded', { category, preference, value });
  }
  
  getStylePreferences(category?: string): StylePreference[] {
    this.ensureInitialized();
    
    let sql = 'SELECT * FROM style_preferences';
    const params: any[] = [];
    
    if (category) {
      sql += ' WHERE category = ?';
      params.push(category);
    }
    
    sql += ' ORDER BY confidence DESC';
    
    const stmt = this.db!.prepare(sql);
    const rows = stmt.all(...params) as any[];
    
    return rows.map(row => ({
      id: row.id,
      category: row.category,
      preference: row.preference,
      value: JSON.parse(row.value),
      confidence: row.confidence,
      occurrences: row.occurrences,
    }));
  }
  
  // ==========================================================================
  // Analytics
  // ==========================================================================
  
  getStats(): {
    totalProjects: number;
    totalPatterns: number;
    totalSolutions: number;
    topPatterns: CodePattern[];
    recentProjects: Project[];
  } {
    this.ensureInitialized();
    
    const projectCount = (this.db!.prepare('SELECT COUNT(*) as count FROM projects').get() as any).count;
    const patternCount = (this.db!.prepare('SELECT COUNT(*) as count FROM patterns').get() as any).count;
    const solutionCount = (this.db!.prepare('SELECT COUNT(*) as count FROM solutions').get() as any).count;
    
    const topPatternsStmt = this.db!.prepare('SELECT * FROM patterns ORDER BY quality DESC LIMIT 10');
    const topPatterns = (topPatternsStmt.all() as any[]).map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      category: row.category,
      code: row.code,
      language: row.language,
      framework: row.framework,
      usage: JSON.parse(row.usage),
      projects: JSON.parse(row.projects),
      created: row.created,
      lastUsed: row.last_used,
      quality: row.quality,
    }));
    
    const recentProjects = this.getAllProjects().slice(0, 5);
    
    return {
      totalProjects: projectCount,
      totalPatterns: patternCount,
      totalSolutions: solutionCount,
      topPatterns,
      recentProjects,
    };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: CrossProjectLearning | null = null;

export async function getCrossProjectLearning(): Promise<CrossProjectLearning> {
  if (!instance) {
    instance = new CrossProjectLearning();
    await instance.initialize();
  }
  return instance;
}

export async function closeCrossProjectLearning(): Promise<void> {
  if (instance) {
    await instance.close();
    instance = null;
  }
}

export default {
  CrossProjectLearning,
  getCrossProjectLearning,
  closeCrossProjectLearning,
};
