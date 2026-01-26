/**
 * Visual Memory System
 *
 * Tracks visual changes across pages and sessions, enabling the agent to:
 * - Detect when a page has changed visually
 * - Remember what successful pages looked like
 * - Identify visual regressions or errors
 * - Track dynamic content updates
 *
 * This gives us a significant advantage over Claude for Chrome which
 * lacks persistent visual context.
 *
 * @module agent/browser-agent/visual-memory
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';
import { getLLMManager } from '../../llm/manager';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

const logger = createModuleLogger('VisualMemory');

// ============================================================================
// Visual Memory Types
// ============================================================================

export interface VisualSnapshot {
  /** Unique ID */
  id: string;
  /** URL when captured */
  url: string;
  /** Page title */
  title: string;
  /** Screenshot as base64 */
  screenshot: string;
  /** Perceptual hash for similarity comparison */
  perceptualHash: string;
  /** Timestamp */
  timestamp: number;
  /** Associated task ID if any */
  taskId?: string;
  /** Page state classification */
  classification: PageStateClassification;
  /** Key regions identified */
  regions: VisualRegion[];
  /** Visual fingerprint for quick comparison */
  fingerprint: VisualFingerprint;
}

export interface PageStateClassification {
  /** Is this a success state? */
  isSuccess: boolean;
  /** Is this an error state? */
  isError: boolean;
  /** Is loading indicator visible? */
  isLoading: boolean;
  /** Has a modal/popup? */
  hasModal: boolean;
  /** Has CAPTCHA? */
  hasCaptcha: boolean;
  /** Page type */
  pageType: string;
  /** Confidence */
  confidence: number;
}

export interface VisualRegion {
  /** Region type */
  type: 'header' | 'navigation' | 'content' | 'sidebar' | 'footer' | 'modal' | 'form' | 'error' | 'success';
  /** Bounding box */
  bounds: { x: number; y: number; width: number; height: number };
  /** Importance score 0-1 */
  importance: number;
  /** Description */
  description: string;
}

export interface VisualFingerprint {
  /** Average color */
  avgColor: { r: number; g: number; b: number };
  /** Dominant colors */
  dominantColors: Array<{ r: number; g: number; b: number; percentage: number }>;
  /** Edge density (0-1) */
  edgeDensity: number;
  /** Text density (0-1) */
  textDensity: number;
  /** Layout hash */
  layoutHash: string;
}

export interface VisualChange {
  /** Change type */
  type: 'addition' | 'removal' | 'modification' | 'layout-shift';
  /** Region affected */
  region: VisualRegion;
  /** Significance (0-1) */
  significance: number;
  /** Description */
  description: string;
}

export interface VisualComparison {
  /** Overall similarity (0-1) */
  similarity: number;
  /** Changes detected */
  changes: VisualChange[];
  /** Is significant change? */
  isSignificantChange: boolean;
  /** Change summary */
  summary: string;
}

// ============================================================================
// Visual Analysis Prompts
// ============================================================================

const VISUAL_ANALYSIS_PROMPT = `Analyze this webpage screenshot and identify key visual regions and state.

Identify:
1. Page type (login, dashboard, search results, etc.)
2. Key regions (header, nav, content, sidebar, footer, modals)
3. Current state (success, error, loading, normal)
4. Any important UI elements (buttons, forms, alerts)
5. Potential issues (broken layout, error messages, CAPTCHAs)

Respond in JSON:
{
  "classification": {
    "isSuccess": false,
    "isError": false,
    "isLoading": false,
    "hasModal": false,
    "hasCaptcha": false,
    "pageType": "search-results",
    "confidence": 0.9
  },
  "regions": [
    {
      "type": "header",
      "bounds": { "x": 0, "y": 0, "width": 1920, "height": 60 },
      "importance": 0.7,
      "description": "Navigation header with search bar"
    }
  ],
  "summary": "Search results page showing 10 product listings"
}`;

