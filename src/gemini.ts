// Minimal Gemini image transform for Workers runtime
// Sends an input image and prompt; returns generated image bytes (PNG)

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

export async function transformImage(bytes: ArrayBuffer, mime: string, prompt: string, apiKey: string): Promise<Uint8Array> {
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
    generationConfig: { responseModalities: [ 'IMAGE' ] }
  }
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body)
  })
  const json = await res.json()
  // Try snake_case then camelCase just in case
  const parts = json?.candidates?.[0]?.content?.parts || []
  const imagePart = parts.find((p: any) => p?.inline_data?.data) || parts.find((p: any) => p?.inlineData?.data)
  const outB64 = imagePart?.inline_data?.data || imagePart?.inlineData?.data
  if (!outB64) {
    // Extract diagnostics for easier debugging in logs/Slack
    const finish = json?.candidates?.[0]?.finishReason || json?.candidates?.[0]?.finish_reason
    const block = json?.promptFeedback?.blockReason || json?.prompt_feedback?.block_reason
    const textPart = parts.find((p: any) => typeof p?.text === 'string')
    const textSample = (textPart?.text || '').toString().slice(0, 200)
    const usage = json?.usageMetadata || json?.usage_metadata
    const model = json?.modelVersion || json?.model_version
    const detail = {
      reason: 'no_inline_image',
      httpStatus: res.status,
      finishReason: finish || 'n/a',
      blockReason: block || 'n/a',
      textPreview: textSample,
      model,
      usage
    }
    throw new Error(`Gemini did not return an image (no inline_data). detail=${JSON.stringify(detail)}`)
  }
  return fromBase64(outB64 as string)
}

// Combine multiple input images into a single request and return ONE output image.
// The caller should craft the prompt to describe how to combine (e.g., grid collage).
export async function transformImagesCombined(
  images: { bytes: ArrayBuffer; mime: string }[],
  prompt: string,
  apiKey: string
): Promise<Uint8Array> {
  const parts: any[] = []
  for (const img of images) {
    parts.push({ inline_data: { mime_type: img.mime, data: toBase64(img.bytes) } })
  }
  parts.push({ text: prompt })

  const body = {
    contents: [ { parts } ],
    generationConfig: { responseModalities: ['IMAGE'] }
  }
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body)
  })
  const json = await res.json()
  const partsOut = json?.candidates?.[0]?.content?.parts || []
  const imagePart = partsOut.find((p: any) => p?.inline_data?.data) || partsOut.find((p: any) => p?.inlineData?.data)
  const outB64 = imagePart?.inline_data?.data || imagePart?.inlineData?.data
  if (!outB64) {
    const finish = json?.candidates?.[0]?.finishReason || json?.candidates?.[0]?.finish_reason
    const block = json?.promptFeedback?.blockReason || json?.prompt_feedback?.block_reason
    throw new Error(`Gemini combined request returned no image. detail=${JSON.stringify({ httpStatus: res.status, finishReason: finish, blockReason: block })}`)
  }
  return fromBase64(outB64 as string)
}

// Generate an image from text-only prompt (no input image)
export async function generateImage(prompt: string, apiKey: string): Promise<Uint8Array> {
  const body = {
    contents: [ { parts: [ { text: prompt } ] } ],
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
  if (!outB64) throw new Error('Gemini did not return an image (text-only generation).')
  return fromBase64(outB64 as string)
}
