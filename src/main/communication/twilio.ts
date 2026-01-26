/**
 * TwilioManager - Voice and SMS communication via Twilio
 *
 * Provides:
 * - Outbound voice calls with TTS (Atlas speaks)
 * - Inbound call handling with STT (listen to caller)
 * - SMS send/receive
 * - Call recording and transcription
 * - Two-way conversational calls with LLM integration
 */

import Twilio from 'twilio';
import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import type { ElevenLabsTTS } from '../tts/elevenlabs';
import type { DeepgramSTT } from '../stt/deepgram';

const logger = createModuleLogger('Twilio');

// ============================================================================
// Types
// ============================================================================

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  phoneNumber: string; // Twilio phone number to use for outbound
  webhookBaseUrl?: string; // Base URL for webhooks (e.g., ngrok URL)
}

export interface CallOptions {
  to: string; // Phone number to call (E.164 format)
  message?: string; // Initial message to speak (TTS)
  record?: boolean; // Record the call
  machineDetection?: 'Enable' | 'DetectMessageEnd' | 'None';
  timeout?: number; // Ring timeout in seconds
  statusCallback?: string; // URL for status updates
}

export interface SMSOptions {
  to: string; // Phone number (E.164 format)
  body: string; // Message content
  mediaUrl?: string[]; // MMS attachments
}

export interface CallStatus {
  callSid: string;
  status:
    | 'queued'
    | 'ringing'
    | 'in-progress'
    | 'completed'
    | 'busy'
    | 'no-answer'
    | 'canceled'
    | 'failed';
  direction: 'inbound' | 'outbound';
  from: string;
  to: string;
  duration?: number;
  recordingUrl?: string;
  transcription?: string;
  startTime?: Date;
  endTime?: Date;
}

export interface SMSMessage {
  messageSid: string;
  from: string;
  to: string;
  body: string;
  status: 'queued' | 'sent' | 'delivered' | 'failed' | 'undelivered' | 'received';
  direction: 'inbound' | 'outbound';
  timestamp: Date;
  mediaUrls?: string[];
}

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface ActiveCall {
  callSid: string;
  status: CallStatus['status'];
  direction: 'inbound' | 'outbound';
  startTime: Date;
  conversation: ConversationTurn[];
  isRecording: boolean;
  isMuted: boolean;
}

export interface TwilioEvents {
  'call:initiated': (call: CallStatus) => void;
  'call:ringing': (call: CallStatus) => void;
  'call:connected': (call: CallStatus) => void;
  'call:ended': (call: CallStatus) => void;
  'call:failed': (call: CallStatus, error: Error) => void;
  'call:speech-received': (callSid: string, text: string) => void;
  'call:speech-sent': (callSid: string, text: string) => void;
  'sms:sent': (message: SMSMessage) => void;
  'sms:received': (message: SMSMessage) => void;
  'sms:failed': (to: string, error: Error) => void;
  error: (error: Error) => void;
}

// ============================================================================
// TwilioManager Class
// ============================================================================

export class TwilioManager extends EventEmitter {
  private client: Twilio.Twilio | null = null;
  private config: TwilioConfig | null = null;
  private activeCalls: Map<string, ActiveCall> = new Map();
  private messageHistory: SMSMessage[] = [];
  private tts?: ElevenLabsTTS;
  private stt?: DeepgramSTT;
  private initialized = false;

  constructor() {
    super();
    this.setMaxListeners(20);
  }

  // --------------------------------------------------------------------------
  // Initialization
  // --------------------------------------------------------------------------

  /**
   * Initialize Twilio client with credentials
   */
  async initialize(config: TwilioConfig): Promise<void> {
    if (this.initialized) {
      logger.warn('[Twilio] Already initialized');
      return;
    }

    try {
      this.config = config;

      // Validate config
      if (!config.accountSid || !config.authToken || !config.phoneNumber) {
        throw new Error('Missing required Twilio configuration');
      }

      // Create Twilio client
      this.client = Twilio(config.accountSid, config.authToken);

      // Verify credentials by fetching account info
      const account = await this.client.api.accounts(config.accountSid).fetch();
      logger.info(`[Twilio] Connected to account: ${account.friendlyName}`);

      this.initialized = true;
      logger.info('[Twilio] TwilioManager initialized successfully');
    } catch (error) {
      logger.error('[Twilio] Initialization failed:', error);
      this.emit('error', error as Error);
      throw error;
    }
  }

  /**
   * Set TTS service for voice synthesis during calls
   */
  setTTS(tts: ElevenLabsTTS): void {
    this.tts = tts;
    logger.debug('[Twilio] TTS service configured');
  }

