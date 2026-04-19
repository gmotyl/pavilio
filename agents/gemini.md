# Gemini Setup Guide

Gemini is Google's generative AI platform.

## Getting Started

```bash
# Visit: https://gemini.google.com/
# Or use Google AI Studio: https://aistudio.google.com/
```

## Installation

**Via SDK:**
```bash
# Python SDK
pip install google-generativeai

# Node.js SDK
npm install @google/generative-ai
```

## Getting API Key

1. Go to: https://aistudio.google.com/app/apikey
2. Click "Get API Key"
3. Create new API key or use existing
4. Copy and save securely

## Configuration

### Global Config
```bash
export GOOGLE_API_KEY='your-api-key'
```

### Project-Specific
Add to `.agent/config.json`:

```json
{
  "provider": "gemini",
  "provider_options": {
    "model": "gemini-pro",
    "api_key": "your-key"
  }
}
```

## Models Available

- `gemini-pro` - General purpose
- `gemini-pro-vision` - With vision capabilities
- `gemini-1.5-pro` - Latest, most capable
- `gemini-1.5-flash` - Fast and efficient

## Using Gemini with pavilio

1. Create project: `npm run create-project`
2. Choose "gemini" as provider
3. Get API key from https://aistudio.google.com/app/apikey
4. Add to `.agent/config.json`:

```json
{
  "provider": "gemini",
  "provider_options": {
    "model": "gemini-1.5-pro"
  }
}
```

5. Set environment variable: `export GOOGLE_API_KEY='your-key'`

## Documentation

- https://gemini.google.com/
- https://aistudio.google.com/
- https://ai.google.dev/

## Troubleshooting

**"API key not found"**
- Get key from: https://aistudio.google.com/app/apikey
- Set environment: `export GOOGLE_API_KEY='your-key'`

**"Model not available"**
- Check your plan allows access to the model
- Some models may require paid tier

---

See main README for switching between providers.
