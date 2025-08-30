# Nano Banana Slack Bot (Cloudflare Workers + TypeScript + Bun)

A minimal Slack bot that echoes posted images as file attachments via Events API. Runs on Cloudflare Workers, developed with Bun.

## Quick Start

- Prereqs: Bun, Wrangler, a Slack App with Events API enabled.
- Install types: `bun install` (dev-only deps)
- Local secrets: copy `.dev.vars.example` → `.dev.vars` and set values
- Prod secrets (Cloudflare):
  - `bunx wrangler secret put SLACK_SIGNING_SECRET`
  - `bunx wrangler secret put SLACK_BOT_TOKEN`
  - `bunx wrangler secret put GEMINI_API_KEY` (use Gemini for editing)
- Dev server: `bun run dev`
- Deploy: `bun run deploy`

## Slack Configuration

- Events:
  - Request URL: `<your-worker-url>/slack/events`
- Subscribe to bot events: `message.channels`, `message.groups` (private channels), `message.im` (optional: `app_mention`)
  - Scopes (Bot): `files:read`, `files:write`, `channels:history`, `groups:history` (private channels), `im:history`, `chat:write`, `reactions:write` (optional), `app_mentions:read` (optional)
  - App must be a member of the channel to reply with files
  - Optional (recommended for minimal firehose): add `app_mention` event and scope `app_mentions:read`

### Trigger Rules
- Processes only when the bot is mentioned in the message (`<@bot>`), or when replying in the thread of a message that mentioned the bot.
- Direct messages (`IM`) to the bot are always processed.
- Also processes `app_mention` events directly.
- If the current message has no image:
  - If you reply with text in a thread, the bot reuses the latest bot-posted image in that thread, applies your text as the prompt, and posts the new image (no extra text/comment added).
  - Even if your reply contains additional images, the bot still uses the previously generated image as the input when text is present.
  - If no prior bot image exists, it replies with guidance.

## Endpoints

- `POST /slack/events` — URL verification + ack + async image handling
- `GET  /healthz` — health check

## Notes

- This scaffold validates Slack signatures in the Workers runtime.
- Posts with images trigger an async echo: the bot downloads the image and re-uploads it as a file attachment to the same channel (thread-aware).
- To implement real editing with Gemini, this bot calls `gemini-2.5-flash-image-preview` via Generative Language API. If the post text contains a prompt, it is passed through verbatim to the model; if there is no text, the image is echoed without transformation.
 - Debug: set `GEMINI_DEBUG=true` (vars/secrets) to upload a small `gemini-debug-*.json` file in the thread on failures with details (finishReason, blockReason, etc.).


### About .env/.dev.vars
- Cloudflare Workers 本番は `.env` を読み込みません。機密値は `wrangler secret` に保存してください。
- ローカル開発は `.dev.vars` を自動で読み込みます（`.dev.vars.example` を参考に作成）。

## Project Layout

- `src/worker.ts` — Worker entry and routing
- `src/slack.ts` — Slack helpers (signature, forms, JSON)
  
- `slack-app-manifest.yaml` — Slack app manifest (Create App from manifest)

## Create Slack App from Manifest
1) Open https://api.slack.com/apps → Create New App → From an app manifest.
2) Select your workspace → Paste `slack-app-manifest.yaml` and replace `YOUR_WORKER_URL` with your Worker URL.
3) Install the app to the workspace. Ensure scopes are granted and events show as Verified.
4) Set secrets locally and in Cloudflare (see Quick Start).
