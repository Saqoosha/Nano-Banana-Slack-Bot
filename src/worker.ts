// Entry for Cloudflare Workers Slack bot
// Comments in English. Keep implementation minimal (YAGNI).

import { badRequest, ok, readRawBody, textJson, verifySlackSignature, sanitizeSlackText, enforceImageOnly, type Env } from './slack'
import { log, logError, shouldLog } from './log'
import { transformImage, transformImagesCombined } from './gemini'

const routes = {
  health: new URLPattern({ pathname: '/healthz' }),
  events: new URLPattern({ pathname: '/slack/events' })
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    try {
      if (shouldLog('info', env.LOG_LEVEL)) log('info', 'fetch', { path: url.pathname, method: request.method })
      if (routes.health.test(url)) return textJson({ ok: true, env: env.ENV || 'dev' })

      if (request.method !== 'POST') return badRequest('POST only')

      const body = await readRawBody(request)
      const valid = await verifySlackSignature(env, request, body)
      if (shouldLog('debug', env.LOG_LEVEL)) log('debug', 'signature', { valid })
      if (!valid) return new Response('invalid signature', { status: 401 })

      if (routes.events.test(url)) return handleEvents(body, env, ctx)

      return badRequest('unknown endpoint')
    } catch (e) {
      logError('fetch:exception', e)
      return new Response('internal error', { status: 500 })
    }
  }
}

// Slack Events: URL verification + async processing
// KV-backed de-dupe to handle multi-instance workers
const dedupeSeen = async (env: Env, key: string): Promise<boolean> => {
  try {
    const hit = await env.nano_banana_dedup.get(key)
    if (hit) return true
    await env.nano_banana_dedup.put(key, "1", { expirationTtl: 300 }) // 5 minutes
    return false
  } catch (_e) {
    // On KV error, proceed without dedupe rather than dropping events
    return false
  }
}

const handleEvents = async (body: string, env: Env, ctx: ExecutionContext): Promise<Response> => {
  try {
    const payload = JSON.parse(body)
    if (shouldLog('debug', env.LOG_LEVEL)) log('debug', 'event:received', { type: payload.type })
    if (payload.type === 'url_verification') return textJson({ challenge: payload.challenge })
    if (payload.type !== 'event_callback') return ok()

    const event = payload.event
    if (shouldLog('info', env.LOG_LEVEL)) log('info', 'event:callback', { etype: event.type, channel: event.channel, thread_ts: event.thread_ts, files: Array.isArray(event.files) ? event.files.length : 0 })
    ctx.waitUntil(processSlackEvent(event, env, payload))
    return ok()
  } catch (e) {
    logError('handleEvents:exception', e)
    return ok()
  }
}

// No slash commands; images are handled via Events API only.

