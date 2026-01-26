/**
 * BrainMiniWidget.tsx
 * 
 * A compact 3D visualization widget showing JARVIS's brain activity.
 * Displays in the corner of the UI, showing active connections and thought patterns.
 */

import { useRef, useMemo, useState, useCallback } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Sphere, Line } from '@react-three/drei';
import * as THREE from 'three';

// ============================================================================
// Types
// ============================================================================

interface BrainNode {
  id: string;
  label: string;
  type: string;
  confidence: number;
  size: number;
  color: string;
  position?: [number, number, number];
}

interface BrainEdge {
  source: string;
  target: string;
  type: string;
  weight: number;
}

interface BrainMiniWidgetProps {
  nodes: BrainNode[];
  edges: BrainEdge[];
  isActive?: boolean;
  activeConcepts?: string[];
  theme?: 'jarvis' | 'ultron' | 'friday' | 'edith';
  onNodeClick?: (nodeId: string) => void;
  onExpand?: () => void;
  className?: string;
}

// ============================================================================
// Theme Colors
// ============================================================================

const THEME_COLORS = {
  jarvis: {
    primary: '#00D4FF',
    secondary: '#00A3CC',
    glow: 'rgba(0, 212, 255, 0.3)',
    active: '#00FFFF',
    line: '#00D4FF',
  },
  ultron: {
    primary: '#FF3333',
    secondary: '#CC0000',
    glow: 'rgba(255, 51, 51, 0.3)',
    active: '#FF6666',
    line: '#FF3333',
  },
  friday: {
    primary: '#00FF88',
    secondary: '#00CC6A',
    glow: 'rgba(0, 255, 136, 0.3)',
    active: '#66FFAA',
    line: '#00FF88',
  },
  edith: {
    primary: '#AA88FF',
    secondary: '#8866CC',
    glow: 'rgba(170, 136, 255, 0.3)',
    active: '#CCAAFF',
    line: '#AA88FF',
  },
};

// ============================================================================
// Node Component
// ============================================================================

interface NodeMeshProps {
  node: BrainNode;
  position: [number, number, number];
  isActive: boolean;
  theme: typeof THEME_COLORS.jarvis;
  onClick?: () => void;
}

function NodeMesh({ node, position, isActive, theme, onClick }: NodeMeshProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);
  
  // Pulsing animation for active nodes
  useFrame((state) => {
    if (meshRef.current) {
      if (isActive) {
        const pulse = Math.sin(state.clock.elapsedTime * 3) * 0.1 + 1;
        meshRef.current.scale.setScalar(pulse * (node.size / 10));
      } else {
        meshRef.current.scale.setScalar(node.size / 10);
      }
    }
  });
  
  const color = isActive ? theme.active : node.color;
  const emissiveIntensity = isActive ? 0.5 : hovered ? 0.3 : 0.1;
  
  return (
    <Sphere
      ref={meshRef}
      position={position}
      args={[0.1, 16, 16]}
      onClick={onClick}
      onPointerOver={() => setHovered(true)}
      onPointerOut={() => setHovered(false)}
    >
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={emissiveIntensity}
        transparent
        opacity={0.8 + node.confidence * 0.2}
      />
    </Sphere>
  );
}

// ============================================================================
// Edge Component
// ============================================================================

interface EdgeLineProps {
  start: [number, number, number];
  end: [number, number, number];
  weight: number;
  isActive: boolean;
  theme: typeof THEME_COLORS.jarvis;
}

function EdgeLine({ start, end, weight, isActive, theme }: EdgeLineProps) {
  const points = useMemo(() => [
    new THREE.Vector3(...start),
    new THREE.Vector3(...end),
  ], [start, end]);
  
  return (
    <Line
      points={points}
      color={isActive ? theme.active : theme.line}
      lineWidth={Math.max(0.5, weight * 2)}
      transparent
      opacity={isActive ? 0.8 : 0.3 + weight * 0.3}
    />
  );
}

// ============================================================================
// 3D Brain Scene
// ============================================================================

interface BrainSceneProps {
  nodes: BrainNode[];
  edges: BrainEdge[];
  activeConcepts: string[];
  theme: typeof THEME_COLORS.jarvis;
  onNodeClick?: (nodeId: string) => void;
}

