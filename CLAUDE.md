# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A Slack bot running on Cloudflare Workers that processes images posted to Slack channels. When mentioned or in DMs, it downloads images, optionally transforms them using Google Gemini API, and re-uploads them as file attachments back to the channel/thread.

## Development Commands

```bash
# Install dependencies (dev-only TypeScript types)
bun install

# Run local development server with Wrangler
bun run dev

# Deploy to Cloudflare Workers
bun run deploy

# Type check
bun run check

# Generate Cloudflare Worker types
bun run types

# Test Gemini API locally
bun run gemini:local

# Generate app icon
bun run icon:make

# Monitor Worker logs
bun run logs:start  # Start background tail
bun run logs:follow # Follow log output
bun run logs:stop   # Stop log tail
```

## Architecture

### Core Components
- **src/worker.ts**: Main entry point, handles Slack Events API webhooks, implements deduplication via KV storage
- **src/slack.ts**: Slack API helpers including signature verification and API wrappers
- **src/gemini.ts**: Google Gemini image generation/transformation functions
- **src/log.ts**: Structured logging utilities

### Key Features
- **Event Processing**: Validates Slack signatures, handles `message` and `app_mention` events
- **Deduplication**: Uses Cloudflare KV (`nano_banana_dedup`) to prevent duplicate processing
- **Image Handling**: Downloads images from Slack, transforms via Gemini (if prompt provided), uploads results back
- **Thread Awareness**: Maintains conversation context in Slack threads

## Environment Setup

### Local Development (.dev.vars)
```
SLACK_SIGNING_SECRET=your_secret
SLACK_BOT_TOKEN=xoxb-...
GEMINI_API_KEY=your_api_key
```

### Production Secrets (Cloudflare)
```bash
bunx wrangler secret put SLACK_SIGNING_SECRET
bunx wrangler secret put SLACK_BOT_TOKEN
bunx wrangler secret put GEMINI_API_KEY
```

## Slack App Configuration

### Event Subscriptions
- Request URL: `https://your-worker.workers.dev/slack/events`
- Subscribe to: `message.channels`, `message.groups`, `message.im`, `app_mention`

### Bot Token Scopes
- `files:read`, `files:write`
- `channels:history`, `groups:history`, `im:history`
- `chat:write`, `reactions:write`
- `app_mentions:read`

## Processing Logic

1. Bot only processes messages when:
   - Directly mentioned (`@bot`)
   - In a thread where root message mentioned the bot
   - Direct message (DM) to the bot
   - `app_mention` event

2. Image processing flow:
   - Downloads images from current message only
   - If GEMINI_API_KEY and prompt exist: transforms via Gemini API
   - Otherwise: echoes original image
   - Uploads result as Slack file attachment

3. Multiple images: Combined into single output using Gemini's batch processing

## Debugging

- Set `GEMINI_DEBUG=true` to upload debug JSON files on Gemini failures
- Use `LOG_LEVEL=debug` for verbose logging
- Monitor with `bun run logs:follow` for real-time Worker logs