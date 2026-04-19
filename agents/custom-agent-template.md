# Custom Agent Setup Template

Use this template to add support for any other AI agent/provider.

## Overview

**Provider Name:** [Your provider name]
**Description:** [What this provider does]
**Website:** [Link to provider]
**Cost:** Free / Paid / Hybrid

## Installation

```bash
# Installation instructions for your provider
```

## Getting Started

```bash
# Basic commands to get started
```

## Configuration

### Global Config

Where to store global credentials:
```bash
export YOUR_PROVIDER_API_KEY='key'
```

### Project-Specific Config

Add to `.agent/config.json`:

```json
{
  "provider": "your-provider",
  "provider_options": {
    "model": "your-model",
    "api_key": "your-key"
  },
  "features": ["feature1", "feature2"],
  "notifications": {
    "enabled": true,
    "style": "system-sounds"
  }
}
```

## Features

- Feature 1: Description
- Feature 2: Description
- Feature 3: Description

## Using with pavilio

1. Create project: `npm run create-project`
2. Choose "custom" as provider, enter: "your-provider"
3. Get credentials from your provider
4. Update `.agent/config.json` with provider details
5. Start using your provider

## Sound Notifications

[Document how to setup notifications for your provider]

## Tips

- [Tip 1]
- [Tip 2]
- [Tip 3]

## Documentation

- [Link to provider docs]
- [Link to API docs]
- [Link to examples]

## Troubleshooting

**"Error message"**
- [How to fix]

**"Another error"**
- [How to fix]

---

To add this provider permanently:

1. Save this setup guide as `agents/[provider-name].md`
2. Create setup script: `scripts/setup:[provider-name]`
3. Update `scripts/create-project.sh` to include new provider
4. Update main README.md

Submit pull request to https://github.com/motyl-ai/pavilio
