/**
 * @fileoverview Message List Component
 * Scrollable list of chat messages with auto-scroll
 * Centered layout inspired by ChatGPT/Claude
 * 
 * @module MessageList
 */

import React, { useEffect, useRef } from 'react';
import { MessageBubble, Message } from './MessageBubble';
import { TypingIndicator } from './TypingIndicator';

interface MessageListProps {
  messages: Message[];
  isTyping?: boolean;
}

/**
 * Scrollable message list with centered content and auto-scroll
 */
export const MessageList: React.FC<MessageListProps> = ({
  messages,
  isTyping = false,
}) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isTyping]);
  
  return (
    <div className="chat-messages" ref={containerRef}>
      <div className="chat-messages__container">
        {messages.map((message, index) => (
          <MessageBubble
            key={message.id}
            message={message}
            showAvatar={
              index === 0 ||
              messages[index - 1]?.role !== message.role
            }
          />
        ))}
        {isTyping && <TypingIndicator />}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
};

export default MessageList;
