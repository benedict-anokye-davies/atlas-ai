/**
 * Temporal Module
 * Time-based queries, relevance decay, timeline generation
 */

export * from './types';
export * from './temporal-engine';

import { getTemporalEngine } from './temporal-engine';

/**
 * Initialize the temporal engine
 */
export function initializeTemporal(): void {
  const engine = getTemporalEngine();
  engine.clearCache();
}
