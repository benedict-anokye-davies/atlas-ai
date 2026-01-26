/**
 * NovaVoice - Custom Vocabulary / Hotwords
 * Boost recognition of domain-specific terms
 */

import { createModuleLogger } from '../../utils/logger';
import { count } from '../../../shared/utils';

const logger = createModuleLogger('NovaVoice-Vocabulary');

// ============================================
// Vocabulary Types
// ============================================

export interface HotWord {
  /** The word or phrase to boost */
  phrase: string;
  /** Boost factor (1.0 = normal, 2.0 = 2x more likely) */
  boost: number;
  /** Case sensitive matching */
  caseSensitive: boolean;
  /** Whether this is a proper noun */
  isProperNoun: boolean;
  /** Pronunciation hints (IPA or similar) */
  pronunciation?: string;
  /** Category for organization */
  category?: string;
}

export interface VocabularySet {
  name: string;
  description: string;
  hotwords: HotWord[];
  enabled: boolean;
}

// ============================================
// Built-in Vocabulary Sets
// ============================================

export const TECH_VOCABULARY: VocabularySet = {
  name: 'Technology',
  description: 'Common tech terms, programming languages, and tools',
  enabled: true,
  hotwords: [
    // Programming Languages
    { phrase: 'JavaScript', boost: 1.5, caseSensitive: true, isProperNoun: true },
    { phrase: 'TypeScript', boost: 1.5, caseSensitive: true, isProperNoun: true },
    { phrase: 'Python', boost: 1.5, caseSensitive: true, isProperNoun: true },
    { phrase: 'Rust', boost: 1.3, caseSensitive: true, isProperNoun: true },
    { phrase: 'Go', boost: 1.2, caseSensitive: true, isProperNoun: true },
    { phrase: 'C++', boost: 1.5, caseSensitive: false, isProperNoun: true },
    { phrase: 'C#', boost: 1.5, caseSensitive: false, isProperNoun: true },
    
    // Frameworks
    { phrase: 'React', boost: 1.5, caseSensitive: true, isProperNoun: true },
    { phrase: 'Vue', boost: 1.3, caseSensitive: true, isProperNoun: true },
    { phrase: 'Angular', boost: 1.3, caseSensitive: true, isProperNoun: true },
    { phrase: 'Next.js', boost: 1.5, caseSensitive: false, isProperNoun: true },
    { phrase: 'Node.js', boost: 1.5, caseSensitive: false, isProperNoun: true },
    { phrase: 'Express', boost: 1.3, caseSensitive: true, isProperNoun: true },
    { phrase: 'Django', boost: 1.3, caseSensitive: true, isProperNoun: true },
    { phrase: 'FastAPI', boost: 1.5, caseSensitive: true, isProperNoun: true },
    
    // AI/ML
    { phrase: 'GPT', boost: 1.8, caseSensitive: true, isProperNoun: true },
    { phrase: 'ChatGPT', boost: 1.8, caseSensitive: true, isProperNoun: true },
    { phrase: 'Claude', boost: 1.8, caseSensitive: true, isProperNoun: true },
    { phrase: 'LLM', boost: 1.5, caseSensitive: true, isProperNoun: false },
    { phrase: 'transformer', boost: 1.3, caseSensitive: false, isProperNoun: false },
    { phrase: 'PyTorch', boost: 1.5, caseSensitive: true, isProperNoun: true },
    { phrase: 'TensorFlow', boost: 1.5, caseSensitive: true, isProperNoun: true },
    { phrase: 'Whisper', boost: 1.5, caseSensitive: true, isProperNoun: true },
    { phrase: 'ONNX', boost: 1.5, caseSensitive: true, isProperNoun: true },
    
    // Tools
    { phrase: 'VS Code', boost: 1.5, caseSensitive: false, isProperNoun: true },
    { phrase: 'GitHub', boost: 1.5, caseSensitive: true, isProperNoun: true },
    { phrase: 'GitLab', boost: 1.3, caseSensitive: true, isProperNoun: true },
    { phrase: 'Docker', boost: 1.5, caseSensitive: true, isProperNoun: true },
    { phrase: 'Kubernetes', boost: 1.5, caseSensitive: true, isProperNoun: true },
    { phrase: 'kubectl', boost: 1.5, caseSensitive: true, isProperNoun: true, pronunciation: 'kube-control' },
    { phrase: 'npm', boost: 1.5, caseSensitive: true, isProperNoun: true },
    { phrase: 'yarn', boost: 1.3, caseSensitive: true, isProperNoun: true },
    { phrase: 'pnpm', boost: 1.5, caseSensitive: true, isProperNoun: true },
    
    // Cloud
    { phrase: 'AWS', boost: 1.5, caseSensitive: true, isProperNoun: true },
    { phrase: 'Azure', boost: 1.5, caseSensitive: true, isProperNoun: true },
    { phrase: 'GCP', boost: 1.5, caseSensitive: true, isProperNoun: true },
    { phrase: 'Vercel', boost: 1.5, caseSensitive: true, isProperNoun: true },
    { phrase: 'Netlify', boost: 1.3, caseSensitive: true, isProperNoun: true },
    
    // Databases
    { phrase: 'PostgreSQL', boost: 1.5, caseSensitive: true, isProperNoun: true },
    { phrase: 'MySQL', boost: 1.5, caseSensitive: true, isProperNoun: true },
    { phrase: 'MongoDB', boost: 1.5, caseSensitive: true, isProperNoun: true },
    { phrase: 'Redis', boost: 1.5, caseSensitive: true, isProperNoun: true },
    { phrase: 'SQLite', boost: 1.5, caseSensitive: true, isProperNoun: true },
  ],
};

