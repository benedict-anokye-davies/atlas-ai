/**
 * Atlas ML - Unified Training Orchestrator
 *
 * Coordinates ML training across multiple platforms:
 * - Kaggle Kernels (free GPU/TPU, best for experimentation)
 * - Google Colab (free GPU, good for notebooks)
 * - Fireworks AI (paid, best for LLM fine-tuning)
 * - Local (3060 laptop, good for small models)
 *
 * Automatically selects best platform based on:
 * - Model type and size
 * - Required compute resources
 * - Cost optimization
 * - Data sensitivity
 *
 * @module ml/cloud-training/training-orchestrator
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { app } from 'electron';
import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';
import { KaggleAutomation, getKaggleAutomation, KaggleJob } from './kaggle-automation';
import { ColabAutomation, TrainingJob } from '../fine-tuning/colab-automation';
import { DeepSeekFineTuneManager, FineTuneJob } from '../fine-tuning/deepseek-finetuning';
import { getModelRegistry, ModelMetadata, ModelType } from '../models';
import { TrainingDataCollector } from '../training/data-collector';

const logger = createModuleLogger('TrainingOrchestrator');

// =============================================================================
// Types
// =============================================================================

export type TrainingPlatform = 'kaggle' | 'colab' | 'fireworks' | 'local';

export type ModelTrainingType =
  | 'lstm-trading' // LSTM for price prediction
  | 'intent-classifier' // Intent classification
  | 'emotion-detection' // Emotion from audio
  | 'speaker-id' // Speaker identification
  | 'wake-word' // Custom wake word
  | 'llm-adapter' // LoRA/QLoRA for LLM
  | 'anomaly-detection' // System anomaly detection
  | 'embedding-model' // Custom embeddings
  | 'hyde-generator'; // HyDE document generator

export type UnifiedJobStatus =
  | 'pending'
  | 'preparing-data'
  | 'uploading'
  | 'queued'
  | 'training'
  | 'completed'
  | 'deploying'
  | 'deployed'
  | 'failed'
  | 'cancelled';

export interface TrainingConfig {
  /** Training type */
  type: ModelTrainingType;
  /** Preferred platform (auto-selected if not specified) */
  preferredPlatform?: TrainingPlatform;
  /** Training name */
  name: string;
  /** Description */
  description?: string;
  /** Dataset path or ID */
  datasetPath?: string;
  /** Hyperparameters */
  hyperparameters: {
    epochs?: number;
    batchSize?: number;
    learningRate?: number;
    warmupSteps?: number;
    sequenceLength?: number;
    hiddenSize?: number;
    numLayers?: number;
    dropout?: number;
    loraRank?: number;
    loraAlpha?: number;
    [key: string]: unknown;
  };
  /** Auto-deploy on completion */
  autoDeploy: boolean;
  /** Validation split */
  validationSplit: number;
  /** Early stopping patience */
  earlyStoppingPatience?: number;
  /** Use mixed precision */
  mixedPrecision: boolean;
  /** Max training time (hours) */
  maxHours?: number;
  /** Notify on completion */
  notifyOnComplete: boolean;
}

export interface UnifiedTrainingJob {
  id: string;
  config: TrainingConfig;
  platform: TrainingPlatform;
  status: UnifiedJobStatus;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  deployedAt?: number;
  /** Platform-specific job reference */
  platformJobId?: string;
  /** Dataset stats */
  datasetStats?: {
    samples: number;
    trainSamples: number;
    valSamples: number;
    features?: string[];
    avgLength?: number;
  };
  /** Training progress */
  progress?: {
    epoch: number;
    totalEpochs: number;
    step?: number;
    totalSteps?: number;
    loss: number;
    valLoss?: number;
    metrics?: Record<string, number>;
    eta?: string;
  };
  /** Final metrics */
  finalMetrics?: {
    loss: number;
    valLoss?: number;
    accuracy?: number;
    precision?: number;
    recall?: number;
    f1?: number;
    custom?: Record<string, number>;
  };
  /** Output model path */
  modelPath?: string;
  /** Registered model ID */
  registeredModelId?: string;
  /** Cost estimate */
  costEstimate?: {
    computeHours: number;
    estimatedCost: number;
    currency: string;
  };
  /** Error message */
  error?: string;
  /** Logs */
  logs: string[];
}

export interface OrchestratorConfig {
  storagePath: string;
  /** Fireworks API key */
  fireworksApiKey?: string;
  /** Default platform preferences by model type */
  platformPreferences: Record<ModelTrainingType, TrainingPlatform[]>;
  /** Auto-cleanup completed jobs after N days */
  autoCleanupDays: number;
  /** Max concurrent jobs per platform */
  maxConcurrentJobs: Record<TrainingPlatform, number>;
}

export const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = {
  storagePath: '',
  platformPreferences: {
    'lstm-trading': ['kaggle', 'colab', 'local'],
    'intent-classifier': ['kaggle', 'colab', 'local'],
    'emotion-detection': ['kaggle', 'colab'],
    'speaker-id': ['kaggle', 'colab'],
    'wake-word': ['local'], // Picovoice Console
    'llm-adapter': ['fireworks', 'colab', 'kaggle'],
    'anomaly-detection': ['local', 'kaggle'],
    'embedding-model': ['fireworks', 'kaggle'],
    'hyde-generator': ['fireworks', 'colab'],
  },
  autoCleanupDays: 30,
  maxConcurrentJobs: {
    kaggle: 2,
    colab: 1,
    fireworks: 3,
    local: 1,
  },
};

// =============================================================================
// Training Code Templates
// =============================================================================

