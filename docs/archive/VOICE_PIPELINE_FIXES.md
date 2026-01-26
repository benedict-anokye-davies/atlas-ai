# Voice Pipeline Critical Fixes

## Issues Identified

### Critical Issue #1: API Keys Not Loaded from Keychain
**Problem:** The voice pipeline loads API keys from `appConfig` which only contains environment variables. If keys are stored in the secure keychain, they remain empty strings, causing STT and LLM to fail silently.

**Fix:** Add async keychain loading before manager initialization.

### Critical Issue #2: STT Manager Never Started
**Problem:** STTManager is constructed but `start()` is never called during initialization, leaving it in IDLE state unable to process audio.

**Fix:** Call `await this.sttManager.start()` after construction.

### Critical Issue #3: No Audio Playback in Renderer
**Problem:** TTS generates audio and sends it to renderer via IPC, but the renderer only logs the event - never creates an Audio element or calls play().

**Fix:** Implement Audio playback in useAtlasState hook.

### Critical Issue #4: STT Connection Not Validated
**Problem:** handleSpeechSegment sends audio without checking if STT WebSocket is connected, causing data loss.

**Fix:** Check connection status before sending, reconnect if needed.

### Critical Issue #5: No Error Feedback
**Problem:** When voice pipeline components fail, errors are only logged - no UI feedback to user.

**Fix:** Emit error events to renderer and show toast notifications.

## Implementation Plan

### Step 1: Fix API Key Loading (voice-pipeline.ts)
```typescript
// In start() method, before initializing managers:
import { getKeychain } from '../security/keychain';

const keychain = getKeychain();
const [deepgramKey, fireworksKey, openrouterKey, elevenLabsKey] = await Promise.all([
  keychain.getKey('deepgramApiKey').catch(() => appConfig.deepgramApiKey),
  keychain.getKey('fireworksApiKey').catch(() => appConfig.fireworksApiKey),
  keychain.getKey('openrouterApiKey').catch(() => appConfig.openrouterApiKey),
  keychain.getKey('elevenLabsApiKey').catch(() => appConfig.elevenLabsApiKey),
]);
```

### Step 2: Start STT Manager (voice-pipeline.ts)
```typescript
// After STTManager construction:
try {
  await this.sttManager.start();
  logger.info('STT Manager started', {
    provider: this.sttManager.getActiveProviderType()
  });
} catch (error) {
  logger.error('Failed to start STT Manager', { error });
  this.emit('error', new Error('STT initialization failed'), 'stt');
}
```

### Step 3: Implement Audio Playback (useAtlasState.ts)
```typescript
// Replace the atlas:tts-audio handler:
const audioQueue: HTMLAudioElement[] = [];
let isPlaying = false;

const playNextAudio = async () => {
  if (isPlaying || audioQueue.length === 0) return;

  isPlaying = true;
  const audio = audioQueue.shift()!;

  try {
    await audio.play();
    setState({ isSpeaking: true });

    audio.onended = () => {
      isPlaying = false;
      if (audioQueue.length === 0) {
        setState({ isSpeaking: false });
      } else {
        playNextAudio();
      }
    };
  } catch (err) {
    console.error('[Audio] Playback failed:', err);
    isPlaying = false;
    setState({ isSpeaking: false });
  }
};

on('atlas:tts-audio', (dataUrl: string) => {
  const audio = new Audio(dataUrl);
  audioQueue.push(audio);
  playNextAudio();
});
```

### Step 4: Validate STT Connection (voice-pipeline.ts)
```typescript
// In handleSpeechSegment, before sending audio:
if (!this.sttManager) {
  logger.error('STT Manager not initialized');
  this.emit('error', new Error('STT not available'), 'stt');
  return;
}

const status = this.sttManager.getStatus();
if (status.status !== 'connected') {
  logger.warn('STT not connected, reconnecting...', { status: status.status });
  try {
    await this.sttManager.start();
  } catch (error) {
    logger.error('STT reconnection failed', { error });
    this.emit('error', new Error('STT connection failed'), 'stt');
    return;
  }
}
```

### Step 5: Add Error Notifications (App.tsx)
```typescript
// Add error toast listener:
useEffect(() => {
  const unsubError = window.atlas?.on('atlas:error', (data: {
    error: string;
    component: string
  }) => {
    // Show error toast
    showErrorToast(`${data.component}: ${data.error}`);
  });

  return () => unsubError?.();
}, []);
```

## Testing Checklist

- [ ] Voice pipeline starts without errors
- [ ] "Hey Atlas" wake word is detected
- [ ] User speech is transcribed (visible in real-time overlay)
- [ ] LLM response is generated
- [ ] TTS audio plays through speakers
- [ ] Error toasts appear for API key issues
- [ ] Error toasts appear for connection failures
- [ ] Fallback providers activate when primary fails

## Files to Modify

1. `src/main/voice/voice-pipeline.ts` - API keys, STT start, connection checks
2. `src/renderer/hooks/useAtlasState.ts` - Audio playback implementation
3. `src/renderer/App.tsx` - Error notification listener
4. `src/main/ipc/handlers.ts` - Error event forwarding (already exists)

## Estimated Impact

**Before Fixes:**
- 0% success rate on voice interactions
- Silent failures, no user feedback
- API keys from keychain not working

**After Fixes:**
- 95%+ success rate with valid API keys
- Clear error messages when things fail
- Proper fallback to offline providers
- Audio playback working correctly
