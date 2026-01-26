/**
 * GlitchText - Cyberpunk text effect component
 * Creates a glitchy, scrambling text effect on hover or state change
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import './GlitchText.css';

interface GlitchTextProps {
  text: string;
  className?: string;
  scrambleOnHover?: boolean;
  scrambleOnMount?: boolean;
  scrambleDuration?: number; // ms
  glitchIntensity?: 'low' | 'medium' | 'high';
  tag?: 'span' | 'div' | 'h1' | 'h2' | 'h3' | 'p';
}

const GLITCH_CHARS = '!@#$%^&*()_+-=[]{}|;:,.<>?/\\~`01';

export const GlitchText: React.FC<GlitchTextProps> = ({
  text,
  className = '',
  scrambleOnHover = true,
  scrambleOnMount = false,
  scrambleDuration = 600,
  glitchIntensity = 'medium',
  tag: Tag = 'span',
}) => {
  const [displayText, setDisplayText] = useState(text);
  const [isGlitching, setIsGlitching] = useState(false);
  const animationRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);

  const scramble = useCallback(() => {
    if (isGlitching) return;
    
    setIsGlitching(true);
    startTimeRef.current = performance.now();

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTimeRef.current;
      const progress = Math.min(elapsed / scrambleDuration, 1);

      // Characters that should be revealed
      const revealedCount = Math.floor(progress * text.length);
      
      let newText = '';
      for (let i = 0; i < text.length; i++) {
        if (i < revealedCount) {
          newText += text[i];
        } else if (text[i] === ' ') {
          newText += ' ';
        } else {
          newText += GLITCH_CHARS[Math.floor(Math.random() * GLITCH_CHARS.length)];
        }
      }
      
      setDisplayText(newText);

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        setDisplayText(text);
        setIsGlitching(false);
      }
    };

    animationRef.current = requestAnimationFrame(animate);
  }, [text, scrambleDuration, isGlitching]);

  useEffect(() => {
    if (scrambleOnMount) {
      scramble();
    }
    return () => cancelAnimationFrame(animationRef.current);
  }, []);

  useEffect(() => {
    setDisplayText(text);
  }, [text]);

  const intensityClass = `glitch-intensity-${glitchIntensity}`;

  return (
    <Tag
      className={`glitch-text ${intensityClass} ${isGlitching ? 'glitching' : ''} ${className}`}
      onMouseEnter={scrambleOnHover ? scramble : undefined}
      data-text={text}
    >
      {displayText}
    </Tag>
  );
};

export default GlitchText;
