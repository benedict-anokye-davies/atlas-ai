/**
 * MiniChart - Compact sparkline/chart component
 * For inline metrics visualization
 */
import React, { useEffect, useRef } from 'react';
import './MiniChart.css';

interface MiniChartProps {
  data: number[];
  width?: number;
  height?: number;
  type?: 'line' | 'bar' | 'area';
  color?: string;
  gradientColor?: string;
  showDots?: boolean;
  animated?: boolean;
  className?: string;
}

export const MiniChart: React.FC<MiniChartProps> = ({
  data,
  width = 120,
  height = 40,
  type = 'area',
  color = '#00D4FF',
  gradientColor,
  showDots = false,
  animated = true,
  className = '',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.length < 2) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const padding = 4;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;

    const getX = (i: number) => padding + (i / (data.length - 1)) * chartWidth;
    const getY = (val: number) => padding + chartHeight - ((val - min) / range) * chartHeight;

    let progress = animated ? 0 : 1;
    const startTime = performance.now();
    const duration = 800;

    const draw = (timestamp: number) => {
      if (animated) {
        progress = Math.min((timestamp - startTime) / duration, 1);
        // Easing
        progress = 1 - Math.pow(1 - progress, 3);
      }

      ctx.clearRect(0, 0, width, height);

      if (type === 'bar') {
        // Bar chart
        const barWidth = Math.max(2, (chartWidth / data.length) - 2);
        data.forEach((val, i) => {
          const x = getX(i) - barWidth / 2;
          const barHeight = ((val - min) / range) * chartHeight * progress;
          const y = padding + chartHeight - barHeight;
          
          ctx.fillStyle = color;
          ctx.globalAlpha = 0.8;
          ctx.fillRect(x, y, barWidth, barHeight);
        });
        ctx.globalAlpha = 1;
      } else {
        // Line or area chart
        ctx.beginPath();
        ctx.moveTo(getX(0), getY(data[0]) + (chartHeight * (1 - progress)));

        for (let i = 1; i < data.length; i++) {
          const x = getX(i);
          const y = getY(data[i]) + (chartHeight * (1 - progress) * (1 - i / data.length));
          ctx.lineTo(x, y);
        }

        if (type === 'area') {
          // Create gradient fill
          const gradient = ctx.createLinearGradient(0, 0, 0, height);
          gradient.addColorStop(0, gradientColor || `${color}40`);
          gradient.addColorStop(1, 'transparent');

          // Close path for fill
          ctx.lineTo(getX(data.length - 1), height);
          ctx.lineTo(getX(0), height);
          ctx.closePath();
          ctx.fillStyle = gradient;
          ctx.fill();

          // Redraw line on top
          ctx.beginPath();
          ctx.moveTo(getX(0), getY(data[0]) + (chartHeight * (1 - progress)));
          for (let i = 1; i < data.length; i++) {
            const x = getX(i);
            const y = getY(data[i]) + (chartHeight * (1 - progress) * (1 - i / data.length));
            ctx.lineTo(x, y);
          }
        }

        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();

        // Draw dots
        if (showDots && progress === 1) {
          data.forEach((val, i) => {
            ctx.beginPath();
            ctx.arc(getX(i), getY(val), 3, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
          });

          // Highlight last point
          const lastX = getX(data.length - 1);
          const lastY = getY(data[data.length - 1]);
          
          ctx.beginPath();
          ctx.arc(lastX, lastY, 5, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
          
          // Glow effect
          ctx.beginPath();
          ctx.arc(lastX, lastY, 8, 0, Math.PI * 2);
          ctx.fillStyle = `${color}30`;
          ctx.fill();
        }
      }

      if (progress < 1 && animated) {
        animationRef.current = requestAnimationFrame(draw);
      }
    };

    animationRef.current = requestAnimationFrame(draw);

    return () => cancelAnimationFrame(animationRef.current);
  }, [data, width, height, type, color, gradientColor, showDots, animated]);

  // Determine if trending up or down
  const isUp = data.length > 1 && data[data.length - 1] >= data[0];

  return (
    <div className={`mini-chart ${className}`} data-trend={isUp ? 'up' : 'down'}>
      <canvas
        ref={canvasRef}
        style={{ width, height }}
        className="mini-chart__canvas"
      />
    </div>
  );
};

export default MiniChart;
