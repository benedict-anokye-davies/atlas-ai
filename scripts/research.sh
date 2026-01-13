#!/bin/bash
# research.sh - Query Perplexity API for development research
# Usage: ./research.sh "your question here"

# Check for API key
if [ -z "$PERPLEXITY_API_KEY" ]; then
    if [ -f .env ]; then
        source .env
    fi
fi

if [ -z "$PERPLEXITY_API_KEY" ]; then
    echo "ERROR: PERPLEXITY_API_KEY not set"
    echo "Add it to .env or export PERPLEXITY_API_KEY=your_key"
    exit 1
fi

# Get question from argument
QUESTION="${1:-How to implement a voice assistant in Electron?}"

echo "═══════════════════════════════════════════════════════════"
echo "  PERPLEXITY RESEARCH"
echo "  Query: $QUESTION"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Call Perplexity API
curl -s https://api.perplexity.ai/chat/completions \
  -H "Authorization: Bearer $PERPLEXITY_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"sonar\",
    \"messages\": [
      {
        \"role\": \"system\",
        \"content\": \"You are a helpful research assistant for software development. Provide concise, actionable answers with code examples when relevant. Focus on Node.js, TypeScript, and Electron development.\"
      },
      {
        \"role\": \"user\",
        \"content\": \"$QUESTION\"
      }
    ],
    \"max_tokens\": 2000
  }" | jq -r '.choices[0].message.content // .error.message // "Error: No response"'

echo ""
echo "═══════════════════════════════════════════════════════════"
