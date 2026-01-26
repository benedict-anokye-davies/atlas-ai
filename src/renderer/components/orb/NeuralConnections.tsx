/**
 * NeuralConnections.tsx
 * 
 * Dynamic neural synaptic connections that pulse between particles.
 * Creates the illusion of data flowing through neural pathways,
 * responsive to Atlas state changes.
 */

import React, { useRef, useMemo, useEffect, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { AtlasState } from './AtlasParticles';

export interface NeuralConnectionsProps {
  state: AtlasState;
  intensity: number;
  enabled?: boolean;
  themeColor?: { r: number; g: number; b: number };
  nodeCount?: number;
  connectionDensity?: number;
  radius?: number;
}

interface NeuralNode {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  connections: number[];
  pulsePhase: number;
  activity: number;
}

// Shader for neural connection lines with data pulse effect
const connectionVertexShader = `
  attribute float lineProgress;
  attribute float connectionIndex;
  attribute float activity;
  
  uniform float uTime;
  uniform float uIntensity;
  
  varying float vLineProgress;
  varying float vConnectionIndex;
  varying float vActivity;
  
  void main() {
    vLineProgress = lineProgress;
    vConnectionIndex = connectionIndex;
    vActivity = activity;
    
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const connectionFragmentShader = `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uIntensity;
  uniform float uPulseSpeed;
  uniform float uOpacity;
  
  varying float vLineProgress;
  varying float vConnectionIndex;
  varying float vActivity;
  
  void main() {
    // Data pulse traveling along connection
    float pulseOffset = vConnectionIndex * 0.5; // Offset each connection
    float pulse = sin((vLineProgress * 10.0) - uTime * uPulseSpeed + pulseOffset);
    pulse = smoothstep(0.0, 1.0, pulse);
    
    // Fade at endpoints
    float endpointFade = smoothstep(0.0, 0.1, vLineProgress) * smoothstep(1.0, 0.9, vLineProgress);
    
    // Activity-based brightness
    float activityGlow = 0.3 + vActivity * 0.7;
    
    // Final alpha
    float alpha = (0.2 + pulse * 0.8) * endpointFade * uIntensity * uOpacity * activityGlow;
    
    // Color variation along line
    vec3 finalColor = uColor;
    finalColor += vec3(pulse * 0.2, pulse * 0.1, 0.0);
    
    gl_FragColor = vec4(finalColor, alpha);
  }
`;

// Shader for neural nodes (synapses)
const nodeVertexShader = `
  attribute float nodeActivity;
  attribute float pulsePhase;
  
  uniform float uTime;
  uniform float uIntensity;
  uniform float uNodeSize;
  
  varying float vActivity;
  varying float vPulse;
  
  void main() {
    vActivity = nodeActivity;
    
    // Pulsing size based on activity
    float pulse = sin(uTime * 3.0 + pulsePhase) * 0.5 + 0.5;
    vPulse = pulse;
    
    float size = uNodeSize * (0.5 + nodeActivity * 0.5) * (1.0 + pulse * 0.3);
    
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * (300.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const nodeFragmentShader = `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uIntensity;
  
  varying float vActivity;
  varying float vPulse;
  
  void main() {
    // Circular point with soft edge
    vec2 center = gl_PointCoord - vec2(0.5);
    float dist = length(center);
    
    if (dist > 0.5) discard;
    
    // Soft glow falloff
    float glow = 1.0 - smoothstep(0.0, 0.5, dist);
    glow = pow(glow, 1.5);
    
    // Core brightness
    float core = 1.0 - smoothstep(0.0, 0.2, dist);
    
    float alpha = (glow * 0.6 + core * 0.4) * uIntensity * (0.5 + vActivity * 0.5);
    
    // Color shift based on activity
    vec3 finalColor = uColor;
    finalColor = mix(finalColor, vec3(1.0), core * 0.3 + vPulse * 0.2);
    
    gl_FragColor = vec4(finalColor, alpha);
  }
`;

export const NeuralConnections: React.FC<NeuralConnectionsProps> = ({
  state,
  intensity,
  enabled = true,
  themeColor = { r: 1.0, g: 0.76, b: 0.15 },
  nodeCount = 50,
  connectionDensity = 0.15, // Probability of connection between nodes
  radius = 1.2,
}) => {
  const nodesRef = useRef<THREE.Points>(null);
  const linesRef = useRef<THREE.LineSegments>(null);
  
  const [nodes, setNodes] = useState<NeuralNode[]>([]);
  
  // State-based parameters
  const stateParams = useMemo(() => {
    const params: Record<AtlasState, { 
      pulseSpeed: number; 
      opacity: number;
      activityLevel: number;
      nodeSize: number;
    }> = {
      idle: { pulseSpeed: 1.0, opacity: 0.4, activityLevel: 0.3, nodeSize: 8 },
      listening: { pulseSpeed: 2.0, opacity: 0.6, activityLevel: 0.6, nodeSize: 10 },
      thinking: { pulseSpeed: 4.0, opacity: 0.9, activityLevel: 1.0, nodeSize: 12 },
      speaking: { pulseSpeed: 2.5, opacity: 0.7, activityLevel: 0.7, nodeSize: 10 },
      error: { pulseSpeed: 6.0, opacity: 1.0, activityLevel: 0.5, nodeSize: 14 },
    };
    return params[state];
  }, [state]);
  
  // Initialize neural network
  useEffect(() => {
    const newNodes: NeuralNode[] = [];
    
    for (let i = 0; i < nodeCount; i++) {
      // Distribute nodes in a spherical shell
      const phi = Math.random() * Math.PI * 2;
      const theta = Math.acos(2 * Math.random() - 1);
      const r = radius * (0.7 + Math.random() * 0.3);
      
      const position = new THREE.Vector3(
        r * Math.sin(theta) * Math.cos(phi),
        r * Math.sin(theta) * Math.sin(phi),
        r * Math.cos(theta)
      );
      
      newNodes.push({
        position,
        velocity: new THREE.Vector3(
          (Math.random() - 0.5) * 0.01,
          (Math.random() - 0.5) * 0.01,
          (Math.random() - 0.5) * 0.01
        ),
        connections: [],
        pulsePhase: Math.random() * Math.PI * 2,
        activity: Math.random(),
      });
    }
    
    // Create connections based on proximity and density
    for (let i = 0; i < newNodes.length; i++) {
      for (let j = i + 1; j < newNodes.length; j++) {
        const distance = newNodes[i].position.distanceTo(newNodes[j].position);
        const maxDist = radius * 0.6;
        
        if (distance < maxDist && Math.random() < connectionDensity) {
          newNodes[i].connections.push(j);
        }
      }
    }
    
    setNodes(newNodes);
  }, [nodeCount, connectionDensity, radius]);
  
  // Create geometries from nodes
  const { nodeGeometry, lineGeometry, connectionCount } = useMemo(() => {
    if (nodes.length === 0) {
      return { 
        nodeGeometry: new THREE.BufferGeometry(), 
        lineGeometry: new THREE.BufferGeometry(),
        connectionCount: 0 
      };
    }
    
    // Node positions
    const nodePositions = new Float32Array(nodes.length * 3);
    const nodeActivities = new Float32Array(nodes.length);
    const pulsePhases = new Float32Array(nodes.length);
    
    nodes.forEach((node, i) => {
      nodePositions[i * 3] = node.position.x;
      nodePositions[i * 3 + 1] = node.position.y;
      nodePositions[i * 3 + 2] = node.position.z;
      nodeActivities[i] = node.activity;
      pulsePhases[i] = node.pulsePhase;
    });
    
    const nodeGeo = new THREE.BufferGeometry();
    nodeGeo.setAttribute('position', new THREE.BufferAttribute(nodePositions, 3));
    nodeGeo.setAttribute('nodeActivity', new THREE.BufferAttribute(nodeActivities, 1));
    nodeGeo.setAttribute('pulsePhase', new THREE.BufferAttribute(pulsePhases, 1));
    
    // Connection lines
    let totalConnections = 0;
    nodes.forEach(node => { totalConnections += node.connections.length; });
    
    const linePositions = new Float32Array(totalConnections * 6); // 2 points per line, 3 coords each
    const lineProgress = new Float32Array(totalConnections * 2);
    const connectionIndices = new Float32Array(totalConnections * 2);
    const activities = new Float32Array(totalConnections * 2);
    
    let lineIndex = 0;
    let connIndex = 0;
    
    nodes.forEach((node) => {
      node.connections.forEach(targetIdx => {
        const target = nodes[targetIdx];
        
        // Start point
        linePositions[lineIndex * 6] = node.position.x;
        linePositions[lineIndex * 6 + 1] = node.position.y;
        linePositions[lineIndex * 6 + 2] = node.position.z;
        
        // End point
        linePositions[lineIndex * 6 + 3] = target.position.x;
        linePositions[lineIndex * 6 + 4] = target.position.y;
        linePositions[lineIndex * 6 + 5] = target.position.z;
        
        // Progress along line (0 to 1)
        lineProgress[lineIndex * 2] = 0;
        lineProgress[lineIndex * 2 + 1] = 1;
        
        // Connection index for unique phase offsets
        connectionIndices[lineIndex * 2] = connIndex;
        connectionIndices[lineIndex * 2 + 1] = connIndex;
        
        // Average activity of connected nodes
        const avgActivity = (node.activity + target.activity) / 2;
        activities[lineIndex * 2] = avgActivity;
        activities[lineIndex * 2 + 1] = avgActivity;
        
        lineIndex++;
        connIndex++;
      });
    });
    
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
    lineGeo.setAttribute('lineProgress', new THREE.BufferAttribute(lineProgress, 1));
    lineGeo.setAttribute('connectionIndex', new THREE.BufferAttribute(connectionIndices, 1));
    lineGeo.setAttribute('activity', new THREE.BufferAttribute(activities, 1));
    
    return { 
      nodeGeometry: nodeGeo, 
      lineGeometry: lineGeo,
      connectionCount: totalConnections 
    };
  }, [nodes]);
  
  // Shader uniforms
  const connectionUniforms = useMemo(() => ({
    uTime: { value: 0 },
    uColor: { value: new THREE.Color(themeColor.r, themeColor.g, themeColor.b) },
    uIntensity: { value: intensity },
    uPulseSpeed: { value: stateParams.pulseSpeed },
    uOpacity: { value: stateParams.opacity },
  }), [themeColor, intensity, stateParams]);
  
  const nodeUniforms = useMemo(() => ({
    uTime: { value: 0 },
    uColor: { value: new THREE.Color(themeColor.r, themeColor.g, themeColor.b) },
    uIntensity: { value: intensity },
    uNodeSize: { value: stateParams.nodeSize },
  }), [themeColor, intensity, stateParams]);
  
  // Update uniforms when props change
  useEffect(() => {
    connectionUniforms.uColor.value.setRGB(themeColor.r, themeColor.g, themeColor.b);
    nodeUniforms.uColor.value.setRGB(themeColor.r, themeColor.g, themeColor.b);
  }, [themeColor, connectionUniforms, nodeUniforms]);
  
  useEffect(() => {
    connectionUniforms.uIntensity.value = intensity;
    connectionUniforms.uPulseSpeed.value = stateParams.pulseSpeed;
    connectionUniforms.uOpacity.value = stateParams.opacity;
    
    nodeUniforms.uIntensity.value = intensity;
    nodeUniforms.uNodeSize.value = stateParams.nodeSize;
  }, [intensity, stateParams, connectionUniforms, nodeUniforms]);
  
  // Update node activities based on state
  useEffect(() => {
    setNodes(prevNodes => prevNodes.map(node => ({
      ...node,
      activity: Math.min(1, Math.max(0, node.activity * 0.5 + stateParams.activityLevel * 0.5 + (Math.random() - 0.5) * 0.2)),
    })));
  }, [state, stateParams.activityLevel]);
  
  // Animation loop
  useFrame(() => {
    if (!enabled) return;
    
    const time = performance.now() * 0.001;
    
    connectionUniforms.uTime.value = time;
    nodeUniforms.uTime.value = time;
  });
  
  if (!enabled || nodes.length === 0) return null;
  
  return (
    <group>
      {/* Neural connection lines */}
      {connectionCount > 0 && (
        <lineSegments ref={linesRef} geometry={lineGeometry}>
          <shaderMaterial
            vertexShader={connectionVertexShader}
            fragmentShader={connectionFragmentShader}
            uniforms={connectionUniforms}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </lineSegments>
      )}
      
      {/* Neural nodes (synapses) */}
      <points ref={nodesRef} geometry={nodeGeometry}>
        <shaderMaterial
          vertexShader={nodeVertexShader}
          fragmentShader={nodeFragmentShader}
          uniforms={nodeUniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
    </group>
  );
};

export default NeuralConnections;
