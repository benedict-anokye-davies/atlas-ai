/**
 * Website Knowledge Base
 *
 * Cross-session learning about websites and their interaction patterns.
 * Remembers how to navigate specific sites, login flows, element locations, etc.
 *
 * This gives Atlas a significant advantage - it learns from every interaction
 * and becomes better at automating each site over time.
 *
 * @module agent/browser-agent/website-knowledge
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';
import { IndexedElement, SemanticPurpose, BrowserAction, BrowserState } from './types';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

const logger = createModuleLogger('WebsiteKnowledge');

// ============================================================================
// Knowledge Types
// ============================================================================

export interface WebsiteProfile {
  /** Domain */
  domain: string;
  /** Subdomains tracked */
  subdomains: string[];
  /** Site classification */
  siteType: SiteType;
  /** Known page patterns */
  pagePatterns: PagePattern[];
  /** Authentication info */
  auth: AuthenticationProfile;
  /** Common elements */
  commonElements: CommonElementProfile[];
  /** Learned workflows */
  workflows: WorkflowPattern[];
  /** Site-specific quirks */
  quirks: SiteQuirk[];
  /** Performance metrics */
  metrics: SiteMetrics;
  /** Last interaction */
  lastInteraction: number;
  /** Total interactions */
  totalInteractions: number;
  /** Created timestamp */
  createdAt: number;
}

export type SiteType =
  | 'e-commerce'
  | 'social-media'
  | 'news'
  | 'banking'
  | 'email'
  | 'search-engine'
  | 'video-streaming'
  | 'documentation'
  | 'saas'
  | 'government'
  | 'healthcare'
  | 'education'
  | 'unknown';

export interface PagePattern {
  /** Pattern ID */
  id: string;
  /** URL pattern */
  urlPattern: string;
  /** Page type */
  pageType: string;
  /** Key elements expected */
  expectedElements: ElementExpectation[];
  /** Common actions on this page */
  commonActions: ActionFrequency[];
  /** Typical next pages */
  nextPages: string[];
  /** Average load time */
  avgLoadTimeMs: number;
  /** Encounter count */
  encounters: number;
}

export interface ElementExpectation {
  /** Semantic purpose */
  purpose: SemanticPurpose;
  /** Common selectors */
  selectors: string[];
  /** Text patterns */
  textPatterns: string[];
  /** Usually in viewport? */
  inViewport: boolean;
  /** Reliability score */
  reliability: number;
}

export interface ActionFrequency {
  /** Action type */
  actionType: string;
  /** Target description */
  targetDescription: string;
  /** Frequency (0-1) */
  frequency: number;
  /** Average success rate */
  successRate: number;
}

export interface AuthenticationProfile {
  /** Has login? */
  hasLogin: boolean;
  /** Login URL pattern */
  loginUrlPattern?: string;
  /** Login method */
  method: 'form' | 'oauth' | 'sso' | 'unknown';
  /** OAuth providers if applicable */
  oauthProviders?: string[];
  /** Has MFA? */
  hasMFA: boolean;
  /** Session duration estimate */
  sessionDurationMinutes?: number;
  /** Known login selectors */
  loginSelectors?: {
    username: string[];
    password: string[];
    submit: string[];
    rememberMe?: string[];
  };
  /** Post-login redirect pattern */
  postLoginRedirect?: string;
}

export interface CommonElementProfile {
  /** Purpose */
  purpose: string;
  /** Best selectors */
  selectors: string[];
  /** Alternative texts */
  alternativeTexts: string[];
  /** Page where found */
  pagePattern: string;
  /** Last verified */
  lastVerified: number;
  /** Verification count */
  verificationCount: number;
}

export interface WorkflowPattern {
  /** Workflow ID */
  id: string;
  /** Workflow name */
  name: string;
  /** Trigger intent */
  triggerIntent: string;
  /** Action sequence */
  actions: RecordedAction[];
  /** Success rate */
  successRate: number;
  /** Times executed */
  executionCount: number;
  /** Average duration */
  avgDurationMs: number;
}

