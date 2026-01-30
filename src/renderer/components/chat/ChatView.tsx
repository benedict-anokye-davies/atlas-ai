/**
 * Atlas Desktop - ChatView Component
 * Modern AI chat interface like Claude/Perplexity
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import '../../styles/chat-theme.css';

// Types
export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
}

// Tool call interface for tracking tool executions
export interface ToolCall {
    id: string;
    name: string;
    status: 'running' | 'complete' | 'error';
    params?: Record<string, unknown>;
    result?: unknown;
    error?: string;
}

export interface ChatViewProps {
    className?: string;
    onSendMessage?: (message: string) => void;
    onVoiceStart?: () => void;
    onVoiceStop?: () => void;
    isVoiceActive?: boolean;
    isThinking?: boolean;
    messages?: ChatMessage[];
    activeTools?: ToolCall[];
}

// Thinking indicator component
const ThinkingIndicator: React.FC = () => (
    <div className="chat-thinking">
        <div className="chat-thinking__dots">
            <span className="chat-thinking__dot" />
            <span className="chat-thinking__dot" />
            <span className="chat-thinking__dot" />
        </div>
        <span>Atlas is thinking...</span>
    </div>
);

// Tool call display component - shows running/completed tools like Claude/Copilot
const ToolCallDisplay: React.FC<{ tools: ToolCall[] }> = ({ tools }) => {
    if (tools.length === 0) return null;

    return (
        <motion.div
            className="chat-tools"
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
        >
            {tools.map(tool => (
                <div key={tool.id} className={`chat-tool chat-tool--${tool.status}`}>
                    <span className="chat-tool__icon">
                        {tool.status === 'running' ? '⚙️' : tool.status === 'complete' ? '✅' : '❌'}
                    </span>
                    <span className="chat-tool__name">
                        {tool.status === 'running' ? 'Running: ' : tool.status === 'complete' ? 'Completed: ' : 'Failed: '}
                        <code>{tool.name}</code>
                    </span>
                    {tool.status === 'running' && (
                        <span className="chat-tool__spinner" />
                    )}
                </div>
            ))}
        </motion.div>
    );
};

// Single message component
const Message: React.FC<{ message: ChatMessage }> = ({ message }) => {
    const isUser = message.role === 'user';

    return (
        <motion.div
            className="chat-message"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
        >
            <div className={`chat-message__avatar ${!isUser ? 'chat-message__avatar--ai' : ''}`}>
                {isUser ? '👤' : 'A'}
            </div>
            <div className="chat-message__content">
                <div className="chat-message__role">
                    {isUser ? 'You' : 'Atlas'}
                </div>
                <div className="chat-message__text">
                    {message.content.split('\n').map((line, i) => (
                        <p key={i}>{line || <br />}</p>
                    ))}
                </div>
            </div>
        </motion.div>
    );
};

// Main ChatView component
export const ChatView: React.FC<ChatViewProps> = ({
    className = '',
    onSendMessage,
    onVoiceStart,
    onVoiceStop,
    isVoiceActive = false,
    isThinking = false,
    messages = [],
    activeTools = [],
}) => {
    const [inputValue, setInputValue] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Auto-scroll to bottom when new messages arrive
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isThinking]);

    // Auto-resize textarea
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
        }
    }, [inputValue]);

    const handleSubmit = useCallback((e?: React.FormEvent) => {
        e?.preventDefault();
        const trimmed = inputValue.trim();
        if (trimmed && onSendMessage) {
            onSendMessage(trimmed);
            setInputValue('');
            if (textareaRef.current) {
                textareaRef.current.style.height = 'auto';
            }
        }
    }, [inputValue, onSendMessage]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
        }
    }, [handleSubmit]);

    const handleVoiceClick = useCallback(() => {
        if (isVoiceActive) {
            onVoiceStop?.();
        } else {
            onVoiceStart?.();
        }
    }, [isVoiceActive, onVoiceStart, onVoiceStop]);

    return (
        <div className={`chat-main ${className}`}>
            {/* Header */}
            <header className="chat-header">
                <h1 className="chat-header__title">Atlas</h1>
                <div className="chat-header__actions">
                    {/* Future: Add settings, new chat buttons here */}
                </div>
            </header>

            {/* Messages */}
            <div className="chat-messages">
                <div className="chat-messages__container">
                    {messages.length === 0 ? (
                        <div style={{
                            textAlign: 'center',
                            padding: '60px 20px',
                            color: 'var(--chat-text-muted)'
                        }}>
                            <h2 style={{
                                fontSize: '1.5rem',
                                marginBottom: '8px',
                                color: 'var(--chat-text-primary)'
                            }}>
                                How can I help you today?
                            </h2>
                            <p>Ask me anything or use voice by clicking the microphone.</p>
                        </div>
                    ) : (
                        <>
                            {messages.map((msg) => (
                                <Message key={msg.id} message={msg} />
                            ))}
                            {/* Show tool calls during execution */}
                            {activeTools.length > 0 && (
                                <ToolCallDisplay tools={activeTools} />
                            )}
                        </>
                    )}

                    <AnimatePresence>
                        {isThinking && (
                            <motion.div
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                            >
                                <ThinkingIndicator />
                            </motion.div>
                        )}
                    </AnimatePresence>

                    <div ref={messagesEndRef} />
                </div>
            </div>

            {/* Input */}
            <div className="chat-input-area">
                <div className="chat-input-container">
                    <form onSubmit={handleSubmit} className="chat-input-wrapper">
                        <textarea
                            ref={textareaRef}
                            className="chat-input"
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Message Atlas..."
                            rows={1}
                        />

                        {/* Voice button */}
                        <button
                            type="button"
                            className={`chat-input__voice ${isVoiceActive ? 'chat-input__voice--active' : ''}`}
                            onClick={handleVoiceClick}
                            title={isVoiceActive ? 'Stop listening' : 'Start voice input'}
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.8-4.93-4.15c-.08-.49-.49-.85-.98-.85-.61 0-1.09.54-1 1.14.49 3 2.89 5.35 5.91 5.78V20c0 .55.45 1 1 1s1-.45 1-1v-2.08c3.02-.43 5.42-2.78 5.91-5.78.1-.6-.39-1.14-1-1.14z" />
                            </svg>
                        </button>

                        {/* Send button */}
                        <button
                            type="submit"
                            className="chat-input__send"
                            disabled={!inputValue.trim()}
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                            </svg>
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default ChatView;
