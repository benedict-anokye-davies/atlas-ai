/**
 * Browser Agent Types
 *
 * Comprehensive type definitions for the Atlas Browser Agent system.
 * Designed to surpass Claude for Chrome and Google Project Mariner.
 *
 * @module agent/browser-agent/types
 */

// ============================================================================
// Core State Types
// ============================================================================

/**
 * Complete browser state for LLM context
 */
export interface BrowserState {
  /** Current page URL */
  url: string;
  /** Page title */
  title: string;
  /** Viewport dimensions */
  viewport: { width: number; height: number };
  /** Screenshot as base64 (optional, for vision) */
  screenshot?: string;
  /** Serialized DOM elements with indices */
  elements: IndexedElement[];
  /** Accessibility tree summary */
  accessibilityTree?: AccessibilityNode[];
  /** Page load state */
  loadState: 'loading' | 'interactive' | 'complete';
  /** Framework detected (React, Vue, Angular, etc.) */
  detectedFramework?: DetectedFramework;
  /** Active modals/dialogs */
  activeModals: ModalInfo[];
  /** Page scroll position */
  scrollPosition: { x: number; y: number };
  /** Total scrollable area */
  scrollDimensions: { width: number; height: number };
  /** Current focused element index */
  focusedElementIndex?: number;
  /** Tab information */
  tabInfo: TabState;
  /** Timestamp of capture */
  timestamp: number;
}

/**
 * Serialized DOM element with index for LLM reference
 */
export interface IndexedElement {
  /** Unique index for this session (1-based for human readability) */
  index: number;
  /** HTML tag name */
  tag: string;
  /** Element role (from accessibility or inferred) */
  role: ElementRole;
  /** Visible text content (truncated) */
  text: string;
  /** Input value if applicable */
  value?: string;
  /** Placeholder text */
  placeholder?: string;
  /** ARIA label or accessible name */
  ariaLabel?: string;
  /** CSS selector that uniquely identifies this element */
  selector: string;
  /** XPath as fallback */
  xpath: string;
  /** Bounding rectangle on viewport */
  bounds: ElementBounds;
  /** Center point for clicking */
  center: { x: number; y: number };
  /** Element attributes subset */
  attributes: ElementAttributes;
  /** Interaction capabilities */
  interactivity: ElementInteractivity;
  /** Semantic purpose (inferred) */
  semanticPurpose?: SemanticPurpose;
  /** Visual state */
  visualState: ElementVisualState;
  /** Parent element index (for hierarchy) */
  parentIndex?: number;
  /** Depth in DOM tree */
  depth: number;
}

export interface ElementBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Is element visible in viewport */
  isInViewport: boolean;
  /** Is element actually visible (not hidden by CSS) */
  isVisible: boolean;
}

export interface ElementAttributes {
  id?: string;
  className?: string;
  name?: string;
  type?: string;
  href?: string;
  src?: string;
  alt?: string;
  title?: string;
  disabled?: boolean;
  readonly?: boolean;
  required?: boolean;
  checked?: boolean;
  selected?: boolean;
  /** Data attributes (commonly used by frameworks) */
  dataAttributes?: Record<string, string>;
}

export interface ElementInteractivity {
  isClickable: boolean;
  isTypeable: boolean;
  isScrollable: boolean;
  isDraggable: boolean;
  isSelectable: boolean;
  isExpandable: boolean;
  isCheckable: boolean;
  hasFocus: boolean;
  isHovered: boolean;
}

export interface ElementVisualState {
  isVisible: boolean;
  isEnabled: boolean;
  isSelected: boolean;
  isExpanded: boolean;
  isLoading: boolean;
  opacity: number;
  zIndex: number;
}

