// Minimal Slack helpers for Workers runtime

export type Env = {
  SLACK_SIGNING_SECRET: string
  SLACK_BOT_TOKEN?: string
  ENV?: string
  LOG_LEVEL?: string
  REACTION_NAME?: string
  nano_banana_dedup: any
}

export const textJson = (obj: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(obj), { ...init, headers: { 'content-type': 'application/json; charset=UTF-8', ...(init.headers ?? {}) } })

export const ok = () => new Response('ok', { status: 200 })
export const badRequest = (msg = 'bad request') => new Response(msg, { status: 400 })
export const unauthorized = () => new Response('unauthorized', { status: 401 })

export const readRawBody = async (request: Request): Promise<string> => {
  const contentType = request.headers.get('content-type') || ''
  if (contentType.includes('application/json')) return await request.text()
  if (contentType.includes('application/x-www-form-urlencoded')) return await request.text()
  return await request.text()
}

export const timingSafeEqual = (a: Uint8Array, b: Uint8Array) => {
  if (a.length !== b.length) return false
  let res = 0
  for (let i = 0; i < a.length; i++) res |= (a[i]!) ^ (b[i]!)
  return res === 0
}

const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')

export const hmac256 = async (key: string, message: string) => {
  const enc = new TextEncoder()
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message))
  return hex(sig)
}

export const verifySlackSignature = async (env: Env, request: Request, body: string): Promise<boolean> => {
  const ts = request.headers.get('x-slack-request-timestamp') || ''
  const sig = request.headers.get('x-slack-signature') || ''
  if (!ts || !sig) return false
  // Freshness check (±300s) to prevent replay attacks
  const now = Math.floor(Date.now() / 1000)
  const t = parseInt(ts, 10)
  if (!Number.isFinite(t)) return false
  if (Math.abs(now - t) > 300) return false
  const base = `v0:${ts}:${body}`
  const digest = await hmac256(env.SLACK_SIGNING_SECRET, base)
  const expected = `v0=${digest}`
  const enc = new TextEncoder()
  return timingSafeEqual(enc.encode(sig), enc.encode(expected))
}

export const parseForm = (body: string) => new URLSearchParams(body)

// Remove Slack-specific markup from text to make prompts model-friendly.
// - Converts <url|label> to label
// - Removes user mentions <@U...> and other angle-bracket tokens
// - Collapses whitespace
export const sanitizeSlackText = (text: string, botUserId?: string): string => {
  let s = (text || '').toString()
  // Replace links like <http://example|label> -> label
  s = s.replace(/<[^>|]+\|([^>]+)>/g, '$1')
  // Remove user mentions like <@U12345>
  s = s.replace(/<@[^>]+>/g, '')
  // Remove channel mentions like <#C12345|channel>
  s = s.replace(/<#([^>|]+)(\|[^>]+)?>/g, '')
  // Remove remaining bracketed tokens like <mailto:...> or <http:...>
  s = s.replace(/<[^>]+>/g, '')
  // If botUserId is provided, also remove plain mentions like @name variants just in case
  if (botUserId) s = s.replace(new RegExp(`<@${botUserId}>`, 'g'), '')
  // Collapse whitespace
  s = s.replace(/\s+/g, ' ').trim()
  return s
}

// Ensure prompt explicitly asks for image-only output to stabilize responses
export const enforceImageOnly = (text: string): string => {
  const t = (text || '').toString().trim()
  const ja = '出力は画像のみ。'
  if (t.includes(ja)) return t
  if (/image\s*only/i.test(t)) return t
  return t.length > 0 ? `${t} ${ja}` : ja
}