  /**
   * Set STT service for speech recognition during calls
   */
  setSTT(stt: DeepgramSTT): void {
    this.stt = stt;
    logger.debug('[Twilio] STT service configured');
  }

  /**
   * Check if manager is initialized
   */
  isInitialized(): boolean {
    return this.initialized && this.client !== null;
  }

  // --------------------------------------------------------------------------
  // Voice Calls - Outbound
  // --------------------------------------------------------------------------

  /**
   * Initiate an outbound voice call
   */
  async makeCall(options: CallOptions): Promise<CallStatus> {
    this.ensureInitialized();

    try {
      logger.info(`[Twilio] Initiating call to ${options.to}`);

      // Build TwiML for the call
      const twiml = this.buildCallTwiML(options);

      // Create the call
      const call = await this.client!.calls.create({
        to: options.to,
        from: this.config!.phoneNumber,
        twiml: twiml,
        record: options.record ?? false,
        machineDetection: options.machineDetection,
        timeout: options.timeout ?? 30,
        statusCallback: options.statusCallback,
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      });

      const callStatus: CallStatus = {
        callSid: call.sid,
        status: call.status as CallStatus['status'],
        direction: 'outbound',
        from: this.config!.phoneNumber,
        to: options.to,
        startTime: new Date(),
      };

      // Track active call
      this.activeCalls.set(call.sid, {
        callSid: call.sid,
        status: callStatus.status,
        direction: 'outbound',
        startTime: new Date(),
        conversation: [],
        isRecording: options.record ?? false,
        isMuted: false,
      });

      this.emit('call:initiated', callStatus);
      logger.info(`[Twilio] Call initiated: ${call.sid}`);

      return callStatus;
    } catch (error) {
      logger.error('[Twilio] Failed to make call:', error);
      this.emit('call:failed', { to: options.to } as CallStatus, error as Error);
      throw error;
    }
  }

  /**
   * Build TwiML for outbound call
   */
  private buildCallTwiML(options: CallOptions): string {
    const VoiceResponse = Twilio.twiml.VoiceResponse;
    const response = new VoiceResponse();

    // Add initial message if provided
    if (options.message) {
      // Use Twilio's built-in TTS (or could use pre-recorded audio from ElevenLabs)
      response.say(
        {
          voice: 'Polly.Matthew', // AWS Polly neural voice
          language: 'en-US',
        },
        options.message
      );
    }

    // Gather speech input from the caller
    const gather = response.gather({
      input: ['speech'],
      speechTimeout: 'auto',
      action: this.config?.webhookBaseUrl
        ? `${this.config.webhookBaseUrl}/twilio/gather`
        : undefined,
      method: 'POST',
    });

    // Prompt for response
    gather.say(
      {
        voice: 'Polly.Matthew',
      },
      'Please respond now.'
    );

    // If no input, hang up after timeout
    response.say('I did not receive a response. Goodbye.');
    response.hangup();

    return response.toString();
  }

  /**
   * Speak a message during an active call using TwiML update
   */
  async speakDuringCall(callSid: string, message: string): Promise<void> {
    this.ensureInitialized();

    const activeCall = this.activeCalls.get(callSid);
    if (!activeCall) {
      throw new Error(`No active call found with SID: ${callSid}`);
    }

    try {
      const VoiceResponse = Twilio.twiml.VoiceResponse;
      const response = new VoiceResponse();

      // Speak the message
      response.say(
        {
          voice: 'Polly.Matthew',
          language: 'en-US',
        },
        message
      );

      // Continue gathering speech
      const gather = response.gather({
        input: ['speech'],
        speechTimeout: 'auto',
        action: this.config?.webhookBaseUrl
          ? `${this.config.webhookBaseUrl}/twilio/gather`
          : undefined,
      });
      gather.pause({ length: 1 });

      // Update the call with new TwiML
      await this.client!.calls(callSid).update({
        twiml: response.toString(),
      });

      // Track in conversation
      activeCall.conversation.push({
        role: 'assistant',
        content: message,
        timestamp: new Date(),
      });

      this.emit('call:speech-sent', callSid, message);
      logger.debug(`[Twilio] Spoke on call ${callSid}: ${message.substring(0, 50)}...`);
    } catch (error) {
      logger.error(`[Twilio] Failed to speak on call ${callSid}:`, error);
      throw error;
    }
  }

