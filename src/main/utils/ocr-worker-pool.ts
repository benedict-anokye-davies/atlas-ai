/**
 * Atlas Desktop - Shared OCR Worker Pool
 * 
 * Singleton Tesseract.js worker pool to avoid creating multiple workers
 * across screen-monitor.ts and screen-vision.ts. Includes throttled logging
 * to prevent debug log flooding.
 * 
 * NOTE: tesseract.js v5 uses Web Workers which have compatibility issues
 * with Electron's main process. OCR is currently disabled to prevent crashes.
 * Will be re-enabled when using a worker thread solution.
 * 
 * @module utils/ocr-worker-pool
 */

import { createModuleLogger } from './logger';

const logger = createModuleLogger('OCRWorkerPool');

// Flag to enable/disable OCR - disabled due to tesseract.js v5 Worker issues in Electron
const OCR_ENABLED = false;

// ============================================================================
// Types
// ============================================================================

export interface OCRResult {
  text: string;
  confidence: number;
  words?: Array<{
    text: string;
    confidence: number;
    bbox: { x0: number; y0: number; x1: number; y1: number };
  }>;
}

export interface OCRWorkerPoolConfig {
  /** Maximum number of workers in the pool */
  maxWorkers: number;
  /** Languages to support */
  languages: string[];
  /** Enable progress logging (throttled) */
  enableProgressLogging: boolean;
}

const DEFAULT_CONFIG: OCRWorkerPoolConfig = {
  maxWorkers: 1,
  languages: ['eng'],
  enableProgressLogging: false,
};

// Placeholder Worker type since we're not importing tesseract.js
type Worker = unknown;

// ============================================================================
// OCR Worker Pool
// ============================================================================

class OCRWorkerPool {
  private workers: Worker[] = [];
  private availableWorkers: Worker[] = [];
  private pendingRequests: Array<{
    resolve: (worker: Worker) => void;
    reject: (error: Error) => void;
  }> = [];
  private config: OCRWorkerPoolConfig;
  private initialized = false;
  private initializing = false;

  constructor(config?: Partial<OCRWorkerPoolConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize the worker pool
   * Currently disabled due to tesseract.js v5 compatibility issues
   */
  async initialize(): Promise<void> {
    if (this.initialized || this.initializing) {
      return;
    }

    this.initializing = true;

    // OCR is disabled - just mark as initialized without creating workers
    if (!OCR_ENABLED) {
      logger.info('OCR disabled - tesseract.js v5 has compatibility issues with Electron main process');
      this.initialized = true;
      this.initializing = false;
      return;
    }

    // OCR is disabled at compile time - this code will never run
    // but we keep it for when OCR is re-enabled with a worker thread solution
    throw new Error('OCR is disabled. Set OCR_ENABLED = true to enable.');

    /* 
    // DISABLED: tesseract.js v5 Worker crashes in Electron main process
    // This code is preserved for when we implement a worker thread solution
    try {
      logger.info('Initializing OCR worker pool', {
        maxWorkers: this.config.maxWorkers,
        languages: this.config.languages,
      });

      // Dynamic import to avoid loading tesseract.js when disabled
      const { createWorker } = await import('tesseract.js');

      for (let i = 0; i < this.config.maxWorkers; i++) {
        try {
          const worker = await createWorker(this.config.languages.join('+'));
          this.workers.push(worker);
          this.availableWorkers.push(worker);
        } catch (workerError) {
          logger.warn('Failed to create OCR worker', { error: workerError });
        }
      }

      this.initialized = true;
      this.initializing = false;
      
      if (this.workers.length > 0) {
        logger.info('OCR worker pool initialized', { workerCount: this.workers.length });
      } else {
        logger.warn('OCR worker pool initialized with no workers - OCR unavailable');
      }
    } catch (error) {
      this.initializing = false;
      logger.warn('OCR initialization failed - feature disabled', { error });
      this.initialized = true;
    }
    */
  }

  /**
   * Check if OCR is available
   */
  isAvailable(): boolean {
    return OCR_ENABLED && this.initialized && this.workers.length > 0;
  }

  /**
   * Acquire a worker from the pool
   */
  private async acquireWorker(): Promise<Worker | null> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (this.workers.length === 0) {
      return null;
    }

    if (this.availableWorkers.length > 0) {
      return this.availableWorkers.pop()!;
    }

    return new Promise((resolve, reject) => {
      this.pendingRequests.push({ resolve: resolve as (worker: Worker) => void, reject });
    });
  }

