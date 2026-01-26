# PRD-T5: Content Automation & ML Models

## Overview

T5 is responsible for implementing content automation (Phase 9), multi-user voice ID (Phase 10), and custom ML models (Phase 11).

## File Ownership

```
src/main/content/                      # NEW: Content automation
  ├── youtube/
  │   ├── trends.ts
  │   ├── upload.ts
  │   └── analytics.ts
  ├── tiktok/
  │   └── trends.ts
  ├── video/
  │   ├── script-generator.ts
  │   ├── ffmpeg.ts
  │   ├── voiceover.ts
  │   └── captions.ts
  └── index.ts
src/main/ml/                           # NEW: ML models
  ├── speaker-id/
  │   ├── pyannote.ts
  │   └── embeddings.ts
  ├── emotion/
  │   └── hubert.ts
  ├── trading/
  │   └── lstm-predictor.ts
  ├── training/
  │   ├── data-collector.ts
  │   ├── colab-automation.ts
  │   └── model-versioning.ts
  └── index.ts
src/main/agent/tools/content.ts        # NEW: Content tools
src/main/agent/tools/ml.ts             # NEW: ML tools
```

## IPC Channels

Prefix all IPC with `content:*`, `ml:*`, or `speaker:*`

---

## Phase 9: Content Automation

### Dependencies

```bash
npm install googleapis fluent-ffmpeg pexels-api axios
```

### Tasks

| ID     | Task                   | Description                               | Priority |
| ------ | ---------------------- | ----------------------------------------- | -------- |
| T5-101 | YouTube API setup      | OAuth for YouTube Data API v3             | HIGH     |
| T5-102 | Trend analyzer         | Fetch trending topics from YouTube/TikTok | HIGH     |
| T5-103 | Script generator       | LLM-based video script creation           | HIGH     |
| T5-104 | ElevenLabs voiceover   | Generate voiceovers from script           | HIGH     |
| T5-105 | Stock footage sourcing | Fetch from Pexels/Pixabay                 | HIGH     |
| T5-106 | FFmpeg video assembly  | Combine audio, video, captions            | HIGH     |
| T5-107 | Auto-captioning        | Generate SRT from audio                   | MEDIUM   |
| T5-108 | YouTube upload         | Upload video with metadata                | HIGH     |
| T5-109 | TikTok upload          | Upload to TikTok                          | MEDIUM   |
| T5-110 | Analytics tracking     | Track video performance                   | MEDIUM   |
| T5-111 | Content scheduler      | Schedule uploads for optimal times        | LOW      |

### Architecture

```typescript
// content/youtube/trends.ts
export class YouTubeTrendAnalyzer {
  async getTrending(region?: string): Promise<TrendingVideo[]>;
  async getKeywordTrends(keyword: string): Promise<TrendData>;
  async suggestTopics(niche: string): Promise<TopicSuggestion[]>;
}

// content/video/script-generator.ts
export class ScriptGenerator {
  async generate(topic: string, style: VideoStyle, duration: number): Promise<Script>;
  async generateHooks(topic: string, count?: number): Promise<string[]>;
  async generateCTA(topic: string): Promise<string>;
}

// content/video/ffmpeg.ts
export class VideoAssembler {
  async assembleVideo(config: VideoConfig): Promise<string>;
  async addVoiceover(videoPath: string, audioPath: string): Promise<string>;
  async addCaptions(videoPath: string, srtPath: string): Promise<string>;
  async addBackgroundMusic(videoPath: string, musicPath: string, volume: number): Promise<string>;
  async resize(videoPath: string, width: number, height: number): Promise<string>;
}

// content/youtube/upload.ts
export class YouTubeUploader {
  async upload(videoPath: string, metadata: VideoMetadata): Promise<UploadResult>;
  async updateMetadata(videoId: string, metadata: Partial<VideoMetadata>): Promise<void>;
  async setThumbnail(videoId: string, thumbnailPath: string): Promise<void>;
  async scheduleUpload(
    videoPath: string,
    metadata: VideoMetadata,
    publishAt: Date
  ): Promise<UploadResult>;
}
```

