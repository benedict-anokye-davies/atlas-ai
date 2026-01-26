/**
 * Atlas Desktop - Document Intelligence
 * Extract insights from documents and images
 *
 * Features:
 * - Document classification
 * - Key information extraction
 * - OCR text extraction
 * - Document summarization
 * - Table extraction
 *
 * @module ml/document-intelligence
 */

import { EventEmitter } from 'events';
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('DocumentIntelligence');

// ============================================================================
// Types
// ============================================================================

export interface DocumentMetadata {
  id: string;
  filename: string;
  filePath: string;
  type: DocumentType;
  mimeType: string;
  size: number;
  pages?: number;
  createdAt: number;
  processedAt: number;
  language?: string;
}

export type DocumentType =
  | 'invoice'
  | 'receipt'
  | 'contract'
  | 'report'
  | 'email'
  | 'letter'
  | 'resume'
  | 'form'
  | 'article'
  | 'presentation'
  | 'spreadsheet'
  | 'image'
  | 'unknown';

export interface ExtractedEntity {
  type: string;
  value: string;
  confidence: number;
  position?: {
    page?: number;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  };
}

export interface DocumentInsight {
  id: string;
  documentId: string;
  type: DocumentType;
  summary: string;
  entities: ExtractedEntity[];
  keyPhrases: string[];
  tables: ExtractedTable[];
  sentiment?: number;
  language: string;
  confidence: number;
  processedAt: number;
}

export interface ExtractedTable {
  id: string;
  page?: number;
  headers: string[];
  rows: string[][];
  confidence: number;
}

export interface DocumentProcessingResult {
  metadata: DocumentMetadata;
  insight: DocumentInsight;
  rawText: string;
}

export interface DocumentIntelligenceConfig {
  enableOCR: boolean;
  maxFileSize: number; // bytes
  supportedFormats: string[];
  extractTables: boolean;
  extractEntities: boolean;
  summarize: boolean;
}

// ============================================================================
// Text Processing Utilities
// ============================================================================

class TextProcessor {
  /**
   * Extract sentences from text
   */
  extractSentences(text: string): string[] {
    return text
      .replace(/\n+/g, ' ')
      .split(/[.!?]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 10);
  }

  /**
   * Extract key phrases using TF-IDF-like scoring
   */
  extractKeyPhrases(text: string, topN: number = 10): string[] {
    const words = text.toLowerCase().match(/\b[a-z]{3,}\b/g) || [];
    const wordFreq = new Map<string, number>();

    // Count frequencies
    for (const word of words) {
      wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
    }

    // Filter stopwords
    const stopwords = new Set([
      'the', 'and', 'for', 'that', 'with', 'this', 'from', 'are', 'was', 'were',
      'been', 'have', 'has', 'had', 'will', 'would', 'could', 'should', 'may',
      'might', 'must', 'can', 'which', 'their', 'they', 'them', 'these', 'those',
    ]);

    const filtered = Array.from(wordFreq.entries()).filter(([word]) => !stopwords.has(word));

    // Sort by frequency
    filtered.sort((a, b) => b[1] - a[1]);

    return filtered.slice(0, topN).map(([word]) => word);
  }

  /**
   * Simple extractive summarization
   */
  summarize(text: string, maxSentences: number = 3): string {
    const sentences = this.extractSentences(text);
    if (sentences.length <= maxSentences) {
      return sentences.join('. ') + '.';
    }

    // Score sentences by keyword density
    const keyPhrases = new Set(this.extractKeyPhrases(text, 20));
    const scored = sentences.map((sentence) => {
      const words = sentence.toLowerCase().split(/\s+/);
      const keywordCount = words.filter((w) => keyPhrases.has(w)).length;
      return { sentence, score: keywordCount / words.length };
    });

    // Get top sentences while preserving order
    scored.sort((a, b) => b.score - a.score);
    const topSentences = scored.slice(0, maxSentences);
    const originalOrder = topSentences.sort(
      (a, b) => sentences.indexOf(a.sentence) - sentences.indexOf(b.sentence)
    );

    return originalOrder.map((s) => s.sentence).join('. ') + '.';
  }

  /**
   * Detect language
   */
  detectLanguage(text: string): string {
    // Simple language detection based on common words
    const patterns: Record<string, RegExp[]> = {
      en: [/\bthe\b/i, /\band\b/i, /\bis\b/i, /\bwas\b/i],
      es: [/\bel\b/i, /\bla\b/i, /\bque\b/i, /\bde\b/i],
      fr: [/\ble\b/i, /\bla\b/i, /\bque\b/i, /\best\b/i],
      de: [/\bder\b/i, /\bdie\b/i, /\bund\b/i, /\bist\b/i],
    };

    let bestLang = 'en';
    let bestScore = 0;

    for (const [lang, regexes] of Object.entries(patterns)) {
      const score = regexes.filter((r) => r.test(text)).length;
      if (score > bestScore) {
        bestScore = score;
        bestLang = lang;
      }
    }

    return bestLang;
  }
}