  /**
   * End an active call
   */
  async endCall(callSid: string): Promise<CallStatus> {
    this.ensureInitialized();

    try {
      const call = await this.client!.calls(callSid).update({
        status: 'completed',
      });

      const activeCall = this.activeCalls.get(callSid);
      const callStatus: CallStatus = {
        callSid: call.sid,
        status: 'completed',
        direction: activeCall?.direction ?? 'outbound',
        from: call.from,
        to: call.to,
        duration: call.duration ? parseInt(call.duration, 10) : undefined,
        endTime: new Date(),
        startTime: activeCall?.startTime,
      };

      this.activeCalls.delete(callSid);
      this.emit('call:ended', callStatus);
      logger.info(`[Twilio] Call ended: ${callSid}`);

      return callStatus;
    } catch (error) {
      logger.error(`[Twilio] Failed to end call ${callSid}:`, error);
      throw error;
    }
  }

  /**
   * Get status of a call
   */
  async getCallStatus(callSid: string): Promise<CallStatus> {
    this.ensureInitialized();

    const call = await this.client!.calls(callSid).fetch();

    return {
      callSid: call.sid,
      status: call.status as CallStatus['status'],
      direction: call.direction as 'inbound' | 'outbound',
      from: call.from,
      to: call.to,
      duration: call.duration ? parseInt(call.duration, 10) : undefined,
      startTime: call.startTime,
      endTime: call.endTime,
    };
  }

  /**
   * Get all active calls
   */
  getActiveCalls(): ActiveCall[] {
    return Array.from(this.activeCalls.values());
  }

  // --------------------------------------------------------------------------
  // Voice Calls - Inbound Webhook Handling
  // --------------------------------------------------------------------------

  /**
   * Handle incoming call webhook (called by Express route)
   */
  handleIncomingCall(from: string, to: string, callSid: string): string {
    logger.info(`[Twilio] Incoming call from ${from}`);

    // Track the call
    this.activeCalls.set(callSid, {
      callSid,
      status: 'in-progress',
      direction: 'inbound',
      startTime: new Date(),
      conversation: [],
      isRecording: false,
      isMuted: false,
    });

    const callStatus: CallStatus = {
      callSid,
      status: 'ringing',
      direction: 'inbound',
      from,
      to,
      startTime: new Date(),
    };

    this.emit('call:connected', callStatus);

    // Return TwiML to answer the call
    const VoiceResponse = Twilio.twiml.VoiceResponse;
    const response = new VoiceResponse();

    response.say(
      {
        voice: 'Polly.Matthew',
        language: 'en-US',
      },
      'Hello, this is Atlas. How can I help you?'
    );

    const gather = response.gather({
      input: ['speech'],
      speechTimeout: 'auto',
      action: this.config?.webhookBaseUrl
        ? `${this.config.webhookBaseUrl}/twilio/gather`
        : '/twilio/gather',
      method: 'POST',
    });
    gather.pause({ length: 2 });

    return response.toString();
  }

  /**
   * Handle speech gathering webhook (called by Express route)
   */
  handleGatherResult(callSid: string, speechResult: string): string {
    logger.info(`[Twilio] Received speech on ${callSid}: ${speechResult}`);

    const activeCall = this.activeCalls.get(callSid);
    if (activeCall) {
      activeCall.conversation.push({
        role: 'user',
        content: speechResult,
        timestamp: new Date(),
      });
    }

    this.emit('call:speech-received', callSid, speechResult);

    // Return TwiML to continue the conversation
    // The actual response will be provided by speakDuringCall() after LLM processing
    const VoiceResponse = Twilio.twiml.VoiceResponse;
    const response = new VoiceResponse();

    response.say(
      {
        voice: 'Polly.Matthew',
      },
      'Let me think about that.'
    );

    // Hold music while processing
    response.play({ loop: 1 }, 'https://api.twilio.com/cowbell.mp3');

    return response.toString();
  }

  /**
   * Handle call status webhook (called by Express route)
   */
  handleStatusCallback(callSid: string, status: string): void {
    logger.debug(`[Twilio] Call ${callSid} status: ${status}`);

    const activeCall = this.activeCalls.get(callSid);
    if (activeCall) {
      activeCall.status = status as CallStatus['status'];
    }

    const callStatus: CallStatus = {
      callSid,
      status: status as CallStatus['status'],
      direction: activeCall?.direction ?? 'outbound',
      from: '',
      to: '',
    };

    switch (status) {
      case 'ringing':
        this.emit('call:ringing', callStatus);
        break;
      case 'in-progress':
        this.emit('call:connected', callStatus);
        break;
      case 'completed':
      case 'busy':
      case 'no-answer':
      case 'canceled':
        this.activeCalls.delete(callSid);
        this.emit('call:ended', callStatus);
        break;
      case 'failed':
        this.activeCalls.delete(callSid);
        this.emit('call:failed', callStatus, new Error('Call failed'));
        break;
    }
  }

