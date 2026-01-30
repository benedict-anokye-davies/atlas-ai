#!/bin/bash
# Restart Atlas with API keys

echo "🔄 Restarting Atlas Desktop..."
echo ""

# Kill any existing Electron processes
echo "Stopping any running Atlas instances..."
pkill -f electron || true
sleep 2

# Verify API keys are loaded
echo "Verifying API keys..."
export $(cat .env | grep -v '^#' | xargs)

if [ -n "$FIREWORKS_API_KEY" ]; then
    echo "✅ Fireworks API Key: ${FIREWORKS_API_KEY:0:8}...${FIREWORKS_API_KEY: -4}"
else
    echo "❌ Fireworks API Key not found!"
    exit 1
fi

echo ""
echo "🚀 Starting Atlas Desktop with LLM enabled..."
echo ""
npm run dev
