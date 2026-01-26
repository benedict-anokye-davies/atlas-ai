/**
 * Atlas Desktop - IPC Handler Factory
 * Utility functions to reduce IPC handler boilerplate
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { createModuleLogger } from '../utils/logger';
import { getErrorMessage } from '../../shared/utils';

const logger = createModuleLogger('IPCFactory');

/**
 * Standard IPC result type
 */
export interface IPCResult<T = unknown> {
  success: boolean;
  error?: string;
  data?: T;
}

/**
 * Creates a success result
 */
export function success<T>(data?: T): IPCResult<T> {
  return { success: true, data };
}

/**
 * Creates an error result
 */
export function failure(error: string | Error | unknown): IPCResult {
  const message = typeof error === 'string' ? error : getErrorMessage(error, 'Unknown error');
  return { success: false, error: message };
}

/**
 * Handler function type
 */
type AsyncHandler<TArgs extends unknown[], TResult> = (
  event: IpcMainInvokeEvent,
  ...args: TArgs
) => Promise<TResult>;

type SyncHandler<TArgs extends unknown[], TResult> = (
  event: IpcMainInvokeEvent,
  ...args: TArgs
) => TResult;

/**
 * Wraps an async handler with automatic error handling and logging
 */
export function createAsyncHandler<TArgs extends unknown[], TResult>(
  channel: string,
  handler: AsyncHandler<TArgs, TResult>
): void {
  ipcMain.handle(channel, async (event, ...args: TArgs) => {
    try {
      logger.debug(`IPC call: ${channel}`, { args: args.length > 0 ? args : undefined });
      const result = await handler(event, ...args);
      return result;
    } catch (error) {
      logger.error(`IPC error: ${channel}`, { error: (error as Error).message });
      return failure(error as Error);
    }
  });
}

/**
 * Wraps a sync handler with automatic error handling and logging
 */
export function createSyncHandler<TArgs extends unknown[], TResult>(
  channel: string,
  handler: SyncHandler<TArgs, TResult>
): void {
  ipcMain.handle(channel, (event, ...args: TArgs) => {
    try {
      logger.debug(`IPC call: ${channel}`, { args: args.length > 0 ? args : undefined });
      const result = handler(event, ...args);
      return result;
    } catch (error) {
      logger.error(`IPC error: ${channel}`, { error: (error as Error).message });
      return failure(error as Error);
    }
  });
}

/**
 * Creates a handler that requires a resource to be initialized
 */
export function createResourceHandler<TResource, TArgs extends unknown[], TResult>(
  channel: string,
  getResource: () => TResource | null,
  resourceName: string,
  handler: (
    resource: TResource,
    event: IpcMainInvokeEvent,
    ...args: TArgs
  ) => TResult | Promise<TResult>
): void {
  ipcMain.handle(channel, async (event, ...args: TArgs) => {
    try {
      const resource = getResource();
      if (!resource) {
        return failure(`${resourceName} not initialized`);
      }
      logger.debug(`IPC call: ${channel}`, { args: args.length > 0 ? args : undefined });
      const result = await handler(resource, event, ...args);
      return result;
    } catch (error) {
      logger.error(`IPC error: ${channel}`, { error: (error as Error).message });
      return failure(error as Error);
    }
  });
}

/**
 * Removes multiple handlers at once
 */
export function removeHandlers(channels: string[]): void {
  for (const channel of channels) {
    ipcMain.removeHandler(channel);
  }
  logger.debug('Removed IPC handlers', { count: channels.length });
}

/**
 * Batch register handlers from a handler map
 */
export function registerHandlers(
  handlers: Record<string, SyncHandler<unknown[], unknown> | AsyncHandler<unknown[], unknown>>
): void {
  for (const [channel, handler] of Object.entries(handlers)) {
    // Check if handler is async by looking at return type
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      try {
        logger.debug(`IPC call: ${channel}`);
        const result = await handler(event, ...args);
        return result;
      } catch (error) {
        logger.error(`IPC error: ${channel}`, { error: (error as Error).message });
        return failure(error as Error);
      }
    });
  }
  logger.info('Registered IPC handlers', { count: Object.keys(handlers).length });
}
