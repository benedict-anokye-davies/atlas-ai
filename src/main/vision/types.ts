/**
 * Vision System Types
 * 
 * Type definitions for the real-time screen understanding system.
 * Supports screen analysis, app detection, and proactive assistance.
 * 
 * @module vision/types
 */

// ============================================================================
// Screen Analysis Types
// ============================================================================

export interface ScreenCapture {
  id: string;
  timestamp: number;
  displayId: number;
  bounds: ScreenBounds;
  imageData: Buffer;
  format: 'png' | 'jpeg';
  quality: number;
}

export interface ScreenBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScreenAnalysisResult {
  id: string;
  timestamp: number;
  
  // Application context
  activeApp: ApplicationContext | null;
  visibleWindows: WindowInfo[];
  
  // Text extraction
  ocrResults: OCRResult[];
  
  // Visual elements
  uiElements: UIElement[];
  
  // LLM analysis
  sceneDescription: string;
  detectedIssues: DetectedIssue[];
  suggestions: ProactiveSuggestion[];
  
  // Context for conversation
  contextSummary: string;
  relevantEntities: ExtractedEntity[];
}

// ============================================================================
// Application Context
// ============================================================================

export interface ApplicationContext {
  name: string;
  processId: number;
  windowTitle: string;
  bundleId?: string;     // macOS
  executablePath?: string;
  
  // Detected app type
  appType: AppType;
  
  // App-specific context
  metadata: AppMetadata;
}

export type AppType = 
  | 'ide'            // VS Code, IntelliJ, etc.
  | 'browser'        // Chrome, Firefox, Edge, Brave
  | 'terminal'       // Command prompt, PowerShell, Terminal
  | 'office'         // Word, Excel, Google Docs
  | 'communication'  // Slack, Discord, Teams
  | 'design'         // Figma, Photoshop
  | 'media'          // Spotify, VLC
  | 'file-manager'   // Explorer, Finder
  | 'other';

export interface AppMetadata {
  // IDE-specific
  currentFile?: string;
  language?: string;
  cursorLine?: number;
  projectName?: string;
  
  // Browser-specific
  currentUrl?: string;
  pageTitle?: string;
  
  // Terminal-specific
  currentDirectory?: string;
  lastCommand?: string;
  
  // Generic
  [key: string]: unknown;
}

export interface WindowInfo {
  id: number;
  title: string;
  appName: string;
  bounds: ScreenBounds;
  isActive: boolean;
  isMinimized: boolean;
  zOrder: number;
}

// ============================================================================
// OCR Results
// ============================================================================

export interface OCRResult {
  text: string;
  confidence: number;
  bounds: ScreenBounds;
  lineNumber?: number;
  
  // Classification
  textType: TextType;
}

export type TextType = 
  | 'code'
  | 'error'
  | 'warning'
  | 'info'
  | 'url'
  | 'filepath'
  | 'command'
  | 'prose'
  | 'ui-label'
  | 'unknown';

// ============================================================================
// UI Elements
// ============================================================================

export interface UIElement {
  id: string;
  type: UIElementType;
  bounds: ScreenBounds;
  text?: string;
  value?: string;
  
  // Interactivity
  isClickable: boolean;
  isEditable: boolean;
  isEnabled: boolean;
  
  // Hierarchy
  parentId?: string;
  childIds: string[];
  
  // Accessibility
  role?: string;
  name?: string;
  description?: string;
}

export type UIElementType = 
  | 'button'
  | 'input'
  | 'text'
  | 'link'
  | 'image'
  | 'menu'
  | 'menu-item'
  | 'list'
  | 'list-item'
  | 'tab'
  | 'checkbox'
  | 'radio'
  | 'dropdown'
  | 'scrollbar'
  | 'window'
  | 'dialog'
  | 'tooltip'
  | 'icon'
  | 'unknown';

// ============================================================================
// Detected Issues
// ============================================================================

export interface DetectedIssue {
  id: string;
  type: IssueType;
  severity: 'info' | 'warning' | 'error' | 'critical';
  title: string;
  description: string;
  
  // Location on screen
  bounds?: ScreenBounds;
  
  // Source context
  sourceApp?: string;
  sourceFile?: string;
  sourceLine?: number;
  
  // Suggested fix
  suggestedFix?: SuggestedFix;
  
  // Confidence in detection
  confidence: number;
}