// ============================================================================
// Entity Extractor
// ============================================================================

class EntityExtractor {
  private patterns: Map<string, RegExp[]> = new Map();

  constructor() {
    this.initializePatterns();
  }

  private initializePatterns(): void {
    // Date patterns
    this.patterns.set('date', [
      /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/g,
      /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2},? \d{4}\b/gi,
      /\b\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}\b/g,
    ]);

    // Money patterns
    this.patterns.set('money', [
      /\$\d{1,3}(?:,\d{3})*(?:\.\d{2})?\b/g,
      /\b\d{1,3}(?:,\d{3})*(?:\.\d{2})?\s*(?:USD|EUR|GBP)\b/gi,
      /\b(?:EUR|GBP)\s*\d{1,3}(?:,\d{3})*(?:\.\d{2})?\b/gi,
    ]);

    // Email patterns
    this.patterns.set('email', [/\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g]);

    // Phone patterns
    this.patterns.set('phone', [
      /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
      /\b\+?\d{1,3}[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    ]);

    // URL patterns
    this.patterns.set('url', [/https?:\/\/[^\s<>"{}|\\^`[\]]+/gi]);

    // Person name patterns (simplified)
    this.patterns.set('person', [/\b[A-Z][a-z]+ [A-Z][a-z]+\b/g]);

    // Address patterns
    this.patterns.set('address', [/\b\d{1,5}\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:St|Ave|Rd|Blvd|Dr|Ln|Way)\b/gi]);
  }

  /**
   * Extract entities from text
   */
  extract(text: string): ExtractedEntity[] {
    const entities: ExtractedEntity[] = [];
    const seen = new Set<string>();

    for (const [type, patterns] of this.patterns) {
      for (const pattern of patterns) {
        const matches = text.match(pattern) || [];
        for (const match of matches) {
          const key = `${type}:${match}`;
          if (seen.has(key)) continue;
          seen.add(key);

          entities.push({
            type,
            value: match,
            confidence: 0.8, // Base confidence
          });
        }
      }
    }

    return entities;
  }
}

// ============================================================================
// Table Extractor
// ============================================================================

class TableExtractor {
  /**
   * Extract tables from text (assumes markdown-like or CSV-like format)
   */
  extract(text: string): ExtractedTable[] {
    const tables: ExtractedTable[] = [];

    // Try markdown tables
    const mdTables = this.extractMarkdownTables(text);
    tables.push(...mdTables);

    // Try CSV-like patterns
    const csvTables = this.extractCSVTables(text);
    tables.push(...csvTables);

    return tables;
  }

  private extractMarkdownTables(text: string): ExtractedTable[] {
    const tables: ExtractedTable[] = [];
    const tablePattern = /(?:^\|.+\|$\n)+/gm;
    const matches = text.match(tablePattern);

    if (!matches) return tables;

    for (const match of matches) {
      const lines = match.trim().split('\n');
      if (lines.length < 2) continue;

      const parseRow = (line: string): string[] =>
        line
          .split('|')
          .map((cell) => cell.trim())
          .filter((cell) => cell.length > 0);

      const headers = parseRow(lines[0]);

      // Skip separator line if present
      const startIdx = lines[1].includes('---') ? 2 : 1;
      const rows = lines.slice(startIdx).map(parseRow);

      tables.push({
        id: `table_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        headers,
        rows,
        confidence: 0.85,
      });
    }

    return tables;
  }

  private extractCSVTables(text: string): ExtractedTable[] {
    const tables: ExtractedTable[] = [];

    // Look for consecutive lines with consistent delimiters
    const lines = text.split('\n');
    let tableStart = -1;
    let delimiter = '';
    let columnCount = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) {
        if (tableStart !== -1 && i - tableStart >= 2) {
          // End of potential table
          tables.push(this.parseCSVTable(lines.slice(tableStart, i), delimiter));
        }
        tableStart = -1;
        continue;
      }

      // Detect delimiter
      const commaCount = (line.match(/,/g) || []).length;
      const tabCount = (line.match(/\t/g) || []).length;
      const currentDelimiter = tabCount > commaCount ? '\t' : ',';
      const currentColumns = line.split(currentDelimiter).length;

      if (tableStart === -1) {
        tableStart = i;
        delimiter = currentDelimiter;
        columnCount = currentColumns;
      } else if (currentColumns !== columnCount || currentDelimiter !== delimiter) {
        if (i - tableStart >= 2) {
          tables.push(this.parseCSVTable(lines.slice(tableStart, i), delimiter));
        }
        tableStart = i;
        delimiter = currentDelimiter;
        columnCount = currentColumns;
      }
    }

    // Check for table at end
    if (tableStart !== -1 && lines.length - tableStart >= 2) {
      tables.push(this.parseCSVTable(lines.slice(tableStart), delimiter));
    }

    return tables;
  }

  private parseCSVTable(lines: string[], delimiter: string): ExtractedTable {
    const rows = lines.map((line) =>
      line
        .split(delimiter)
        .map((cell) => cell.trim().replace(/^["']|["']$/g, ''))
    );

    return {
      id: `table_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      headers: rows[0] || [],
      rows: rows.slice(1),
      confidence: 0.7,
    };
  }
}

// ============================================================================
// Document Classifier
// ============================================================================

class DocumentClassifier {
  private keywords: Map<DocumentType, string[]> = new Map();

  constructor() {
    this.initializeKeywords();
  }

  private initializeKeywords(): void {
    this.keywords.set('invoice', [
      'invoice', 'bill to', 'due date', 'payment terms', 'total amount', 'subtotal', 'tax', 'qty', 'unit price',
    ]);
    this.keywords.set('receipt', [
      'receipt', 'thank you', 'change', 'subtotal', 'total', 'card', 'cash', 'paid',
    ]);
    this.keywords.set('contract', [
      'agreement', 'hereby', 'parties', 'terms', 'conditions', 'binding', 'signature', 'witness', 'effective date',
    ]);
    this.keywords.set('report', [
      'report', 'summary', 'analysis', 'findings', 'recommendations', 'conclusion', 'executive summary',
    ]);
    this.keywords.set('email', ['from:', 'to:', 'subject:', 'date:', 'cc:', 'bcc:', 'sent:', 'received:']);
    this.keywords.set('letter', ['dear', 'sincerely', 'regards', 'yours truly', 'to whom it may concern']);
    this.keywords.set('resume', [
      'experience', 'education', 'skills', 'objective', 'references', 'employment', 'qualifications',
    ]);
    this.keywords.set('form', ['please fill', 'required', 'checkbox', 'signature', 'date of birth', 'applicant']);
    this.keywords.set('article', ['abstract', 'introduction', 'methodology', 'results', 'discussion', 'references']);
  }

  /**
   * Classify document type
   */
  classify(text: string, filename: string): { type: DocumentType; confidence: number } {
    const lowerText = text.toLowerCase();
    const lowerFilename = filename.toLowerCase();

    // Check file extension
    const extMatch = this.classifyByExtension(lowerFilename);
    if (extMatch.confidence > 0.8) {
      return extMatch;
    }

    // Score by keywords
    let bestType: DocumentType = 'unknown';
    let bestScore = 0;

    for (const [type, keywords] of this.keywords) {
      const matchCount = keywords.filter((kw) => lowerText.includes(kw)).length;
      const score = matchCount / keywords.length;

      if (score > bestScore) {
        bestScore = score;
        bestType = type;
      }
    }

    return {
      type: bestScore > 0.2 ? bestType : 'unknown',
      confidence: Math.min(bestScore * 2, 0.95),
    };
  }

  private classifyByExtension(filename: string): { type: DocumentType; confidence: number } {
    const ext = path.extname(filename).toLowerCase();

    const extMap: Record<string, DocumentType> = {
      '.xlsx': 'spreadsheet',
      '.xls': 'spreadsheet',
      '.csv': 'spreadsheet',
      '.ppt': 'presentation',
      '.pptx': 'presentation',
      '.jpg': 'image',
      '.jpeg': 'image',
      '.png': 'image',
      '.gif': 'image',
      '.pdf': 'unknown', // PDF can be anything
    };

    if (extMap[ext]) {
      return { type: extMap[ext], confidence: 0.9 };
    }

    return { type: 'unknown', confidence: 0 };
  }
}

// ============================================================================
// Document Intelligence
// ============================================================================

export class DocumentIntelligence extends EventEmitter {
  private config: DocumentIntelligenceConfig;
  private documents: Map<string, DocumentInsight> = new Map();
  private textProcessor: TextProcessor;
  private entityExtractor: EntityExtractor;
  private tableExtractor: TableExtractor;
  private classifier: DocumentClassifier;
  private dataPath: string;

  // Stats
  private stats = {
    documentsProcessed: 0,
    entitiesExtracted: 0,
    tablesExtracted: 0,
    averageConfidence: 0,
  };

  constructor(config?: Partial<DocumentIntelligenceConfig>) {
    super();
    this.config = {
      enableOCR: true,
      maxFileSize: 50 * 1024 * 1024, // 50MB
      supportedFormats: ['.txt', '.md', '.pdf', '.docx', '.html', '.csv', '.json'],
      extractTables: true,
      extractEntities: true,
      summarize: true,
      ...config,
    };

    this.textProcessor = new TextProcessor();
    this.entityExtractor = new EntityExtractor();
    this.tableExtractor = new TableExtractor();
    this.classifier = new DocumentClassifier();
    this.dataPath = path.join(app.getPath('userData'), 'document-intelligence.json');

    this.loadData();
    logger.info('DocumentIntelligence initialized', { config: this.config });
  }

  // ============================================================================
  // Data Persistence
  // ============================================================================

  private loadData(): void {
    try {
      if (fs.existsSync(this.dataPath)) {
        const data = JSON.parse(fs.readFileSync(this.dataPath, 'utf-8'));

        for (const insight of data.documents || []) {
          this.documents.set(insight.id, insight);
        }

        if (data.stats) {
          this.stats = data.stats;
        }

        logger.info('Loaded document data', { count: this.documents.size });
      }
    } catch (error) {
      logger.warn('Failed to load document data', { error });
    }
  }

  private saveData(): void {
    try {
      const data = {
        documents: Array.from(this.documents.values()),
        stats: this.stats,
        savedAt: Date.now(),
      };
      fs.writeFileSync(this.dataPath, JSON.stringify(data, null, 2));
    } catch (error) {
      logger.warn('Failed to save document data', { error });
    }
  }

  // ============================================================================
  // Document Processing
  // ============================================================================

  /**
   * Process a document
   */
  async processDocument(filePath: string): Promise<DocumentProcessingResult> {
    const filename = path.basename(filePath);
    const ext = path.extname(filename).toLowerCase();

    // Validate
    if (!this.config.supportedFormats.includes(ext)) {
      throw new Error(`Unsupported format: ${ext}`);
    }

    const stats = fs.statSync(filePath);
    if (stats.size > this.config.maxFileSize) {
      throw new Error(`File too large: ${stats.size} bytes`);
    }

    // Extract text based on format
    const rawText = await this.extractText(filePath, ext);

    // Create metadata
    const metadata: DocumentMetadata = {
      id: this.generateId('doc'),
      filename,
      filePath,
      type: 'unknown',
      mimeType: this.getMimeType(ext),
      size: stats.size,
      createdAt: stats.birthtime.getTime(),
      processedAt: Date.now(),
    };

    // Classify document
    const classification = this.classifier.classify(rawText, filename);
    metadata.type = classification.type;
    metadata.language = this.textProcessor.detectLanguage(rawText);

    // Extract insights
    const insight = this.extractInsights(rawText, metadata, classification.confidence);

    // Store
    this.documents.set(insight.id, insight);
    this.updateStats(insight);
    this.saveData();

    return { metadata, insight, rawText };
  }

  /**
   * Process text directly
   */
  processText(text: string, filename: string = 'document.txt'): DocumentInsight {
    const classification = this.classifier.classify(text, filename);

    const metadata: DocumentMetadata = {
      id: this.generateId('doc'),
      filename,
      filePath: '',
      type: classification.type,
      mimeType: 'text/plain',
      size: text.length,
      createdAt: Date.now(),
      processedAt: Date.now(),
      language: this.textProcessor.detectLanguage(text),
    };

    const insight = this.extractInsights(text, metadata, classification.confidence);

    this.documents.set(insight.id, insight);
    this.updateStats(insight);
    this.saveData();

    return insight;
  }

  /**
   * Extract text from file
   */
  private async extractText(filePath: string, ext: string): Promise<string> {
    switch (ext) {
      case '.txt':
      case '.md':
      case '.csv':
        return fs.readFileSync(filePath, 'utf-8');

      case '.json':
        const json = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        return JSON.stringify(json, null, 2);

      case '.html':
        const html = fs.readFileSync(filePath, 'utf-8');
        return this.stripHtml(html);

      // For PDF and DOCX, return placeholder - would need actual libraries
      case '.pdf':
      case '.docx':
        logger.warn('PDF/DOCX extraction requires additional libraries');
        return `[Document: ${path.basename(filePath)}]`;

      default:
        return fs.readFileSync(filePath, 'utf-8');
    }
  }

  /**
   * Strip HTML tags
   */
  private stripHtml(html: string): string {
    return html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Extract insights from text
   */
  private extractInsights(
    text: string,
    metadata: DocumentMetadata,
    classificationConfidence: number
  ): DocumentInsight {
    const entities = this.config.extractEntities ? this.entityExtractor.extract(text) : [];

    const tables = this.config.extractTables ? this.tableExtractor.extract(text) : [];

    const summary = this.config.summarize ? this.textProcessor.summarize(text) : '';

    const keyPhrases = this.textProcessor.extractKeyPhrases(text);

    const sentiment = this.analyzeSentiment(text);

    return {
      id: metadata.id,
      documentId: metadata.id,
      type: metadata.type,
      summary,
      entities,
      keyPhrases,
      tables,
      sentiment,
      language: metadata.language || 'en',
      confidence: classificationConfidence,
      processedAt: Date.now(),
    };
  }

  /**
   * Simple sentiment analysis
   */
  private analyzeSentiment(text: string): number {
    const positiveWords = [
      'good', 'great', 'excellent', 'amazing', 'wonderful', 'fantastic', 'positive', 'success', 'happy', 'love',
    ];
    const negativeWords = [
      'bad', 'terrible', 'awful', 'horrible', 'negative', 'failure', 'sad', 'hate', 'problem', 'issue',
    ];

    const words = text.toLowerCase().split(/\s+/);
    let positive = 0;
    let negative = 0;

    for (const word of words) {
      if (positiveWords.some((pw) => word.includes(pw))) positive++;
      if (negativeWords.some((nw) => word.includes(nw))) negative++;
    }

    const total = positive + negative;
    if (total === 0) return 0;

    return (positive - negative) / total; // -1 to 1
  }

  /**
   * Update statistics
   */
  private updateStats(insight: DocumentInsight): void {
    this.stats.documentsProcessed++;
    this.stats.entitiesExtracted += insight.entities.length;
    this.stats.tablesExtracted += insight.tables.length;

    // Running average of confidence
    const n = this.stats.documentsProcessed;
    this.stats.averageConfidence = ((n - 1) * this.stats.averageConfidence + insight.confidence) / n;
  }

  // ============================================================================
  // Query Methods
  // ============================================================================

  /**
   * Search documents by content
   */
  searchDocuments(query: string): DocumentInsight[] {
    const queryLower = query.toLowerCase();
    const results: DocumentInsight[] = [];

    for (const insight of this.documents.values()) {
      // Check summary
      if (insight.summary.toLowerCase().includes(queryLower)) {
        results.push(insight);
        continue;
      }

      // Check key phrases
      if (insight.keyPhrases.some((kp) => kp.includes(queryLower))) {
        results.push(insight);
        continue;
      }

      // Check entities
      if (insight.entities.some((e) => e.value.toLowerCase().includes(queryLower))) {
        results.push(insight);
      }
    }

    return results;
  }

  /**
   * Get documents by type
   */
  getDocumentsByType(type: DocumentType): DocumentInsight[] {
    return Array.from(this.documents.values()).filter((d) => d.type === type);
  }

  /**
   * Get document by ID
   */
  getDocument(id: string): DocumentInsight | undefined {
    return this.documents.get(id);
  }

  /**
   * Get all documents
   */
  getAllDocuments(): DocumentInsight[] {
    return Array.from(this.documents.values());
  }

  /**
   * Get entities by type across all documents
   */
  getEntitiesByType(type: string): ExtractedEntity[] {
    const entities: ExtractedEntity[] = [];

    for (const insight of this.documents.values()) {
      entities.push(...insight.entities.filter((e) => e.type === type));
    }

    return entities;
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  private generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private getMimeType(ext: string): string {
    const mimeTypes: Record<string, string> = {
      '.txt': 'text/plain',
      '.md': 'text/markdown',
      '.html': 'text/html',
      '.csv': 'text/csv',
      '.json': 'application/json',
      '.pdf': 'application/pdf',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }

  /**
   * Delete document
   */
  deleteDocument(id: string): boolean {
    const deleted = this.documents.delete(id);
    if (deleted) {
      this.saveData();
    }
    return deleted;
  }

  /**
   * Get statistics
   */
  getStats(): typeof this.stats & { totalDocuments: number } {
    return {
      ...this.stats,
      totalDocuments: this.documents.size,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<DocumentIntelligenceConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('Config updated', { config: this.config });
  }
}

// ============================================================================
// Singleton
// ============================================================================

let documentIntelligence: DocumentIntelligence | null = null;

export function getDocumentIntelligence(): DocumentIntelligence {
  if (!documentIntelligence) {
    documentIntelligence = new DocumentIntelligence();
  }
  return documentIntelligence;
}
