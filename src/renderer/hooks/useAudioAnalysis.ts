/**
 * Nova Desktop - Audio Analysis Hook
 * Real-time audio frequency analysis using Web Audio API
 * Extracts amplitude, bass, treble, and generates rhythmic pulse for orb visualization
 */

import { useEffect, useRef, useState } from 'react';

export interface AudioFeatures {
  amplitude: number; // Overall volume (0-1)
  bass: number; // Low frequency energy (0-1)
  treble: number; // High frequency energy (0-1)
  pulse: number; // Rhythmic pulse value (0-1)
}

interface UseAudioAnalysisOptions {
  fftSize?: number; // FFT size for frequency analysis (default: 256)
  smoothingTimeConstant?: number; // Smoothing (default: 0.8)
  enabled?: boolean; // Enable/disable analysis (default: true)
}

/**
 * Hook for real-time audio analysis from TTS or microphone input
 * Designed to work with Nova's TTS audio output
 */
export function useAudioAnalysis(
  audioElement?: HTMLAudioElement | null,
  options: UseAudioAnalysisOptions = {}
) {
  const { fftSize = 256, smoothingTimeConstant = 0.8, enabled = true } = options;

  const [features, setFeatures] = useState<AudioFeatures>({
    amplitude: 0,
    bass: 0,
    treble: 0,
    pulse: 0,
  });

  // Refs for Web Audio API objects
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Smoothed values to prevent jittery animations
  const smoothedRef = useRef<AudioFeatures>({
    amplitude: 0,
    bass: 0,
    treble: 0,
    pulse: 0,
  });

  // Pulse generation (simulated rhythmic wave)
  const pulsePhaseRef = useRef(0);

  useEffect(() => {
    if (!enabled || !audioElement) {
      return;
    }

    // Initialize Web Audio API
    const initAudio = () => {
      try {
        // Create audio context
        const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
        const audioContext = new AudioContext();
        audioContextRef.current = audioContext;

        // Create analyser node
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = fftSize;
        analyser.smoothingTimeConstant = smoothingTimeConstant;
        analyserRef.current = analyser;

        // Create source from audio element
        const source = audioContext.createMediaElementSource(audioElement);
        sourceRef.current = source;

        // Connect: source -> analyser -> destination
        source.connect(analyser);
        analyser.connect(audioContext.destination);

        // Initialize data array for frequency data
        const bufferLength = analyser.frequencyBinCount;
        dataArrayRef.current = new Uint8Array(bufferLength);

        console.log('[useAudioAnalysis] Audio analysis initialized', {
          fftSize,
          bufferLength,
          sampleRate: audioContext.sampleRate,
        });
      } catch (error) {
        console.error('[useAudioAnalysis] Failed to initialize audio analysis:', error);
      }
    };

    // Start analysis loop
    const analyze = () => {
      const analyser = analyserRef.current;
      const dataArray = dataArrayRef.current;

      if (!analyser || !dataArray) {
        animationFrameRef.current = requestAnimationFrame(analyze);
        return;
      }

      // Get frequency data
      analyser.getByteFrequencyData(dataArray as Uint8Array<ArrayBuffer>);

      // Convert to regular array for easier manipulation
      const freqArray = Array.from(dataArray);

      // Calculate amplitude (RMS-like average)
      const sum = freqArray.reduce((a, b) => a + b, 0);
      const amplitude = sum / (freqArray.length * 255);

      // Calculate bass (first 1/4 of spectrum, roughly 0-5kHz at 44.1kHz sample rate)
      const bassEnd = Math.floor(freqArray.length / 4);
      const bassSum = freqArray.slice(0, bassEnd).reduce((a, b) => a + b, 0);
      const bass = bassSum / (bassEnd * 255);

      // Calculate treble (last 1/4 of spectrum, roughly 15-22kHz)
      const trebleStart = Math.floor((freqArray.length * 3) / 4);
      const trebleSum = freqArray.slice(trebleStart).reduce((a, b) => a + b, 0);
      const treble = trebleSum / ((freqArray.length - trebleStart) * 255);

      // Generate rhythmic pulse (simulated beat detection)
      // In a full implementation, this would use beat detection algorithms
      // For now, we create a sine wave that speeds up with audio level
      const pulseSpeed = 2.0 + amplitude * 4.0; // 2-6 Hz depending on volume
      pulsePhaseRef.current += pulseSpeed * 0.016; // Assuming ~60fps
      const pulse = (Math.sin(pulsePhaseRef.current) * 0.5 + 0.5) * amplitude;

      // Smooth values to prevent jitter
      const smoothing = 0.15;
      smoothedRef.current.amplitude += (amplitude - smoothedRef.current.amplitude) * smoothing;
      smoothedRef.current.bass += (bass - smoothedRef.current.bass) * smoothing;
      smoothedRef.current.treble += (treble - smoothedRef.current.treble) * smoothing;
      smoothedRef.current.pulse += (pulse - smoothedRef.current.pulse) * smoothing;

      // Update state (throttled to avoid excessive re-renders)
      setFeatures({ ...smoothedRef.current });

      // Continue loop
      animationFrameRef.current = requestAnimationFrame(analyze);
    };

    // Initialize and start
    initAudio();
    analyze();

    // Cleanup
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (sourceRef.current) {
        sourceRef.current.disconnect();
      }
      if (analyserRef.current) {
        analyserRef.current.disconnect();
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, [enabled, audioElement, fftSize, smoothingTimeConstant]);

  return features;
}

/**
 * Hook for connecting audio analysis to a global audio element by ID
 * Useful when the audio element is managed elsewhere (e.g., TTS system)
 */
export function useGlobalAudioAnalysis(
  audioElementId: string,
  options: UseAudioAnalysisOptions = {}
) {
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);

  useEffect(() => {
    const element = document.getElementById(audioElementId) as HTMLAudioElement;
    if (element) {
      setAudioElement(element);
    }
  }, [audioElementId]);

  return useAudioAnalysis(audioElement, options);
}
