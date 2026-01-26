/**
 * KnowledgeExplorer
 * Visual knowledge graph explorer and personal knowledge base browser
 */

import React, { useState, useEffect, useCallback } from 'react';
import './KnowledgeExplorer.css';

interface KnowledgeNode {
  id: string;
  type: 'fact' | 'concept' | 'procedure' | 'preference' | 'person' | 'project';
  title: string;
  content: string;
  tags: string[];
  connections: string[];
  confidence: number;
  lastAccessed: Date;
  nextReview?: Date;
}

interface JournalEntry {
  id: string;
  date: Date;
  type: 'daily' | 'learning' | 'reflection';
  summary: string;
  mood?: 'great' | 'good' | 'neutral' | 'stressed';
}

interface Insight {
  id: string;
  type: 'pattern' | 'recommendation' | 'learning';
  title: string;
  content: string;
  actionable: boolean;
  dismissed: boolean;
}

type ViewMode = 'knowledge' | 'journal' | 'insights' | 'review';

const NODE_COLORS: Record<KnowledgeNode['type'], string> = {
  fact: '#4a9eff',
  concept: '#a55eea',
  procedure: '#26de81',
  preference: '#fd9644',
  person: '#fc5c65',
  project: '#45aaf2'
};

const MOCK_KNOWLEDGE: KnowledgeNode[] = [
  {
    id: 'k1',
    type: 'concept',
    title: 'React Hooks',
    content: 'React Hooks let you use state and other React features without writing a class.',
    tags: ['react', 'javascript', 'frontend'],
    connections: ['k2', 'k3'],
    confidence: 0.9,
    lastAccessed: new Date(),
    nextReview: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  },
  {
    id: 'k2',
    type: 'procedure',
    title: 'Using useState',
    content: 'const [state, setState] = useState(initialValue)',
    tags: ['react', 'hooks'],
    connections: ['k1'],
    confidence: 0.85,
    lastAccessed: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
  },
  {
    id: 'k3',
    type: 'fact',
    title: 'useEffect runs after render',
    content: 'useEffect fires after the DOM has been updated',
    tags: ['react', 'hooks', 'lifecycle'],
    connections: ['k1'],
    confidence: 0.75,
    lastAccessed: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
  }
];

const MOCK_JOURNALS: JournalEntry[] = [
  {
    id: 'j1',
    date: new Date(),
    type: 'daily',
    summary: 'Worked on Atlas UI components. Created WorkflowBuilder and DropZone.',
    mood: 'good'
  },
  {
    id: 'j2',
    date: new Date(Date.now() - 24 * 60 * 60 * 1000),
    type: 'learning',
    summary: 'Learned about spaced repetition algorithms and SM-2.'
  }
];

const MOCK_INSIGHTS: Insight[] = [
  {
    id: 'i1',
    type: 'pattern',
    title: 'Frequent topic: React',
    content: 'You have been discussing React concepts frequently this week.',
    actionable: false,
    dismissed: false
  },
  {
    id: 'i2',
    type: 'recommendation',
    title: 'Review Due',
    content: '3 knowledge items are due for review today.',
    actionable: true,
    dismissed: false
  }
];

