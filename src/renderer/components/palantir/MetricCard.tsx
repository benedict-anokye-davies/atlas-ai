/**
 * Atlas Desktop - Metric Card Widget
 * Enhanced metric display with optional sparkline and animations
 */
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MiniChart } from './MiniChart';
import './MetricCard.css';

export interface MetricCardProps {
  label: string;
  value: string | number;
  change?: number;
  changeLabel?: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  variant?: 'default' | 'compact' | 'hero';
  sparklineData?: number[];
  accentColor?: 'cyan' | 'green' | 'amber' | 'red';
  prefix?: string;
  suffix?: string;
  animated?: boolean;
}

// Animate number counting up
const AnimatedValue: React.FC<{ value: string | number; prefix?: string; suffix?: string }> = ({
  value,
  prefix = '',
  suffix = ''
}) => {
  const [displayValue, setDisplayValue] = useState(value);

  useEffect(() => {
    if (typeof value === 'number') {
      const duration = 1000;
      const steps = 30;
      const stepDuration = duration / steps;
      const increment = (value - (typeof displayValue === 'number' ? displayValue : 0)) / steps;

      let current = typeof displayValue === 'number' ? displayValue : 0;
      let step = 0;

      const timer = setInterval(() => {
        step++;
        current += increment;
        if (step >= steps) {
          setDisplayValue(value);
          clearInterval(timer);
        } else {
          setDisplayValue(Math.round(current * 100) / 100);
        }
      }, stepDuration);

      return () => clearInterval(timer);
    } else {
      setDisplayValue(value);
      return undefined;
    }
  }, [value]);

  return (
    <span className="metric-card__value-text">
      {prefix}
      {typeof displayValue === 'number' ? displayValue.toLocaleString() : displayValue}
      {suffix}
    </span>
  );
};

export const MetricCard: React.FC<MetricCardProps> = ({
  label,
  value,
  change,
  changeLabel,
  icon,
  onClick,
  variant = 'default',
  sparklineData,
  accentColor = 'cyan',
  prefix,
  suffix,
  animated = true,
}) => {
  const isPositive = change !== undefined && change >= 0;
  const colorVar = `var(--atlas-${accentColor === 'cyan' ? 'cyan' : accentColor === 'green' ? 'green' : `accent-${accentColor}`})`;

  return (
    <motion.div
      className={`metric-card metric-card--${variant} metric-card--${accentColor}`}
      onClick={onClick}
      whileHover={onClick ? { scale: 1.02, y: -2 } : { y: -1 }}
      whileTap={onClick ? { scale: 0.98 } : undefined}
      style={{ cursor: onClick ? 'pointer' : 'default' }}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Accent glow bar */}
      <div
        className="metric-card__accent-bar"
        style={{ background: colorVar }}
      />

      {/* Animated gradient border on hover */}
      <div className="metric-card__border-glow" />

      <div className="metric-card__header">

        <span className="metric-card__label">{label}</span>
        {icon && <span className="metric-card__icon">{icon}</span>}
      </div>

      <div className="metric-card__value">
        {animated ? (
          <AnimatedValue value={value} prefix={prefix} suffix={suffix} />
        ) : (
          <span className="metric-card__value-text">
            {prefix}{typeof value === 'number' ? value.toLocaleString() : value}{suffix}
          </span>
        )}
      </div>

      {/* Sparkline Chart */}
      {sparklineData && sparklineData.length > 0 && (
        <div className="metric-card__sparkline">
          <MiniChart
            data={sparklineData}
            type="area"
            color={colorVar}
            height={40}
          />
        </div>
      )}

      {(change !== undefined || changeLabel) && (
        <div className="metric-card__footer">
          <AnimatePresence mode="wait">
            {change !== undefined && (
              <motion.span
                key={change}
                className={`metric-card__change ${isPositive ? 'positive' : 'negative'}`}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
              >
                <span className="metric-card__change-arrow">
                  {isPositive ? '↑' : '↓'}
                </span>
                {Math.abs(change).toFixed(1)}%
              </motion.span>
            )}
          </AnimatePresence>
          {changeLabel && (
            <span className="metric-card__change-label">{changeLabel}</span>
          )}
        </div>
      )}

      {/* Hover gradient overlay */}
      <div className="metric-card__hover-glow" style={{ background: colorVar }} />
    </motion.div>
  );
};

export default MetricCard;