  /**
   * Release a worker back to the pool
   */
  private releaseWorker(worker: Worker): void {
    if (this.pendingRequests.length > 0) {
      const request = this.pendingRequests.shift()!;
      request.resolve(worker);
      return;
    }
    this.availableWorkers.push(worker);
  }

  /**
   * Perform OCR on an image buffer
   * Returns empty result if OCR is disabled
   */
  async recognize(imageBuffer: Buffer): Promise<OCRResult> {
    // Return empty result if OCR is disabled
    if (!OCR_ENABLED) {
      return { text: '', confidence: 0, words: [] };
    }

    const worker = await this.acquireWorker();

    if (!worker) {
      return { text: '', confidence: 0, words: [] };
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (worker as any).recognize(imageBuffer);
      
      return {
        text: result.data.text,
        confidence: result.data.confidence,
        words: result.data.words?.map((w: { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }) => ({
          text: w.text,
          confidence: w.confidence,
          bbox: w.bbox,
        })),
      };
    } finally {
      this.releaseWorker(worker);
    }
  }

  /**
   * Get a worker for direct use (caller must release)
   * Returns null if OCR is disabled
   */
  async getWorker(): Promise<{ worker: Worker; release: () => void } | null> {
    if (!OCR_ENABLED) {
      return null;
    }

    const worker = await this.acquireWorker();
    
    if (!worker) {
      return null;
    }
    
    return {
      worker,
      release: () => this.releaseWorker(worker),
    };
  }

  /**
   * Get pool statistics
   */
  getStats(): {
    totalWorkers: number;
    availableWorkers: number;
    pendingRequests: number;
    initialized: boolean;
    enabled: boolean;
  } {
    return {
      totalWorkers: this.workers.length,
      availableWorkers: this.availableWorkers.length,
      pendingRequests: this.pendingRequests.length,
      initialized: this.initialized,
      enabled: OCR_ENABLED,
    };
  }

  /**
   * Shutdown the worker pool
   */
  async shutdown(): Promise<void> {
    if (!OCR_ENABLED || this.workers.length === 0) {
      this.initialized = false;
      return;
    }

    logger.info('Shutting down OCR worker pool');

    for (const request of this.pendingRequests) {
      request.reject(new Error('OCR worker pool shutting down'));
    }
    this.pendingRequests = [];

    for (const worker of this.workers) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (worker as any).terminate();
      } catch (error) {
        logger.warn('Error terminating OCR worker', { error });
      }
    }

    this.workers = [];
    this.availableWorkers = [];
    this.initialized = false;

    logger.info('OCR worker pool shut down');
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let ocrWorkerPool: OCRWorkerPool | null = null;

/**
 * Get the shared OCR worker pool instance
 */
export function getOCRWorkerPool(config?: Partial<OCRWorkerPoolConfig>): OCRWorkerPool {
  if (!ocrWorkerPool) {
    ocrWorkerPool = new OCRWorkerPool(config);
  }
  return ocrWorkerPool;
}

/**
 * Shutdown the OCR worker pool
 */
export async function shutdownOCRWorkerPool(): Promise<void> {
  if (ocrWorkerPool) {
    await ocrWorkerPool.shutdown();
    ocrWorkerPool = null;
  }
}

export { OCRWorkerPool };