export type ElementRole =
  | 'button'
  | 'link'
  | 'textbox'
  | 'searchbox'
  | 'combobox'
  | 'listbox'
  | 'option'
  | 'checkbox'
  | 'radio'
  | 'switch'
  | 'slider'
  | 'spinbutton'
  | 'menu'
  | 'menuitem'
  | 'menubar'
  | 'tab'
  | 'tabpanel'
  | 'tablist'
  | 'dialog'
  | 'alert'
  | 'alertdialog'
  | 'tooltip'
  | 'progressbar'
  | 'navigation'
  | 'main'
  | 'header'
  | 'footer'
  | 'article'
  | 'section'
  | 'form'
  | 'image'
  | 'figure'
  | 'table'
  | 'row'
  | 'cell'
  | 'grid'
  | 'tree'
  | 'treeitem'
  | 'heading'
  | 'paragraph'
  | 'list'
  | 'listitem'
  | 'generic'
  | 'unknown';

export type SemanticPurpose =
  | 'login'
  | 'signup'
  | 'search'
  | 'submit'
  | 'cancel'
  | 'close'
  | 'navigation'
  | 'cart'
  | 'checkout'
  | 'payment'
  | 'settings'
  | 'profile'
  | 'logout'
  | 'social-share'
  | 'download'
  | 'upload'
  | 'delete'
  | 'edit'
  | 'save'
  | 'copy'
  | 'paste'
  | 'undo'
  | 'redo'
  | 'refresh'
  | 'filter'
  | 'sort'
  | 'pagination'
  | 'cookie-consent'
  | 'newsletter'
  | 'chat-widget'
  | 'unknown';

// ============================================================================
// Accessibility Tree Types
// ============================================================================

export interface AccessibilityNode {
  nodeId: string;
  role: string;
  name?: string;
  value?: string;
  description?: string;
  properties: AccessibilityProperty[];
  children: AccessibilityNode[];
  bounds?: ElementBounds;
  elementIndex?: number; // Link to IndexedElement
}

export interface AccessibilityProperty {
  name: string;
  value: string | number | boolean;
}

// ============================================================================
// Framework Detection
// ============================================================================

export type DetectedFramework =
  | { name: 'react'; version?: string; isNextJs?: boolean }
  | { name: 'vue'; version?: string; isNuxt?: boolean }
  | { name: 'angular'; version?: string }
  | { name: 'svelte'; version?: string; isSvelteKit?: boolean }
  | { name: 'solid'; version?: string }
  | { name: 'jquery'; version?: string }
  | { name: 'vanilla' }
  | { name: 'unknown' };

// ============================================================================
// Modal/Dialog Types
// ============================================================================

export interface ModalInfo {
  type: ModalType;
  title?: string;
  content?: string;
  bounds: ElementBounds;
  /** Index of primary action button */
  primaryActionIndex?: number;
  /** Index of dismiss button */
  dismissButtonIndex?: number;
  /** Is blocking interaction */
  isBlocking: boolean;
}

export type ModalType =
  | 'dialog'
  | 'alert'
  | 'confirm'
  | 'prompt'
  | 'cookie-consent'
  | 'newsletter-popup'
  | 'login-modal'
  | 'paywall'
  | 'chat-widget'
  | 'notification'
  | 'tooltip'
  | 'dropdown'
  | 'unknown';

// ============================================================================
// Tab State
// ============================================================================

export interface TabState {
  tabId: string;
  index: number;
  isActive: boolean;
  isPinned: boolean;
  isAudible: boolean;
  isMuted: boolean;
}

// ============================================================================
// Agent Step Types
// ============================================================================

/**
 * Agent reasoning and action output
 */
export interface AgentStep {
  /** Step number in sequence */
  stepNumber: number;
  /** Agent's thinking process (chain of thought) */
  thinking: string;
  /** Evaluation of previous action result */
  evaluationOfPrevious?: StepEvaluation;
  /** Working memory summary */
  memory: string;
  /** Goal for this step */
  currentGoal: string;
  /** Next goal after this step */
  nextGoal?: string;
  /** Actions to execute */
  actions: BrowserAction[];
  /** Expected outcome */
  expectedOutcome: string;
  /** Confidence in this step (0-1) */
  confidence: number;
  /** Is this potentially the final step */
  isLikelyFinal: boolean;
  /** Timestamp */
  timestamp: number;
}

export interface StepEvaluation {
  success: boolean;
  matchedExpectation: boolean;
  observations: string;
  unexpectedChanges?: string;
  needsRecovery: boolean;
  recoveryStrategy?: RecoveryStrategyType;
}

