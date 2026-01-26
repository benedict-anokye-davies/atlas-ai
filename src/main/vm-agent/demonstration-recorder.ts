/**
 * Atlas Desktop - Demonstration Recorder
 *
 * Records human demonstrations for imitation learning.
 * Captures screen states and actions to teach Atlas new behaviors.
 *
 * @module vm-agent/demonstration-recorder
 */

import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';
import { createModuleLogger } from '../utils/logger';
import { VMConnector } from './vm-connector';
import { ScreenUnderstanding } from './screen-understanding';
import {
  Demonstration,
  RecordedAction,
  ScreenState,
  VMAction,
} from './types';
import { v4 as uuidv4 } from 'uuid';

const logger = createModuleLogger('DemonstrationRecorder');

// =============================================================================
// Constants
// =============================================================================

const DEMONSTRATIONS_DIR = 'vm-agent/demonstrations';
const CAPTURE_INTERVAL_MS = 100;

// =============================================================================
// Demonstration Recorder Class
// =============================================================================

/**
 * Records human demonstrations for teaching Atlas
 */
export class DemonstrationRecorder extends EventEmitter {
  private connector: VMConnector;
  private understanding: ScreenUnderstanding;
  private recording: boolean = false;
  private currentDemo: Partial<Demonstration> | null = null;
  private actions: RecordedAction[] = [];
  private lastState: ScreenState | null = null;
  private captureTimer: NodeJS.Timeout | null = null;
  private storageDir: string;

  constructor(connector: VMConnector, understanding: ScreenUnderstanding) {
    super();
    this.connector = connector;
    this.understanding = understanding;
    this.storageDir = path.join(app.getPath('userData'), DEMONSTRATIONS_DIR);
  }

  /**
   * Start recording a demonstration
   */
  async startRecording(name: string, description: string, category: string): Promise<void> {
    if (this.recording) {
      throw new Error('Already recording a demonstration');
    }

    // Ensure storage directory exists
    await fs.mkdir(this.storageDir, { recursive: true });

    // Capture initial state
    const screenshot = await this.connector.captureScreen();
    if (!screenshot) {
      throw new Error('Failed to capture initial screen state');
    }

    this.lastState = await this.understanding.analyzeScreen(screenshot);

    // Initialize demo
    this.currentDemo = {
      id: uuidv4(),
      name,
      description,
      category,
      actions: [],
      initialState: this.lastState,
      successful: false,
      totalDurationMs: 0,
      createdAt: Date.now(),
      tags: [],
    };

    this.actions = [];
    this.recording = true;

    // Start continuous capture for detecting changes
    this.captureTimer = setInterval(() => this.captureState(), CAPTURE_INTERVAL_MS);

    logger.info('Started recording demonstration', { name, category });
    this.emit('recordingStarted', this.currentDemo);
  }

  /**
   * Record an action during the demonstration
   */
  async recordAction(action: VMAction, intent?: string): Promise<void> {
    if (!this.recording || !this.lastState) {
      throw new Error('Not recording');
    }

    const stateBefore = this.lastState;
    const startTime = Date.now();

    // Execute the action
    const result = await this.connector.executeAction(action);

    // Wait a bit for screen to update
    await this.sleep(200);

    // Capture state after action
    const screenshot = await this.connector.captureScreen();
    const stateAfter = screenshot 
      ? await this.understanding.analyzeScreen(screenshot)
      : stateBefore;

    const recordedAction: RecordedAction = {
      id: uuidv4(),
      action,
      stateBefore,
      stateAfter,
      intent,
      success: result.success,
      timestamp: startTime,
      durationMs: Date.now() - startTime,
    };

    this.actions.push(recordedAction);
    this.lastState = stateAfter;

    logger.debug('Recorded action', { action: action.type, success: result.success });
    this.emit('actionRecorded', recordedAction);
  }

  /**
   * Stop recording and save the demonstration
   */
  async stopRecording(successful: boolean): Promise<Demonstration> {
    if (!this.recording || !this.currentDemo) {
      throw new Error('Not recording');
    }

    // Stop capture timer
    if (this.captureTimer) {
      clearInterval(this.captureTimer);
      this.captureTimer = null;
    }

    // Capture final state
    const screenshot = await this.connector.captureScreen();
    const finalState = screenshot 
      ? await this.understanding.analyzeScreen(screenshot)
      : this.lastState!;

    // Complete the demonstration
    const demo: Demonstration = {
      ...this.currentDemo as Demonstration,
      actions: this.actions,
      finalState,
      successful,
      totalDurationMs: Date.now() - this.currentDemo.createdAt!,
    };

    // Save to disk
    await this.saveDemonstration(demo);

    // Reset state
    this.recording = false;
    this.currentDemo = null;
    this.actions = [];
    this.lastState = null;

    logger.info('Stopped recording demonstration', { 
      name: demo.name, 
      successful, 
      actions: demo.actions.length 
    });
    this.emit('recordingStopped', demo);

    return demo;
  }