export const TRAINING_TEMPLATES: Record<ModelTrainingType, string> = {
  'lstm-trading': `
# Atlas ML - LSTM Trading Model Training
# Platform: {platform}
# Job ID: {job_id}

import os
import json
import numpy as np
import pandas as pd
from datetime import datetime

# Install dependencies
!pip install -q tensorflow keras scikit-learn ta

import tensorflow as tf
from tensorflow import keras
from keras.models import Sequential
from keras.layers import LSTM, Dense, Dropout, BatchNormalization
from keras.callbacks import EarlyStopping, ModelCheckpoint, ReduceLROnPlateau
from sklearn.preprocessing import MinMaxScaler
from sklearn.model_selection import train_test_split
import ta

print(f"TensorFlow version: {tf.__version__}")
print(f"GPU Available: {tf.config.list_physical_devices('GPU')}")

# Configuration
CONFIG = {config_json}

# Load data
df = pd.read_csv('{dataset_path}')
print(f"Loaded {len(df)} samples")

# Feature engineering
def add_technical_indicators(df):
    df['sma_20'] = ta.trend.sma_indicator(df['close'], window=20)
    df['sma_50'] = ta.trend.sma_indicator(df['close'], window=50)
    df['rsi'] = ta.momentum.rsi(df['close'], window=14)
    df['macd'] = ta.trend.macd_diff(df['close'])
    df['bb_upper'] = ta.volatility.bollinger_hband(df['close'])
    df['bb_lower'] = ta.volatility.bollinger_lband(df['close'])
    df['atr'] = ta.volatility.average_true_range(df['high'], df['low'], df['close'])
    df['obv'] = ta.volume.on_balance_volume(df['close'], df['volume'])
    return df.dropna()

df = add_technical_indicators(df)

# Prepare sequences
SEQUENCE_LENGTH = CONFIG.get('sequenceLength', 60)
FEATURES = ['open', 'high', 'low', 'close', 'volume', 'sma_20', 'sma_50', 'rsi', 'macd']

scaler = MinMaxScaler()
scaled_data = scaler.fit_transform(df[FEATURES])

X, y = [], []
for i in range(SEQUENCE_LENGTH, len(scaled_data)):
    X.append(scaled_data[i-SEQUENCE_LENGTH:i])
    # Predict next close direction (1 = up, 0 = down)
    y.append(1 if df['close'].iloc[i] > df['close'].iloc[i-1] else 0)

X, y = np.array(X), np.array(y)
print(f"Sequences: {X.shape}, Labels: {y.shape}")

# Split data
X_train, X_val, y_train, y_val = train_test_split(
    X, y, test_size=CONFIG.get('validationSplit', 0.2), shuffle=False
)

# Build model
model = Sequential([
    LSTM(CONFIG.get('hiddenSize', 128), return_sequences=True, input_shape=(SEQUENCE_LENGTH, len(FEATURES))),
    BatchNormalization(),
    Dropout(CONFIG.get('dropout', 0.2)),
    LSTM(CONFIG.get('hiddenSize', 128) // 2, return_sequences=True),
    BatchNormalization(),
    Dropout(CONFIG.get('dropout', 0.2)),
    LSTM(CONFIG.get('hiddenSize', 128) // 4),
    BatchNormalization(),
    Dropout(CONFIG.get('dropout', 0.2)),
    Dense(32, activation='relu'),
    Dense(1, activation='sigmoid')
])

model.compile(
    optimizer=keras.optimizers.Adam(learning_rate=CONFIG.get('learningRate', 0.001)),
    loss='binary_crossentropy',
    metrics=['accuracy']
)

model.summary()

# Callbacks
callbacks = [
    EarlyStopping(patience=CONFIG.get('earlyStoppingPatience', 10), restore_best_weights=True),
    ReduceLROnPlateau(factor=0.5, patience=5),
    ModelCheckpoint('best_model.keras', save_best_only=True)
]

# Train
history = model.fit(
    X_train, y_train,
    validation_data=(X_val, y_val),
    epochs=CONFIG.get('epochs', 100),
    batch_size=CONFIG.get('batchSize', 32),
    callbacks=callbacks,
    verbose=1
)

# Evaluate
val_loss, val_acc = model.evaluate(X_val, y_val)
print(f"\\nValidation Loss: {val_loss:.4f}")
print(f"Validation Accuracy: {val_acc:.4f}")

# Save model and config
model.save('lstm_trading_model.keras')
model.save('lstm_trading_model.h5')

# Save for TensorFlow.js
!pip install -q tensorflowjs
import tensorflowjs as tfjs
tfjs.converters.save_keras_model(model, 'tfjs_model')

# Save scaler and config
np.save('scaler_min.npy', scaler.data_min_)
np.save('scaler_max.npy', scaler.data_max_)

config_out = {
    'sequenceLength': SEQUENCE_LENGTH,
    'features': FEATURES,
    'horizon': 1,
    'normalization': {
        'type': 'minmax',
        'params': {f: {'min': float(scaler.data_min_[i]), 'max': float(scaler.data_max_[i])} 
                   for i, f in enumerate(FEATURES)}
    },
    'confidenceThreshold': 0.6,
    'metrics': {
        'valLoss': float(val_loss),
        'valAccuracy': float(val_acc)
    },
    'trainedAt': datetime.now().isoformat()
}
with open('model_config.json', 'w') as f:
    json.dump(config_out, f, indent=2)

print("\\n✅ Training complete! Model saved.")
`,

  'intent-classifier': `
# Atlas ML - Intent Classification Training
# Platform: {platform}
# Job ID: {job_id}

import os
import json
import numpy as np
from datetime import datetime

# Install dependencies
!pip install -q transformers torch scikit-learn datasets accelerate

import torch
from transformers import (
    AutoTokenizer, 
    AutoModelForSequenceClassification,
    TrainingArguments,
    Trainer,
    EarlyStoppingCallback
)
from datasets import Dataset
from sklearn.metrics import accuracy_score, precision_recall_fscore_support
from sklearn.model_selection import train_test_split

print(f"PyTorch version: {torch.__version__}")
print(f"CUDA available: {torch.cuda.is_available()}")
if torch.cuda.is_available():
    print(f"GPU: {torch.cuda.get_device_name(0)}")

# Configuration
CONFIG = {config_json}

# Intent labels
INTENT_LABELS = [
    'command_execute',      # Run a command/action
    'command_stop',         # Stop/cancel something
    'question_factual',     # Asking for facts
    'question_how',         # How to do something
    'question_when',        # Time-related questions
    'question_where',       # Location questions
    'conversation_greeting', # Hi, hello
    'conversation_goodbye', # Bye, see you
    'conversation_thanks',  # Thank you
    'conversation_casual',  # Small talk
    'request_reminder',     # Set a reminder
    'request_search',       # Search for something
    'request_create',       # Create file/project
    'request_open',         # Open app/file
    'request_settings',     # Change settings
    'urgent_help',          # Need help urgently
    'feedback_positive',    # Good job, thanks
    'feedback_negative',    # That's wrong
    'clarification',        # Can you explain?
    'other'                 # Everything else
]

label2id = {label: i for i, label in enumerate(INTENT_LABELS)}
id2label = {i: label for label, i in label2id.items()}

# Load data
with open('{dataset_path}', 'r') as f:
    data = [json.loads(line) for line in f]

print(f"Loaded {len(data)} samples")

# Prepare dataset
texts = [d['text'] for d in data]
labels = [label2id[d['intent']] for d in data]

train_texts, val_texts, train_labels, val_labels = train_test_split(
    texts, labels, test_size=CONFIG.get('validationSplit', 0.2), random_state=42
)

# Load tokenizer and model
MODEL_NAME = 'distilbert-base-uncased'
tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
model = AutoModelForSequenceClassification.from_pretrained(
    MODEL_NAME,
    num_labels=len(INTENT_LABELS),
    id2label=id2label,
    label2id=label2id
)

# Tokenize
def tokenize(texts):
    return tokenizer(
        texts,
        padding='max_length',
        truncation=True,
        max_length=128,
        return_tensors='pt'
    )

train_encodings = tokenize(train_texts)
val_encodings = tokenize(val_texts)

# Create datasets
train_dataset = Dataset.from_dict({
    'input_ids': train_encodings['input_ids'],
    'attention_mask': train_encodings['attention_mask'],
    'labels': train_labels
})

val_dataset = Dataset.from_dict({
    'input_ids': val_encodings['input_ids'],
    'attention_mask': val_encodings['attention_mask'],
    'labels': val_labels
})

# Metrics
def compute_metrics(eval_pred):
    predictions, labels = eval_pred
    predictions = np.argmax(predictions, axis=1)
    precision, recall, f1, _ = precision_recall_fscore_support(labels, predictions, average='weighted')
    acc = accuracy_score(labels, predictions)
    return {'accuracy': acc, 'f1': f1, 'precision': precision, 'recall': recall}

# Training arguments
training_args = TrainingArguments(
    output_dir='./results',
    num_train_epochs=CONFIG.get('epochs', 10),
    per_device_train_batch_size=CONFIG.get('batchSize', 16),
    per_device_eval_batch_size=CONFIG.get('batchSize', 16),
    warmup_steps=CONFIG.get('warmupSteps', 500),
    weight_decay=0.01,
    logging_dir='./logs',
    logging_steps=100,
    eval_strategy='epoch',
    save_strategy='epoch',
    load_best_model_at_end=True,
    metric_for_best_model='f1',
    greater_is_better=True,
    fp16=CONFIG.get('mixedPrecision', True) and torch.cuda.is_available(),
    learning_rate=CONFIG.get('learningRate', 2e-5),
)

# Trainer
trainer = Trainer(
    model=model,
    args=training_args,
    train_dataset=train_dataset,
    eval_dataset=val_dataset,
    compute_metrics=compute_metrics,
    callbacks=[EarlyStoppingCallback(early_stopping_patience=CONFIG.get('earlyStoppingPatience', 3))]
)

# Train
trainer.train()

# Evaluate
results = trainer.evaluate()
print(f"\\nEvaluation Results:")
for key, value in results.items():
    print(f"  {key}: {value:.4f}")

# Save model
model.save_pretrained('./intent_model')
tokenizer.save_pretrained('./intent_model')

# Export to ONNX for faster inference
!pip install -q onnx onnxruntime
from transformers.convert_graph_to_onnx import convert

convert(
    framework='pt',
    model='./intent_model',
    output='intent_model.onnx',
    opset=12,
    tokenizer=tokenizer,
    pipeline_name='text-classification'
)

# Save config
config_out = {
    'modelType': 'intent-classifier',
    'baseModel': MODEL_NAME,
    'labels': INTENT_LABELS,
    'maxLength': 128,
    'metrics': results,
    'trainedAt': datetime.now().isoformat()
}
with open('model_config.json', 'w') as f:
    json.dump(config_out, f, indent=2)

print("\\n✅ Intent classifier training complete!")
`,

  'emotion-detection': `
# Atlas ML - Emotion Detection Training (HuBERT Fine-tuning)
# Platform: {platform}
# Job ID: {job_id}

import os
import json
import numpy as np
from datetime import datetime

# Install dependencies
!pip install -q transformers torch torchaudio datasets librosa soundfile accelerate

import torch
import torchaudio
from transformers import (
    HubertForSequenceClassification,
    Wav2Vec2FeatureExtractor,
    TrainingArguments,
    Trainer
)
from datasets import Dataset, Audio
from sklearn.metrics import accuracy_score, precision_recall_fscore_support
from sklearn.model_selection import train_test_split

print(f"PyTorch: {torch.__version__}")
print(f"CUDA: {torch.cuda.is_available()}")

CONFIG = {config_json}

# Emotion labels
EMOTION_LABELS = ['neutral', 'happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised']
label2id = {label: i for i, label in enumerate(EMOTION_LABELS)}
id2label = {i: label for label, i in label2id.items()}

# Load model and feature extractor
MODEL_NAME = 'facebook/hubert-large-ls960-ft'
feature_extractor = Wav2Vec2FeatureExtractor.from_pretrained(MODEL_NAME)
model = HubertForSequenceClassification.from_pretrained(
    MODEL_NAME,
    num_labels=len(EMOTION_LABELS),
    id2label=id2label,
    label2id=label2id
)

# Load dataset (expected: list of {audio_path, emotion})
with open('{dataset_path}', 'r') as f:
    data = [json.loads(line) for line in f]

print(f"Loaded {len(data)} audio samples")

# Prepare dataset
def load_audio(item):
    waveform, sr = torchaudio.load(item['audio_path'])
    if sr != 16000:
        resampler = torchaudio.transforms.Resample(sr, 16000)
        waveform = resampler(waveform)
    return {'audio': waveform.squeeze().numpy(), 'label': label2id[item['emotion']]}

processed_data = [load_audio(d) for d in data]

train_data, val_data = train_test_split(processed_data, test_size=0.2, random_state=42)

def preprocess(examples):
    audios = [e['audio'] for e in examples]
    inputs = feature_extractor(
        audios,
        sampling_rate=16000,
        return_tensors='pt',
        padding=True,
        max_length=16000 * 10,  # 10 seconds max
        truncation=True
    )
    inputs['labels'] = torch.tensor([e['label'] for e in examples])
    return inputs

# Create datasets
train_dataset = Dataset.from_list(train_data)
val_dataset = Dataset.from_list(val_data)

def compute_metrics(eval_pred):
    predictions, labels = eval_pred
    predictions = np.argmax(predictions, axis=1)
    precision, recall, f1, _ = precision_recall_fscore_support(labels, predictions, average='weighted')
    acc = accuracy_score(labels, predictions)
    return {'accuracy': acc, 'f1': f1, 'precision': precision, 'recall': recall}

training_args = TrainingArguments(
    output_dir='./results',
    num_train_epochs=CONFIG.get('epochs', 5),
    per_device_train_batch_size=CONFIG.get('batchSize', 8),
    per_device_eval_batch_size=CONFIG.get('batchSize', 8),
    warmup_steps=CONFIG.get('warmupSteps', 100),
    weight_decay=0.01,
    logging_dir='./logs',
    eval_strategy='epoch',
    save_strategy='epoch',
    load_best_model_at_end=True,
    fp16=torch.cuda.is_available(),
)

trainer = Trainer(
    model=model,
    args=training_args,
    train_dataset=train_dataset,
    eval_dataset=val_dataset,
    compute_metrics=compute_metrics,
)

trainer.train()
results = trainer.evaluate()

# Save
model.save_pretrained('./emotion_model')
feature_extractor.save_pretrained('./emotion_model')

config_out = {
    'modelType': 'emotion-detection',
    'baseModel': MODEL_NAME,
    'labels': EMOTION_LABELS,
    'sampleRate': 16000,
    'metrics': results,
    'trainedAt': datetime.now().isoformat()
}
with open('model_config.json', 'w') as f:
    json.dump(config_out, f, indent=2)

print("\\n✅ Emotion detection training complete!")
`,

  'speaker-id': `
# Atlas ML - Speaker Identification Training (Pyannote)
# Platform: {platform}
# Job ID: {job_id}

import os
import json
import numpy as np
from datetime import datetime

# Install dependencies
!pip install -q pyannote.audio torch torchaudio

import torch
from pyannote.audio import Model, Inference
from pyannote.audio.pipelines import SpeakerVerification

print(f"PyTorch: {torch.__version__}")
print(f"CUDA: {torch.cuda.is_available()}")

CONFIG = {config_json}

# For speaker ID, we typically use pre-trained embeddings from pyannote
# and train a simple classifier on top

# Load pre-trained embedding model
# Note: Requires HuggingFace token with pyannote/speaker-diarization-3.1 access
HF_TOKEN = os.environ.get('HF_TOKEN', '')
model = Model.from_pretrained("pyannote/embedding", use_auth_token=HF_TOKEN)
inference = Inference(model, window="whole")

# Load speaker samples
with open('{dataset_path}', 'r') as f:
    data = [json.loads(line) for line in f]

print(f"Processing {len(data)} speaker samples")

# Extract embeddings
embeddings = []
labels = []
speaker_names = list(set(d['speaker'] for d in data))
speaker2id = {name: i for i, name in enumerate(speaker_names)}

for sample in data:
    emb = inference(sample['audio_path'])
    embeddings.append(emb.numpy())
    labels.append(speaker2id[sample['speaker']])

X = np.array(embeddings)
y = np.array(labels)

# Train simple classifier
from sklearn.svm import SVC
from sklearn.model_selection import train_test_split, cross_val_score

X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

clf = SVC(kernel='rbf', probability=True)
clf.fit(X_train, y_train)

# Evaluate
scores = cross_val_score(clf, X, y, cv=5)
print(f"Cross-val accuracy: {scores.mean():.4f} (+/- {scores.std() * 2:.4f})")

test_acc = clf.score(X_test, y_test)
print(f"Test accuracy: {test_acc:.4f}")

# Save
import pickle
with open('speaker_classifier.pkl', 'wb') as f:
    pickle.dump({'classifier': clf, 'speakers': speaker_names, 'speaker2id': speaker2id}, f)

# Save mean embedding per speaker for fast lookup
speaker_embeddings = {}
for speaker in speaker_names:
    mask = y == speaker2id[speaker]
    speaker_embeddings[speaker] = X[mask].mean(axis=0).tolist()

with open('speaker_embeddings.json', 'w') as f:
    json.dump(speaker_embeddings, f)

config_out = {
    'modelType': 'speaker-id',
    'speakers': speaker_names,
    'embeddingDim': X.shape[1],
    'metrics': {'accuracy': float(test_acc), 'cvMean': float(scores.mean())},
    'trainedAt': datetime.now().isoformat()
}
with open('model_config.json', 'w') as f:
    json.dump(config_out, f, indent=2)

print("\\n✅ Speaker identification training complete!")
`,

  'wake-word': `
# Atlas ML - Custom Wake Word Training
# Note: Wake words are trained via Picovoice Console, not locally
# This script prepares and validates voice samples

import os
import json
import wave
import numpy as np
from datetime import datetime

CONFIG = {config_json}

# Validate wake word samples
samples_dir = '{dataset_path}'
samples = [f for f in os.listdir(samples_dir) if f.endswith('.wav')]
print(f"Found {len(samples)} wake word samples")

valid_samples = []
for sample in samples:
    path = os.path.join(samples_dir, sample)
    try:
        with wave.open(path, 'rb') as w:
            channels = w.getnchannels()
            rate = w.getframerate()
            frames = w.getnframes()
            duration = frames / rate
            
            if channels == 1 and rate == 16000 and 0.5 <= duration <= 3.0:
                valid_samples.append({
                    'path': path,
                    'duration': duration,
                    'valid': True
                })
            else:
                print(f"Invalid: {sample} (ch={channels}, rate={rate}, dur={duration:.2f}s)")
    except Exception as e:
        print(f"Error reading {sample}: {e}")

print(f"\\nValid samples: {len(valid_samples)}/{len(samples)}")
print("\\nTo train custom wake word:")
print("1. Go to https://console.picovoice.ai/")
print("2. Create new wake word model")
print("3. Upload validated samples")
print("4. Download .ppn file")
print("5. Place in assets/wake-words/")

config_out = {
    'modelType': 'wake-word',
    'phrase': CONFIG.get('wakeWordPhrase', 'Hey Jarvis'),
    'validSamples': len(valid_samples),
    'totalSamples': len(samples),
    'requirements': {
        'minSamples': 50,
        'sampleRate': 16000,
        'channels': 1,
        'minDuration': 0.5,
        'maxDuration': 3.0
    },
    'validatedAt': datetime.now().isoformat()
}
with open('validation_results.json', 'w') as f:
    json.dump(config_out, f, indent=2)
`,

  'llm-adapter': `
# Atlas ML - LLM LoRA Adapter Training
# Platform: {platform}
# Job ID: {job_id}

import os
import json
from datetime import datetime

# Install dependencies
!pip install -q transformers peft accelerate bitsandbytes datasets trl

import torch
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    BitsAndBytesConfig,
    TrainingArguments
)
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
from datasets import Dataset
from trl import SFTTrainer

print(f"PyTorch: {torch.__version__}")
print(f"CUDA: {torch.cuda.is_available()}")

CONFIG = {config_json}

# Model configuration
BASE_MODEL = CONFIG.get('baseModel', 'deepseek-ai/deepseek-coder-6.7b-base')

# Quantization config for efficiency
bnb_config = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_quant_type="nf4",
    bnb_4bit_compute_dtype=torch.float16,
    bnb_4bit_use_double_quant=True,
)

# Load model
model = AutoModelForCausalLM.from_pretrained(
    BASE_MODEL,
    quantization_config=bnb_config,
    device_map="auto",
    trust_remote_code=True
)
tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL, trust_remote_code=True)
tokenizer.pad_token = tokenizer.eos_token

# Prepare for LoRA
model = prepare_model_for_kbit_training(model)

# LoRA config
lora_config = LoraConfig(
    r=CONFIG.get('loraRank', 16),
    lora_alpha=CONFIG.get('loraAlpha', 32),
    lora_dropout=CONFIG.get('dropout', 0.05),
    bias="none",
    task_type="CAUSAL_LM",
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj"]
)

model = get_peft_model(model, lora_config)
model.print_trainable_parameters()

# Load dataset (JSONL with messages format)
with open('{dataset_path}', 'r') as f:
    data = [json.loads(line) for line in f]

print(f"Loaded {len(data)} training examples")

# Format for training
def format_example(example):
    messages = example['messages']
    text = ""
    for msg in messages:
        if msg['role'] == 'system':
            text += f"System: {msg['content']}\\n\\n"
        elif msg['role'] == 'user':
            text += f"User: {msg['content']}\\n\\n"
        elif msg['role'] == 'assistant':
            text += f"Assistant: {msg['content']}\\n\\n"
    return {'text': text}

formatted_data = [format_example(d) for d in data]
dataset = Dataset.from_list(formatted_data)

# Training
training_args = TrainingArguments(
    output_dir="./lora_adapter",
    num_train_epochs=CONFIG.get('epochs', 3),
    per_device_train_batch_size=CONFIG.get('batchSize', 4),
    gradient_accumulation_steps=4,
    learning_rate=CONFIG.get('learningRate', 2e-4),
    warmup_steps=CONFIG.get('warmupSteps', 100),
    logging_steps=10,
    save_strategy="epoch",
    fp16=True,
    optim="paged_adamw_8bit",
)

trainer = SFTTrainer(
    model=model,
    train_dataset=dataset,
    args=training_args,
    tokenizer=tokenizer,
    max_seq_length=2048,
    dataset_text_field="text",
)

trainer.train()

# Save adapter
model.save_pretrained("./lora_adapter")
tokenizer.save_pretrained("./lora_adapter")

# Merge and save full model (optional)
merged_model = model.merge_and_unload()
merged_model.save_pretrained("./merged_model")

config_out = {
    'modelType': 'llm-adapter',
    'baseModel': BASE_MODEL,
    'loraRank': CONFIG.get('loraRank', 16),
    'loraAlpha': CONFIG.get('loraAlpha', 32),
    'trainedAt': datetime.now().isoformat()
}
with open('model_config.json', 'w') as f:
    json.dump(config_out, f, indent=2)

print("\\n✅ LoRA adapter training complete!")
`,

  'anomaly-detection': `
# Atlas ML - System Anomaly Detection Training
# Platform: {platform}
# Job ID: {job_id}

import os
import json
import numpy as np
import pandas as pd
from datetime import datetime

# Install dependencies
!pip install -q scikit-learn joblib

from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split
import joblib

CONFIG = {config_json}

# Load system metrics data
df = pd.read_csv('{dataset_path}')
print(f"Loaded {len(df)} metric samples")
print(f"Features: {list(df.columns)}")

# Expected features: cpu_percent, memory_percent, disk_io, network_io, process_count, etc.
FEATURES = CONFIG.get('features', [
    'cpu_percent', 'memory_percent', 'disk_read_mb', 'disk_write_mb',
    'network_recv_mb', 'network_sent_mb', 'process_count', 'thread_count'
])

# Filter to available features
available_features = [f for f in FEATURES if f in df.columns]
X = df[available_features].values

# Normalize
scaler = StandardScaler()
X_scaled = scaler.fit_transform(X)

# Train Isolation Forest
contamination = CONFIG.get('contamination', 0.01)  # Expected anomaly rate
model = IsolationForest(
    n_estimators=CONFIG.get('nEstimators', 200),
    contamination=contamination,
    max_samples='auto',
    random_state=42,
    n_jobs=-1
)

model.fit(X_scaled)

# Evaluate on training data
predictions = model.predict(X_scaled)
anomalies = (predictions == -1).sum()
print(f"\\nDetected {anomalies} anomalies ({anomalies/len(X)*100:.2f}%)")

# Get anomaly scores
scores = model.decision_function(X_scaled)
print(f"Score range: {scores.min():.4f} to {scores.max():.4f}")
print(f"Threshold: {np.percentile(scores, contamination*100):.4f}")

# Save model
joblib.dump(model, 'anomaly_detector.joblib')
joblib.dump(scaler, 'scaler.joblib')

config_out = {
    'modelType': 'anomaly-detection',
    'features': available_features,
    'contamination': contamination,
    'nEstimators': CONFIG.get('nEstimators', 200),
    'scoreThreshold': float(np.percentile(scores, contamination*100)),
    'trainSamples': len(X),
    'trainedAt': datetime.now().isoformat()
}
with open('model_config.json', 'w') as f:
    json.dump(config_out, f, indent=2)

print("\\n✅ Anomaly detection training complete!")
`,

  'embedding-model': `
# Atlas ML - Custom Embedding Model Training
# Platform: {platform}
# Job ID: {job_id}

import os
import json
from datetime import datetime

# Install dependencies
!pip install -q sentence-transformers torch

import torch
from sentence_transformers import SentenceTransformer, InputExample, losses
from sentence_transformers.evaluation import EmbeddingSimilarityEvaluator
from torch.utils.data import DataLoader

print(f"PyTorch: {torch.__version__}")
print(f"CUDA: {torch.cuda.is_available()}")

CONFIG = {config_json}

# Load base model
BASE_MODEL = CONFIG.get('baseModel', 'all-MiniLM-L6-v2')
model = SentenceTransformer(BASE_MODEL)

# Load training data (pairs with similarity scores)
with open('{dataset_path}', 'r') as f:
    data = [json.loads(line) for line in f]

print(f"Loaded {len(data)} training pairs")

# Create training examples
train_examples = [
    InputExample(texts=[d['text1'], d['text2']], label=d['similarity'])
    for d in data
]

# DataLoader
train_dataloader = DataLoader(train_examples, shuffle=True, batch_size=CONFIG.get('batchSize', 16))

# Loss function
train_loss = losses.CosineSimilarityLoss(model)

# Evaluate
val_examples = train_examples[:100]  # Use first 100 for validation
evaluator = EmbeddingSimilarityEvaluator.from_input_examples(val_examples, name='val')

# Train
model.fit(
    train_objectives=[(train_dataloader, train_loss)],
    epochs=CONFIG.get('epochs', 4),
    warmup_steps=CONFIG.get('warmupSteps', 100),
    evaluator=evaluator,
    evaluation_steps=500,
    output_path='./embedding_model'
)

# Save
model.save('./embedding_model')

config_out = {
    'modelType': 'embedding-model',
    'baseModel': BASE_MODEL,
    'embeddingDim': model.get_sentence_embedding_dimension(),
    'trainedAt': datetime.now().isoformat()
}
with open('model_config.json', 'w') as f:
    json.dump(config_out, f, indent=2)

print("\\n✅ Embedding model training complete!")
`,

  'hyde-generator': `
# Atlas ML - HyDE (Hypothetical Document Embeddings) Generator Training
# Platform: {platform}
# Job ID: {job_id}

import os
import json
from datetime import datetime

# Install dependencies
!pip install -q transformers torch datasets accelerate

import torch
from transformers import (
    AutoModelForSeq2SeqLM,
    AutoTokenizer,
    TrainingArguments,
    Trainer,
    DataCollatorForSeq2Seq
)
from datasets import Dataset

print(f"PyTorch: {torch.__version__}")
print(f"CUDA: {torch.cuda.is_available()}")

CONFIG = {config_json}

# HyDE: Given a query, generate a hypothetical document that would answer it
# Then use the document's embedding for retrieval

# Load model (T5 or similar)
MODEL_NAME = CONFIG.get('baseModel', 'google/flan-t5-base')
tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
model = AutoModelForSeq2SeqLM.from_pretrained(MODEL_NAME)

# Load training data (query -> hypothetical answer pairs)
with open('{dataset_path}', 'r') as f:
    data = [json.loads(line) for line in f]

print(f"Loaded {len(data)} query-document pairs")

# Prepare dataset
def preprocess(example):
    # Input: query, Output: hypothetical document
    input_text = f"Generate a document that answers: {example['query']}"
    target_text = example['document']
    
    inputs = tokenizer(input_text, max_length=256, truncation=True, padding='max_length')
    targets = tokenizer(target_text, max_length=512, truncation=True, padding='max_length')
    
    inputs['labels'] = targets['input_ids']
    return inputs

dataset = Dataset.from_list(data)
tokenized = dataset.map(preprocess, remove_columns=dataset.column_names)

train_test = tokenized.train_test_split(test_size=0.1)

# Training
training_args = TrainingArguments(
    output_dir='./hyde_model',
    num_train_epochs=CONFIG.get('epochs', 3),
    per_device_train_batch_size=CONFIG.get('batchSize', 8),
    per_device_eval_batch_size=CONFIG.get('batchSize', 8),
    warmup_steps=CONFIG.get('warmupSteps', 100),
    weight_decay=0.01,
    logging_dir='./logs',
    eval_strategy='epoch',
    save_strategy='epoch',
    load_best_model_at_end=True,
    fp16=torch.cuda.is_available(),
)

data_collator = DataCollatorForSeq2Seq(tokenizer, model=model)

trainer = Trainer(
    model=model,
    args=training_args,
    train_dataset=train_test['train'],
    eval_dataset=train_test['test'],
    data_collator=data_collator,
)

trainer.train()

# Save
model.save_pretrained('./hyde_model')
tokenizer.save_pretrained('./hyde_model')

config_out = {
    'modelType': 'hyde-generator',
    'baseModel': MODEL_NAME,
    'maxInputLength': 256,
    'maxOutputLength': 512,
    'trainedAt': datetime.now().isoformat()
}
with open('model_config.json', 'w') as f:
    json.dump(config_out, f, indent=2)

print("\\n✅ HyDE generator training complete!")
`,
};