export interface RecordedAction {
  /** Action type */
  type: string;
  /** Page URL pattern when executed */
  pagePattern: string;
  /** Target element description */
  targetDescription: string;
  /** Selector used */
  selector?: string;
  /** Text/value used */
  value?: string;
  /** Typical delay before next action */
  delayAfterMs: number;
}

export interface SiteQuirk {
  /** Quirk type */
  type: 'timing' | 'selector' | 'behavior' | 'popup' | 'captcha' | 'other';
  /** Description */
  description: string;
  /** Workaround */
  workaround?: string;
  /** Affected pages */
  affectedPages: string[];
}

export interface SiteMetrics {
  /** Average page load time */
  avgLoadTimeMs: number;
  /** Action success rate */
  actionSuccessRate: number;
  /** Navigation success rate */
  navigationSuccessRate: number;
  /** Automation difficulty (1-10) */
  automationDifficulty: number;
  /** Anti-bot aggression (1-10) */
  antiBotAggression: number;
}

// ============================================================================
// Website Knowledge Base
// ============================================================================

export class WebsiteKnowledgeBase extends EventEmitter {
  private profiles: Map<string, WebsiteProfile> = new Map();
  private storageDir: string;
  private pendingWrites: Set<string> = new Set();
  private writeDebounceMs: number = 5000;
  private writeTimer: NodeJS.Timeout | null = null;

  constructor() {
    super();
    this.storageDir = path.join(app.getPath('userData'), 'browser-agent', 'website-knowledge');
    this.ensureStorageDir();
    this.loadProfiles();
  }

  /**
   * Get or create a profile for a domain
   */
  getProfile(url: string): WebsiteProfile {
    const domain = this.extractDomain(url);
    
    if (!this.profiles.has(domain)) {
      this.profiles.set(domain, this.createEmptyProfile(domain));
    }

    return this.profiles.get(domain)!;
  }

  /**
   * Record a page visit
   */
  recordPageVisit(state: BrowserState): void {
    const profile = this.getProfile(state.url);
    const pageType = this.inferPageType(state);

    // Find or create page pattern
    let pattern = profile.pagePatterns.find(p => 
      new RegExp(p.urlPattern).test(state.url)
    );

    if (!pattern) {
      pattern = {
        id: `pattern-${Date.now()}`,
        urlPattern: this.createUrlPattern(state.url),
        pageType,
        expectedElements: [],
        commonActions: [],
        nextPages: [],
        avgLoadTimeMs: 0,
        encounters: 0,
      };
      profile.pagePatterns.push(pattern);
    }

    pattern.encounters++;

    // Learn expected elements
    for (const element of state.elements) {
      if (element.semanticPurpose && element.semanticPurpose !== 'unknown') {
        this.learnElement(pattern, element);
      }
    }

    profile.totalInteractions++;
    profile.lastInteraction = Date.now();

    this.scheduleWrite(profile.domain);
  }

  /**
   * Record a successful action
   */
  recordAction(
    url: string,
    action: BrowserAction,
    element: IndexedElement | undefined,
    success: boolean
  ): void {
    const profile = this.getProfile(url);
    const pattern = this.findOrCreatePattern(profile, url);

    // Update action frequency
    const actionKey = `${action.type}:${action.description || ''}`;
    let actionFreq = pattern.commonActions.find(a => 
      a.actionType === action.type && a.targetDescription === action.description
    );

    if (!actionFreq) {
      actionFreq = {
        actionType: action.type,
        targetDescription: action.description || '',
        frequency: 0,
        successRate: 0,
      };
      pattern.commonActions.push(actionFreq);
    }

    // Update frequency using exponential moving average
    actionFreq.frequency = actionFreq.frequency * 0.9 + 0.1;
    actionFreq.successRate = actionFreq.successRate * 0.9 + (success ? 0.1 : 0);

    // Learn element selector if successful
    if (success && element) {
      this.learnElementSelector(profile, element, action.description || '');
    }

    this.scheduleWrite(profile.domain);
  }

