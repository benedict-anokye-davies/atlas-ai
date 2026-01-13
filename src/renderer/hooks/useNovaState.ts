/**
 * Nova Desktop - useNovaState Hook
 * Connects to the voice pipeline IPC events and provides reactive state
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { NovaState } from '../components/orb/NovaParticles';

/**
 * Voice Pipeline Status from main process
 */
interface VoicePipelineStatus {
  state: string;
  isListening: boolean;
  isSpeaking: boolean;
  audioLevel: number;
  sttProvider: string | null;
  llmProvider: string | null;
  isTTSSpeaking: boolean;
  currentTranscript: string;
  currentResponse: string;
}

/**
 * State returned by the hook
 */
interface NovaStateResult {
  // Core state
  state: NovaState;
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
 * Map pipeline state string to NovaState type
 */
function mapToNovaState(pipelineState: string): NovaState {
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
 * Hook to connect to Nova voice pipeline
 */
export function useNovaState(): NovaStateResult {
  // Core state
  const [state, setState] = useState<NovaState>('idle');
  const [isReady, setIsReady] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  
  // Audio
  const [audioLevel, setAudioLevel] = useState(0);
  
  // Transcription
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  
  // Response
  const [response, setResponse] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  
  // Providers
  const [sttProvider, setSttProvider] = useState<string | null>(null);
  const [llmProvider, setLlmProvider] = useState<string | null>(null);
  
  // Error
  const [error, setError] = useState<string | null>(null);
  
  // Cleanup refs
  const cleanupFunctionsRef = useRef<Array<() => void>>([]);

  // Subscribe to IPC events
  useEffect(() => {
    if (!window.nova) {
      console.warn('[useNovaState] Nova API not available');
      return;
    }

    const { on } = window.nova;
    const cleanups: Array<() => void> = [];

    // State change events
    cleanups.push(
      on('nova:state-change', (newState: unknown) => {
        const stateStr = String(newState);
        setState(mapToNovaState(stateStr));
        setIsListening(stateStr === 'listening');
        setIsThinking(stateStr === 'processing' || stateStr === 'thinking');
      })
    );

    // Audio level
    cleanups.push(
      on('nova:audio-level', (level: unknown) => {
        setAudioLevel(typeof level === 'number' ? level : 0);
      })
    );

    // Transcription events
    cleanups.push(
      on('nova:transcript-interim', (text: unknown) => {
        setInterimTranscript(String(text || ''));
      })
    );

    cleanups.push(
      on('nova:transcript-final', (text: unknown) => {
        setTranscript(String(text || ''));
        setInterimTranscript('');
      })
    );

    // Response events
    cleanups.push(
      on('nova:response-start', () => {
        setResponse('');
        setIsThinking(true);
      })
    );

    cleanups.push(
      on('nova:response-chunk', (chunk: unknown) => {
        setResponse((prev) => prev + String(chunk || ''));
      })
    );

    cleanups.push(
      on('nova:response-complete', (fullResponse: unknown) => {
        setResponse(String(fullResponse || ''));
        setIsThinking(false);
      })
    );

    // Speaking events
    cleanups.push(
      on('nova:speaking-start', () => {
        setIsSpeaking(true);
        setState('speaking');
      })
    );

    cleanups.push(
      on('nova:speaking-end', () => {
        setIsSpeaking(false);
        setState('idle');
      })
    );

    // Provider changes
    cleanups.push(
      on('nova:provider-change', (data: unknown) => {
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
      on('nova:started', () => {
        setIsReady(true);
        setError(null);
      })
    );

    cleanups.push(
      on('nova:stopped', () => {
        setIsReady(false);
        setState('idle');
      })
    );

    // Error events
    cleanups.push(
      on('nova:error', (err: unknown) => {
        setError(String(err || 'Unknown error'));
        setState('error');
      })
    );

    // Wake word detected
    cleanups.push(
      on('nova:wake-word', () => {
        setState('listening');
        setIsListening(true);
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
      if (!window.nova?.nova) return;

      try {
        const result = await window.nova.nova.getStatus();
        if (result.success && result.data) {
          const status = result.data as VoicePipelineStatus;
          setState(mapToNovaState(status.state));
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
        console.error('[useNovaState] Failed to fetch status:', err);
      }
    };

    fetchStatus();
  }, []);

  // Actions
  const start = useCallback(async () => {
    if (!window.nova?.nova) return;
    try {
      const result = await window.nova.nova.start();
      if (!result.success) {
        setError(result.error || 'Failed to start');
      }
    } catch (err) {
      setError(String(err));
    }
  }, []);

  const stop = useCallback(async () => {
    if (!window.nova?.nova) return;
    try {
      await window.nova.nova.stop();
    } catch (err) {
      setError(String(err));
    }
  }, []);

  const triggerWake = useCallback(async () => {
    if (!window.nova?.nova) return;
    try {
      await window.nova.nova.triggerWake();
    } catch (err) {
      setError(String(err));
    }
  }, []);

  const sendText = useCallback(async (text: string) => {
    if (!window.nova?.nova) return;
    try {
      await window.nova.nova.sendText(text);
    } catch (err) {
      setError(String(err));
    }
  }, []);

  const clearHistory = useCallback(async () => {
    if (!window.nova?.nova) return;
    try {
      await window.nova.nova.clearHistory();
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
    error,
    start,
    stop,
    triggerWake,
    sendText,
    clearHistory,
  };
}

export default useNovaState;
