/**
 * @fileoverview ChatInterface - Chat messages and input
 */

import React, { useState, useRef, useEffect } from 'react';
import { GlassPanel } from './GlassPanel';
import { ToolCallBlock, ToolCall } from './ToolCallBlock';
import styles from './ChatInterface.module.css';

interface Message {
  id: string;
  type: 'user' | 'ai';
  content: string;
  timestamp: number;
  isStreaming?: boolean;
}

interface ChatInterfaceProps {
  messages: Message[];
  onSendMessage: (content: string) => void;
  isProcessing?: boolean;
  onCancel?: () => void;
  toolCalls?: ToolCall[];
}

export const ChatInterface: React.FC<ChatInterfaceProps> = ({
  messages,
  onSendMessage,
  isProcessing = false,
  onCancel,
  toolCalls = [],
}) => {
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Focus input when not processing
  useEffect(() => {
    if (!isProcessing) {
      inputRef.current?.focus();
    }
  }, [isProcessing]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputValue.trim() && !isProcessing) {
      onSendMessage(inputValue);
      setInputValue('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Escape to cancel
    if (e.key === 'Escape' && isProcessing && onCancel) {
      onCancel();
    }
  };

  return (
    <GlassPanel className={styles.chatContainer}>
      {/* Messages */}
      <div className={styles.messagesList}>
        {/* Render tool calls at the top if any are running */}
        {toolCalls.length > 0 && (
          <div className={styles.toolCallsContainer}>
            {toolCalls.map((tool) => (
              <ToolCallBlock key={tool.id} tool={tool} />
            ))}
          </div>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            className={`${styles.message} ${message.type === 'user' ? styles.userMessage : styles.aiMessage
              } ${message.isStreaming ? styles.streaming : ''}`}
          >
            <div className={styles.messageContent}>
              {message.content}
              {message.isStreaming && <span className={styles.streamingCursor}>▊</span>}
            </div>
            {message.type === 'ai' && !message.isStreaming && (
              <div className={styles.messageActions}>
                <button className={styles.actionButton}>👍</button>
                <button className={styles.actionButton}>👎</button>
                <button className={styles.actionButton}>📋 Copy</button>
              </div>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className={styles.inputForm}>
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            isProcessing ? 'Atlas is thinking... (Press Esc to cancel)' : 'Message Atlas...'
          }
          className={styles.input}
          disabled={isProcessing}
        />
        {isProcessing ? (
          <button
            type="button"
            className={styles.cancelButton}
            onClick={onCancel}
            title="Cancel (Esc)"
          >
            ✕
          </button>
        ) : (
          <button type="submit" className={styles.sendButton} disabled={!inputValue.trim()}>
            ➤
          </button>
        )}
      </form>
    </GlassPanel>
  );
};
