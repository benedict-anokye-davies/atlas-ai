/**
 * Communication Module - Phone and SMS via Twilio
 *
 * Exports:
 * - TwilioManager: Voice calls and SMS messaging
 */

export {
  TwilioManager,
  getTwilioManager,
  type TwilioConfig,
  type CallOptions,
  type SMSOptions,
  type CallStatus,
  type SMSMessage,
  type ConversationTurn,
  type ActiveCall,
  type TwilioEvents,
} from './twilio';
