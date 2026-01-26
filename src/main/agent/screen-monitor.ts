/**
 * Atlas Desktop - Continuous Screen Monitor
 * 
 * Always-on screen watching that:
 * - Monitors terminal output for errors
 * - Watches browser for console errors/crashes
 * - Detects failing tests in real-time
 * - Spots lint/build errors as you code
 * - Proactively suggests fixes
 * 
 * @module agent/screen-monitor
 */

import { EventEmitter } from 'events';
import * as path from 'path';
import { desktopCapturer, screen, BrowserWindow, app } from 'electron';
import { createModuleLogger } from '../utils/logger';
import { getOCRWorkerPool, shutdownOCRWorkerPool, OCRWorkerPool } from '../utils/ocr-worker-pool';
import * as fs from 'fs/promises';

const logger = createModuleLogger('ScreenMonitor');

// ============================================================================
// Types
// ============================================================================

export type ErrorSeverity = 'info' | 'warning' | 'error' | 'critical';
export type ErrorSource = 'terminal' | 'browser' | 'ide' | 'build' | 'test' | 'unknown';

export interface DetectedError {
  id: string;
  timestamp: number;
  severity: ErrorSeverity;
  source: ErrorSource;
  message: string;
  fullText: string;
  filePath?: string;
  lineNumber?: number;
  columnNumber?: number;
  suggestion?: string;
  canAutoFix: boolean;
  context: ScreenRegion;
}

export interface ScreenRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  windowTitle: string;
}

export interface MonitorConfig {
  /** Enable/disable monitoring */
  enabled: boolean;
  
  /** How often to check screen (ms) */
  pollInterval: number;
  
  /** Which regions to monitor */
  regions: MonitorRegionConfig[];
  
  /** Error patterns to detect */
  errorPatterns: ErrorPattern[];
  
  /** Callback when error detected */
  onError?: (error: DetectedError) => void;
  
  /** Auto-capture screenshots on error */
  captureOnError: boolean;
  
  /** Directory to save screenshots */
  screenshotDir: string;
}

export interface MonitorRegionConfig {
  name: string;
  type: 'fullscreen' | 'window' | 'region';
  windowTitleMatch?: RegExp;
  bounds?: { x: number; y: number; width: number; height: number };
  enabled: boolean;
}

export interface ErrorPattern {
  name: string;
  pattern: RegExp;
  severity: ErrorSeverity;
  source: ErrorSource;
  canAutoFix: boolean;
  suggestion?: string;
  extractInfo?: (match: RegExpMatchArray) => Partial<DetectedError>;
}

// ============================================================================
// Default Error Patterns
// ============================================================================

