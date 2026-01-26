/**
 * Atlas Desktop - Phone/SMS Tool
 * Voice calls and SMS messaging via Twilio
 */

import { AgentTool, ActionResult } from '../../../shared/types/agent';
import { createModuleLogger } from '../../utils/logger';
import { getTwilioManager, TwilioManager } from '../../communication/twilio';

const logger = createModuleLogger('PhoneTool');

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get initialized Twilio manager or return error
 */
function getTwilio(): TwilioManager | null {
  const twilio = getTwilioManager();
  if (!twilio.isInitialized()) {
    return null;
  }
  return twilio;
}

/**
 * Format phone number to E.164 if needed
 */
function formatPhone(phone: string): string {
  return TwilioManager.formatPhoneNumber(phone);
}

// =============================================================================
// Send SMS Tool
// =============================================================================

/**
 * Send SMS message tool
 */
export const sendSMSTool: AgentTool = {
  name: 'phone_send_sms',
  description:
    'Send an SMS text message to a phone number. The message will be sent from the configured Twilio phone number.',
  parameters: {
    type: 'object',
    properties: {
      to: {
        type: 'string',
        description: 'Phone number to send to (E.164 format preferred, e.g., +15551234567)',
      },
      message: {
        type: 'string',
        description: 'The text message content to send',
      },
      mediaUrl: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional array of URLs for MMS attachments (images, etc.)',
      },
    },
    required: ['to', 'message'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const to = params.to as string;
    const message = params.message as string;
    const mediaUrl = params.mediaUrl as string[] | undefined;

    if (!to || !message) {
      return { success: false, error: 'Both "to" and "message" are required' };
    }

    const twilio = getTwilio();
    if (!twilio) {
      return {
        success: false,
        error: 'Twilio not initialized. Please configure Twilio credentials first.',
      };
    }

    try {
      const formattedPhone = formatPhone(to);

      if (!TwilioManager.validatePhoneNumber(formattedPhone)) {
        return {
          success: false,
          error: `Invalid phone number format: ${to}. Use E.164 format (e.g., +15551234567)`,
        };
      }

      const result = await twilio.sendSMS({
        to: formattedPhone,
        body: message,
        mediaUrl,
      });

      logger.info('SMS sent successfully', { to: formattedPhone, messageSid: result.messageSid });

      return {
        success: true,
        data: {
          messageSid: result.messageSid,
          to: result.to,
          status: result.status,
          timestamp: result.timestamp.toISOString(),
        },
      };
    } catch (error) {
      logger.error('Failed to send SMS', { error: (error as Error).message, to });
      return { success: false, error: (error as Error).message };
    }
  },
};

// =============================================================================
// Make Call Tool
// =============================================================================

/**
 * Make outbound voice call tool
 */