// =============================================================================
// Training Orchestrator Class
// =============================================================================

export class TrainingOrchestrator extends EventEmitter {
  private config: OrchestratorConfig;
  private storagePath: string;
  private jobs: Map<string, UnifiedTrainingJob> = new Map();
  private initialized: boolean = false;

  // Platform handlers
  private kaggle?: KaggleAutomation;
  private colab?: ColabAutomation;
  private fireworks?: DeepSeekFineTuneManager;

  constructor(config?: Partial<OrchestratorConfig>) {
    super();
    this.config = { ...DEFAULT_ORCHESTRATOR_CONFIG, ...config };
    this.storagePath =
      this.config.storagePath || path.join(app.getPath('userData'), 'ml', 'orchestrator');
  }

  /**
   * Initialize the orchestrator
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    logger.info('Initializing TrainingOrchestrator', { path: this.storagePath });

    await fs.ensureDir(this.storagePath);
    await fs.ensureDir(path.join(this.storagePath, 'datasets'));
    await fs.ensureDir(path.join(this.storagePath, 'models'));

    // Initialize platform handlers
    this.kaggle = getKaggleAutomation();
    await this.kaggle.initialize();

    // Note: Colab and Fireworks would be initialized similarly
    // this.colab = new ColabAutomation();
    // this.fireworks = new DeepSeekFineTuning();

    // Load existing jobs
    await this.loadJobs();

    this.initialized = true;
    logger.info('TrainingOrchestrator initialized', { jobCount: this.jobs.size });
  }

  /**
   * Load existing jobs
   */
  private async loadJobs(): Promise<void> {
    const indexPath = path.join(this.storagePath, 'jobs.json');
    if (await fs.pathExists(indexPath)) {
      try {
        const data = await fs.readJson(indexPath);
        for (const [id, job] of Object.entries(data)) {
          this.jobs.set(id, job as UnifiedTrainingJob);
        }
      } catch (err) {
        logger.error('Failed to load jobs', { error: err });
      }
    }
  }

