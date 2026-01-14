/**
 * Nova Desktop - Debug Overlay Component
 * Shows FPS, memory, and performance metrics in dev mode
 */

import { usePerformanceMonitor, getPerformanceRating } from '../hooks';

interface DebugOverlayProps {
  visible?: boolean;
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  particleCount?: number;
}

/**
 * Debug overlay showing real-time performance metrics
 */
export function DebugOverlay({
  visible = true,
  position = 'top-right',
  particleCount = 0,
}: DebugOverlayProps) {
  const metrics = usePerformanceMonitor({ enabled: visible });

  if (!visible) return null;

  const rating = getPerformanceRating(metrics.fps);
  const ratingColors = {
    excellent: '#4ade80', // green
    good: '#a3e635', // lime
    fair: '#facc15', // yellow
    poor: '#f87171', // red
  };

  const positionStyles: Record<string, React.CSSProperties> = {
    'top-left': { top: 10, left: 10 },
    'top-right': { top: 10, right: 10 },
    'bottom-left': { bottom: 10, left: 10 },
    'bottom-right': { bottom: 10, right: 10 },
  };

  return (
    <div
      className="debug-overlay"
      style={{
        position: 'fixed',
        ...positionStyles[position],
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        color: '#fff',
        padding: '8px 12px',
        borderRadius: '6px',
        fontFamily: 'monospace',
        fontSize: '11px',
        zIndex: 9999,
        minWidth: '140px',
        backdropFilter: 'blur(4px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
      }}
    >
      <div style={{ marginBottom: '4px', fontWeight: 'bold', opacity: 0.7 }}>DEBUG</div>

      {/* FPS */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
        <span>FPS:</span>
        <span style={{ color: ratingColors[rating], fontWeight: 'bold' }}>{metrics.fps}</span>
      </div>

      {/* Average FPS */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
        <span>Avg FPS:</span>
        <span>{metrics.avgFps}</span>
      </div>

      {/* Frame Time */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
        <span>Frame:</span>
        <span>{metrics.frameTime.toFixed(1)}ms</span>
      </div>

      {/* Memory (if available) */}
      {metrics.memoryUsage > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
          <span>Memory:</span>
          <span>{metrics.memoryUsage}MB</span>
        </div>
      )}

      {/* Particle Count */}
      {particleCount > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
          <span>Particles:</span>
          <span>{particleCount.toLocaleString()}</span>
        </div>
      )}

      {/* Performance Rating */}
      <div
        style={{
          marginTop: '4px',
          paddingTop: '4px',
          borderTop: '1px solid rgba(255,255,255,0.2)',
          textTransform: 'uppercase',
          fontSize: '10px',
          color: ratingColors[rating],
        }}
      >
        {rating}
      </div>
    </div>
  );
}

export default DebugOverlay;