export const makeCallTool: AgentTool = {
  name: 'phone_make_call',
  description:
    'Initiate an outbound voice call to a phone number. Can optionally speak a message when the call is answered.',
  parameters: {
    type: 'object',
    properties: {
      to: {
        type: 'string',
        description: 'Phone number to call (E.164 format preferred, e.g., +15551234567)',
      },
      message: {
        type: 'string',
        description: 'Optional message to speak when the call is answered (text-to-speech)',
      },
      record: {
        type: 'boolean',
        description: 'Whether to record the call (default: false)',
      },
      timeout: {
        type: 'number',
        description: 'Ring timeout in seconds before giving up (default: 30)',
      },
    },
    required: ['to'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const to = params.to as string;
    const message = params.message as string | undefined;
    const record = (params.record as boolean) ?? false;
    const timeout = (params.timeout as number) ?? 30;

    if (!to) {
      return { success: false, error: '"to" phone number is required' };
    }

    const twilio = getTwilio();
    if (!twilio) {
      return {
        success: false,
        error: 'Twilio not initialized. Please configure Twilio credentials first.',
      };
    }

    try {
      const formattedPhone = formatPhone(to);

      if (!TwilioManager.validatePhoneNumber(formattedPhone)) {
        return {
          success: false,
          error: `Invalid phone number format: ${to}. Use E.164 format (e.g., +15551234567)`,
        };
      }

      const result = await twilio.makeCall({
        to: formattedPhone,
        message,
        record,
        timeout,
      });

      logger.info('Call initiated', { to: formattedPhone, callSid: result.callSid });

      return {
        success: true,
        data: {
          callSid: result.callSid,
          to: result.to,
          from: result.from,
          status: result.status,
          startTime: result.startTime?.toISOString(),
        },
      };
    } catch (error) {
      logger.error('Failed to make call', { error: (error as Error).message, to });
      return { success: false, error: (error as Error).message };
    }
  },
};

// =============================================================================
// End Call Tool
// =============================================================================

/**
 * End an active call tool
 */
export const endCallTool: AgentTool = {
  name: 'phone_end_call',
  description: 'End an active voice call by its call SID.',
  parameters: {
    type: 'object',
    properties: {
      callSid: {
        type: 'string',
        description: 'The SID of the call to end',
      },
    },
    required: ['callSid'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const callSid = params.callSid as string;

    if (!callSid) {
      return { success: false, error: '"callSid" is required' };
    }

    const twilio = getTwilio();
    if (!twilio) {
      return {
        success: false,
        error: 'Twilio not initialized. Please configure Twilio credentials first.',
      };
    }

    try {
      const result = await twilio.endCall(callSid);

      logger.info('Call ended', { callSid });

      return {
        success: true,
        data: {
          callSid: result.callSid,
          status: result.status,
          duration: result.duration,
          endTime: result.endTime?.toISOString(),
        },
      };
    } catch (error) {
      logger.error('Failed to end call', { error: (error as Error).message, callSid });
      return { success: false, error: (error as Error).message };
    }
  },
};

// =============================================================================
// Speak During Call Tool
// =============================================================================

/**
 * Speak a message during an active call tool
 */
export const speakDuringCallTool: AgentTool = {
  name: 'phone_speak',
  description:
    'Speak a message during an active voice call using text-to-speech. The call must already be in progress.',
  parameters: {
    type: 'object',
    properties: {
      callSid: {
        type: 'string',
        description: 'The SID of the active call',
      },
      message: {
        type: 'string',
        description: 'The message to speak using text-to-speech',
      },
    },
    required: ['callSid', 'message'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const callSid = params.callSid as string;
    const message = params.message as string;

    if (!callSid || !message) {
      return { success: false, error: 'Both "callSid" and "message" are required' };
    }

    const twilio = getTwilio();
    if (!twilio) {
      return {
        success: false,
        error: 'Twilio not initialized. Please configure Twilio credentials first.',
      };
    }

    try {
      await twilio.speakDuringCall(callSid, message);

      logger.info('Spoke during call', { callSid, messageLength: message.length });

      return {
        success: true,
        data: {
          callSid,
          messageSent: true,
          messageLength: message.length,
        },
      };
    } catch (error) {
      logger.error('Failed to speak during call', { error: (error as Error).message, callSid });
      return { success: false, error: (error as Error).message };
    }
  },
};

// =============================================================================
// Get Active Calls Tool
// =============================================================================

/**
 * Get active calls tool
 */
export const getActiveCallsTool: AgentTool = {
  name: 'phone_active_calls',
  description: 'Get a list of all currently active phone calls.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (): Promise<ActionResult> => {
    const twilio = getTwilio();
    if (!twilio) {
      return {
        success: false,
        error: 'Twilio not initialized. Please configure Twilio credentials first.',
      };
    }

    try {
      const activeCalls = twilio.getActiveCalls();

      return {
        success: true,
        data: {
          count: activeCalls.length,
          calls: activeCalls.map((call) => ({
            callSid: call.callSid,
            status: call.status,
            direction: call.direction,
            startTime: call.startTime.toISOString(),
            isRecording: call.isRecording,
            conversationTurns: call.conversation.length,
          })),
        },
      };
    } catch (error) {
      logger.error('Failed to get active calls', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  },
};

// =============================================================================
// Get Call Status Tool
// =============================================================================

/**
 * Get call status tool
 */
export const getCallStatusTool: AgentTool = {
  name: 'phone_call_status',
  description: 'Get the current status of a phone call by its SID.',
  parameters: {
    type: 'object',
    properties: {
      callSid: {
        type: 'string',
        description: 'The SID of the call to check',
      },
    },
    required: ['callSid'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const callSid = params.callSid as string;

    if (!callSid) {
      return { success: false, error: '"callSid" is required' };
    }

    const twilio = getTwilio();
    if (!twilio) {
      return {
        success: false,
        error: 'Twilio not initialized. Please configure Twilio credentials first.',
      };
    }

    try {
      const status = await twilio.getCallStatus(callSid);

      return {
        success: true,
        data: {
          callSid: status.callSid,
          status: status.status,
          direction: status.direction,
          from: status.from,
          to: status.to,
          duration: status.duration,
          startTime: status.startTime?.toISOString(),
          endTime: status.endTime?.toISOString(),
        },
      };
    } catch (error) {
      logger.error('Failed to get call status', { error: (error as Error).message, callSid });
      return { success: false, error: (error as Error).message };
    }
  },
};

// =============================================================================
// Get SMS History Tool
// =============================================================================

/**
 * Get SMS history tool
 */
export const getSMSHistoryTool: AgentTool = {
  name: 'phone_sms_history',
  description: 'Get recent SMS message history from Twilio.',
  parameters: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Maximum number of messages to return (default: 20, max: 50)',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const limit = Math.min((params.limit as number) ?? 20, 50);

    const twilio = getTwilio();
    if (!twilio) {
      return {
        success: false,
        error: 'Twilio not initialized. Please configure Twilio credentials first.',
      };
    }

    try {
      const messages = await twilio.getSMSHistory(limit);

      return {
        success: true,
        data: {
          count: messages.length,
          messages: messages.map((m) => ({
            messageSid: m.messageSid,
            from: m.from,
            to: m.to,
            body: m.body.substring(0, 200) + (m.body.length > 200 ? '...' : ''),
            status: m.status,
            direction: m.direction,
            timestamp: m.timestamp.toISOString(),
          })),
        },
      };
    } catch (error) {
      logger.error('Failed to get SMS history', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  },
};

// =============================================================================
// Start Call Recording Tool
// =============================================================================

/**
 * Start recording a call tool
 */
export const startRecordingTool: AgentTool = {
  name: 'phone_start_recording',
  description: 'Start recording an active phone call.',
  parameters: {
    type: 'object',
    properties: {
      callSid: {
        type: 'string',
        description: 'The SID of the call to record',
      },
    },
    required: ['callSid'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const callSid = params.callSid as string;

    if (!callSid) {
      return { success: false, error: '"callSid" is required' };
    }

    const twilio = getTwilio();
    if (!twilio) {
      return {
        success: false,
        error: 'Twilio not initialized. Please configure Twilio credentials first.',
      };
    }

    try {
      const recordingSid = await twilio.startRecording(callSid);

      logger.info('Recording started', { callSid, recordingSid });

      return {
        success: true,
        data: {
          callSid,
          recordingSid,
          recording: true,
        },
      };
    } catch (error) {
      logger.error('Failed to start recording', { error: (error as Error).message, callSid });
      return { success: false, error: (error as Error).message };
    }
  },
};

// =============================================================================
// Stop Call Recording Tool
// =============================================================================

/**
 * Stop recording a call tool
 */
export const stopRecordingTool: AgentTool = {
  name: 'phone_stop_recording',
  description: 'Stop recording an active phone call.',
  parameters: {
    type: 'object',
    properties: {
      callSid: {
        type: 'string',
        description: 'The SID of the call to stop recording',
      },
    },
    required: ['callSid'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const callSid = params.callSid as string;

    if (!callSid) {
      return { success: false, error: '"callSid" is required' };
    }

    const twilio = getTwilio();
    if (!twilio) {
      return {
        success: false,
        error: 'Twilio not initialized. Please configure Twilio credentials first.',
      };
    }

    try {
      await twilio.stopRecording(callSid);

      logger.info('Recording stopped', { callSid });

      return {
        success: true,
        data: {
          callSid,
          recording: false,
        },
      };
    } catch (error) {
      logger.error('Failed to stop recording', { error: (error as Error).message, callSid });
      return { success: false, error: (error as Error).message };
    }
  },
};

// =============================================================================
// Get Call Recordings Tool
// =============================================================================

/**
 * Get call recordings tool
 */
export const getRecordingsTool: AgentTool = {
  name: 'phone_get_recordings',
  description: 'Get recordings for a completed phone call.',
  parameters: {
    type: 'object',
    properties: {
      callSid: {
        type: 'string',
        description: 'The SID of the call to get recordings for',
      },
    },
    required: ['callSid'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const callSid = params.callSid as string;

    if (!callSid) {
      return { success: false, error: '"callSid" is required' };
    }

    const twilio = getTwilio();
    if (!twilio) {
      return {
        success: false,
        error: 'Twilio not initialized. Please configure Twilio credentials first.',
      };
    }

    try {
      const recordings = await twilio.getRecordings(callSid);

      return {
        success: true,
        data: {
          callSid,
          count: recordings.length,
          recordings: recordings.map((r) => ({
            sid: r.sid,
            duration: r.duration,
            url: r.url,
          })),
        },
      };
    } catch (error) {
      logger.error('Failed to get recordings', { error: (error as Error).message, callSid });
      return { success: false, error: (error as Error).message };
    }
  },
};

// =============================================================================
// Validate Phone Number Tool
// =============================================================================

/**
 * Validate phone number tool
 */
export const validatePhoneNumberTool: AgentTool = {
  name: 'phone_validate',
  description: 'Validate a phone number format and convert to E.164 format.',
  parameters: {
    type: 'object',
    properties: {
      phoneNumber: {
        type: 'string',
        description: 'The phone number to validate',
      },
      countryCode: {
        type: 'string',
        description: 'Default country code if not in E.164 format (default: "1" for US)',
      },
    },
    required: ['phoneNumber'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const phoneNumber = params.phoneNumber as string;
    const countryCode = (params.countryCode as string) ?? '1';

    if (!phoneNumber) {
      return { success: false, error: '"phoneNumber" is required' };
    }

    try {
      const formatted = TwilioManager.formatPhoneNumber(phoneNumber, countryCode);
      const isValid = TwilioManager.validatePhoneNumber(formatted);

      return {
        success: true,
        data: {
          original: phoneNumber,
          formatted,
          isValid,
          e164: formatted,
        },
      };
    } catch (error) {
      logger.error('Failed to validate phone number', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  },
};

// =============================================================================
// Get All Phone Tools
// =============================================================================

/**
 * Get all phone tools
 */
export function getPhoneTools(): AgentTool[] {
  return [
    sendSMSTool,
    makeCallTool,
    endCallTool,
    speakDuringCallTool,
    getActiveCallsTool,
    getCallStatusTool,
    getSMSHistoryTool,
    startRecordingTool,
    stopRecordingTool,
    getRecordingsTool,
    validatePhoneNumberTool,
  ];
}

export default {
  sendSMSTool,
  makeCallTool,
  endCallTool,
  speakDuringCallTool,
  getActiveCallsTool,
  getCallStatusTool,
  getSMSHistoryTool,
  startRecordingTool,
  stopRecordingTool,
  getRecordingsTool,
  validatePhoneNumberTool,
  getPhoneTools,
};