  // --------------------------------------------------------------------------
  // SMS
  // --------------------------------------------------------------------------

  /**
   * Send an SMS message
   */
  async sendSMS(options: SMSOptions): Promise<SMSMessage> {
    this.ensureInitialized();

    try {
      logger.info(`[Twilio] Sending SMS to ${options.to}`);

      const message = await this.client!.messages.create({
        to: options.to,
        from: this.config!.phoneNumber,
        body: options.body,
        mediaUrl: options.mediaUrl,
      });

      const smsMessage: SMSMessage = {
        messageSid: message.sid,
        from: this.config!.phoneNumber,
        to: options.to,
        body: options.body,
        status: message.status as SMSMessage['status'],
        direction: 'outbound',
        timestamp: new Date(),
        mediaUrls: options.mediaUrl,
      };

      this.messageHistory.push(smsMessage);
      this.emit('sms:sent', smsMessage);
      logger.info(`[Twilio] SMS sent: ${message.sid}`);

      return smsMessage;
    } catch (error) {
      logger.error('[Twilio] Failed to send SMS:', error);
      this.emit('sms:failed', options.to, error as Error);
      throw error;
    }
  }

  /**
   * Handle incoming SMS webhook (called by Express route)
   */
  handleIncomingSMS(from: string, to: string, body: string, messageSid: string): string {
    logger.info(`[Twilio] Incoming SMS from ${from}: ${body.substring(0, 50)}...`);

    const smsMessage: SMSMessage = {
      messageSid,
      from,
      to,
      body,
      status: 'received',
      direction: 'inbound',
      timestamp: new Date(),
    };

    this.messageHistory.push(smsMessage);
    this.emit('sms:received', smsMessage);

    // Return TwiML response (can be empty or auto-reply)
    const MessagingResponse = Twilio.twiml.MessagingResponse;
    const response = new MessagingResponse();

    // Optional: Add auto-reply
    // response.message('Thanks for your message! Atlas will respond shortly.');

    return response.toString();
  }

  /**
   * Get SMS history
   */
  async getSMSHistory(limit = 50): Promise<SMSMessage[]> {
    this.ensureInitialized();

    const messages = await this.client!.messages.list({ limit });

    return messages.map((m) => ({
      messageSid: m.sid,
      from: m.from,
      to: m.to,
      body: m.body ?? '',
      status: m.status as SMSMessage['status'],
      direction: m.direction.includes('inbound') ? 'inbound' : 'outbound',
      timestamp: m.dateSent ?? m.dateCreated,
      mediaUrls: undefined,
    }));
  }

  /**
   * Get local message history (current session)
   */
  getLocalMessageHistory(): SMSMessage[] {
    return [...this.messageHistory];
  }

  // --------------------------------------------------------------------------
  // Call Recording
  // --------------------------------------------------------------------------

  /**
   * Start recording an active call
   */
  async startRecording(callSid: string): Promise<string> {
    this.ensureInitialized();

    const recording = await this.client!.calls(callSid).recordings.create({
      recordingChannels: 'dual',
      recordingStatusCallback: this.config?.webhookBaseUrl
        ? `${this.config.webhookBaseUrl}/twilio/recording-status`
        : undefined,
    });

    const activeCall = this.activeCalls.get(callSid);
    if (activeCall) {
      activeCall.isRecording = true;
    }

    logger.info(`[Twilio] Started recording for call ${callSid}: ${recording.sid}`);
    return recording.sid;
  }

  /**
   * Stop recording an active call
   */
  async stopRecording(callSid: string): Promise<void> {
    this.ensureInitialized();

    const recordings = await this.client!.calls(callSid).recordings.list({ limit: 1 });

    if (recordings.length > 0) {
      await this.client!.calls(callSid).recordings(recordings[0].sid).update({
        status: 'stopped',
      });
    }

    const activeCall = this.activeCalls.get(callSid);
    if (activeCall) {
      activeCall.isRecording = false;
    }

    logger.info(`[Twilio] Stopped recording for call ${callSid}`);
  }

  /**
   * Get recordings for a call
   */
  async getRecordings(callSid: string): Promise<
    Array<{
      sid: string;
      duration: number;
      url: string;
    }>
  > {
    this.ensureInitialized();

    const recordings = await this.client!.calls(callSid).recordings.list();

    return recordings.map((r) => ({
      sid: r.sid,
      duration: r.duration ? parseInt(r.duration, 10) : 0,
      url: `https://api.twilio.com${r.uri.replace('.json', '.mp3')}`,
    }));
  }