// ============================================================================
// Browser Actions
// ============================================================================

/**
 * Simplified action intent for internal use (predictions, speculation, NLU)
 * These are converted to full BrowserAction when executed
 */
export interface ActionIntent {
  type: string;
  description?: string;
  elementIndex?: number;
  selector?: string;
  text?: string;
  url?: string;
  value?: string;
  direction?: 'up' | 'down' | 'left' | 'right';
  pressEnter?: boolean;
  dataType?: string;
  condition?: string;
  timeout?: number;
}

export type BrowserAction =
  | ClickAction
  | TypeAction
  | ScrollAction
  | NavigateAction
  | WaitAction
  | KeyPressAction
  | HoverAction
  | DragAction
  | SelectAction
  | UploadAction
  | ExtractAction
  | ScreenshotAction
  | TabAction
  | ExecuteScriptAction;

export interface BaseAction {
  /** Human-readable description */
  description: string;
  /** Element index to target (if applicable) */
  elementIndex?: number;
  /** Fallback selector if index fails */
  fallbackSelector?: string;
  /** Timeout for this action */
  timeout?: number;
  /** Should verify after action */
  requiresVerification?: boolean;
}

export interface ClickAction extends BaseAction {
  type: 'click';
  clickType: 'single' | 'double' | 'triple' | 'right' | 'middle';
  /** Click at specific coordinates (for canvas/maps) */
  coordinates?: { x: number; y: number };
  /** Modifiers held during click */
  modifiers?: ('ctrl' | 'alt' | 'shift' | 'meta')[];
}

export interface TypeAction extends BaseAction {
  type: 'type';
  text: string;
  /** Clear existing content first */
  clearFirst?: boolean;
  /** Type character by character with delay */
  humanLike?: boolean;
  /** Press Enter after typing */
  pressEnterAfter?: boolean;
  /** Mask in logs (for passwords) */
  sensitive?: boolean;
}

export interface ScrollAction extends BaseAction {
  type: 'scroll';
  direction: 'up' | 'down' | 'left' | 'right';
  /** Scroll amount in pixels */
  amount?: number;
  /** Scroll to specific element */
  scrollToElement?: boolean;
  /** Smooth scroll */
  smooth?: boolean;
}

export interface NavigateAction extends BaseAction {
  type: 'navigate';
  url: string;
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
}

export interface WaitAction extends BaseAction {
  type: 'wait';
  waitFor:
    | { type: 'time'; ms: number }
    | { type: 'element'; selector: string; state: 'visible' | 'hidden' | 'attached' | 'detached' }
    | { type: 'navigation' }
    | { type: 'networkidle' }
    | { type: 'function'; fn: string }
    | { type: 'urlChange'; urlPattern?: string }
    | { type: 'textContent'; text: string; selector?: string };
}

export interface KeyPressAction extends BaseAction {
  type: 'keypress';
  key: string;
  modifiers?: ('ctrl' | 'alt' | 'shift' | 'meta')[];
  /** Hold key for duration */
  holdMs?: number;
}

export interface HoverAction extends BaseAction {
  type: 'hover';
  /** Hover duration before next action */
  durationMs?: number;
}

export interface DragAction extends BaseAction {
  type: 'drag';
  /** Target element or coordinates */
  target: { elementIndex: number } | { x: number; y: number };
}

export interface SelectAction extends BaseAction {
  type: 'select';
  /** Value(s) to select */
  values: string[];
  /** Select by value, label, or index */
  selectBy: 'value' | 'label' | 'index';
}

export interface UploadAction extends BaseAction {
  type: 'upload';
  /** File path(s) to upload */
  filePaths: string[];
}

export interface ExtractAction extends BaseAction {
  type: 'extract';
  /** What to extract */
  extractType: 'text' | 'html' | 'attribute' | 'table' | 'links' | 'images';
  /** Attribute name if extractType is 'attribute' */
  attributeName?: string;
  /** Store result with this key */
  storeAs: string;
}

export interface ScreenshotAction extends BaseAction {
  type: 'screenshot';
  /** Full page or element only */
  fullPage?: boolean;
  /** Store result with this key */
  storeAs: string;
}

