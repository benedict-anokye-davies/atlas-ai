/**
 * Multi-Modal Input System
 * Entry point for multi-modal input processing
 */

export * from './types';
export { getImageProcessor, ImageProcessor } from './image-processor';
export { getFileAnalyzer, FileAnalyzer } from './file-analyzer';

import { getImageProcessor } from './image-processor';
import { getFileAnalyzer } from './file-analyzer';
import { createModuleLogger } from '../utils/logger';
import { getErrorMessage } from '../../shared/utils';
import {
  MultiModalInput,
  ProcessingResult,
  AnalysisOptions
} from './types';

const logger = createModuleLogger('MultiModal');

/**
 * Initialize the multi-modal input system
 */
export async function initializeMultiModal(): Promise<void> {
  logger.info('Initializing multi-modal input system');
  
  const imageProcessor = getImageProcessor();
  const fileAnalyzer = getFileAnalyzer();
  
  await Promise.all([
    imageProcessor.initialize(),
    fileAnalyzer.initialize()
  ]);
  
  logger.info('Multi-modal input system initialized');
}

/**
 * Process any type of multi-modal input
 */
export async function processInput(
  input: MultiModalInput,
  options: AnalysisOptions = {}
): Promise<ProcessingResult> {
  const startTime = Date.now();
  
  try {
    switch (input.type) {
      case 'image': {
        const imageProcessor = getImageProcessor();
        const imageData = input.data || (input.path ? input.path : undefined);
        
        if (!imageData) {
          throw new Error('No image data provided');
        }
        
        const imageAnalysis = await imageProcessor.analyzeImage(imageData, options);
        
        return {
          success: true,
          input,
          imageAnalysis,
          processingTime: Date.now() - startTime
        };
      }
      
      case 'document': {
        const fileAnalyzer = getFileAnalyzer();
        
        if (!input.path) {
          throw new Error('No file path provided for document');
        }
        
        const documentAnalysis = await fileAnalyzer.analyzeFile(input.path, options);
        
        return {
          success: true,
          input,
          documentAnalysis,
          processingTime: Date.now() - startTime
        };
      }
      
      case 'audio':
      case 'video':
        // Future implementation
        throw new Error(`${input.type} processing not yet implemented`);
      
      default:
        throw new Error(`Unknown input type: ${input.type}`);
    }
  } catch (error) {
    logger.error('Multi-modal processing failed', error);
    
    return {
      success: false,
      input,
      error: getErrorMessage(error, 'Unknown error'),
      processingTime: Date.now() - startTime
    };
  }
}

/**
 * Get status of multi-modal system
 */
export function getMultiModalStatus(): {
  imageProcessor: ReturnType<typeof getImageProcessor>['getStatus'];
  fileAnalyzer: ReturnType<typeof getFileAnalyzer>['getStatus'];
} {
  return {
    imageProcessor: getImageProcessor().getStatus(),
    fileAnalyzer: getFileAnalyzer().getStatus()
  };
}
