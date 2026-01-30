/**
 * @fileoverview Chat Input Component
 * Text input with send button and voice recording toggle
 * 
 * @module ChatInput
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';

interface ChatInputProps {
  onSend: (message: string) => void;
  onStartVoice?: () => void;
  onStopVoice?: () => void;
  isVoiceActive?: boolean;
  disabled?: boolean;
  placeholder?: string;
}

// Icons as inline SVGs for independence
const SendIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
);

const MicIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="23" />
    <line x1="8" y1="23" x2="16" y2="23" />
  </svg>
);

const MicOffIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="1" y1="1" x2="23" y2="23" />
    <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
    <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
    <line x1="12" y1="19" x2="12" y2="23" />
    <line x1="8" y1="23" x2="16" y2="23" />
  </svg>
);

/**
 * Chat input field with send and voice buttons
 */
export const ChatInput: React.FC<ChatInputProps> = ({
  onSend,
  onStartVoice,
  onStopVoice,
  isVoiceActive = false,
  disabled = false,
  placeholder = 'Type a message or press mic to speak...',
}) => {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
    }
  }, [text]);
  
  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (trimmed && !disabled) {
      onSend(trimmed);
      setText('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    }
  }, [text, disabled, onSend]);
  
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Send on Enter (without Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);
  
  const handleVoiceToggle = useCallback(() => {
    if (isVoiceActive) {
      onStopVoice?.();
    } else {
      onStartVoice?.();
    }
  }, [isVoiceActive, onStartVoice, onStopVoice]);
  
  const canSend = text.trim().length > 0 && !disabled;
  
  return (
    <div className="chat-input">
      <div className="chat-input__field">
        <textarea
          ref={textareaRef}
          className="chat-input__textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          aria-label="Message input"
        />
        
        {/* Voice toggle button */}
        <button
          className={`chat-input__btn chat-input__btn--mic ${isVoiceActive ? 'active' : ''}`}
          onClick={handleVoiceToggle}
          type="button"
          aria-label={isVoiceActive ? 'Stop recording' : 'Start recording'}
          title={isVoiceActive ? 'Stop recording' : 'Start recording'}
        >
          {isVoiceActive ? <MicOffIcon /> : <MicIcon />}
        </button>
      </div>
      
      {/* Send button */}
      <button
        className="chat-input__btn chat-input__btn--send"
        onClick={handleSend}
        disabled={!canSend}
        type="button"
        aria-label="Send message"
        title="Send message"
      >
        <SendIcon />
      </button>
    </div>
  );
};

export default ChatInput;