  /**
   * Save jobs
   */
  private async saveJobs(): Promise<void> {
    const indexPath = path.join(this.storagePath, 'jobs.json');
    await fs.writeJson(indexPath, Object.fromEntries(this.jobs), { spaces: 2 });
  }

  /**
   * Select best platform for training
   */
  private selectPlatform(config: TrainingConfig): TrainingPlatform {
    if (config.preferredPlatform) {
      return config.preferredPlatform;
    }

    const preferences = this.config.platformPreferences[config.type];
    if (!preferences || preferences.length === 0) {
      return 'kaggle'; // Default to Kaggle
    }

    // Check platform availability
    for (const platform of preferences) {
      switch (platform) {
        case 'kaggle':
          if (this.kaggle?.isAvailable()) return 'kaggle';
          break;
        case 'fireworks':
          if (this.config.fireworksApiKey) return 'fireworks';
          break;
        case 'colab':
          // Colab requires manual setup, always available
          return 'colab';
        case 'local':
          return 'local';
      }
    }

    return preferences[0];
  }

  /**
   * Generate training code for a job
   */
  private generateTrainingCode(job: UnifiedTrainingJob): string {
    const template = TRAINING_TEMPLATES[job.config.type];
    if (!template) {
      throw new Error(`No template for training type: ${job.config.type}`);
    }

    const configJson = JSON.stringify(job.config.hyperparameters, null, 2);

    return template
      .replace('{platform}', job.platform)
      .replace('{job_id}', job.id)
      .replace('{config_json}', configJson)
      .replace('{dataset_path}', job.config.datasetPath || 'dataset.csv');
  }

