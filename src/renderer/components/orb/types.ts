/**
 * @fileoverview Orb State Types
 * Shared type definitions for orb visualization state
 * 
 * @module orb/types
 */

import { STATE_COLORS } from './geometry';

/**
 * Orb visualization states
 * Maps to voice pipeline states for visual feedback
 * 
 * - idle: Waiting for input, gentle breathing animation
 * - listening: Actively recording audio, responsive to voice
 * - thinking: Processing user input with LLM
 * - speaking: Playing TTS output
 * - error: Error state with red visual indicator
 */
export type OrbState = keyof typeof STATE_COLORS;

/**
 * Alias for backwards compatibility - same as OrbState
 */
export type AtlasState = OrbState;
