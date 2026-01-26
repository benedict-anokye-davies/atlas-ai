/**
 * Atlas Desktop - Command Center UI
 * Dynamic UI that pulls real data from IPC handlers
 * Atlas can modify this UI through its coding tools
 */

import React, { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAtlasStore } from '../stores/atlasStore';

// Types for real data
interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

interface PerformanceMetrics {
  fps: number;
  frameTime: number;
  memoryUsage: number;
  particleCount: number;
}

interface AtlasStatus {
  state: 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';
  isActive: boolean;
  uptime: number;
}

interface MemoryStats {
  totalEntries: number;
  conversationCount: number;
  factCount: number;
  preferenceCount: number;
}

interface SystemResources {
  cpu: number;
  memory: number;
  gpu?: number;
  vram?: number;
}

// Hook to fetch real Atlas data
function useAtlasData() {
  const [conversationHistory, setConversationHistory] = useState<ConversationMessage[]>([]);
  const [performanceData, setPerformanceData] = useState<PerformanceMetrics | null>(null);
  const [atlasStatus, setAtlasStatus] = useState<AtlasStatus | null>(null);
  const [memoryStats, setMemoryStats] = useState<MemoryStats | null>(null);
  const [systemResources, setSystemResources] = useState<SystemResources | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshData = useCallback(async () => {
    if (!window.atlas?.atlas) {
      setIsLoading(false);
      return;
    }
    
    try {
      // Get conversation history
      const historyResult = await window.atlas.atlas.getConversationHistory(20);
      if (historyResult.success && historyResult.data) {
        setConversationHistory(historyResult.data as ConversationMessage[]);
      }

      // Get Atlas status
      const statusResult = await window.atlas.atlas.getStatus();
      if (statusResult.success && statusResult.data) {
        const status = statusResult.data as unknown as { state: string; isListening: boolean; isSpeaking: boolean };
        // Derive state from status fields
        let derivedState: AtlasStatus['state'] = 'idle';
        if (status.isListening) derivedState = 'listening';
        else if (status.isSpeaking) derivedState = 'speaking';
        else if (status.state === 'processing') derivedState = 'thinking';
        else if (status.state === 'error') derivedState = 'error';
        
        setAtlasStatus({
          state: derivedState,
          isActive: status.isListening || status.isSpeaking,
          uptime: Date.now(),
        });
      }

      // Get memory stats
      const memoryResult = await window.atlas.atlas.getMemoryStats();
      if (memoryResult.success && memoryResult.data) {
        setMemoryStats(memoryResult.data as MemoryStats);
      }

      // Get performance metrics via IPC invoke (performance API may not be in types yet)
      try {
        const perfResult = await (window.atlas as unknown as { invoke: <T>(channel: string, ...args: unknown[]) => Promise<T> })
          ?.invoke?.('atlas:get-performance-data');
        if (perfResult && typeof perfResult === 'object' && 'success' in perfResult) {
          const typedResult = perfResult as unknown as { 
            success: boolean; 
            data?: {
              metrics: Record<string, { current: number }>;
              snapshots: Array<{ memory: { percentUsed: number }; cpu: { usage: number } }>;
            } 
          };
          if (typedResult.success && typedResult.data) {
            const data = typedResult.data;
            const latestSnapshot = data.snapshots?.[0];
            setPerformanceData({
              fps: data.metrics?.fps?.current || 60,
              frameTime: data.metrics?.frameTime?.current || 16.67,
              memoryUsage: latestSnapshot?.memory?.percentUsed || 0,
              particleCount: data.metrics?.particleCount?.current || 0,
            });
            
            // Also update system resources from performance data
            if (latestSnapshot) {
              setSystemResources({
                cpu: latestSnapshot.cpu?.usage || 0,
                memory: latestSnapshot.memory?.percentUsed || 0,
              });
            }
          }
        }
      } catch (perfError) {
        // Performance data not available, use defaults
        console.debug('Performance data not available:', perfError);
      }

      setIsLoading(false);
    } catch (error) {
      console.error('Failed to fetch Atlas data:', error);
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshData();
    const interval = setInterval(refreshData, 2000); // Refresh every 2 seconds
    return () => clearInterval(interval);
  }, [refreshData]);

  return {
    conversationHistory,
    performanceData,
    atlasStatus,
    memoryStats,
    systemResources,
    isLoading,
    refreshData,
  };
}

// Status indicator component
const StatusIndicator: React.FC<{ status: AtlasStatus | null }> = ({ status }) => {
  const getStatusColor = () => {
    if (!status) return 'bg-gray-500';
    switch (status.state) {
      case 'listening': return 'bg-cyan-500 animate-pulse';
      case 'thinking': return 'bg-yellow-500 animate-pulse';
      case 'speaking': return 'bg-green-500 animate-pulse';
      case 'error': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  const getStatusText = () => {
    if (!status) return 'Offline';
    switch (status.state) {
      case 'listening': return 'Listening...';
      case 'thinking': return 'Processing...';
      case 'speaking': return 'Speaking...';
      case 'error': return 'Error';
      default: return status.isActive ? 'Ready' : 'Standby';
    }
  };

  return (
    <div className="flex items-center gap-2">
      <div className={`w-3 h-3 rounded-full ${getStatusColor()}`} />
      <span className="text-sm text-cyan-300">{getStatusText()}</span>
    </div>
  );
};

// Metric bar component
const MetricBar: React.FC<{ label: string; value: number; max?: number; unit?: string; color?: string }> = ({
  label,
  value,
  max = 100,
  unit = '%',
  color = 'cyan',
}) => {
  const percentage = Math.min((value / max) * 100, 100);
  const colorClasses = {
    cyan: 'from-cyan-500 to-blue-500',
    green: 'from-green-500 to-emerald-500',
    yellow: 'from-yellow-500 to-orange-500',
    red: 'from-red-500 to-pink-500',
  };

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-gray-400">{label}</span>
        <span className="text-cyan-300">{value.toFixed(1)}{unit}</span>
      </div>
      <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <motion.div
          className={`h-full bg-gradient-to-r ${colorClasses[color as keyof typeof colorClasses] || colorClasses.cyan} rounded-full`}
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        />
      </div>
    </div>
  );
};

// Conversation item component
const ConversationItem: React.FC<{ message: ConversationMessage }> = ({ message }) => {
  const isUser = message.role === 'user';
  const timeAgo = formatTimeAgo(message.timestamp);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`p-2 rounded border ${
        isUser
          ? 'border-cyan-500/30 bg-cyan-500/10'
          : 'border-green-500/30 bg-green-500/10'
      }`}
    >
      <div className="flex justify-between items-center mb-1">
        <span className={`text-xs font-medium ${isUser ? 'text-cyan-400' : 'text-green-400'}`}>
          {isUser ? 'You' : 'Atlas'}
        </span>
        <span className="text-xs text-gray-500">{timeAgo}</span>
      </div>
      <p className="text-xs text-gray-300 line-clamp-2">{message.content}</p>
    </motion.div>
  );
};

