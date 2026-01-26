/**
 * Lazy Module Loader - Load heavy modules only when needed
 * Reduces initial memory footprint and startup time
 */

import { createModuleLogger } from './logger';

const logger = createModuleLogger('LazyLoader');

type ModuleLoader<T> = () => Promise<T>;

interface CachedModule<T> {
  module: T | null;
  loading: Promise<T> | null;
  lastUsed: number;
  size: 'small' | 'medium' | 'large';
}

class LazyModuleLoader {
  private static instance: LazyModuleLoader;
  private modules: Map<string, CachedModule<unknown>> = new Map();
  private unloadTimeouts: Map<string, NodeJS.Timeout> = new Map();

  // Auto-unload after 5 minutes of inactivity for large modules
  private unloadDelays = {
    small: 0,        // Never unload
    medium: 300000,  // 5 minutes
    large: 120000,   // 2 minutes
  };

  private constructor() {
    this.registerBuiltinModules();
  }

  static getInstance(): LazyModuleLoader {
    if (!LazyModuleLoader.instance) {
      LazyModuleLoader.instance = new LazyModuleLoader();
    }
    return LazyModuleLoader.instance;
  }

  /**
   * Register a module for lazy loading
   */
  register<T>(
    name: string, 
    loader: ModuleLoader<T>,
    size: 'small' | 'medium' | 'large' = 'medium'
  ): void {
    this.modules.set(name, {
      module: null,
      loading: null,
      lastUsed: 0,
      size,
    });

    // Store the loader as a property
    (this.modules.get(name) as CachedModule<T> & { loader: ModuleLoader<T> }).loader = loader;
  }

  /**
   * Get a lazy-loaded module
   */
  async get<T>(name: string): Promise<T> {
    const cached = this.modules.get(name) as (CachedModule<T> & { loader?: ModuleLoader<T> }) | undefined;
    
    if (!cached || !cached.loader) {
      throw new Error(`Module ${name} not registered for lazy loading`);
    }

    // Cancel any pending unload
    const timeout = this.unloadTimeouts.get(name);
    if (timeout) {
      clearTimeout(timeout);
      this.unloadTimeouts.delete(name);
    }

    // Return cached if available
    if (cached.module) {
      cached.lastUsed = Date.now();
      this.scheduleUnload(name);
      return cached.module;
    }

    // Return existing loading promise if in progress
    if (cached.loading) {
      return cached.loading;
    }

    // Load the module
    logger.debug(`Lazy loading module: ${name}`);
    const startTime = Date.now();

    cached.loading = cached.loader().then(mod => {
      cached.module = mod;
      cached.loading = null;
      cached.lastUsed = Date.now();

      const loadTime = Date.now() - startTime;
      logger.info(`Lazy loaded module: ${name}`, { loadTimeMs: loadTime });

      this.scheduleUnload(name);
      return mod;
    });

    return cached.loading;
  }

  /**
   * Check if a module is loaded
   */
  isLoaded(name: string): boolean {
    const cached = this.modules.get(name);
    return cached?.module != null;
  }

  /**
   * Manually unload a module
   */
  unload(name: string): void {
    const cached = this.modules.get(name);
    if (cached) {
      cached.module = null;
      cached.loading = null;
      logger.debug(`Unloaded module: ${name}`);
    }

    const timeout = this.unloadTimeouts.get(name);
    if (timeout) {
      clearTimeout(timeout);
      this.unloadTimeouts.delete(name);
    }
  }

  /**
   * Unload all modules
   */
  unloadAll(): void {
    for (const name of this.modules.keys()) {
      this.unload(name);
    }
  }

  /**
   * Get loaded module count and memory estimate
   */
  getStats(): { loaded: number; total: number; names: string[] } {
    const loaded = Array.from(this.modules.entries())
      .filter(([_, cached]) => cached.module != null)
      .map(([name]) => name);

    return {
      loaded: loaded.length,
      total: this.modules.size,
      names: loaded,
    };
  }

  /**
   * Schedule automatic unload based on module size
   */
  private scheduleUnload(name: string): void {
    const cached = this.modules.get(name);
    if (!cached) return;

    const delay = this.unloadDelays[cached.size];
    if (delay === 0) return; // Never unload small modules

    const existingTimeout = this.unloadTimeouts.get(name);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    const timeout = setTimeout(() => {
      const current = this.modules.get(name);
      if (current && Date.now() - current.lastUsed >= delay) {
        this.unload(name);
        logger.debug(`Auto-unloaded idle module: ${name}`);
      }
    }, delay);

    this.unloadTimeouts.set(name, timeout);
  }

  /**
   * Register built-in heavy modules
   */
  private registerBuiltinModules(): void {
    // Marked (markdown parser) - medium
    this.register('marked', async () => {
      const { marked } = await import('marked');
      return marked;
    }, 'medium');

    // OpenRouter - medium (AI provider)
    this.register('openrouter', async () => {
      const mod = await import('../llm/providers/openrouter');
      return mod;
    }, 'medium');

    // Better-sqlite3 is loaded at startup - don't lazy load

    // Sharp (image processing) - large
    this.register('sharp', async () => {
      const sharp = await import('sharp');
      return sharp.default;
    }, 'large');
  }
}

// Export singleton getter
export function getLazyLoader(): LazyModuleLoader {
  return LazyModuleLoader.getInstance();
}

// Convenience function for one-time lazy imports
export async function lazyImport<T>(
  name: string,
  loader: () => Promise<T>,
  size: 'small' | 'medium' | 'large' = 'medium'
): Promise<T> {
  const lazyLoader = getLazyLoader();
  
  if (!lazyLoader.isLoaded(name)) {
    lazyLoader.register(name, loader, size);
  }

  return lazyLoader.get(name);
}
