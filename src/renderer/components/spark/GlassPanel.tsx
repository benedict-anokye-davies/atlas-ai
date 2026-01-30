/**
 * @fileoverview GlassPanel Component - Spark UI
 * @module spark/GlassPanel
 * Glassmorphism panel with glow effects
 */

import React from 'react';
import './spark-styles.css';
import styles from './GlassPanel.module.css';

interface GlassPanelProps {
  children: React.ReactNode;
  className?: string;
  glow?: boolean;
  glowColor?: 'green' | 'cyan' | 'purple';
  padding?: 'none' | 'sm' | 'md' | 'lg';
  border?: boolean;
}

export const GlassPanel: React.FC<GlassPanelProps> = ({
  children,
  className = '',
  glow = false,
  glowColor = 'green',
  padding = 'md',
  border = true,
}) => {
  const glowClass = glow
    ? styles[`glow${glowColor.charAt(0).toUpperCase() + glowColor.slice(1)}`]
    : '';
  const paddingClass = styles[`padding${padding.charAt(0).toUpperCase() + padding.slice(1)}`];

  return (
    <div
      className={`${styles.glassPanel} ${glowClass} ${paddingClass} ${border ? styles.withBorder : ''} ${className}`}
    >
      {children}
    </div>
  );
};
