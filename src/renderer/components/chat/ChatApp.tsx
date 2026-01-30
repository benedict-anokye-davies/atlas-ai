/**
 * Atlas Desktop - ChatApp
 * Main application component with modern AI chat interface
 */

import React, { useState, useCallback, useEffect } from 'react';
import { ChatView, ChatMessage } from './ChatView';
import { ConversationSidebar, Conversation } from './ConversationSidebar';
import { useAtlasState } from '../../hooks';
import '../../styles/chat-theme.css';

// Tool call interface for tracking active tool executions
interface ToolCall {
    id: string;
    name: string;
    status: 'running' | 'complete' | 'error';
    params?: Record<string, unknown>;
    result?: unknown;
    error?: string;
}

// Generate unique IDs
const generateId = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

export interface ChatAppProps {
    onNavigateToView?: (view: string) => void;
}

export const ChatApp: React.FC<ChatAppProps> = ({ onNavigateToView }) => {
    const { state, isReady, triggerWake, stop } = useAtlasState();

    // Conversation state
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [isThinking, setIsThinking] = useState(false);
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const [activeTools, setActiveTools] = useState<ToolCall[]>([]);

    // Initialize with welcome if no active conversation
    useEffect(() => {
        if (!activeConversationId && conversations.length === 0) {
            // Start with empty state, ready for new chat
        }
    }, [activeConversationId, conversations.length]);

    // Handle voice state changes
    const isVoiceActive = state === 'listening';

    useEffect(() => {
        // Check for thinking states (voice pipeline may send different state names)
        const isThinkingState = state === 'thinking' || (state as string) === 'processing';
        setIsThinking(isThinkingState);
    }, [state]);

    // Send message handler
    const handleSendMessage = useCallback(async (content: string) => {
        // Add user message
        const userMessage: ChatMessage = {
            id: generateId(),
            role: 'user',
            content,
            timestamp: Date.now(),
        };

        setMessages(prev => [...prev, userMessage]);
        setIsThinking(true);

        // Create or update conversation
        if (!activeConversationId) {
            const newConv: Conversation = {
                id: generateId(),
                title: content.slice(0, 40) + (content.length > 40 ? '...' : ''),
                lastMessage: content,
                timestamp: Date.now(),
            };
            setConversations(prev => [newConv, ...prev]);
            setActiveConversationId(newConv.id);
        }

        // Create a placeholder for the AI response that will be updated
        const aiMessageId = generateId();
        setMessages(prev => [...prev, {
            id: aiMessageId,
            role: 'assistant',
            content: '',
            timestamp: Date.now(),
        }]);

        // Listen for streaming response
        const atlasApi = window.atlas as unknown as {
            on?: (event: string, handler: (data: unknown) => void) => () => void;
            atlas?: {
                sendText?: (text: string) => Promise<{ success: boolean }>;
            };
        };

        // Set up event listeners for streaming response
        let unsubChunk: (() => void) | undefined;
        let unsubComplete: (() => void) | undefined;

        if (atlasApi?.on) {
            unsubChunk = atlasApi.on('atlas:response-chunk', (data: unknown) => {
                if (typeof data === 'object' && data !== null) {
                    const chunk = data as { delta?: string; accumulated?: string };
                    if (chunk.accumulated) {
                        setMessages(prev => prev.map(msg =>
                            msg.id === aiMessageId ? { ...msg, content: chunk.accumulated! } : msg
                        ));
                    } else if (chunk.delta) {
                        setMessages(prev => prev.map(msg =>
                            msg.id === aiMessageId ? { ...msg, content: msg.content + chunk.delta! } : msg
                        ));
                    }
                }
            });

            unsubComplete = atlasApi.on('atlas:response-complete', () => {
                setIsThinking(false);
                // Clean up listeners
                unsubChunk?.();
                unsubComplete?.();
            });

            // Listen for tool events
            const unsubToolStart = atlasApi.on('atlas:tool-start', (data: unknown) => {
                const toolData = data as { toolName: string; params?: Record<string, unknown> };
                const newTool: ToolCall = {
                    id: generateId(),
                    name: toolData.toolName,
                    status: 'running',
                    params: toolData.params,
                };
                setActiveTools(prev => [...prev, newTool]);
            });

            const unsubToolComplete = atlasApi.on('atlas:tool-complete', (data: unknown) => {
                const toolData = data as { toolName: string; result: { success: boolean; data?: unknown; error?: string } };
                setActiveTools(prev => prev.map(t =>
                    t.name === toolData.toolName && t.status === 'running'
                        ? { ...t, status: toolData.result.success ? 'complete' : 'error', result: toolData.result.data, error: toolData.result.error }
                        : t
                ));
            });

            // Clean up tool listeners on completion
            atlasApi.on('atlas:response-complete', () => {
                unsubToolStart?.();
                unsubToolComplete?.();
            });
        }

        // Send to Atlas via IPC
        try {
            await atlasApi?.atlas?.sendText?.(content);
        } catch (error) {
            console.error('[ChatApp] Error sending message:', error);
            setIsThinking(false);
            setMessages(prev => prev.map(msg =>
                msg.id === aiMessageId ? { ...msg, content: "I encountered an error. Please try again." } : msg
            ));
            unsubChunk?.();
            unsubComplete?.();
        }
    }, [activeConversationId]);

    // New chat handler
    const handleNewChat = useCallback(() => {
        setActiveConversationId(null);
        setMessages([]);
    }, []);

    // Select conversation handler
    const handleSelectConversation = useCallback((id: string) => {
        setActiveConversationId(id);
        // In a real app, load messages for this conversation
        // For now, just clear messages
        setMessages([]);
    }, []);

    // Voice handlers
    const handleVoiceStart = useCallback(() => {
        if (isReady) {
            triggerWake();
        }
    }, [isReady, triggerWake]);

    const handleVoiceStop = useCallback(() => {
        stop();
    }, [stop]);

    // Navigation handler
    const handleNavigate = useCallback((view: string) => {
        if (view === 'settings') {
            // Handle settings
            console.log('Open settings');
        } else {
            onNavigateToView?.(view);
        }
    }, [onNavigateToView]);

    return (
        <div className="chat-app">
            {/* Sidebar */}
            <ConversationSidebar
                conversations={conversations}
                activeId={activeConversationId ?? undefined}
                onNewChat={handleNewChat}
                onSelectConversation={handleSelectConversation}
                onNavigate={handleNavigate}
                isOpen={isSidebarOpen}
                onClose={() => setIsSidebarOpen(false)}
            />

            {/* Main chat area */}
            <ChatView
                messages={messages}
                isThinking={isThinking}
                isVoiceActive={isVoiceActive}
                onSendMessage={handleSendMessage}
                onVoiceStart={handleVoiceStart}
                onVoiceStop={handleVoiceStop}
                activeTools={activeTools}
            />
        </div>
    );
};

export default ChatApp;
