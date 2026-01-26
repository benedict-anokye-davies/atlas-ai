/**
 * Atlas Desktop - Memory Graph Component
 * Interactive force-directed knowledge graph visualization of memory
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// ============================================================================
// Types
// ============================================================================

type GraphNodeType =
  | 'memory'
  | 'topic'
  | 'entity'
  | 'session'
  | 'summary'
  | 'action'
  | 'fact'
  | 'preference';

type GraphEdgeType =
  | 'contains'
  | 'related_to'
  | 'mentioned_in'
  | 'derived_from'
  | 'similar_to'
  | 'follows'
  | 'assigned_to'
  | 'categorized_as';

interface GraphNode {
  id: string;
  type: GraphNodeType;
  label: string;
  content: string;
  weight: number;
  createdAt: number;
  accessedAt: number;
  strength: number;
  color: string;
  size: number;
  category?: string;
  tags: string[];
  sourceType?: string;
  metadata: Record<string, unknown>;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: GraphEdgeType;
  weight: number;
  label?: string;
  color: string;
  metadata?: Record<string, unknown>;
}

interface GraphStats {
  nodeCount: number;
  edgeCount: number;
  nodesByType: Record<GraphNodeType, number>;
  edgesByType: Record<GraphEdgeType, number>;
  averageWeight: number;
  averageStrength: number;
  topConnected: Array<{ id: string; label: string; connections: number }>;
  dateRange: { start: number; end: number };
}

interface MemoryGraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: GraphStats;
  generatedAt: number;
}

interface GraphFilterOptions {
  nodeTypes?: GraphNodeType[];
  edgeTypes?: GraphEdgeType[];
  minWeight?: number;
  minStrength?: number;
  tags?: string[];
  category?: string;
  dateRange?: { start?: number; end?: number };
  searchText?: string;
  maxNodes?: number;
  includeOrphans?: boolean;
}

// Internal simulation node with physics
interface SimNode extends GraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx?: number | null;
  fy?: number | null;
}

interface SimEdge extends GraphEdge {
  sourceNode: SimNode;
  targetNode: SimNode;
}

// ============================================================================
// Props
// ============================================================================

interface MemoryGraphProps {
  /** Graph data to visualize */
  data?: MemoryGraphData | null;
  /** Callback when a node is selected */
  onNodeSelect?: (node: GraphNode | null) => void;
  /** Callback when requesting to refresh data */
  onRefresh?: () => void;
  /** Filter options */
  filters?: GraphFilterOptions;
  /** Whether to show the stats panel */
  showStats?: boolean;
  /** Whether to show the legend */
  showLegend?: boolean;
  /** Whether to show the search bar */
  showSearch?: boolean;
  /** Whether the panel is visible */
  visible?: boolean;
  /** Close callback */
  onClose?: () => void;
  /** Additional CSS class */
  className?: string;
}

// ============================================================================
// Constants
// ============================================================================

const NODE_TYPE_ICONS: Record<GraphNodeType, string> = {
  memory: 'M',
  topic: 'T',
  entity: 'E',
  session: 'S',
  summary: 'U',
  action: 'A',
  fact: 'F',
  preference: 'P',
};

const NODE_TYPE_LABELS: Record<GraphNodeType, string> = {
  memory: 'Memory',
  topic: 'Topic',
  entity: 'Entity',
  session: 'Session',
  summary: 'Summary',
  action: 'Action',
  fact: 'Fact',
  preference: 'Preference',
};

// ============================================================================
// Force Simulation
// ============================================================================

class ForceSimulation {
  nodes: SimNode[] = [];
  edges: SimEdge[] = [];
  private width = 800;
  private height = 600;
  private alpha = 1;
  private alphaDecay = 0.02;
  private alphaMin = 0.001;
  private velocityDecay = 0.4;
  private running = false;
  private onTick?: () => void;

  constructor() {}

  setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  setData(nodes: GraphNode[], edges: GraphEdge[]): void {
    // Initialize nodes with positions
    const nodeMap = new Map<string, SimNode>();
    const centerX = this.width / 2;
    const centerY = this.height / 2;

    this.nodes = nodes.map((node, i) => {
      const angle = (2 * Math.PI * i) / nodes.length;
      const radius = Math.min(this.width, this.height) / 3;
      const simNode: SimNode = {
        ...node,
        x: centerX + radius * Math.cos(angle) + (Math.random() - 0.5) * 50,
        y: centerY + radius * Math.sin(angle) + (Math.random() - 0.5) * 50,
        vx: 0,
        vy: 0,
      };
      nodeMap.set(node.id, simNode);
      return simNode;
    });

    // Initialize edges with node references
    this.edges = edges
      .map((edge) => {
        const sourceNode = nodeMap.get(edge.source);
        const targetNode = nodeMap.get(edge.target);
        if (sourceNode && targetNode) {
          return { ...edge, sourceNode, targetNode };
        }
        return null;
      })
      .filter((e): e is SimEdge => e !== null);

    this.alpha = 1;
  }

  start(onTick: () => void): void {
    this.onTick = onTick;
    this.running = true;
    this.tick();
  }

  stop(): void {
    this.running = false;
    this.onTick = undefined;
  }

  private tick = (): void => {
    if (!this.running || this.alpha < this.alphaMin) {
      return;
    }

    // Apply forces
    this.applyLinkForce();
    this.applyManyBodyForce();
    this.applyCenterForce();
    this.applyBoundaryForce();

    // Update positions
    for (const node of this.nodes) {
      if (node.fx != null) {
        node.x = node.fx;
        node.vx = 0;
      } else {
        node.vx *= this.velocityDecay;
        node.x += node.vx;
      }

      if (node.fy != null) {
        node.y = node.fy;
        node.vy = 0;
      } else {
        node.vy *= this.velocityDecay;
        node.y += node.vy;
      }
    }

    // Decay alpha
    this.alpha += (0 - this.alpha) * this.alphaDecay;

    this.onTick?.();

    requestAnimationFrame(this.tick);
  };

  private applyLinkForce(): void {
    const strength = 0.5;
    const distance = 100;

    for (const edge of this.edges) {
      const source = edge.sourceNode;
      const target = edge.targetNode;

      let dx = target.x - source.x;
      let dy = target.y - source.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;

      const l = ((d - distance * edge.weight) / d) * this.alpha * strength;
      dx *= l;
      dy *= l;

      const k = 0.5;
      target.vx -= dx * k;
      target.vy -= dy * k;
      source.vx += dx * k;
      source.vy += dy * k;
    }
  }

  private applyManyBodyForce(): void {
    const strength = -200;

    for (let i = 0; i < this.nodes.length; i++) {
      for (let j = i + 1; j < this.nodes.length; j++) {
        const nodeA = this.nodes[i];
        const nodeB = this.nodes[j];

        let dx = nodeB.x - nodeA.x;
        let dy = nodeB.y - nodeA.y;
        const d2 = dx * dx + dy * dy || 1;
        const d = Math.sqrt(d2);

        const force = (strength * this.alpha) / d2;
        dx *= force / d;
        dy *= force / d;

        nodeB.vx -= dx;
        nodeB.vy -= dy;
        nodeA.vx += dx;
        nodeA.vy += dy;
      }
    }
  }

  private applyCenterForce(): void {
    const strength = 0.1;
    const cx = this.width / 2;
    const cy = this.height / 2;

    for (const node of this.nodes) {
      node.vx += (cx - node.x) * strength * this.alpha;
      node.vy += (cy - node.y) * strength * this.alpha;
    }
  }

