/**
 * TypewriterText - Terminal-style typing effect
 * Text appears character by character with optional cursor
 */
import React, { useState, useEffect, useRef } from 'react';
import './TypewriterText.css';

interface TypewriterTextProps {
  text: string;
  speed?: number; // ms per character
  delay?: number; // initial delay before typing
  cursor?: boolean;
  cursorChar?: string;
  onComplete?: () => void;
  className?: string;
  tag?: 'span' | 'div' | 'p';
}

export const TypewriterText: React.FC<TypewriterTextProps> = ({
  text,
  speed = 40,
  delay = 0,
  cursor = true,
  cursorChar = '█',
  onComplete,
  className = '',
  tag: Tag = 'span',
}) => {
  const [displayedText, setDisplayedText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [showCursor, setShowCursor] = useState(true);
  const indexRef = useRef(0);

  useEffect(() => {
    indexRef.current = 0;
    setDisplayedText('');
    setIsTyping(false);

    const delayTimer = setTimeout(() => {
      setIsTyping(true);
    }, delay);

    return () => clearTimeout(delayTimer);
  }, [text, delay]);

  useEffect(() => {
    if (!isTyping) return undefined;

    if (indexRef.current < text.length) {
      const timer = setTimeout(() => {
        setDisplayedText(text.slice(0, indexRef.current + 1));
        indexRef.current += 1;
      }, speed);

      return () => clearTimeout(timer);
    } else {
      setIsTyping(false);
      onComplete?.();
      return undefined;
    }
  }, [isTyping, displayedText, text, speed, onComplete]);

  // Cursor blink
  useEffect(() => {
    if (!cursor) return undefined;
    
    const blinkInterval = setInterval(() => {
      setShowCursor(prev => !prev);
    }, 530);

    return () => clearInterval(blinkInterval);
  }, [cursor]);

  return (
    <Tag className={`typewriter-text ${className}`}>
      {displayedText}
      {cursor && (
        <span className={`typewriter-cursor ${showCursor ? 'visible' : ''}`}>
          {cursorChar}
        </span>
      )}
    </Tag>
  );
};

export default TypewriterText;