  /**
   * Cancel the current recording
   */
  cancelRecording(): void {
    if (!this.recording) return;

    if (this.captureTimer) {
      clearInterval(this.captureTimer);
      this.captureTimer = null;
    }

    this.recording = false;
    this.currentDemo = null;
    this.actions = [];
    this.lastState = null;

    logger.info('Recording cancelled');
    this.emit('recordingCancelled');
  }

  /**
   * Check if currently recording
   */
  isRecording(): boolean {
    return this.recording;
  }

  /**
   * Get current recording progress
   */
  getProgress(): { actionsRecorded: number; durationMs: number } | null {
    if (!this.recording || !this.currentDemo) return null;

    return {
      actionsRecorded: this.actions.length,
      durationMs: Date.now() - this.currentDemo.createdAt!,
    };
  }

  /**
   * Load all saved demonstrations
   */
  async loadDemonstrations(): Promise<Demonstration[]> {
    const demos: Demonstration[] = [];

    try {
      const files = await fs.readdir(this.storageDir);
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const content = await fs.readFile(path.join(this.storageDir, file), 'utf-8');
            const demo = JSON.parse(content) as Demonstration;
            demos.push(demo);
          } catch (error) {
            logger.warn('Failed to load demonstration', { file, error: (error as Error).message });
          }
        }
      }
    } catch (error) {
      logger.debug('No demonstrations found', { error: (error as Error).message });
    }

    return demos.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Load a specific demonstration
   */
  async loadDemonstration(id: string): Promise<Demonstration | null> {
    try {
      const filePath = path.join(this.storageDir, `${id}.json`);
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content) as Demonstration;
    } catch {
      return null;
    }
  }

  /**
   * Delete a demonstration
   */
  async deleteDemonstration(id: string): Promise<boolean> {
    try {
      const filePath = path.join(this.storageDir, `${id}.json`);
      await fs.unlink(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get demonstrations by category
   */
  async getDemonstrationsByCategory(category: string): Promise<Demonstration[]> {
    const all = await this.loadDemonstrations();
    return all.filter(d => d.category === category);
  }

  /**
   * Add feedback to an action in a demonstration
   */
  async addActionFeedback(demoId: string, actionId: string, feedback: string, success: boolean): Promise<void> {
    const demo = await this.loadDemonstration(demoId);
    if (!demo) throw new Error('Demonstration not found');

    const action = demo.actions.find(a => a.id === actionId);
    if (!action) throw new Error('Action not found');

    action.feedback = feedback;
    action.success = success;

    await this.saveDemonstration(demo);
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Periodically capture screen state during recording
   */
  private async captureState(): Promise<void> {
    if (!this.recording) return;

    try {
      const screenshot = await this.connector.captureScreen();
      if (screenshot) {
        this.lastState = await this.understanding.analyzeScreen(screenshot);
      }
    } catch (error) {
      logger.debug('State capture failed', { error: (error as Error).message });
    }
  }

  /**
   * Save a demonstration to disk
   */
  private async saveDemonstration(demo: Demonstration): Promise<void> {
    const filePath = path.join(this.storageDir, `${demo.id}.json`);

    // Create a copy without full screenshots to save space
    const compactDemo = {
      ...demo,
      // Keep only state metadata, not full screenshots
      initialState: {
        ...demo.initialState,
        screenshot: undefined, // Remove base64 screenshot
      },
      finalState: {
        ...demo.finalState,
        screenshot: undefined,
      },
      actions: demo.actions.map(a => ({
        ...a,
        stateBefore: {
          ...a.stateBefore,
          screenshot: undefined,
        },
        stateAfter: {
          ...a.stateAfter,
          screenshot: undefined,
        },
      })),
    };

    await fs.writeFile(filePath, JSON.stringify(compactDemo, null, 2));
    logger.debug('Demonstration saved', { id: demo.id, path: filePath });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let recorderInstance: DemonstrationRecorder | null = null;

/**
 * Get the global DemonstrationRecorder instance.
 * Requires VMConnector and ScreenUnderstanding to be initialized.
 */
export function getDemonstrationRecorder(
  connector: import('./vm-connector').VMConnector,
  understanding: import('./screen-understanding').ScreenUnderstanding
): DemonstrationRecorder {
  if (!recorderInstance) {
    recorderInstance = new DemonstrationRecorder(connector, understanding);
  }
  return recorderInstance;
}

/**
 * Check if demonstration recorder is initialized
 */
export function isDemonstrationRecorderInitialized(): boolean {
  return recorderInstance !== null;
}

// =============================================================================
// Exports
// =============================================================================

export default DemonstrationRecorder;