export const KnowledgeExplorer: React.FC = () => {
  const [viewMode, setViewMode] = useState<ViewMode>('knowledge');
  const [knowledge, setKnowledge] = useState<KnowledgeNode[]>(MOCK_KNOWLEDGE);
  const [journals, setJournals] = useState<JournalEntry[]>(MOCK_JOURNALS);
  const [insights, setInsights] = useState<Insight[]>(MOCK_INSIGHTS);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Load data from API
  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      try {
        // Try to load from Atlas API
        const atlasAny = window.atlas as unknown as Record<string, unknown>;
        if (atlasAny?.knowledge && typeof atlasAny.knowledge === 'object') {
          const knowledgeApi = atlasAny.knowledge as {
            getItems?: () => Promise<{ success: boolean; data?: KnowledgeNode[] }>;
            getJournals?: () => Promise<{ success: boolean; data?: JournalEntry[] }>;
            getInsights?: () => Promise<{ success: boolean; data?: Insight[] }>;
          };
          
          const [itemsRes, journalsRes, insightsRes] = await Promise.all([
            knowledgeApi.getItems?.() || { success: false },
            knowledgeApi.getJournals?.() || { success: false },
            knowledgeApi.getInsights?.() || { success: false }
          ]);
          
          if (itemsRes.success && 'data' in itemsRes && itemsRes.data) setKnowledge(itemsRes.data);
          if (journalsRes.success && 'data' in journalsRes && journalsRes.data) setJournals(journalsRes.data);
          if (insightsRes.success && 'data' in insightsRes && insightsRes.data) setInsights(insightsRes.data);
        }
      } catch (error) {
        console.log('Using mock data:', error);
      } finally {
        setIsLoading(false);
      }
    };
    
    loadData();
  }, []);

  const allTags = [...new Set(knowledge.flatMap(k => k.tags))].sort();

  const filteredKnowledge = knowledge.filter(node => {
    const matchesSearch = !searchQuery || 
      node.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      node.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
      node.tags.some(t => t.toLowerCase().includes(searchQuery.toLowerCase()));
    
    const matchesTag = !filterTag || node.tags.includes(filterTag);
    
    return matchesSearch && matchesTag;
  });

  const dueForReview = knowledge.filter(k => 
    k.nextReview && k.nextReview <= new Date()
  );

  const dismissInsight = useCallback((id: string) => {
    setInsights(prev => prev.map(i => 
      i.id === id ? { ...i, dismissed: true } : i
    ));
  }, []);

  const selectedNodeData = knowledge.find(k => k.id === selectedNode);
  const connectedNodes = selectedNodeData 
    ? knowledge.filter(k => selectedNodeData.connections.includes(k.id))
    : [];

  const getMoodEmoji = (mood?: string) => {
    switch (mood) {
      case 'great': return '\ud83d\ude04';
      case 'good': return '\ud83d\ude0a';
      case 'neutral': return '\ud83d\ude10';
      case 'stressed': return '\ud83d\ude13';
      default: return '\ud83d\udcdd';
    }
  };

  return (
    <div className="knowledge-explorer">
      <div className="explorer-header">
        <div className="view-tabs">
          <button 
            className={`tab ${viewMode === 'knowledge' ? 'active' : ''}`}
            onClick={() => setViewMode('knowledge')}
          >
            Knowledge Base
          </button>
          <button 
            className={`tab ${viewMode === 'journal' ? 'active' : ''}`}
            onClick={() => setViewMode('journal')}
          >
            Journal
          </button>
          <button 
            className={`tab ${viewMode === 'insights' ? 'active' : ''}`}
            onClick={() => setViewMode('insights')}
          >
            Insights
            {insights.filter(i => !i.dismissed).length > 0 && (
              <span className="badge">{insights.filter(i => !i.dismissed).length}</span>
            )}
          </button>
          <button 
            className={`tab ${viewMode === 'review' ? 'active' : ''}`}
            onClick={() => setViewMode('review')}
          >
            Review
            {dueForReview.length > 0 && (
              <span className="badge">{dueForReview.length}</span>
            )}
          </button>
        </div>
        
        <div className="search-box">
          <input
            type="text"
            placeholder="Search knowledge..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {isLoading ? (
        <div className="loading-state">
          <span className="spinner" />
          <p>Loading knowledge base...</p>
        </div>
      ) : (
        <div className="explorer-content">
          {viewMode === 'knowledge' && (
            <>
              <div className="knowledge-sidebar">
                <div className="tag-filter">
                  <h4>Filter by Tag</h4>
                  <div className="tag-list">
                    <button
                      className={`tag-btn ${!filterTag ? 'active' : ''}`}
                      onClick={() => setFilterTag(null)}
                    >
                      All
                    </button>
                    {allTags.map(tag => (
                      <button
                        key={tag}
                        className={`tag-btn ${filterTag === tag ? 'active' : ''}`}
                        onClick={() => setFilterTag(tag)}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                </div>
                
                <div className="knowledge-list">
                  {filteredKnowledge.map(node => (
                    <div
                      key={node.id}
                      className={`knowledge-item ${selectedNode === node.id ? 'selected' : ''}`}
                      onClick={() => setSelectedNode(node.id)}
                      style={{ borderLeftColor: NODE_COLORS[node.type] }}
                    >
                      <span className="item-type" style={{ color: NODE_COLORS[node.type] }}>
                        {node.type}
                      </span>
                      <span className="item-title">{node.title}</span>
                      <div className="item-meta">
                        <span className="confidence">
                          {Math.round(node.confidence * 100)}%
                        </span>
                        <span className="connections">
                          {node.connections.length} links
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="knowledge-detail">
                {selectedNodeData ? (
                  <>
                    <div className="detail-header">
                      <span 
                        className="node-type-badge"
                        style={{ backgroundColor: NODE_COLORS[selectedNodeData.type] }}
                      >
                        {selectedNodeData.type}
                      </span>
                      <h3>{selectedNodeData.title}</h3>
                    </div>
                    
                    <div className="detail-content">
                      <p>{selectedNodeData.content}</p>
                    </div>
                    
                    <div className="detail-tags">
                      {selectedNodeData.tags.map(tag => (
                        <span key={tag} className="tag">{tag}</span>
                      ))}
                    </div>
                    
                    <div className="detail-stats">
                      <div className="stat">
                        <label>Confidence</label>
                        <div className="progress-bar">
                          <div 
                            className="progress"
                            style={{ width: `${selectedNodeData.confidence * 100}%` }}
                          />
                        </div>
                        <span>{Math.round(selectedNodeData.confidence * 100)}%</span>
                      </div>
                      
                      {selectedNodeData.nextReview && (
                        <div className="stat">
                          <label>Next Review</label>
                          <span>{selectedNodeData.nextReview.toLocaleDateString()}</span>
                        </div>
                      )}
                    </div>
                    
                    {connectedNodes.length > 0 && (
                      <div className="connected-nodes">
                        <h4>Connected Knowledge</h4>
                        <div className="connections-list">
                          {connectedNodes.map(node => (
                            <div
                              key={node.id}
                              className="connected-item"
                              onClick={() => setSelectedNode(node.id)}
                              style={{ borderColor: NODE_COLORS[node.type] }}
                            >
                              <span className="conn-title">{node.title}</span>
                              <span className="conn-type">{node.type}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="no-selection">
                    <p>Select an item to view details</p>
                  </div>
                )}
              </div>
            </>
          )}

          {viewMode === 'journal' && (
            <div className="journal-view">
              {journals.map(entry => (
                <div key={entry.id} className="journal-entry">
                  <div className="entry-header">
                    <span className="entry-date">
                      {entry.date.toLocaleDateString('en-US', { 
                        weekday: 'long',
                        month: 'short', 
                        day: 'numeric' 
                      })}
                    </span>
                    <span className="entry-mood">{getMoodEmoji(entry.mood)}</span>
                  </div>
                  <span className="entry-type">{entry.type}</span>
                  <p className="entry-summary">{entry.summary}</p>
                </div>
              ))}
            </div>
          )}

          {viewMode === 'insights' && (
            <div className="insights-view">
              {insights.filter(i => !i.dismissed).length === 0 ? (
                <div className="empty-insights">
                  <p>No active insights</p>
                  <p className="hint">Atlas will surface patterns and recommendations here</p>
                </div>
              ) : (
                insights.filter(i => !i.dismissed).map(insight => (
                  <div key={insight.id} className={`insight-card ${insight.type}`}>
                    <div className="insight-header">
                      <span className="insight-type">{insight.type}</span>
                      <button 
                        className="dismiss-btn"
                        onClick={() => dismissInsight(insight.id)}
                      >
                        Dismiss
                      </button>
                    </div>
                    <h4>{insight.title}</h4>
                    <p>{insight.content}</p>
                    {insight.actionable && (
                      <button className="action-btn">Take Action</button>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {viewMode === 'review' && (
            <div className="review-view">
              {dueForReview.length === 0 ? (
                <div className="review-complete">
                  <span className="complete-icon">\u2713</span>
                  <p>All caught up!</p>
                  <p className="hint">No knowledge items due for review</p>
                </div>
              ) : (
                <>
                  <div className="review-header">
                    <h4>{dueForReview.length} items due for review</h4>
                    <button className="start-review-btn">Start Review Session</button>
                  </div>
                  <div className="review-list">
                    {dueForReview.map(item => (
                      <div key={item.id} className="review-item">
                        <span 
                          className="review-type"
                          style={{ color: NODE_COLORS[item.type] }}
                        >
                          {item.type}
                        </span>
                        <span className="review-title">{item.title}</span>
                        <span className="review-confidence">
                          {Math.round(item.confidence * 100)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default KnowledgeExplorer;
