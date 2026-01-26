/**
 * Atlas Desktop - System Health Widget
 * Shows status of all Atlas services
 */
import React from 'react';
import { motion } from 'framer-motion';
import './SystemHealth.css';

export type ServiceStatus = 'online' | 'offline' | 'degraded' | 'connecting';

export interface ServiceInfo {
  id: string;
  name: string;
  status: ServiceStatus;
  latency?: number; // ms
  details?: string;
}

export interface SystemHealthProps {
  services: ServiceInfo[];
  onServiceClick?: (service: ServiceInfo) => void;
}

const STATUS_CONFIG: Record<ServiceStatus, { color: string; label: string; icon: string }> = {
  online: { color: 'var(--atlas-accent-green)', label: 'Online', icon: '●' },
  offline: { color: 'var(--atlas-accent-red)', label: 'Offline', icon: '●' },
  degraded: { color: 'var(--atlas-accent-yellow)', label: 'Degraded', icon: '●' },
  connecting: { color: 'var(--atlas-text-muted)', label: 'Connecting', icon: '○' },
};

export const SystemHealth: React.FC<SystemHealthProps> = ({
  services,
  onServiceClick,
}) => {
  const onlineCount = services.filter(s => s.status === 'online').length;
  const allOnline = onlineCount === services.length;

  return (
    <div className="system-health">
      <div className="system-health__header">
        <h3 className="system-health__title">System Health</h3>
        <span className={`system-health__summary ${allOnline ? 'online' : 'issues'}`}>
          {allOnline ? '● All Online' : `${onlineCount}/${services.length} Online`}
        </span>
      </div>

      <div className="system-health__services">
        {services.map((service, index) => {
          const config = STATUS_CONFIG[service.status];
          return (
            <motion.div
              key={service.id}
              className="system-health__service"
              onClick={() => onServiceClick?.(service)}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.05 }}
              whileHover={{ backgroundColor: 'var(--atlas-bg-hover)' }}
            >
              <span 
                className="system-health__status-dot"
                style={{ color: config.color }}
              >
                {config.icon}
              </span>
              <span className="system-health__service-name">{service.name}</span>
              {service.latency !== undefined && (
                <span className="system-health__latency">{service.latency}ms</span>
              )}
              <span 
                className="system-health__status-label"
                style={{ color: config.color }}
              >
                {config.label}
              </span>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};

export default SystemHealth;
