/**
 * Nova Desktop - Logger
 * Winston-based logging system with file rotation and IPC support
 */

import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import { getConfig } from '../config';

// Custom format for console output
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(({ timestamp, level, message, module, ...meta }) => {
    const moduleStr = module ? `[${module}]` : '[Nova]';
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} ${level} ${moduleStr} ${message}${metaStr}`;
  })
);

// Custom format for file output
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, module, ...meta }) => {
    const moduleStr = module ? `[${module}]` : '[Nova]';
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} ${level.toUpperCase().padEnd(5)} ${moduleStr} ${message}${metaStr}`;
  })
);

// Singleton logger instance
let loggerInstance: winston.Logger | null = null;

/**
 * Initialize the logger
 */
function initLogger(): winston.Logger {
  const config = getConfig();
  const logDir = config.logDir;
  const logLevel = config.logLevel;
  const isDev = config.nodeEnv === 'development';

  // Create log directory if it doesn't exist
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }

  // Create transports
  const transports: winston.transport[] = [];

  // Console transport (always in dev, configurable in prod)
  if (isDev) {
    transports.push(
      new winston.transports.Console({
        format: consoleFormat,
        level: logLevel,
      })
    );
  }

  // File transport with daily rotation
  transports.push(
    new DailyRotateFile({
      dirname: logDir,
      filename: 'nova-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '14d',
      format: fileFormat,
      level: logLevel,
    })
  );

  // Error file (errors only)
  transports.push(
    new DailyRotateFile({
      dirname: logDir,
      filename: 'nova-error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '30d',
      format: fileFormat,
      level: 'error',
    })
  );

  // Create logger
  const logger = winston.createLogger({
    level: logLevel,
    defaultMeta: {},
    transports,
    exitOnError: false,
  });

  return logger;
}

/**
 * Get the logger instance (creates if needed)
 */
export function getLogger(): winston.Logger {
  if (!loggerInstance) {
    loggerInstance = initLogger();
  }
  return loggerInstance;
}

/**
 * Create a child logger for a specific module
 */
export function createModuleLogger(moduleName: string): ModuleLogger {
  const logger = getLogger();
  return new ModuleLogger(logger, moduleName);
}

/**
 * Module-specific logger with convenience methods
 */
export class ModuleLogger {
  private logger: winston.Logger;
  private module: string;

  constructor(logger: winston.Logger, module: string) {
    this.logger = logger;
    this.module = module;
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.logger.debug(message, { module: this.module, ...meta });
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.logger.info(message, { module: this.module, ...meta });
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.logger.warn(message, { module: this.module, ...meta });
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.logger.error(message, { module: this.module, ...meta });
  }

  /**
   * Log with timing information
   */
  time(label: string): () => void {
    const start = performance.now();
    return () => {
      const duration = performance.now() - start;
      this.debug(`${label} completed`, { duration: `${duration.toFixed(2)}ms` });
    };
  }

  /**
   * Log an error with stack trace
   */
  logError(error: Error, context?: string): void {
    this.error(context ? `${context}: ${error.message}` : error.message, {
      stack: error.stack,
      name: error.name,
    });
  }
}

/**
 * Performance timer utility
 */
export class PerformanceTimer {
  private timers: Map<string, number> = new Map();
  private logger: ModuleLogger;

  constructor(module: string) {
    this.logger = createModuleLogger(module);
  }

  start(label: string): void {
    this.timers.set(label, performance.now());
  }

  end(label: string): number {
    const start = this.timers.get(label);
    if (!start) {
      this.logger.warn(`Timer '${label}' was not started`);
      return 0;
    }
    const duration = performance.now() - start;
    this.timers.delete(label);
    this.logger.debug(`${label}`, { duration: `${duration.toFixed(2)}ms` });
    return duration;
  }

  async measure<T>(label: string, fn: () => Promise<T>): Promise<T> {
    this.start(label);
    try {
      const result = await fn();
      this.end(label);
      return result;
    } catch (error) {
      this.end(label);
      throw error;
    }
  }
}

// Pre-created loggers for common modules
export const mainLogger = createModuleLogger('Main');
export const voiceLogger = createModuleLogger('Voice');
export const llmLogger = createModuleLogger('LLM');
export const ttsLogger = createModuleLogger('TTS');
export const sttLogger = createModuleLogger('STT');
export const memoryLogger = createModuleLogger('Memory');
export const agentLogger = createModuleLogger('Agent');
export const ipcLogger = createModuleLogger('IPC');

/**
 * Shutdown the logger (close file handles)
 */
export function shutdownLogger(): Promise<void> {
  return new Promise((resolve) => {
    if (loggerInstance) {
      loggerInstance.on('finish', resolve);
      loggerInstance.end();
    } else {
      resolve();
    }
  });
}

export default getLogger;