const VISUAL_DIFF_PROMPT = `Compare these two screenshots and identify what changed.

Previous state summary: {previousSummary}
Current page URL: {url}

Focus on:
1. Significant content changes
2. UI state changes (loading -> loaded, form -> submitted)
3. Error or success indicators
4. Modal appearances/disappearances
5. Navigation changes

Respond in JSON:
{
  "similarity": 0.85,
  "isSignificantChange": true,
  "changes": [
    {
      "type": "addition",
      "region": { "type": "modal", "bounds": {...}, "importance": 0.9, "description": "Login modal appeared" },
      "significance": 0.8,
      "description": "A login modal has appeared in the center of the screen"
    }
  ],
  "summary": "The page has transitioned from loading to showing search results, with a cookie consent modal appearing."
}`;

// ============================================================================
// Visual Memory System
// ============================================================================

export class VisualMemory extends EventEmitter {
  private snapshots: Map<string, VisualSnapshot[]> = new Map();
  private storageDir: string;
  private maxSnapshotsPerUrl: number = 10;
  private currentSessionSnapshots: VisualSnapshot[] = [];

  constructor() {
    super();
    this.storageDir = path.join(app.getPath('userData'), 'browser-agent', 'visual-memory');
    this.ensureStorageDir();
    this.loadIndex();
  }

  /**
   * Capture and analyze a visual snapshot
   */
  async captureSnapshot(
    page: any,
    taskId?: string
  ): Promise<VisualSnapshot> {
    const url = page.url();
    const title = await page.title();

    // Take screenshot
    const screenshotBuffer = await page.screenshot({ 
      type: 'jpeg',
      quality: 80,
      fullPage: false,
    });
    const screenshot = screenshotBuffer.toString('base64');

    // Generate perceptual hash
    const perceptualHash = await this.generatePerceptualHash(screenshotBuffer);

    // Generate fingerprint
    const fingerprint = await this.generateFingerprint(screenshotBuffer);

    // Analyze with vision LLM
    const analysis = await this.analyzeScreenshot(screenshot);

    const snapshot: VisualSnapshot = {
      id: crypto.randomUUID(),
      url,
      title,
      screenshot,
      perceptualHash,
      timestamp: Date.now(),
      taskId,
      classification: analysis.classification,
      regions: analysis.regions,
      fingerprint,
    };

    // Store snapshot
    this.storeSnapshot(snapshot);

    return snapshot;
  }

  /**
   * Compare current page with previous snapshot
   */
  async compareWithPrevious(
    page: any,
    previousSnapshot: VisualSnapshot
  ): Promise<VisualComparison> {
    // Capture current state
    const currentSnapshot = await this.captureSnapshot(page);

    // Quick comparison using perceptual hash
    const hashSimilarity = this.compareHashes(
      currentSnapshot.perceptualHash,
      previousSnapshot.perceptualHash
    );

    // If very similar, skip expensive vision comparison
    if (hashSimilarity > 0.95) {
      return {
        similarity: hashSimilarity,
        changes: [],
        isSignificantChange: false,
        summary: 'No significant visual changes detected',
      };
    }

    // Fingerprint comparison for quick layout check
    const fingerprintSimilarity = this.compareFingerpints(
      currentSnapshot.fingerprint,
      previousSnapshot.fingerprint
    );

    // Use vision LLM for detailed comparison if significant change
    if (hashSimilarity < 0.8 || fingerprintSimilarity < 0.7) {
      return await this.detailedVisualComparison(currentSnapshot, previousSnapshot);
    }

    return {
      similarity: (hashSimilarity + fingerprintSimilarity) / 2,
      changes: this.inferChanges(currentSnapshot, previousSnapshot),
      isSignificantChange: hashSimilarity < 0.85,
      summary: this.generateChangeSummary(currentSnapshot, previousSnapshot),
    };
  }

