/**
 * @fileoverview AtlasOrb - Enhanced 3D Avatar with Three.js
 * Animated glowing orb with particle effects and audio-reactive animations
 */

import React, { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Sphere, MeshDistortMaterial, Float, Stars } from '@react-three/drei';
import * as THREE from 'three';

interface AtlasOrbProps {
    isSpeaking: boolean;
    isProcessing?: boolean;
    audioLevel?: number;
}

// Inner glowing core
const GlowingCore: React.FC<{ isSpeaking: boolean; audioLevel: number }> = ({
    isSpeaking,
    audioLevel
}) => {
    const meshRef = useRef<THREE.Mesh>(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const materialRef = useRef<any>(null);

    useFrame((state) => {
        if (meshRef.current) {
            // Pulsing scale based on audio level and speaking state
            const baseScale = isSpeaking ? 1.1 + audioLevel * 0.3 : 1;
            const pulse = Math.sin(state.clock.elapsedTime * 2) * 0.05 + 1;
            meshRef.current.scale.setScalar(baseScale * pulse);

            // Rotate slowly
            meshRef.current.rotation.y += 0.005;
        }

        if (materialRef.current) {
            // Color intensity based on speaking
            const intensity = isSpeaking ? 1.5 + audioLevel : 1;
            materialRef.current.emissiveIntensity = intensity;
        }
    });

    return (
        <Sphere ref={meshRef} args={[0.8, 64, 64]}>
            <MeshDistortMaterial
                ref={materialRef}
                color="#00ff88"
                emissive="#00ff88"
                emissiveIntensity={1}
                roughness={0.2}
                metalness={0.8}
                distort={isSpeaking ? 0.3 + audioLevel * 0.2 : 0.15}
                speed={isSpeaking ? 4 : 2}
            />
        </Sphere>
    );
};

// Outer energy ring
const EnergyRing: React.FC<{ isSpeaking: boolean }> = ({ isSpeaking }) => {
    const ringRef = useRef<THREE.Mesh>(null);

    useFrame((state) => {
        if (ringRef.current) {
            ringRef.current.rotation.x = Math.sin(state.clock.elapsedTime) * 0.3;
            ringRef.current.rotation.z += isSpeaking ? 0.02 : 0.005;
        }
    });

    return (
        <mesh ref={ringRef}>
            <torusGeometry args={[1.2, 0.02, 16, 100]} />
            <meshBasicMaterial color="#00ff88" transparent opacity={0.6} />
        </mesh>
    );
};

// Particle field around the orb
const ParticleField: React.FC<{ count: number; isSpeaking: boolean }> = ({
    count,
    isSpeaking
}) => {
    const pointsRef = useRef<THREE.Points>(null);

    const particles = useMemo(() => {
        const positions = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const r = 1.5 + Math.random() * 0.5;

            positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
            positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
            positions[i * 3 + 2] = r * Math.cos(phi);
        }
        return positions;
    }, [count]);

    useFrame((state) => {
        if (pointsRef.current) {
            pointsRef.current.rotation.y += isSpeaking ? 0.01 : 0.002;
            pointsRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.5) * 0.1;
        }
    });

    return (
        <points ref={pointsRef}>
            <bufferGeometry>
                <bufferAttribute
                    attach="attributes-position"
                    count={particles.length / 3}
                    array={particles}
                    itemSize={3}
                />
            </bufferGeometry>
            <pointsMaterial
                size={0.03}
                color="#00ff88"
                transparent
                opacity={isSpeaking ? 0.8 : 0.4}
                sizeAttenuation
            />
        </points>
    );
};

// Main orb scene
const OrbScene: React.FC<AtlasOrbProps> = ({
    isSpeaking,
    isProcessing = false,
    audioLevel = 0
}) => {
    return (
        <>
            {/* Ambient lighting */}
            <ambientLight intensity={0.3} />
            <pointLight position={[5, 5, 5]} intensity={1} color="#00ff88" />
            <pointLight position={[-5, -5, -5]} intensity={0.5} color="#0088ff" />

            {/* Background stars */}
            <Stars radius={50} depth={50} count={500} factor={2} fade speed={1} />

            {/* Floating animated group */}
            <Float speed={2} rotationIntensity={0.5} floatIntensity={0.5}>
                <group>
                    {/* Core sphere */}
                    <GlowingCore isSpeaking={isSpeaking} audioLevel={audioLevel} />

                    {/* Energy rings */}
                    <EnergyRing isSpeaking={isSpeaking} />

                    {/* Second ring at angle */}
                    <group rotation={[Math.PI / 4, 0, 0]}>
                        <EnergyRing isSpeaking={isSpeaking} />
                    </group>

                    {/* Particle field */}
                    <ParticleField count={100} isSpeaking={isSpeaking} />
                </group>
            </Float>

            {/* Processing indicator */}
            {isProcessing && (
                <mesh position={[0, -1.5, 0]}>
                    <torusGeometry args={[0.3, 0.02, 16, 50]} />
                    <meshBasicMaterial color="#0088ff" />
                </mesh>
            )}
        </>
    );
};

// Wrapper component with Canvas
export const AtlasOrb: React.FC<AtlasOrbProps> = (props) => {
    return (
        <div style={{ width: '100%', height: '100%', minHeight: '200px' }}>
            <Canvas
                camera={{ position: [0, 0, 4], fov: 50 }}
                gl={{ antialias: true, alpha: true }}
                style={{ background: 'transparent' }}
            >
                <OrbScene {...props} />
            </Canvas>
        </div>
    );
};

export default AtlasOrb;