export interface TabAction extends BaseAction {
  type: 'tab';
  tabAction: 'new' | 'close' | 'switch' | 'duplicate';
  /** Tab ID for switch action */
  targetTabId?: string;
  /** URL for new tab */
  url?: string;
}

export interface ExecuteScriptAction extends BaseAction {
  type: 'execute';
  /** JavaScript code to execute */
  script: string;
  /** Arguments to pass to script */
  args?: unknown[];
  /** Store result with this key */
  storeAs?: string;
}

// ============================================================================
// Session & Profile Types
// ============================================================================

export interface BrowserSession {
  id: string;
  profileId?: string;
  startedAt: number;
  lastActiveAt: number;
  tabs: TabState[];
  activeTabId: string;
  cookies: SessionCookie[];
  localStorage: Record<string, Record<string, string>>;
  sessionStorage: Record<string, Record<string, string>>;
}

export interface BrowserProfile {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Domains this profile is used for */
  domains: string[];
  /** Stored cookies (encrypted at rest) */
  cookies: SessionCookie[];
  /** Stored localStorage (per origin) */
  localStorage: Record<string, Record<string, string>>;
  /** User preferences */
  preferences: ProfilePreferences;
  /** Authentication state per domain */
  authState: Record<string, AuthState>;
}

export interface SessionCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
}

export interface ProfilePreferences {
  /** Default user agent */
  userAgent?: string;
  /** Viewport size */
  viewport?: { width: number; height: number };
  /** Timezone */
  timezone?: string;
  /** Locale */
  locale?: string;
  /** Geolocation */
  geolocation?: { latitude: number; longitude: number };
}

export interface AuthState {
  isLoggedIn: boolean;
  lastLogin?: number;
  username?: string;
  loginMethod?: 'form' | 'oauth' | 'sso' | 'magic-link';
}

// ============================================================================
// Error Recovery Types
// ============================================================================

export interface RecoveryStrategy {
  type: RecoveryStrategyType;
  maxRetries: number;
  retryDelayMs: number;
  backoffMultiplier: number;
  fallbackActions?: BrowserAction[];
  requiresHumanIntervention: boolean;
  escalationMessage?: string;
}

export type RecoveryStrategyType =
  | 'retry'
  | 'retry-with-backoff'
  | 'alternative-selector'
  | 'scroll-into-view'
  | 'wait-and-retry'
  | 'refresh-page'
  | 'navigate-back'
  | 'close-modal'
  | 'dismiss-popup'
  | 'captcha-wait'
  | 'human-intervention'
  | 'abort';

export interface ExecutionError {
  type: ErrorType;
  message: string;
  step: number;
  action: BrowserAction;
  screenshot?: string;
  domState?: Partial<BrowserState>;
  recoveryAttempted: RecoveryStrategyType[];
  timestamp: number;
}

/** Alias for ExecutionError */
export type BrowserError = ExecutionError;

/** Result of a step execution */
export interface StepResult {
  success: boolean;
  action?: BrowserAction;
  error?: string;
  screenshot?: string;
  duration?: number;
}

export type ErrorType =
  | 'element-not-found'
  | 'element-not-visible'
  | 'element-not-interactable'
  | 'timeout'
  | 'navigation-failed'
  | 'network-error'
  | 'captcha-detected'
  | 'bot-detection'
  | 'rate-limited'
  | 'auth-required'
  | 'permission-denied'
  | 'unexpected-modal'
  | 'page-crash'
  | 'unknown';

// ============================================================================
// Task Types
// ============================================================================

export interface BrowserTask {
  id: string;
  /** High-level objective */
  objective: string;
  /** Detailed instructions */
  instructions?: string;
  /** Starting URL (optional) */
  startUrl?: string;
  /** Profile to use */
  profileId?: string;
  /** Maximum steps allowed */
  maxSteps: number;
  /** Timeout for entire task */
  timeoutMs: number;
  /** Current status */
  status: TaskStatus;
  /** Execution history */
  history: TaskHistoryEntry[];
  /** Extracted data */
  extractedData: Record<string, unknown>;
  /** Errors encountered */
  errors: ExecutionError[];
  /** Task timing */
  timing: TaskTiming;
  /** Confirmation requirements */
  confirmations: ConfirmationConfig;
}

