/**
 * Atlas Desktop - VM Agent Visual Memory System
 *
 * Cross-session visual learning that remembers page layouts,
 * UI patterns, and successful interactions.
 *
 * Ported and enhanced from browser-agent/visual-memory.ts
 *
 * @module vm-agent/vision/visual-memory
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { createModuleLogger } from '../../utils/logger';
import { getEventBus, createEvent } from '../core/event-bus';
import { ScreenState, UIElement } from '../types';
import { EnhancedUIElement } from '../core/types';

const logger = createModuleLogger('VisualMemory');

// =============================================================================
// Visual Memory Constants
// =============================================================================

export const VISUAL_MEMORY_CONSTANTS = {
  /** Maximum snapshots to store per application */
  MAX_SNAPSHOTS_PER_APP: 50,
  /** Maximum total snapshots */
  MAX_TOTAL_SNAPSHOTS: 500,
  /** Snapshot comparison similarity threshold */
  SIMILARITY_THRESHOLD: 0.7,
  /** Feature vector dimension */
  FEATURE_VECTOR_SIZE: 128,
  /** Layout grid size for comparison */
  LAYOUT_GRID_SIZE: 16,
  /** Pattern learning threshold */
  PATTERN_MIN_OCCURRENCES: 3,
  /** Memory persistence file */
  MEMORY_FILE: 'vm-visual-memory.json',
  /** Change detection threshold */
  CHANGE_THRESHOLD: 0.15,
} as const;

// =============================================================================
// Visual Memory Types
// =============================================================================

export interface VisualSnapshot {
  id: string;
  timestamp: number;
  application: string;
  screenTitle: string;
  dimensions: { width: number; height: number };
  /** Compressed feature vector for similarity matching */
  featureVector: number[];
  /** Layout hash for quick comparison */
  layoutHash: string;
  /** Element signature for pattern matching */
  elementSignature: string;
  /** Regions of interest */
  regions: SnapshotRegion[];
  /** Screenshot thumbnail (base64, reduced size) */
  thumbnail?: string;
  /** Associated task or action context */
  context?: string;
  /** Success indicators */
  successState: boolean;
  /** Tags for categorization */
  tags: string[];
}

export interface SnapshotRegion {
  name: string;
  bounds: { x: number; y: number; width: number; height: number };
  hash: string;
  elementCount: number;
  interactive: boolean;
}

export interface VisualPattern {
  id: string;
  name: string;
  application: string;
  occurrences: number;
  lastSeen: number;
  firstSeen: number;
  /** Template snapshot ID */
  templateId: string;
  /** Common elements across occurrences */
  commonElements: ElementPattern[];
  /** Typical changes in this pattern */
  dynamicRegions: string[];
  /** Success rate when this pattern was seen */
  successRate: number;
  /** Actions that work well on this pattern */
  effectiveActions: ActionPattern[];
}

export interface ElementPattern {
  selector: string;
  type: string;
  relativePosition: { x: number; y: number };
  frequency: number;
  variations: string[];
}

export interface ActionPattern {
  action: string;
  targetType: string;
  successRate: number;
  avgDuration: number;
  usageCount: number;
}

export interface VisualComparison {
  similarity: number;
  layoutSimilarity: number;
  elementSimilarity: number;
  changedRegions: ChangedRegion[];
  newElements: EnhancedUIElement[];
  removedElements: EnhancedUIElement[];
  matchedPattern?: VisualPattern;
}

export interface ChangedRegion {
  name: string;
  bounds: { x: number; y: number; width: number; height: number };
  changeType: 'added' | 'removed' | 'modified';
  confidence: number;
}

export interface SuccessStateMatch {
  isSuccessState: boolean;
  confidence: number;
  matchedSnapshot?: VisualSnapshot;
  indicators: string[];
}

// =============================================================================
// Visual Memory Manager Class
// =============================================================================

/**
 * Manages visual memory for cross-session learning
 *
 * Features:
 * - Captures and stores visual snapshots
 * - Detects changes between screenshots
 * - Learns UI patterns across sessions
 * - Recognizes success/failure states
 *
 * @example
 * ```typescript
 * const memory = getVisualMemory();
 *
 * // Capture current state
 * const snapshot = await memory.captureSnapshot(screenState);
 *
 * // Compare with previous
 * const comparison = await memory.compareWithPrevious(screenState);
 *
 * // Check for success state
 * const success = memory.isSuccessState(screenState);
 * ```
 */