### Content Tools

| Tool                     | Description                |
| ------------------------ | -------------------------- |
| content_get_trends       | Get trending topics        |
| content_generate_script  | Generate video script      |
| content_create_voiceover | Create voiceover from text |
| content_find_footage     | Search stock footage       |
| content_assemble_video   | Combine all elements       |
| content_add_captions     | Add captions to video      |
| content_upload_youtube   | Upload to YouTube          |
| content_get_analytics    | Get video analytics        |

### Video Creation Pipeline

```
1. Identify trending topic
2. Generate script (hook + content + CTA)
3. Generate voiceover via ElevenLabs
4. Fetch relevant stock footage
5. Assemble video with FFmpeg
6. Generate captions
7. Add captions overlay
8. Upload to YouTube/TikTok
9. Track analytics
```

### Test Checklist

```
[ ] YouTube OAuth completes
[ ] Fetch trending videos
[ ] Generate script for topic
[ ] Create voiceover
[ ] Search Pexels for footage
[ ] Assemble 30-second video
[ ] Add captions
[ ] Upload to YouTube
[ ] Fetch video analytics
```

---

## Phase 10: Multi-User & Voice ID

### Dependencies

```bash
pip install pyannote.audio transformers torch  # Python
npm install python-shell  # Node bridge
```

### Tasks

| ID     | Task                       | Description                        | Priority |
| ------ | -------------------------- | ---------------------------------- | -------- |
| T5-201 | Pyannote setup             | Install and configure Pyannote 3.1 | HIGH     |
| T5-202 | Speaker diarization        | Identify who is speaking           | HIGH     |
| T5-203 | Voice embedding extraction | Extract voice embeddings           | HIGH     |
| T5-204 | Speaker identification     | Match voice to known users         | HIGH     |
| T5-205 | Voice enrollment flow      | Enroll new user via voice          | HIGH     |
| T5-206 | Per-user memory            | Separate memory per user           | HIGH     |
| T5-207 | HuBERT emotion detection   | Detect emotion from voice          | MEDIUM   |
| T5-208 | Emotion response           | Adjust Atlas behavior by emotion   | MEDIUM   |
| T5-209 | Unknown voice handling     | Handle unrecognized speakers       | MEDIUM   |

### Architecture

```typescript
// ml/speaker-id/pyannote.ts
export class SpeakerIdentifier {
  async initialize(): Promise<void>;
  async identifySpeaker(audioBuffer: Buffer): Promise<SpeakerResult>;
  async enrollSpeaker(name: string, audioSamples: Buffer[]): Promise<void>;
  async getSpeakers(): Promise<Speaker[]>;
  async deleteSpeaker(speakerId: string): Promise<void>;
  async updateSpeaker(speakerId: string, audioSamples: Buffer[]): Promise<void>;
}

// ml/speaker-id/embeddings.ts
export class VoiceEmbeddings {
  async extract(audioBuffer: Buffer): Promise<Float32Array>;
  async compare(embedding1: Float32Array, embedding2: Float32Array): Promise<number>;
  async store(speakerId: string, embedding: Float32Array): Promise<void>;
  async findMatch(embedding: Float32Array, threshold?: number): Promise<SpeakerMatch | null>;
}

// ml/emotion/hubert.ts
export class EmotionDetector {
  async initialize(): Promise<void>;
  async detect(audioBuffer: Buffer): Promise<EmotionResult>;
  getEmotionHistory(speakerId: string, count?: number): EmotionResult[];
}
```

### Speaker ID Tools

| Tool             | Description              |
| ---------------- | ------------------------ |
| speaker_identify | Identify current speaker |
| speaker_enroll   | Enroll new speaker       |
| speaker_list     | List enrolled speakers   |
| speaker_delete   | Remove speaker           |
| emotion_detect   | Get current emotion      |
| emotion_history  | Get emotion history      |

