/**
 * Atlas Desktop - Spotify Mini Player Widget
 * Floating mini player with album art, controls, and voice command hints
 */

import React, { useState, useEffect } from 'react';
import './SpotifyWidget.css';

// ============================================================================
// Types
// ============================================================================

export interface SpotifyTrack {
  id: string;
  name: string;
  artists: string[];
  album: string;
  albumArt: string;
  duration: number;
  isPlaying: boolean;
  progress: number;
}

export interface SpotifyDevice {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
}

interface SpotifyWidgetProps {
  isVisible: boolean;
  onClose: () => void;
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
}

// ============================================================================
// Icons
// ============================================================================

const PlayIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
);

const PauseIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <rect x="6" y="4" width="4" height="16" />
    <rect x="14" y="4" width="4" height="16" />
  </svg>
);

const SkipBackIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <polygon points="19 20 9 12 19 4 19 20" />
    <line x1="5" y1="19" x2="5" y2="5" stroke="currentColor" strokeWidth="2" />
  </svg>
);

const SkipForwardIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <polygon points="5 4 15 12 5 20 5 4" />
    <line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" strokeWidth="2" />
  </svg>
);

const ShuffleIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="16 3 21 3 21 8" />
    <line x1="4" y1="20" x2="21" y2="3" />
    <polyline points="21 16 21 21 16 21" />
    <line x1="15" y1="15" x2="21" y2="21" />
    <line x1="4" y1="4" x2="9" y2="9" />
  </svg>
);

const RepeatIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="17 1 21 5 17 9" />
    <path d="M3 11V9a4 4 0 0 1 4-4h14" />
    <polyline points="7 23 3 19 7 15" />
    <path d="M21 13v2a4 4 0 0 1-4 4H3" />
  </svg>
);

const VolumeIcon: React.FC<{ className?: string; level: number }> = ({ className, level }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" />
    {level > 0 && <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />}
    {level > 50 && <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />}
  </svg>
);

const HeartIcon: React.FC<{ className?: string; filled?: boolean }> = ({ className, filled }) => (
  <svg className={className} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
  </svg>
);

const MicIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="23" />
    <line x1="8" y1="23" x2="16" y2="23" />
  </svg>
);

const XIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const SpotifyLogo: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
  </svg>
);

const DeviceIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
  </svg>
);

// ============================================================================
// Helper Functions
// ============================================================================

const formatTime = (ms: number): string => {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};

// ============================================================================
// Voice Commands Section
// ============================================================================

