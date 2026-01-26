/**
 * Multi-Modal Input Types
 * Types for image, document, and file analysis
 */

export interface ImageAnalysisResult {
  description: string;
  objects: DetectedObject[];
  text: ExtractedText[];
  colors: ColorInfo[];
  metadata: ImageMetadata;
  confidence: number;
}

export interface DetectedObject {
  label: string;
  confidence: number;
  boundingBox?: BoundingBox;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ExtractedText {
  text: string;
  confidence: number;
  boundingBox?: BoundingBox;
  language?: string;
}

export interface ColorInfo {
  hex: string;
  rgb: { r: number; g: number; b: number };
  percentage: number;
  name?: string;
}

export interface ImageMetadata {
  width: number;
  height: number;
  format: string;
  size: number;
  hasAlpha: boolean;
}

export interface DocumentAnalysisResult {
  type: DocumentType;
  title?: string;
  content: string;
  sections: DocumentSection[];
  entities: ExtractedEntity[];
  summary?: string;
  metadata: DocumentMetadata;
}

export type DocumentType = 
  | 'pdf'
  | 'word'
  | 'excel'
  | 'powerpoint'
  | 'text'
  | 'markdown'
  | 'code'
  | 'unknown';

export interface DocumentSection {
  heading?: string;
  content: string;
  level: number;
  startPage?: number;
  endPage?: number;
}

export interface ExtractedEntity {
  type: EntityType;
  value: string;
  confidence: number;
  context?: string;
}

export type EntityType =
  | 'person'
  | 'organization'
  | 'location'
  | 'date'
  | 'email'
  | 'phone'
  | 'url'
  | 'money'
  | 'code'
  | 'custom';

export interface DocumentMetadata {
  filename: string;
  size: number;
  pages?: number;
  author?: string;
  createdAt?: Date;
  modifiedAt?: Date;
  language?: string;
}

export interface FileAnalysisRequest {
  filePath: string;
  options?: AnalysisOptions;
}

export interface AnalysisOptions {
  extractText?: boolean;
  extractEntities?: boolean;
  generateSummary?: boolean;
  maxPages?: number;
  ocrEnabled?: boolean;
  language?: string;
}

export interface MultiModalInput {
  type: 'image' | 'document' | 'audio' | 'video';
  source: InputSource;
  data?: Buffer;
  path?: string;
  url?: string;
}

export type InputSource = 'file' | 'clipboard' | 'drag-drop' | 'url' | 'screenshot';

export interface ProcessingResult {
  success: boolean;
  input: MultiModalInput;
  imageAnalysis?: ImageAnalysisResult;
  documentAnalysis?: DocumentAnalysisResult;
  error?: string;
  processingTime: number;
}
