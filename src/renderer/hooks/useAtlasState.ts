/* eslint-disable no-console */
/**
 * Atlas Desktop - useAtlasState Hook
 * Connects to the voice pipeline IPC events and provides reactive state
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { AtlasState } from '../components/orb/AtlasParticles';
import type {
  FullVoicePipelineStatus,
  WakeWordFeedback,
  WakeWordFeedbackType,
  ListeningState,
  StillListeningEvent,
} from '../../shared/types/voice';
import { audioFeedback } from '../utils/audioFeedback';
import { useAtlasStore } from '../stores';
import { webSpeechTTS } from '../utils/webSpeechTTS';

/**
 * State returned by the hook
 */
interface AtlasStateResult {
  // Core state
  state: AtlasState;
  isReady: boolean;
  isListening: boolean;
  isSpeaking: boolean;

  // Audio
  audioLevel: number;

  // Transcription
  transcript: string;
  interimTranscript: string;

  // Response
  response: string;
  isThinking: boolean;

  // Providers
  sttProvider: string | null;
  llmProvider: string | null;

  // Wake word feedback
  wakeFeedback: WakeWordFeedback | null;
  lastWakeFeedbackType: WakeWordFeedbackType | null;

  // VAD listening state
  listeningState: ListeningState;
  stillListening: StillListeningEvent | null;

  // Error
  error: string | null;

  // Actions
  start: () => Promise<void>;
  stop: () => Promise<void>;
  triggerWake: () => Promise<void>;
  sendText: (text: string) => Promise<void>;
  clearHistory: () => Promise<void>;
}

/**
 * Map pipeline state string to AtlasState type
 */
function mapToAtlasState(pipelineState: string): AtlasState {
  switch (pipelineState?.toLowerCase()) {
    case 'listening':
      return 'listening';
    case 'processing':
    case 'thinking':
      return 'thinking';
    case 'speaking':
      return 'speaking';
    case 'error':
      return 'error';
    case 'idle':
    default:
      return 'idle';
  }
}

/**
 * Hook to connect to Atlas voice pipeline
 */
