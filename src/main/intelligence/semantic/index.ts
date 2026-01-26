/**
 * Semantic Layer - Module Exports
 */

// Types
export * from './types';

// Manager
export { SemanticLayerManager, getSemanticLayerManager, initializeSemanticLayer } from './semantic-layer-manager';

// Parsers
export { EmailParser, getEmailParser } from './parsers/email-parser';
export { CalendarExtractor, getCalendarExtractor } from './parsers/calendar-extractor';
export { FileIndexer, getFileIndexer } from './parsers/file-indexer';
export { ContactResolver, getContactResolver } from './parsers/contact-resolver';
export { TransactionAnalyzer, getTransactionAnalyzer } from './parsers/transaction-analyzer';

// Re-export parser instances for convenience
import { getEmailParser } from './parsers/email-parser';
import { getCalendarExtractor } from './parsers/calendar-extractor';
import { getFileIndexer } from './parsers/file-indexer';
import { getContactResolver } from './parsers/contact-resolver';
import { getTransactionAnalyzer } from './parsers/transaction-analyzer';
import { getSemanticLayerManager } from './semantic-layer-manager';

/**
 * Initialize all parsers and register them with the semantic layer manager
 */
export async function initializeAllParsers(): Promise<void> {
  const manager = getSemanticLayerManager();

  // Register all parsers
  manager.registerParser('email', getEmailParser());
  manager.registerParser('calendar', getCalendarExtractor());
  manager.registerParser('filesystem', getFileIndexer());
  manager.registerParser('contacts', getContactResolver());
  manager.registerParser('banking', getTransactionAnalyzer());

  await manager.initialize();
}

/**
 * Get all available parsers
 */
export function getAllParsers() {
  return {
    email: getEmailParser(),
    calendar: getCalendarExtractor(),
    filesystem: getFileIndexer(),
    contacts: getContactResolver(),
    banking: getTransactionAnalyzer(),
  };
}
