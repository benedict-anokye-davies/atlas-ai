/**
 * NovaVoice - Intent Classifier & NLU
 * Natural language understanding for voice commands
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';
import { StreamingTranscription } from './types';
import { clamp01 } from '../../../shared/utils';

// Type alias for backward compatibility
type TranscriptionResult = StreamingTranscription;

const logger = createModuleLogger('NovaVoice-Intent');

// ============================================
// Types
// ============================================

export interface Intent {
  name: string;
  confidence: number;
  slots: Record<string, SlotValue>;
}

export interface SlotValue {
  value: string;
  rawValue: string;
  confidence: number;
  type: SlotType;
}

export type SlotType = 
  | 'text'
  | 'number'
  | 'date'
  | 'time'
  | 'duration'
  | 'email'
  | 'url'
  | 'phone'
  | 'location'
  | 'person'
  | 'organization'
  | 'custom';

export interface IntentPattern {
  name: string;
  patterns: string[];
  slots?: SlotDefinition[];
  priority?: number;
  examples?: string[];
}

export interface SlotDefinition {
  name: string;
  type: SlotType;
  required?: boolean;
  patterns?: string[];
  values?: string[];
  extractors?: SlotExtractor[];
}

export type SlotExtractor = (text: string) => SlotValue | null;

export interface ClassificationResult {
  text: string;
  intent: Intent | null;
  alternatives: Intent[];
  entities: Entity[];
  sentiment: Sentiment;
  confidence: number;
}

export interface Entity {
  type: string;
  value: string;
  start: number;
  end: number;
  confidence: number;
}

export interface Sentiment {
  label: 'positive' | 'negative' | 'neutral';
  score: number;
}

// ============================================
// Built-in Intents
// ============================================

export const BUILT_IN_INTENTS: IntentPattern[] = [
  // System Commands
  {
    name: 'system.stop',
    patterns: ['stop', 'stop listening', 'cancel', 'never mind', 'nevermind'],
    priority: 10,
  },
  {
    name: 'system.start',
    patterns: ['start listening', 'listen', 'wake up', 'hey nova'],
    priority: 10,
  },
  {
    name: 'system.mute',
    patterns: ['mute', 'be quiet', 'shut up', 'silence'],
    priority: 10,
  },
  {
    name: 'system.unmute',
    patterns: ['unmute', 'speak', 'talk to me'],
    priority: 10,
  },
  {
    name: 'system.repeat',
    patterns: ['repeat', 'say that again', 'what did you say', 'repeat that'],
    priority: 9,
  },
  {
    name: 'system.louder',
    patterns: ['louder', 'speak louder', 'volume up', 'increase volume'],
    priority: 8,
  },
  {
    name: 'system.quieter',
    patterns: ['quieter', 'speak quieter', 'volume down', 'decrease volume'],
    priority: 8,
  },
  
  // Navigation
  {
    name: 'navigation.open',
    patterns: ['open {app}', 'launch {app}', 'start {app}', 'run {app}'],
    slots: [{ name: 'app', type: 'text', required: true }],
  },
  {
    name: 'navigation.close',
    patterns: ['close {app}', 'exit {app}', 'quit {app}'],
    slots: [{ name: 'app', type: 'text', required: true }],
  },
  {
    name: 'navigation.go_to',
    patterns: ['go to {location}', 'navigate to {location}', 'show me {location}'],
    slots: [{ name: 'location', type: 'text', required: true }],
  },
  
  // Search
  {
    name: 'search.web',
    patterns: ['search for {query}', 'search {query}', 'google {query}', 'look up {query}'],
    slots: [{ name: 'query', type: 'text', required: true }],
  },
  {
    name: 'search.file',
    patterns: ['find file {filename}', 'search for file {filename}', 'locate {filename}'],
    slots: [{ name: 'filename', type: 'text', required: true }],
  },
  
  // Communication
  {
    name: 'communication.email',
    patterns: ['send email to {recipient}', 'email {recipient}', 'compose email to {recipient}'],
    slots: [
      { name: 'recipient', type: 'text', required: true },
      { name: 'subject', type: 'text', required: false },
      { name: 'body', type: 'text', required: false },
    ],
  },
  {
    name: 'communication.call',
    patterns: ['call {contact}', 'phone {contact}', 'dial {contact}'],
    slots: [{ name: 'contact', type: 'text', required: true }],
  },
  {
    name: 'communication.message',
    patterns: ['message {contact}', 'text {contact}', 'send message to {contact}'],
    slots: [
      { name: 'contact', type: 'text', required: true },
      { name: 'message', type: 'text', required: false },
    ],
  },
  
  // Calendar
  {
    name: 'calendar.create',
    patterns: [
      'schedule {event}',
      'create event {event}',
      'add to calendar {event}',
      'remind me to {event}',
    ],
    slots: [
      { name: 'event', type: 'text', required: true },
      { name: 'date', type: 'date', required: false },
      { name: 'time', type: 'time', required: false },
    ],
  },
  {
    name: 'calendar.check',
    patterns: ['what\'s on my calendar', 'show my schedule', 'what do I have today'],
    slots: [{ name: 'date', type: 'date', required: false }],
  },
  
  // Timer/Alarm
  {
    name: 'timer.set',
    patterns: ['set timer for {duration}', 'timer {duration}', 'start a {duration} timer'],
    slots: [{ name: 'duration', type: 'duration', required: true }],
  },
  {
    name: 'alarm.set',
    patterns: ['set alarm for {time}', 'alarm at {time}', 'wake me up at {time}'],
    slots: [{ name: 'time', type: 'time', required: true }],
  },
  
  // Media
  {
    name: 'media.play',
    patterns: ['play {media}', 'start playing {media}', 'put on {media}'],
    slots: [{ name: 'media', type: 'text', required: true }],
  },
  {
    name: 'media.pause',
    patterns: ['pause', 'pause music', 'pause video', 'stop playing'],
  },
  {
    name: 'media.resume',
    patterns: ['resume', 'continue', 'play', 'unpause'],
  },
  {
    name: 'media.next',
    patterns: ['next', 'skip', 'next track', 'next song'],
  },
  {
    name: 'media.previous',
    patterns: ['previous', 'go back', 'previous track', 'previous song'],
  },
  
  // Information
  {
    name: 'info.weather',
    patterns: ['what\'s the weather', 'weather forecast', 'is it going to rain', 'weather in {location}'],
    slots: [{ name: 'location', type: 'location', required: false }],
  },
  {
    name: 'info.time',
    patterns: ['what time is it', 'current time', 'what\'s the time'],
  },
  {
    name: 'info.date',
    patterns: ['what\'s the date', 'what day is it', 'current date'],
  },
  
  // Questions
  {
    name: 'question.general',
    patterns: ['what is {topic}', 'who is {topic}', 'tell me about {topic}', 'explain {topic}'],
    slots: [{ name: 'topic', type: 'text', required: true }],
  },
  {
    name: 'question.how',
    patterns: ['how do I {task}', 'how to {task}', 'how can I {task}'],
    slots: [{ name: 'task', type: 'text', required: true }],
  },
];

// ============================================
// Entity Extractors
// ============================================

export const ENTITY_EXTRACTORS: Record<string, RegExp> = {
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  url: /https?:\/\/[^\s]+/g,
  phone: /\b(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
  number: /\b\d+(\.\d+)?\b/g,
  time: /\b(0?[1-9]|1[0-2]):[0-5]\d\s*(am|pm)\b|\b([01]?\d|2[0-3]):[0-5]\d\b/gi,
  date: /\b(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(?:,?\s*\d{4})?)\b/gi,
  duration: /\b(\d+)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?)\b/gi,
  percentage: /\b\d+(\.\d+)?%\b/g,
  currency: /\$\d+(\.\d{2})?|\d+(\.\d{2})?\s*(?:dollars?|usd|eur|gbp)/gi,
};

// ============================================
// Intent Classifier
// ============================================

export class IntentClassifier extends EventEmitter {
  private intents: IntentPattern[] = [];
  private compiledPatterns: Map<string, RegExp[]> = new Map();
  private confidenceThreshold = 0.5;
  
  constructor() {
    super();
    // Load built-in intents
    for (const intent of BUILT_IN_INTENTS) {
      this.registerIntent(intent);
    }
  }
  
  /**
   * Register a new intent pattern
   */
  registerIntent(intent: IntentPattern): void {
    this.intents.push(intent);
    this.compilePatterns(intent);
    logger.debug('Intent registered', { name: intent.name });
  }
  
  /**
   * Remove an intent
   */
  unregisterIntent(name: string): void {
    const index = this.intents.findIndex((i) => i.name === name);
    if (index !== -1) {
      this.intents.splice(index, 1);
      this.compiledPatterns.delete(name);
      logger.debug('Intent unregistered', { name });
    }
  }
  
  /**
   * Compile patterns to RegExp
   */
  private compilePatterns(intent: IntentPattern): void {
    const regexes: RegExp[] = [];
    
    for (const pattern of intent.patterns) {
      // Convert slot placeholders to capture groups
      const regexStr = pattern
        .replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') // Escape regex special chars
        .replace(/\\{(\w+)\\}/g, '(?<$1>.+?)'); // Convert {slot} to named capture group
      
      regexes.push(new RegExp(`^${regexStr}$`, 'i'));
    }
    
    this.compiledPatterns.set(intent.name, regexes);
  }
  
  /**
   * Classify text into intent
   */
  classify(text: string): ClassificationResult {
    const normalizedText = text.toLowerCase().trim();
    const matches: Array<{ intent: IntentPattern; confidence: number; slots: Record<string, SlotValue> }> = [];
    
    // Try to match each intent
    for (const intent of this.intents) {
      const patterns = this.compiledPatterns.get(intent.name) || [];
      
      for (const pattern of patterns) {
        const match = normalizedText.match(pattern);
        
        if (match) {
          // Extract slots
          const slots: Record<string, SlotValue> = {};
          
          if (match.groups) {
            for (const [name, value] of Object.entries(match.groups)) {
              if (value) {
                const slotDef = intent.slots?.find((s) => s.name === name);
                slots[name] = {
                  value: value.trim(),
                  rawValue: value,
                  confidence: 0.9,
                  type: slotDef?.type || 'text',
                };
              }
            }
          }
          
          // Calculate confidence
          let confidence = 0.8;
          
          // Boost for exact match
          if (match[0].length === normalizedText.length) {
            confidence += 0.1;
          }
          
          // Boost for priority
          if (intent.priority) {
            confidence += intent.priority * 0.01;
          }
          
          // Reduce for missing required slots
          const requiredSlots = intent.slots?.filter((s) => s.required) || [];
          const missingRequired = requiredSlots.filter((s) => !slots[s.name]);
          confidence -= missingRequired.length * 0.2;
          
          matches.push({
            intent,
            confidence: clamp01(confidence),
            slots,
          });
          
          break; // Use first matching pattern
        }
      }
    }
    
    // Sort by confidence
    matches.sort((a, b) => b.confidence - a.confidence);
    
    // Extract entities
    const entities = this.extractEntities(text);
    
    // Analyze sentiment
    const sentiment = this.analyzeSentiment(text);
    
    // Return result
    const topMatch = matches[0];
    
    if (topMatch && topMatch.confidence >= this.confidenceThreshold) {
      return {
        text,
        intent: {
          name: topMatch.intent.name,
          confidence: topMatch.confidence,
          slots: topMatch.slots,
        },
        alternatives: matches.slice(1, 4).map((m) => ({
          name: m.intent.name,
          confidence: m.confidence,
          slots: m.slots,
        })),
        entities,
        sentiment,
        confidence: topMatch.confidence,
      };
    }
    
    return {
      text,
      intent: null,
      alternatives: matches.slice(0, 3).map((m) => ({
        name: m.intent.name,
        confidence: m.confidence,
        slots: m.slots,
      })),
      entities,
      sentiment,
      confidence: 0,
    };
  }
  
  /**
   * Extract entities from text
   */
  private extractEntities(text: string): Entity[] {
    const entities: Entity[] = [];
    
    for (const [type, regex] of Object.entries(ENTITY_EXTRACTORS)) {
      const globalRegex = new RegExp(regex.source, 'gi');
      let match;
      
      while ((match = globalRegex.exec(text)) !== null) {
        entities.push({
          type,
          value: match[0],
          start: match.index,
          end: match.index + match[0].length,
          confidence: 0.9,
        });
      }
    }
    
    return entities;
  }
  
  /**
   * Simple sentiment analysis
   */
  private analyzeSentiment(text: string): Sentiment {
    const positiveWords = [
      'good', 'great', 'excellent', 'amazing', 'wonderful', 'fantastic',
      'love', 'like', 'happy', 'thanks', 'thank', 'please', 'awesome',
    ];
    
    const negativeWords = [
      'bad', 'terrible', 'awful', 'horrible', 'hate', 'dislike',
      'angry', 'frustrated', 'annoying', 'stupid', 'wrong', 'broken',
    ];
    
    const words = text.toLowerCase().split(/\s+/);
    let score = 0;
    
    for (const word of words) {
      if (positiveWords.includes(word)) score += 1;
      if (negativeWords.includes(word)) score -= 1;
    }
    
    // Normalize
    const normalizedScore = Math.max(-1, Math.min(1, score / Math.max(1, words.length)));
    
    return {
      label: normalizedScore > 0.1 ? 'positive' : normalizedScore < -0.1 ? 'negative' : 'neutral',
      score: normalizedScore,
    };
  }
  
  /**
   * Set confidence threshold
   */
  setConfidenceThreshold(threshold: number): void {
    this.confidenceThreshold = Math.max(0, Math.min(1, threshold));
  }
  
  /**
   * Get all registered intents
   */
  getIntents(): IntentPattern[] {
    return [...this.intents];
  }
  
  /**
   * Clear all custom intents (keep built-in)
   */
  clearCustomIntents(): void {
    const builtInNames = new Set(BUILT_IN_INTENTS.map((i) => i.name));
    
    this.intents = this.intents.filter((i) => builtInNames.has(i.name));
    
    for (const [name] of this.compiledPatterns) {
      if (!builtInNames.has(name)) {
        this.compiledPatterns.delete(name);
      }
    }
  }
}