const DEFAULT_ERROR_PATTERNS: ErrorPattern[] = [
  // Terminal/Console Errors
  {
    name: 'node_error',
    pattern: /(?:Error|TypeError|ReferenceError|SyntaxError):\s*(.+?)(?:\n|$)/gi,
    severity: 'error',
    source: 'terminal',
    canAutoFix: true,
    extractInfo: (match) => ({ message: match[1] }),
  },
  {
    name: 'npm_error',
    pattern: /npm\s+(?:ERR|error)!\s*(.+)/gi,
    severity: 'error',
    source: 'terminal',
    canAutoFix: true,
    suggestion: 'Check package.json and node_modules',
  },
  {
    name: 'module_not_found',
    pattern: /Cannot\s+find\s+module\s+['"]([^'"]+)['"]/gi,
    severity: 'error',
    source: 'terminal',
    canAutoFix: true,
    suggestion: 'npm install the missing package',
    extractInfo: (match) => ({ message: `Missing module: ${match[1]}` }),
  },
  {
    name: 'typescript_error',
    pattern: /(?:TS\d+|error\s+TS\d+):\s*(.+?)(?:\n|$)/gi,
    severity: 'error',
    source: 'build',
    canAutoFix: true,
    suggestion: 'Fix TypeScript type error',
  },
  {
    name: 'eslint_error',
    pattern: /(?:\d+:\d+)\s+error\s+(.+?)\s+[\w\-\/]+$/gim,
    severity: 'warning',
    source: 'build',
    canAutoFix: true,
    suggestion: 'Run eslint --fix',
  },
  
  // Test Failures
  {
    name: 'jest_fail',
    pattern: /(?:FAIL|✕|×)\s+(.+\.(?:test|spec)\.[jt]sx?)/gi,
    severity: 'error',
    source: 'test',
    canAutoFix: false,
    extractInfo: (match) => ({ filePath: match[1] }),
  },
  {
    name: 'assertion_error',
    pattern: /(?:AssertionError|expect\(.*\)\.to)/gi,
    severity: 'error',
    source: 'test',
    canAutoFix: false,
  },
  
  // Build Errors
  {
    name: 'webpack_error',
    pattern: /ERROR\s+in\s+(.+?\.[jt]sx?)\s*\n\s*(.+)/gi,
    severity: 'error',
    source: 'build',
    canAutoFix: true,
    extractInfo: (match) => ({ filePath: match[1], message: match[2] }),
  },
  {
    name: 'vite_error',
    pattern: /\[vite\]\s+(?:Error|error):\s*(.+)/gi,
    severity: 'error',
    source: 'build',
    canAutoFix: true,
  },
  {
    name: 'build_failed',
    pattern: /(?:Build|Compilation)\s+(?:failed|error)/gi,
    severity: 'critical',
    source: 'build',
    canAutoFix: false,
  },
  
  // Browser Console
  {
    name: 'uncaught_error',
    pattern: /Uncaught\s+(?:Error|TypeError|ReferenceError):\s*(.+)/gi,
    severity: 'error',
    source: 'browser',
    canAutoFix: true,
  },
  {
    name: 'react_error',
    pattern: /(?:React|Warning):\s*(.+?)(?:\n|$)/gi,
    severity: 'warning',
    source: 'browser',
    canAutoFix: false,
  },
  {
    name: 'hydration_error',
    pattern: /Hydration\s+failed|Text\s+content\s+does\s+not\s+match/gi,
    severity: 'error',
    source: 'browser',
    canAutoFix: true,
    suggestion: 'Server/client mismatch - check useEffect usage',
  },
  
  // Git Conflicts
  {
    name: 'merge_conflict',
    pattern: /<<<<<<<\s+HEAD|=======|>>>>>>>/g,
    severity: 'critical',
    source: 'ide',
    canAutoFix: false,
    suggestion: 'Resolve merge conflict manually',
  },
  
  // File Path Patterns (to extract location)
  {
    name: 'file_reference',
    pattern: /(?:at\s+)?([\/\\]?[\w\-\.\/\\]+\.[jt]sx?):(\d+)(?::(\d+))?/gi,
    severity: 'info',
    source: 'unknown',
    canAutoFix: false,
    extractInfo: (match) => ({
      filePath: match[1],
      lineNumber: parseInt(match[2], 10),
      columnNumber: match[3] ? parseInt(match[3], 10) : undefined,
    }),
  },
];

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: MonitorConfig = {
  enabled: true,
  pollInterval: 3000, // 3 seconds
  regions: [
    { name: 'Primary Screen', type: 'fullscreen', enabled: true },
    { name: 'VS Code', type: 'window', windowTitleMatch: /visual studio code/i, enabled: true },
    { name: 'Terminal', type: 'window', windowTitleMatch: /terminal|powershell|cmd|bash/i, enabled: true },
    { name: 'Browser', type: 'window', windowTitleMatch: /chrome|firefox|edge|safari/i, enabled: true },
  ],
  errorPatterns: DEFAULT_ERROR_PATTERNS,
  captureOnError: true,
  screenshotDir: path.join(process.cwd(), '.atlas', 'screenshots'),
};

// ============================================================================
// Screen Monitor Class
// ============================================================================

export class ContinuousScreenMonitor extends EventEmitter {
  private config: MonitorConfig;
  private isRunning: boolean = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private ocrWorkerPool: OCRWorkerPool | null = null;
  private detectedErrors: Map<string, DetectedError> = new Map();
  private lastScreenText: string = '';
  private errorCooldown: Map<string, number> = new Map(); // Prevent spam
  