const VoiceCommands: React.FC = () => {
  const [isExpanded, setIsExpanded] = useState(false);
  
  const commands = [
    { phrase: 'Play music', action: 'Start playback' },
    { phrase: 'Pause', action: 'Pause playback' },
    { phrase: 'Skip', action: 'Next track' },
    { phrase: 'Previous', action: 'Previous track' },
    { phrase: 'Play [song name]', action: 'Search and play' },
    { phrase: 'Volume up/down', action: 'Adjust volume' },
    { phrase: 'Shuffle on/off', action: 'Toggle shuffle' },
    { phrase: 'What\'s playing?', action: 'Current track info' },
  ];

  return (
    <div className={`voice-commands ${isExpanded ? 'expanded' : ''}`}>
      <button 
        className="voice-toggle"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <MicIcon className="voice-icon" />
        <span>Voice Commands</span>
      </button>
      {isExpanded && (
        <div className="commands-list">
          {commands.map((cmd, idx) => (
            <div key={idx} className="command-item">
              <span className="command-phrase">"{cmd.phrase}"</span>
              <span className="command-action">{cmd.action}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ============================================================================
// Main Component
// ============================================================================

export const SpotifyWidget: React.FC<SpotifyWidgetProps> = ({
  isVisible,
  onClose,
  position = 'bottom-right',
}) => {
  const [currentTrack, setCurrentTrack] = useState<SpotifyTrack | null>(null);
  const [isLiked, setIsLiked] = useState(false);
  const [volume, setVolume] = useState(70);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<'off' | 'track' | 'context'>('off');
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  const [devices, _setDevices] = useState<SpotifyDevice[]>([]);
  const [showDevices, setShowDevices] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Load Spotify state
  useEffect(() => {
    if (isVisible) {
      loadSpotifyState();
      const interval = setInterval(loadSpotifyState, 3000);
      return () => clearInterval(interval);
    }
    return undefined;
  }, [isVisible]);

  const loadSpotifyState = async () => {
    try {
      const result = await window.atlas?.spotify?.getCurrentPlayback();
      if (result?.success && result.data) {
        const playback = result.data as any;
        setCurrentTrack({
          id: playback.track?.id || '',
          name: playback.track?.name || 'Not Playing',
          artists: playback.track?.artists?.map((a: any) => a.name) || [],
          album: playback.track?.album?.name || '',
          albumArt: playback.track?.album?.images?.[0]?.url || '',
          duration: playback.track?.durationMs || 0,
          isPlaying: playback.isPlaying || false,
          progress: playback.progress || 0,
        });
        setShuffle(playback.shuffleState || false);
        setRepeat(playback.repeatState || 'off');
        setIsConnected(true);
      } else {
        // Mock data for development
        setCurrentTrack({
          id: 'mock',
          name: 'Connect to Spotify',
          artists: ['Open Spotify to see what\'s playing'],
          album: '',
          albumArt: '',
          duration: 0,
          isPlaying: false,
          progress: 0,
        });
        setIsConnected(false);
      }
    } catch (error) {
      console.error('Failed to load Spotify state:', error);
      setIsConnected(false);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePlayPause = async () => {
    if (!currentTrack) return;
    
    try {
      if (currentTrack.isPlaying) {
        await window.atlas?.spotify?.pause();
      } else {
        await window.atlas?.spotify?.play();
      }
      setCurrentTrack(prev => prev ? { ...prev, isPlaying: !prev.isPlaying } : null);
    } catch (error) {
      console.error('Failed to toggle playback:', error);
    }
  };

  const handleSkipNext = async () => {
    try {
      await window.atlas?.spotify?.next();
      setTimeout(loadSpotifyState, 500);
    } catch (error) {
      console.error('Failed to skip:', error);
    }
  };

  const handleSkipPrevious = async () => {
    try {
      await window.atlas?.spotify?.previous();
      setTimeout(loadSpotifyState, 500);
    } catch (error) {
      console.error('Failed to go previous:', error);
    }
  };

  const handleVolumeChange = async (newVolume: number) => {
    setVolume(newVolume);
    try {
      await window.atlas?.spotify?.setVolume(newVolume);
    } catch (error) {
      console.error('Failed to set volume:', error);
    }
  };

  const handleToggleShuffle = async () => {
    const newShuffle = !shuffle;
    setShuffle(newShuffle);
    try {
      await window.atlas?.spotify?.setShuffle(newShuffle);
    } catch (error) {
      console.error('Failed to toggle shuffle:', error);
    }
  };

  const handleToggleRepeat = async () => {
    const states: Array<'off' | 'track' | 'context'> = ['off', 'context', 'track'];
    const currentIndex = states.indexOf(repeat);
    const nextState = states[(currentIndex + 1) % states.length];
    setRepeat(nextState);
    try {
      await window.atlas?.spotify?.setRepeat(nextState);
    } catch (error) {
      console.error('Failed to toggle repeat:', error);
    }
  };

  const handleToggleLike = async () => {
    if (!currentTrack?.id) return;
    
    const newLiked = !isLiked;
    setIsLiked(newLiked);
    try {
      if (newLiked) {
        await window.atlas?.spotify?.saveTrack(currentTrack.id);
      } else {
        await window.atlas?.spotify?.removeTrack(currentTrack.id);
      }
    } catch (error) {
      console.error('Failed to toggle like:', error);
    }
  };

  const handleSeek = async (e: React.MouseEvent<HTMLDivElement>) => {
    if (!currentTrack?.duration) return;
    
    const rect = e.currentTarget.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    const position = Math.floor(percent * currentTrack.duration);
    
    try {
      await window.atlas?.spotify?.seek(position);
      setCurrentTrack(prev => prev ? { ...prev, progress: position } : null);
    } catch (error) {
      console.error('Failed to seek:', error);
    }
  };

  if (!isVisible) return null;

  const progressPercent = currentTrack?.duration 
    ? (currentTrack.progress / currentTrack.duration) * 100 
    : 0;

  return (
    <div className={`spotify-widget ${position}`}>
      <div className="widget-header">
        <div className="widget-brand">
          <SpotifyLogo className="spotify-logo" />
          <span className="brand-text">Spotify</span>
          {!isConnected && <span className="connection-status">Not Connected</span>}
        </div>
        <button className="close-btn" onClick={onClose}>
          <XIcon className="close-icon" />
        </button>
      </div>

      {isLoading ? (
        <div className="loading-state">
          <div className="loading-spinner" />
          <span>Connecting to Spotify...</span>
        </div>
      ) : (
        <>
          <div className="track-display">
            <div className="album-art-wrapper">
              {currentTrack?.albumArt ? (
                <img 
                  src={currentTrack.albumArt} 
                  alt={currentTrack.album}
                  className="album-art"
                />
              ) : (
                <div className="album-placeholder">
                  <SpotifyLogo className="placeholder-logo" />
                </div>
              )}
              {currentTrack?.isPlaying && (
                <div className="playing-indicator">
                  <span className="bar" />
                  <span className="bar" />
                  <span className="bar" />
                </div>
              )}
            </div>
            <div className="track-info">
              <h3 className="track-name">{currentTrack?.name || 'No track'}</h3>
              <p className="track-artists">{currentTrack?.artists.join(', ') || 'Unknown artist'}</p>
              {currentTrack?.album && (
                <p className="track-album">{currentTrack.album}</p>
              )}
            </div>
            <button 
              className={`like-btn ${isLiked ? 'liked' : ''}`}
              onClick={handleToggleLike}
              disabled={!isConnected}
            >
              <HeartIcon className="like-icon" filled={isLiked} />
            </button>
          </div>

          <div className="progress-section">
            <div 
              className="progress-bar"
              onClick={handleSeek}
              role="slider"
              aria-label="Track progress"
              aria-valuemin={0}
              aria-valuemax={currentTrack?.duration || 100}
              aria-valuenow={currentTrack?.progress || 0}
            >
              <div 
                className="progress-fill"
                style={{ width: `${progressPercent}%` }}
              />
              <div 
                className="progress-handle"
                style={{ left: `${progressPercent}%` }}
              />
            </div>
            <div className="progress-times">
              <span>{formatTime(currentTrack?.progress || 0)}</span>
              <span>{formatTime(currentTrack?.duration || 0)}</span>
            </div>
          </div>

          <div className="controls">
            <button 
              className={`control-btn secondary ${shuffle ? 'active' : ''}`}
              onClick={handleToggleShuffle}
              disabled={!isConnected}
              title="Shuffle"
            >
              <ShuffleIcon className="control-icon" />
            </button>
            <button 
              className="control-btn"
              onClick={handleSkipPrevious}
              disabled={!isConnected}
              title="Previous"
            >
              <SkipBackIcon className="control-icon" />
            </button>
            <button 
              className="control-btn primary"
              onClick={handlePlayPause}
              disabled={!isConnected}
              title={currentTrack?.isPlaying ? 'Pause' : 'Play'}
            >
              {currentTrack?.isPlaying ? (
                <PauseIcon className="control-icon" />
              ) : (
                <PlayIcon className="control-icon" />
              )}
            </button>
            <button 
              className="control-btn"
              onClick={handleSkipNext}
              disabled={!isConnected}
              title="Next"
            >
              <SkipForwardIcon className="control-icon" />
            </button>
            <button 
              className={`control-btn secondary ${repeat !== 'off' ? 'active' : ''}`}
              onClick={handleToggleRepeat}
              disabled={!isConnected}
              title={`Repeat: ${repeat}`}
            >
              <RepeatIcon className="control-icon" />
              {repeat === 'track' && <span className="repeat-one">1</span>}
            </button>
          </div>

          <div className="bottom-controls">
            <div 
              className="volume-control"
              onMouseEnter={() => setShowVolumeSlider(true)}
              onMouseLeave={() => setShowVolumeSlider(false)}
            >
              <button className="volume-btn">
                <VolumeIcon className="volume-icon" level={volume} />
              </button>
              {showVolumeSlider && (
                <div className="volume-slider-wrapper">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={volume}
                    onChange={(e) => handleVolumeChange(parseInt(e.target.value))}
                    className="volume-slider"
                  />
                </div>
              )}
            </div>

            <div className="device-control">
              <button 
                className="device-btn"
                onClick={() => setShowDevices(!showDevices)}
                title="Devices"
              >
                <DeviceIcon className="device-icon" />
              </button>
              {showDevices && devices.length > 0 && (
                <div className="devices-dropdown">
                  {devices.map(device => (
                    <button 
                      key={device.id}
                      className={`device-item ${device.isActive ? 'active' : ''}`}
                    >
                      {device.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <VoiceCommands />
        </>
      )}
    </div>
  );
};

export default SpotifyWidget;
