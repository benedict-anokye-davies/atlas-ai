/**
 * BrainExplorer.tsx
 * 
 * Full-screen knowledge graph explorer for JARVIS's brain.
 * Allows interactive exploration of concepts, relationships, and memories.
 */

import { useRef, useState, useCallback, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Text, Sphere, Line } from '@react-three/drei';
import * as THREE from 'three';

// ============================================================================
// Types
// ============================================================================

export interface BrainNode {
  id: string;
  label: string;
  type: string;
  confidence: number;
  size: number;
  color: string;
}

export interface BrainEdge {
  source: string;
  target: string;
  type: string;
  weight: number;
}

export interface BrainExplorerProps {
  nodes: BrainNode[];
  edges: BrainEdge[];
  searchQuery?: string;
  selectedNodeId?: string | null;
  theme?: 'jarvis' | 'ultron' | 'friday' | 'edith';
  onNodeSelect?: (nodeId: string | null) => void;
  onNodeDoubleClick?: (nodeId: string) => void;
  onClose?: () => void;
}

// NodeDetails interface reserved for future use
// interface NodeDetails {
//   node: BrainNode;
//   relatedNodes: BrainNode[];
//   incomingEdges: BrainEdge[];
//   outgoingEdges: BrainEdge[];
// }

// ============================================================================
// Theme Configuration
// ============================================================================

const THEMES = {
  jarvis: {
    primary: '#00D4FF',
    secondary: '#00A3CC',
    background: '#0a0a1a',
    text: '#ffffff',
    nodeColors: {
      self: '#00D4FF',
      person: '#FF6B6B',
      fact: '#4ECDC4',
      preference: '#FFE66D',
      entity: '#95E1D3',
      concept: '#A78BFA',
      memory: '#F9A8D4',
      knowledge: '#60A5FA',
      skill: '#34D399',
      place: '#FB923C',
      event: '#F472B6',
      task: '#FACC15',
    },
  },
  ultron: {
    primary: '#FF3333',
    secondary: '#CC0000',
    background: '#1a0a0a',
    text: '#ffffff',
    nodeColors: {
      self: '#FF3333',
      person: '#FF6666',
      fact: '#FF8888',
      preference: '#FFAAAA',
      entity: '#CC3333',
      concept: '#AA2222',
      memory: '#881111',
      knowledge: '#FF4444',
      skill: '#CC2222',
      place: '#AA3333',
      event: '#FF5555',
      task: '#DD4444',
    },
  },
  friday: {
    primary: '#00FF88',
    secondary: '#00CC6A',
    background: '#0a1a10',
    text: '#ffffff',
    nodeColors: {
      self: '#00FF88',
      person: '#66FFAA',
      fact: '#44DD88',
      preference: '#88FFCC',
      entity: '#33CC77',
      concept: '#22AA66',
      memory: '#118844',
      knowledge: '#44FF99',
      skill: '#22CC77',
      place: '#33AA77',
      event: '#55FF99',
      task: '#44DD88',
    },
  },
  edith: {
    primary: '#AA88FF',
    secondary: '#8866CC',
    background: '#100a1a',
    text: '#ffffff',
    nodeColors: {
      self: '#AA88FF',
      person: '#CCAAFF',
      fact: '#BB99FF',
      preference: '#DDCCFF',
      entity: '#9977DD',
      concept: '#8866CC',
      memory: '#7755BB',
      knowledge: '#AA88FF',
      skill: '#9977CC',
      place: '#8877DD',
      event: '#BB99FF',
      task: '#AA88EE',
    },
  },
};

// ============================================================================
// Force-directed Layout
// ============================================================================