// Minimal processor: when an image is posted, echo it back as a file attachment
const processSlackEvent = async (event: any, env: Env, payload?: any): Promise<void> => {
  const token = env.SLACK_BOT_TOKEN
  if (!token) { log('error' as any, 'missing:SLACK_BOT_TOKEN'); return }

  // Dedupe by Slack event_id early; cts-dedupe is applied later per-event-type
  const eid = (payload && (payload as any).event_id) as string | undefined
  if (eid && (await dedupeSeen(env, `eid:${eid}`))) { if (shouldLog('debug', env.LOG_LEVEL)) log('debug', 'dedupe:skip', { eid }) ; return }

  const botUserId = extractBotUserId(payload)
  const process = await shouldProcess(event, botUserId, token)
  if (shouldLog('info', env.LOG_LEVEL)) log('info', 'event:decision', { process, botUserId })
  if (!process) return

  if (event?.type === 'message' || event?.type === 'app_mention') {
    // Guard: When both `message` (file_share) and `app_mention` fire for the same post
    // Slack may deliver two events. We process image posts only from `message` path
    // to avoid duplicate uploads. Skip `app_mention` when it already includes files.
    if (event?.type === 'app_mention' && Array.isArray(event.files) && event.files.length > 0) {
      if (shouldLog('debug', env.LOG_LEVEL)) log('debug', 'skip:app_mention_with_files')
      return
    }
    // Ignore edits / non-standard subtypes except file_share
    if (event?.type === 'message' && event?.subtype && event.subtype !== 'file_share') {
      if (shouldLog('debug', env.LOG_LEVEL)) log('debug', 'message:ignored_subtype', { subtype: event.subtype })
      return
    }
    const channel = event.channel as string | undefined
    const root_ts = (event.thread_ts as string | undefined) || (event.ts as string | undefined)
    const current_ts = event.ts as string | undefined
    const prompt = enforceImageOnly(sanitizeSlackText((event.text as string | undefined) || '', botUserId))

    // Apply channel:ts dedupe only when we actually intend to process this event type.
    // This avoids app_mention-with-files preempting the message event for the same post.
    const keyTs = channel && current_ts ? `cts:${channel}:${current_ts}` : undefined
    if (keyTs && (await dedupeSeen(env, keyTs))) { if (shouldLog('debug', env.LOG_LEVEL)) log('debug', 'dedupe:skip', { keyTs }) ; return }

    if (channel && root_ts) {
      // Reaction indicators on both the current message and the thread root
      const rname = (env as any).REACTION_NAME || 'banana'
      try { if (current_ts) await slackApi('reactions.add', token, { channel, name: rname, timestamp: current_ts }) } catch (e) { logError('reactions.add:failed', e) }
      try { if (root_ts && root_ts !== current_ts) await slackApi('reactions.add', token, { channel, name: rname, timestamp: root_ts }) } catch (e) { logError('reactions.add:failed', e) }

      // Collect images from the current message
      const current: { url: string, name: string, mime: string }[] = []
      if (Array.isArray(event.files)) {
        for (const f of event.files) {
          if (!f || !f.mimetype || !f.mimetype.startsWith('image/')) continue
          const url = f.url_private_download || f.url_private
          if (!url) continue
          current.push({ url, name: (f.name as string | undefined) || `image-${Date.now()}`, mime: f.mimetype })
        }
      }
      const seen = new Set<string>()
      const targets = current.filter(it => { if (seen.has(it.url)) return false; seen.add(it.url); return true })
      if (shouldLog('info', env.LOG_LEVEL)) log('info', 'images:collected', { current: current.length, total: targets.length })

      // Prefer: when there is a prompt and we can find a previous bot image in the thread,
      // use BOTH the previous image and any newly attached images as inputs (combined request).
      const hasPrompt = (prompt || '').trim().length > 0
      if (hasPrompt) {
        const prev = await listPreviousBotImage(channel, root_ts, token, botUserId)
        if (prev) {
          const combined = [prev, ...targets]
          // De-dupe by URL across prev + current
          const s = new Set<string>()
          const inputs = combined.filter(it => { if (s.has(it.url)) return false; s.add(it.url); return true })
          if (shouldLog('info', env.LOG_LEVEL)) log('info', 'inputs:combined', { prev: true, current: targets.length, total: inputs.length })
          try {
            await processBatchImages(inputs, token, env, { channel, thread_ts: root_ts, prompt })
          } catch (e) {
            logError('processBatchImages:failed(combined)', e)
            const reason = e instanceof Error ? e.message : 'unknown error'
            try { await slackApi('chat.postMessage', token, { channel, thread_ts: root_ts, text: `🍌 Failed to generate images: ${reason}` }) } catch (_) {}
          }
          return
        }
      }

      if (targets.length === 0) {
        // No images and no previous bot image usable
        try { await slackApi('chat.postMessage', token, { channel, thread_ts: root_ts, text: '🍌 No image found. Reply with text to a bot image in this thread, or attach an image.' }) } catch (_) {}
        if (shouldLog('info', env.LOG_LEVEL)) log('info', 'no_images_guided', { channel })
        return
      }

      try {
        await processBatchImages(targets, token, env, { channel, thread_ts: root_ts, prompt })
      } catch (e) {
        logError('processBatchImages:failed', e)
        const reason = e instanceof Error ? e.message : 'unknown error'
        try { await slackApi('chat.postMessage', token, { channel, thread_ts: root_ts, text: `🍌 Failed to generate images: ${reason}` }) } catch (_) {}
      }
      return
    }
  }

  // (Guidance branch covered above when targets.length === 0)

  // file_shared is not used; message/app_mention paths handle attachments.
}

const extractBotUserId = (payload: any): string | undefined => {
  return payload?.authorizations?.[0]?.user_id || payload?.authed_users?.[0]
}

