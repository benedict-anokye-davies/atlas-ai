/**
 * File Analyzer
 * Analyzes documents and files of various types
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import pdf from 'pdf-parse';
import { createModuleLogger } from '../utils/logger';
import {
  DocumentAnalysisResult,
  DocumentType,
  DocumentSection,
  ExtractedEntity,
  EntityType,
  DocumentMetadata,
  AnalysisOptions
} from './types';

const logger = createModuleLogger('FileAnalyzer');

interface FileAnalyzerConfig {
  maxFileSize: number;
  extractEntities: boolean;
  generateSummary: boolean;
  supportedExtensions: Record<string, DocumentType>;
}

const DEFAULT_CONFIG: FileAnalyzerConfig = {
  maxFileSize: 50 * 1024 * 1024, // 50MB
  extractEntities: true,
  generateSummary: true,
  supportedExtensions: {
    '.pdf': 'pdf',
    '.doc': 'word',
    '.docx': 'word',
    '.xls': 'excel',
    '.xlsx': 'excel',
    '.ppt': 'powerpoint',
    '.pptx': 'powerpoint',
    '.txt': 'text',
    '.md': 'markdown',
    '.js': 'code',
    '.ts': 'code',
    '.py': 'code',
    '.java': 'code',
    '.cpp': 'code',
    '.c': 'code',
    '.go': 'code',
    '.rs': 'code',
    '.rb': 'code',
    '.php': 'code',
    '.html': 'code',
    '.css': 'code',
    '.json': 'code',
    '.yaml': 'code',
    '.yml': 'code',
    '.xml': 'code'
  }
};

// Entity extraction patterns
const ENTITY_PATTERNS: Record<EntityType, RegExp> = {
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  phone: /\b(?:\+?1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}\b/g,
  url: /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g,
  date: /\b(?:\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|\d{4}[-/]\d{1,2}[-/]\d{1,2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4})\b/gi,
  money: /\$[\d,]+(?:\.\d{2})?|\b\d+(?:,\d{3})*(?:\.\d{2})?\s*(?:USD|EUR|GBP|JPY)\b/gi,
  person: /\b[A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/g,
  organization: /\b(?:[A-Z][a-z]+\s+)*(?:Inc|LLC|Corp|Ltd|Company|Organization|University|Institute)\b/g,
  location: /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*,\s*[A-Z]{2}\b/g,
  code: /`[^`]+`|```[\s\S]*?```/g,
  custom: /(?:)/g // Placeholder for custom patterns
};

class FileAnalyzer extends EventEmitter {
  private config: FileAnalyzerConfig;
  private initialized: boolean = false;

  constructor(config: Partial<FileAnalyzerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    logger.info('Initializing file analyzer');
    this.initialized = true;
    this.emit('initialized');
  }

  /**
   * Analyze a file
   */
  async analyzeFile(
    filePath: string,
    options: AnalysisOptions = {}
  ): Promise<DocumentAnalysisResult> {
    const startTime = Date.now();
    
    try {
      // Validate file exists
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      const stats = fs.statSync(filePath);
      
      // Check file size
      if (stats.size > this.config.maxFileSize) {
        throw new Error(`File too large: ${stats.size} bytes (max: ${this.config.maxFileSize})`);
      }

      const ext = path.extname(filePath).toLowerCase();
      const docType = this.config.supportedExtensions[ext] || 'unknown';
      
      // Extract content based on type
      const content = await this.extractContent(filePath, docType, options);
      
      // Parse sections
      const sections = this.parseSections(content, docType);
      
      // Extract entities
      const entities = options.extractEntities !== false && this.config.extractEntities
        ? this.extractEntities(content)
        : [];
      
      // Generate summary
      const summary = options.generateSummary !== false && this.config.generateSummary
        ? await this.generateSummary(content, sections)
        : undefined;
      
      // Build metadata
      const metadata = await this.extractMetadata(filePath, stats);
      
      // Detect title
      const title = this.detectTitle(content, sections, filePath);

      const result: DocumentAnalysisResult = {
        type: docType,
        title,
        content,
        sections,
        entities,
        summary,
        metadata
      };

      logger.info(`File analysis completed in ${Date.now() - startTime}ms`, {
        file: path.basename(filePath),
        type: docType,
        entities: entities.length
      });

      this.emit('analysis-complete', result);
      return result;
    } catch (error) {
      logger.error('File analysis failed', error);
      throw error;
    }
  }

  /**
   * Extract content from file based on type
   */
  private async extractContent(
    filePath: string,
    docType: DocumentType,
    options: AnalysisOptions
  ): Promise<string> {
    switch (docType) {
      case 'text':
      case 'markdown':
      case 'code':
        return fs.readFileSync(filePath, 'utf-8');
        
      case 'pdf':
        return this.extractPdfContent(filePath, options);
        
      case 'word':
        return this.extractWordContent(filePath);
        
      case 'excel':
        return this.extractExcelContent(filePath);
        
      case 'powerpoint':
        return this.extractPowerpointContent(filePath);
        
      default:
        // Try reading as text
        try {
          return fs.readFileSync(filePath, 'utf-8');
        } catch {
          return `[Binary file: ${path.basename(filePath)}]`;
        }
    }
  }

  /**
   * Extract content from PDF
   */
  private async extractPdfContent(
    filePath: string,
    options: AnalysisOptions
  ): Promise<string> {
    try {
      logger.debug('PDF extraction requested', { 
        file: filePath, 
        maxPages: options.maxPages 
      });
      
      const dataBuffer = fs.readFileSync(filePath);
      const data = await pdf(dataBuffer);
      
      // Handle max pages if specified
      // pdf-parse doesn't natively support max pages in options in all versions,
      // but we can at least return what we parse. 
      // If we need strict page limits we'd need a more complex interaction or a different library, 
      // but for basic extraction this is sufficient.
      
      return data.text;
    } catch (error) {
      logger.warn('PDF extraction failed', error);
      return `[Failed to extract PDF: ${path.basename(filePath)}]`;
    }
  }

  /**
   * Extract content from Word document
   */
  private async extractWordContent(filePath: string): Promise<string> {
    try {
      // This would integrate with mammoth or similar library
      logger.debug('Word extraction requested', { file: filePath });
      return `[Word content extraction pending: ${path.basename(filePath)}]`;
    } catch (error) {
      logger.warn('Word extraction failed', error);
      return `[Failed to extract Word: ${path.basename(filePath)}]`;
    }
  }

  /**
   * Extract content from Excel
   */
  private async extractExcelContent(filePath: string): Promise<string> {
    try {
      // This would integrate with xlsx or similar library
      logger.debug('Excel extraction requested', { file: filePath });
      return `[Excel content extraction pending: ${path.basename(filePath)}]`;
    } catch (error) {
      logger.warn('Excel extraction failed', error);
      return `[Failed to extract Excel: ${path.basename(filePath)}]`;
    }
  }

  /**
   * Extract content from PowerPoint
   */
  private async extractPowerpointContent(filePath: string): Promise<string> {
    try {
      // This would integrate with officegen or similar library
      logger.debug('PowerPoint extraction requested', { file: filePath });
      return `[PowerPoint content extraction pending: ${path.basename(filePath)}]`;
    } catch (error) {
      logger.warn('PowerPoint extraction failed', error);
      return `[Failed to extract PowerPoint: ${path.basename(filePath)}]`;
    }
  }

  /**
   * Parse document into sections
   */
  private parseSections(content: string, docType: DocumentType): DocumentSection[] {
    const sections: DocumentSection[] = [];
    
    if (docType === 'markdown') {
      // Parse markdown headings
      const headingRegex = /^(#{1,6})\s+(.+)$/gm;
      let lastIndex = 0;
      let match;
      
      while ((match = headingRegex.exec(content)) !== null) {
        const level = match[1].length;
        const heading = match[2];
        const startIndex = match.index;
        
        // Add previous section content
        if (sections.length > 0) {
          const prevSection = sections[sections.length - 1];
          prevSection.content = content.slice(lastIndex, startIndex).trim();
        }
        
        sections.push({
          heading,
          content: '',
          level
        });
        
        lastIndex = startIndex + match[0].length;
      }
      
      // Add final section content
      if (sections.length > 0) {
        sections[sections.length - 1].content = content.slice(lastIndex).trim();
      }
    } else if (docType === 'code') {
      // Parse code into logical sections (functions, classes, etc.)
      sections.push({
        heading: 'Code',
        content: content,
        level: 1
      });
    } else {
      // Split by double newlines for plain text
      const paragraphs = content.split(/\n\n+/);
      paragraphs.forEach((para, index) => {
        if (para.trim()) {
          sections.push({
            heading: `Section ${index + 1}`,
            content: para.trim(),
            level: 1
          });
        }
      });
    }
    
    return sections;
  }

  /**
   * Extract named entities from content
   */
  private extractEntities(content: string): ExtractedEntity[] {
    const entities: ExtractedEntity[] = [];
    const seen = new Set<string>();
    
    const entityTypes: EntityType[] = [
      'email', 'phone', 'url', 'date', 'money', 
      'person', 'organization', 'location'
    ];
    
    for (const type of entityTypes) {
      const pattern = ENTITY_PATTERNS[type];
      if (!pattern) continue;
      
      // Reset pattern lastIndex for global regex
      pattern.lastIndex = 0;
      
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const value = match[0];
        const key = `${type}:${value.toLowerCase()}`;
        
        if (!seen.has(key)) {
          seen.add(key);
          
          // Get surrounding context
          const start = Math.max(0, match.index - 50);
          const end = Math.min(content.length, match.index + value.length + 50);
          const context = content.slice(start, end).replace(/\n/g, ' ').trim();
          
          entities.push({
            type,
            value,
            confidence: this.calculateEntityConfidence(type, value),
            context: context !== value ? context : undefined
          });
        }
      }
    }
    
    // Sort by confidence
    entities.sort((a, b) => b.confidence - a.confidence);
    
    return entities;
  }

  /**
   * Calculate confidence score for extracted entity
   */
  private calculateEntityConfidence(type: EntityType, value: string): number {
    // Base confidence by type
    const baseConfidence: Record<EntityType, number> = {
      email: 0.95,
      phone: 0.85,
      url: 0.95,
      date: 0.80,
      money: 0.90,
      person: 0.60,
      organization: 0.65,
      location: 0.70,
      code: 0.95,
      custom: 0.50
    };
    
    let confidence = baseConfidence[type] || 0.5;
    
    // Adjust based on value characteristics
    if (type === 'email' && value.includes('.edu')) confidence += 0.02;
    if (type === 'phone' && value.startsWith('+')) confidence += 0.05;
    if (type === 'url' && value.startsWith('https')) confidence += 0.02;
    
    return Math.min(1, confidence);
  }

  /**
   * Generate summary of document
   */
  private async generateSummary(
    content: string,
    sections: DocumentSection[]
  ): Promise<string> {
    try {
      // Simple extractive summary
      // Real implementation would use LLM for abstractive summary
      
      const sentences = content
        .split(/[.!?]+/)
        .map(s => s.trim())
        .filter(s => s.length > 20 && s.length < 200);
      
      if (sentences.length === 0) {
        return 'No summary available';
      }
      
      // Take first few significant sentences
      const summaryLength = Math.min(3, sentences.length);
      const summary = sentences.slice(0, summaryLength).join('. ') + '.';
      
      logger.debug('Summary generated', { 
        sections: sections.length,
        summaryLength: summary.length 
      });
      
      return summary;
    } catch (error) {
      logger.warn('Summary generation failed', error);
      return 'Unable to generate summary';
    }
  }

  /**
   * Extract file metadata
   */
  private async extractMetadata(
    filePath: string,
    stats: fs.Stats
  ): Promise<DocumentMetadata> {
    return {
      filename: path.basename(filePath),
      size: stats.size,
      createdAt: stats.birthtime,
      modifiedAt: stats.mtime
    };
  }

  /**
   * Detect document title
   */
  private detectTitle(
    content: string,
    sections: DocumentSection[],
    filePath: string
  ): string {
    // Try to find title from first heading
    if (sections.length > 0 && sections[0].heading) {
      return sections[0].heading;
    }
    
    // Try to find title from first line
    const firstLine = content.split('\n')[0]?.trim();
    if (firstLine && firstLine.length < 100 && firstLine.length > 3) {
      return firstLine;
    }
    
    // Fall back to filename
    return path.basename(filePath, path.extname(filePath));
  }

  /**
   * Analyze multiple files in a directory
   */
  async analyzeDirectory(
    dirPath: string,
    options: AnalysisOptions & { recursive?: boolean } = {}
  ): Promise<DocumentAnalysisResult[]> {
    const results: DocumentAnalysisResult[] = [];
    
    const files = this.getFilesInDirectory(dirPath, options.recursive ?? false);
    
    for (const file of files) {
      try {
        const result = await this.analyzeFile(file, options);
        results.push(result);
      } catch (error) {
        logger.warn(`Failed to analyze ${file}`, error);
      }
    }
    
    return results;
  }

  /**
   * Get all files in directory
   */
  private getFilesInDirectory(dirPath: string, recursive: boolean): string[] {
    const files: string[] = [];
    
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      
      if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (this.config.supportedExtensions[ext]) {
          files.push(fullPath);
        }
      } else if (entry.isDirectory() && recursive) {
        files.push(...this.getFilesInDirectory(fullPath, recursive));
      }
    }
    
    return files;
  }

  /**
   * Get supported file types
   */
  getSupportedTypes(): DocumentType[] {
    return [...new Set(Object.values(this.config.supportedExtensions))];
  }

  /**
   * Check if file type is supported
   */
  isSupported(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return ext in this.config.supportedExtensions;
  }

  getStatus(): { initialized: boolean; supportedExtensions: string[] } {
    return {
      initialized: this.initialized,
      supportedExtensions: Object.keys(this.config.supportedExtensions)
    };
  }
}

// Singleton instance
let fileAnalyzer: FileAnalyzer | null = null;

export function getFileAnalyzer(): FileAnalyzer {
  if (!fileAnalyzer) {
    fileAnalyzer = new FileAnalyzer();
  }
  return fileAnalyzer;
}

export { FileAnalyzer };
