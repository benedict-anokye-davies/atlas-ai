/**
 * @fileoverview Chat Message Bubble Component
 * Displays individual messages in the chat interface
 * Full-width design inspired by ChatGPT/Claude
 * 
 * @module MessageBubble
 */

import React from 'react';
import { MiniOrb } from './MiniOrb';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  isStreaming?: boolean;
}

interface MessageBubbleProps {
  message: Message;
  showAvatar?: boolean;
}

/**
 * Formats a timestamp to a human-readable time string
 */
function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// User icon SVG
const UserIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
  </svg>
);

/**
 * Individual message in the chat - Full-width ChatGPT/Claude style
 */
export const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  showAvatar = true,
}) => {
  const isUser = message.role === 'user';
  const roleClass = isUser ? 'message-bubble--user' : 'message-bubble--assistant';
  
  return (
    <div className={`message-bubble ${roleClass}`}>
      {showAvatar && (
        <div className="message-bubble__avatar">
          {isUser ? (
            <UserIcon />
          ) : (
            <MiniOrb state="idle" size={20} />
          )}
        </div>
      )}
      <div className="message-bubble__content-wrapper">
        <div className="message-bubble__name">
          {isUser ? 'You' : 'Atlas'}
        </div>
        <div className="message-bubble__content">
          {message.content}
          {message.isStreaming && <span className="message-bubble__cursor" />}
        </div>
        <div className="message-bubble__time">
          {formatTime(message.timestamp)}
        </div>
      </div>
    </div>
  );
};

export default MessageBubble;
