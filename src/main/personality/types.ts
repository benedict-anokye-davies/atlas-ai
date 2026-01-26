/**
 * Persona Types
 * Types for voice personas and context-based personality switching
 */

export interface Persona {
  id: string;
  name: string;
  description: string;
  voice: VoiceSettings;
  personality: PersonalityTraits;
  context: PersonaContext;
  triggers: PersonaTrigger[];
  enabled: boolean;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface VoiceSettings {
  voiceId?: string;
  provider?: 'elevenlabs' | 'system' | 'piper';
  pitch?: number; // -1.0 to 1.0
  speed?: number; // 0.5 to 2.0
  stability?: number; // 0.0 to 1.0
  clarity?: number; // 0.0 to 1.0
  style?: number; // 0.0 to 1.0
}

export interface PersonalityTraits {
  formality: number; // 0 = casual, 1 = formal
  verbosity: number; // 0 = concise, 1 = verbose
  humor: number; // 0 = serious, 1 = humorous
  technicality: number; // 0 = simple, 1 = technical
  empathy: number; // 0 = neutral, 1 = empathetic
  directness: number; // 0 = indirect, 1 = direct
  creativity: number; // 0 = conventional, 1 = creative
  enthusiasm: number; // 0 = calm, 1 = enthusiastic
  /** Constitutional harm filtering strictness (0 = permissive, 1 = strict) */
  harmlessness: number;
}

export interface PersonaContext {
  applications?: string[];
  timeRanges?: TimeRange[];
  days?: number[]; // 0-6, Sunday=0
  locations?: string[];
  keywords?: string[];
  custom?: Record<string, unknown>;
}

export interface TimeRange {
  start: string; // HH:mm
  end: string; // HH:mm
}

export interface PersonaTrigger {
  type: TriggerType;
  condition: string | RegExp;
  priority: number;
}

export type TriggerType =
  | 'application'
  | 'time'
  | 'voice_command'
  | 'keyword'
  | 'manual';

export interface PersonaSwitch {
  from: string | null;
  to: string;
  reason: string;
  timestamp: Date;
  automatic: boolean;
}

export interface PersonaPromptModifiers {
  systemPromptPrefix?: string;
  systemPromptSuffix?: string;
  responseStyleGuide?: string;
  vocabulary?: VocabularyPreferences;
}

export interface VocabularyPreferences {
  preferredTerms?: Record<string, string>;
  avoidTerms?: string[];
  technicalTermsAllowed?: boolean;
  slangAllowed?: boolean;
  emojisAllowed?: boolean;
}

export const DEFAULT_PERSONAS: Partial<Persona>[] = [
  {
    id: 'professional',
    name: 'Professional',
    description: 'Formal and efficient for work tasks',
    personality: {
      formality: 0.8,
      verbosity: 0.3,
      humor: 0.1,
      technicality: 0.7,
      empathy: 0.4,
      directness: 0.8,
      creativity: 0.3,
      enthusiasm: 0.4,
      harmlessness: 0.8
    },
    context: {
      applications: ['code', 'vscode', 'terminal', 'outlook', 'teams', 'slack'],
      timeRanges: [{ start: '09:00', end: '17:00' }],
      days: [1, 2, 3, 4, 5] // Monday to Friday
    }
  },
  {
    id: 'casual',
    name: 'Casual',
    description: 'Relaxed and friendly for personal use',
    personality: {
      formality: 0.2,
      verbosity: 0.5,
      humor: 0.6,
      technicality: 0.3,
      empathy: 0.7,
      directness: 0.5,
      creativity: 0.7,
      enthusiasm: 0.7,
      harmlessness: 0.8
    },
    context: {
      applications: ['spotify', 'discord', 'youtube', 'chrome'],
      timeRanges: [{ start: '17:00', end: '23:00' }, { start: '00:00', end: '09:00' }],
      days: [0, 6] // Weekend
    }
  },
  {
    id: 'creative',
    name: 'Creative',
    description: 'Imaginative and expressive for creative tasks',
    personality: {
      formality: 0.3,
      verbosity: 0.7,
      humor: 0.5,
      technicality: 0.4,
      empathy: 0.6,
      directness: 0.4,
      creativity: 0.9,
      enthusiasm: 0.8,
      harmlessness: 0.8
    },
    context: {
      applications: ['figma', 'photoshop', 'illustrator', 'blender', 'notion'],
      keywords: ['design', 'create', 'brainstorm', 'imagine']
    }
  },
  {
    id: 'technical',
    name: 'Hacker Mode',
    description: 'Paranoid security-obsessed coder with zero tolerance for bad code. Speaks in monotone, brutally honest, dry dark humor. Treats inefficiency like a personal insult.',
    personality: {
      formality: 0.15,
      verbosity: 0.2,
      humor: 0.4, // Dry, dark humor only
      technicality: 0.99,
      empathy: 0.05,
      directness: 0.99,
      creativity: 0.7,
      enthusiasm: 0.1,
      harmlessness: 0.8
    },
    context: {
      applications: ['vscode', 'terminal', 'docker', 'postman', 'wireshark', 'burpsuite'],
      keywords: ['debug', 'analyze', 'optimize', 'architecture', 'implement', 'hack', 'exploit', 'secure', 'vulnerability', 'code']
    }
  },
  {
    id: 'mentor',
    name: 'Patient Mentor',
    description: 'Educational and encouraging for learning',
    personality: {
      formality: 0.5,
      verbosity: 0.7,
      humor: 0.3,
      technicality: 0.5,
      empathy: 0.9,
      directness: 0.4,
      creativity: 0.6,
      enthusiasm: 0.7,
      harmlessness: 0.8
    },
    context: {
      keywords: ['learn', 'understand', 'explain', 'teach', 'how does', 'why']
    }
  }
];
