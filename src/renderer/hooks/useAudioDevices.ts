/**
 * useAudioDevices Hook
 * Manages audio device enumeration and monitoring
 */

import { useState, useEffect } from 'react';

export interface AudioDeviceInfo {
  index: number;
  name: string;
  isDefault: boolean;
}

export interface UseAudioDevicesOptions {
  /** Auto-start device monitoring when mounted */
  autoStart?: boolean;
  /** Callback when devices change */
  onDeviceChange?: (input: AudioDeviceInfo[], output: MediaDeviceInfo[]) => void;
}

export interface UseAudioDevicesResult {
  /** Available input devices (microphones) */
  inputDevices: AudioDeviceInfo[];
  /** Available output devices (speakers/headphones) */
  outputDevices: MediaDeviceInfo[];
  /** Loading state */
  loading: boolean;
  /** Error message if enumeration failed */
  error: string | null;
  /** Manually refresh device list */
  refresh: () => Promise<void>;
}

/**
 * Hook to enumerate and monitor audio devices
 *
 * @example
 * ```tsx
 * const { inputDevices, outputDevices, error } = useAudioDevices({ autoStart: true });
 *
 * if (error) return <div>Error: {error}</div>;
 *
 * return (
 *   <select>
 *     {inputDevices.map(d => (
 *       <option key={d.index} value={d.index}>{d.name}</option>
 *     ))}
 *   </select>
 * );
 * ```
 */
export function useAudioDevices(options: UseAudioDevicesOptions = {}): UseAudioDevicesResult {
  const { autoStart = false, onDeviceChange } = options;

  const [inputDevices, setInputDevices] = useState<AudioDeviceInfo[]>([]);
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDevices = async () => {
    setLoading(true);
    setError(null);

    try {
      // Fetch input devices from main process
      const mainDevices = await window.atlas?.voice?.getAudioDevices();
      const inputs = mainDevices || [];
      setInputDevices(inputs);

      // Fetch output devices from browser API
      const browserDevices = await navigator.mediaDevices.enumerateDevices();
      const outputs = browserDevices.filter(d => d.kind === 'audiooutput');
      setOutputDevices(outputs);

      // Notify callback
      if (onDeviceChange) {
        onDeviceChange(inputs, outputs);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to enumerate devices';
      setError(errorMsg);
      console.error('[useAudioDevices] Enumeration failed:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!autoStart) return;

    // Initial fetch
    fetchDevices();

    // Start device monitoring (detects plug/unplug)
    window.atlas?.voice?.startDeviceMonitoring?.();

    // Cleanup
    return () => {
      window.atlas?.voice?.stopDeviceMonitoring?.();
    };
  }, [autoStart]); // eslint-disable-line react-hooks/exhaustive-deps
  // Note: onDeviceChange intentionally omitted to avoid refetch on callback change

  return {
    inputDevices,
    outputDevices,
    loading,
    error,
    refresh: fetchDevices,
  };
}
