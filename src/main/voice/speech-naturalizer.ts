/**
 * Atlas Desktop - Speech Naturalizer
 * Transforms LLM output into natural, speakable text
 * 
 * Features:
 * - Converts symbols to spoken words (£ → pounds)
 * - Adds natural pauses via punctuation
 * - Injects subtle hesitations for authenticity
 * - Handles numbers naturally (1,234 → twelve hundred thirty-four)
 * - Adds emphasis markers for TTS
 * - Adapts formality based on context
 * 
 * @module voice/speech-naturalizer
 */

import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('SpeechNaturalizer');

// ============================================================================
// Types
// ============================================================================

export interface NaturalizerConfig {
  /** Add natural hesitations (um, uh) */
  addHesitations: boolean;
  /** Hesitation probability (0-1) */
  hesitationRate: number;
  /** Convert numbers to words */
  numberToWords: boolean;
  /** Max number to convert to words (larger = use digits) */
  maxNumberAsWords: number;
  /** Add thinking pauses for complex content */
  addThinkingPauses: boolean;
  /** Formality level 0-1 (affects word choice) */
  formality: number;
  /** Add SSML-like emphasis markers */
  addEmphasis: boolean;
  /** Speaking speed affects pause length */
  speedMultiplier: number;
}

export const DEFAULT_NATURALIZER_CONFIG: NaturalizerConfig = {
  addHesitations: true,
  hesitationRate: 0.08, // 8% chance per sentence
  numberToWords: true,
  maxNumberAsWords: 100,
  addThinkingPauses: true,
  formality: 0.5,
  addEmphasis: true,
  speedMultiplier: 1.0,
};

export interface NaturalizationResult {
  text: string;
  originalLength: number;
  naturalizedLength: number;
  modifications: string[];
}

// ============================================================================
// Number to Words Conversion
// ============================================================================

const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
  'eighteen', 'nineteen'];

const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

const SCALES = ['', 'thousand', 'million', 'billion', 'trillion'];

function numberToWords(num: number): string {
  if (num === 0) return 'zero';
  if (num < 0) return 'negative ' + numberToWords(Math.abs(num));
  
  if (!Number.isInteger(num)) {
    const [whole, decimal] = num.toString().split('.');
    const wholeWords = numberToWords(parseInt(whole));
    const decimalWords = decimal.split('').map(d => ONES[parseInt(d)] || d).join(' ');
    return `${wholeWords} point ${decimalWords}`;
  }
  
  if (num < 20) return ONES[num];
  if (num < 100) {
    return TENS[Math.floor(num / 10)] + (num % 10 ? ' ' + ONES[num % 10] : '');
  }
  if (num < 1000) {
    return ONES[Math.floor(num / 100)] + ' hundred' + 
      (num % 100 ? ' and ' + numberToWords(num % 100) : '');
  }
  
  // Handle thousands and above
  let result = '';
  let scaleIndex = 0;
  let remaining = num;
  
  while (remaining > 0) {
    const chunk = remaining % 1000;
    if (chunk > 0) {
      const chunkWords = numberToWords(chunk);
      const scale = SCALES[scaleIndex];
      result = chunkWords + (scale ? ' ' + scale : '') + (result ? ' ' + result : '');
    }
    remaining = Math.floor(remaining / 1000);
    scaleIndex++;
  }
  
  return result.trim();
}

// ============================================================================
// Symbol Conversions
// ============================================================================

interface SymbolConversion {
  pattern: RegExp;
  replacement: string | ((match: string, ...groups: string[]) => string);
}