// Quick action button
const QuickAction: React.FC<{
  icon: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}> = ({ icon, label, onClick, disabled }) => (
  <motion.button
    whileHover={{ scale: disabled ? 1 : 1.05 }}
    whileTap={{ scale: disabled ? 1 : 0.95 }}
    onClick={onClick}
    disabled={disabled}
    className={`flex items-center gap-2 px-3 py-2 rounded border transition-colors ${
      disabled
        ? 'border-gray-700 bg-gray-800/50 text-gray-600 cursor-not-allowed'
        : 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20'
    }`}
  >
    <span>{icon}</span>
    <span className="text-xs">{label}</span>
  </motion.button>
);

// Helper to format time ago
function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

// Main AtlasUI Component
export const AtlasUI: React.FC = () => {
  const {
    conversationHistory,
    performanceData,
    atlasStatus,
    memoryStats,
    systemResources,
    isLoading,
    refreshData,
  } = useAtlasData();

  const state = useAtlasStore((s) => s.state);
  const [showLeftPanel, setShowLeftPanel] = useState(true);
  const [showRightPanel, setShowRightPanel] = useState(true);
  
  // Chat input state
  const [chatInput, setChatInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  
  // Handle chat send
  const handleSendChat = async () => {
    const text = chatInput.trim();
    if (!text || isSending) return;
    
    setIsSending(true);
    setChatInput('');
    
    try {
      // Use the existing sendText API
      const atlasApi = window.atlas as unknown as { atlas?: { sendText?: (text: string) => Promise<void> } };
      await atlasApi?.atlas?.sendText?.(text);
      // Refresh to show the new message
      setTimeout(refreshData, 500);
    } catch (error) {
      console.error('Failed to send message:', error);
    } finally {
      setIsSending(false);
    }
  };
  
  // Handle Enter key in chat input
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendChat();
    }
  };

  // Quick actions
  const handleClearHistory = async () => {
    await window.atlas?.atlas?.clearHistory();
    refreshData();
  };

  const handleTriggerWake = async () => {
    await window.atlas?.atlas?.triggerWake();
  };

  const handleStop = async () => {
    await window.atlas?.atlas?.stop();
    refreshData();
  };

  return (
    <div className="fixed inset-0 pointer-events-none z-10 flex">
      {/* Left Panel - System Metrics */}
      <AnimatePresence>
        {showLeftPanel && (
          <motion.div
            initial={{ x: -300, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -300, opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="pointer-events-auto w-64 h-full bg-black/80 backdrop-blur-md border-r border-cyan-500/20 p-4 flex flex-col gap-4"
          >
            {/* Header */}
            <div className="flex items-center justify-between">
              <h2 className="text-cyan-400 font-bold text-sm tracking-wider">SYSTEM</h2>
              <StatusIndicator status={atlasStatus} />
            </div>

            {/* Performance Metrics */}
            <div className="space-y-3">
              <h3 className="text-xs text-gray-500 uppercase tracking-wider">Performance</h3>
              {performanceData ? (
                <>
                  <MetricBar label="FPS" value={performanceData.fps} max={120} unit=" fps" />
                  <MetricBar label="Frame Time" value={performanceData.frameTime} max={33.33} unit="ms" color="green" />
                  <MetricBar label="Particles" value={performanceData.particleCount} max={50000} unit="" color="yellow" />
                </>
              ) : (
                <div className="text-xs text-gray-500">Loading...</div>
              )}
            </div>

            {/* System Resources */}
            <div className="space-y-3">
              <h3 className="text-xs text-gray-500 uppercase tracking-wider">Resources</h3>
              {systemResources ? (
                <>
                  <MetricBar label="Memory" value={systemResources.memory} color={systemResources.memory > 80 ? 'red' : 'cyan'} />
                  {systemResources.gpu !== undefined && (
                    <MetricBar label="GPU" value={systemResources.gpu} color="green" />
                  )}
                </>
              ) : (
                <div className="text-xs text-gray-500">Monitoring...</div>
              )}
            </div>

            {/* Memory Stats */}
            <div className="space-y-2">
              <h3 className="text-xs text-gray-500 uppercase tracking-wider">Memory Store</h3>
              {memoryStats ? (
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-gray-800/50 rounded p-2">
                    <div className="text-gray-400">Entries</div>
                    <div className="text-cyan-300 font-mono">{memoryStats.totalEntries || 0}</div>
                  </div>
                  <div className="bg-gray-800/50 rounded p-2">
                    <div className="text-gray-400">Conversations</div>
                    <div className="text-cyan-300 font-mono">{memoryStats.conversationCount || 0}</div>
                  </div>
                  <div className="bg-gray-800/50 rounded p-2">
                    <div className="text-gray-400">Facts</div>
                    <div className="text-cyan-300 font-mono">{memoryStats.factCount || 0}</div>
                  </div>
                  <div className="bg-gray-800/50 rounded p-2">
                    <div className="text-gray-400">Preferences</div>
                    <div className="text-cyan-300 font-mono">{memoryStats.preferenceCount || 0}</div>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-gray-500">Loading...</div>
              )}
            </div>

            {/* Toggle Button */}
            <button
              onClick={() => setShowLeftPanel(false)}
              className="absolute top-1/2 -right-6 w-6 h-12 bg-black/80 border border-cyan-500/30 rounded-r flex items-center justify-center text-cyan-500 hover:bg-cyan-500/20 transition-colors"
            >
              ‹
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Collapsed Left Toggle */}
      {!showLeftPanel && (
        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          onClick={() => setShowLeftPanel(true)}
          className="pointer-events-auto absolute left-0 top-1/2 w-6 h-12 bg-black/80 border border-cyan-500/30 rounded-r flex items-center justify-center text-cyan-500 hover:bg-cyan-500/20 transition-colors"
        >
          ›
        </motion.button>
      )}

      {/* Center Area - Spacer for Orb */}
      <div className="flex-1" />

      {/* Right Panel - Conversation & Actions */}
      <AnimatePresence>
        {showRightPanel && (
          <motion.div
            initial={{ x: 300, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 300, opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="pointer-events-auto w-72 h-full bg-black/80 backdrop-blur-md border-l border-cyan-500/20 p-4 flex flex-col gap-4"
          >
            {/* Header */}
            <div className="flex items-center justify-between">
              <h2 className="text-cyan-400 font-bold text-sm tracking-wider">ATLAS</h2>
              <span className="text-xs text-gray-500 font-mono">
                {state || 'idle'}
              </span>
            </div>

            {/* Quick Actions */}
            <div className="space-y-2">
              <h3 className="text-xs text-gray-500 uppercase tracking-wider">Quick Actions</h3>
              <div className="grid grid-cols-2 gap-2">
                <QuickAction
                  icon="🎤"
                  label="Wake"
                  onClick={handleTriggerWake}
                  disabled={atlasStatus?.state === 'listening'}
                />
                <QuickAction
                  icon="⏹️"
                  label="Stop"
                  onClick={handleStop}
                  disabled={atlasStatus?.state === 'idle'}
                />
                <QuickAction
                  icon="🗑️"
                  label="Clear"
                  onClick={handleClearHistory}
                />
                <QuickAction
                  icon="🔄"
                  label="Refresh"
                  onClick={refreshData}
                />
              </div>
            </div>

            {/* Conversation History */}
            <div className="flex-1 flex flex-col min-h-0">
              <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-2">
                Recent Conversations
                <span className="ml-2 text-cyan-500">({conversationHistory.length})</span>
              </h3>
              <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                {isLoading ? (
                  <div className="text-xs text-gray-500 text-center py-4">Loading...</div>
                ) : conversationHistory.length > 0 ? (
                  conversationHistory.map((msg) => (
                    <ConversationItem key={msg.id} message={msg} />
                  ))
                ) : (
                  <div className="text-xs text-gray-500 text-center py-4">
                    No conversations yet. Say "Hey Atlas" to start!
                  </div>
                )}
              </div>
            </div>

            {/* Chat Input */}
            <div className="border-t border-cyan-500/20 pt-3">
              <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-2">Chat</h3>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type a message..."
                  disabled={isSending}
                  className="flex-1 bg-black/50 border border-cyan-500/30 rounded px-2 py-1.5 text-xs text-cyan-100 placeholder-gray-500 focus:outline-none focus:border-cyan-500/60 disabled:opacity-50"
                />
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={handleSendChat}
                  disabled={isSending || !chatInput.trim()}
                  className="px-3 py-1.5 bg-cyan-500/20 border border-cyan-500/30 rounded text-cyan-400 text-xs hover:bg-cyan-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSending ? '...' : 'Send'}
                </motion.button>
              </div>
            </div>

            {/* Atlas Capabilities Info */}
            <div className="border-t border-cyan-500/20 pt-3 mt-2">
              <div className="text-xs text-gray-500">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-green-500">●</span>
                  <span>Voice: Active</span>
                </div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-green-500">●</span>
                  <span>Tools: read, write, execute</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-cyan-500">●</span>
                  <span>Press F9 to toggle view</span>
                </div>
              </div>
            </div>

            {/* Toggle Button */}
            <button
              onClick={() => setShowRightPanel(false)}
              className="absolute top-1/2 -left-6 w-6 h-12 bg-black/80 border border-cyan-500/30 rounded-l flex items-center justify-center text-cyan-500 hover:bg-cyan-500/20 transition-colors"
            >
              ›
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Collapsed Right Toggle */}
      {!showRightPanel && (
        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          onClick={() => setShowRightPanel(true)}
          className="pointer-events-auto absolute right-0 top-1/2 w-6 h-12 bg-black/80 border border-cyan-500/30 rounded-l flex items-center justify-center text-cyan-500 hover:bg-cyan-500/20 transition-colors"
        >
          ‹
        </motion.button>
      )}

      {/* Custom Scrollbar Styles */}
      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(0, 0, 0, 0.2);
          border-radius: 2px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(6, 182, 212, 0.3);
          border-radius: 2px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(6, 182, 212, 0.5);
        }
      `}</style>
    </div>
  );
};

export default AtlasUI;
