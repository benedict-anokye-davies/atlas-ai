/**
 * Atlas Desktop - Memory Consolidation Index
 * Main entry point for the consolidation system
 */

export * from './summarizer';
export * from './scheduler';

// Re-export importance scorer from parent
export { getImportanceScorer, ImportanceScorer } from '../importance-scorer';
