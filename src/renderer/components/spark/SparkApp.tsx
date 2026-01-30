/**
 * @fileoverview SparkApp - Main Spark UI Container
 * @module spark/SparkApp
 * Main application container for the Spark futuristic AI interface
 * Connected to real Atlas IPC backend
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { ParticleBackground } from './ParticleBackground';
import { SparkAvatar } from './SparkAvatar';
import { LeftSidebar } from './LeftSidebar';
import { RightSidebar } from './RightSidebar';
import { ChatInterface } from './ChatInterface';
import { useSparkStats } from './useSparkStats';
import { ToolCall } from './ToolCallBlock';
import './spark-styles.css';
import styles from './SparkApp.module.css';

// IPC Types - matches window.atlas structure from preload.ts
type AtlasAPI = {
  on?: (channel: string, callback: (...args: unknown[]) => void) => (() => void) | undefined;
  atlas?: {
    sendText?: (text: string) => Promise<{ success: boolean }>;
  };
};

interface Message {
  id: string;
  type: 'user' | 'ai';
  content: string;
  timestamp: number;
  isStreaming?: boolean;
}

export const SparkApp: React.FC = () => {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const stats = useSparkStats();
  const currentAiMessageIdRef = useRef<string | null>(null);
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);

  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      type: 'ai',
      content:
        "I'm neither a local model nor Claude. I am Atlas, designed to evolve through interactions, focusing on learning and adapting to your specific needs and preferences. How does that align with your expectations for our interaction?",
      timestamp: Date.now(),
    },
  ]);

  // Set up IPC listeners for streaming responses
  useEffect(() => {
    const win = window as Window & { atlas?: AtlasAPI };
    if (!win.atlas?.on) return;

    const unsubChunk = win.atlas.on('atlas:response-chunk', (chunk: unknown) => {
      const streamChunk = chunk as { content?: string; accumulated?: string; delta?: string; isFinal?: boolean };

      if (streamChunk.isFinal) {
        // Finalize the message
        setMessages(prev => {
          const lastMessage = prev[prev.length - 1];
          if (lastMessage?.type === 'ai' && lastMessage.isStreaming) {
            return [
              ...prev.slice(0, -1),
              {
                ...lastMessage,
                content: streamChunk.accumulated || lastMessage.content,
                isStreaming: false,
              },
            ];
          }
          return prev;
        });
        setIsProcessing(false);
        setIsSpeaking(false);
        currentAiMessageIdRef.current = null;
      } else {
        // Update streaming content
        const newContent = streamChunk.accumulated || streamChunk.delta;
        if (newContent && currentAiMessageIdRef.current) {
          setMessages(prev => prev.map(msg =>
            msg.id === currentAiMessageIdRef.current
              ? { ...msg, content: streamChunk.accumulated || (msg.content + (streamChunk.delta || '')) }
              : msg
          ));
        }
      }
    });

    const unsubComplete = win.atlas.on('atlas:response-complete', () => {
      setIsProcessing(false);
      setIsSpeaking(false);
      // Mark message as not streaming
      if (currentAiMessageIdRef.current) {
        setMessages(prev => prev.map(msg =>
          msg.id === currentAiMessageIdRef.current
            ? { ...msg, isStreaming: false }
            : msg
        ));
        currentAiMessageIdRef.current = null;
      }
    });

    // Tool execution events
    const unsubToolStart = win.atlas.on('atlas:tool-start', (data: unknown) => {
      const toolData = data as { toolName: string; params?: Record<string, unknown>; startTime: number };
      const newTool: ToolCall = {
        id: `tool-${Date.now()}`,
        toolName: toolData.toolName,
        params: toolData.params,
        status: 'running',
        startTime: toolData.startTime,
      };
      setToolCalls(prev => [...prev, newTool]);
    });

    const unsubToolComplete = win.atlas.on('atlas:tool-complete', (data: unknown) => {
      const toolData = data as { toolName: string; result?: unknown; endTime: number };
      setToolCalls(prev => prev.map(tool =>
        tool.toolName === toolData.toolName && tool.status === 'running'
          ? { ...tool, status: 'completed' as const, result: toolData.result, endTime: toolData.endTime }
          : tool
      ));
    });

    const unsubToolError = win.atlas.on('atlas:tool-error', (data: unknown) => {
      const toolData = data as { toolName: string; error: string; endTime: number };
      setToolCalls(prev => prev.map(tool =>
        tool.toolName === toolData.toolName && tool.status === 'running'
          ? { ...tool, status: 'error' as const, error: toolData.error, endTime: toolData.endTime }
          : tool
      ));
    });

    return () => {
      unsubChunk?.();
      unsubComplete?.();
      unsubToolStart?.();
      unsubToolComplete?.();
      unsubToolError?.();
    };
  }, []);

  const handleSendMessage = useCallback(async (content: string) => {
    // Add user message
    const userMessage: Message = {
      id: Date.now().toString(),
      type: 'user',
      content,
      timestamp: Date.now(),
    };

    // Add placeholder AI message for streaming
    const aiMessageId = (Date.now() + 1).toString();
    currentAiMessageIdRef.current = aiMessageId;
    const aiMessage: Message = {
      id: aiMessageId,
      type: 'ai',
      content: '',
      timestamp: Date.now(),
      isStreaming: true,
    };

    setMessages(prev => [...prev, userMessage, aiMessage]);
    setIsSpeaking(true);
    setIsProcessing(true);

    // Send to Atlas via IPC
    try {
      const win = window as Window & { atlas?: AtlasAPI };
      if (win.atlas?.atlas?.sendText) {
        await win.atlas.atlas.sendText(content);
      } else {
        // Fallback simulation if Atlas not available
        setTimeout(() => {
          setMessages(prev => prev.map(msg =>
            msg.id === aiMessageId
              ? { ...msg, content: "Atlas backend not connected. Running in demo mode.", isStreaming: false }
              : msg
          ));
          setIsProcessing(false);
          setIsSpeaking(false);
          currentAiMessageIdRef.current = null;
        }, 1000);
      }
    } catch (error) {
      console.error('[SparkApp] Error sending message:', error);
      setMessages(prev => prev.map(msg =>
        msg.id === aiMessageId
          ? { ...msg, content: "I encountered an error. Please try again.", isStreaming: false }
          : msg
      ));
      setIsProcessing(false);
      setIsSpeaking(false);
      currentAiMessageIdRef.current = null;
    }
  }, []);

  const handleCancel = useCallback(() => {
    setIsProcessing(false);
    setIsSpeaking(false);
    // Remove streaming message
    if (currentAiMessageIdRef.current) {
      setMessages(prev => prev.filter(msg => msg.id !== currentAiMessageIdRef.current || !msg.isStreaming));
      currentAiMessageIdRef.current = null;
    }
  }, []);

  return (
    <div className={`${styles.sparkApp} spark-ui`}>
      <ParticleBackground />

      <div className={styles.container}>
        {/* Left Sidebar */}
        <aside className={styles.leftSidebar}>
          <LeftSidebar stats={stats} />
        </aside>

        {/* Center Content */}
        <main className={styles.centerContent}>
          {/* Avatar Section */}
          <div className={styles.avatarSection}>
            <SparkAvatar isSpeaking={isSpeaking} />
          </div>

          {/* Chat Section */}
          <div className={styles.chatSection}>
            <ChatInterface
              messages={messages}
              onSendMessage={handleSendMessage}
              isProcessing={isProcessing}
              onCancel={handleCancel}
              toolCalls={toolCalls}
            />
          </div>
        </main>

        {/* Right Sidebar */}
        <aside className={styles.rightSidebar}>
          <RightSidebar stats={stats} />
        </aside>
      </div>
    </div>
  );
};