const SYMBOL_CONVERSIONS: SymbolConversion[] = [
  // Currency - handle before numbers
  { pattern: /£(\d+(?:,\d{3})*(?:\.\d{2})?)/g, replacement: (_, amount) => `${amount.replace(/,/g, '')} pounds` },
  { pattern: /\$(\d+(?:,\d{3})*(?:\.\d{2})?)/g, replacement: (_, amount) => `${amount.replace(/,/g, '')} dollars` },
  { pattern: /€(\d+(?:,\d{3})*(?:\.\d{2})?)/g, replacement: (_, amount) => `${amount.replace(/,/g, '')} euros` },
  
  // Percentages
  { pattern: /(\d+(?:\.\d+)?)\s*%/g, replacement: (_, num) => `${num} percent` },
  
  // Mathematical
  { pattern: /\+/g, replacement: ' plus ' },
  { pattern: /-(?=\d)/g, replacement: ' minus ' }, // Only before digits
  { pattern: /×|x(?=\s*\d)/gi, replacement: ' times ' },
  { pattern: /÷|\//g, replacement: ' divided by ' },
  { pattern: /=/g, replacement: ' equals ' },
  { pattern: /≈/g, replacement: ' approximately ' },
  { pattern: /≠/g, replacement: ' not equal to ' },
  { pattern: /</g, replacement: ' less than ' },
  { pattern: />/g, replacement: ' greater than ' },
  { pattern: /≤/g, replacement: ' less than or equal to ' },
  { pattern: /≥/g, replacement: ' greater than or equal to ' },
  
  // Common abbreviations
  { pattern: /\betc\./gi, replacement: 'etcetera' },
  { pattern: /\be\.g\./gi, replacement: 'for example' },
  { pattern: /\bi\.e\./gi, replacement: 'that is' },
  { pattern: /\bvs\.?/gi, replacement: 'versus' },
  { pattern: /\bw\//gi, replacement: 'with' },
  { pattern: /\bw\/o/gi, replacement: 'without' },
  { pattern: /\bb\/c/gi, replacement: 'because' },
  { pattern: /\bFYI/gi, replacement: 'for your information' },
  { pattern: /\bASAP/gi, replacement: 'as soon as possible' },
  { pattern: /\bIMO/gi, replacement: 'in my opinion' },
  { pattern: /\bTBH/gi, replacement: 'to be honest' },
  { pattern: /\bBTW/gi, replacement: 'by the way' },
  
  // Technical - coding context
  { pattern: /\bAPI\b/gi, replacement: 'A P I' },
  { pattern: /\bURL\b/gi, replacement: 'U R L' },
  { pattern: /\bSQL\b/gi, replacement: 'sequel' },
  { pattern: /\bJSON\b/gi, replacement: 'jason' },
  { pattern: /\bHTML\b/gi, replacement: 'H T M L' },
  { pattern: /\bCSS\b/gi, replacement: 'C S S' },
  { pattern: /\bHTTP\b/gi, replacement: 'H T T P' },
  { pattern: /\bHTTPS\b/gi, replacement: 'H T T P S' },
  { pattern: /\bSSH\b/gi, replacement: 'S S H' },
  { pattern: /\bGUI\b/gi, replacement: 'gooey' },
  { pattern: /\bUI\b/gi, replacement: 'U I' },
  { pattern: /\bUX\b/gi, replacement: 'U X' },
  { pattern: /\bAI\b/gi, replacement: 'A I' },
  { pattern: /\bML\b/gi, replacement: 'M L' },
  { pattern: /\bNPM\b/gi, replacement: 'N P M' },
  { pattern: /\bGIT\b/gi, replacement: 'git' },
  { pattern: /\bCLI\b/gi, replacement: 'C L I' },
  { pattern: /\bREPL\b/gi, replacement: 'repl' },
  
  // Symbols to words
  { pattern: /&/g, replacement: ' and ' },
  { pattern: /@/g, replacement: ' at ' },
  { pattern: /#(\w+)/g, replacement: 'hashtag $1' },
  { pattern: /\*/g, replacement: '' }, // Remove asterisks (often formatting)
  { pattern: /_{2,}/g, replacement: '' }, // Remove underscores
  { pattern: /`([^`]+)`/g, replacement: '$1' }, // Remove code backticks, keep content
  
  // Clean up markdown-like formatting
  { pattern: /\*\*([^*]+)\*\*/g, replacement: '$1' }, // Bold
  { pattern: /__([^_]+)__/g, replacement: '$1' }, // Bold underscore
  { pattern: /\*([^*]+)\*/g, replacement: '$1' }, // Italic
  { pattern: /_([^_]+)_/g, replacement: '$1' }, // Italic underscore
  
  // Punctuation pronunciation
  { pattern: /\.{3}/g, replacement: ', ' }, // Ellipsis to pause
  { pattern: /--/g, replacement: ', ' }, // Em dash to pause
  { pattern: /—/g, replacement: ', ' }, // Em dash unicode
  
  // Time formats
  { pattern: /(\d{1,2}):(\d{2})\s*([AaPp][Mm])/g, replacement: '$1 $3' },
  { pattern: /(\d{1,2}):(\d{2})/g, replacement: '$1 $2' },
];

// ============================================================================
// Hesitation Injector
// ============================================================================

const HESITATIONS_CASUAL = ['um', 'uh', 'well', 'so', 'like', 'you know'];
const HESITATIONS_FORMAL = ['well', 'so', 'now'];
const THINKING_STARTERS = ['let me see', 'okay so', 'right'];

function getRandomHesitation(formality: number): string {
  const pool = formality > 0.6 ? HESITATIONS_FORMAL : HESITATIONS_CASUAL;
  return pool[Math.floor(Math.random() * pool.length)];
}

function shouldAddHesitation(rate: number): boolean {
  return Math.random() < rate;
}

// ============================================================================
// Main Naturalizer Class
// ============================================================================

export class SpeechNaturalizer {
  private config: NaturalizerConfig;

  constructor(config: Partial<NaturalizerConfig> = {}) {
    this.config = { ...DEFAULT_NATURALIZER_CONFIG, ...config };
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<NaturalizerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Main naturalization method
   */
  naturalize(text: string): NaturalizationResult {
    const original = text;
    const modifications: string[] = [];
    
    let result = text;
    
    // 1. Convert symbols to spoken words
    result = this.convertSymbols(result, modifications);
    
    // 2. Convert numbers to words (if enabled and within threshold)
    if (this.config.numberToWords) {
      result = this.convertNumbers(result, modifications);
    }
    
    // 3. Add natural pauses
    if (this.config.addThinkingPauses) {
      result = this.addPauses(result, modifications);
    }
    
    // 4. Inject hesitations (sparingly)
    if (this.config.addHesitations) {
      result = this.injectHesitations(result, modifications);
    }
    
    // 5. Add emphasis markers
    if (this.config.addEmphasis) {
      result = this.addEmphasisMarkers(result, modifications);
    }
    
    // 6. Clean up whitespace
    result = this.cleanWhitespace(result);
    
    return {
      text: result,
      originalLength: original.length,
      naturalizedLength: result.length,
      modifications,
    };
  }

  /**
   * Apply symbol conversions
   */
  private convertSymbols(text: string, mods: string[]): string {
    let result = text;
    let changed = false;
    
    for (const conv of SYMBOL_CONVERSIONS) {
      const before = result;
      if (typeof conv.replacement === 'string') {
        result = result.replace(conv.pattern, conv.replacement);
      } else {
        result = result.replace(conv.pattern, conv.replacement);
      }
      if (before !== result) changed = true;
    }
    
    if (changed) mods.push('symbols-converted');
    return result;
  }

  /**
   * Convert numbers to spoken words
   */
  private convertNumbers(text: string, mods: string[]): string {
    const { maxNumberAsWords } = this.config;
    let changed = false;
    
    // Match standalone numbers (not part of words, dates, or versions)
    const result = text.replace(/\b(\d+(?:,\d{3})*(?:\.\d+)?)\b/g, (match, numStr) => {
      const num = parseFloat(numStr.replace(/,/g, ''));
      
      // Skip very large numbers or version-like patterns
      if (num > 10000 || /\.\d{3,}/.test(numStr)) {
        return match;
      }
      
      // For small numbers, convert to words
      if (num <= maxNumberAsWords && Number.isInteger(num)) {
        changed = true;
        return numberToWords(num);
      }
      
      // For numbers with commas, remove commas for speech
      if (numStr.includes(',')) {
        changed = true;
        return numStr.replace(/,/g, '');
      }
      
      return match;
    });
    
    if (changed) mods.push('numbers-converted');
    return result;
  }

  /**
   * Add natural pauses via punctuation
   */
  private addPauses(text: string, mods: string[]): string {
    let result = text;
    let changed = false;
    
    // Add pause before "but", "however", etc. (contrastive discourse markers)
    result = result.replace(/([^,.])\s+(but|however|although|yet|still)\s+/gi, (_, before, marker) => {
      changed = true;
      return `${before}, ${marker.toLowerCase()} `;
    });
    
    // Add brief pause before "because", "since" (explanatory)
    result = result.replace(/([^,.])\s+(because|since)\s+/gi, (_, before, marker) => {
      changed = true;
      return `${before}, ${marker.toLowerCase()} `;
    });
    
    // Add micro-pauses for lists (ensure comma after "and" in lists isn't added twice)
    // This is handled by TTS, so we'll keep it minimal
    
    if (changed) mods.push('pauses-added');
    return result;
  }

  /**
   * Inject subtle hesitations
   */
  private injectHesitations(text: string, mods: string[]): string {
    const sentences = text.split(/(?<=[.!?])\s+/);
    let injected = false;
    
    const result = sentences.map((sentence, i) => {
      // Only add hesitation occasionally and not to first sentence
      if (i === 0 || !shouldAddHesitation(this.config.hesitationRate)) {
        return sentence;
      }
      
      const hesitation = getRandomHesitation(this.config.formality);
      injected = true;
      
      // Add at the start of sentence
      return hesitation.charAt(0).toUpperCase() + hesitation.slice(1) + ', ' + 
        sentence.charAt(0).toLowerCase() + sentence.slice(1);
    }).join(' ');
    
    if (injected) mods.push('hesitations-added');
    return result;
  }

  /**
   * Add emphasis markers for important words
   */
  private addEmphasisMarkers(text: string, mods: string[]): string {
    // Note: Most TTS engines don't need explicit markers - they handle emphasis naturally
    // This is a placeholder for engines that support SSML or similar
    
    // For now, we'll just ensure key words aren't lost
    // In future, could add <emphasis> tags for SSML-compatible engines
    
    return text;
  }

  /**
   * Clean up excessive whitespace
   */
  private cleanWhitespace(text: string): string {
    return text
      .replace(/\s+/g, ' ')           // Multiple spaces to single
      .replace(/\s+([,.])/g, '$1')    // No space before punctuation
      .replace(/([,.])\s*([,.])/g, '$1$2') // No double punctuation spacing
      .trim();
  }

  /**
   * Quick naturalization for backchannels (minimal processing)
   */
  naturalizeQuick(text: string): string {
    return this.cleanWhitespace(
      this.convertSymbols(text, [])
    );
  }

  /**
   * Get stats about what was changed
   */
  getStats(result: NaturalizationResult): string {
    return `Naturalized: ${result.originalLength} → ${result.naturalizedLength} chars. ` +
      `Modifications: ${result.modifications.join(', ') || 'none'}`;
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

let instance: SpeechNaturalizer | null = null;

export function getSpeechNaturalizer(config?: Partial<NaturalizerConfig>): SpeechNaturalizer {
  if (!instance) {
    instance = new SpeechNaturalizer(config);
  } else if (config) {
    instance.setConfig(config);
  }
  return instance;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Quick naturalize text without full result object
 */
export function naturalizeText(text: string, config?: Partial<NaturalizerConfig>): string {
  const naturalizer = getSpeechNaturalizer(config);
  return naturalizer.naturalize(text).text;
}

/**
 * Convert a number to spoken words
 */
export function speakNumber(num: number): string {
  return numberToWords(num);
}

/**
 * Remove all formatting and make text speech-ready
 */
export function cleanForSpeech(text: string): string {
  const naturalizer = getSpeechNaturalizer();
  return naturalizer.naturalizeQuick(text);
}
