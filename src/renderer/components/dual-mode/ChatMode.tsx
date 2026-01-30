/**
 * @fileoverview Chat Mode Component
 * Full chat interface with message history and input
 * Inspired by Perplexity/Claude's clean, minimal design
 * 
 * @module ChatMode
 */

import React from 'react';
import { MiniOrb, OrbState } from './MiniOrb';
import { MessageList } from './MessageList';
import { Message } from './MessageBubble';
import { ChatInput } from './ChatInput';

interface ChatModeProps {
  orbState: OrbState;
  audioLevel?: number;
  messages: Message[];
  currentTranscript?: string;
  streamingResponse?: string;
  onSendMessage: (message: string) => void;
  onStartVoice?: () => void;
  onStopVoice?: () => void;
  isVoiceActive?: boolean;
}

/**
 * Maps orb state to human-readable status text
 */
function getStatusText(state: OrbState): string {
  switch (state) {
    case 'listening': return 'Listening...';
    case 'thinking': return 'Thinking...';
    case 'speaking': return 'Speaking...';
    case 'error': return 'Error occurred';
    default: return 'Online';
  }
}

// Suggestion chips for empty state
const SUGGESTIONS = [
  "What can you help me with?",
  "Tell me about yourself",
  "Help me write code",
  "Search the web for...",
];

/**
 * Full chat mode interface - Perplexity/Claude inspired
 * Clean, centered layout with full-width messages
 */
export const ChatMode: React.FC<ChatModeProps> = ({
  orbState,
  audioLevel = 0,
  messages,
  currentTranscript,
  streamingResponse,
  onSendMessage,
  onStartVoice,
  onStopVoice,
  isVoiceActive = false,
}) => {
  // Build display messages including streaming content
  const displayMessages = React.useMemo(() => {
    const msgs = [...messages];
    
    // Add current transcript as user message being formed
    if (currentTranscript && orbState === 'listening') {
      msgs.push({
        id: 'current-transcript',
        role: 'user',
        content: currentTranscript,
        timestamp: Date.now(),
        isStreaming: true,
      });
    }
    
    // Add streaming response as assistant message
    if (streamingResponse && (orbState === 'thinking' || orbState === 'speaking')) {
      msgs.push({
        id: 'streaming-response',
        role: 'assistant',
        content: streamingResponse,
        timestamp: Date.now(),
        isStreaming: true,
      });
    }
    
    return msgs;
  }, [messages, currentTranscript, streamingResponse, orbState]);
  
  const isProcessing = orbState === 'thinking' || orbState === 'speaking';
  const isEmpty = messages.length === 0 && !currentTranscript && !streamingResponse;
  
  return (
    <div className="chat-mode">
      {/* Main Chat Area */}
      <div className="chat-main">
        {/* Header - Minimal */}
        <div className="chat-header">
          <div className="chat-header__left">
            <MiniOrb state={orbState} size={32} audioLevel={audioLevel} />
            <div>
              <div className="chat-header__title">Atlas</div>
              <div className="chat-header__status">
                <span className={`chat-header__status-dot ${orbState !== 'idle' ? 'chat-header__status-dot--active' : ''}`} />
                {getStatusText(orbState)}
              </div>
            </div>
          </div>
        </div>
        
        {/* Messages or Welcome */}
        {isEmpty ? (
          <div className="chat-welcome">
            <div className="chat-welcome__logo">
              <MiniOrb state="idle" size={40} />
            </div>
            <h1 className="chat-welcome__title">Hey, how can I help?</h1>
            <p className="chat-welcome__subtitle">
              I'm Atlas, your AI assistant. Ask me anything or use voice by clicking the mic.
            </p>
            <div className="chat-welcome__suggestions">
              {SUGGESTIONS.map((suggestion, i) => (
                <button 
                  key={i}
                  className="chat-welcome__suggestion"
                  onClick={() => onSendMessage(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <MessageList
            messages={displayMessages}
            isTyping={orbState === 'thinking' && !streamingResponse}
          />
        )}
        
        {/* Input - Centered at bottom */}
        <div className="chat-input-wrapper">
          <div className="chat-input-container">
            <ChatInput
              onSend={onSendMessage}
              onStartVoice={onStartVoice}
              onStopVoice={onStopVoice}
              isVoiceActive={isVoiceActive}
              disabled={isProcessing}
              placeholder={isProcessing ? 'Atlas is responding...' : 'Ask anything...'}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatMode;