  /**
   * Record a workflow completion
   */
  recordWorkflow(
    url: string,
    name: string,
    actions: Array<{ action: BrowserAction; url: string; element?: IndexedElement }>,
    success: boolean,
    durationMs: number
  ): void {
    const profile = this.getProfile(url);

    // Find existing workflow or create new
    let workflow = profile.workflows.find(w => w.name === name);

    if (!workflow) {
      workflow = {
        id: `workflow-${Date.now()}`,
        name,
        triggerIntent: name.toLowerCase(),
        actions: [],
        successRate: 0,
        executionCount: 0,
        avgDurationMs: 0,
      };
      profile.workflows.push(workflow);
    }

    // Update workflow data
    workflow.executionCount++;
    workflow.successRate = (workflow.successRate * (workflow.executionCount - 1) + (success ? 1 : 0)) / workflow.executionCount;
    workflow.avgDurationMs = (workflow.avgDurationMs * (workflow.executionCount - 1) + durationMs) / workflow.executionCount;

    // Update actions if this was more successful
    if (success && actions.length > workflow.actions.length) {
      workflow.actions = actions.map(a => ({
        type: a.action.type,
        pagePattern: this.createUrlPattern(a.url),
        targetDescription: a.action.description || '',
        selector: a.element?.selector,
        value: 'text' in a.action ? a.action.text : undefined,
        delayAfterMs: 500,
      }));
    }

    this.scheduleWrite(profile.domain);
  }

  /**
   * Get recommended workflow for an intent
   */
  getWorkflowForIntent(url: string, intent: string): WorkflowPattern | null {
    const profile = this.getProfile(url);
    const intentLower = intent.toLowerCase();

    // Find best matching workflow
    const matches = profile.workflows.filter(w => {
      const words = w.triggerIntent.split(/\s+/);
      return words.some(word => intentLower.includes(word));
    });

    if (matches.length === 0) return null;

    // Sort by success rate and return best
    matches.sort((a, b) => b.successRate - a.successRate);
    return matches[0];
  }

  /**
   * Get selectors for a semantic purpose
   */
  getSelectorsForPurpose(url: string, purpose: SemanticPurpose): string[] {
    const profile = this.getProfile(url);
    
    const selectors: string[] = [];

    // Check common elements
    for (const element of profile.commonElements) {
      if (element.purpose === purpose) {
        selectors.push(...element.selectors);
      }
    }

    // Check page patterns
    for (const pattern of profile.pagePatterns) {
      for (const expectation of pattern.expectedElements) {
        if (expectation.purpose === purpose) {
          selectors.push(...expectation.selectors);
        }
      }
    }

    // Dedupe and sort by reliability
    return [...new Set(selectors)];
  }

  /**
   * Check if site is known to have aggressive anti-bot
   */
  hasAggressiveAntiBot(url: string): boolean {
    const profile = this.profiles.get(this.extractDomain(url));
    return profile ? profile.metrics.antiBotAggression > 5 : false;
  }

  /**
   * Get site quirks
   */
  getSiteQuirks(url: string): SiteQuirk[] {
    const profile = this.profiles.get(this.extractDomain(url));
    return profile?.quirks || [];
  }

  /**
   * Record a site quirk
   */
  recordQuirk(url: string, quirk: SiteQuirk): void {
    const profile = this.getProfile(url);
    
    // Check if quirk already exists
    const existing = profile.quirks.find(q => 
      q.type === quirk.type && q.description === quirk.description
    );

    if (!existing) {
      profile.quirks.push(quirk);
      this.scheduleWrite(profile.domain);
    }
  }

  /**
   * Get authentication profile
   */
  getAuthProfile(url: string): AuthenticationProfile {
    const profile = this.getProfile(url);
    return profile.auth;
  }

  /**
   * Update authentication profile
   */
  updateAuthProfile(url: string, auth: Partial<AuthenticationProfile>): void {
    const profile = this.getProfile(url);
    profile.auth = { ...profile.auth, ...auth };
    this.scheduleWrite(profile.domain);
  }

