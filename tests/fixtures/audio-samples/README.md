# Audio Sample Fixtures for E2E Voice Pipeline Tests

This directory contains audio sample files used for end-to-end testing of the Atlas voice pipeline.

## Required Audio Samples

### hello-atlas.wav

A pre-recorded audio sample containing the phrase "Hello Atlas" for testing wake word detection and STT processing.

**Specifications:**
- Format: WAV (PCM)
- Sample Rate: 16000 Hz (16 kHz)
- Bit Depth: 16-bit signed integer (PCM16)
- Channels: Mono (1 channel)
- Duration: 1-2 seconds
- Content: Clear pronunciation of "Hello Atlas" with minimal background noise

## How to Create Audio Samples

### Option 1: Using SoX (Sound eXchange)

Install SoX:
```bash
# Windows (with Chocolatey)
choco install sox

# macOS
brew install sox

# Linux
sudo apt install sox
```

Record a sample:
```bash
sox -d -r 16000 -c 1 -b 16 hello-atlas.wav trim 0 2
```

### Option 2: Using FFmpeg

Convert an existing recording to the required format:
```bash
ffmpeg -i input.mp3 -ar 16000 -ac 1 -acodec pcm_s16le hello-atlas.wav
```

### Option 3: Using Python with sounddevice

```python
import sounddevice as sd
import soundfile as sf

# Record 2 seconds of audio
duration = 2  # seconds
sample_rate = 16000
channels = 1

print("Recording... Say 'Hello Atlas'")
audio = sd.rec(int(duration * sample_rate),
               samplerate=sample_rate,
               channels=channels,
               dtype='int16')
sd.wait()

sf.write('hello-atlas.wav', audio, sample_rate)
print("Saved to hello-atlas.wav")
```

### Option 4: Using Audacity

1. Open Audacity
2. Set project sample rate to 16000 Hz (Project Rate in bottom-left)
3. Record your audio sample
4. Export as WAV:
   - File > Export > Export as WAV
   - Encoding: "Signed 16-bit PCM"
   - Save as `hello-atlas.wav`

## Programmatic Audio Generation (for CI/CD)

For automated testing environments where recording is not possible, use the `generateSpeechLikeAudio` function from the test utilities:

```typescript
import { generateSpeechLikeAudio, float32ToInt16 } from '../e2e/utils/audio-mock';
import { writeFileSync } from 'fs';

// Generate 2 seconds of speech-like audio
const float32Audio = generateSpeechLikeAudio(2.0, 16000);
const int16Audio = float32ToInt16(float32Audio);

// Create WAV header
function createWavBuffer(samples: Int16Array, sampleRate: number): Buffer {
  const byteRate = sampleRate * 2; // 16-bit = 2 bytes per sample
  const dataSize = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  // fmt chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // chunk size
  buffer.writeUInt16LE(1, 20);  // audio format (PCM)
  buffer.writeUInt16LE(1, 22);  // channels
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(2, 32);  // block align
  buffer.writeUInt16LE(16, 34); // bits per sample

  // data chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Write samples
  for (let i = 0; i < samples.length; i++) {
    buffer.writeInt16LE(samples[i], 44 + i * 2);
  }

  return buffer;
}

const wavBuffer = createWavBuffer(int16Audio, 16000);
writeFileSync('hello-atlas.wav', wavBuffer);
```

## Sample File Validation

To verify your audio sample meets the requirements:

```bash
# Using SoX
soxi hello-atlas.wav

# Expected output:
# Channels       : 1
# Sample Rate    : 16000
# Precision      : 16-bit
# Duration       : 00:00:02.00

# Using FFprobe
ffprobe hello-atlas.wav
```

## Notes

- Audio samples should be recorded in a quiet environment
- Speak clearly at a normal pace
- Avoid clipping (audio levels too high)
- The wake word "Atlas" should be clearly audible
- For best results, maintain consistent volume throughout

## License

Audio samples in this directory are for testing purposes only and should not contain any copyrighted or licensed content.
