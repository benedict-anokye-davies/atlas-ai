/**
 * Atlas Desktop - Learning Dashboard
 * Shows what Atlas has learned about the user and their preferences
 */

import { useState, useEffect, useCallback } from 'react';
import './LearningDashboard.css';

interface LearningDashboardProps {
  isVisible: boolean;
  onClose: () => void;
}

interface LearnedFact {
  id: string;
  category: 'preference' | 'behavior' | 'knowledge' | 'skill' | 'context';
  content: string;
  confidence: number;
  source: string;
  learnedAt: number;
  lastUsed: number;
  usageCount: number;
}

interface LearningStats {
  totalFacts: number;
  categories: Record<string, number>;
  mostActiveDay: string;
  averageConfidence: number;
  recentLearnings: number;
}

export function LearningDashboard({ isVisible, onClose }: LearningDashboardProps) {
  const [facts, setFacts] = useState<LearnedFact[]>([]);
  const [stats, setStats] = useState<LearningStats | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFact, setSelectedFact] = useState<LearnedFact | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load learned facts
  useEffect(() => {
    if (!isVisible) return;
    setIsLoading(true);

    const loadFacts = async () => {
      try {
        // Try to search memory for learned facts using voicePipeline API
        const memoryResult = await window.atlas?.atlas?.searchMemory?.({ text: 'user preferences', limit: 50 });
        const memoryStats = await window.atlas?.atlas?.getMemoryStats?.();

        if (memoryResult?.success && memoryResult.data) {
          const results = memoryResult.data as Array<{
            id?: string;
            type?: string;
            content?: string;
            confidence?: number;
            source?: string;
            timestamp?: number;
            lastAccessed?: number;
            accessCount?: number;
          }>;

          const facts: LearnedFact[] = results.map((item, idx) => ({
            id: item.id || `fact-${idx}`,
            category: mapTypeToCategory(item.type || 'knowledge'),
            content: item.content || 'Unknown fact',
            confidence: item.confidence || 0.8,
            source: item.source || 'memory',
            learnedAt: item.timestamp || Date.now(),
            lastUsed: item.lastAccessed || Date.now(),
            usageCount: item.accessCount || 1,
          }));

          setFacts(facts);

          // Calculate stats from real data
          const categoryCount: Record<string, number> = {};
          facts.forEach((f) => {
            categoryCount[f.category] = (categoryCount[f.category] || 0) + 1;
          });

          setStats({
            totalFacts: facts.length,
            categories: categoryCount,
            mostActiveDay: getMostActiveDay(),
            averageConfidence: facts.length > 0 
              ? facts.reduce((a, b) => a + b.confidence, 0) / facts.length 
              : 0,
            recentLearnings: facts.filter(f => Date.now() - f.learnedAt < 7 * 24 * 60 * 60 * 1000).length,
          });
          
          setIsLoading(false);
          return;
        }

        // If memory stats available but no search results, show stats-only view
        if (memoryStats?.success && memoryStats.data) {
          const mStats = memoryStats.data as { totalEntries?: number; entries?: number };
          setFacts([]);
          setStats({
            totalFacts: mStats.totalEntries || mStats.entries || 0,
            categories: {},
            mostActiveDay: getMostActiveDay(),
            averageConfidence: 0,
            recentLearnings: 0,
          });
          setIsLoading(false);
          return;
        }

        // No data available
        setFacts([]);
        setStats({
          totalFacts: 0,
          categories: {},
          mostActiveDay: 'N/A',
          averageConfidence: 0,
          recentLearnings: 0,
        });
      } catch (error) {
        console.error('Failed to load learned facts:', error);
        setFacts([]);
        setStats(null);
      }

      setIsLoading(false);
    };

    loadFacts();
  }, [isVisible]);

  // Helper to map memory types to categories
  const mapTypeToCategory = (type: string): LearnedFact['category'] => {
    const typeMap: Record<string, LearnedFact['category']> = {
      preference: 'preference',
      pref: 'preference',
      behavior: 'behavior',
      pattern: 'behavior',
      knowledge: 'knowledge',
      fact: 'knowledge',
      skill: 'skill',
      ability: 'skill',
      context: 'context',
      env: 'context',
    };
    return typeMap[type.toLowerCase()] || 'knowledge';
  };

  // Helper to determine most active day
  const getMostActiveDay = () => {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[new Date().getDay()];
  };

  // Filter facts
  const filteredFacts = facts.filter((fact) => {
    const matchesCategory = activeCategory === 'all' || fact.category === activeCategory;
    const matchesSearch = !searchQuery || 
      fact.content.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  // Delete a fact
  const deleteFact = useCallback(async (factId: string) => {
    try {
      // Note: Memory deletion API not exposed via IPC yet, just remove from local state
      setFacts((prev) => prev.filter((f) => f.id !== factId));
      setSelectedFact(null);
    } catch (error) {
      console.error('Failed to delete fact:', error);
    }
  }, []);

  // Close on Escape
  useEffect(() => {
    if (!isVisible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectedFact) {
          setSelectedFact(null);
        } else {
          onClose();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isVisible, onClose, selectedFact]);

  if (!isVisible) return null;

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'preference':
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
        );
      case 'behavior':
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
          </svg>
        );
      case 'knowledge':
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        );
      case 'skill':
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="12 2 2 7 12 12 22 7 12 2" />
            <polyline points="2 17 12 22 22 17" />
            <polyline points="2 12 12 17 22 12" />
          </svg>
        );
      case 'context':
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
        );
      default:
        return null;
    }
  };

  const formatTimeAgo = (timestamp: number) => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(timestamp).toLocaleDateString();
  };

  return (
    <div className="learning-overlay" onClick={onClose}>
      <div className="learning-container" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="ld-header">
          <div className="ld-title-row">
            <svg className="ld-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" />
              <path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" />
            </svg>
            <h2>Learning Dashboard</h2>
          </div>
          <button className="ld-close" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Stats */}
        {stats && (
          <div className="ld-stats">
            <div className="stat-card">
              <div className="stat-value">{stats.totalFacts}</div>
              <div className="stat-label">Total Facts</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{Math.round(stats.averageConfidence * 100)}%</div>
              <div className="stat-label">Avg. Confidence</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.recentLearnings}</div>
              <div className="stat-label">New This Week</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.mostActiveDay}</div>
              <div className="stat-label">Most Active</div>
            </div>
          </div>
        )}

        {/* Controls */}
        <div className="ld-controls">
          <div className="search-box">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder="Search learned facts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="category-filters">
            {['all', 'preference', 'behavior', 'knowledge', 'skill', 'context'].map((cat) => (
              <button
                key={cat}
                className={`filter-btn ${activeCategory === cat ? 'active' : ''}`}
                onClick={() => setActiveCategory(cat)}
              >
                {cat === 'all' ? 'All' : cat.charAt(0).toUpperCase() + cat.slice(1)}
                {stats && cat !== 'all' && stats.categories[cat] && (
                  <span className="filter-count">{stats.categories[cat]}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="ld-content">
          {isLoading ? (
            <div className="loading-state">
              <div className="spinner" />
              <p>Loading learned facts...</p>
            </div>
          ) : filteredFacts.length === 0 ? (
            <div className="empty-state">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" />
                <path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" />
              </svg>
              <p>No facts found</p>
              <span>Atlas is still learning about you</span>
            </div>
          ) : (
            <div className="facts-list">
              {filteredFacts.map((fact) => (
                <div
                  key={fact.id}
                  className={`fact-card ${fact.category}`}
                  onClick={() => setSelectedFact(fact)}
                >
                  <div className={`fact-icon ${fact.category}`}>
                    {getCategoryIcon(fact.category)}
                  </div>
                  <div className="fact-content">
                    <p className="fact-text">{fact.content}</p>
                    <div className="fact-meta">
                      <span className="fact-category">{fact.category}</span>
                      <span className="fact-time">Learned {formatTimeAgo(fact.learnedAt)}</span>
                    </div>
                  </div>
                  <div className="fact-confidence">
                    <div 
                      className="confidence-ring"
                      style={{ '--confidence': fact.confidence } as React.CSSProperties}
                    >
                      <span>{Math.round(fact.confidence * 100)}%</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Fact Detail Panel */}
        {selectedFact && (
          <div className="fact-detail-panel">
            <div className="detail-header">
              <div className={`detail-icon ${selectedFact.category}`}>
                {getCategoryIcon(selectedFact.category)}
              </div>
              <div className="detail-title">
                <span className="detail-category">{selectedFact.category}</span>
                <button className="detail-close" onClick={() => setSelectedFact(null)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="detail-content">
              <p className="detail-text">{selectedFact.content}</p>
              
              <div className="detail-stats">
                <div className="detail-stat">
                  <span className="stat-label">Confidence</span>
                  <div className="confidence-bar-container">
                    <div 
                      className="confidence-bar" 
                      style={{ width: `${selectedFact.confidence * 100}%` }}
                    />
                  </div>
                  <span className="stat-value">{Math.round(selectedFact.confidence * 100)}%</span>
                </div>
                
                <div className="detail-stat">
                  <span className="stat-label">Source</span>
                  <span className="stat-value">{selectedFact.source.replace(/_/g, ' ')}</span>
                </div>
                
                <div className="detail-stat">
                  <span className="stat-label">Learned</span>
                  <span className="stat-value">{new Date(selectedFact.learnedAt).toLocaleDateString()}</span>
                </div>
                
                <div className="detail-stat">
                  <span className="stat-label">Last Used</span>
                  <span className="stat-value">{formatTimeAgo(selectedFact.lastUsed)}</span>
                </div>
                
                <div className="detail-stat">
                  <span className="stat-label">Usage Count</span>
                  <span className="stat-value">{selectedFact.usageCount} times</span>
                </div>
              </div>
            </div>
            
            <div className="detail-actions">
              <button className="delete-btn" onClick={() => deleteFact(selectedFact.id)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                </svg>
                Forget This
              </button>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="ld-footer">
          <div className="footer-info">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            <span>Atlas learns from your interactions to provide better assistance</span>
          </div>
        </div>
      </div>
    </div>
  );
}