### Unknown Voice Flow

```
1. Voice doesn't match any enrolled user
2. Atlas: "I don't recognize your voice. What's your name?"
3. User: "I'm [Name]"
4. Atlas: "Nice to meet you, [Name]. Let me learn your voice. Please repeat after me..."
5. Atlas plays 3 phrases for user to repeat
6. Voice embedding extracted and stored
7. Atlas: "Got it! I'll remember you now, [Name]."
```

### Emotion Categories

| Emotion    | Response                  |
| ---------- | ------------------------- |
| Happy      | Match energy, celebrate   |
| Stressed   | Calm voice, offer help    |
| Tired      | Gentle, concise responses |
| Frustrated | Patient, solution-focused |
| Neutral    | Normal behavior           |

### Test Checklist

```
[ ] Pyannote initializes
[ ] Extract voice embedding
[ ] Enroll test speaker
[ ] Identify enrolled speaker
[ ] Reject unknown speaker
[ ] Complete enrollment flow
[ ] Detect emotion from voice
[ ] Different emotion responses work
```

---

## Phase 11: Custom ML Models

### Dependencies

```bash
pip install torch transformers porcupine datasets  # Python
```

### Tasks

| ID     | Task                    | Description                   | Priority |
| ------ | ----------------------- | ----------------------------- | -------- |
| T5-301 | Training data collector | Auto-collect training data    | HIGH     |
| T5-302 | Data labeling           | Semi-automatic labeling       | MEDIUM   |
| T5-303 | Custom wake words       | Train additional wake phrases | MEDIUM   |
| T5-304 | LSTM trading model      | Time-series prediction        | HIGH     |
| T5-305 | Model versioning        | Track model versions          | HIGH     |
| T5-306 | Colab automation        | Auto-train on Colab           | MEDIUM   |
| T5-307 | DeepSeek fine-tuning    | Fine-tune on Fireworks RFT    | HIGH     |
| T5-308 | Model deployment        | Deploy trained models         | HIGH     |
| T5-309 | A/B model testing       | Compare model versions        | LOW      |

### Architecture

```typescript
// ml/training/data-collector.ts
export class TrainingDataCollector {
  async collectConversations(): Promise<ConversationData[]>;
  async collectVoiceSamples(): Promise<VoiceSample[]>;
  async collectTradingData(): Promise<TradingData[]>;
  async exportDataset(type: DatasetType, format: string): Promise<string>;
  async getDatasetStats(): Promise<DatasetStats>;
}

// ml/training/colab-automation.ts
export class ColabAutomation {
  async uploadDataset(datasetPath: string, notebookId: string): Promise<void>;
  async triggerTraining(notebookId: string, params: TrainingParams): Promise<JobId>;
  async getTrainingStatus(jobId: JobId): Promise<TrainingStatus>;
  async downloadModel(jobId: JobId): Promise<string>;
}

// ml/training/model-versioning.ts
export class ModelVersioning {
  async registerModel(model: ModelInfo): Promise<ModelVersion>;
  async getVersions(modelName: string): Promise<ModelVersion[]>;
  async promoteVersion(modelName: string, version: string): Promise<void>;
  async rollbackVersion(modelName: string): Promise<void>;
  async compareVersions(v1: string, v2: string): Promise<ComparisonResult>;
}

// ml/trading/lstm-predictor.ts
export class LSTMPredictor {
  async loadModel(modelPath: string): Promise<void>;
  async predict(symbol: string, timeframe: string): Promise<Prediction>;
  async getConfidence(): number;
  async retrain(newData: TradingData[]): Promise<void>;
}
```

### ML Tools

| Tool                   | Description             |
| ---------------------- | ----------------------- |
| ml_collect_data        | Collect training data   |
| ml_train_model         | Trigger model training  |
| ml_get_training_status | Check training progress |
| ml_deploy_model        | Deploy trained model    |
| ml_predict_price       | Get trading prediction  |
| ml_list_models         | List available models   |