export type IssueType = 
  | 'compilation-error'
  | 'runtime-error'
  | 'lint-warning'
  | 'type-error'
  | 'syntax-error'
  | 'test-failure'
  | 'git-conflict'
  | 'security-warning'
  | 'performance-warning'
  | 'accessibility-issue'
  | 'ui-error'
  | 'network-error'
  | 'other';

export interface SuggestedFix {
  description: string;
  automated: boolean;
  commands?: string[];
  codeChange?: {
    file: string;
    line: number;
    oldCode: string;
    newCode: string;
  };
  confidence: number;
}

// ============================================================================
// Proactive Suggestions
// ============================================================================

export interface ProactiveSuggestion {
  id: string;
  type: SuggestionType;
  priority: 'low' | 'medium' | 'high';
  title: string;
  description: string;
  
  // Actions
  actions: SuggestionAction[];
  
  // Context
  context: string;
  trigger: string;
  
  // Timing
  expiresAt?: number;
  
  // User interaction
  dismissed: boolean;
  accepted: boolean;
}

export type SuggestionType = 
  | 'fix-error'
  | 'explain-code'
  | 'refactor'
  | 'documentation'
  | 'test-suggestion'
  | 'performance-tip'
  | 'shortcut-tip'
  | 'workflow-automation'
  | 'research'
  | 'reminder'
  | 'other';

export interface SuggestionAction {
  id: string;
  label: string;
  type: 'voice-command' | 'tool-execution' | 'open-url' | 'copy-text' | 'custom';
  payload: unknown;
}

// ============================================================================
// Extracted Entities
// ============================================================================

export interface ExtractedEntity {
  type: EntityType;
  value: string;
  normalizedValue?: string;
  confidence: number;
  bounds?: ScreenBounds;
}

export type EntityType = 
  | 'file-path'
  | 'url'
  | 'email'
  | 'phone'
  | 'date'
  | 'time'
  | 'code-symbol'
  | 'error-message'
  | 'version'
  | 'ip-address'
  | 'commit-hash'
  | 'issue-number'
  | 'person-name'
  | 'company'
  | 'other';

// ============================================================================
// Screen Analyzer Configuration
// ============================================================================

export interface ScreenAnalyzerConfig {
  // Capture settings
  captureInterval: number;      // ms between captures
  captureQuality: number;       // 0-100
  captureFormat: 'png' | 'jpeg';
  
  // Multi-monitor support
  targetDisplayId: number | null; // null = primary display, otherwise specific display ID
  
  // Analysis settings
  enableOCR: boolean;
  enableUIDetection: boolean;
  enableLLMAnalysis: boolean;
  
  // Performance
  maxCapturesPerMinute: number;
  analysisTimeout: number;
  
  // Privacy
  excludeApps: string[];        // Apps to never capture
  blurSensitiveAreas: boolean;
  
  // Proactive features
  enableProactiveSuggestions: boolean;
  suggestionCooldown: number;   // ms between suggestions
  
  // Context
  contextHistorySize: number;   // Number of analyses to keep
}

export const DEFAULT_SCREEN_ANALYZER_CONFIG: ScreenAnalyzerConfig = {
  captureInterval: 5000,       // 5 seconds
  captureQuality: 80,
  captureFormat: 'jpeg',
  
  targetDisplayId: null,       // null = use primary display
  
  enableOCR: true,
  enableUIDetection: true,
  enableLLMAnalysis: true,
  
  maxCapturesPerMinute: 20,
  analysisTimeout: 10000,
  
  excludeApps: ['1Password', 'KeePass', 'Bitwarden'],
  blurSensitiveAreas: true,
  
  enableProactiveSuggestions: true,
  suggestionCooldown: 30000,   // 30 seconds
  
  contextHistorySize: 10,
};

// ============================================================================
// Events
// ============================================================================

export type VisionEvent = 
  | { type: 'capture:completed'; capture: ScreenCapture }
  | { type: 'analysis:started'; captureId: string }
  | { type: 'analysis:completed'; result: ScreenAnalysisResult }
  | { type: 'issue:detected'; issue: DetectedIssue }
  | { type: 'suggestion:created'; suggestion: ProactiveSuggestion }
  | { type: 'app:changed'; app: ApplicationContext }
  | { type: 'context:updated'; context: ScreenAnalysisResult };
