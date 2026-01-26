import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { STATE_COLORS, type AtlasState } from './geometry';

interface HolographicRingsProps {
  state: AtlasState;
  audioLevel?: number;
  config?: any;
}

export const HolographicRings: React.FC<HolographicRingsProps> = ({ 
  state, 
  audioLevel = 0 
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const ring1Ref = useRef<THREE.Mesh>(null);
  const ring2Ref = useRef<THREE.Mesh>(null);
  const ring3Ref = useRef<THREE.Mesh>(null);
  const ticksRef = useRef<THREE.Points>(null);

  // Get current state color
  const targetColorObj = STATE_COLORS[state] || STATE_COLORS.idle;
  const targetColor = new THREE.Color(targetColorObj.r, targetColorObj.g, targetColorObj.b);

  // Material with additive blending for hologram effect
  const ringMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: targetColor,
    transparent: true,
    opacity: 0.3,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    wireframe: false,
  }), []); // update color in useFrame to avoid recreating material

  const wireframeMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: targetColor,
    transparent: true,
    opacity: 0.15,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    wireframe: true,
  }), []);

  // Generate ticks/dots geometry
  const ticksGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    const count = 120;
    const positions = new Float32Array(count * 3);
    const radius = 2.2;
    for(let i=0; i<count; i++) {
        const angle = (i / count) * Math.PI * 2;
        positions[i*3] = Math.cos(angle) * radius;
        positions[i*3+1] = 0;
        positions[i*3+2] = Math.sin(angle) * radius;
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return geometry;
  }, []);

  const ticksMaterial = useMemo(() => new THREE.PointsMaterial({
    color: targetColor,
    size: 0.05,
    transparent: true,
    opacity: 0.6,
    blending: THREE.AdditiveBlending,
  }), []);

  useFrame((_, delta) => {
    if (groupRef.current) {
      // Gentle floating
      groupRef.current.rotation.y += delta * 0.1;
      
      // Audio reactivity scale
      const targetScale = 1.0 + (audioLevel * 0.2);
      groupRef.current.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 0.1);
    }

    // Diverse rotation for rings
    if (ring1Ref.current) {
        ring1Ref.current.rotation.x += delta * 0.2;
        ring1Ref.current.rotation.y += delta * 0.1;
        (ring1Ref.current.material as THREE.MeshBasicMaterial).color.lerp(targetColor, 0.1);
    }
    if (ring2Ref.current) {
        ring2Ref.current.rotation.x -= delta * 0.15;
        ring2Ref.current.rotation.z += delta * 0.1;
        (ring2Ref.current.material as THREE.MeshBasicMaterial).color.lerp(targetColor, 0.1);
    }
    if (ring3Ref.current) {
        ring3Ref.current.rotation.x += delta * 0.3;
        (ring3Ref.current.material as THREE.MeshBasicMaterial).color.lerp(targetColor, 0.1);
    }
    if (ticksRef.current) {
        ticksRef.current.rotation.z -= delta * 0.05;
        (ticksRef.current.material as THREE.PointsMaterial).color.lerp(targetColor, 0.1);
    }
  });

  return (
    <group ref={groupRef}>
      {/* Outer slow ring */}
      <mesh ref={ring1Ref} rotation={[Math.PI / 3, 0, 0]}>
        <torusGeometry args={[2.0, 0.02, 16, 100]} />
        <primitive object={ringMaterial} />
      </mesh>

      {/* Inner fast ring */}
      <mesh ref={ring2Ref} rotation={[-Math.PI / 4, 0, 0]}>
        <torusGeometry args={[1.5, 0.03, 16, 80]} />
        <primitive object={ringMaterial} />
      </mesh>

      {/* Wireframe shell */}
      <mesh ref={ring3Ref}>
        <icosahedronGeometry args={[1.8, 1]} />
        <primitive object={wireframeMaterial} />
      </mesh>

      {/* Data ticks */}
      <points ref={ticksRef} geometry={ticksGeometry}>
        <primitive object={ticksMaterial} />
      </points>
    </group>
  );
};
