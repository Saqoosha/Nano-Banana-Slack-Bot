// Minimal Gemini image transform for Workers runtime
// Sends an input image and prompt; returns generated image bytes (PNG)
import { log, logError, shouldLog } from './log'

type GeminiOpts = {
  logLevel?: string
  traceId?: string
}

const endpoint = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image-preview:generateContent"

const toBase64 = (buf: ArrayBuffer): string => {
  const bytes = new Uint8Array(buf)
  let binary = ""
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  // btoa is available in Workers
  return btoa(binary)
}

const fromBase64 = (b64: string): Uint8Array => {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export async function transformImage(bytes: ArrayBuffer, mime: string, prompt: string, apiKey: string, opts?: GeminiOpts): Promise<Uint8Array> {
  const gid = opts?.traceId || `gmi-${Date.now().toString(36)}`
  const promptTrim = (prompt || '').toString()
  const size = (bytes as ArrayBuffer).byteLength
  if (shouldLog('info', opts?.logLevel)) log('info', 'gemini:req', { gid, mode: 'single', promptLen: promptTrim.length, mime, bytes: size })
  if (shouldLog('debug', opts?.logLevel)) log('debug', 'gemini:req:detail', { gid, promptSample: promptTrim.slice(0, 80) })
  const data = toBase64(bytes)
  const body = {
    contents: [
      {
        parts: [
          { text: prompt },
          { inline_data: { mime_type: mime, data } }
        ]
      }
    ],
    generationConfig: { responseModalities: ['IMAGE'] }
  }
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body)
  })
  const json = await res.json()
  const parts = json?.candidates?.[0]?.content?.parts || []
  const imagePart = parts.find((p: any) => p?.inline_data?.data) || parts.find((p: any) => p?.inlineData?.data)
  const outB64 = imagePart?.inline_data?.data || imagePart?.inlineData?.data
  const finish = json?.candidates?.[0]?.finishReason || json?.candidates?.[0]?.finish_reason
  const block = json?.promptFeedback?.blockReason || json?.prompt_feedback?.block_reason
  const usage = json?.usageMetadata || json?.usage_metadata
  const model = json?.modelVersion || json?.model_version
  if (shouldLog('info', opts?.logLevel)) log('info', 'gemini:res', { gid, status: res.status, gotImage: !!outB64, finishReason: finish || 'n/a', blockReason: block || 'n/a', model })
  if (outB64) return fromBase64(outB64 as string)
  // Fallback once: allow TEXT,IMAGE to nudge image emission
  if (shouldLog('info', opts?.logLevel)) log('info', 'gemini:fallback', { gid, mode: 'single', to: 'TEXT,IMAGE' })
  const body2 = {
    contents: [ { parts: [ { text: prompt }, { inline_data: { mime_type: mime, data } } ] } ],
    generationConfig: { responseModalities: ['TEXT','IMAGE'] }
  }
  const res2 = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify(body2) })
  const json2 = await res2.json()
  const parts2 = json2?.candidates?.[0]?.content?.parts || []
  const imagePart2 = parts2.find((p: any) => p?.inline_data?.data) || parts2.find((p: any) => p?.inlineData?.data)
  const outB642 = imagePart2?.inline_data?.data || imagePart2?.inlineData?.data
  const finish2 = json2?.candidates?.[0]?.finishReason || json2?.candidates?.[0]?.finish_reason
  if (shouldLog('info', opts?.logLevel)) log('info', 'gemini:res', { gid, status: res2.status, gotImage: !!outB642, finishReason: finish2 || 'n/a' })
  if (!outB642) {
    const textPart = parts2.find((p: any) => typeof p?.text === 'string')
    const textSample = (textPart?.text || '').toString().slice(0, 200)
    if (shouldLog('error', opts?.logLevel)) logError('gemini:no_inline_image', new Error('no_inline_image'), { gid, httpStatus: res2.status, textPreview: textSample })
    throw new Error(`Gemini did not return an image (fallback). http=${res2.status}`)
  }
  return fromBase64(outB642 as string)
}