  // --------------------------------------------------------------------------
  // Phone Number Management
  // --------------------------------------------------------------------------

  /**
   * List available phone numbers for purchase
   */
  async searchAvailableNumbers(
    areaCode?: string,
    country = 'US'
  ): Promise<
    Array<{
      phoneNumber: string;
      friendlyName: string;
      capabilities: { voice: boolean; sms: boolean; mms: boolean };
    }>
  > {
    this.ensureInitialized();

    const numbers = await this.client!.availablePhoneNumbers(country).local.list({
      areaCode: areaCode ? parseInt(areaCode, 10) : undefined,
      voiceEnabled: true,
      smsEnabled: true,
      limit: 10,
    });

    return numbers.map((n) => ({
      phoneNumber: n.phoneNumber,
      friendlyName: n.friendlyName,
      capabilities: {
        voice: n.capabilities.voice,
        sms: n.capabilities.sms,
        mms: n.capabilities.mms,
      },
    }));
  }

  /**
   * Get owned phone numbers
   */
  async getOwnedNumbers(): Promise<
    Array<{
      phoneNumber: string;
      friendlyName: string;
      sid: string;
    }>
  > {
    this.ensureInitialized();

    const numbers = await this.client!.incomingPhoneNumbers.list();

    return numbers.map((n) => ({
      phoneNumber: n.phoneNumber,
      friendlyName: n.friendlyName,
      sid: n.sid,
    }));
  }

  // --------------------------------------------------------------------------
  // Conversational Call Flow
  // --------------------------------------------------------------------------

  /**
   * Handle a complete conversational turn during a call
   * Called after receiving speech, processes through LLM, responds with TTS
   */
  async handleConversationalTurn(
    callSid: string,
    userSpeech: string,
    getLLMResponse: (conversation: ConversationTurn[]) => Promise<string>
  ): Promise<void> {
    const activeCall = this.activeCalls.get(callSid);
    if (!activeCall) {
      throw new Error(`No active call found: ${callSid}`);
    }

    // Add user speech to conversation
    activeCall.conversation.push({
      role: 'user',
      content: userSpeech,
      timestamp: new Date(),
    });

    try {
      // Get LLM response
      const response = await getLLMResponse(activeCall.conversation);

      // Speak the response
      await this.speakDuringCall(callSid, response);
    } catch (error) {
      logger.error(`[Twilio] Conversational turn failed for ${callSid}:`, error);

      // Speak error message
      await this.speakDuringCall(
        callSid,
        "I'm sorry, I encountered an error. Could you please repeat that?"
      );
    }
  }

  /**
   * Get conversation history for a call
   */
  getCallConversation(callSid: string): ConversationTurn[] {
    return this.activeCalls.get(callSid)?.conversation ?? [];
  }

  // --------------------------------------------------------------------------
  // Utilities
  // --------------------------------------------------------------------------

  /**
   * Validate phone number format (E.164)
   */
  static validatePhoneNumber(phoneNumber: string): boolean {
    // E.164 format: +[country code][number]
    const e164Regex = /^\+[1-9]\d{1,14}$/;
    return e164Regex.test(phoneNumber);
  }

  /**
   * Format phone number to E.164
   */
  static formatPhoneNumber(phoneNumber: string, countryCode = '1'): string {
    // Remove all non-digit characters
    const digits = phoneNumber.replace(/\D/g, '');

    // If already has country code, return with +
    if (digits.length > 10) {
      return `+${digits}`;
    }

    // Add country code
    return `+${countryCode}${digits}`;
  }

  /**
   * Ensure manager is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized || !this.client) {
      throw new Error('TwilioManager not initialized. Call initialize() first.');
    }
  }

  // --------------------------------------------------------------------------
  // Cleanup
  // --------------------------------------------------------------------------

  /**
   * Cleanup and end all active calls
   */
  async cleanup(): Promise<void> {
    logger.info('[Twilio] Cleaning up...');

    // End all active calls
    for (const [callSid] of this.activeCalls) {
      try {
        await this.endCall(callSid);
      } catch (error) {
        logger.warn(`[Twilio] Failed to end call ${callSid} during cleanup:`, error);
      }
    }

    this.activeCalls.clear();
    this.messageHistory = [];
    this.initialized = false;
    this.client = null;

    logger.info('[Twilio] Cleanup complete');
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

let twilioManagerInstance: TwilioManager | null = null;

export function getTwilioManager(): TwilioManager {
  if (!twilioManagerInstance) {
    twilioManagerInstance = new TwilioManager();
  }
  return twilioManagerInstance;
}

export default TwilioManager;
