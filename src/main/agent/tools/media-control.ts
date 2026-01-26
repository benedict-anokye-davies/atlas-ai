/**
 * Atlas Desktop - Media Control Tool
 *
 * Controls media playback using system media keys.
 * Works with Spotify, Windows Media Player, YouTube, and any app that responds to media keys.
 *
 * @module agent/tools/media-control
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { AgentTool, ActionResult } from '../../../shared/types/agent';
import { createModuleLogger } from '../../utils/logger';

const execAsync = promisify(exec);
const logger = createModuleLogger('MediaControl');

/**
 * Media control action types
 */
export type MediaAction =
  | 'play'
  | 'pause'
  | 'playPause'
  | 'stop'
  | 'next'
  | 'previous'
  | 'volumeUp'
  | 'volumeDown'
  | 'mute';

/**
 * Media control input
 */
export interface MediaControlInput {
  action: MediaAction;
  amount?: number; // For volume adjustments (1-10 steps)
}

/**
 * Virtual key codes for media keys (Windows)
 */
const MEDIA_KEYS = {
  playPause: 0xb3, // VK_MEDIA_PLAY_PAUSE
  stop: 0xb2, // VK_MEDIA_STOP
  next: 0xb0, // VK_MEDIA_NEXT_TRACK
  previous: 0xb1, // VK_MEDIA_PREV_TRACK
  volumeUp: 0xaf, // VK_VOLUME_UP
  volumeDown: 0xae, // VK_VOLUME_DOWN
  mute: 0xad, // VK_VOLUME_MUTE
};

/**
 * Send a media key press using PowerShell
 */
async function sendMediaKey(keyCode: number): Promise<void> {
  // PowerShell script to send virtual key
  const script = `
    Add-Type -TypeDefinition @"
    using System;
    using System.Runtime.InteropServices;
    public class MediaKeys {
        [DllImport("user32.dll")]
        public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);
        public const int KEYEVENTF_KEYUP = 0x0002;
    }
"@
    [MediaKeys]::keybd_event(${keyCode}, 0, 0, 0)
    Start-Sleep -Milliseconds 50
    [MediaKeys]::keybd_event(${keyCode}, 0, [MediaKeys]::KEYEVENTF_KEYUP, 0)
  `;

  await execAsync(`powershell -NoProfile -Command "${script.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
    windowsHide: true,
  });
}

/**
 * Execute a media control action
 */
export async function executeMediaControl(input: MediaControlInput): Promise<ActionResult> {
  const { action, amount = 1 } = input;

  logger.info('Executing media control', { action, amount });

  try {
    switch (action) {
      case 'play':
      case 'pause':
      case 'playPause':
        await sendMediaKey(MEDIA_KEYS.playPause);
        return {
          success: true,
          data: { action: 'playPause', result: 'Toggled play/pause' },
        };

      case 'stop':
        await sendMediaKey(MEDIA_KEYS.stop);
        return {
          success: true,
          data: { action: 'stop', result: 'Stopped playback' },
        };

      case 'next':
        await sendMediaKey(MEDIA_KEYS.next);
        return {
          success: true,
          data: { action: 'next', result: 'Skipped to next track' },
        };

      case 'previous':
        await sendMediaKey(MEDIA_KEYS.previous);
        return {
          success: true,
          data: { action: 'previous', result: 'Went to previous track' },
        };

      case 'volumeUp':
        for (let i = 0; i < amount; i++) {
          await sendMediaKey(MEDIA_KEYS.volumeUp);
          await new Promise((r) => setTimeout(r, 50));
        }
        return {
          success: true,
          data: { action: 'volumeUp', amount, result: `Increased volume by ${amount} steps` },
        };

      case 'volumeDown':
        for (let i = 0; i < amount; i++) {
          await sendMediaKey(MEDIA_KEYS.volumeDown);
          await new Promise((r) => setTimeout(r, 50));
        }
        return {
          success: true,
          data: { action: 'volumeDown', amount, result: `Decreased volume by ${amount} steps` },
        };

      case 'mute':
        await sendMediaKey(MEDIA_KEYS.mute);
        return {
          success: true,
          data: { action: 'mute', result: 'Toggled mute' },
        };

      default:
        return {
          success: false,
          error: `Unknown media action: ${action}`,
        };
    }
  } catch (error) {
    const err = error as Error;
    logger.error('Media control failed', { action, error: err.message });
    return {
      success: false,
      error: `Failed to execute media control: ${err.message}`,
    };
  }
}

/**
 * Media Control Agent Tool definition
 */
export const mediaControlTool: AgentTool = {
  name: 'media_control',
  description: `Control media playback (Spotify, YouTube, any media player).
Actions:
- play/pause/playPause: Toggle playback
- stop: Stop playback
- next: Skip to next track
- previous: Go to previous track
- volumeUp: Increase volume (optional amount 1-10)
- volumeDown: Decrease volume (optional amount 1-10)
- mute: Toggle mute

Works with any app that responds to media keys (Spotify, VLC, YouTube in browser, etc.)`,
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['play', 'pause', 'playPause', 'stop', 'next', 'previous', 'volumeUp', 'volumeDown', 'mute'],
        description: 'The media action to perform',
      },
      amount: {
        type: 'number',
        description: 'Number of volume steps (1-10) for volumeUp/volumeDown. Default is 1.',
        minimum: 1,
        maximum: 10,
      },
    },
    required: ['action'],
  },
  execute: async (input: Record<string, unknown>): Promise<ActionResult> => {
    return executeMediaControl(input as unknown as MediaControlInput);
  },
};

/**
 * Convenience functions for direct use
 */
export const mediaControls = {
  play: () => executeMediaControl({ action: 'playPause' }),
  pause: () => executeMediaControl({ action: 'playPause' }),
  playPause: () => executeMediaControl({ action: 'playPause' }),
  stop: () => executeMediaControl({ action: 'stop' }),
  next: () => executeMediaControl({ action: 'next' }),
  previous: () => executeMediaControl({ action: 'previous' }),
  volumeUp: (amount = 3) => executeMediaControl({ action: 'volumeUp', amount }),
  volumeDown: (amount = 3) => executeMediaControl({ action: 'volumeDown', amount }),
  mute: () => executeMediaControl({ action: 'mute' }),
};

export default mediaControlTool;