function BrainScene({ nodes, edges, activeConcepts, theme, onNodeClick }: BrainSceneProps) {
  const groupRef = useRef<THREE.Group>(null);
  
  // Slow rotation
  useFrame((state) => {
    if (groupRef.current) {
      groupRef.current.rotation.y = state.clock.elapsedTime * 0.1;
    }
  });
  
  // Generate positions for nodes using spherical layout
  const nodePositions = useMemo(() => {
    const positions: Map<string, [number, number, number]> = new Map();
    const count = nodes.length;
    
    nodes.forEach((node, i) => {
      if (node.position) {
        positions.set(node.id, node.position);
      } else {
        // Fibonacci sphere distribution
        const phi = Math.acos(1 - 2 * (i + 0.5) / count);
        const theta = Math.PI * (1 + Math.sqrt(5)) * i;
        const radius = 1 + (node.confidence * 0.3);
        
        const x = radius * Math.sin(phi) * Math.cos(theta);
        const y = radius * Math.sin(phi) * Math.sin(theta);
        const z = radius * Math.cos(phi);
        
        positions.set(node.id, [x, y, z]);
      }
    });
    
    return positions;
  }, [nodes]);
  
  // Check if a node is active
  const isNodeActive = useCallback((node: BrainNode) => {
    return activeConcepts.some(c => 
      node.label.toLowerCase().includes(c.toLowerCase()) ||
      node.id === c
    );
  }, [activeConcepts]);
  
  // Check if an edge is active
  const isEdgeActive = useCallback((edge: BrainEdge) => {
    const sourceActive = activeConcepts.some(c => edge.source.includes(c));
    const targetActive = activeConcepts.some(c => edge.target.includes(c));
    return sourceActive || targetActive;
  }, [activeConcepts]);
  
  return (
    <group ref={groupRef}>
      {/* Ambient light */}
      <ambientLight intensity={0.2} />
      
      {/* Point light at center */}
      <pointLight position={[0, 0, 0]} intensity={0.5} color={theme.primary} />
      
      {/* Edges */}
      {edges.map((edge, i) => {
        const startPos = nodePositions.get(edge.source);
        const endPos = nodePositions.get(edge.target);
        
        if (!startPos || !endPos) return null;
        
        return (
          <EdgeLine
            key={`edge-${i}`}
            start={startPos}
            end={endPos}
            weight={edge.weight}
            isActive={isEdgeActive(edge)}
            theme={theme}
          />
        );
      })}
      
      {/* Nodes */}
      {nodes.map((node) => {
        const position = nodePositions.get(node.id);
        if (!position) return null;
        
        return (
          <NodeMesh
            key={node.id}
            node={node}
            position={position}
            isActive={isNodeActive(node)}
            theme={theme}
            onClick={() => onNodeClick?.(node.id)}
          />
        );
      })}
    </group>
  );
}

// ============================================================================
// Main Widget Component
// ============================================================================

export function BrainMiniWidget({
  nodes,
  edges,
  isActive = false,
  activeConcepts = [],
  theme = 'jarvis',
  onNodeClick,
  onExpand,
  className = '',
}: BrainMiniWidgetProps) {
  const themeColors = THEME_COLORS[theme];
  
  // Stats
  const nodeCount = nodes.length;
  const activeCount = activeConcepts.length;
  
  return (
    <div 
      className={`brain-mini-widget ${className}`}
      style={{
        width: '200px',
        height: '200px',
        borderRadius: '12px',
        overflow: 'hidden',
        background: `linear-gradient(135deg, rgba(0,0,0,0.8) 0%, rgba(20,20,40,0.9) 100%)`,
        border: `1px solid ${themeColors.primary}40`,
        boxShadow: isActive ? `0 0 20px ${themeColors.glow}` : 'none',
        position: 'relative',
        cursor: 'pointer',
      }}
      onClick={onExpand}
    >
      {/* Header */}
      <div 
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          padding: '8px 12px',
          background: 'linear-gradient(180deg, rgba(0,0,0,0.7) 0%, transparent 100%)',
          zIndex: 10,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span style={{ 
          fontSize: '10px', 
          fontWeight: 600, 
          color: themeColors.primary,
          textTransform: 'uppercase',
          letterSpacing: '1px',
        }}>
          Brain
        </span>
        <span style={{ 
          fontSize: '9px', 
          color: 'rgba(255,255,255,0.6)',
        }}>
          {nodeCount} nodes
        </span>
      </div>
      
      {/* 3D Canvas */}
      <Canvas
        camera={{ position: [0, 0, 3], fov: 50 }}
        style={{ background: 'transparent' }}
      >
        <BrainScene
          nodes={nodes}
          edges={edges}
          activeConcepts={activeConcepts}
          theme={themeColors}
          onNodeClick={onNodeClick}
        />
        <OrbitControls 
          enableZoom={false}
          enablePan={false}
          autoRotate={!isActive}
          autoRotateSpeed={0.5}
        />
      </Canvas>
      
      {/* Activity indicator */}
      {isActive && (
        <div
          style={{
            position: 'absolute',
            bottom: '8px',
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <div
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: themeColors.active,
              animation: 'pulse 1s ease-in-out infinite',
            }}
          />
          <span style={{ 
            fontSize: '9px', 
            color: themeColors.active,
          }}>
            {activeCount} active
          </span>
        </div>
      )}
      
      {/* Expand hint */}
      <div
        style={{
          position: 'absolute',
          bottom: '8px',
          right: '8px',
          fontSize: '14px',
          color: 'rgba(255,255,255,0.4)',
        }}
      >
        ⤢
      </div>
      
      {/* CSS for pulse animation */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.2); }
        }
      `}</style>
    </div>
  );
}

export default BrainMiniWidget;
