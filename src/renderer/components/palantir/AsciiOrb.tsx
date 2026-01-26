import React, { useEffect, useRef } from 'react';
import './AsciiOrb.css';

export type AsciiOrbState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';

interface AsciiOrbProps {
  state: AsciiOrbState;
  audioLevel?: number; // 0 to 1
  size?: number; // width/height in px (approx)
}

/**
 * AsciiOrb - A retro-futuristic ASCII visualization of Atlas
 * Renders a rotating 3D sphere/brain using characters
 */
export const AsciiOrb: React.FC<AsciiOrbProps> = ({ state, audioLevel = 0, size = 300 }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Config
    const charSize = 12; // px
    const cols = Math.floor(size / charSize);
    const rows = Math.floor(size / charSize);
    const chars = ' .:-=+*#%@'; // Density gradient
    
    let time = 0;
    let animationFrameId: number;
    
    const render = () => {
      // Clear
      ctx.fillStyle = '#05080a'; // Background match
      ctx.fillRect(0, 0, size, size);
      
      ctx.font = `${charSize}px "JetBrains Mono", monospace`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      
      // Animation speed based on state
      let speed = 0.02;
      let noiseScale = 1.0;
      let color = '#00D4FF'; // Default Blue
      
      switch (state) {
        case 'listening':
          speed = 0.05;
          noiseScale = 1.2 + (audioLevel * 2);
          color = '#00FF88'; // Green
          break;
        case 'thinking':
          speed = 0.1;
          noiseScale = 2.0;
          color = '#9B59B6'; // Purple
          break;
        case 'speaking':
          speed = 0.04;
          noiseScale = 1.0 + (audioLevel * 3);
          color = '#00D4FF'; // Blue
          break;
        case 'error':
          color = '#FF4444'; // Red
          break;
      }
      
      time += speed;
      
      // Render Grid
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          // Normalize coordinates -1 to 1
          const u = (x / cols) * 2 - 1;
          const v = (y / rows) * 2 - 1;
          
          // Sphere formula with animated deformation
          const r = Math.sqrt(u*u + v*v);
          
          if (r < 0.8) {
            // 3D effect: z is depth
            const z = Math.sqrt(1 - r*r);
            
            // Rotate
            // Simple rotation around Y axis
            const rotX = u * Math.cos(time) + z * Math.sin(time);
            const rotZ = z * Math.cos(time) - u * Math.sin(time);
            
            // Noise/Texture function
            // Combine rotation with state-based disturbance
            const val = Math.sin(rotX * 5 + time) * Math.cos(v * 5 + time * 0.5) 
                      + Math.sin(rotZ * 3) * noiseScale;
            
            // Map -1..1 to 0..1
            const normVal = (val + 2) / 4; 
            
            // Pick character based on "brightness" + audio reactivity at edges
            let charIndex = Math.floor(normVal * chars.length);
            
            // Audio reactivity pulse from center
            if (state === 'speaking' || state === 'listening') {
              const pulse = Math.sin(r * 10 - time * 10) * audioLevel;
              if (pulse > 0.5) charIndex += 2;
            }
            
            charIndex = Math.max(0, Math.min(chars.length - 1, charIndex));
            
            const char = chars[charIndex];
            
            // Color with depth fading
            ctx.fillStyle = color;
            ctx.globalAlpha = 0.5 + (z * 0.5); // Fade edges
            
            ctx.fillText(char, x * charSize + charSize/2, y * charSize + charSize/2);
          }
        }
      }
      
      ctx.globalAlpha = 1.0;
      animationFrameId = requestAnimationFrame(render);
    };
    
    render();
    
    return () => cancelAnimationFrame(animationFrameId);
  }, [state, audioLevel, size]);

  return (
    <div className="pt-ascii-orb-container">
      <canvas 
        ref={canvasRef} 
        width={size} 
        height={size} 
        className="pt-ascii-canvas"
      />
      <div className="pt-ascii-overlay">
         <div className="pt-ascii-label">
            [{state.toUpperCase()}]
         </div>
      </div>
    </div>
  );
};
