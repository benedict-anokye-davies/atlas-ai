# Atlas Voice Pipeline Diagnostic Checklist

## Quick Diagnosis Steps

Run these checks in order to identify where the voice pipeline is failing:

### 1. Check if Voice Pipeline Auto-Starts

**Location to check:** Browser DevTools Console

**What to look for:**
```
[Atlas] Auto-starting voice pipeline...
[VoicePipeline] Starting voice pipeline...
[VoicePipeline] Voice pipeline started in XXXms
```

**If you DON'T see these messages:**
- Voice pipeline is not auto-starting
- Check App.tsx line 171-177 for autoStart logic
- Verify settings.autoStart is true

### 2. Check API Keys

**Method 1 - Check Environment Variables:**
Open terminal and run:
```bash
cd "C:\Users\Nxiss\OneDrive\Desktop\nova-desktop"
node -e "require('dotenv').config(); console.log('DEEPGRAM_API_KEY:', process.env.DEEPGRAM_API_KEY ? 'SET' : 'MISSING'); console.log('FIREWORKS_API_KEY:', process.env.FIREWORKS_API_KEY ? 'SET' : 'MISSING'); console.log('ELEVENLABS_API_KEY:', process.env.ELEVENLABS_API_KEY ? 'SET' : 'MISSING'); console.log('PORCUPINE_API_KEY:', process.env.PORCUPINE_API_KEY ? 'SET' : 'MISSING');"
```

**Method 2 - Check Keychain (if migrated):**
Look in: `%APPDATA%\atlas-desktop\keychain.enc`
If this file exists, keys are in keychain, not .env

**What to do if keys are missing:**
1. Create `.env` file in project root
2. Add keys:
```env
PORCUPINE_API_KEY=your_key_here
DEEPGRAM_API_KEY=your_key_here
FIREWORKS_API_KEY=your_key_here
ELEVENLABS_API_KEY=your_key_here
```
3. Restart app

### 3. Check Wake Word Detection

**Test:** Say "Hey Atlas" clearly

**What to look for in console:**
```
[WakeWordDetector] Wake word detected
[AudioPipeline] Pipeline state changed from idle to listening
```

**If wake word NOT detected:**
- Check microphone permissions in Windows Settings
- Verify PORCUPINE_API_KEY is valid
- Check audio input device in Atlas Settings
- Try pressing SPACE key instead (manual trigger)

### 4. Check STT (Speech Recognition)

**Test:** After wake word, say "What is the weather today?"

**What to look for in console:**
```
[VoicePipeline] Speech segment complete
[STTManager] Starting transcription
[STTManager] Transcription result: "What is the weather today?"
```

**In Real-Time Transcript Overlay:**
- Should see blue text with your speech appearing

**If NO transcript appears:**
- Check DEEPGRAM_API_KEY is valid
- Look for error: "STT connection failed"
- Check internet connection
- STTManager may not be started (check for "STT Manager started" log)

### 5. Check LLM Response

**What to look for in console:**
```
[LLMManager] Sending request to LLM
[LLMManager] Response chunk received
[VoicePipeline] LLM response complete
```

**In Real-Time Transcript Overlay:**
- Should see green text with Atlas's response

**If NO response appears:**
- Check FIREWORKS_API_KEY is valid
- Look for "LLM request failed" or "429 Rate Limit" errors
- Check Fireworks AI dashboard for API usage/limits

### 6. Check TTS (Voice Synthesis)

**What to look for in console:**
```
[TTSManager] Synthesizing text
[TTSManager] Sending audio to renderer
[useAtlasState] Received atlas:tts-audio
[useAtlasState] Playing audio, queue size: X
```

**If you see "Received atlas:tts-audio" but NO sound:**
- Check system volume
- Check Atlas output device in Settings
- Try different audio output device
- Look for audio playback errors in console

**If you DON'T see "Received atlas:tts-audio":**
- Check ELEVENLABS_API_KEY is valid
- TTS synthesis may be failing
- Check for "TTS synthesis failed" errors

### 7. Check Audio Playback

**Open DevTools Console, run:**
```javascript
// Test audio playback directly
const testAudio = new Audio('https://www2.cs.uic.edu/~i101/SoundFiles/BabyElephantWalk60.wav');
testAudio.play().then(() => console.log('Audio works!')).catch(err => console.error('Audio blocked:', err));
```

**If audio is blocked:**
- Browser may require user interaction first
- Click anywhere in the app, then try voice again