export class VisualMemoryManager extends EventEmitter {
  private snapshots: Map<string, VisualSnapshot> = new Map();
  private patterns: Map<string, VisualPattern> = new Map();
  private snapshotsByApp: Map<string, string[]> = new Map();
  private previousState: ScreenState | null = null;
  private dataDir: string;
  private initialized: boolean = false;

  constructor() {
    super();
    this.dataDir = path.join(app.getPath('userData'), 'vm-agent');
  }

  /**
   * Initialize visual memory (load from disk)
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Ensure directory exists
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }

      await this.loadFromDisk();
      this.initialized = true;
      logger.info('Visual memory initialized', {
        snapshots: this.snapshots.size,
        patterns: this.patterns.size,
      });
    } catch (error) {
      logger.error('Failed to initialize visual memory', { error });
      this.initialized = true; // Continue with empty memory
    }
  }

  /**
   * Capture a visual snapshot of the current screen
   */
  async captureSnapshot(
    screenState: ScreenState,
    options?: {
      application?: string;
      context?: string;
      successState?: boolean;
      tags?: string[];
      saveThumbnail?: boolean;
    },
  ): Promise<VisualSnapshot> {
    await this.ensureInitialized();

    const application = options?.application || this.detectApplication(screenState);
    const startTime = Date.now();

    // Generate feature vector
    const featureVector = this.extractFeatureVector(screenState);

    // Generate layout hash
    const layoutHash = this.generateLayoutHash(screenState);

    // Generate element signature
    const elementSignature = this.generateElementSignature(screenState);

    // Extract regions
    const regions = this.extractRegions(screenState);

    // Generate thumbnail if requested
    let thumbnail: string | undefined;
    if (options?.saveThumbnail && screenState.screenshot) {
      thumbnail = await this.generateThumbnail(screenState.screenshot);
    }

    const snapshot: VisualSnapshot = {
      id: `snapshot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      application,
      screenTitle: screenState.title || '',
      dimensions: screenState.dimensions,
      featureVector,
      layoutHash,
      elementSignature,
      regions,
      thumbnail,
      context: options?.context,
      successState: options?.successState ?? false,
      tags: options?.tags || [],
    };

    // Store snapshot
    this.storeSnapshot(snapshot);

    // Update patterns
    this.updatePatterns(snapshot, screenState);

    // Save periodically
    this.scheduleSave();

    logger.debug('Captured visual snapshot', {
      id: snapshot.id,
      application,
      durationMs: Date.now() - startTime,
    });

    const eventBus = getEventBus();
    eventBus.emitSync(
      createEvent('vision:snapshot-captured', { snapshot }, 'visual-memory', {
        priority: 'low',
      }),
    );

    // Update previous state
    this.previousState = screenState;

    return snapshot;
  }

  /**
   * Compare current state with previous state
   */
  async compareWithPrevious(screenState: ScreenState): Promise<VisualComparison | null> {
    if (!this.previousState) {
      this.previousState = screenState;
      return null;
    }

    return this.compareStates(this.previousState, screenState);
  }

  /**
   * Compare two screen states
   */
  async compareStates(before: ScreenState, after: ScreenState): Promise<VisualComparison> {
    await this.ensureInitialized();

    // Calculate similarities
    const layoutSimilarity = this.compareLayouts(before, after);
    const elementSimilarity = this.compareElements(before, after);
    const similarity = layoutSimilarity * 0.4 + elementSimilarity * 0.6;

    // Detect changed regions
    const changedRegions = this.detectChangedRegions(before, after);

    // Find new and removed elements
    const newElements = this.findNewElements(before.elements, after.elements);
    const removedElements = this.findRemovedElements(before.elements, after.elements);

    // Try to match a known pattern
    const matchedPattern = this.findMatchingPattern(after);

    return {
      similarity,
      layoutSimilarity,
      elementSimilarity,
      changedRegions,
      newElements,
      removedElements,
      matchedPattern,
    };
  }

  /**
   * Check if current state matches a known success state
   */
  isSuccessState(screenState: ScreenState): SuccessStateMatch {
    const application = this.detectApplication(screenState);
    const layoutHash = this.generateLayoutHash(screenState);
    const elementSignature = this.generateElementSignature(screenState);

    // Find similar success snapshots
    const appSnapshots = this.snapshotsByApp.get(application) || [];
    let bestMatch: VisualSnapshot | undefined;
    let bestSimilarity = 0;

    for (const snapshotId of appSnapshots) {
      const snapshot = this.snapshots.get(snapshotId);
      if (!snapshot || !snapshot.successState) continue;

      // Quick hash comparison first
      if (snapshot.layoutHash === layoutHash) {
        return {
          isSuccessState: true,
          confidence: 0.95,
          matchedSnapshot: snapshot,
          indicators: ['Exact layout match with known success state'],
        };
      }

      // Element signature comparison
      if (snapshot.elementSignature === elementSignature) {
        bestMatch = snapshot;
        bestSimilarity = 0.9;
      }

      // Feature vector similarity
      const similarity = this.cosineSimilarity(
        this.extractFeatureVector(screenState),
        snapshot.featureVector,
      );
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestMatch = snapshot;
      }
    }

    // Check for success indicators in content
    const indicators = this.detectSuccessIndicators(screenState);

    const isSuccess = bestSimilarity >= VISUAL_MEMORY_CONSTANTS.SIMILARITY_THRESHOLD || indicators.length > 0;

    return {
      isSuccessState: isSuccess,
      confidence: Math.max(bestSimilarity, indicators.length > 0 ? 0.7 : 0),
      matchedSnapshot: bestMatch,
      indicators,
    };
  }

  /**
   * Record that an action was successful on a pattern
   */
  recordActionSuccess(
    pattern: VisualPattern,
    action: string,
    targetType: string,
    duration: number,
  ): void {
    const existingAction = pattern.effectiveActions.find(
      (a) => a.action === action && a.targetType === targetType,
    );

    if (existingAction) {
      existingAction.usageCount++;
      existingAction.successRate =
        (existingAction.successRate * (existingAction.usageCount - 1) + 1) /
        existingAction.usageCount;
      existingAction.avgDuration =
        (existingAction.avgDuration * (existingAction.usageCount - 1) + duration) /
        existingAction.usageCount;
    } else {
      pattern.effectiveActions.push({
        action,
        targetType,
        successRate: 1,
        avgDuration: duration,
        usageCount: 1,
      });
    }

    this.patterns.set(pattern.id, pattern);
    this.scheduleSave();
  }

  /**
   * Find a snapshot by ID
   */
  getSnapshot(id: string): VisualSnapshot | undefined {
    return this.snapshots.get(id);
  }

  /**
   * Get all snapshots for an application
   */
  getSnapshotsForApp(application: string): VisualSnapshot[] {
    const ids = this.snapshotsByApp.get(application) || [];
    return ids.map((id) => this.snapshots.get(id)).filter((s): s is VisualSnapshot => !!s);
  }

  /**
   * Get all patterns
   */
  getPatterns(): VisualPattern[] {
    return Array.from(this.patterns.values());
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalSnapshots: number;
    totalPatterns: number;
    snapshotsByApp: Record<string, number>;
    successStates: number;
  } {
    const snapshotsByApp: Record<string, number> = {};
    for (const [app, ids] of this.snapshotsByApp) {
      snapshotsByApp[app] = ids.length;
    }

    const successStates = Array.from(this.snapshots.values()).filter((s) => s.successState).length;

    return {
      totalSnapshots: this.snapshots.size,
      totalPatterns: this.patterns.size,
      snapshotsByApp,
      successStates,
    };
  }

  /**
   * Clear all memory
   */
  clear(): void {
    this.snapshots.clear();
    this.patterns.clear();
    this.snapshotsByApp.clear();
    this.previousState = null;
    this.scheduleSave();
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  private detectApplication(screenState: ScreenState): string {
    // Try to detect from title
    const title = screenState.title?.toLowerCase() || '';

    // Common application patterns
    if (title.includes('chrome') || title.includes('firefox') || title.includes('edge')) {
      return 'browser';
    }
    if (title.includes('code') || title.includes('visual studio')) {
      return 'vscode';
    }
    if (title.includes('terminal') || title.includes('cmd') || title.includes('powershell')) {
      return 'terminal';
    }
    if (title.includes('word') || title.includes('excel') || title.includes('powerpoint')) {
      return 'office';
    }

    return 'unknown';
  }

  private extractFeatureVector(screenState: ScreenState): number[] {
    const features: number[] = new Array(VISUAL_MEMORY_CONSTANTS.FEATURE_VECTOR_SIZE).fill(0);

    // Feature 1-10: Element type distribution
    const typeCounts: Record<string, number> = {};
    for (const element of screenState.elements) {
      typeCounts[element.type] = (typeCounts[element.type] || 0) + 1;
    }
    const totalElements = screenState.elements.length || 1;
    const types = ['button', 'input', 'link', 'text', 'icon', 'menu', 'window', 'unknown'];
    for (let i = 0; i < 8; i++) {
      features[i] = (typeCounts[types[i]] || 0) / totalElements;
    }

    // Feature 11-20: Position distribution (10 horizontal bins)
    const hBins = new Array(10).fill(0);
    for (const element of screenState.elements) {
      const bin = Math.min(9, Math.floor((element.bounds.x / screenState.dimensions.width) * 10));
      hBins[bin]++;
    }
    for (let i = 0; i < 10; i++) {
      features[10 + i] = hBins[i] / totalElements;
    }

    // Feature 21-30: Vertical distribution (10 bins)
    const vBins = new Array(10).fill(0);
    for (const element of screenState.elements) {
      const bin = Math.min(9, Math.floor((element.bounds.y / screenState.dimensions.height) * 10));
      vBins[bin]++;
    }
    for (let i = 0; i < 10; i++) {
      features[20 + i] = vBins[i] / totalElements;
    }

    // Feature 31-50: Interactive element distribution
    const interactiveH = new Array(10).fill(0);
    const interactiveV = new Array(10).fill(0);
    const interactiveCount = screenState.elements.filter((e) => e.isInteractive).length || 1;
    for (const element of screenState.elements.filter((e) => e.isInteractive)) {
      const hBin = Math.min(9, Math.floor((element.bounds.x / screenState.dimensions.width) * 10));
      const vBin = Math.min(9, Math.floor((element.bounds.y / screenState.dimensions.height) * 10));
      interactiveH[hBin]++;
      interactiveV[vBin]++;
    }
    for (let i = 0; i < 10; i++) {
      features[30 + i] = interactiveH[i] / interactiveCount;
      features[40 + i] = interactiveV[i] / interactiveCount;
    }

    // Feature 51-60: Size distribution
    const sizes = screenState.elements.map(
      (e) => (e.bounds.width * e.bounds.height) / (screenState.dimensions.width * screenState.dimensions.height),
    );
    const sizeHist = new Array(10).fill(0);
    for (const size of sizes) {
      const bin = Math.min(9, Math.floor(size * 100)); // 0-10% bins
      sizeHist[bin]++;
    }
    for (let i = 0; i < 10; i++) {
      features[50 + i] = sizeHist[i] / totalElements;
    }

    // Remaining features: text length, interactive ratio, etc.
    features[60] = Math.min(1, screenState.text.length / 10000);
    features[61] = screenState.elements.filter((e) => e.isInteractive).length / totalElements;
    features[62] = screenState.dimensions.width / 1920;
    features[63] = screenState.dimensions.height / 1080;

    return features;
  }

  private generateLayoutHash(screenState: ScreenState): string {
    const gridSize = VISUAL_MEMORY_CONSTANTS.LAYOUT_GRID_SIZE;
    const grid = new Array(gridSize * gridSize).fill(0);

    for (const element of screenState.elements) {
      const gridX = Math.floor((element.bounds.x / screenState.dimensions.width) * gridSize);
      const gridY = Math.floor((element.bounds.y / screenState.dimensions.height) * gridSize);
      const idx = Math.min(gridSize * gridSize - 1, gridY * gridSize + gridX);
      grid[idx]++;
    }

    // Simple hash
    return grid
      .map((c) => Math.min(9, c).toString())
      .join('')
      .replace(/0+$/, '');
  }

  private generateElementSignature(screenState: ScreenState): string {
    // Create a signature based on element types and approximate positions
    const sig = screenState.elements
      .slice(0, 20)
      .map((e) => {
        const posX = Math.floor((e.bounds.x / screenState.dimensions.width) * 10);
        const posY = Math.floor((e.bounds.y / screenState.dimensions.height) * 10);
        return `${e.type[0]}${posX}${posY}`;
      })
      .join('');
    return sig;
  }

  private extractRegions(screenState: ScreenState): SnapshotRegion[] {
    const regions: SnapshotRegion[] = [];

    // Divide screen into logical regions
    const { width, height } = screenState.dimensions;

    const regionDefs = [
      { name: 'header', bounds: { x: 0, y: 0, width, height: height * 0.1 } },
      { name: 'sidebar', bounds: { x: 0, y: height * 0.1, width: width * 0.2, height: height * 0.8 } },
      { name: 'main', bounds: { x: width * 0.2, y: height * 0.1, width: width * 0.8, height: height * 0.8 } },
      { name: 'footer', bounds: { x: 0, y: height * 0.9, width, height: height * 0.1 } },
    ];

    for (const def of regionDefs) {
      const elementsInRegion = screenState.elements.filter(
        (e) =>
          e.bounds.x >= def.bounds.x &&
          e.bounds.x < def.bounds.x + def.bounds.width &&
          e.bounds.y >= def.bounds.y &&
          e.bounds.y < def.bounds.y + def.bounds.height,
      );

      regions.push({
        name: def.name,
        bounds: def.bounds,
        hash: this.hashElements(elementsInRegion),
        elementCount: elementsInRegion.length,
        interactive: elementsInRegion.some((e) => e.isInteractive),
      });
    }

    return regions;
  }

  private hashElements(elements: UIElement[]): string {
    const content = elements
      .map((e) => `${e.type}-${e.text?.slice(0, 10) || ''}`)
      .join('|');
    // Simple hash
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      hash = (hash << 5) - hash + content.charCodeAt(i);
      hash |= 0;
    }
    return hash.toString(16);
  }

  private async generateThumbnail(screenshot: Buffer): Promise<string> {
    // For now, just base64 encode a portion
    // In production, would use sharp or similar to resize
    return screenshot.slice(0, 10000).toString('base64');
  }

  private storeSnapshot(snapshot: VisualSnapshot): void {
    this.snapshots.set(snapshot.id, snapshot);

    // Update app index
    if (!this.snapshotsByApp.has(snapshot.application)) {
      this.snapshotsByApp.set(snapshot.application, []);
    }
    this.snapshotsByApp.get(snapshot.application)!.push(snapshot.id);

    // Enforce limits
    this.enforceStorageLimits();
  }

  private enforceStorageLimits(): void {
    // Limit per app
    for (const [app, ids] of this.snapshotsByApp) {
      if (ids.length > VISUAL_MEMORY_CONSTANTS.MAX_SNAPSHOTS_PER_APP) {
        const toRemove = ids.slice(0, ids.length - VISUAL_MEMORY_CONSTANTS.MAX_SNAPSHOTS_PER_APP);
        for (const id of toRemove) {
          this.snapshots.delete(id);
        }
        this.snapshotsByApp.set(
          app,
          ids.slice(ids.length - VISUAL_MEMORY_CONSTANTS.MAX_SNAPSHOTS_PER_APP),
        );
      }
    }

    // Total limit
    if (this.snapshots.size > VISUAL_MEMORY_CONSTANTS.MAX_TOTAL_SNAPSHOTS) {
      const all = Array.from(this.snapshots.values()).sort((a, b) => a.timestamp - b.timestamp);
      const toRemove = all.slice(0, all.length - VISUAL_MEMORY_CONSTANTS.MAX_TOTAL_SNAPSHOTS);
      for (const snapshot of toRemove) {
        this.snapshots.delete(snapshot.id);
        const appIds = this.snapshotsByApp.get(snapshot.application);
        if (appIds) {
          const idx = appIds.indexOf(snapshot.id);
          if (idx >= 0) appIds.splice(idx, 1);
        }
      }
    }
  }

  private updatePatterns(snapshot: VisualSnapshot, screenState: ScreenState): void {
    // Find similar existing patterns
    for (const pattern of this.patterns.values()) {
      if (pattern.application !== snapshot.application) continue;

      const templateSnapshot = this.snapshots.get(pattern.templateId);
      if (!templateSnapshot) continue;

      const similarity = this.cosineSimilarity(snapshot.featureVector, templateSnapshot.featureVector);
      if (similarity >= VISUAL_MEMORY_CONSTANTS.SIMILARITY_THRESHOLD) {
        // Update existing pattern
        pattern.occurrences++;
        pattern.lastSeen = Date.now();
        this.patterns.set(pattern.id, pattern);
        return;
      }
    }

    // Check if this should become a new pattern
    const similarSnapshots = this.findSimilarSnapshots(snapshot);
    if (similarSnapshots.length >= VISUAL_MEMORY_CONSTANTS.PATTERN_MIN_OCCURRENCES - 1) {
      // Create new pattern
      const pattern: VisualPattern = {
        id: `pattern-${Date.now()}`,
        name: `${snapshot.application}-pattern-${this.patterns.size + 1}`,
        application: snapshot.application,
        occurrences: similarSnapshots.length + 1,
        lastSeen: Date.now(),
        firstSeen: Math.min(...similarSnapshots.map((s) => s.timestamp), snapshot.timestamp),
        templateId: snapshot.id,
        commonElements: this.findCommonElements(similarSnapshots, screenState),
        dynamicRegions: [],
        successRate: similarSnapshots.filter((s) => s.successState).length / similarSnapshots.length,
        effectiveActions: [],
      };

      this.patterns.set(pattern.id, pattern);
      logger.info('Created new visual pattern', { patternId: pattern.id, occurrences: pattern.occurrences });
    }
  }

  private findSimilarSnapshots(snapshot: VisualSnapshot): VisualSnapshot[] {
    const similar: VisualSnapshot[] = [];

    for (const other of this.snapshots.values()) {
      if (other.id === snapshot.id) continue;
      if (other.application !== snapshot.application) continue;

      const similarity = this.cosineSimilarity(snapshot.featureVector, other.featureVector);
      if (similarity >= VISUAL_MEMORY_CONSTANTS.SIMILARITY_THRESHOLD) {
        similar.push(other);
      }
    }

    return similar;
  }

  private findCommonElements(
    snapshots: VisualSnapshot[],
    currentState: ScreenState,
  ): ElementPattern[] {
    // Simplified: find elements that appear in similar positions
    const patterns: ElementPattern[] = [];

    for (const element of currentState.elements.slice(0, 10)) {
      patterns.push({
        selector: element.type,
        type: element.type,
        relativePosition: {
          x: element.bounds.x / currentState.dimensions.width,
          y: element.bounds.y / currentState.dimensions.height,
        },
        frequency: 1,
        variations: [],
      });
    }

    return patterns;
  }

  private findMatchingPattern(screenState: ScreenState): VisualPattern | undefined {
    const featureVector = this.extractFeatureVector(screenState);
    const application = this.detectApplication(screenState);

    let bestMatch: VisualPattern | undefined;
    let bestSimilarity = 0;

    for (const pattern of this.patterns.values()) {
      if (pattern.application !== application) continue;

      const templateSnapshot = this.snapshots.get(pattern.templateId);
      if (!templateSnapshot) continue;

      const similarity = this.cosineSimilarity(featureVector, templateSnapshot.featureVector);
      if (similarity > bestSimilarity && similarity >= VISUAL_MEMORY_CONSTANTS.SIMILARITY_THRESHOLD) {
        bestSimilarity = similarity;
        bestMatch = pattern;
      }
    }

    return bestMatch;
  }

  private compareLayouts(before: ScreenState, after: ScreenState): number {
    const beforeHash = this.generateLayoutHash(before);
    const afterHash = this.generateLayoutHash(after);

    if (beforeHash === afterHash) return 1;

    // Count matching characters
    const maxLen = Math.max(beforeHash.length, afterHash.length);
    let matches = 0;
    for (let i = 0; i < Math.min(beforeHash.length, afterHash.length); i++) {
      if (beforeHash[i] === afterHash[i]) matches++;
    }

    return matches / maxLen;
  }

  private compareElements(before: ScreenState, after: ScreenState): number {
    const beforeSig = this.generateElementSignature(before);
    const afterSig = this.generateElementSignature(after);

    if (beforeSig === afterSig) return 1;

    // Jaccard similarity of element types
    const beforeTypes = new Set(before.elements.map((e) => e.type));
    const afterTypes = new Set(after.elements.map((e) => e.type));

    const intersection = new Set([...beforeTypes].filter((t) => afterTypes.has(t)));
    const union = new Set([...beforeTypes, ...afterTypes]);

    return intersection.size / union.size;
  }

  private detectChangedRegions(before: ScreenState, after: ScreenState): ChangedRegion[] {
    const changed: ChangedRegion[] = [];
    const beforeRegions = this.extractRegions(before);
    const afterRegions = this.extractRegions(after);

    for (let i = 0; i < beforeRegions.length; i++) {
      const bRegion = beforeRegions[i];
      const aRegion = afterRegions[i];

      if (bRegion.hash !== aRegion.hash) {
        const countDiff = aRegion.elementCount - bRegion.elementCount;
        changed.push({
          name: bRegion.name,
          bounds: bRegion.bounds,
          changeType: countDiff > 0 ? 'added' : countDiff < 0 ? 'removed' : 'modified',
          confidence: 0.8,
        });
      }
    }

    return changed;
  }

  private findNewElements(before: UIElement[], after: UIElement[]): EnhancedUIElement[] {
    const beforeSet = new Set(before.map((e) => `${e.type}-${e.bounds.x}-${e.bounds.y}`));
    return after
      .filter((e) => !beforeSet.has(`${e.type}-${e.bounds.x}-${e.bounds.y}`))
      .map((e, i) => ({
        ...e,
        id: `new-${i}`,
        semanticRole: e.type,
        relatedElements: [],
        interactions: [],
        lastSeen: Date.now(),
        seenCount: 1,
      }));
  }

  private findRemovedElements(before: UIElement[], after: UIElement[]): EnhancedUIElement[] {
    const afterSet = new Set(after.map((e) => `${e.type}-${e.bounds.x}-${e.bounds.y}`));
    return before
      .filter((e) => !afterSet.has(`${e.type}-${e.bounds.x}-${e.bounds.y}`))
      .map((e, i) => ({
        ...e,
        id: `removed-${i}`,
        semanticRole: e.type,
        relatedElements: [],
        interactions: [],
        lastSeen: Date.now(),
        seenCount: 1,
      }));
  }

  private detectSuccessIndicators(screenState: ScreenState): string[] {
    const indicators: string[] = [];
    const text = screenState.text.toLowerCase();

    const successPatterns = [
      'success',
      'completed',
      'done',
      'saved',
      'thank you',
      'confirmed',
      'uploaded',
      'sent',
      'submitted',
    ];

    for (const pattern of successPatterns) {
      if (text.includes(pattern)) {
        indicators.push(`Text contains "${pattern}"`);
      }
    }

    return indicators;
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude > 0 ? dotProduct / magnitude : 0;
  }

  private saveTimeout: NodeJS.Timeout | null = null;
  private scheduleSave(): void {
    if (this.saveTimeout) return;
    this.saveTimeout = setTimeout(() => {
      this.saveToDisk().catch((e) => logger.error('Failed to save visual memory', { error: e }));
      this.saveTimeout = null;
    }, 5000);
  }

  private async saveToDisk(): Promise<void> {
    const filePath = path.join(this.dataDir, VISUAL_MEMORY_CONSTANTS.MEMORY_FILE);

    const data = {
      snapshots: Array.from(this.snapshots.entries()),
      patterns: Array.from(this.patterns.entries()),
      snapshotsByApp: Array.from(this.snapshotsByApp.entries()),
    };

    await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2));
    logger.debug('Visual memory saved', { snapshots: this.snapshots.size });
  }

  private async loadFromDisk(): Promise<void> {
    const filePath = path.join(this.dataDir, VISUAL_MEMORY_CONSTANTS.MEMORY_FILE);

    if (!fs.existsSync(filePath)) return;

    const content = await fs.promises.readFile(filePath, 'utf-8');
    const data = JSON.parse(content) as {
      snapshots: Array<[string, VisualSnapshot]>;
      patterns: Array<[string, VisualPattern]>;
      snapshotsByApp: Array<[string, string[]]>;
    };

    this.snapshots = new Map(data.snapshots);
    this.patterns = new Map(data.patterns);
    this.snapshotsByApp = new Map(data.snapshotsByApp);
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let visualMemoryInstance: VisualMemoryManager | null = null;

/**
 * Get the singleton visual memory instance
 */
export function getVisualMemory(): VisualMemoryManager {
  if (!visualMemoryInstance) {
    visualMemoryInstance = new VisualMemoryManager();
  }
  return visualMemoryInstance;
}

/**
 * Reset visual memory (for testing)
 */
export function resetVisualMemory(): void {
  if (visualMemoryInstance) {
    visualMemoryInstance.clear();
    visualMemoryInstance = null;
  }
}
