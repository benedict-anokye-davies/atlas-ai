/**
 * Nova API type declarations for renderer
 */

export interface NovaStatus {
  status: string;
  version: string;
  isDev: boolean;
  configValid: boolean;
  missingKeys: string[];
}

export interface NovaAPI {
  // App info
  getVersion: () => Promise<string>;
  getAppPath: () => Promise<string>;
  isDev: () => Promise<boolean>;
  
  // Nova status
  getStatus: () => Promise<NovaStatus>;
  
  // Platform info
  platform: string;
  
  // IPC communication
  send: (channel: string, data?: unknown) => void;
  on: (channel: string, callback: (...args: unknown[]) => void) => () => void;
  invoke: <T>(channel: string, ...args: unknown[]) => Promise<T>;
  
  // Logging helper
  log: (level: string, module: string, message: string, meta?: Record<string, unknown>) => void;
}

declare global {
  interface Window {
    nova?: NovaAPI;
  }
}