const shouldProcess = async (event: any, botUserId: string | undefined, token: string): Promise<boolean> => {
  // Always process DMs to the bot
  if (event?.channel_type === 'im') return true
  if (event?.type === 'app_mention') return true
  if (!botUserId) return false
  // Ignore messages from ourselves (prevents loops)
  if (event?.user && event.user === botUserId) return false
  if (event?.bot_id) return false
  const text: string = (event?.text || '').toString()
  const mentioned = text.includes(`<@${botUserId}>`)
  if (mentioned) return true
  // If in a thread, process if root message mentioned the bot
  const thread_ts = event?.thread_ts as string | undefined
  const channel = event?.channel as string | undefined
  if (thread_ts && channel) {
    const root = await fetchThreadRoot(channel, thread_ts, token)
    const rootText: string = (root?.text || '').toString()
    if (rootText.includes(`<@${botUserId}>`)) return true
  }
  return false
}

const fetchThreadRoot = async (channel: string, ts: string, token: string): Promise<any | null> => {
  const resp = await slackApi('conversations.replies', token, { channel, ts, limit: '1' })
  const msgs = resp?.messages
  if (Array.isArray(msgs) && msgs.length > 0) return msgs[0]
  return null
}

const listPreviousBotImage = async (channel: string, ts: string, token: string, botUserId?: string): Promise<{ url: string, name: string, mime: string } | null> => {
  const resp = await slackApi('conversations.replies', token, { channel, ts, limit: '50', inclusive: 'true' })
  const msgs = (resp?.messages || []) as any[]
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]
    if (m?.ts === ts) continue
    const isBot = botUserId ? m?.user === botUserId : !!m?.bot_id
    if (!isBot) continue
    const files = m?.files
    if (!Array.isArray(files) || files.length === 0) continue
    for (let j = files.length - 1; j >= 0; j--) {
      const f = files[j]
      const mime = f?.mimetype as string | undefined
      const url = (f?.url_private_download || f?.url_private) as string | undefined
      if (mime && url && mime.startsWith('image/')) {
        return { url, name: (f.name as string | undefined) || `image-${Date.now()}.png`, mime }
      }
    }
  }
  return null
}

type EchoJob = { url: string; name: string; mime: string; channel: string; thread_ts?: string; prompt?: string }

const echoOrTransformImage = async (job: EchoJob, token: string, env: Env) => {
  // 1) Download original image from Slack
  const res = await fetch(job.url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) { log('error' as any, 'download:image:not_ok', { status: res.status }); return }
  const bytes = await res.arrayBuffer()
  if (shouldLog('debug', env.LOG_LEVEL)) log('debug', 'download:image', { ok: res.ok, status: res.status, size: (bytes as ArrayBuffer).byteLength })

  // 2) Optional: transform via Gemini if key is present
  const key = (env as any).GEMINI_API_KEY as string | undefined
  const prompt = (job.prompt || '').trim()
  const out = key && prompt ? await transformImage(bytes, job.mime, prompt, key, { logLevel: env.LOG_LEVEL }) : new Uint8Array(bytes)
  if (shouldLog('info', env.LOG_LEVEL)) log('info', 'gemini:done', { transformed: key && !!prompt, outBytes: out.byteLength })

  // 3) Request external upload URL
  const meta = await slackApi('files.getUploadURLExternal', token, { filename: job.name, length: `${out.byteLength}` })
  if (!meta.ok) { log('error' as any, 'slack:getUploadURLExternal:not_ok', { meta }); return }
  if (shouldLog('debug', env.LOG_LEVEL)) log('debug', 'slack:getUploadURLExternal', { file_id: meta.file_id })

  // 4) Upload bytes via multipart/form-data POST per Slack docs (field name must be `filename`).
  const ab = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength)
  const form = new FormData()
  const a8 = new Uint8Array(ab as ArrayBuffer)
  form.append('filename', new Blob([a8], { type: job.mime || 'application/octet-stream' }), job.name)
  const up = await fetch(meta.upload_url as string, { method: 'POST', body: form })
  if (!up.ok) { log('error' as any, 'slack:upload:post:not_ok', { status: up.status }); return }
  if (shouldLog('debug', env.LOG_LEVEL)) log('debug', 'slack:upload:ok', { status: up.status })

  // 5) Complete upload and share to channel (optionally in thread)
  const payload: Record<string, string> = {
    files: JSON.stringify([{ id: meta.file_id as string, title: job.name }]),
    channel_id: job.channel
  }
  if (job.thread_ts) payload.thread_ts = job.thread_ts
  await slackApi('files.completeUploadExternal', token, payload)
  if (shouldLog('info', env.LOG_LEVEL)) log('info', 'slack:completeUploadExternal', { channel: job.channel })
}

