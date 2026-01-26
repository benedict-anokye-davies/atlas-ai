/**
 * Automation Types
 * Types for contextual automation and triggers
 */

export interface AutomationTrigger {
  id: string;
  name: string;
  type: TriggerType;
  condition: TriggerCondition;
  actions: AutomationAction[];
  enabled: boolean;
  priority: number;
  cooldown?: number; // Minimum ms between executions
  lastTriggered?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type TriggerType =
  | 'time'
  | 'application'
  | 'file'
  | 'system'
  | 'voice'
  | 'location'
  | 'bluetooth'
  | 'network'
  | 'custom';

export interface TriggerCondition {
  type: TriggerType;
  // Time-based
  schedule?: ScheduleCondition;
  // Application-based
  application?: ApplicationCondition;
  // File-based
  file?: FileCondition;
  // System-based
  system?: SystemCondition;
  // Voice-based
  voice?: VoiceCondition;
  // Network-based
  network?: NetworkCondition;
  // Combined conditions
  all?: TriggerCondition[];
  any?: TriggerCondition[];
  not?: TriggerCondition;
}

export interface ScheduleCondition {
  type: 'once' | 'recurring';
  time?: string; // HH:mm format
  date?: string; // YYYY-MM-DD format
  days?: number[]; // 0-6, Sunday=0
  interval?: number; // Minutes for recurring
}

export interface ApplicationCondition {
  name?: string;
  processName?: string;
  event: 'launch' | 'close' | 'focus' | 'blur';
  titleContains?: string;
}

export interface FileCondition {
  path: string;
  event: 'create' | 'modify' | 'delete' | 'rename';
  pattern?: string;
}

export interface SystemCondition {
  event: 
    | 'startup'
    | 'shutdown'
    | 'sleep'
    | 'wake'
    | 'lock'
    | 'unlock'
    | 'battery_low'
    | 'battery_charging'
    | 'idle';
  idleTime?: number; // Seconds for idle event
  batteryLevel?: number;
}

export interface VoiceCondition {
  phrase?: string;
  patterns?: string[];
  intent?: string;
}

export interface NetworkCondition {
  event: 'connect' | 'disconnect' | 'change';
  ssid?: string;
  type?: 'wifi' | 'ethernet' | 'cellular';
}

export interface AutomationAction {
  id: string;
  type: ActionType;
  params: ActionParams;
  delay?: number;
  condition?: ActionCondition;
}

export type ActionType =
  | 'run_command'
  | 'open_application'
  | 'open_url'
  | 'send_notification'
  | 'speak'
  | 'execute_tool'
  | 'set_variable'
  | 'send_keys'
  | 'mouse_action'
  | 'clipboard'
  | 'custom';

export interface ActionParams {
  // run_command
  command?: string;
  args?: string[];
  cwd?: string;
  
  // open_application
  application?: string;
  
  // open_url
  url?: string;
  
  // send_notification
  title?: string;
  body?: string;
  icon?: string;
  
  // speak
  text?: string;
  voice?: string;
  
  // execute_tool
  toolName?: string;
  toolParams?: Record<string, unknown>;
  
  // set_variable
  variable?: string;
  value?: unknown;
  
  // send_keys
  keys?: string;
  modifiers?: string[];
  
  // mouse_action
  x?: number;
  y?: number;
  button?: 'left' | 'right' | 'middle';
  clicks?: number;
  
  // clipboard
  content?: string;
  
  // Custom
  custom?: Record<string, unknown>;
}

export interface ActionCondition {
  type: 'variable' | 'result' | 'expression';
  variable?: string;
  operator?: 'eq' | 'ne' | 'gt' | 'lt' | 'contains';
  value?: unknown;
  expression?: string;
}

export interface AutomationContext {
  trigger: AutomationTrigger;
  triggerData: Record<string, unknown>;
  variables: Map<string, unknown>;
  results: Map<string, unknown>;
  startTime: Date;
}

export interface ContextState {
  activeApplication: string;
  activeWindow: string;
  idleTime: number;
  isLocked: boolean;
  batteryLevel?: number;
  isCharging?: boolean;
  networkConnected: boolean;
  networkType?: string;
  ssid?: string;
  timeOfDay: string; // morning, afternoon, evening, night
  dayOfWeek: number;
  customVariables: Map<string, unknown>;
}

export interface AutomationLog {
  id: string;
  triggerId: string;
  triggerName: string;
  startTime: Date;
  endTime?: Date;
  success: boolean;
  actions: ActionLog[];
  error?: string;
}

export interface ActionLog {
  actionId: string;
  type: ActionType;
  startTime: Date;
  endTime?: Date;
  success: boolean;
  result?: unknown;
  error?: string;
}
