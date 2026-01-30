/**
 * @fileoverview ModernAtlas - Drastically improved Atlas interface
 * Based on modern chat UI design with thinking states and tool visualization
 * @module spark/ModernAtlas
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { ChatMessages } from './ChatMessages';
import { ThinkingPanel } from './ThinkingPanel';
import { ToolVisualizer } from './ToolVisualizer';
import { Sidebar } from './Sidebar';
import { useSparkStats } from './useSparkStats';
import './spark-styles.css';
import styles from './ModernAtlas.module.css';

// Types
type IPCResponse<T> = { success: boolean; data?: T; error?: string };

type AtlasAPI = {
  sendText?: (
    text: string,
    options?: { skipTTS?: boolean }
  ) => Promise<IPCResponse<{ messageId: string }>>;
  on?: (channel: string, callback: (...args: unknown[]) => void) => (() => void) | undefined;
};

interface Message {
  id: string;
  type: 'user' | 'ai';
  content: string;
  timestamp: number;
  isStreaming?: boolean;
  tools?: ToolExecution[];
}

interface ToolExecution {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  params?: Record<string, unknown>;
  result?: unknown;
  startTime: number;
  endTime?: number;
}

interface ThinkingState {
  isThinking: boolean;
  currentStep: string;
  steps: string[];
  tools: ToolExecution[];
  startTime: number;
}

export const ModernAtlas: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      type: 'ai',
      content:
        "Hello! I'm Atlas, your AI assistant. I can help you with coding, analysis, research, and much more. What would you like to work on?",
      timestamp: Date.now(),
    },
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [thinking, setThinking] = useState<ThinkingState | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const stats = useSparkStats();

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 200)}px`;
    }
  }, [inputValue]);

  // Set up IPC listeners
  useEffect(() => {
    const win = window as Window & { atlas?: AtlasAPI };
    if (!win.atlas?.on) return;

    const unsubscribeChunk = win.atlas.on('atlas:response-chunk', (chunk: unknown) => {
      const streamChunk = chunk as { content: string; accumulated: string; isFinal: boolean };

      if (streamChunk.isFinal) {
        setMessages((prev) => {
          const lastMessage = prev[prev.length - 1];
          if (lastMessage?.type === 'ai' && lastMessage.isStreaming) {
            return [
              ...prev.slice(0, -1),
              {
                ...lastMessage,
                content: streamChunk.accumulated,
                isStreaming: false,
                tools: thinking?.tools,
              },
            ];
          }
          return prev;
        });
        setStreamingContent('');
        setIsProcessing(false);
        setThinking(null);
      } else {
        setStreamingContent(streamChunk.accumulated);
        setThinking((prev) => (prev ? { ...prev, isThinking: false } : null));
      }
    });

    const unsubscribeTool = win.atlas.on('atlas:tool-start', (tool: unknown) => {
      const toolData = tool as { name: string; params: Record<string, unknown> };
      setThinking((prev) => {
        if (!prev) return null;
        const newTool: ToolExecution = {
          id: Date.now().toString(),
          name: toolData.name,
          status: 'running',
          params: toolData.params,
          startTime: Date.now(),
        };
        return {
          ...prev,
          tools: [...prev.tools, newTool],
          currentStep: `Using ${toolData.name}...`,
        };
      });
    });

    const unsubscribeToolComplete = win.atlas.on('atlas:tool-complete', (result: unknown) => {
      const toolResult = result as { toolName: string; result: unknown };
      setThinking((prev) => {
        if (!prev) return null;
        const updatedTools = prev.tools.map((t) =>
          t.name === toolResult.toolName && t.status === 'running'
            ? { ...t, status: 'completed' as const, result: toolResult.result, endTime: Date.now() }
            : t
        );
        return { ...prev, tools: updatedTools };
      });
    });

    return () => {
      unsubscribeChunk?.();
      unsubscribeTool?.();
      unsubscribeToolComplete?.();
    };
  }, [thinking?.tools]);

  const handleSend = useCallback(async () => {
    if (!inputValue.trim() || isProcessing) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      type: 'user',
      content: inputValue.trim(),
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    setIsProcessing(true);
    setStreamingContent('');
    setThinking({
      isThinking: true,
      currentStep: 'Analyzing your request...',
      steps: ['Analyzing your request...'],
      tools: [],
      startTime: Date.now(),
    });

    try {
      const win = window as Window & { atlas?: AtlasAPI };
      if (win.atlas?.sendText) {
        await win.atlas.sendText(inputValue.trim(), { skipTTS: true });
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
        simulateResponse(inputValue.trim());
      }
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          type: 'ai',
          content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          timestamp: Date.now(),
        },
      ]);
      setIsProcessing(false);
      setThinking(null);
    }
  }, [inputValue, isProcessing]);

  const simulateResponse = (userContent: string) => {
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

    // Simulate thinking steps
    const steps = [
      'Analyzing your request...',
      'Searching codebase...',
      'Reading files...',
      'Processing information...',
      'Generating response...',
    ];

    let stepIndex = 0;
    const stepInterval = setInterval(() => {
      if (stepIndex < steps.length) {
        setThinking((prev) =>
          prev
            ? {
                ...prev,
                currentStep: steps[stepIndex],
                steps: [...prev.steps, steps[stepIndex]],
              }
            : null
        );
        stepIndex++;
      } else {
        clearInterval(stepInterval);
      }
    }, 800);

    // Simulate streaming response
    const response = `I'll help you with that. Based on your request about "${userContent}", here's what I found:

The codebase contains a modern React application with TypeScript. I can see you have:
- A voice pipeline system
- LLM integration with Fireworks
- Real-time streaming capabilities
- Tool execution framework

Would you like me to analyze any specific part of the codebase or help you implement a feature?`;

    const words = response.split(' ');
    let wordIndex = 0;
    let currentText = '';

    setTimeout(
      () => {
        clearInterval(stepInterval);
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
            setThinking(null);
          }
        }, 30);
      },
      steps.length * 800 + 500
    );
  };

  const handleCancel = useCallback(() => {
    setIsProcessing(false);
    setStreamingContent('');
    setThinking(null);
    setMessages((prev) => {
      const lastMessage = prev[prev.length - 1];
      if (lastMessage?.type === 'ai' && lastMessage.isStreaming) {
        return prev.slice(0, -1);
      }
      return prev;
    });
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === 'Escape' && isProcessing) {
      handleCancel();
    }
  };

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
    <div className={styles.modernAtlas}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.logo}>
          <div className={styles.logoIcon}>A</div>
          <span className={styles.logoText}>Atlas</span>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.headerButton}>+ New Chat</button>
          <div className={styles.statusBadge}>
            <span
              className={`${styles.statusDot} ${stats.isOnline ? styles.online : styles.offline}`}
            />
            {stats.isOnline ? 'Connected' : 'Offline'}
          </div>
        </div>
      </header>

      <div className={styles.mainContainer}>
        {/* Sidebar */}
        <Sidebar stats={stats} />

        {/* Chat Area */}
        <div className={styles.chatArea}>
          {/* Messages */}
          <div className={styles.messagesContainer}>
            <ChatMessages messages={displayMessages} />
            <div ref={messagesEndRef} />
          </div>

          {/* Thinking Panel */}
          {thinking && <ThinkingPanel thinking={thinking} onCancel={handleCancel} />}

          {/* Input Area */}
          <div className={styles.inputArea}>
            <div className={styles.inputContainer}>
              <textarea
                ref={inputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={isProcessing ? 'Atlas is thinking...' : 'Message Atlas...'}
                className={styles.textarea}
                disabled={isProcessing}
                rows={1}
              />
              <div className={styles.inputActions}>
                {isProcessing ? (
                  <button
                    className={styles.cancelButton}
                    onClick={handleCancel}
                    title="Cancel (Esc)"
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                ) : (
                  <button
                    className={styles.sendButton}
                    onClick={handleSend}
                    disabled={!inputValue.trim()}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <line x1="22" y1="2" x2="11" y2="13" />
                      <polygon points="22 2 15 22 11 13 2 9 22 2" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
            <div className={styles.inputHint}>
              {isProcessing
                ? 'Press Esc to cancel'
                : 'Press Enter to send, Shift+Enter for new line'}
            </div>
          </div>
        </div>

        {/* Tool Visualizer */}
        {thinking && thinking.tools.length > 0 && <ToolVisualizer tools={thinking.tools} />}
      </div>
    </div>
  );
};