export const NOVA_VOCABULARY: VocabularySet = {
  name: 'Nova',
  description: 'Nova-specific terms and commands',
  enabled: true,
  hotwords: [
    { phrase: 'Nova', boost: 2.0, caseSensitive: true, isProperNoun: true },
    { phrase: 'NovaVoice', boost: 2.0, caseSensitive: true, isProperNoun: true },
    { phrase: 'Atlas', boost: 1.8, caseSensitive: true, isProperNoun: true },
    { phrase: 'Atlas Core', boost: 1.8, caseSensitive: true, isProperNoun: true },
    { phrase: 'Hey Nova', boost: 2.0, caseSensitive: false, isProperNoun: false },
    { phrase: 'OK Nova', boost: 2.0, caseSensitive: false, isProperNoun: false },
  ],
};

export const NAMES_VOCABULARY: VocabularySet = {
  name: 'Common Names',
  description: 'Common first names for better recognition',
  enabled: true,
  hotwords: [
    // Add common names with boost
    { phrase: 'Alex', boost: 1.3, caseSensitive: true, isProperNoun: true },
    { phrase: 'Jordan', boost: 1.3, caseSensitive: true, isProperNoun: true },
    { phrase: 'Taylor', boost: 1.3, caseSensitive: true, isProperNoun: true },
    { phrase: 'Morgan', boost: 1.3, caseSensitive: true, isProperNoun: true },
    { phrase: 'Casey', boost: 1.3, caseSensitive: true, isProperNoun: true },
    // Add more as needed
  ],
};

// ============================================
// Vocabulary Manager
// ============================================

export class VocabularyManager {
  private vocabularySets: Map<string, VocabularySet> = new Map();
  private customHotwords: HotWord[] = [];
  private allHotwords: HotWord[] = [];
  private hotwordMap: Map<string, HotWord> = new Map();
  
  constructor() {
    // Load default vocabulary sets
    this.addVocabularySet(TECH_VOCABULARY);
    this.addVocabularySet(NOVA_VOCABULARY);
    this.addVocabularySet(NAMES_VOCABULARY);
    this.rebuildIndex();
    
    logger.info('VocabularyManager initialized', {
      sets: this.vocabularySets.size,
      totalHotwords: this.allHotwords.length,
    });
  }
  
  /**
   * Add a vocabulary set
   */
  addVocabularySet(set: VocabularySet): void {
    this.vocabularySets.set(set.name, set);
    this.rebuildIndex();
  }
  
  /**
   * Remove a vocabulary set
   */
  removeVocabularySet(name: string): void {
    this.vocabularySets.delete(name);
    this.rebuildIndex();
  }
  
  /**
   * Enable/disable a vocabulary set
   */
  setVocabularyEnabled(name: string, enabled: boolean): void {
    const set = this.vocabularySets.get(name);
    if (set) {
      set.enabled = enabled;
      this.rebuildIndex();
    }
  }
  
  /**
   * Add custom hotword
   */
  addHotword(hotword: HotWord): void {
    this.customHotwords.push(hotword);
    this.rebuildIndex();
  }
  
  /**
   * Remove custom hotword
   */
  removeHotword(phrase: string): void {
    this.customHotwords = this.customHotwords.filter(h => h.phrase !== phrase);
    this.rebuildIndex();
  }
  