// ============================================
// Voice Command Handler
// ============================================

export type CommandHandler = (intent: Intent, context?: unknown) => Promise<void> | void;

export class VoiceCommandHandler extends EventEmitter {
  private classifier: IntentClassifier;
  private handlers: Map<string, CommandHandler[]> = new Map();
  private middlewares: Array<(result: ClassificationResult) => ClassificationResult | null> = [];
  private enabled = true;
  
  constructor() {
    super();
    this.classifier = new IntentClassifier();
  }
  
  /**
   * Register a command handler for an intent
   */
  onIntent(intentName: string, handler: CommandHandler): void {
    const handlers = this.handlers.get(intentName) || [];
    handlers.push(handler);
    this.handlers.set(intentName, handlers);
  }
  
  /**
   * Register a wildcard handler for all intents
   */
  onAnyIntent(handler: CommandHandler): void {
    this.onIntent('*', handler);
  }
  
  /**
   * Add middleware
   */
  use(middleware: (result: ClassificationResult) => ClassificationResult | null): void {
    this.middlewares.push(middleware);
  }
  
  /**
   * Process voice input
   */
  async process(text: string, context?: unknown): Promise<ClassificationResult> {
    if (!this.enabled) {
      return {
        text,
        intent: null,
        alternatives: [],
        entities: [],
        sentiment: { label: 'neutral', score: 0 },
        confidence: 0,
      };
    }
    
    // Classify
    let result = this.classifier.classify(text);
    
    // Run middleware
    for (const middleware of this.middlewares) {
      const modified = middleware(result);
      if (modified === null) {
        // Middleware blocked processing
        this.emit('blocked', result);
        return result;
      }
      result = modified;
    }
    
    // Emit classification event
    this.emit('classified', result);
    
    // Execute handlers
    if (result.intent) {
      const handlers = [
        ...(this.handlers.get(result.intent.name) || []),
        ...(this.handlers.get('*') || []),
      ];
      
      for (const handler of handlers) {
        try {
          await handler(result.intent, context);
        } catch (error) {
          logger.error('Handler error', { intent: result.intent.name, error });
          this.emit('error', error);
        }
      }
      
      this.emit('handled', result);
    } else {
      this.emit('no-intent', result);
    }
    
    return result;
  }
  
  /**
   * Register custom intent
   */
  registerIntent(intent: IntentPattern): void {
    this.classifier.registerIntent(intent);
  }
  
  /**
   * Enable/disable command processing
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }
  
  /**
   * Get classifier
   */
  getClassifier(): IntentClassifier {
    return this.classifier;
  }
}

// ============================================
// Exports
// ============================================

export const intentClassifier = new IntentClassifier();
export const voiceCommandHandler = new VoiceCommandHandler();
