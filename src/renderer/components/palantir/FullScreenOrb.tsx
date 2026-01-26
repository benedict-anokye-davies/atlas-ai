/**
 * Atlas Desktop - Full Screen Orb Experience
 * Immersive voice interface with waveform, transcript, and suggestions
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import './FullScreenOrb.css';

export type OrbState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';

export interface TranscriptEntry {
  id: string;
  type: 'user' | 'atlas';
  text: string;
  timestamp: number;
}

export interface SuggestedCommand {
  id: string;
  icon: string;
  label: string;
  command: string;
}

export interface FullScreenOrbProps {
  isOpen: boolean;
  state?: OrbState;
  audioLevel?: number;
  transcript?: TranscriptEntry[];
  suggestedCommands?: SuggestedCommand[];
  onClose: () => void;
  onCommandClick?: (command: string) => void;
  onTextSubmit?: (text: string) => void;
}

const DEFAULT_SUGGESTIONS: SuggestedCommand[] = [
  { id: '1', icon: '📊', label: 'Show portfolio', command: 'Show my portfolio summary' },
  { id: '2', icon: '💰', label: 'Check balance', command: 'What is my bank balance?' },
  { id: '3', icon: '📈', label: 'Market update', command: 'Give me a market update' },
  { id: '4', icon: '📅', label: 'Today\'s tasks', command: 'What are my tasks for today?' },
  { id: '5', icon: '🔍', label: 'Search code', command: 'Search my codebase for...' },
  { id: '6', icon: '📰', label: 'Tech news', command: 'What\'s trending on HackerNews?' },
];

const STATE_COLORS: Record<OrbState, string[]> = {
  idle: ['#00D4FF', '#0088AA', '#004455'],
  listening: ['#00FF88', '#00D4FF', '#0088AA'],
  thinking: ['#9B59B6', '#00D4FF', '#3498DB'],
  speaking: ['#00D4FF', '#00FF88', '#00D4FF'],
  error: ['#FF4757', '#FF6B7A', '#FF4757'],
};

export const FullScreenOrb: React.FC<FullScreenOrbProps> = ({
  isOpen,
  state = 'idle',
  audioLevel = 0,
  transcript = [],
  suggestedCommands = DEFAULT_SUGGESTIONS,
  onClose,
  onCommandClick,
  onTextSubmit,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const waveformRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const [inputValue, setInputValue] = useState('');

  const colors = STATE_COLORS[state];

  // Main orb animation
  useEffect(() => {
    if (!isOpen) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const size = Math.min(canvas.clientWidth, canvas.clientHeight);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    let time = 0;

    const animate = () => {
      time += 0.016;
      ctx.clearRect(0, 0, size, size);

      const centerX = size / 2;
      const centerY = size / 2;
      const baseRadius = size * 0.3;
      
      const audioBoost = 1 + audioLevel * 0.2;
      const breathe = Math.sin(time * 2) * 0.05 + 1;
      const radius = baseRadius * breathe * audioBoost;

      // Outer glow layers
      for (let i = 3; i > 0; i--) {
        const glowRadius = radius * (1.5 + i * 0.3);
        const glowGradient = ctx.createRadialGradient(
          centerX, centerY, radius,
          centerX, centerY, glowRadius
        );
        glowGradient.addColorStop(0, `${colors[0]}${Math.floor(40 / i).toString(16).padStart(2, '0')}`);
        glowGradient.addColorStop(1, 'transparent');
        
        ctx.beginPath();
        ctx.arc(centerX, centerY, glowRadius, 0, Math.PI * 2);
        ctx.fillStyle = glowGradient;
        ctx.fill();
      }

      // Main orb with gradient
      const orbGradient = ctx.createRadialGradient(
        centerX - radius * 0.3, centerY - radius * 0.3, 0,
        centerX, centerY, radius
      );
      orbGradient.addColorStop(0, colors[0]);
      orbGradient.addColorStop(0.6, colors[1]);
      orbGradient.addColorStop(1, colors[2]);

      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.fillStyle = orbGradient;
      ctx.fill();

      // Glossy highlight
      const highlightGradient = ctx.createRadialGradient(
        centerX - radius * 0.3, centerY - radius * 0.4, 0,
        centerX - radius * 0.3, centerY - radius * 0.4, radius * 0.7
      );
      highlightGradient.addColorStop(0, 'rgba(255, 255, 255, 0.5)');
      highlightGradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.1)');
      highlightGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
      
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.fillStyle = highlightGradient;
      ctx.fill();

      // Animated rings for active states
      if (state === 'listening' || state === 'thinking' || state === 'speaking') {
        const ringCount = state === 'speaking' ? 4 : 2;
        for (let i = 0; i < ringCount; i++) {
          const ringTime = (time * 1.5 + i * 0.4) % 1;
          const ringRadius = radius + 15 + ringTime * 60;
          const ringAlpha = (1 - ringTime) * 0.6;
          
          ctx.beginPath();
          ctx.arc(centerX, centerY, ringRadius, 0, Math.PI * 2);
          ctx.strokeStyle = `${colors[0]}${Math.floor(ringAlpha * 255).toString(16).padStart(2, '0')}`;
          ctx.lineWidth = 3 - ringTime * 2;
          ctx.stroke();
        }
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      cancelAnimationFrame(animationRef.current);
    };
  }, [isOpen, state, audioLevel, colors]);

  // Waveform visualization
  useEffect(() => {
    if (!isOpen || state !== 'listening') return;

    const canvas = waveformRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    ctx.scale(dpr, dpr);

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    let time = 0;

    const animateWaveform = () => {
      time += 0.05;
      ctx.clearRect(0, 0, width, height);

      const barCount = 40;
      const barWidth = width / barCount * 0.6;
      const gap = width / barCount * 0.4;

      ctx.fillStyle = colors[0];

      for (let i = 0; i < barCount; i++) {
        const x = i * (barWidth + gap) + gap / 2;
        
        // Create wave pattern
        const wave1 = Math.sin(time + i * 0.3) * 0.3;
        const wave2 = Math.sin(time * 1.5 + i * 0.2) * 0.2;
        const audioEffect = audioLevel * Math.sin(time * 2 + i * 0.5);
        
        const barHeight = Math.max(4, (0.3 + wave1 + wave2 + audioEffect) * height * 0.8);
        const y = (height - barHeight) / 2;

        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, 2);
        ctx.fill();
      }

      requestAnimationFrame(animateWaveform);
    };

    const waveformAnim = requestAnimationFrame(animateWaveform);

    return () => cancelAnimationFrame(waveformAnim);
  }, [isOpen, state, audioLevel, colors]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (inputValue.trim() && onTextSubmit) {
      onTextSubmit(inputValue.trim());
      setInputValue('');
    }
  }, [inputValue, onTextSubmit]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  }, [onClose]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [isOpen]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fullscreen-orb"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onKeyDown={handleKeyDown}
        >
          {/* Background */}
          <div className="fullscreen-orb__backdrop" onClick={onClose} />

          {/* Close Button */}
          <motion.button
            className="fullscreen-orb__close"
            onClick={onClose}
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <span>Exit Focus</span>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </motion.button>

          {/* Main Content */}
          <div className="fullscreen-orb__content">
            {/* Orb */}
            <motion.div
              className="fullscreen-orb__orb-container"
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.1, type: 'spring', stiffness: 200 }}
            >
              <canvas ref={canvasRef} className="fullscreen-orb__canvas" />
            </motion.div>

            {/* Waveform (only when listening) */}
            <AnimatePresence>
              {state === 'listening' && (
                <motion.div
                  className="fullscreen-orb__waveform"
                  initial={{ opacity: 0, scaleY: 0 }}
                  animate={{ opacity: 1, scaleY: 1 }}
                  exit={{ opacity: 0, scaleY: 0 }}
                >
                  <canvas ref={waveformRef} className="fullscreen-orb__waveform-canvas" />
                </motion.div>
              )}
            </AnimatePresence>

            {/* Status Text */}
            <motion.p
              className="fullscreen-orb__status"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
            >
              {state === 'idle' && 'How can I help?'}
              {state === 'listening' && 'Listening...'}
              {state === 'thinking' && 'Thinking...'}
              {state === 'speaking' && 'Speaking...'}
              {state === 'error' && 'Something went wrong'}
            </motion.p>

            {/* Input Field */}
            <motion.form
              className="fullscreen-orb__input-container"
              onSubmit={handleSubmit}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
            >
              <input
                ref={inputRef}
                type="text"
                className="fullscreen-orb__input"
                placeholder="Type or speak your command..."
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
              />
              <button type="submit" className="fullscreen-orb__submit" disabled={!inputValue.trim()}>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M2 10l7-7v4h9v6h-9v4L2 10z" />
                </svg>
              </button>
            </motion.form>

            {/* Suggested Commands */}
            <motion.div
              className="fullscreen-orb__suggestions"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
            >
              <p className="fullscreen-orb__suggestions-label">Suggested commands</p>
              <div className="fullscreen-orb__suggestions-grid">
                {suggestedCommands.slice(0, 6).map((cmd, index) => (
                  <motion.button
                    key={cmd.id}
                    className="fullscreen-orb__suggestion"
                    onClick={() => onCommandClick?.(cmd.command)}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.5 + index * 0.05 }}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <span className="fullscreen-orb__suggestion-icon">{cmd.icon}</span>
                    <span className="fullscreen-orb__suggestion-label">{cmd.label}</span>
                  </motion.button>
                ))}
              </div>
            </motion.div>

            {/* Live Transcript */}
            {transcript.length > 0 && (
              <motion.div
                className="fullscreen-orb__transcript"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.6 }}
              >
                <p className="fullscreen-orb__transcript-label">Conversation</p>
                <div className="fullscreen-orb__transcript-list">
                  {transcript.slice(-5).map((entry) => (
                    <div
                      key={entry.id}
                      className={`fullscreen-orb__transcript-entry fullscreen-orb__transcript-entry--${entry.type}`}
                    >
                      <span className="fullscreen-orb__transcript-role">
                        {entry.type === 'user' ? 'You' : 'Atlas'}
                      </span>
                      <span className="fullscreen-orb__transcript-text">{entry.text}</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default FullScreenOrb;
