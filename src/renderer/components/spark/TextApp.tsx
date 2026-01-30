/**
 * @fileoverview TextApp - Text-only Atlas Interface
 * Clean, fast text chat interface without voice features
 * @module spark/TextApp
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { ChatInterface } from './ChatInterface';
import { LeftSidebar } from './LeftSidebar';
import { RightSidebar } from './RightSidebar';
import { useSparkStats } from './useSparkStats';
import './spark-styles.css';
import styles from './TextApp.module.css';

// IPC response type
type IPCResponse<T> = { success: boolean; data?: T; error?: string };

// Extended window interface
type AtlasWindow = Window & {
  atlas?: {
    sendText?: (
      text: string,
      options?: { skipTTS?: boolean }
    ) => Promise<IPCResponse<{ messageId: string }>>;
    on?: (channel: string, callback: (...args: unknown[]) => void) => (() => void) | undefined;
    getMetrics?: () => Promise<IPCResponse<{ avgLatency: number }>>;
    getMemoryStats?: () => Promise<IPCResponse<{ total: number }>>;
  };
};

// LLM Stream chunk type
interface LLMStreamChunk {
  content: string;
  accumulated: string;
  isFinal: boolean;
  finishReason?: string;
}

interface Message {
  id: string;
  type: 'user' | 'ai';
  content: string;
  timestamp: number;
  isStreaming?: boolean;
}

export const TextApp: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      type: 'ai',
      content:
        "I'm Atlas, your AI assistant. I'm designed to evolve through our interactions, learning and adapting to your specific needs. How can I help you today?",
      timestamp: Date.now(),
    },
  ]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const messagesRef = useRef(messages);
  const streamingContentRef = useRef(streamingContent);

  // Keep refs in sync
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    streamingContentRef.current = streamingContent;
  }, [streamingContent]);

  // Get real-time stats
  const stats = useSparkStats();

  // Set up streaming listeners
  useEffect(() => {
    const win = window as AtlasWindow;
    if (!win.atlas?.on) return;

    // Listen for response chunks
    const unsubscribeChunk = win.atlas.on('atlas:response-chunk', (chunk: unknown) => {
      const streamChunk = chunk as LLMStreamChunk;

      if (streamChunk.isFinal) {
        // Finalize message
        setMessages((prev) => {
          const lastMessage = prev[prev.length - 1];
          if (lastMessage?.type === 'ai' && lastMessage.isStreaming) {
            return [
              ...prev.slice(0, -1),
              {
                ...lastMessage,
                content: streamChunk.accumulated,
                isStreaming: false,
              },
            ];
          }
          return prev;
        });
        setStreamingContent('');
        setIsProcessing(false);
      } else {
        // Update streaming content
        setStreamingContent(streamChunk.accumulated);
      }
    });

    // Listen for errors
    const unsubscribeError = win.atlas.on('atlas:error', (error: unknown) => {
      const errorData = error as { type: string; message: string };
      console.error('Atlas error:', errorData);

      setMessages((prev) => {
        const lastMessage = prev[prev.length - 1];
        if (lastMessage?.type === 'ai' && lastMessage.isStreaming) {
          return [
            ...prev.slice(0, -1),
            {
              ...lastMessage,
              content: `Error: ${errorData.message}`,
              isStreaming: false,
            },
          ];
        }
        return prev;
      });
      setStreamingContent('');
      setIsProcessing(false);
    });

    // Cleanup listeners
    return () => {
      unsubscribeChunk?.();
      unsubscribeError?.();
    };
  }, []);

  const handleSendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || isProcessing) return;

      // Add user message
      const userMessage: Message = {
        id: Date.now().toString(),
        type: 'user',
        content: content.trim(),
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, userMessage]);
      setIsProcessing(true);
      setStreamingContent('');

      try {
        const win = window as AtlasWindow;

        // Check if IPC is available
        if (win.atlas?.sendText) {
          // Send to backend with skipTTS for text-only mode
          const response = await win.atlas.sendText(content.trim(), { skipTTS: true });

          if (!response.success) {
            throw new Error(response.error || 'Failed to send message');
          }

          // Create initial streaming message
          setMessages((prev) => [
            ...prev,
            {
              id: (Date.now() + 1).toString(),
              type: 'ai',
              content: '',
              timestamp: Date.now(),
              isStreaming: true,
            },
          ]);
        } else {
          // Fallback: simulate response for development
          simulateResponse(content.trim());
        }
      } catch (error) {
        console.error('Failed to send message:', error);

        // Add error message
        setMessages((prev) => [
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            type: 'ai',
            content: `Sorry, I encountered an error: ${error instanceof Error ? error.message : 'Unknown error'}. Please try again.`,
            timestamp: Date.now(),
          },
        ]);
        setIsProcessing(false);
        setStreamingContent('');
      }
    },
    [isProcessing]
  );

  // Simulate response for development/testing
  const simulateResponse = (userContent: string) => {
    const responses = [
      'I understand. Let me help you with that.',
      "That's an interesting question. Here's what I think...",
      'I can definitely help with that. Let me break it down for you.',
      "Great question! Here's my analysis:",
      "I see what you're asking. Let me provide some insights.",
    ];

    const randomResponse = responses[Math.floor(Math.random() * responses.length)];

    // Add streaming message
    setMessages((prev) => [
      ...prev,
      {
        id: (Date.now() + 1).toString(),
        type: 'ai',
        content: '',
        timestamp: Date.now(),
        isStreaming: true,
      },
    ]);

    // Simulate streaming
    let currentText = '';
    const fullResponse = `${randomResponse}\n\nYou asked about: "${userContent}"\n\n[This is a simulated response for development. Connect to the backend for real AI responses.]`;
    const words = fullResponse.split(' ');

    let wordIndex = 0;
    const streamInterval = setInterval(() => {
      if (wordIndex < words.length) {
        currentText += (wordIndex > 0 ? ' ' : '') + words[wordIndex];
        setStreamingContent(currentText);
        wordIndex++;
      } else {
        clearInterval(streamInterval);
        setMessages((prev) => {
          const lastMessage = prev[prev.length - 1];
          if (lastMessage?.type === 'ai' && lastMessage.isStreaming) {
            return [
              ...prev.slice(0, -1),
              {
                ...lastMessage,
                content: currentText,
                isStreaming: false,
              },
            ];
          }
          return prev;
        });
        setStreamingContent('');
        setIsProcessing(false);
      }
    }, 50); // 50ms per word for realistic streaming effect
  };

  // Cancel ongoing request
  const handleCancel = useCallback(() => {
    // Note: In a real implementation, you'd send a cancel signal to the backend
    // For now, we just clean up the UI state
    setIsProcessing(false);
    setStreamingContent('');

    // Remove streaming message if exists
    setMessages((prev) => {
      const lastMessage = prev[prev.length - 1];
      if (lastMessage?.type === 'ai' && lastMessage.isStreaming) {
        return prev.slice(0, -1);
      }
      return prev;
    });
  }, []);

  // Combine messages with streaming content for display
  const displayMessages = [...messages];
  if (streamingContent && isProcessing) {
    const lastMessage = displayMessages[displayMessages.length - 1];
    if (lastMessage?.type === 'ai' && lastMessage.isStreaming) {
      displayMessages[displayMessages.length - 1] = {
        ...lastMessage,
        content: streamingContent,
      };
    }
  }

  return (
    <div className={`${styles.textApp} text-ui`}>
      <div className={styles.container}>
        {/* Left Sidebar - Stats */}
        <aside className={styles.leftSidebar}>
          <LeftSidebar stats={stats} />
        </aside>

        {/* Center Content - Chat */}
        <main className={styles.centerContent}>
          <div className={styles.header}>
            <h1 className={styles.title}>Atlas</h1>
            <div className={styles.status}>
              <span
                className={`${styles.statusIndicator} ${stats.isOnline ? styles.online : styles.offline}`}
              />
              {stats.isOnline ? 'Connected' : 'Offline'}
            </div>
          </div>

          <div className={styles.chatContainer}>
            <ChatInterface
              messages={displayMessages}
              onSendMessage={handleSendMessage}
              isProcessing={isProcessing}
              onCancel={handleCancel}
            />
          </div>
        </main>

        {/* Right Sidebar - Metrics */}
        <aside className={styles.rightSidebar}>
          <RightSidebar stats={stats} />
        </aside>
      </div>
    </div>
  );
};