## Common Issue Patterns

### Pattern 1: Everything Silent
**Symptoms:** No wake word, no transcript, no response
**Cause:** Voice pipeline not started OR microphone permissions denied
**Fix:**
1. Check console for "Voice pipeline started"
2. Grant microphone permission
3. Click "Start" button in UI

### Pattern 2: Wake Word Works, But No Transcript
**Symptoms:** "Hey Atlas" detected, but no blue text appears
**Cause:** STT Manager not started OR Deepgram API key invalid
**Fix:**
1. Check for "STT Manager started" in logs
2. Verify DEEPGRAM_API_KEY
3. Check internet connection

### Pattern 3: See Transcript, No Response
**Symptoms:** Blue text appears, but no green text
**Cause:** LLM API key invalid OR request failing
**Fix:**
1. Verify FIREWORKS_API_KEY
2. Check Fireworks AI account status
3. Look for rate limit errors

### Pattern 4: See Response Text, No Audio
**Symptoms:** Green text appears, but no voice
**Cause:** TTS failing OR audio playback blocked
**Fix:**
1. Check ELEVENLABS_API_KEY
2. Test audio playback (see step 7)
3. Check system audio output device
4. Look for "Failed to play audio" in console

### Pattern 5: First Interaction Fails, Second Works
**Symptoms:** First "Hey Atlas" does nothing, second time works
**Cause:** Race condition in initialization
**Fix:**
1. Wait 5 seconds after app starts before speaking
2. Watch for "Voice pipeline started" before using
3. This is a known issue - initialization timing

## Debug Mode

Enable detailed logging:
1. Open Settings (gear icon)
2. Enable "Debug Mode"
3. Check console for detailed pipeline state

Look for these key log prefixes:
- `[VoicePipeline]` - Main orchestrator
- `[AudioPipeline]` - Wake word and audio
- `[STTManager]` - Speech recognition
- `[LLMManager]` - AI responses
- `[TTSManager]` - Voice synthesis
- `[useAtlasState]` - Renderer audio playback

## Still Not Working?

If you've gone through all these steps and voice still doesn't work:

1. **Collect logs:**
   - Open DevTools (Ctrl+Shift+I)
   - Go to Console tab
   - Right-click → Save As → `atlas-console-logs.txt`

2. **Check main process logs:**
   - Location: `%APPDATA%\atlas-desktop\logs\`
   - Open latest `atlas-YYYY-MM-DD.log`
   - Look for ERROR or WARN messages

3. **Try offline mode:**
   - Go to Settings → Voice
   - Change STT provider to "Vosk (Offline)"
   - Change TTS provider to "Piper (Offline)"
   - This eliminates API key issues

4. **Restart fresh:**
   ```bash
   # Stop app
   # Delete cache
   rm -rf "%APPDATA%\atlas-desktop\cache"
   # Restart
   npm run dev
   ```

## Expected Console Output (Success Case)

When everything works, you should see this sequence:

```
[Atlas] Auto-starting voice pipeline...
[VoicePipeline] Starting voice pipeline...
[STTManager] Initializing Deepgram provider
[LLMManager] Initializing Fireworks provider
[TTSManager] Initializing ElevenLabs provider
[AudioPipeline] Audio pipeline started in 234ms
[VoicePipeline] Voice pipeline started in 456ms
[WakeWordDetector] Listening for "Hey Atlas"...

// After saying "Hey Atlas"
[WakeWordDetector] Wake word detected
[AudioPipeline] State: idle → listening

// After speaking
[VADManager] Speech ended
[STTManager] Transcription: "what is the weather"
[LLMManager] Sending request to Fireworks
[LLMManager] Response: "I don't have access to weather..."
[TTSManager] Synthesizing 45 characters
[useAtlasState] Received atlas:tts-audio
[useAtlasState] Playing audio, queue size: 0
[AudioPipeline] State: speaking → idle
```

## Quick Reference: Minimum Requirements

- [DONE] Windows 10/11
- [DONE] Microphone access granted
- [DONE] Speakers/headphones connected
- [DONE] Internet connection (for online providers)
- [DONE] Valid API keys for:
  - Picovoice (wake word)
  - Deepgram (STT) OR offline Vosk
  - Fireworks AI (LLM)
  - ElevenLabs (TTS) OR offline Piper
- [DONE] At least 4GB RAM free
- [DONE] Node.js v18+
