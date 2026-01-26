import React, { useEffect, useState } from 'react';
import './IntelligenceView.css';

interface IntelligenceNode {
  id: string;
  x: number;
  y: number;
  label: string;
  type: 'concept' | 'person' | 'event';
  connections: string[];
}

export const IntelligenceView: React.FC = () => {
  const [nodes, setNodes] = useState<IntelligenceNode[]>([]);
  const [scanning] = useState(true);

  // Simulate graph data initialization
  useEffect(() => {
    const initialNodes: IntelligenceNode[] = [
      { id: '1', x: 50, y: 50, label: 'ATLAS_CORE', type: 'concept', connections: ['2', '3', '4'] },
      { id: '2', x: 30, y: 30, label: 'USER_CONTEXT', type: 'person', connections: ['1'] },
      { id: '3', x: 70, y: 30, label: 'FINANCIAL_DATA', type: 'event', connections: ['1', '5'] },
      { id: '4', x: 60, y: 70, label: 'CODEBASE_INDEX', type: 'concept', connections: ['1'] },
      { id: '5', x: 80, y: 40, label: 'MARKET_regime', type: 'event', connections: ['3'] },
    ];
    setNodes(initialNodes);
  }, []);

  return (
    <div className="pt-intelligence-view">
      <div className="pt-intel-grid">
        
        {/* LEFT: Entity Stream */}
        <div className="pt-tech-card pt-entity-panel">
          <div className="pt-card-header">
            <span className="pt-icon-bracket">[</span>
            INCOMING_ENTITIES
            <span className="pt-icon-bracket">]</span>
          </div>
          <div className="pt-card-content pt-no-padding">
            <div className="pt-entity-list">
              {[
                { time: '10:42:01', type: 'CONCEPT', val: 'React_Optimization' },
                { time: '10:41:55', type: 'PERSON', val: 'Unknown_Speaker_01' },
                { time: '10:41:22', type: 'EVENT', val: 'Git_Commit' },
                { time: '10:40:10', type: 'DATA', val: 'Portfolio_Update' },
                { time: '10:39:45', type: 'CONCEPT', val: 'Market_Volatility' },
                { time: '10:38:12', type: 'SYSTEM', val: 'Memory_Prune' },
              ].map((item, i) => (
                <div key={i} className="pt-entity-row">
                  <span className="pt-mono pt-text-muted">{item.time}</span>
                  <span className="pt-tag">{item.type}</span>
                  <span className="pt-mono">{item.val}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* CENTER: Graph Visualization */}
        <div className="pt-tech-card pt-graph-panel">
          <div className="pt-card-header">
            <span className="pt-icon-bracket">[</span>
            KNOWLEDGE_TOPOLOGY
            <span className="pt-icon-bracket">]</span>
            <div className="pt-header-controls">
               <span className={`pt-status-indicator ${scanning ? 'active' : ''}`}>
                 SCANNING_NODES...
               </span>
            </div>
          </div>
          <div className="pt-card-content pt-graph-container">
            <div className="pt-graph-overlay">
              <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
                <defs>
                  <marker id="arrow" markerWidth="4" markerHeight="4" refX="2" refY="2" orient="auto">
                    <path d="M0,0 L4,2 L0,4 L0,0" style={{ fill: 'var(--pt-grid-line)' }} />
                  </marker>
                </defs>
                {/* Render Connections */}
                {nodes.map(node => 
                  node.connections.map(targetId => {
                    const target = nodes.find(n => n.id === targetId);
                    if (!target) return null;
                    return (
                      <line 
                        key={`${node.id}-${targetId}`}
                        x1={node.x} y1={node.y}
                        x2={target.x} y2={target.y}
                        stroke="var(--pt-grid-line)"
                        strokeWidth="0.2"
                        className="pt-graph-line"
                      />
                    );
                  })
                )}
                {/* Render Nodes */}
                {nodes.map(node => (
                  <g key={node.id} className="pt-graph-node-group">
                    <circle 
                      cx={node.x} cy={node.y} r="1.5" 
                      fill="var(--pt-bg)" 
                      stroke="var(--pt-accent)" 
                      strokeWidth="0.5"
                    />
                    <text 
                      x={node.x + 3} y={node.y + 1} 
                      className="pt-graph-label"
                      fill="var(--pt-text)"
                      fontSize="3"
                    >
                      {node.label}
                    </text>
                  </g>
                ))}
              </svg>
            </div>
            <div className="pt-grid-background"></div>
          </div>
        </div>

        {/* RIGHT: Insights */}
        <div className="pt-tech-card pt-insight-panel">
          <div className="pt-card-header">
            <span className="pt-icon-bracket">[</span>
            SYNTHESIS_LOG
            <span className="pt-icon-bracket">]</span>
          </div>
          <div className="pt-card-content">
             <div className="pt-insight-block">
                <div className="pt-insight-header">
                   <span className="pt-mono pt-text-accent">&gt;&gt; CORRELATION_DETECTED</span>
                </div>
                <div className="pt-insight-body pt-mono">
                   High volatility in crypto markets correlates with recently flagged news events in [FINANCIAL_DATA].
                </div>
             </div>
             <div className="pt-insight-block">
                <div className="pt-insight-header">
                   <span className="pt-mono pt-text-accent">&gt;&gt; PATTERN_MATCH</span>
                </div>
                <div className="pt-insight-body pt-mono">
                   User coding sessions typically occur at 10:00 AM. Pre-warming [VSCODE_TOOLS].
                </div>
             </div>
             <div className="pt-insight-block">
                <div className="pt-insight-header">
                   <span className="pt-mono pt-text-accent">&gt;&gt; ANOMALY</span>
                </div>
                <div className="pt-insight-body pt-mono">
                   Unusual number of file changes in /src/renderer. Project structure evolution detected.
                </div>
             </div>
          </div>
        </div>

      </div>
    </div>
  );
};