interface LayoutNode {
  id: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

function useForceLayout(nodes: BrainNode[], edges: BrainEdge[], iterations: number = 100) {
  return useMemo(() => {
    // Initialize positions randomly
    const layoutNodes: Map<string, LayoutNode> = new Map();
    
    nodes.forEach((node) => {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 3 + Math.random() * 2;
      
      layoutNodes.set(node.id, {
        id: node.id,
        x: r * Math.sin(phi) * Math.cos(theta),
        y: r * Math.sin(phi) * Math.sin(theta),
        z: r * Math.cos(phi),
        vx: 0,
        vy: 0,
        vz: 0,
      });
    });
    
    // Force simulation
    const alpha = 0.1;
    const repulsion = 2;
    const attraction = 0.05;
    const centerForce = 0.01;
    
    for (let iter = 0; iter < iterations; iter++) {
      // Repulsion between all nodes
      for (const nodeA of layoutNodes.values()) {
        for (const nodeB of layoutNodes.values()) {
          if (nodeA.id === nodeB.id) continue;
          
          const dx = nodeA.x - nodeB.x;
          const dy = nodeA.y - nodeB.y;
          const dz = nodeA.z - nodeB.z;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) + 0.1;
          
          const force = repulsion / (dist * dist);
          
          nodeA.vx += (dx / dist) * force;
          nodeA.vy += (dy / dist) * force;
          nodeA.vz += (dz / dist) * force;
        }
      }
      
      // Attraction along edges
      for (const edge of edges) {
        const nodeA = layoutNodes.get(edge.source);
        const nodeB = layoutNodes.get(edge.target);
        if (!nodeA || !nodeB) continue;
        
        const dx = nodeB.x - nodeA.x;
        const dy = nodeB.y - nodeA.y;
        const dz = nodeB.z - nodeA.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) + 0.1;
        
        const force = attraction * dist * edge.weight;
        
        nodeA.vx += (dx / dist) * force;
        nodeA.vy += (dy / dist) * force;
        nodeA.vz += (dz / dist) * force;
        
        nodeB.vx -= (dx / dist) * force;
        nodeB.vy -= (dy / dist) * force;
        nodeB.vz -= (dz / dist) * force;
      }
      
      // Center force
      for (const node of layoutNodes.values()) {
        node.vx -= node.x * centerForce;
        node.vy -= node.y * centerForce;
        node.vz -= node.z * centerForce;
      }
      
      // Apply velocities
      for (const node of layoutNodes.values()) {
        node.x += node.vx * alpha;
        node.y += node.vy * alpha;
        node.z += node.vz * alpha;
        
        // Damping
        node.vx *= 0.9;
        node.vy *= 0.9;
        node.vz *= 0.9;
      }
    }
    
    return layoutNodes;
  }, [nodes, edges, iterations]);
}

// ============================================================================
// 3D Node Component
// ============================================================================

interface GraphNodeProps {
  node: BrainNode;
  position: [number, number, number];
  isSelected: boolean;
  isHighlighted: boolean;
  theme: typeof THEMES.jarvis;
  onClick: () => void;
  onDoubleClick: () => void;
}

function GraphNode({ node, position, isSelected, isHighlighted, theme, onClick, onDoubleClick }: GraphNodeProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);
  
  useFrame((state) => {
    if (meshRef.current) {
      // Pulse for selected nodes
      if (isSelected) {
        const pulse = Math.sin(state.clock.elapsedTime * 3) * 0.1 + 1;
        meshRef.current.scale.setScalar(pulse * (node.size / 8));
      } else {
        meshRef.current.scale.setScalar(node.size / 8);
      }
    }
  });
  
  const color = isSelected 
    ? '#FFFFFF' 
    : isHighlighted 
      ? theme.primary 
      : node.color;
  
  const emissive = isSelected || isHighlighted || hovered;
  
  return (
    <group position={position}>
      <Sphere
        ref={meshRef}
        args={[0.2, 32, 32]}
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick(); }}
        onPointerOver={(e) => { e.stopPropagation(); setHovered(true); }}
        onPointerOut={() => setHovered(false)}
      >
        <meshStandardMaterial
          color={color}
          emissive={emissive ? color : '#000000'}
          emissiveIntensity={emissive ? 0.5 : 0}
          transparent
          opacity={0.9}
          roughness={0.3}
          metalness={0.7}
        />
      </Sphere>
      
      {/* Label */}
      {(hovered || isSelected) && (
        <Text
          position={[0, 0.4, 0]}
          fontSize={0.15}
          color={theme.text}
          anchorX="center"
          anchorY="bottom"
          maxWidth={2}
        >
          {node.label}
        </Text>
      )}
      
      {/* Selection ring */}
      {isSelected && (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.35, 0.4, 32]} />
          <meshBasicMaterial color={theme.primary} transparent opacity={0.8} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  );
}

// ============================================================================
// 3D Edge Component
// ============================================================================

interface GraphEdgeProps {
  start: [number, number, number];
  end: [number, number, number];
  weight: number;
  isHighlighted: boolean;
  theme: typeof THEMES.jarvis;
}

function GraphEdge({ start, end, weight, isHighlighted, theme }: GraphEdgeProps) {
  const points = useMemo(() => [
    new THREE.Vector3(...start),
    new THREE.Vector3(...end),
  ], [start, end]);
  
  return (
    <Line
      points={points}
      color={isHighlighted ? theme.primary : theme.secondary}
      lineWidth={isHighlighted ? 2 : 1}
      transparent
      opacity={isHighlighted ? 0.8 : 0.2 + weight * 0.3}
    />
  );
}

// ============================================================================
// Graph Scene
// ============================================================================

interface GraphSceneProps {
  nodes: BrainNode[];
  edges: BrainEdge[];
  layout: Map<string, LayoutNode>;
  selectedNodeId: string | null;
  highlightedNodeIds: Set<string>;
  theme: typeof THEMES.jarvis;
  onNodeSelect: (nodeId: string | null) => void;
  onNodeDoubleClick: (nodeId: string) => void;
}