  /**
   * Get site metrics
   */
  getSiteMetrics(url: string): SiteMetrics {
    const profile = this.profiles.get(this.extractDomain(url));
    return profile?.metrics || {
      avgLoadTimeMs: 0,
      actionSuccessRate: 0,
      navigationSuccessRate: 0,
      automationDifficulty: 5,
      antiBotAggression: 5,
    };
  }

  /**
   * Update site metrics
   */
  updateMetrics(
    url: string,
    update: { loadTimeMs?: number; actionSuccess?: boolean; navigationSuccess?: boolean }
  ): void {
    const profile = this.getProfile(url);
    const metrics = profile.metrics;

    if (update.loadTimeMs !== undefined) {
      metrics.avgLoadTimeMs = metrics.avgLoadTimeMs * 0.9 + update.loadTimeMs * 0.1;
    }

    if (update.actionSuccess !== undefined) {
      metrics.actionSuccessRate = metrics.actionSuccessRate * 0.95 + (update.actionSuccess ? 0.05 : 0);
    }

    if (update.navigationSuccess !== undefined) {
      metrics.navigationSuccessRate = metrics.navigationSuccessRate * 0.95 + (update.navigationSuccess ? 0.05 : 0);
    }

    // Infer automation difficulty
    metrics.automationDifficulty = Math.round(
      10 - (metrics.actionSuccessRate + metrics.navigationSuccessRate) * 5
    );

    this.scheduleWrite(profile.domain);
  }

  /**
   * Get all known domains
   */
  getKnownDomains(): string[] {
    return Array.from(this.profiles.keys());
  }

  /**
   * Export knowledge for a domain
   */
  exportProfile(domain: string): WebsiteProfile | null {
    return this.profiles.get(domain) || null;
  }

