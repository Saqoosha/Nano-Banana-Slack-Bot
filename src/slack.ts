// Minimal Slack helpers for Workers runtime

export type Env = {
  SLACK_SIGNING_SECRET: string
  SLACK_BOT_TOKEN?: string
  ENV?: string
  LOG_LEVEL?: string
  REACTION_NAME?: string
  MAX_IMAGES?: string
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
  const base = `v0:${ts}:${body}`
  const digest = await hmac256(env.SLACK_SIGNING_SECRET, base)
  const expected = `v0=${digest}`
  const enc = new TextEncoder()
  return timingSafeEqual(enc.encode(sig), enc.encode(expected))
}

export const parseForm = (body: string) => new URLSearchParams(body)
