/**
 * Nova TTS - Voice Studio Component
 * React component for voice management, cloning, and customization
 */

import React, { useState, useEffect, useRef } from 'react';

// Types for the component
interface Voice {
  id: string;
  name: string;
  description?: string;
  language: string;
  gender: 'male' | 'female' | 'neutral';
  engine: string;
  quality: string;
  supportsEmotion: boolean;
  supportsStyle: boolean;
  isCloned: boolean;
  sizeInMB: number;
  tags: string[];
  previewUrl?: string;
}

interface VoiceCloneProgress {
  voiceId: string;
  stage: string;
  progress: number;
}

interface DownloadProgress {
  voiceId: string;
  progress: number;
  status: string;
  speedBps: number;
  etaSeconds: number;
}

// Emotion and style options
const EMOTIONS = [
  { id: 'neutral', name: 'Neutral', icon: '😐' },
  { id: 'happy', name: 'Happy', icon: '😊' },
  { id: 'sad', name: 'Sad', icon: '😢' },
  { id: 'angry', name: 'Angry', icon: '😠' },
  { id: 'excited', name: 'Excited', icon: '🤩' },
  { id: 'calm', name: 'Calm', icon: '😌' },
  { id: 'serious', name: 'Serious', icon: '🧐' },
  { id: 'playful', name: 'Playful', icon: '😜' },
  { id: 'warm', name: 'Warm', icon: '🥰' },
  { id: 'professional', name: 'Professional', icon: '👔' },
];

const STYLES = [
  { id: 'conversational', name: 'Conversational' },
  { id: 'newscast', name: 'Newscast' },
  { id: 'narration', name: 'Narration' },
  { id: 'assistant', name: 'Assistant' },
  { id: 'storytelling', name: 'Storytelling' },
  { id: 'documentary', name: 'Documentary' },
  { id: 'whispering', name: 'Whispering' },
];

const LANGUAGES = [
  { code: 'en-US', name: 'English (US)' },
  { code: 'en-GB', name: 'English (UK)' },
  { code: 'es-ES', name: 'Spanish' },
  { code: 'fr-FR', name: 'French' },
  { code: 'de-DE', name: 'German' },
  { code: 'it-IT', name: 'Italian' },
  { code: 'pt-BR', name: 'Portuguese' },
  { code: 'ja-JP', name: 'Japanese' },
  { code: 'zh-CN', name: 'Chinese' },
  { code: 'ko-KR', name: 'Korean' },
];

/**
 * Voice Card Component
 */
