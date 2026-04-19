# QWEN Setup Guide

QWEN is Alibaba's family of generative AI models.

## Getting Started

```bash
# QWEN is available via DashScope API
# Visit: https://www.qwen.ai/
```

## Installation

Depending on how you use QWEN:

**Via SDK:**
```bash
# Python SDK
pip install dashscope

# Node.js SDK
npm install dashscope-sdk
```

**Via API:**
```bash
# Get API key from https://dashscope.console.aliyun.com/
export DASHSCOPE_API_KEY='your-api-key'
```

## Configuration

### Global Config
```bash
export DASHSCOPE_API_KEY='your-api-key'
```

### Project-Specific
Add to `.agent/config.json`:

```json
{
  "provider": "qwen",
  "provider_options": {
    "model": "qwen-plus",
    "api_key": "your-key"
  }
}
```

## Models Available

- `qwen-turbo` - Fast, lightweight
- `qwen-plus` - Balanced performance
- `qwen-max` - Most capable
- `qwen-long` - For long documents

## Using QWEN with pavilio

1. Create project: `npm run create-project`
2. Choose "qwen" as provider
3. Get API key from https://dashscope.console.aliyun.com/
4. Add to `.agent/config.json`:

```json
{
  "provider": "qwen",
  "provider_options": {
    "model": "qwen-plus"
  }
}
```

5. Set environment variable: `export DASHSCOPE_API_KEY='your-key'`

## Documentation

- https://www.qwen.ai/
- https://help.aliyun.com/document_detail/2712430.html (DashScope API docs)

## Troubleshooting

**"API key not found"**
- Get key from: https://dashscope.console.aliyun.com/
- Set environment: `export DASHSCOPE_API_KEY='your-key'`

**"Rate limit exceeded"**
- Check your API quota at DashScope console
- Upgrade plan if needed

---

See main README for switching between providers.