function GraphScene({ 
  nodes, 
  edges, 
  layout, 
  selectedNodeId, 
  highlightedNodeIds,
  theme,
  onNodeSelect,
  onNodeDoubleClick,
}: GraphSceneProps) {
  useThree(); // Camera available via useThree if needed
  
  // Get position for a node
  const getPosition = useCallback((nodeId: string): [number, number, number] => {
    const layoutNode = layout.get(nodeId);
    return layoutNode ? [layoutNode.x, layoutNode.y, layoutNode.z] : [0, 0, 0];
  }, [layout]);
  
  // Check if edge is highlighted
  const isEdgeHighlighted = useCallback((edge: BrainEdge) => {
    return highlightedNodeIds.has(edge.source) || highlightedNodeIds.has(edge.target);
  }, [highlightedNodeIds]);
  
  return (
    <>
      <ambientLight intensity={0.3} />
      <pointLight position={[10, 10, 10]} intensity={0.5} />
      <pointLight position={[-10, -10, -10]} intensity={0.3} />
      
      {/* Center glow */}
      <mesh position={[0, 0, 0]}>
        <sphereGeometry args={[0.5, 32, 32]} />
        <meshBasicMaterial color={theme.primary} transparent opacity={0.1} />
      </mesh>
      
      {/* Edges */}
      {edges.map((edge, i) => (
        <GraphEdge
          key={`edge-${i}`}
          start={getPosition(edge.source)}
          end={getPosition(edge.target)}
          weight={edge.weight}
          isHighlighted={isEdgeHighlighted(edge)}
          theme={theme}
        />
      ))}
      
      {/* Nodes */}
      {nodes.map((node) => (
        <GraphNode
          key={node.id}
          node={node}
          position={getPosition(node.id)}
          isSelected={node.id === selectedNodeId}
          isHighlighted={highlightedNodeIds.has(node.id)}
          theme={theme}
          onClick={() => onNodeSelect(node.id === selectedNodeId ? null : node.id)}
          onDoubleClick={() => onNodeDoubleClick(node.id)}
        />
      ))}
    </>
  );
}

// ============================================================================
// Info Panel
// ============================================================================

interface InfoPanelProps {
  node: BrainNode | null;
  relatedNodes: BrainNode[];
  theme: typeof THEMES.jarvis;
  onClose: () => void;
  onNodeClick: (nodeId: string) => void;
}

