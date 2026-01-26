/**
 * Real-Time Transcript Overlay
 * Displays live STT (what Atlas hears) and TTS (what Atlas is saying) at the bottom of the screen
 * Lightweight overlay that shows current interaction in real-time
 */

import { useEffect, useState, useRef } from 'react';
import '../styles/RealTimeTranscript.css';

interface RealTimeTranscriptProps {
  /** Show/hide the overlay */
  visible?: boolean;
}

export function RealTimeTranscript({ visible = true }: RealTimeTranscriptProps) {
  const [userText, setUserText] = useState('');
  const [atlasText, setAtlasText] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to show latest text
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [userText, atlasText]);

  useEffect(() => {
    if (!window.atlas) return;

    // STT Events - What Atlas is hearing
    const unsubInterim = window.atlas.on('atlas:transcript-interim', (...args: unknown[]) => {
      const data = args[0] as { text: string };
      setUserText(data.text);
      setIsListening(true);
    });

    const unsubFinal = window.atlas.on(
      'atlas:transcript-final',
      (...args: unknown[]) => {
        const data = args[0] as { text: string; confidence: number };
        // Keep the final transcript visible for a moment
        setUserText(data.text);
        setTimeout(() => {
          setIsListening(false);
          setUserText('');
        }, 2000);
      }
    );

    // LLM Response Events - What Atlas is saying
    const unsubResponseChunk = window.atlas.on('atlas:response-chunk', (...args: unknown[]) => {
      const data = args[0] as { text: string };
      setAtlasText(data.text);
    });

    const unsubResponseComplete = window.atlas.on(
      'atlas:response-complete',
      (...args: unknown[]) => {
        const data = args[0] as { text: string };
        // Keep the final response visible briefly
        setAtlasText(data.text);
      }
    );

    // Speaking Events
    const unsubSpeakingStart = window.atlas.on('atlas:speaking-start', () => {
      setIsSpeaking(true);
    });

    const unsubSpeakingEnd = window.atlas.on('atlas:speaking-end', () => {
      setIsSpeaking(false);
      // Clear Atlas text after speaking ends
      setTimeout(() => {
        setAtlasText('');
      }, 1500);
    });

    // State changes
    const unsubStateChange = window.atlas.on('atlas:state-change', (...args: unknown[]) => {
      const data = args[0] as { state: string };
      if (data.state === 'idle') {
        setUserText('');
        setAtlasText('');
        setIsListening(false);
        setIsSpeaking(false);
      } else if (data.state === 'listening') {
        setIsListening(true);
      }
    });

    // Speech events
    const unsubSpeechStart = window.atlas.on('atlas:speech-start', () => {
      setIsListening(true);
    });

    const unsubSpeechEnd = window.atlas.on('atlas:speech-end', () => {
      setIsListening(false);
    });

    return () => {
      unsubInterim();
      unsubFinal();
      unsubResponseChunk();
      unsubResponseComplete();
      unsubSpeakingStart();
      unsubSpeakingEnd();
      unsubStateChange();
      unsubSpeechStart();
      unsubSpeechEnd();
    };
  }, []);

  // Don't render if not visible or no activity
  if (!visible || (!userText && !atlasText && !isListening && !isSpeaking)) {
    return null;
  }

  return (
    <div
      className="realtime-transcript"
      role="status"
      aria-live="polite"
      aria-label="Real-time conversation"
    >
      <div className="realtime-transcript-content" ref={scrollRef}>
        {/* User speaking (STT) */}
        {(userText || isListening) && (
          <div className="realtime-transcript-entry realtime-transcript-entry--user">
            <div className="realtime-transcript-label">
              <span className="realtime-transcript-icon">🎤</span>
              <span className="realtime-transcript-name">You</span>
              {isListening && <span className="realtime-transcript-indicator">●</span>}
            </div>
            <div className="realtime-transcript-text">
              {userText || <span className="realtime-transcript-placeholder">Listening...</span>}
            </div>
          </div>
        )}

        {/* Atlas responding (TTS) */}
        {(atlasText || isSpeaking) && (
          <div className="realtime-transcript-entry realtime-transcript-entry--atlas">
            <div className="realtime-transcript-label">
              <span className="realtime-transcript-icon">🤖</span>
              <span className="realtime-transcript-name">Atlas</span>
              {isSpeaking && <span className="realtime-transcript-indicator">●</span>}
            </div>
            <div className="realtime-transcript-text">
              {atlasText || <span className="realtime-transcript-placeholder">Thinking...</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
