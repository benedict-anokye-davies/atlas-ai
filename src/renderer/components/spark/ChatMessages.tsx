/**
 * @fileoverview ChatMessages - Message list component
 */

import React from 'react';
import styles from './ModernAtlas.module.css';

interface Message {
  id: string;
  type: 'user' | 'ai';
  content: string;
  timestamp: number;
  isStreaming?: boolean;
}

interface ChatMessagesProps {
  messages: Message[];
}

export const ChatMessages: React.FC<ChatMessagesProps> = ({ messages }) => {
  return (
    <div className={styles.messagesList}>
      {messages.map((message) => (
        <div
          key={message.id}
          className={`${styles.message} ${message.type === 'user' ? styles.userMessage : styles.aiMessage}`}
        >
          <div className={styles.messageAvatar}>
            {message.type === 'user' ? (
              <div className={styles.userAvatar}>U</div>
            ) : (
              <div className={styles.aiAvatar}>A</div>
            )}
          </div>
          <div className={styles.messageContent}>
            <div className={styles.messageHeader}>
              <span className={styles.messageAuthor}>
                {message.type === 'user' ? 'You' : 'Atlas'}
              </span>
              <span className={styles.messageTime}>
                {new Date(message.timestamp).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>
            <div className={styles.messageText}>
              {message.content}
              {message.isStreaming && <span className={styles.streamingCursor}>▊</span>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};