  constructor(config?: Partial<MonitorConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  // ==========================================================================
  // Lifecycle
  // ==========================================================================
  
  async start(): Promise<void> {
    if (this.isRunning) return;
    
    logger.info('Starting Continuous Screen Monitor');
    
    // Initialize OCR
    await this.initializeOCR();
    
    // Create screenshot directory
    await fs.mkdir(this.config.screenshotDir, { recursive: true });
    
    this.isRunning = true;
    this.startPolling();
    
    this.emit('started');
    logger.info('Screen Monitor started', { interval: this.config.pollInterval });
  }
  
  async stop(): Promise<void> {
    if (!this.isRunning) return;
    
    this.stopPolling();
    
    // Don't shutdown the shared pool, just release reference
    this.ocrWorkerPool = null;
    
    this.isRunning = false;
    this.emit('stopped');
    logger.info('Screen Monitor stopped');
  }
  
  private async initializeOCR(): Promise<void> {
    try {
      // Use shared OCR worker pool (prevents duplicate workers and log flooding)
      this.ocrWorkerPool = getOCRWorkerPool({
        maxWorkers: 1,
        enableProgressLogging: false, // Disable to prevent log flooding
      });
      await this.ocrWorkerPool.initialize();
      logger.info('OCR worker pool initialized for ScreenMonitor');
    } catch (error) {
      logger.warn('Failed to initialize OCR - screen monitoring will continue without OCR', { error });
      // Don't throw - OCR is optional, screen monitoring can work without it
    }
  }
  
  // ==========================================================================
  // Polling
  // ==========================================================================
  
  private startPolling(): void {
    if (this.pollTimer) return;
    
    // Immediate first check
    this.performCheck();
    
    this.pollTimer = setInterval(() => {
      this.performCheck();
    }, this.config.pollInterval);
  }
  
  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
  
  // ==========================================================================
  // Screen Capture & Analysis
  // ==========================================================================
  
  private async performCheck(): Promise<void> {
    if (!this.config.enabled) return;
    
    try {
      const enabledRegions = this.config.regions.filter(r => r.enabled);
      
      for (const region of enabledRegions) {
        await this.checkRegion(region);
      }
    } catch (error) {
      logger.debug('Screen check failed', { error });
    }
  }
  
  private async checkRegion(region: MonitorRegionConfig): Promise<void> {
    try {
      // Capture screen
      const sources = await desktopCapturer.getSources({
        types: region.type === 'window' ? ['window'] : ['screen'],
        thumbnailSize: { width: 1920, height: 1080 },
      });
      
      // Find matching source
      let source = sources[0];
      if (region.windowTitleMatch) {
        const matched = sources.find(s => region.windowTitleMatch!.test(s.name));
        if (matched) source = matched;
        else return; // Window not found
      }
      
      if (!source) return;
      
      // Get thumbnail as buffer
      const thumbnail = source.thumbnail;
      const imageBuffer = thumbnail.toPNG();
      
      // OCR to extract text using shared pool
      if (!this.ocrWorkerPool) return;
      
      const ocrResult = await this.ocrWorkerPool.recognize(imageBuffer);
      const text = ocrResult.text;
      
      // Only process if text changed significantly
      if (this.isSimilarText(text, this.lastScreenText)) return;
      this.lastScreenText = text;
      
      // Check for error patterns
      const errors = this.detectErrors(text, {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        windowTitle: source.name,
      });
      
      // Process detected errors
      for (const error of errors) {
        await this.handleDetectedError(error, imageBuffer);
      }
      
    } catch (error) {
      logger.debug('Region check failed', { region: region.name, error });
    }
  }
  
  private isSimilarText(text1: string, text2: string): boolean {
    // Simple similarity check - if 80% same, consider similar
    const words1 = new Set(text1.toLowerCase().split(/\s+/));
    const words2 = new Set(text2.toLowerCase().split(/\s+/));
    
    let common = 0;
    for (const word of words1) {
      if (words2.has(word)) common++;
    }
    
    const similarity = common / Math.max(words1.size, words2.size);
    return similarity > 0.8;
  }
  
  // ==========================================================================
  // Error Detection
  // ==========================================================================
  
  private detectErrors(text: string, context: ScreenRegion): DetectedError[] {
    const errors: DetectedError[] = [];
    
    for (const pattern of this.config.errorPatterns) {
      // Reset regex state
      pattern.pattern.lastIndex = 0;
      
      let match: RegExpExecArray | null;
      while ((match = pattern.pattern.exec(text)) !== null) {
        // Check cooldown to prevent spam
        const errorKey = `${pattern.name}:${match[0].slice(0, 50)}`;
        const lastSeen = this.errorCooldown.get(errorKey) || 0;
        const now = Date.now();
        
        if (now - lastSeen < 30000) continue; // 30 second cooldown per unique error
        
        this.errorCooldown.set(errorKey, now);
        
        // Extract additional info if available
        const extraInfo = pattern.extractInfo ? pattern.extractInfo(match) : {};
        
        const error: DetectedError = {
          id: `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          timestamp: now,
          severity: pattern.severity,
          source: pattern.source,
          message: extraInfo.message || match[1] || match[0],
          fullText: match[0],
          suggestion: pattern.suggestion,
          canAutoFix: pattern.canAutoFix,
          context,
          ...extraInfo,
        };
        
        errors.push(error);
      }
    }
    
    return errors;
  }
  
  private async handleDetectedError(
    error: DetectedError,
    screenshot?: Buffer
  ): Promise<void> {
    // Check if we already reported this error recently
    const existingKey = this.getErrorKey(error);
    if (this.detectedErrors.has(existingKey)) return;
    
    // Store error
    this.detectedErrors.set(existingKey, error);
    
    // Save screenshot if enabled
    if (this.config.captureOnError && screenshot) {
      const filename = `error_${error.timestamp}_${error.id}.png`;
      const filepath = path.join(this.config.screenshotDir, filename);
      await fs.writeFile(filepath, screenshot);
      logger.info('Saved error screenshot', { filepath });
    }
    
    // Emit event
    this.emit('errorDetected', error);
    
    // Call callback if provided
    if (this.config.onError) {
      this.config.onError(error);
    }
    
    logger.info('Error detected', {
      severity: error.severity,
      source: error.source,
      message: error.message.slice(0, 100),
    });
    
    // Clean up old errors (keep last 100)
    if (this.detectedErrors.size > 100) {
      const oldestKey = this.detectedErrors.keys().next().value;
      if (oldestKey) {
        this.detectedErrors.delete(oldestKey);
      }
    }
  }
  
  private getErrorKey(error: DetectedError): string {
    return `${error.source}:${error.message.slice(0, 100)}`;
  }
  
  // ==========================================================================
  // Public API
  // ==========================================================================
  
  /** Add a custom error pattern */
  addErrorPattern(pattern: ErrorPattern): void {
    this.config.errorPatterns.push(pattern);
  }
  
  /** Remove an error pattern by name */
  removeErrorPattern(name: string): void {
    this.config.errorPatterns = this.config.errorPatterns.filter(p => p.name !== name);
  }
  
  /** Get all detected errors */
  getDetectedErrors(): DetectedError[] {
    return Array.from(this.detectedErrors.values());
  }
  
  /** Get recent errors by severity */
  getErrorsBySeverity(severity: ErrorSeverity): DetectedError[] {
    return this.getDetectedErrors().filter(e => e.severity === severity);
  }
  
  /** Clear detected errors */
  clearErrors(): void {
    this.detectedErrors.clear();
    this.emit('errorsCleared');
  }
  
  /** Pause monitoring */
  pause(): void {
    this.config.enabled = false;
    this.emit('paused');
  }
  
  /** Resume monitoring */
  resume(): void {
    this.config.enabled = true;
    this.emit('resumed');
  }
  
  /** Set poll interval */
  setPollInterval(ms: number): void {
    this.config.pollInterval = ms;
    if (this.isRunning) {
      this.stopPolling();
      this.startPolling();
    }
  }
  
  /** Manually trigger a check */
  async manualCheck(): Promise<DetectedError[]> {
    const beforeCount = this.detectedErrors.size;
    await this.performCheck();
    
    // Return newly detected errors
    const allErrors = this.getDetectedErrors();
    return allErrors.slice(beforeCount);
  }
  
  /** Get status */
  getStatus(): {
    isRunning: boolean;
    enabled: boolean;
    pollInterval: number;
    errorCount: number;
    lastCheck: number;
  } {
    return {
      isRunning: this.isRunning,
      enabled: this.config.enabled,
      pollInterval: this.config.pollInterval,
      errorCount: this.detectedErrors.size,
      lastCheck: Date.now(),
    };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: ContinuousScreenMonitor | null = null;

export function getScreenMonitor(): ContinuousScreenMonitor {
  if (!instance) {
    instance = new ContinuousScreenMonitor();
  }
  return instance;
}

export async function startScreenMonitor(
  config?: Partial<MonitorConfig>
): Promise<ContinuousScreenMonitor> {
  if (instance) {
    await instance.stop();
  }
  instance = new ContinuousScreenMonitor(config);
  await instance.start();
  return instance;
}

export async function stopScreenMonitor(): Promise<void> {
  if (instance) {
    await instance.stop();
    instance = null;
  }
}

export default {
  ContinuousScreenMonitor,
  getScreenMonitor,
  startScreenMonitor,
  stopScreenMonitor,
};
