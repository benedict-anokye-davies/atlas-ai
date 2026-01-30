/**
 * Atlas Desktop - Conversation Sidebar
 * Shows chat history, new chat button, and navigation
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export interface Conversation {
    id: string;
    title: string;
    lastMessage: string;
    timestamp: number;
}

export interface ConversationSidebarProps {
    conversations?: Conversation[];
    activeId?: string;
    onNewChat?: () => void;
    onSelectConversation?: (id: string) => void;
    onNavigate?: (view: string) => void;
    isOpen?: boolean;
    onClose?: () => void;
}

// Navigation items for other views
const NAV_ITEMS = [
    { id: 'trading', label: 'Trading', icon: '📈' },
    { id: 'banking', label: 'Banking', icon: '🏦' },
    { id: 'dashboard', label: 'Dashboard', icon: '📊' },
];

export const ConversationSidebar: React.FC<ConversationSidebarProps> = ({
    conversations = [],
    activeId,
    onNewChat,
    onSelectConversation,
    onNavigate,
    isOpen = true,
    onClose: _onClose,
}) => {
    const [searchQuery, setSearchQuery] = useState('');

    const filteredConversations = conversations.filter(conv =>
        conv.title.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const formatTime = (timestamp: number) => {
        const now = Date.now();
        const diff = now - timestamp;
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);

        if (minutes < 1) return 'Just now';
        if (minutes < 60) return `${minutes}m ago`;
        if (hours < 24) return `${hours}h ago`;
        if (days < 7) return `${days}d ago`;
        return new Date(timestamp).toLocaleDateString();
    };

    return (
        <aside className={`chat-sidebar ${isOpen ? 'chat-sidebar--open' : ''}`}>
            {/* Header with new chat button */}
            <div className="chat-sidebar__header">
                <button
                    className="chat-sidebar__new-chat"
                    onClick={onNewChat}
                >
                    + New Chat
                </button>
            </div>

            {/* Search */}
            <div style={{ padding: '8px 12px' }}>
                <input
                    type="text"
                    placeholder="Search conversations..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={{
                        width: '100%',
                        padding: '8px 12px',
                        background: 'var(--chat-bg-surface)',
                        border: '1px solid var(--chat-border)',
                        borderRadius: 'var(--chat-radius-sm)',
                        color: 'var(--chat-text-primary)',
                        fontSize: 'var(--chat-text-sm)',
                    }}
                />
            </div>

            {/* Conversation list */}
            <div className="chat-sidebar__history">
                <AnimatePresence>
                    {filteredConversations.length > 0 ? (
                        filteredConversations.map((conv) => (
                            <motion.button
                                key={conv.id}
                                className={`chat-sidebar__item ${activeId === conv.id ? 'chat-sidebar__item--active' : ''}`}
                                onClick={() => onSelectConversation?.(conv.id)}
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -10 }}
                            >
                                <span style={{ fontSize: '16px' }}>💬</span>
                                <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                                    <div style={{
                                        fontWeight: 500,
                                        fontSize: 'var(--chat-text-sm)',
                                        marginBottom: '2px',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                        color: 'var(--chat-text-primary)',
                                    }}>
                                        {conv.title}
                                    </div>
                                    <div style={{
                                        fontSize: '11px',
                                        color: 'var(--chat-text-muted)',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                    }}>
                                        {formatTime(conv.timestamp)}
                                    </div>
                                </div>
                            </motion.button>
                        ))
                    ) : (
                        <div style={{
                            padding: '20px',
                            textAlign: 'center',
                            color: 'var(--chat-text-muted)',
                            fontSize: 'var(--chat-text-sm)',
                        }}>
                            {searchQuery ? 'No matches found' : 'No conversations yet'}
                        </div>
                    )}
                </AnimatePresence>
            </div>

            {/* Divider */}
            <div style={{
                height: '1px',
                background: 'var(--chat-border)',
                margin: '8px 12px',
            }} />

            {/* Other views navigation */}
            <div style={{ padding: '8px' }}>
                <div style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    color: 'var(--chat-text-muted)',
                    padding: '8px 12px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                }}>
                    Other Views
                </div>
                {NAV_ITEMS.map((item) => (
                    <button
                        key={item.id}
                        className="chat-sidebar__item"
                        onClick={() => onNavigate?.(item.id)}
                    >
                        <span style={{ fontSize: '16px' }}>{item.icon}</span>
                        <span style={{ fontSize: 'var(--chat-text-sm)' }}>{item.label}</span>
                    </button>
                ))}
            </div>

            {/* Footer with settings */}
            <div className="chat-sidebar__footer">
                <button
                    className="chat-sidebar__item"
                    onClick={() => onNavigate?.('settings')}
                >
                    <span style={{ fontSize: '16px' }}>⚙️</span>
                    <span style={{ fontSize: 'var(--chat-text-sm)' }}>Settings</span>
                </button>
            </div>
        </aside>
    );
};

export default ConversationSidebar;
