/**
 * Nova Desktop - IPC Module
 * Exports IPC handler registration and utilities
 */

export { registerIPCHandlers, unregisterIPCHandlers, setMainWindow, cleanupIPC } from './handlers';
export {
  IPCResult,
  success,
  failure,
  createAsyncHandler,
  createSyncHandler,
  createResourceHandler,
  removeHandlers,
  registerHandlers,
} from './factory';