### Models to Train

| Model                | Purpose             | Training Location |
| -------------------- | ------------------- | ----------------- |
| Custom wake words    | Additional phrases  | Local GPU         |
| Speaker embeddings   | Voice recognition   | Local GPU         |
| Emotion classifier   | Mood detection      | Local GPU         |
| LSTM price predictor | Trading signals     | Colab             |
| DeepSeek fine-tune   | User style matching | Fireworks RFT     |

### Fireworks RFT Integration

```typescript
interface RFTConfig {
  baseModel: 'deepseek-v3';
  dataset: ConversationData[];
  epochs: number;
  learningRate: number;
  evaluationSplit: number;
}

async function fineTuneOnFireworks(config: RFTConfig): Promise<FineTunedModel> {
  // 1. Upload dataset to Fireworks
  // 2. Create fine-tuning job
  // 3. Monitor progress
  // 4. Download and deploy
}
```

### Test Checklist

```
[ ] Collect conversation data
[ ] Export dataset in correct format
[ ] Upload to Colab
[ ] Trigger training job
[ ] Monitor training progress
[ ] Download trained model
[ ] Deploy model locally
[ ] Version model correctly
[ ] LSTM prediction works
[ ] Fireworks fine-tuning job creates
```

---

## Task Summary

| ID     | Task                       | Phase | Priority |
| ------ | -------------------------- | ----- | -------- |
| T5-101 | YouTube API setup          | 9     | HIGH     |
| T5-102 | Trend analyzer             | 9     | HIGH     |
| T5-103 | Script generator           | 9     | HIGH     |
| T5-104 | ElevenLabs voiceover       | 9     | HIGH     |
| T5-105 | Stock footage sourcing     | 9     | HIGH     |
| T5-106 | FFmpeg video assembly      | 9     | HIGH     |
| T5-107 | Auto-captioning            | 9     | MEDIUM   |
| T5-108 | YouTube upload             | 9     | HIGH     |
| T5-109 | TikTok upload              | 9     | MEDIUM   |
| T5-110 | Analytics tracking         | 9     | MEDIUM   |
| T5-111 | Content scheduler          | 9     | LOW      |
| T5-201 | Pyannote setup             | 10    | HIGH     |
| T5-202 | Speaker diarization        | 10    | HIGH     |
| T5-203 | Voice embedding extraction | 10    | HIGH     |
| T5-204 | Speaker identification     | 10    | HIGH     |
| T5-205 | Voice enrollment flow      | 10    | HIGH     |
| T5-206 | Per-user memory            | 10    | HIGH     |
| T5-207 | HuBERT emotion detection   | 10    | MEDIUM   |
| T5-208 | Emotion response           | 10    | MEDIUM   |
| T5-209 | Unknown voice handling     | 10    | MEDIUM   |
| T5-301 | Training data collector    | 11    | HIGH     |
| T5-302 | Data labeling              | 11    | MEDIUM   |
| T5-303 | Custom wake words          | 11    | MEDIUM   |
| T5-304 | LSTM trading model         | 11    | HIGH     |
| T5-305 | Model versioning           | 11    | HIGH     |
| T5-306 | Colab automation           | 11    | MEDIUM   |
| T5-307 | DeepSeek fine-tuning       | 11    | HIGH     |
| T5-308 | Model deployment           | 11    | HIGH     |
| T5-309 | A/B model testing          | 11    | LOW      |

## Quality Gates

Before marking any task DONE:

1. `npm run typecheck` passes
2. `npm run lint` passes
3. Python dependencies installed
4. Models run on local GPU
5. Added to tool registry
6. IPC handlers added

## Notes

- Python models require subprocess or python-shell bridge
- Local GPU (RTX 30 series) has ~8GB VRAM limit
- Colab requires Google account
- Fireworks RFT costs ~$8-16 per fine-tune
- FFmpeg must be installed system-wide
- TikTok API is more restrictive than YouTube