  private applyBoundaryForce(): void {
    const padding = 50;

    for (const node of this.nodes) {
      const r = node.size / 2;

      if (node.x - r < padding) {
        node.vx += (padding - (node.x - r)) * 0.5;
      }
      if (node.x + r > this.width - padding) {
        node.vx -= (node.x + r - (this.width - padding)) * 0.5;
      }
      if (node.y - r < padding) {
        node.vy += (padding - (node.y - r)) * 0.5;
      }
      if (node.y + r > this.height - padding) {
        node.vy -= (node.y + r - (this.height - padding)) * 0.5;
      }
    }
  }

  findNodeAt(x: number, y: number): SimNode | null {
    for (const node of this.nodes) {
      const dx = x - node.x;
      const dy = y - node.y;
      const r = node.size / 2 + 5;
      if (dx * dx + dy * dy < r * r) {
        return node;
      }
    }
    return null;
  }

  reheat(): void {
    this.alpha = 0.3;
    if (!this.running && this.onTick) {
      this.running = true;
      this.tick();
    }
  }
}

// ============================================================================
// Main Component
// ============================================================================

export const MemoryGraph: React.FC<MemoryGraphProps> = ({
  data,
  onNodeSelect,
  onRefresh,
  filters,
  showStats = true,
  showLegend = true,
  showSearch = true,
  visible = true,
  onClose,
  className = '',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const simulationRef = useRef<ForceSimulation | null>(null);

  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [hoveredNode, setHoveredNode] = useState<SimNode | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilters, setActiveFilters] = useState<GraphFilterOptions>(filters || {});
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [isDragging, setIsDragging] = useState(false);
  const [draggedNode, setDraggedNode] = useState<SimNode | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [lastPanPos, setLastPanPos] = useState({ x: 0, y: 0 });
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  // Filter data based on search and filters
  const filteredData = useMemo(() => {
    if (!data) return null;

    let nodes = [...data.nodes];
    let edges = [...data.edges];

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      nodes = nodes.filter(
        (n) =>
          n.label.toLowerCase().includes(query) ||
          n.content.toLowerCase().includes(query) ||
          n.tags.some((t) => t.toLowerCase().includes(query))
      );
    }

    // Apply type filter
    if (activeFilters.nodeTypes?.length) {
      nodes = nodes.filter((n) => activeFilters.nodeTypes!.includes(n.type));
    }

    // Apply weight filter
    if (activeFilters.minWeight !== undefined) {
      nodes = nodes.filter((n) => n.weight >= activeFilters.minWeight!);
    }

    // Apply strength filter
    if (activeFilters.minStrength !== undefined) {
      nodes = nodes.filter((n) => n.strength >= activeFilters.minStrength!);
    }

    // Filter edges to only include valid nodes
    const nodeIds = new Set(nodes.map((n) => n.id));
    edges = edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));

    return { nodes, edges };
  }, [data, searchQuery, activeFilters]);

  // Initialize simulation
  useEffect(() => {
    if (!simulationRef.current) {
      simulationRef.current = new ForceSimulation();
    }
  }, []);

  // Update simulation with data
  useEffect(() => {
    const simulation = simulationRef.current;
    if (!simulation || !filteredData) return;

    simulation.setSize(dimensions.width, dimensions.height);
    simulation.setData(filteredData.nodes, filteredData.edges);

    simulation.start(() => {
      renderCanvas();
    });

    return () => {
      simulation.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredData, dimensions]);

  // Handle resize
  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setDimensions({
          width: rect.width,
          height: rect.height,
        });
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [visible]);

  // Render canvas
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const simulation = simulationRef.current;
    if (!canvas || !simulation) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = dimensions;
    const dpr = window.devicePixelRatio || 1;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);

    // Clear
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, width, height);

    // Apply transform
    ctx.save();
    ctx.translate(transform.x + width / 2, transform.y + height / 2);
    ctx.scale(transform.scale, transform.scale);
    ctx.translate(-width / 2, -height / 2);

    // Draw edges
    for (const edge of simulation.edges) {
      const source = edge.sourceNode;
      const target = edge.targetNode;

      ctx.beginPath();
      ctx.moveTo(source.x, source.y);
      ctx.lineTo(target.x, target.y);
      ctx.strokeStyle = edge.color + '60';
      ctx.lineWidth = Math.max(1, edge.weight * 2);
      ctx.stroke();
    }

    // Draw nodes
    for (const node of simulation.nodes) {
      const isSelected = selectedNode?.id === node.id;
      const isHovered = hoveredNode?.id === node.id;
      const radius = node.size / 2;

      // Node glow
      if (isSelected || isHovered) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius + 8, 0, Math.PI * 2);
        ctx.fillStyle = node.color + '40';
        ctx.fill();
      }

      // Node circle
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = node.color;
      ctx.fill();

      // Node border
      ctx.strokeStyle = isSelected ? '#ffffff' : isHovered ? '#ffffff80' : '#00000040';
      ctx.lineWidth = isSelected ? 3 : isHovered ? 2 : 1;
      ctx.stroke();

      // Node icon
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${Math.max(10, radius * 0.8)}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(NODE_TYPE_ICONS[node.type], node.x, node.y);

      // Node label (only for larger nodes or hovered/selected)
      if (radius > 15 || isSelected || isHovered) {
        ctx.fillStyle = '#ffffff';
        ctx.font = `${Math.max(10, 12)}px Inter, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const label = node.label.length > 20 ? node.label.slice(0, 17) + '...' : node.label;
        ctx.fillText(label, node.x, node.y + radius + 4);
      }
    }

    ctx.restore();
  }, [transform, dimensions, selectedNode, hoveredNode]);

  // Handle mouse events
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      const simulation = simulationRef.current;
      if (!canvas || !simulation) return;

      const rect = canvas.getBoundingClientRect();
      const x =
        (e.clientX - rect.left - transform.x - dimensions.width / 2) / transform.scale +
        dimensions.width / 2;
      const y =
        (e.clientY - rect.top - transform.y - dimensions.height / 2) / transform.scale +
        dimensions.height / 2;

      const node = simulation.findNodeAt(x, y);

      if (node) {
        setDraggedNode(node);
        setIsDragging(true);
        node.fx = node.x;
        node.fy = node.y;
        simulation.reheat();
      } else {
        setIsPanning(true);
        setLastPanPos({ x: e.clientX, y: e.clientY });
      }
    },
    [transform, dimensions]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      const simulation = simulationRef.current;
      if (!canvas || !simulation) return;

      const rect = canvas.getBoundingClientRect();
      const x =
        (e.clientX - rect.left - transform.x - dimensions.width / 2) / transform.scale +
        dimensions.width / 2;
      const y =
        (e.clientY - rect.top - transform.y - dimensions.height / 2) / transform.scale +
        dimensions.height / 2;

      if (isDragging && draggedNode) {
        draggedNode.fx = x;
        draggedNode.fy = y;
        simulation.reheat();
      } else if (isPanning) {
        const dx = e.clientX - lastPanPos.x;
        const dy = e.clientY - lastPanPos.y;
        setTransform((prev) => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
        setLastPanPos({ x: e.clientX, y: e.clientY });
      } else {
        const node = simulation.findNodeAt(x, y);
        setHoveredNode(node);
        canvas.style.cursor = node ? 'pointer' : 'grab';
        renderCanvas();
      }
    },
    [transform, dimensions, isDragging, draggedNode, isPanning, lastPanPos, renderCanvas]
  );

  const handleMouseUp = useCallback(() => {
    if (draggedNode) {
      draggedNode.fx = null;
      draggedNode.fy = null;
    }
    setIsDragging(false);
    setDraggedNode(null);
    setIsPanning(false);
  }, [draggedNode]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (isDragging || isPanning) return;

      const canvas = canvasRef.current;
      const simulation = simulationRef.current;
      if (!canvas || !simulation) return;

      const rect = canvas.getBoundingClientRect();
      const x =
        (e.clientX - rect.left - transform.x - dimensions.width / 2) / transform.scale +
        dimensions.width / 2;
      const y =
        (e.clientY - rect.top - transform.y - dimensions.height / 2) / transform.scale +
        dimensions.height / 2;

      const node = simulation.findNodeAt(x, y);

      if (node) {
        setSelectedNode(node);
        onNodeSelect?.(node);
      } else {
        setSelectedNode(null);
        onNodeSelect?.(null);
      }
    },
    [transform, dimensions, isDragging, isPanning, onNodeSelect]
  );

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const scaleChange = e.deltaY > 0 ? 0.9 : 1.1;
    setTransform((prev) => ({
      ...prev,
      scale: Math.min(5, Math.max(0.2, prev.scale * scaleChange)),
    }));
  }, []);

  // Reset view
  const handleResetView = useCallback(() => {
    setTransform({ x: 0, y: 0, scale: 1 });
    simulationRef.current?.reheat();
  }, []);

  // Toggle node type filter
  const toggleNodeTypeFilter = useCallback((type: GraphNodeType) => {
    setActiveFilters((prev) => {
      const current = prev.nodeTypes || [];
      const newTypes = current.includes(type)
        ? current.filter((t) => t !== type)
        : [...current, type];
      return { ...prev, nodeTypes: newTypes.length > 0 ? newTypes : undefined };
    });
  }, []);

  if (!visible) return null;

  const nodeTypeOptions: GraphNodeType[] = [
    'memory',
    'topic',
    'entity',
    'session',
    'summary',
    'action',
    'fact',
    'preference',
  ];

  return (
    <div className={`memory-graph-container ${className}`} ref={containerRef}>
      {/* Header */}
      <header className="memory-graph-header">
        <div className="memory-graph-title">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="3" />
            <circle cx="4" cy="12" r="2" />
            <circle cx="20" cy="12" r="2" />
            <circle cx="12" cy="4" r="2" />
            <circle cx="12" cy="20" r="2" />
            <line x1="9" y1="12" x2="6" y2="12" />
            <line x1="18" y1="12" x2="15" y2="12" />
            <line x1="12" y1="9" x2="12" y2="6" />
            <line x1="12" y1="18" x2="12" y2="15" />
          </svg>
          <h2>Memory Graph</h2>
        </div>
        <div className="memory-graph-actions">
          <button className="memory-graph-btn" onClick={handleResetView} title="Reset View">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            </svg>
          </button>
          {onRefresh && (
            <button className="memory-graph-btn" onClick={onRefresh} title="Refresh">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
            </button>
          )}
          {onClose && (
            <button className="memory-graph-btn memory-graph-close" onClick={onClose}>
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
          )}
        </div>
      </header>

      {/* Search & Filters */}
      {showSearch && (
        <div className="memory-graph-toolbar">
          <div className="memory-graph-search">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder="Search memories..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button className="search-clear" onClick={() => setSearchQuery('')}>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>

          <div className="memory-graph-filters">
            {nodeTypeOptions.map((type) => (
              <button
                key={type}
                className={`filter-chip ${activeFilters.nodeTypes?.includes(type) ? 'active' : ''}`}
                onClick={() => toggleNodeTypeFilter(type)}
                style={{
                  borderColor: activeFilters.nodeTypes?.includes(type)
                    ? getNodeTypeColor(type)
                    : undefined,
                }}
              >
                {NODE_TYPE_LABELS[type]}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Main Graph Area */}
      <div className="memory-graph-content">
        {/* Canvas */}
        <canvas
          ref={canvasRef}
          className="memory-graph-canvas"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onClick={handleClick}
          onWheel={handleWheel}
        />

        {/* Empty State */}
        {(!filteredData || filteredData.nodes.length === 0) && (
          <div className="memory-graph-empty">
            <svg
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6v6l4 2" />
            </svg>
            <p>No memories to display</p>
            <span>Start a conversation to build your knowledge graph</span>
          </div>
        )}

        {/* Legend */}
        {showLegend && filteredData && filteredData.nodes.length > 0 && (
          <div className="memory-graph-legend">
            <h4>Node Types</h4>
            <div className="legend-items">
              {nodeTypeOptions.map((type) => (
                <div key={type} className="legend-item">
                  <span
                    className="legend-dot"
                    style={{ backgroundColor: getNodeTypeColor(type) }}
                  />
                  <span className="legend-label">{NODE_TYPE_LABELS[type]}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Stats Panel */}
        {showStats && data?.stats && (
          <div className="memory-graph-stats">
            <h4>Statistics</h4>
            <div className="stats-grid">
              <div className="stat-item">
                <span className="stat-value">{data.stats.nodeCount}</span>
                <span className="stat-label">Nodes</span>
              </div>
              <div className="stat-item">
                <span className="stat-value">{data.stats.edgeCount}</span>
                <span className="stat-label">Edges</span>
              </div>
              <div className="stat-item">
                <span className="stat-value">{(data.stats.averageStrength * 100).toFixed(0)}%</span>
                <span className="stat-label">Avg Strength</span>
              </div>
            </div>
            {data.stats.topConnected.length > 0 && (
              <div className="top-connected">
                <h5>Most Connected</h5>
                {data.stats.topConnected.slice(0, 3).map((item) => (
                  <div key={item.id} className="connected-item">
                    <span className="connected-label">{item.label}</span>
                    <span className="connected-count">{item.connections}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Node Details Panel */}
      {selectedNode && (
        <div className="memory-graph-details">
          <header className="details-header">
            <span className="details-type" style={{ backgroundColor: selectedNode.color }}>
              {NODE_TYPE_LABELS[selectedNode.type]}
            </span>
            <button className="details-close" onClick={() => setSelectedNode(null)}>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </header>

          <div className="details-content">
            <h3>{selectedNode.label}</h3>
            <p className="details-text">{selectedNode.content}</p>

            <div className="details-meta">
              <div className="meta-row">
                <span className="meta-label">Importance</span>
                <div className="meta-bar">
                  <div
                    className="meta-bar-fill"
                    style={{ width: `${selectedNode.weight * 100}%` }}
                  />
                </div>
                <span className="meta-value">{(selectedNode.weight * 100).toFixed(0)}%</span>
              </div>

              <div className="meta-row">
                <span className="meta-label">Strength</span>
                <div className="meta-bar">
                  <div
                    className="meta-bar-fill strength"
                    style={{ width: `${selectedNode.strength * 100}%` }}
                  />
                </div>
                <span className="meta-value">{(selectedNode.strength * 100).toFixed(0)}%</span>
              </div>

              <div className="meta-row">
                <span className="meta-label">Created</span>
                <span className="meta-value">
                  {new Date(selectedNode.createdAt).toLocaleDateString()}
                </span>
              </div>

              <div className="meta-row">
                <span className="meta-label">Last Accessed</span>
                <span className="meta-value">
                  {new Date(selectedNode.accessedAt).toLocaleDateString()}
                </span>
              </div>
            </div>

            {selectedNode.tags.length > 0 && (
              <div className="details-tags">
                {selectedNode.tags.map((tag) => (
                  <span key={tag} className="tag">
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// Helper function to get node type color
function getNodeTypeColor(type: GraphNodeType): string {
  const colors: Record<GraphNodeType, string> = {
    memory: '#6366F1',
    topic: '#8B5CF6',
    entity: '#EC4899',
    session: '#14B8A6',
    summary: '#F59E0B',
    action: '#EF4444',
    fact: '#22C55E',
    preference: '#3B82F6',
  };
  return colors[type];
}

export default MemoryGraph;