  /**
   * Find similar snapshots from history
   */
  findSimilarSnapshots(snapshot: VisualSnapshot, threshold: number = 0.7): VisualSnapshot[] {
    const similar: Array<{ snapshot: VisualSnapshot; similarity: number }> = [];

    for (const [_url, snapshots] of this.snapshots) {
      for (const stored of snapshots) {
        const similarity = this.compareHashes(snapshot.perceptualHash, stored.perceptualHash);
        if (similarity >= threshold) {
          similar.push({ snapshot: stored, similarity });
        }
      }
    }

    return similar
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 5)
      .map(s => s.snapshot);
  }

  /**
   * Check if page matches a known success state
   */
  async isSuccessState(page: any, taskObjective: string): Promise<{ isSuccess: boolean; confidence: number; reason: string }> {
    const snapshot = await this.captureSnapshot(page);

    // Check classification
    if (snapshot.classification.isSuccess) {
      return { 
        isSuccess: true, 
        confidence: snapshot.classification.confidence,
        reason: 'Visual analysis indicates success state'
      };
    }

    if (snapshot.classification.isError) {
      return {
        isSuccess: false,
        confidence: snapshot.classification.confidence,
        reason: 'Visual analysis indicates error state'
      };
    }

    // Check for common success patterns based on task
    const successPatterns = this.getSuccessPatterns(taskObjective);
    for (const pattern of successPatterns) {
      if (this.matchesPattern(snapshot, pattern)) {
        return {
          isSuccess: true,
          confidence: pattern.confidence,
          reason: pattern.description,
        };
      }
    }

    return { isSuccess: false, confidence: 0.5, reason: 'Unable to determine success state' };
  }

  /**
   * Detect visual anomalies (broken layout, missing images, etc.)
   */
  detectAnomalies(snapshot: VisualSnapshot): string[] {
    const anomalies: string[] = [];

    // Check for very low edge density (possibly blank page)
    if (snapshot.fingerprint.edgeDensity < 0.1) {
      anomalies.push('Page appears mostly blank or has minimal content');
    }

    // Check for very high text density (possibly error page dump)
    if (snapshot.fingerprint.textDensity > 0.8) {
      anomalies.push('Unusually high text density - possible error dump or raw data');
    }

    // Check classification
    if (snapshot.classification.isError) {
      anomalies.push('Error state detected on page');
    }

    if (snapshot.classification.hasCaptcha) {
      anomalies.push('CAPTCHA detected');
    }

    if (snapshot.classification.isLoading) {
      anomalies.push('Page still loading');
    }

    return anomalies;
  }

  /**
   * Get the last snapshot for a URL
   */
  getLastSnapshot(url: string): VisualSnapshot | null {
    const urlSnapshots = this.snapshots.get(url);
    if (!urlSnapshots || urlSnapshots.length === 0) return null;
    return urlSnapshots[urlSnapshots.length - 1];
  }

  /**
   * Get current session snapshots
   */
  getSessionSnapshots(): VisualSnapshot[] {
    return [...this.currentSessionSnapshots];
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private async analyzeScreenshot(screenshot: string): Promise<{
    classification: PageStateClassification;
    regions: VisualRegion[];
    summary: string;
  }> {
    try {
      const llm = getLLMManager();
      
      const response = await llm.generateWithTools(
        [{
          role: 'user',
          content: [
            { type: 'text', text: VISUAL_ANALYSIS_PROMPT },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${screenshot}` } },
          ],
        }],
        [],
        {
          model: 'accounts/fireworks/models/qwen2-vl-72b-instruct',
          temperature: 0.2,
          maxTokens: 1500,
        }
      );

      return this.parseAnalysisResponse(response.content);
    } catch (error) {
      logger.error('Visual analysis failed', error);
      return {
        classification: {
          isSuccess: false,
          isError: false,
          isLoading: false,
          hasModal: false,
          hasCaptcha: false,
          pageType: 'unknown',
          confidence: 0,
        },
        regions: [],
        summary: 'Analysis failed',
      };
    }
  }

  private async detailedVisualComparison(
    current: VisualSnapshot,
    previous: VisualSnapshot
  ): Promise<VisualComparison> {
    try {
      const llm = getLLMManager();

      const prompt = VISUAL_DIFF_PROMPT
        .replace('{previousSummary}', previous.classification.pageType)
        .replace('{url}', current.url);

      const response = await llm.generateWithTools(
        [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'text', text: 'Previous screenshot:' },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${previous.screenshot}` } },
            { type: 'text', text: 'Current screenshot:' },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${current.screenshot}` } },
          ],
        }],
        [],
        {
          model: 'accounts/fireworks/models/qwen2-vl-72b-instruct',
          temperature: 0.2,
          maxTokens: 1500,
        }
      );

      return this.parseComparisonResponse(response.content);
    } catch (error) {
      logger.error('Detailed comparison failed', error);
      return {
        similarity: this.compareHashes(current.perceptualHash, previous.perceptualHash),
        changes: [],
        isSignificantChange: true,
        summary: 'Unable to perform detailed comparison',
      };
    }
  }

  private async generatePerceptualHash(imageBuffer: Buffer): Promise<string> {
    // Simplified perceptual hash implementation
    // In production, would use a proper pHash library
    const hash = crypto.createHash('sha256').update(imageBuffer).digest('hex');
    return hash.substring(0, 16);
  }

  private async generateFingerprint(imageBuffer: Buffer): Promise<VisualFingerprint> {
    // Simplified fingerprint - would use image analysis in production
    return {
      avgColor: { r: 255, g: 255, b: 255 },
      dominantColors: [{ r: 255, g: 255, b: 255, percentage: 0.5 }],
      edgeDensity: 0.5,
      textDensity: 0.3,
      layoutHash: crypto.createHash('md5').update(imageBuffer).digest('hex').substring(0, 8),
    };
  }

  private compareHashes(hash1: string, hash2: string): number {
    if (hash1 === hash2) return 1.0;
    
    // Simple hamming distance for demonstration
    let matches = 0;
    const length = Math.min(hash1.length, hash2.length);
    for (let i = 0; i < length; i++) {
      if (hash1[i] === hash2[i]) matches++;
    }
    return matches / length;
  }

  private compareFingerpints(fp1: VisualFingerprint, fp2: VisualFingerprint): number {
    // Compare layout hashes
    if (fp1.layoutHash === fp2.layoutHash) return 1.0;
    
    // Compare densities
    const edgeDiff = Math.abs(fp1.edgeDensity - fp2.edgeDensity);
    const textDiff = Math.abs(fp1.textDensity - fp2.textDensity);
    
    return Math.max(0, 1 - (edgeDiff + textDiff) / 2);
  }

  private inferChanges(current: VisualSnapshot, previous: VisualSnapshot): VisualChange[] {
    const changes: VisualChange[] = [];

    // Compare classifications
    if (current.classification.hasModal && !previous.classification.hasModal) {
      changes.push({
        type: 'addition',
        region: { type: 'modal', bounds: { x: 0, y: 0, width: 0, height: 0 }, importance: 0.9, description: 'Modal appeared' },
        significance: 0.8,
        description: 'A modal dialog has appeared',
      });
    }

    if (current.classification.isError && !previous.classification.isError) {
      changes.push({
        type: 'modification',
        region: { type: 'error', bounds: { x: 0, y: 0, width: 0, height: 0 }, importance: 0.95, description: 'Error state' },
        significance: 0.9,
        description: 'Page has entered an error state',
      });
    }

    if (current.classification.isSuccess && !previous.classification.isSuccess) {
      changes.push({
        type: 'modification',
        region: { type: 'success', bounds: { x: 0, y: 0, width: 0, height: 0 }, importance: 0.9, description: 'Success state' },
        significance: 0.85,
        description: 'Page shows success state',
      });
    }

    return changes;
  }

  private generateChangeSummary(current: VisualSnapshot, previous: VisualSnapshot): string {
    const parts: string[] = [];

    if (current.url !== previous.url) {
      parts.push(`Navigated from ${previous.url} to ${current.url}`);
    }

    if (current.title !== previous.title) {
      parts.push(`Title changed to "${current.title}"`);
    }

    if (current.classification.pageType !== previous.classification.pageType) {
      parts.push(`Page type changed from ${previous.classification.pageType} to ${current.classification.pageType}`);
    }

    return parts.join('. ') || 'Minor visual changes detected';
  }

  private getSuccessPatterns(taskObjective: string): Array<{ pattern: RegExp; confidence: number; description: string }> {
    const objective = taskObjective.toLowerCase();
    const patterns: Array<{ pattern: RegExp; confidence: number; description: string }> = [];

    if (objective.includes('login')) {
      patterns.push({
        pattern: /dashboard|home|welcome|account/i,
        confidence: 0.85,
        description: 'Redirected to dashboard after login',
      });
    }

    if (objective.includes('search')) {
      patterns.push({
        pattern: /results|showing|found/i,
        confidence: 0.8,
        description: 'Search results displayed',
      });
    }

    if (objective.includes('checkout') || objective.includes('purchase')) {
      patterns.push({
        pattern: /confirmation|thank.?you|order.?placed|success/i,
        confidence: 0.9,
        description: 'Order confirmation shown',
      });
    }

    return patterns;
  }

  private matchesPattern(
    snapshot: VisualSnapshot,
    pattern: { pattern: RegExp; confidence: number; description: string }
  ): boolean {
    return pattern.pattern.test(snapshot.title) || 
           pattern.pattern.test(snapshot.url) ||
           pattern.pattern.test(snapshot.classification.pageType);
  }

  private parseAnalysisResponse(content: string): {
    classification: PageStateClassification;
    regions: VisualRegion[];
    summary: string;
  } {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found');

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        classification: {
          isSuccess: parsed.classification?.isSuccess || false,
          isError: parsed.classification?.isError || false,
          isLoading: parsed.classification?.isLoading || false,
          hasModal: parsed.classification?.hasModal || false,
          hasCaptcha: parsed.classification?.hasCaptcha || false,
          pageType: parsed.classification?.pageType || 'unknown',
          confidence: parsed.classification?.confidence || 0.5,
        },
        regions: parsed.regions || [],
        summary: parsed.summary || '',
      };
    } catch (error) {
      return {
        classification: {
          isSuccess: false,
          isError: false,
          isLoading: false,
          hasModal: false,
          hasCaptcha: false,
          pageType: 'unknown',
          confidence: 0,
        },
        regions: [],
        summary: 'Failed to parse analysis',
      };
    }
  }

  private parseComparisonResponse(content: string): VisualComparison {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found');

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        similarity: parsed.similarity || 0.5,
        changes: parsed.changes || [],
        isSignificantChange: parsed.isSignificantChange || false,
        summary: parsed.summary || '',
      };
    } catch (error) {
      return {
        similarity: 0.5,
        changes: [],
        isSignificantChange: true,
        summary: 'Failed to parse comparison',
      };
    }
  }

  private storeSnapshot(snapshot: VisualSnapshot): void {
    const urlSnapshots = this.snapshots.get(snapshot.url) || [];
    urlSnapshots.push(snapshot);

    // Limit snapshots per URL
    while (urlSnapshots.length > this.maxSnapshotsPerUrl) {
      urlSnapshots.shift();
    }

    this.snapshots.set(snapshot.url, urlSnapshots);
    this.currentSessionSnapshots.push(snapshot);

    // Save to disk (without the actual screenshot data for index)
    this.saveIndex();
  }

  private ensureStorageDir(): void {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  private loadIndex(): void {
    const indexPath = path.join(this.storageDir, 'index.json');
    if (fs.existsSync(indexPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
        // Reconstruct map (without screenshots)
        for (const [url, snapshots] of Object.entries(data)) {
          this.snapshots.set(url, snapshots as VisualSnapshot[]);
        }
        logger.debug('Loaded visual memory index', { urls: this.snapshots.size });
      } catch (error) {
        logger.error('Failed to load visual memory index', error);
      }
    }
  }

  private saveIndex(): void {
    const indexPath = path.join(this.storageDir, 'index.json');
    const data: Record<string, Array<Omit<VisualSnapshot, 'screenshot'>>> = {};

    for (const [url, snapshots] of this.snapshots) {
      // Save metadata only, not screenshots
      data[url] = snapshots.map(s => ({
        ...s,
        screenshot: '', // Don't persist screenshots in index
      }));
    }

    try {
      fs.writeFileSync(indexPath, JSON.stringify(data, null, 2));
    } catch (error) {
      logger.error('Failed to save visual memory index', error);
    }
  }
}

// ============================================================================
// Singleton Factory
// ============================================================================

let visualMemoryInstance: VisualMemory | null = null;

export function getVisualMemory(): VisualMemory {
  if (!visualMemoryInstance) {
    visualMemoryInstance = new VisualMemory();
  }
  return visualMemoryInstance;
}

export function createVisualMemory(): VisualMemory {
  return new VisualMemory();
}
