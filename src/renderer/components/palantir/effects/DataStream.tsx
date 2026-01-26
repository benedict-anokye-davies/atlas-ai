/**
 * DataStream - Matrix-style data rain background effect
 * Creates falling characters for that cyberpunk aesthetic
 */
import React, { useEffect, useRef } from 'react';
import './DataStream.css';

interface DataStreamProps {
  opacity?: number;
  speed?: number;
  density?: number;
  className?: string;
  color?: string;
}

const STREAM_CHARS = '01アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン';

export const DataStream: React.FC<DataStreamProps> = ({
  opacity = 0.15,
  speed = 1,
  density = 0.03,
  className = '',
  color = '#00D4FF',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resizeCanvas = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const fontSize = 14;
    const columns = Math.floor(canvas.width / fontSize);
    const drops: number[] = new Array(columns).fill(1);

    // Randomly offset initial positions
    for (let i = 0; i < drops.length; i++) {
      drops[i] = Math.random() * -100;
    }

    const draw = () => {
      // Semi-transparent black to create trail effect
      ctx.fillStyle = `rgba(5, 8, 10, ${0.05 * speed})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = color;
      ctx.font = `${fontSize}px "JetBrains Mono", monospace`;

      for (let i = 0; i < drops.length; i++) {
        // Random character
        const char = STREAM_CHARS[Math.floor(Math.random() * STREAM_CHARS.length)];
        
        // Draw character
        const x = i * fontSize;
        const y = drops[i] * fontSize;
        
        // Vary brightness
        const brightness = Math.random();
        ctx.globalAlpha = brightness * opacity;
        ctx.fillText(char, x, y);

        // Reset drop when it goes off screen
        if (drops[i] * fontSize > canvas.height && Math.random() > (1 - density)) {
          drops[i] = 0;
        }

        drops[i] += speed * (0.5 + Math.random() * 0.5);
      }

      ctx.globalAlpha = 1;
      animationRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      cancelAnimationFrame(animationRef.current);
    };
  }, [opacity, speed, density, color]);

  return (
    <canvas
      ref={canvasRef}
      className={`data-stream ${className}`}
      aria-hidden="true"
    />
  );
};

export default DataStream;