export type TaskStatus =
  | 'pending'
  | 'planning'
  | 'running'
  | 'paused'
  | 'waiting-confirmation'
  | 'waiting-captcha'
  | 'completed'
  | 'failed'
  | 'aborted';

export interface TaskHistoryEntry {
  stepNumber: number;
  agentStep: AgentStep;
  browserStateBefore: Partial<BrowserState>;
  browserStateAfter?: Partial<BrowserState>;
  actionResults: ActionResult[];
  screenshot?: string;
  duration: number;
  timestamp: number;
}

export interface ActionResult {
  action: BrowserAction;
  success: boolean;
  error?: string;
  extractedData?: unknown;
  screenshotAfter?: string;
}

export interface TaskTiming {
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  totalDuration?: number;
  planningDuration?: number;
  executionDuration?: number;
  waitingDuration?: number;
}

export interface ConfirmationConfig {
  /** Require confirmation before starting */
  confirmStart: boolean;
  /** Require confirmation for each step */
  confirmEachStep: boolean;
  /** Require confirmation for sensitive actions */
  confirmSensitiveActions: boolean;
  /** Sensitive action types that require confirmation */
  sensitiveActionTypes: SensitiveActionType[];
}

export type SensitiveActionType =
  | 'form-submit'
  | 'payment'
  | 'login'
  | 'signup'
  | 'delete'
  | 'file-upload'
  | 'navigation-away'
  | 'external-link';

// ============================================================================
// Stealth Mode Types
// ============================================================================

export interface StealthConfig {
  enabled: boolean;
  /** Randomize delays between actions */
  randomizeTimings: boolean;
  timingRange: { min: number; max: number };
  /** Simulate human-like mouse movements */
  humanMouseMovements: boolean;
  /** Use random scroll patterns */
  naturalScrolling: boolean;
  /** Fingerprint protection */
  fingerprintProtection: FingerprintConfig;
  /** Proxy configuration */
  proxy?: ProxyConfig;
}

export interface FingerprintConfig {
  /** Randomize canvas fingerprint */
  canvasNoise: boolean;
  /** Randomize WebGL fingerprint */
  webglNoise: boolean;
  /** Randomize audio fingerprint */
  audioNoise: boolean;
  /** Override navigator properties */
  navigatorOverrides: boolean;
  /** Override screen properties */
  screenOverrides: boolean;
  /** Override timezone */
  timezoneOverride?: string;
}

export interface ProxyConfig {
  type: 'http' | 'https' | 'socks4' | 'socks5';
  host: string;
  port: number;
  username?: string;
  password?: string;
  rotation?: 'per-request' | 'per-session' | 'manual';
}

// ============================================================================
// Set-of-Mark Types
// ============================================================================

export interface SetOfMarkConfig {
  enabled: boolean;
  /** Style for markers */
  markerStyle: MarkerStyle;
  /** Maximum elements to mark */
  maxMarkers: number;
  /** Only mark visible elements */
  visibleOnly: boolean;
  /** Minimum element size to mark */
  minElementSize: { width: number; height: number };
  /** Element types to mark */
  markableRoles: ElementRole[];
}

export interface MarkerStyle {
  /** Background color */
  backgroundColor: string;
  /** Text color */
  textColor: string;
  /** Font size */
  fontSize: number;
  /** Padding */
  padding: number;
  /** Border radius */
  borderRadius: number;
  /** Opacity */
  opacity: number;
  /** Z-index */
  zIndex: number;
}

export interface AnnotatedScreenshot {
  /** Base64 encoded image with markers */
  image: string;
  /** Dimensions */
  width: number;
  height: number;
  /** Mapping of marker index to element info */
  elementMap: Map<number, IndexedElement>;
  /** Markers that were rendered */
  renderedMarkers: RenderedMarker[];
  /** Timestamp */
  timestamp: number;
}

export interface RenderedMarker {
  index: number;
  position: { x: number; y: number };
  elementBounds: ElementBounds;
  wasClipped: boolean;
}

// ============================================================================
// Agent Configuration
// ============================================================================