function InfoPanel({ node, relatedNodes, theme, onClose, onNodeClick }: InfoPanelProps) {
  if (!node) return null;
  
  return (
    <div
      style={{
        position: 'absolute',
        top: 20,
        right: 20,
        width: 300,
        background: `${theme.background}ee`,
        border: `1px solid ${theme.primary}40`,
        borderRadius: 12,
        padding: 16,
        color: theme.text,
        zIndex: 100,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0, color: theme.primary }}>{node.label}</h3>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: theme.text,
            cursor: 'pointer',
            fontSize: 18,
          }}
        >
          ×
        </button>
      </div>
      
      {/* Type badge */}
      <div
        style={{
          display: 'inline-block',
          padding: '4px 8px',
          borderRadius: 4,
          background: node.color,
          color: '#000',
          fontSize: 11,
          fontWeight: 600,
          textTransform: 'uppercase',
          marginBottom: 12,
        }}
      >
        {node.type}
      </div>
      
      {/* Stats */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ opacity: 0.7 }}>Confidence</span>
          <span>{(node.confidence * 100).toFixed(0)}%</span>
        </div>
        <div style={{ 
          height: 4, 
          background: 'rgba(255,255,255,0.1)', 
          borderRadius: 2,
          overflow: 'hidden',
        }}>
          <div style={{ 
            height: '100%', 
            width: `${node.confidence * 100}%`, 
            background: theme.primary,
            borderRadius: 2,
          }} />
        </div>
      </div>
      
      {/* Related nodes */}
      {relatedNodes.length > 0 && (
        <div>
          <h4 style={{ margin: '0 0 8px 0', fontSize: 12, opacity: 0.7 }}>Related Concepts</h4>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {relatedNodes.slice(0, 8).map((related) => (
              <button
                key={related.id}
                onClick={() => onNodeClick(related.id)}
                style={{
                  background: 'rgba(255,255,255,0.1)',
                  border: `1px solid ${related.color}40`,
                  borderRadius: 4,
                  padding: '4px 8px',
                  color: theme.text,
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                {related.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Search Bar
// ============================================================================

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  theme: typeof THEMES.jarvis;
}

function SearchBar({ value, onChange, theme }: SearchBarProps) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 20,
        left: 20,
        zIndex: 100,
      }}
    >
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search concepts..."
        style={{
          width: 250,
          padding: '10px 16px',
          background: `${theme.background}ee`,
          border: `1px solid ${theme.primary}40`,
          borderRadius: 8,
          color: theme.text,
          fontSize: 14,
          outline: 'none',
        }}
      />
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function BrainExplorer({
  nodes,
  edges,
  searchQuery = '',
  selectedNodeId = null,
  theme = 'jarvis',
  onNodeSelect,
  onNodeDoubleClick,
  onClose,
}: BrainExplorerProps) {
  const themeConfig = THEMES[theme];
  const [internalSearch, setInternalSearch] = useState(searchQuery);
  const [internalSelected, setInternalSelected] = useState<string | null>(selectedNodeId);
  
  // Layout
  const layout = useForceLayout(nodes, edges);
  
  // Filter nodes based on search
  const filteredNodes = useMemo(() => {
    if (!internalSearch) return nodes;
    const query = internalSearch.toLowerCase();
    return nodes.filter(n => 
      n.label.toLowerCase().includes(query) ||
      n.type.toLowerCase().includes(query)
    );
  }, [nodes, internalSearch]);
  
  // Get highlighted nodes (selected + related)
  const highlightedNodeIds = useMemo(() => {
    const ids = new Set<string>();
    if (internalSelected) {
      ids.add(internalSelected);
      // Add connected nodes
      edges.forEach((edge) => {
        if (edge.source === internalSelected) ids.add(edge.target);
        if (edge.target === internalSelected) ids.add(edge.source);
      });
    }
    // Add search matches
    filteredNodes.forEach(n => ids.add(n.id));
    return ids;
  }, [internalSelected, edges, filteredNodes]);
  
  // Get selected node details
  const selectedNode = useMemo(() => 
    nodes.find(n => n.id === internalSelected) || null,
    [nodes, internalSelected]
  );
  
  // Get related nodes
  const relatedNodes = useMemo(() => {
    if (!internalSelected) return [];
    const related: BrainNode[] = [];
    edges.forEach((edge) => {
      if (edge.source === internalSelected) {
        const node = nodes.find(n => n.id === edge.target);
        if (node) related.push(node);
      }
      if (edge.target === internalSelected) {
        const node = nodes.find(n => n.id === edge.source);
        if (node) related.push(node);
      }
    });
    return related;
  }, [nodes, edges, internalSelected]);
  
  // Handlers
  const handleNodeSelect = useCallback((nodeId: string | null) => {
    setInternalSelected(nodeId);
    onNodeSelect?.(nodeId);
  }, [onNodeSelect]);
  
  const handleNodeDoubleClick = useCallback((nodeId: string) => {
    onNodeDoubleClick?.(nodeId);
  }, [onNodeDoubleClick]);
  
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: themeConfig.background,
        zIndex: 1000,
      }}
    >
      {/* Close button */}
      {onClose && (
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: 20,
            right: 20,
            zIndex: 200,
            background: 'rgba(255,255,255,0.1)',
            border: `1px solid ${themeConfig.primary}40`,
            borderRadius: 8,
            padding: '8px 16px',
            color: themeConfig.text,
            cursor: 'pointer',
            fontSize: 14,
          }}
        >
          Close
        </button>
      )}
      
      {/* Search */}
      <SearchBar 
        value={internalSearch} 
        onChange={setInternalSearch}
        theme={themeConfig}
      />
      
      {/* Info panel */}
      <InfoPanel
        node={selectedNode}
        relatedNodes={relatedNodes}
        theme={themeConfig}
        onClose={() => handleNodeSelect(null)}
        onNodeClick={handleNodeSelect}
      />
      
      {/* Stats */}
      <div
        style={{
          position: 'absolute',
          bottom: 20,
          left: 20,
          color: themeConfig.text,
          opacity: 0.5,
          fontSize: 12,
          zIndex: 100,
        }}
      >
        {nodes.length} nodes • {edges.length} connections
      </div>
      
      {/* 3D Canvas */}
      <Canvas camera={{ position: [0, 0, 10], fov: 60 }}>
        <GraphScene
          nodes={filteredNodes.length < nodes.length ? filteredNodes : nodes}
          edges={edges}
          layout={layout}
          selectedNodeId={internalSelected}
          highlightedNodeIds={highlightedNodeIds}
          theme={themeConfig}
          onNodeSelect={handleNodeSelect}
          onNodeDoubleClick={handleNodeDoubleClick}
        />
        <OrbitControls 
          enableDamping
          dampingFactor={0.05}
          minDistance={3}
          maxDistance={20}
        />
      </Canvas>
    </div>
  );
}

export default BrainExplorer;
