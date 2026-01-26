/**
 * OrbZone - Central orb display area with status overlay
 * Wraps the existing AtlasOrb with transcript and task progress
 * Now includes a chat input for text-based interaction
 */

import { useCallback, useState, useRef, useEffect } from 'react';
import { AtlasOrb } from '../orb';
import { TaskIndicator } from '../TaskIndicator';
import { useAtlasState, useAdaptiveParticles } from '../../hooks';
import { useAtlasStore } from '../../stores';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export function OrbZone() {
  const { state, isReady, audioLevel, error, triggerWake, response } = useAtlasState();
  const { settings } = useAtlasStore();

  // Chat state
  const [chatInput, setChatInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Listen for responses
  useEffect(() => {
    if (response && response.trim()) {
      setMessages(prev => {
        // Avoid duplicate messages
        const lastMsg = prev[prev.length - 1];
        if (lastMsg?.role === 'assistant' && lastMsg?.content === response) {
          return prev;
        }
        return [...prev, {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: response,
          timestamp: Date.now(),
        }];
      });
    }
  }, [response]);

  // Send chat message
  const handleSendChat = async () => {
    const text = chatInput.trim();
    if (!text || isSending) return;

    // Add user message
    setMessages(prev => [...prev, {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
    }]);

    setIsSending(true);
    setChatInput('');

    try {
      const atlasApi = window.atlas as unknown as { atlas?: { sendText?: (text: string) => Promise<void> } };
      await atlasApi?.atlas?.sendText?.(text);
    } catch (err) {
      console.error('Failed to send message:', err);
      setMessages(prev => [...prev, {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: `Error: ${err instanceof Error ? err.message : 'Failed to send'}`,
        timestamp: Date.now(),
      }]);
    } finally {
      setIsSending(false);
    }
  };

  // Handle Enter key
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendChat();
    }
  };

  // Adaptive particle count - reduced for stability
  const { particleCount: adaptiveParticleCount } = useAdaptiveParticles({
    initialParticles: settings.particleCount || 8000, // Reduced from 30000
    enabled: settings.adaptivePerformance ?? true,
    targetFps: 55,
    minParticles: 1000, // Reduced from 2000
    maxParticles: 15000, // Reduced from 50000
  });

  const effectiveParticleCount =
    (settings.adaptivePerformance ?? true)
      ? adaptiveParticleCount
      : settings.particleCount || 8000; // Reduced from 30000

  // Handle orb click
  const handleOrbClick = useCallback(() => {
    if (state === 'idle' && isReady) {
      triggerWake();
    }
  }, [state, isReady, triggerWake]);

  // Get status text
  const getStatusText = () => {
    switch (state) {
      case 'listening':
        return 'Listening...';
      case 'thinking':
        return 'Thinking...';
      case 'speaking':
        return 'Speaking...';
      case 'error':
        return `Error: ${error || 'Unknown'}`;
      default:
        return isReady ? 'Say "Hey Atlas" or click the orb' : 'Starting...';
    }
  };

  return (
    <div className="orb-zone">
      {/* Chat messages area */}
      <div className="orb-chat-messages" style={{
        position: 'absolute',
        top: '10px',
        left: '10px',
        right: '10px',
        bottom: '120px',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '10px',
        background: 'rgba(0, 0, 0, 0.3)',
        borderRadius: '8px',
        maxHeight: 'calc(100% - 180px)',
      }}>
        {messages.map(msg => (
          <div
            key={msg.id}
            style={{
              padding: '8px 12px',
              borderRadius: '12px',
              maxWidth: '80%',
              alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
              background: msg.role === 'user' 
                ? 'rgba(59, 130, 246, 0.8)' 
                : 'rgba(75, 85, 99, 0.8)',
              color: 'white',
              fontSize: '14px',
              lineHeight: '1.4',
            }}
          >
            {msg.content}
          </div>
        ))}
        <div ref={chatEndRef} />
      </div>

      {/* Main orb - smaller when chat active */}
      <div className="orb-container" style={{
        position: 'absolute',
        bottom: '80px',
        left: '50%',
        transform: 'translateX(-50%)',
        width: messages.length > 0 ? '100px' : '200px',
        height: messages.length > 0 ? '100px' : '200px',
        transition: 'all 0.3s ease',
      }}>
        <AtlasOrb
          state={state}
          audioLevel={audioLevel}
          particleCount={effectiveParticleCount}
          onStateClick={handleOrbClick}
          className="orb-main"
        />
      </div>

      {/* Chat input */}
      <div style={{
        position: 'absolute',
        bottom: '10px',
        left: '10px',
        right: '10px',
        display: 'flex',
        gap: '8px',
      }}>
        <input
          type="text"
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          disabled={isSending}
          style={{
            flex: 1,
            padding: '12px 16px',
            borderRadius: '24px',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            background: 'rgba(0, 0, 0, 0.5)',
            color: 'white',
            fontSize: '14px',
            outline: 'none',
          }}
        />
        <button
          onClick={handleSendChat}
          disabled={isSending || !chatInput.trim()}
          style={{
            padding: '12px 24px',
            borderRadius: '24px',
            border: 'none',
            background: isSending ? 'rgba(59, 130, 246, 0.5)' : 'rgba(59, 130, 246, 0.8)',
            color: 'white',
            cursor: isSending || !chatInput.trim() ? 'not-allowed' : 'pointer',
            fontSize: '14px',
            fontWeight: 500,
          }}
        >
          {isSending ? 'Sending...' : 'Send'}
        </button>
      </div>

      {/* Status indicator */}
      <div
        className={`orb-status orb-status-${state}`}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        style={{
          position: 'absolute',
          bottom: '55px',
          left: '50%',
          transform: 'translateX(-50%)',
        }}
      >
        <span className="status-dot" aria-hidden="true" />
        <span className="status-text">{getStatusText()}</span>
      </div>

      {/* Task progress */}
      <div className="orb-task-progress" style={{ display: 'none' }}>
        <TaskIndicator />
      </div>
    </div>
  );
}

export default OrbZone;