export interface BrowserAgentConfig {
  /** LLM model to use for planning */
  planningModel: string;
  /** LLM model to use for vision analysis */
  visionModel: string;
  /** Temperature for planning */
  planningTemperature: number;
  /** Maximum tokens for planning response */
  maxPlanningTokens: number;
  /** Default task settings */
  defaultTaskConfig: Partial<BrowserTask>;
  /** Stealth configuration */
  stealth: StealthConfig;
  /** Set-of-Mark configuration */
  setOfMark: SetOfMarkConfig;
  /** Recovery settings */
  recovery: RecoveryStrategy;
  /** Confirmation defaults */
  confirmations: ConfirmationConfig;
  /** Debug settings */
  debug: DebugConfig;
  /** Stealth mode configuration (alias for stealth) */
  stealthMode: StealthConfig;
  /** Maximum number of concurrent tabs */
  maxTabs: number;
  /** Require user confirmation before executing tasks */
  requireConfirmation: boolean;
}

export interface DebugConfig {
  /** Save screenshots at each step */
  saveScreenshots: boolean;
  /** Save DOM state at each step */
  saveDomState: boolean;
  /** Log detailed timing information */
  logTiming: boolean;
  /** Record video of execution */
  recordVideo: boolean;
  /** Directory for debug artifacts */
  artifactDir: string;
}

// ============================================================================
// Default Configurations
// ============================================================================

export const DEFAULT_STEALTH_CONFIG: StealthConfig = {
  enabled: true,
  randomizeTimings: true,
  timingRange: { min: 100, max: 500 },
  humanMouseMovements: true,
  naturalScrolling: true,
  fingerprintProtection: {
    canvasNoise: true,
    webglNoise: true,
    audioNoise: true,
    navigatorOverrides: true,
    screenOverrides: false,
  },
};

export const DEFAULT_SET_OF_MARK_CONFIG: SetOfMarkConfig = {
  enabled: true,
  markerStyle: {
    backgroundColor: '#FF5722',
    textColor: '#FFFFFF',
    fontSize: 12,
    padding: 4,
    borderRadius: 4,
    opacity: 0.9,
    zIndex: 999999,
  },
  maxMarkers: 100,
  visibleOnly: true,
  minElementSize: { width: 10, height: 10 },
  markableRoles: [
    'button',
    'link',
    'textbox',
    'searchbox',
    'combobox',
    'checkbox',
    'radio',
    'switch',
    'menuitem',
    'tab',
    'option',
    'listitem',
  ],
};

export const DEFAULT_RECOVERY_STRATEGY: RecoveryStrategy = {
  type: 'retry-with-backoff',
  maxRetries: 3,
  retryDelayMs: 1000,
  backoffMultiplier: 2,
  requiresHumanIntervention: false,
};

export const DEFAULT_CONFIRMATION_CONFIG: ConfirmationConfig = {
  confirmStart: false,
  confirmEachStep: false,
  confirmSensitiveActions: true,
  sensitiveActionTypes: ['payment', 'login', 'signup', 'delete', 'form-submit'],
};

export const DEFAULT_DEBUG_CONFIG: DebugConfig = {
  saveScreenshots: true,
  saveDomState: false,
  logTiming: true,
  recordVideo: false,
  artifactDir: '',
};

export const DEFAULT_AGENT_CONFIG: BrowserAgentConfig = {
  planningModel: 'accounts/fireworks/models/llama-v3p1-405b-instruct',
  visionModel: 'accounts/fireworks/models/llama-v3p2-11b-vision-instruct',
  planningTemperature: 0.3,
  maxPlanningTokens: 4096,
  defaultTaskConfig: {
    maxSteps: 20,
  },
  stealth: DEFAULT_STEALTH_CONFIG,
  setOfMark: DEFAULT_SET_OF_MARK_CONFIG,
  recovery: DEFAULT_RECOVERY_STRATEGY,
  confirmations: DEFAULT_CONFIRMATION_CONFIG,
  debug: DEFAULT_DEBUG_CONFIG,
  stealthMode: DEFAULT_STEALTH_CONFIG,
  maxTabs: 10,
  requireConfirmation: false,
};