const VoiceCard: React.FC<{
  voice: Voice;
  isSelected: boolean;
  isDownloaded: boolean;
  downloadProgress?: DownloadProgress;
  onSelect: () => void;
  onDownload: () => void;
  onDelete: () => void;
  onPreview: () => void;
}> = ({
  voice,
  isSelected,
  isDownloaded,
  downloadProgress,
  onSelect,
  onDownload,
  onDelete,
  onPreview,
}) => {
  return (
    <div
      className={`voice-card ${isSelected ? 'selected' : ''} ${isDownloaded ? 'downloaded' : ''}`}
      onClick={isDownloaded ? onSelect : undefined}
    >
      <div className="voice-card-header">
        <div className="voice-avatar">
          {voice.gender === 'male' ? '👨' : voice.gender === 'female' ? '👩' : '🧑'}
        </div>
        <div className="voice-info">
          <h4>{voice.name}</h4>
          <span className="voice-engine">{voice.engine}</span>
        </div>
        {isSelected && <span className="selected-badge">✓</span>}
      </div>

      <p className="voice-description">{voice.description}</p>

      <div className="voice-tags">
        <span className="tag language">{voice.language}</span>
        <span className="tag quality">{voice.quality}</span>
        {voice.supportsEmotion && <span className="tag feature">Emotion</span>}
        {voice.supportsStyle && <span className="tag feature">Style</span>}
        {voice.isCloned && <span className="tag cloned">Cloned</span>}
      </div>

      <div className="voice-actions">
        {!isDownloaded && !downloadProgress && (
          <button onClick={onDownload} className="btn-download">
            Download ({voice.sizeInMB}MB)
          </button>
        )}

        {downloadProgress && (
          <div className="download-progress">
            <div
              className="progress-bar"
              style={{ width: `${downloadProgress.progress}%` }}
            />
            <span>{Math.round(downloadProgress.progress)}%</span>
          </div>
        )}

        {isDownloaded && (
          <>
            <button onClick={onPreview} className="btn-preview">
              🔊 Preview
            </button>
            {voice.isCloned && (
              <button onClick={onDelete} className="btn-delete">
                🗑️
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
};

/**
 * Voice Cloning Dialog Component
 */
const VoiceCloningDialog: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onClone: (config: {
    name: string;
    description: string;
    language: string;
    audioFiles: File[];
  }) => void;
  progress?: VoiceCloneProgress;
}> = ({ isOpen, onClose, onClone, progress }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [language, setLanguage] = useState('en-US');
  const [audioFiles, setAudioFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setAudioFiles(Array.from(e.target.files));
    }
  };

  const handleSubmit = () => {
    if (name && audioFiles.length > 0) {
      onClone({ name, description, language, audioFiles });
    }
  };

  if (!isOpen) return null;

  return (
    <div className="dialog-overlay">
      <div className="dialog voice-cloning-dialog">
        <div className="dialog-header">
          <h3>🎤 Clone Your Voice</h3>
          <button onClick={onClose} className="btn-close">×</button>
        </div>

        <div className="dialog-content">
          <p className="clone-info">
            Create a custom voice clone from your audio samples. For best results,
            provide 10-30 seconds of clear speech without background noise.
          </p>

          <div className="form-group">
            <label>Voice Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Custom Voice"
            />
          </div>

          <div className="form-group">
            <label>Description (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe your voice..."
            />
          </div>

          <div className="form-group">
            <label>Language</label>
            <select value={language} onChange={(e) => setLanguage(e.target.value)}>
              {LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.name}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Reference Audio</label>
            <div
              className="audio-drop-zone"
              onClick={() => fileInputRef.current?.click()}
            >
              {audioFiles.length > 0 ? (
                <div className="selected-files">
                  {audioFiles.map((file, i) => (
                    <span key={i} className="file-chip">
                      🎵 {file.name}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="drop-zone-content">
                  <span className="drop-icon">📁</span>
                  <span>Click or drag audio files here</span>
                  <span className="hint">WAV, MP3, M4A supported</span>
                </div>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              multiple
              onChange={handleFileSelect}
              style={{ display: 'none' }}
            />
          </div>

          {progress && (
            <div className="clone-progress">
              <div className="progress-stage">{progress.stage}</div>
              <div className="progress-bar-container">
                <div
                  className="progress-bar"
                  style={{ width: `${progress.progress}%` }}
                />
              </div>
              <div className="progress-percent">{progress.progress}%</div>
            </div>
          )}
        </div>

        <div className="dialog-footer">
          <button onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className="btn-primary"
            disabled={!name || audioFiles.length === 0 || !!progress}
          >
            {progress ? 'Cloning...' : '✨ Create Voice Clone'}
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * Voice Settings Panel Component
 */
const VoiceSettingsPanel: React.FC<{
  voice: Voice | null;
  settings: {
    speed: number;
    pitch: number;
    emotion: string;
    style: string;
  };
  onSettingsChange: (settings: any) => void;
  onTestVoice: (text: string) => void;
}> = ({ voice, settings, onSettingsChange, onTestVoice }) => {
  const [testText, setTestText] = useState(
    "Hello! I'm Nova, your AI assistant. How can I help you today?"
  );

  if (!voice) {
    return (
      <div className="voice-settings-panel empty">
        <p>Select a voice to customize settings</p>
      </div>
    );
  }

  return (
    <div className="voice-settings-panel">
      <h3>Voice Settings</h3>

      <div className="settings-section">
        <h4>Speed & Pitch</h4>

        <div className="slider-group">
          <label>
            Speed: {settings.speed.toFixed(1)}x
            <span className="slider-hint">
              {settings.speed < 1 ? 'Slower' : settings.speed > 1 ? 'Faster' : 'Normal'}
            </span>
          </label>
          <input
            type="range"
            min="0.5"
            max="2.0"
            step="0.1"
            value={settings.speed}
            onChange={(e) =>
              onSettingsChange({ ...settings, speed: parseFloat(e.target.value) })
            }
          />
        </div>

        <div className="slider-group">
          <label>
            Pitch: {settings.pitch > 0 ? '+' : ''}{settings.pitch} semitones
            <span className="slider-hint">
              {settings.pitch < 0 ? 'Lower' : settings.pitch > 0 ? 'Higher' : 'Normal'}
            </span>
          </label>
          <input
            type="range"
            min="-12"
            max="12"
            step="1"
            value={settings.pitch}
            onChange={(e) =>
              onSettingsChange({ ...settings, pitch: parseInt(e.target.value) })
            }
          />
        </div>
      </div>

      {voice.supportsEmotion && (
        <div className="settings-section">
          <h4>Emotion</h4>
          <div className="emotion-grid">
            {EMOTIONS.map((emotion) => (
              <button
                key={emotion.id}
                className={`emotion-btn ${settings.emotion === emotion.id ? 'active' : ''}`}
                onClick={() => onSettingsChange({ ...settings, emotion: emotion.id })}
                title={emotion.name}
              >
                <span className="emotion-icon">{emotion.icon}</span>
                <span className="emotion-name">{emotion.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {voice.supportsStyle && (
        <div className="settings-section">
          <h4>Speaking Style</h4>
          <div className="style-options">
            {STYLES.map((style) => (
              <button
                key={style.id}
                className={`style-btn ${settings.style === style.id ? 'active' : ''}`}
                onClick={() => onSettingsChange({ ...settings, style: style.id })}
              >
                {style.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="settings-section">
        <h4>Test Voice</h4>
        <textarea
          value={testText}
          onChange={(e) => setTestText(e.target.value)}
          placeholder="Enter text to test..."
          rows={3}
        />
        <button onClick={() => onTestVoice(testText)} className="btn-test">
          🔊 Test Voice
        </button>
      </div>
    </div>
  );
};

/**
 * Main Voice Studio Component
 */
export const VoiceStudio: React.FC = () => {
  // State
  const [voices, setVoices] = useState<Voice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState<Voice | null>(null);
  const [downloadedVoices, setDownloadedVoices] = useState<Set<string>>(new Set());
  const [downloadProgress, setDownloadProgress] = useState<Map<string, DownloadProgress>>(
    new Map()
  );
  const [cloningProgress, setCloningProgress] = useState<VoiceCloneProgress | null>(null);
  const [showCloningDialog, setShowCloningDialog] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterEngine, setFilterEngine] = useState<string>('all');
  const [filterLanguage, setFilterLanguage] = useState<string>('all');
  const [voiceSettings, setVoiceSettings] = useState({
    speed: 1.0,
    pitch: 0,
    emotion: 'neutral',
    style: 'conversational',
  });
  const [isLoading, setIsLoading] = useState(true);

  // Load voices on mount
  useEffect(() => {
    loadVoices();
    setupIpcListeners();
  }, []);

  const loadVoices = async () => {
    setIsLoading(true);
    try {
      // This would call the main process via IPC
      const result = await (window as any).electronAPI?.tts?.getVoices?.();
      if (result) {
        setVoices(result.voices || []);
        setDownloadedVoices(new Set(result.downloadedVoiceIds || []));
      }
    } catch (error) {
      console.error('Failed to load voices:', error);
    }
    setIsLoading(false);
  };

  const setupIpcListeners = () => {
    // Listen for download progress
    (window as any).electronAPI?.tts?.onDownloadProgress?.((progress: DownloadProgress) => {
      setDownloadProgress((prev) => {
        const next = new Map(prev);
        if (progress.status === 'complete') {
          next.delete(progress.voiceId);
          setDownloadedVoices((prev) => new Set([...prev, progress.voiceId]));
        } else {
          next.set(progress.voiceId, progress);
        }
        return next;
      });
    });

    // Listen for cloning progress
    (window as any).electronAPI?.tts?.onCloneProgress?.(
      (voiceId: string, stage: string, progress: number) => {
        setCloningProgress({ voiceId, stage, progress });
        if (progress === 100) {
          setTimeout(() => {
            setCloningProgress(null);
            setShowCloningDialog(false);
            loadVoices();
          }, 1000);
        }
      }
    );
  };

  const handleDownloadVoice = async (voiceId: string) => {
    try {
      await (window as any).electronAPI?.tts?.downloadVoice?.(voiceId);
    } catch (error) {
      console.error('Download failed:', error);
    }
  };

  const handleDeleteVoice = async (voiceId: string) => {
    if (confirm('Are you sure you want to delete this voice?')) {
      try {
        await (window as any).electronAPI?.tts?.deleteVoice?.(voiceId);
        loadVoices();
      } catch (error) {
        console.error('Delete failed:', error);
      }
    }
  };

  const handleCloneVoice = async (config: {
    name: string;
    description: string;
    language: string;
    audioFiles: File[];
  }) => {
    try {
      // Convert files to paths (in a real app, you'd save them first)
      const audioPaths = await Promise.all(
        config.audioFiles.map(async (file) => {
          // This would save the file and return the path
          return file.name; // Placeholder
        })
      );

      await (window as any).electronAPI?.tts?.cloneVoice?.({
        name: config.name,
        description: config.description,
        language: config.language,
        referenceAudioPaths: audioPaths,
        engine: 'xtts',
        extractEmbedding: true,
        fineTune: false,
      });
    } catch (error) {
      console.error('Clone failed:', error);
      setCloningProgress(null);
    }
  };

  const handlePreviewVoice = async (voiceId: string) => {
    try {
      await (window as any).electronAPI?.tts?.previewVoice?.(voiceId);
    } catch (error) {
      console.error('Preview failed:', error);
    }
  };

  const handleTestVoice = async (text: string) => {
    if (!selectedVoice) return;
    try {
      await (window as any).electronAPI?.tts?.speak?.(text, {
        voiceId: selectedVoice.id,
        ...voiceSettings,
      });
    } catch (error) {
      console.error('Test failed:', error);
    }
  };

  // Filter voices
  const filteredVoices = voices.filter((voice) => {
    if (filterEngine !== 'all' && voice.engine !== filterEngine) return false;
    if (filterLanguage !== 'all' && !voice.language.startsWith(filterLanguage)) return false;
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        voice.name.toLowerCase().includes(query) ||
        voice.description?.toLowerCase().includes(query) ||
        voice.tags.some((t) => t.toLowerCase().includes(query))
      );
    }
    return true;
  });

  // Get unique engines and languages for filters
  const engines = [...new Set(voices.map((v) => v.engine))];
  const languages = [...new Set(voices.map((v) => v.language.split('-')[0]))];

  if (isLoading) {
    return (
      <div className="voice-studio loading">
        <div className="spinner" />
        <p>Loading voices...</p>
      </div>
    );
  }

  return (
    <div className="voice-studio">
      <div className="voice-studio-header">
        <h2>🎙️ Voice Studio</h2>
        <p>Customize your AI assistant's voice or create your own</p>
      </div>

      <div className="voice-studio-toolbar">
        <div className="search-box">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search voices..."
          />
        </div>

        <div className="filters">
          <select value={filterEngine} onChange={(e) => setFilterEngine(e.target.value)}>
            <option value="all">All Engines</option>
            {engines.map((engine) => (
              <option key={engine} value={engine}>
                {engine.charAt(0).toUpperCase() + engine.slice(1)}
              </option>
            ))}
          </select>

          <select value={filterLanguage} onChange={(e) => setFilterLanguage(e.target.value)}>
            <option value="all">All Languages</option>
            {languages.map((lang) => (
              <option key={lang} value={lang}>
                {LANGUAGES.find((l) => l.code.startsWith(lang))?.name || lang}
              </option>
            ))}
          </select>
        </div>

        <button onClick={() => setShowCloningDialog(true)} className="btn-clone">
          ✨ Clone Voice
        </button>
      </div>

      <div className="voice-studio-content">
        <div className="voice-grid">
          {filteredVoices.map((voice) => (
            <VoiceCard
              key={voice.id}
              voice={voice}
              isSelected={selectedVoice?.id === voice.id}
              isDownloaded={downloadedVoices.has(voice.id)}
              downloadProgress={downloadProgress.get(voice.id)}
              onSelect={() => setSelectedVoice(voice)}
              onDownload={() => handleDownloadVoice(voice.id)}
              onDelete={() => handleDeleteVoice(voice.id)}
              onPreview={() => handlePreviewVoice(voice.id)}
            />
          ))}

          {filteredVoices.length === 0 && (
            <div className="no-voices">
              <p>No voices found matching your criteria</p>
            </div>
          )}
        </div>

        <VoiceSettingsPanel
          voice={selectedVoice}
          settings={voiceSettings}
          onSettingsChange={setVoiceSettings}
          onTestVoice={handleTestVoice}
        />
      </div>

      <VoiceCloningDialog
        isOpen={showCloningDialog}
        onClose={() => setShowCloningDialog(false)}
        onClone={handleCloneVoice}
        progress={cloningProgress || undefined}
      />
    </div>
  );
};

export default VoiceStudio;