export function useAtlasState(): AtlasStateResult {
  // Core state
  const [state, setState] = useState<AtlasState>('idle');
  const [isReady, setIsReady] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  // Audio
  const [audioLevel, setAudioLevel] = useState(0);

  // TTS Audio playback
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioQueueRef = useRef<string[]>([]);
  const isPlayingRef = useRef(false);

  // Track if native TTS audio was received (for fallback logic)
  const receivedTTSAudioRef = useRef(false);
  const pendingResponseRef = useRef<string | null>(null);

  // Transcription
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');

  // Response
  const [response, setResponse] = useState('');
  const [isThinking, setIsThinking] = useState(false);

  // Providers
  const [sttProvider, setSttProvider] = useState<string | null>(null);
  const [llmProvider, setLlmProvider] = useState<string | null>(null);

  // Wake word feedback
  const [wakeFeedback, setWakeFeedback] = useState<WakeWordFeedback | null>(null);
  const [lastWakeFeedbackType, setLastWakeFeedbackType] = useState<WakeWordFeedbackType | null>(
    null
  );

  // VAD listening state
  const [listeningState, setListeningState] = useState<ListeningState>('idle');
  const [stillListening, setStillListening] = useState<StillListeningEvent | null>(null);

  // Error
  const [error, setError] = useState<string | null>(null);

  // Cleanup refs
  const cleanupFunctionsRef = useRef<Array<() => void>>([]);

  // Track previous state for audio feedback
  const prevStateRef = useRef<AtlasState>('idle');

  // Get audio feedback settings from store
  const { settings } = useAtlasStore();

  // Configure audio feedback when settings change
  useEffect(() => {
    audioFeedback.configure({
      enabled: settings.audioFeedbackEnabled ?? true,
      volume: settings.audioFeedbackVolume ?? 0.3,
    });
  }, [settings.audioFeedbackEnabled, settings.audioFeedbackVolume]);

  // Audio feedback on state changes
  useEffect(() => {
    const prevState = prevStateRef.current;

    // Only play sounds when state actually changes
    if (state !== prevState) {
      console.log(`[useAtlasState] State changed: ${prevState} -> ${state}`);

      // Play appropriate sound based on new state
      switch (state) {
        case 'listening':
          if (prevState === 'idle') {
            audioFeedback.play('listening-start');
          }
          break;
        case 'thinking':
          if (prevState === 'listening') {
            audioFeedback.play('listening-end');
          }
          audioFeedback.play('thinking-start');
          break;
        case 'speaking':
          audioFeedback.play('speaking-start');
          break;
        case 'error':
          audioFeedback.play('error');
          break;
        case 'idle':
          if (prevState === 'speaking') {
            audioFeedback.play('speaking-end');
          } else if (prevState === 'listening') {
            audioFeedback.play('listening-end');
          }
          break;
      }

      prevStateRef.current = state;
    }
  }, [state]);

  // Subscribe to IPC events
  useEffect(() => {
    if (!window.atlas) {
      console.warn('[useAtlasState] Atlas API not available');
      return;
    }

    const { on } = window.atlas;
    const cleanups: Array<() => void> = [];

    // State change events
    cleanups.push(
      on('atlas:state-change', (data: unknown) => {
        // IPC sends { state, previousState } object
        let stateStr: string;
        if (typeof data === 'object' && data !== null && 'state' in data) {
          stateStr = String((data as { state: unknown }).state);
        } else {
          stateStr = String(data);
        }
        setState(mapToAtlasState(stateStr));
        setIsListening(stateStr === 'listening');
        setIsThinking(stateStr === 'processing' || stateStr === 'thinking');
      })
    );

    // Audio level
    cleanups.push(
      on('atlas:audio-level', (data: unknown) => {
        // IPC sends { level } object
        let level: number;
        if (typeof data === 'object' && data !== null && 'level' in data) {
          level = (data as { level: number }).level;
        } else if (typeof data === 'number') {
          level = data;
        } else {
          level = 0;
        }
        setAudioLevel(level);
      })
    );

    // Transcription events
    cleanups.push(
      on('atlas:transcript-interim', (data: unknown) => {
        // IPC sends { text } object
        let text: string;
        if (typeof data === 'object' && data !== null && 'text' in data) {
          text = String((data as { text: unknown }).text || '');
        } else {
          text = String(data || '');
        }
        setInterimTranscript(text);
      })
    );

    cleanups.push(
      on('atlas:transcript-final', (data: unknown) => {
        // IPC sends TranscriptionResult object with text property
        let text: string;
        if (typeof data === 'object' && data !== null && 'text' in data) {
          text = String((data as { text: unknown }).text || '');
        } else {
          text = String(data || '');
        }
        setTranscript(text);
        setInterimTranscript('');
      })
    );

    // Response events
    cleanups.push(
      on('atlas:response-start', () => {
        setResponse('');
        setIsThinking(true);
      })
    );

    cleanups.push(
      on('atlas:response-chunk', (data: unknown) => {
        // IPC sends LLMStreamChunk object with content/text property
        let text: string;
        if (typeof data === 'object' && data !== null) {
          const chunk = data as { content?: unknown; text?: unknown };
          text = String(chunk.content || chunk.text || '');
        } else {
          text = String(data || '');
        }
        setResponse((prev) => prev + text);
      })
    );

    cleanups.push(
      on('atlas:response-complete', (data: unknown) => {
        // IPC sends LLMResponse object with content property
        let text: string;
        if (typeof data === 'object' && data !== null) {
          const response = data as { content?: unknown; text?: unknown };
          text = String(response.content || response.text || '');
        } else {
          text = String(data || '');
        }
        setResponse(text);
        setIsThinking(false);

        // Store the response for potential fallback TTS
        pendingResponseRef.current = text;
        receivedTTSAudioRef.current = false;

        // Wait a short time for native TTS audio to arrive
        // If no audio received, use Web Speech API fallback
        setTimeout(() => {
          if (!receivedTTSAudioRef.current && pendingResponseRef.current) {
            console.log('[useAtlasState] No native TTS audio received, using Web Speech fallback');
            if (webSpeechTTS.isAvailable()) {
              setIsSpeaking(true);
              setState('speaking');
              webSpeechTTS.speak(pendingResponseRef.current).then(() => {
                setIsSpeaking(false);
                setState('idle');
              }).catch((err) => {
                console.error('[useAtlasState] Web Speech TTS error:', err);
                setIsSpeaking(false);
                setState('idle');
              });
            }
            pendingResponseRef.current = null;
          }
        }, 500); // Wait 500ms for native TTS audio
      })
    );

    // Speaking events
    cleanups.push(
      on('atlas:speaking-start', () => {
        setIsSpeaking(true);
        setState('speaking');
      })
    );

    cleanups.push(
      on('atlas:speaking-end', () => {
        setIsSpeaking(false);
        setState('idle');
      })
    );

    // TTS Audio playback - receive audio data and play it
    const playNextInQueue = async () => {
      if (audioQueueRef.current.length === 0) {
        isPlayingRef.current = false;
        return;
      }

      isPlayingRef.current = true;
      const audioData = audioQueueRef.current.shift()!;
      console.log('[useAtlasState] Playing audio, queue size:', audioQueueRef.current.length);

      if (!audioRef.current) {
        audioRef.current = new Audio();
        audioRef.current.onended = playNextInQueue;
        audioRef.current.onerror = (e) => {
          console.error('[useAtlasState] Audio playback error:', e);
          playNextInQueue(); // Try next in queue
        };
        
        // Set output device if specified in settings
        const outputDeviceId = useAtlasStore.getState().settings.outputDevice;
        if (outputDeviceId && 'setSinkId' in audioRef.current) {
          try {
            await (audioRef.current as HTMLAudioElement & { setSinkId: (id: string) => Promise<void> }).setSinkId(outputDeviceId);
            console.log('[useAtlasState] Audio output set to device:', outputDeviceId);
          } catch (err) {
            console.warn('[useAtlasState] Failed to set audio output device:', err);
          }
        }
      }

      audioRef.current.src = audioData;
      audioRef.current.play().catch((err) => {
        console.error('[useAtlasState] Failed to play audio:', err);
        playNextInQueue();
      });
    };

    cleanups.push(
      on('atlas:tts-audio', (data: unknown) => {
        console.log('[useAtlasState] Received atlas:tts-audio');
        // Mark that we received native TTS audio (prevents fallback)
        receivedTTSAudioRef.current = true;
        pendingResponseRef.current = null;

        // Receive base64 audio data URL from main process
        if (typeof data === 'string' && data.startsWith('data:audio')) {
          audioQueueRef.current.push(data);
          if (!isPlayingRef.current) {
            playNextInQueue();
          }
        }
      })
    );

    cleanups.push(
      on('atlas:audio-chunk', (data: unknown) => {
        console.log('[useAtlasState] Received atlas:audio-chunk', data);
        // Receive audio chunk with base64 data
        if (typeof data === 'object' && data !== null) {
          const chunk = data as { audio?: string; data?: string; format?: string };
          const audioData = chunk.audio || chunk.data;
          const format = chunk.format || 'wav';
          
          if (typeof audioData === 'string' && audioData.length > 0) {
            // Determine MIME type from format
            const mimeType = format.includes('mp3') || format === 'mpeg' 
              ? 'audio/mpeg' 
              : 'audio/wav';
            
            // Convert to data URL if not already
            const dataUrl = audioData.startsWith('data:')
              ? audioData
              : `data:${mimeType};base64,${audioData}`;
            audioQueueRef.current.push(dataUrl);
            if (!isPlayingRef.current) {
              playNextInQueue();
            }
          }
        }
      })
    );

    // Also listen for complete synthesis result
    cleanups.push(
      on('atlas:synthesis-complete', (data: unknown) => {
        console.log('[useAtlasState] Received atlas:synthesis-complete');
        if (typeof data === 'object' && data !== null) {
          const result = data as { audioBase64?: string; format?: string };
          if (result.audioBase64) {
            const mimeType = result.format?.includes('mp3') ? 'audio/mpeg' : 'audio/wav';
            const dataUrl = `data:${mimeType};base64,${result.audioBase64}`;
            audioQueueRef.current.push(dataUrl);
            if (!isPlayingRef.current) {
              playNextInQueue();
            }
          }
        }
      })
    );

    // Provider changes
    cleanups.push(
      on('atlas:provider-change', (data: unknown) => {
        if (typeof data === 'object' && data !== null) {
          const providerData = data as { type?: string; provider?: string };
          if (providerData.type === 'stt') {
            setSttProvider(providerData.provider || null);
          } else if (providerData.type === 'llm') {
            setLlmProvider(providerData.provider || null);
          }
        }
      })
    );

    // Lifecycle events
    cleanups.push(
      on('atlas:started', () => {
        setIsReady(true);
        setError(null);
      })
    );

    cleanups.push(
      on('atlas:stopped', () => {
        setIsReady(false);
        setState('idle');
      })
    );

    // Error events
    cleanups.push(
      on('atlas:error', (err: unknown) => {
        setError(String(err || 'Unknown error'));
        setState('error');
      })
    );

    // Wake word detected
    cleanups.push(
      on('atlas:wake-word', () => {
        setState('listening');
        setIsListening(true);
      })
    );

    // Wake word feedback (for confidence thresholding visualization)
    cleanups.push(
      on('atlas:wake-feedback', (data: unknown) => {
        if (typeof data === 'object' && data !== null) {
          const feedback = data as WakeWordFeedback;
          setWakeFeedback(feedback);
          setLastWakeFeedbackType(feedback.type);

          // Auto-clear feedback after a delay (except for 'listening' and 'ready')
          if (feedback.type !== 'listening' && feedback.type !== 'ready') {
            setTimeout(() => {
              setWakeFeedback((current) =>
                current?.timestamp === feedback.timestamp ? null : current
              );
            }, 3000);
          }
        }
      })
    );

    // VAD listening state changes
    cleanups.push(
      on('atlas:listening-state', (data: unknown) => {
        if (typeof data === 'string') {
          setListeningState(data as ListeningState);
        }
      })
    );

    // VAD still listening event (pause detected but expecting more speech)
    cleanups.push(
      on('atlas:still-listening', (data: unknown) => {
        if (typeof data === 'object' && data !== null) {
          const event = data as StillListeningEvent;
          setStillListening(event);

          // Auto-clear after the extended timeout
          setTimeout(() => {
            setStillListening((current) =>
              current?.timestamp === event.timestamp ? null : current
            );
          }, event.extendedTimeout);
        }
      })
    );

    // Store cleanup functions
    cleanupFunctionsRef.current = cleanups;

    // Cleanup on unmount
    return () => {
      cleanups.forEach((cleanup) => cleanup());
      cleanupFunctionsRef.current = [];
    };
  }, []);

  // Fetch initial status
  useEffect(() => {
    const fetchStatus = async () => {
      if (!window.atlas?.atlas) return;

      try {
        const result = await window.atlas.atlas.getStatus();
        if (result.success && result.data) {
          const status = result.data as FullVoicePipelineStatus;
          setState(mapToAtlasState(status.state));
          setIsListening(status.isListening);
          setIsSpeaking(status.isSpeaking);
          setAudioLevel(status.audioLevel);
          setSttProvider(status.sttProvider);
          setLlmProvider(status.llmProvider);
          setTranscript(status.currentTranscript);
          setResponse(status.currentResponse);
          setIsReady(true);
        }
      } catch (err) {
        console.error('[useAtlasState] Failed to fetch status:', err);
      }
    };

    fetchStatus();
  }, []);

  // Actions
  const start = useCallback(async () => {
    if (!window.atlas?.atlas) return;
    try {
      const result = await window.atlas.atlas.start();
      if (!result.success) {
        setError(result.error || 'Failed to start');
      }
    } catch (err) {
      setError(String(err));
    }
  }, []);

  const stop = useCallback(async () => {
    if (!window.atlas?.atlas) return;
    try {
      await window.atlas.atlas.stop();
    } catch (err) {
      setError(String(err));
    }
  }, []);

  const triggerWake = useCallback(async () => {
    if (!window.atlas?.atlas) return;
    try {
      await window.atlas.atlas.triggerWake();
    } catch (err) {
      setError(String(err));
    }
  }, []);

  const sendText = useCallback(async (text: string) => {
    if (!window.atlas?.atlas) return;
    try {
      await window.atlas.atlas.sendText(text);
    } catch (err) {
      setError(String(err));
    }
  }, []);

  const clearHistory = useCallback(async () => {
    if (!window.atlas?.atlas) return;
    try {
      await window.atlas.atlas.clearHistory();
      setTranscript('');
      setResponse('');
    } catch (err) {
      setError(String(err));
    }
  }, []);

  return {
    state,
    isReady,
    isListening,
    isSpeaking,
    audioLevel,
    transcript,
    interimTranscript,
    response,
    isThinking,
    sttProvider,
    llmProvider,
    wakeFeedback,
    lastWakeFeedbackType,
    listeningState,
    stillListening,
    error,
    start,
    stop,
    triggerWake,
    sendText,
    clearHistory,
  };
}

export default useAtlasState;
