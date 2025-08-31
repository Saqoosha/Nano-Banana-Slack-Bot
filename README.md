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
  - If you reply with text in a thread, the bot reuses the latest bot-posted image in that thread AND any newly attached images as inputs in a single Gemini call, then posts ONE combined output image (no extra text/comment added).
  - If no prior bot image exists, it replies with guidance.

## Endpoints

- `POST /slack/events` — URL verification + ack + async image handling
- `GET  /healthz` — health check

## Notes

- Signature verification: HMAC (v0) with timing-safe compare AND ±300s timestamp freshness window.
- Images: The bot downloads from Slack private URLs and uploads results via `files.getUploadURLExternal` → `files.completeUploadExternal` (explicit `image/png`).
- For each output image, the bot attaches an `initial_comment` that contains only the prompt actually sent to Gemini (i.e., the used prompt). No original/translation text is added.
- Gemini calls:
- Prompt sanitation removes Slack markup (mentions/links/channels).
- For generation only, the Worker appends a short constraint to the prompt:
  `Output image only.` (this goes to the API and appears in the initial_comment, which mirrors the exact sent prompt).
  - Combined path sends multiple input images in a single request and expects ONE output image.
  - If `responseModalities=['IMAGE']` returns no image, a single fallback retry is executed with `['TEXT','IMAGE']`.
  - Correlation id (gid) is logged; on failures the thread receives a short error with gid.
- Debug: set `GEMINI_DEBUG=true` (vars/secrets) to upload a small `gemini-debug-*.json` file in the thread on failures (includes finishReason, blockReason, etc.).
 
### Translation & Language Detection
- A utility for language detection/translation using Gemini 2.5 Flash‑Lite (`gemini-2.5-flash-lite`) with Structured Output is included (`src/translate.ts`).
- The upload `initial_comment` shows only the exact prompt used for generation.


### About .env/.dev.vars
- Cloudflare Workers 本番は `.env` を読み込みません。機密値は `wrangler secret` に保存してください。
- ローカル開発は `.dev.vars` を自動で読み込みます（`.dev.vars.example` を参考に作成）。

## Project Layout

- `src/worker.ts` — Worker entry and routing
- `src/slack.ts` — Slack helpers (signature, forms, JSON, text sanitization, image-only enforcement)

- `slack-app-manifest.yaml` — Slack app manifest (Create App from manifest)

## Local Gemini Checker

Run a single-call, two-image local check (same pattern as production):

```bash
# Reads GEMINI_API_KEY from env or .dev.env/.dev.vars
bun run gemini:check-two /path/to/a.png /path/to/b.png "your prompt" ./out.png
```

The script uses text-first parts, requests `['IMAGE']` and falls back once to `['TEXT','IMAGE']` if no image is returned.

## System Architecture

See docs/architecture.md for component overview, data flow, and sequence diagrams.

## Create Slack App from Manifest
1) Open https://api.slack.com/apps → Create New App → From an app manifest.
2) Select your workspace → Paste `slack-app-manifest.yaml` and replace `YOUR_WORKER_URL` with your Worker URL.
3) Install the app to the workspace. Ensure scopes are granted and events show as Verified.
4) Set secrets locally and in Cloudflare (see Quick Start).