  /**
   * Rebuild hotword index
   */
  private rebuildIndex(): void {
    this.allHotwords = [];
    this.hotwordMap.clear();
    
    // Add from vocabulary sets
    for (const set of this.vocabularySets.values()) {
      if (set.enabled) {
        for (const hotword of set.hotwords) {
          this.allHotwords.push(hotword);
          const key = hotword.caseSensitive ? hotword.phrase : hotword.phrase.toLowerCase();
          this.hotwordMap.set(key, hotword);
        }
      }
    }
    
    // Add custom hotwords
    for (const hotword of this.customHotwords) {
      this.allHotwords.push(hotword);
      const key = hotword.caseSensitive ? hotword.phrase : hotword.phrase.toLowerCase();
      this.hotwordMap.set(key, hotword);
    }
  }
  
  /**
   * Get boost factor for a word
   */
  getBoost(word: string): number {
    // Try case-sensitive first
    let hotword = this.hotwordMap.get(word);
    if (!hotword) {
      // Try case-insensitive
      hotword = this.hotwordMap.get(word.toLowerCase());
    }
    return hotword?.boost || 1.0;
  }
  
  /**
   * Get all hotwords for STT context
   */
  getHotwordList(): string[] {
    return this.allHotwords.map(h => h.phrase);
  }
  
  /**
   * Get hotwords formatted for Whisper
   */
  getWhisperPrompt(): string {
    // Whisper uses a prompt string for context
    const phrases = this.allHotwords
      .sort((a, b) => b.boost - a.boost)
      .slice(0, 50) // Limit to top 50
      .map(h => h.phrase);
    
    return phrases.join(', ');
  }
  
  /**
   * Post-process transcription with hotword corrections
   */
  correctTranscription(text: string): string {
    let corrected = text;
    
    for (const hotword of this.allHotwords) {
      if (hotword.isProperNoun) {
        // Correct capitalization for proper nouns
        const regex = new RegExp(`\\b${this.escapeRegex(hotword.phrase)}\\b`, 'gi');
        corrected = corrected.replace(regex, hotword.phrase);
      }
    }
    
    return corrected;
  }
  
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  
  /**
   * Find similar words (for fuzzy matching)
   */
  findSimilar(word: string, threshold: number = 0.8): HotWord[] {
    const matches: HotWord[] = [];
    
    for (const hotword of this.allHotwords) {
      const similarity = this.calculateSimilarity(word.toLowerCase(), hotword.phrase.toLowerCase());
      if (similarity >= threshold) {
        matches.push(hotword);
      }
    }
    
    return matches.sort((a, b) => b.boost - a.boost);
  }
  
  /**
   * Calculate string similarity (Levenshtein-based)
   */
  private calculateSimilarity(a: string, b: string): number {
    if (a === b) return 1.0;
    
    const matrix: number[][] = [];
    const aLen = a.length;
    const bLen = b.length;
    
    for (let i = 0; i <= aLen; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= bLen; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= aLen; i++) {
      for (let j = 1; j <= bLen; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );
      }
    }
    
    const distance = matrix[aLen][bLen];
    const maxLen = Math.max(aLen, bLen);
    return 1 - distance / maxLen;
  }
  
  /**
   * Export vocabulary to JSON
   */
  exportToJSON(): string {
    return JSON.stringify({
      vocabularySets: Array.from(this.vocabularySets.values()),
      customHotwords: this.customHotwords,
    }, null, 2);
  }
  
  /**
   * Import vocabulary from JSON
   */
  importFromJSON(json: string): void {
    const data = JSON.parse(json);
    
    if (data.vocabularySets) {
      for (const set of data.vocabularySets) {
        this.vocabularySets.set(set.name, set);
      }
    }
    
    if (data.customHotwords) {
      this.customHotwords = data.customHotwords;
    }
    
    this.rebuildIndex();
    logger.info('Vocabulary imported', { sets: this.vocabularySets.size });
  }
  
  /**
   * Get statistics
   */
  getStats(): { totalSets: number; totalHotwords: number; enabledSets: number } {
    const enabledSets = count(Array.from(this.vocabularySets.values()), s => s.enabled);
    return {
      totalSets: this.vocabularySets.size,
      totalHotwords: this.allHotwords.length,
      enabledSets,
    };
  }
}

// ============================================
// Singleton
// ============================================

let vocabularyManagerInstance: VocabularyManager | null = null;

export function getVocabularyManager(): VocabularyManager {
  if (!vocabularyManagerInstance) {
    vocabularyManagerInstance = new VocabularyManager();
  }
  return vocabularyManagerInstance;
}