  /**
   * Create a new training job
   */
  async createJob(config: TrainingConfig): Promise<UnifiedTrainingJob> {
    const id = `train_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const platform = this.selectPlatform(config);

    const job: UnifiedTrainingJob = {
      id,
      config,
      platform,
      status: 'pending',
      createdAt: Date.now(),
      logs: [],
    };

    this.jobs.set(id, job);
    await this.saveJobs();

    this.emit('job-created', job);
    logger.info('Created training job', { id, type: config.type, platform });

    return job;
  }

  /**
   * Start a training job
   */
  async startJob(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    if (job.status !== 'pending') {
      throw new Error(`Job is not pending: ${job.status}`);
    }

    try {
      job.status = 'preparing-data';
      job.logs.push(`[${new Date().toISOString()}] Preparing training data...`);
      await this.saveJobs();

      // Generate training code
      const trainingCode = this.generateTrainingCode(job);

      // Start on selected platform
      switch (job.platform) {
        case 'kaggle':
          await this.startKaggleJob(job, trainingCode);
          break;
        case 'colab':
          await this.startColabJob(job, trainingCode);
          break;
        case 'fireworks':
          await this.startFireworksJob(job);
          break;
        case 'local':
          await this.startLocalJob(job, trainingCode);
          break;
      }

      job.status = 'training';
      job.startedAt = Date.now();
      await this.saveJobs();
      this.emit('job-started', job);
    } catch (err) {
      job.status = 'failed';
      job.error = (err as Error).message;
      job.logs.push(`[${new Date().toISOString()}] ERROR: ${job.error}`);
      await this.saveJobs();
      this.emit('job-failed', job);
      throw err;
    }
  }

  /**
   * Start job on Kaggle
   */
  private async startKaggleJob(job: UnifiedTrainingJob, code: string): Promise<void> {
    if (!this.kaggle) {
      throw new Error('Kaggle not initialized');
    }

    const kaggleJob = await this.kaggle.createJob(
      job.config.type as KaggleJob['type'],
      job.config.datasetPath || '',
      code,
      {
        title: job.config.name,
        accelerator: 'gpu',
        enableGpu: true,
        enableInternet: true,
      }
    );

    job.platformJobId = kaggleJob.id;
    job.logs.push(`[${new Date().toISOString()}] Created Kaggle job: ${kaggleJob.id}`);

    // Start the Kaggle job
    await this.kaggle.startJob(kaggleJob.id);
  }

  /**
   * Start job on Colab (generates notebook)
   */
  private async startColabJob(job: UnifiedTrainingJob, code: string): Promise<void> {
    // Generate Colab notebook
    const notebookPath = path.join(this.storagePath, 'notebooks', `${job.id}.ipynb`);
    await fs.ensureDir(path.dirname(notebookPath));

    const notebook = this.codeToNotebook(code, job.config.name);
    await fs.writeJson(notebookPath, notebook, { spaces: 2 });

    job.logs.push(`[${new Date().toISOString()}] Generated Colab notebook: ${notebookPath}`);
    job.logs.push(`[${new Date().toISOString()}] Upload to Google Colab to run`);
    job.logs.push(`[${new Date().toISOString()}] Or use Colab API for automation`);

    // In a full implementation, you'd use the Colab API here
    // For now, we just generate the notebook
  }

  /**
   * Start job on Fireworks (LLM fine-tuning)
   */
  private async startFireworksJob(job: UnifiedTrainingJob): Promise<void> {
    if (!this.config.fireworksApiKey) {
      throw new Error('Fireworks API key not configured');
    }

    // Use Fireworks RFT API
    job.logs.push(`[${new Date().toISOString()}] Submitting to Fireworks RFT API...`);

    // In a full implementation, you'd call the Fireworks API
    // This integrates with the existing deepseek-finetuning.ts
  }

  /**
   * Start job locally
   */
  private async startLocalJob(job: UnifiedTrainingJob, code: string): Promise<void> {
    const scriptPath = path.join(this.storagePath, 'scripts', `${job.id}.py`);
    await fs.ensureDir(path.dirname(scriptPath));
    await fs.writeFile(scriptPath, code);

    job.logs.push(`[${new Date().toISOString()}] Generated local script: ${scriptPath}`);
    job.logs.push(`[${new Date().toISOString()}] Run with: python ${scriptPath}`);

    // In a full implementation, you'd spawn a Python process
  }

  /**
   * Convert code to Jupyter notebook format
   */
  private codeToNotebook(code: string, title: string): object {
    const cells: object[] = code.split(/\n# %%\n/).map((cellCode) => ({
      cell_type: 'code',
      execution_count: null,
      metadata: {},
      outputs: [],
      source: cellCode.split('\n').map((line, i, arr) => (i < arr.length - 1 ? line + '\n' : line)),
    }));

    // Add title cell (markdown cells don't need execution_count/outputs)
    cells.unshift({
      cell_type: 'markdown',
      metadata: {},
      source: [`# ${title}\n`, '\n', `Generated by Atlas ML Training Orchestrator\n`],
    });

    return {
      metadata: {
        kernelspec: {
          display_name: 'Python 3',
          language: 'python',
          name: 'python3',
        },
        accelerator: 'GPU',
      },
      nbformat: 4,
      nbformat_minor: 4,
      cells,
    };
  }

  /**
   * Get job status
   */
  async getJobStatus(jobId: string): Promise<UnifiedTrainingJob | undefined> {
    return this.jobs.get(jobId);
  }

  /**
   * Get all jobs
   */
  getJobs(): UnifiedTrainingJob[] {
    return Array.from(this.jobs.values());
  }

  /**
   * Cancel a job
   */
  async cancelJob(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    if (job.platform === 'kaggle' && job.platformJobId && this.kaggle) {
      await this.kaggle.cancelJob(job.platformJobId);
    }

    job.status = 'cancelled';
    job.logs.push(`[${new Date().toISOString()}] Job cancelled`);
    await this.saveJobs();

    logger.info('Job cancelled', { jobId });
  }

  /**
   * Deploy a trained model
   */
  async deployModel(jobId: string): Promise<string> {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    if (job.status !== 'completed') {
      throw new Error(`Job not completed: ${job.status}`);
    }

    if (!job.modelPath) {
      throw new Error('No model path available');
    }

    job.status = 'deploying';
    job.logs.push(`[${new Date().toISOString()}] Deploying model...`);
    await this.saveJobs();

    // Register with model registry
    const registry = getModelRegistry();
    await registry.initialize();

    const modelMetadata = await registry.registerModel(
      job.config.name,
      this.mapTrainingTypeToModelType(job.config.type) as ModelType,
      `v${Date.now()}`,
      {
        description: job.config.description,
        path: job.modelPath,
        training: {
          datasetSize: job.datasetStats?.samples,
          epochs: job.config.hyperparameters.epochs,
          learningRate: job.config.hyperparameters.learningRate,
          loss: job.finalMetrics?.loss,
          validationLoss: job.finalMetrics?.valLoss,
          trainingTimeMs: job.completedAt ? job.completedAt - (job.startedAt || job.createdAt) : undefined,
        },
      }
    );

    job.registeredModelId = modelMetadata.id;
    job.status = 'deployed';
    job.deployedAt = Date.now();
    job.logs.push(`[${new Date().toISOString()}] Model deployed: ${modelMetadata.id}`);
    await this.saveJobs();

    this.emit('job-deployed', job);
    logger.info('Model deployed', { jobId, modelId: modelMetadata.id });

    return modelMetadata.id;
  }

  /**
   * Map training type to model registry type
   */
  private mapTrainingTypeToModelType(type: ModelTrainingType): string {
    const mapping: Record<ModelTrainingType, string> = {
      'lstm-trading': 'trading-lstm',
      'intent-classifier': 'custom',
      'emotion-detection': 'emotion',
      'speaker-id': 'speaker-id',
      'wake-word': 'wake-word',
      'llm-adapter': 'llm-adapter',
      'anomaly-detection': 'custom',
      'embedding-model': 'custom',
      'hyde-generator': 'custom',
    };
    return mapping[type] || 'custom';
  }

  /**
   * Cleanup old jobs
   */
  async cleanup(): Promise<number> {
    const maxAge = this.config.autoCleanupDays * 24 * 60 * 60 * 1000;
    const now = Date.now();
    let cleaned = 0;

    for (const [id, job] of this.jobs.entries()) {
      if (
        now - job.createdAt > maxAge &&
        ['completed', 'failed', 'cancelled', 'deployed'].includes(job.status)
      ) {
        this.jobs.delete(id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      await this.saveJobs();
      logger.info('Cleaned up old jobs', { count: cleaned });
    }

    return cleaned;
  }

  /**
   * Destroy the orchestrator
   */
  destroy(): void {
    this.removeAllListeners();
    logger.info('TrainingOrchestrator destroyed');
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let instance: TrainingOrchestrator | null = null;

export function getTrainingOrchestrator(): TrainingOrchestrator {
  if (!instance) {
    instance = new TrainingOrchestrator();
  }
  return instance;
}

export function destroyTrainingOrchestrator(): void {
  if (instance) {
    instance.destroy();
    instance = null;
  }
}

export default TrainingOrchestrator;
