# System Architecture — Nano Banana Slack Bot

This document describes the components, data flow, and operational concerns of the Nano Banana Slack bot.

## Overview

The bot is a single Cloudflare Worker that receives Slack Events API webhooks, validates signatures, decides whether to process an event, optionally calls Google Gemini to transform images, and posts the result back to Slack as a file attachment. A Cloudflare KV namespace is used for simple deduplication.

## Components

- Cloudflare Worker (TypeScript): `src/worker.ts`
  - HTTP routing (`/slack/events`, `/healthz`)
  - Event ACK and async processing via `ctx.waitUntil`
  - Reaction markers, image collection, prompt preparation, uploads
- Slack Helpers: `src/slack.ts`
  - HMAC v0 signature verification + ±300s timestamp freshness check
  - JSON/Response helpers, text sanitization, image-only enforcement
- Gemini Client: `src/gemini.ts`
  - Single-image and multi-image (combined) requests
  - One-step fallback if no image is returned
- Logging: `src/log.ts`
  - Structured logs with levels; Gemini calls emit a correlation id (gid)
- Dedup Store: Cloudflare KV (`nano_banana_dedup`)
  - Keys: `eid:<event_id>`, `cts:<channel>:<ts>`, TTL 300s

## Data Flow

```mermaid
flowchart LR
  Slack-->|Events API| Worker[/Cloudflare Worker/]
  Worker -->|Verify HMAC + freshness| Decision{Process?}
  Decision -->|No| Ack[HTTP 200 OK]
  Decision -->|Yes| Proc[Process Event]
  Proc --> Dedupe{KV dedupe}
  Dedupe -->|Seen| Ack
  Dedupe -->|New| Collect[Collect Images + Prompt]
  Collect --> Sanitize[Sanitize Text + "出力は画像のみ。"]
  Sanitize --> Gemini[Gemini generateContent]
  Gemini -->|Image| Upload[Upload via files.getUploadURLExternal]
  Upload --> SlackOut[Slack File Post]
  Gemini -->|No image| Fallback[Retry with TEXT+IMAGE]
  Fallback -->|Image| Upload
  Fallback -->|No image| Error[Post error (gid) to thread]
```

## Event Handling

1. Verify signature using Slack v0 HMAC and reject if timestamp is older/newer than 300 seconds.
2. `url_verification` → respond with `challenge`; `event_callback` → ACK immediately and continue in background.
3. Dedupe using KV:
   - `eid:<event_id>` early
   - `cts:<channel>:<ts>` only for the event type we actually process
4. Decide to process when:
   - Direct message (IM), or
   - `app_mention`, or
   - Message mentions the bot `<@bot>`; or thread reply whose root mentioned the bot
5. Reactions: add a small reaction (default `:banana:`) to the current post and the thread root.
6. Image sources:
   - Current message attachments (image/*)
   - If replying with text only: reuse the latest bot image in the thread AND include current attachments (if any)
7. Prompt: sanitize Slack markup and append a short instruction (“出力は画像のみ。”).
8. Gemini:
   - Build parts as text-first + multiple inline images
   - Request `responseModalities=['IMAGE']`; if no image, retry once with `['TEXT','IMAGE']`
9. Upload: complete external upload to Slack (`image/png`) and post to the same channel/thread.
10. Errors: log with `gid` and post a short error including `gid` once.

## Security

- HMAC v0 signature verification, timing-safe compare
- ±300s timestamp freshness window to prevent replay
- KV TTL 300s reduces duplicate processing
- Bot token used only for Slack Web API; no secrets returned to clients

## Configuration

- Secrets: `SLACK_SIGNING_SECRET`, `SLACK_BOT_TOKEN`, `GEMINI_API_KEY`
- Vars: `LOG_LEVEL` (debug/info/warn/error), `REACTION_NAME` (default `banana`), `ENV`
- KV: `nano_banana_dedup`

## Observability

- Logs include structured JSON entries with levels and Gemini `gid`
- For additional visibility, set `GEMINI_DEBUG=true` to upload a small JSON on failure

## Known Limits / Future Work

- Add metrics (request counts, error rates, Gemini success ratio)
- Consider retries/backoff for Slack/Gemini HTTP errors (429/5xx)
- Optional unit tests for sanitizer and signature verification

