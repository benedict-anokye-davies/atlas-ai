/**
 * StatusBadge - Animated status indicator badges
 */
import React from 'react';
import { motion } from 'framer-motion';
import './StatusBadge.css';

type BadgeStatus = 'online' | 'offline' | 'degraded' | 'pending' | 'error' | 'success';

interface StatusBadgeProps {
  status: BadgeStatus;
  label?: string;
  pulse?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const STATUS_CONFIG: Record<BadgeStatus, { color: string; label: string }> = {
  online: { color: 'var(--atlas-accent-green)', label: 'Online' },
  offline: { color: 'var(--atlas-text-muted)', label: 'Offline' },
  degraded: { color: 'var(--atlas-accent-yellow)', label: 'Degraded' },
  pending: { color: 'var(--atlas-accent-cyan)', label: 'Pending' },
  error: { color: 'var(--atlas-accent-red)', label: 'Error' },
  success: { color: 'var(--atlas-accent-green)', label: 'Success' },
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  label,
  pulse = true,
  size = 'md',
  className = '',
}) => {
  const config = STATUS_CONFIG[status];
  const displayLabel = label ?? config.label;
  const shouldPulse = pulse && ['online', 'pending'].includes(status);

  return (
    <div className={`status-badge status-badge--${size} status-badge--${status} ${className}`}>
      <span 
        className="status-badge__dot"
        style={{ backgroundColor: config.color }}
      >
        {shouldPulse && (
          <motion.span
            className="status-badge__pulse"
            style={{ backgroundColor: config.color }}
            animate={{ scale: [1, 2], opacity: [0.6, 0] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: 'easeOut' }}
          />
        )}
      </span>
      {displayLabel && <span className="status-badge__label">{displayLabel}</span>}
    </div>
  );
};

export default StatusBadge;