  /**
   * Import a profile
   */
  importProfile(profile: WebsiteProfile): void {
    this.profiles.set(profile.domain, profile);
    this.scheduleWrite(profile.domain);
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private extractDomain(url: string): string {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  }

  private createEmptyProfile(domain: string): WebsiteProfile {
    return {
      domain,
      subdomains: [],
      siteType: 'unknown',
      pagePatterns: [],
      auth: {
        hasLogin: false,
        method: 'unknown',
        hasMFA: false,
      },
      commonElements: [],
      workflows: [],
      quirks: [],
      metrics: {
        avgLoadTimeMs: 0,
        actionSuccessRate: 0.5,
        navigationSuccessRate: 0.5,
        automationDifficulty: 5,
        antiBotAggression: 5,
      },
      lastInteraction: Date.now(),
      totalInteractions: 0,
      createdAt: Date.now(),
    };
  }

  private createUrlPattern(url: string): string {
    try {
      const parsed = new URL(url);
      // Replace IDs and UUIDs with wildcards
      const path = parsed.pathname
        .replace(/\/\d+/g, '/\\d+')
        .replace(/\/[a-f0-9-]{36}/gi, '/[a-f0-9-]+');
      return `${parsed.hostname}${path}`;
    } catch {
      return url;
    }
  }

  private inferPageType(state: BrowserState): string {
    const url = state.url.toLowerCase();
    const title = state.title.toLowerCase();

    if (/login|signin/i.test(url)) return 'login';
    if (/signup|register/i.test(url)) return 'signup';
    if (/search|results/i.test(url)) return 'search-results';
    if (/cart|basket/i.test(url)) return 'cart';
    if (/checkout|payment/i.test(url)) return 'checkout';
    if (/product|item/i.test(url)) return 'product';
    if (/settings|preferences/i.test(url)) return 'settings';
    if (/profile|account/i.test(url)) return 'profile';

    return 'other';
  }

  private findOrCreatePattern(profile: WebsiteProfile, url: string): PagePattern {
    let pattern = profile.pagePatterns.find(p => 
      new RegExp(p.urlPattern).test(url)
    );

    if (!pattern) {
      pattern = {
        id: `pattern-${Date.now()}`,
        urlPattern: this.createUrlPattern(url),
        pageType: 'unknown',
        expectedElements: [],
        commonActions: [],
        nextPages: [],
        avgLoadTimeMs: 0,
        encounters: 0,
      };
      profile.pagePatterns.push(pattern);
    }

    return pattern;
  }

  private learnElement(pattern: PagePattern, element: IndexedElement): void {
    if (!element.semanticPurpose) return;

    let expectation = pattern.expectedElements.find(e => 
      e.purpose === element.semanticPurpose
    );

    if (!expectation) {
      expectation = {
        purpose: element.semanticPurpose,
        selectors: [],
        textPatterns: [],
        inViewport: element.bounds.isInViewport,
        reliability: 0,
      };
      pattern.expectedElements.push(expectation);
    }

    // Add selector if not already known
    if (element.selector && !expectation.selectors.includes(element.selector)) {
      expectation.selectors.push(element.selector);
    }

    // Add text pattern if useful
    if (element.text && element.text.length < 50) {
      const textPattern = element.text.toLowerCase();
      if (!expectation.textPatterns.includes(textPattern)) {
        expectation.textPatterns.push(textPattern);
      }
    }

    // Update reliability (exponential moving average)
    expectation.reliability = expectation.reliability * 0.9 + 0.1;
  }

  private learnElementSelector(
    profile: WebsiteProfile,
    element: IndexedElement,
    purpose: string
  ): void {
    let common = profile.commonElements.find(e => e.purpose === purpose);

    if (!common) {
      common = {
        purpose,
        selectors: [],
        alternativeTexts: [],
        pagePattern: '*',
        lastVerified: Date.now(),
        verificationCount: 0,
      };
      profile.commonElements.push(common);
    }

    // Add selector
    if (element.selector && !common.selectors.includes(element.selector)) {
      common.selectors.push(element.selector);
      // Keep only top 5 selectors
      if (common.selectors.length > 5) {
        common.selectors.shift();
      }
    }

    // Add text
    if (element.text && !common.alternativeTexts.includes(element.text)) {
      common.alternativeTexts.push(element.text);
      if (common.alternativeTexts.length > 5) {
        common.alternativeTexts.shift();
      }
    }

    common.lastVerified = Date.now();
    common.verificationCount++;
  }

  private scheduleWrite(domain: string): void {
    this.pendingWrites.add(domain);

    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
    }

    this.writeTimer = setTimeout(() => {
      this.flushWrites();
    }, this.writeDebounceMs);
  }

  private flushWrites(): void {
    for (const domain of this.pendingWrites) {
      const profile = this.profiles.get(domain);
      if (profile) {
        this.saveProfile(profile);
      }
    }
    this.pendingWrites.clear();
    this.writeTimer = null;
  }

  private saveProfile(profile: WebsiteProfile): void {
    const filePath = path.join(this.storageDir, `${profile.domain}.json`);
    try {
      fs.writeFileSync(filePath, JSON.stringify(profile, null, 2));
    } catch (error) {
      logger.error('Failed to save profile', { domain: profile.domain, error });
    }
  }

  private ensureStorageDir(): void {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  private loadProfiles(): void {
    try {
      const files = fs.readdirSync(this.storageDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(this.storageDir, file);
          const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          this.profiles.set(data.domain, data);
        }
      }
      logger.info('Loaded website profiles', { count: this.profiles.size });
    } catch (error) {
      logger.error('Failed to load profiles', error);
    }
  }
}

// ============================================================================
// Singleton Factory
// ============================================================================

let knowledgeBaseInstance: WebsiteKnowledgeBase | null = null;

export function getWebsiteKnowledgeBase(): WebsiteKnowledgeBase {
  if (!knowledgeBaseInstance) {
    knowledgeBaseInstance = new WebsiteKnowledgeBase();
  }
  return knowledgeBaseInstance;
}

export function createWebsiteKnowledgeBase(): WebsiteKnowledgeBase {
  return new WebsiteKnowledgeBase();
}
