/**
 * @fileoverview verify-api-keys.ts - Verify API keys are configured correctly
 */

import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env file explicitly
config({ path: resolve(process.cwd(), '.env') });

console.log('🔍 Checking API Keys...\n');

const keys = {
  'Fireworks AI (LLM)': process.env.FIREWORKS_API_KEY,
  'Deepgram (STT)': process.env.DEEPGRAM_API_KEY,
  'Cartesia (TTS)': process.env.CARTESIA_API_KEY,
  'ElevenLabs (TTS fallback)': process.env.ELEVENLABS_API_KEY,
  'Perplexity (Search)': process.env.PERPLEXITY_API_KEY,
};

let allValid = true;

for (const [name, value] of Object.entries(keys)) {
  if (value && value.length > 10) {
    const masked = value.substring(0, 8) + '...' + value.substring(value.length - 4);
    console.log(`✅ ${name}: ${masked}`);
  } else {
    console.log(`❌ ${name}: NOT SET or INVALID`);
    allValid = false;
  }
}

console.log('\n' + (allValid ? '✅ All API keys configured!' : '⚠️  Some API keys missing'));

// Test Fireworks connectivity
if (process.env.FIREWORKS_API_KEY) {
  console.log('\n🧪 Testing Fireworks API connectivity...');

  fetch('https://api.fireworks.ai/inference/v1/models', {
    headers: {
      Authorization: `Bearer ${process.env.FIREWORKS_API_KEY}`,
    },
  })
    .then((res) => {
      if (res.ok) {
        console.log('✅ Fireworks API connection successful!');
      } else {
        console.log(`❌ Fireworks API error: ${res.status} ${res.statusText}`);
      }
    })
    .catch((err) => {
      console.log(`❌ Fireworks connection failed: ${err.message}`);
    });
}
