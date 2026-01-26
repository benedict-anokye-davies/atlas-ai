/**
 * ScanLine - CRT monitor scanline effect
 * Creates that retro monitor feel
 */
import React from 'react';
import './ScanLine.css';

interface ScanLineProps {
  animate?: boolean;
  intensity?: 'subtle' | 'medium' | 'heavy';
  className?: string;
}

export const ScanLine: React.FC<ScanLineProps> = ({
  animate = true,
  intensity = 'subtle',
  className = '',
}) => {
  return (
    <div 
      className={`scanline scanline--${intensity} ${animate ? 'scanline--animate' : ''} ${className}`}
      aria-hidden="true"
    />
  );
};

export default ScanLine;