// Batch path: uploads all images and completes in ONE message
const processBatchImages = async (
  items: { url: string; name: string; mime: string }[],
  token: string,
  env: Env,
  opts: { channel: string; thread_ts?: string; prompt?: string }
) => {
  const key = (env as any).GEMINI_API_KEY as string | undefined
  const prompt = (opts.prompt || '').trim()

  // 1) Download all images first
  const inputs: { bytes: ArrayBuffer; mime: string; name: string }[] = []
  for (const src of items) {
    if (shouldLog('info', env.LOG_LEVEL)) log('info', 'image:enqueue', { name: src.name, mime: src.mime, channel: opts.channel, hasPrompt: !!prompt })
    const res = await fetch(src.url, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) { log('error' as any, 'download:image:not_ok', { status: res.status }); continue }
    const bytes = await res.arrayBuffer()
    inputs.push({ bytes, mime: src.mime, name: src.name })
  }
  if (inputs.length === 0) throw new Error('no inputs downloaded')

  // 2) Single Gemini request with all images as parts (collage / combined output)
  const first = inputs[0]!
  let out: Uint8Array
  try {
    if (key && prompt && inputs.length > 1) {
      out = await transformImagesCombined(inputs.map(i => ({ bytes: i.bytes, mime: i.mime })), prompt, key, { logLevel: env.LOG_LEVEL })
    } else if (key && prompt) {
      out = await transformImage(first.bytes, first.mime, prompt, key, { logLevel: env.LOG_LEVEL })
    } else {
      out = new Uint8Array(first.bytes)
    }
  } catch (e) {
    logError('gemini:failed', e)
    if ((env as any).GEMINI_DEBUG && opts.channel) {
      const reason = e instanceof Error ? e.message : String(e)
      const debug = JSON.stringify({ names: items.map(i => i.name), prompt, error: reason }, null, 2)
      try { await uploadTextDebug(opts.channel, token, debug, opts.thread_ts) } catch (_) {}
    }
    throw e
  }

  // 3) Upload single output image
  const outName = inputs.length > 1 ? `combined-${Date.now()}.png` : (items[0]?.name || `image-${Date.now()}.png`)
  const meta = await slackApi('files.getUploadURLExternal', token, { filename: outName, length: `${out.byteLength}` })
  if (!meta.ok) throw new Error('getUploadURLExternal failed')
  const ab = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength)
  const form = new FormData()
  const a8 = new Uint8Array(ab as ArrayBuffer)
  const firstMime = (items[0]?.mime || 'application/octet-stream')
  form.append('filename', new Blob([a8], { type: firstMime }), outName)
  const up = await fetch(meta.upload_url as string, { method: 'POST', body: form })
  if (!up.ok) throw new Error(`upload failed status=${up.status}`)

  const payload: Record<string, string> = {
    files: JSON.stringify([{ id: meta.file_id as string, title: outName }]),
    channel_id: opts.channel
  }
  if (opts.thread_ts) payload.thread_ts = opts.thread_ts
  await slackApi('files.completeUploadExternal', token, payload)
  if (shouldLog('info', env.LOG_LEVEL)) log('info', 'slack:completeUploadExternal', { channel: opts.channel, count: 1 })
}

// Upload a small JSON debug blob as a file to the thread
const uploadTextDebug = async (channel: string, token: string, content: string, thread_ts?: string) => {
  const name = `gemini-debug-${Date.now()}.json`
  const bytes = new TextEncoder().encode(content)
  const meta = await slackApi('files.getUploadURLExternal', token, { filename: name, length: `${bytes.byteLength}` })
  if (!meta.ok) return
  const form = new FormData()
  form.append('filename', new Blob([bytes], { type: 'application/json' }), name)
  const up = await fetch(meta.upload_url as string, { method: 'POST', body: form })
  if (!up.ok) return
  const payload: Record<string, string> = {
    files: JSON.stringify([{ id: meta.file_id as string, title: name }]),
    channel_id: channel
  }
  if (thread_ts) payload.thread_ts = thread_ts
  await slackApi('files.completeUploadExternal', token, payload)
}

const slackApi = async (method: string, token: string, params: Record<string, string>) => {
  const body = new URLSearchParams(params)
  const resp = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/x-www-form-urlencoded' },
    body
  })
  if (!resp.ok) {
    const text = await resp.text()
    log('error' as any, 'slackApi:http_error', { method, status: resp.status, text })
    throw new Error(`slackApi ${method} http ${resp.status}`)
  }
  const json = await resp.json()
  if (json && json.ok === false) {
    log('error' as any, 'slackApi:api_error', { method, json })
  }
  return json
}