// Combine multiple input images into a single request and return ONE output image.
// The caller should craft the prompt to describe how to combine (e.g., grid collage).
export async function transformImagesCombined(
  images: { bytes: ArrayBuffer; mime: string }[],
  prompt: string,
  apiKey: string,
  opts?: GeminiOpts
): Promise<Uint8Array> {
  const gid = opts?.traceId || `gmi-${Date.now().toString(36)}`
  const total = images.reduce((acc, i) => acc + (i.bytes as ArrayBuffer).byteLength, 0)
  const promptTrim = (prompt || '').toString()
  if (shouldLog('info', opts?.logLevel)) log('info', 'gemini:req', { gid, mode: 'combined', images: images.length, promptLen: promptTrim.length, totalBytes: total })
  if (shouldLog('debug', opts?.logLevel)) log('debug', 'gemini:req:detail', { gid, promptSample: promptTrim.slice(0, 80) })

  const parts: any[] = [ { text: prompt } ]
  for (const img of images) parts.push({ inline_data: { mime_type: img.mime, data: toBase64(img.bytes) } })

  const body = { contents: [ { parts } ], generationConfig: { responseModalities: ['IMAGE'] } }
  const res = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify(body) })
  const json = await res.json()
  const partsOut = json?.candidates?.[0]?.content?.parts || []
  let imagePart = partsOut.find((p: any) => p?.inline_data?.data) || partsOut.find((p: any) => p?.inlineData?.data)
  let outB64 = imagePart?.inline_data?.data || imagePart?.inlineData?.data
  const finish = json?.candidates?.[0]?.content ? (json?.candidates?.[0]?.finishReason || json?.candidates?.[0]?.finish_reason) : undefined
  const model = json?.modelVersion || json?.model_version
  if (shouldLog('info', opts?.logLevel)) log('info', 'gemini:res', { gid, status: res.status, gotImage: !!outB64, finishReason: finish || 'n/a', model })
  if (!outB64) {
    if (shouldLog('info', opts?.logLevel)) log('info', 'gemini:fallback', { gid, mode: 'combined', to: 'TEXT,IMAGE' })
    const body2 = { contents: [ { parts } ], generationConfig: { responseModalities: ['TEXT','IMAGE'] } }
    const res2 = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify(body2) })
    const json2 = await res2.json()
    const partsOut2 = json2?.candidates?.[0]?.content?.parts || []
    const ip2 = partsOut2.find((p: any) => p?.inline_data?.data) || partsOut2.find((p: any) => p?.inlineData?.data)
    const b642 = ip2?.inline_data?.data || ip2?.inlineData?.data
    if (shouldLog('info', opts?.logLevel)) log('info', 'gemini:res', { gid, status: res2.status, gotImage: !!b642 })
    if (!b642) {
      if (shouldLog('error', opts?.logLevel)) logError('gemini:no_inline_image:combined', new Error('no_inline_image'), { gid, httpStatus: res2.status })
      throw new Error(`Gemini combined request returned no image (fallback). http=${res2.status}`)
    }
    outB64 = b642
  }
  return fromBase64(outB64 as string)
}

// Generate an image from text-only prompt (no input image)
export async function generateImage(prompt: string, apiKey: string, opts?: GeminiOpts): Promise<Uint8Array> {
  const gid = opts?.traceId || `gmi-${Date.now().toString(36)}`
  const promptTrim = (prompt || '').toString()
  if (shouldLog('info', opts?.logLevel)) log('info', 'gemini:req', { gid, mode: 'text-only', promptLen: promptTrim.length })
  if (shouldLog('debug', opts?.logLevel)) log('debug', 'gemini:req:detail', { gid, promptSample: promptTrim.slice(0, 80) })
  const body = { contents: [ { parts: [ { text: prompt } ] } ], generationConfig: { responseModalities: ['IMAGE'] } }
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body)
  })
  const json = await res.json()
  const parts = json?.candidates?.[0]?.content?.parts || []
  const imagePart = parts.find((p: any) => p?.inline_data?.data) || parts.find((p: any) => p?.inlineData?.data)
  const outB64 = imagePart?.inline_data?.data || imagePart?.inlineData?.data
  const finish = json?.candidates?.[0]?.finishReason || json?.candidates?.[0]?.finish_reason
  const block = json?.promptFeedback?.blockReason || json?.prompt_feedback?.block_reason
  const model = json?.modelVersion || json?.model_version
  const usage = json?.usageMetadata || json?.usage_metadata
  if (shouldLog('info', opts?.logLevel)) log('info', 'gemini:res', { gid, status: res.status, gotImage: !!outB64, finishReason: finish || 'n/a', blockReason: block || 'n/a', model })
  if (!outB64) {
    if (shouldLog('error', opts?.logLevel)) logError('gemini:no_inline_image:text', new Error('no_inline_image'), { gid, httpStatus: res.status, finishReason: finish || 'n/a', blockReason: block || 'n/a', model, usage })
  }
  if (!outB64) throw new Error('Gemini did not return an image (text-only generation).')
  return fromBase64(outB64 as string)
}
