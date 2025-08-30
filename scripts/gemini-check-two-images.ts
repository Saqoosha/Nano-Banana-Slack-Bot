// Simple checker: send two local images to Gemini as separate parts in ONE call
// Usage:
//   GEMINI_API_KEY=... bun run scripts/gemini-check-two-images.ts <img1> <img2> "<prompt>" [out.png]
// Outputs the resulting image to out path (default: ./gemini-out.png)

const defaultModel = process.env.GEMINI_MODEL || "gemini-2.5-flash-image-preview"
let endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${defaultModel}:generateContent`

const args = process.argv.slice(2)
if (args.length < 3) {
  console.error("Usage: GEMINI_API_KEY=... bun run scripts/gemini-check-two-images.ts <img1> <img2> \"<prompt>\" [out.png]")
  process.exit(1)
}

const [img1Path, img2Path, prompt, outPath = "./gemini-out.png"] = args

// Try to load API key from env or .dev.env/.dev.vars
function parseDotEnv(content: string): Record<string,string> {
  const out: Record<string,string> = {}
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+)\s*$/)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1,-1)
    out[m[1]] = v
  }
  return out
}

let apiKey = process.env.GEMINI_API_KEY || process.env.GEMIN_API_KEY || ""
if (!apiKey) {
  try {
    if (await Bun.file(".dev.env").exists()) {
      const envTxt = await Bun.file(".dev.env").text()
      const kv = parseDotEnv(envTxt)
      apiKey = kv["GEMINI_API_KEY"] || kv["GEMIN_API_KEY"] || ""
    } else if (await Bun.file(".dev.vars").exists()) {
      const envTxt = await Bun.file(".dev.vars").text()
      const kv = parseDotEnv(envTxt)
      apiKey = kv["GEMINI_API_KEY"] || kv["GEMIN_API_KEY"] || ""
    }
  } catch {}
}
if (!apiKey) {
  console.error("GEMINI_API_KEY (or GEMIN_API_KEY) is required. Set env or .dev.env/.dev.vars.")
  process.exit(1)
}

const extToMime = (p: string): string => {
  const low = p.toLowerCase()
  if (low.endsWith(".png")) return "image/png"
  if (low.endsWith(".jpg") || low.endsWith(".jpeg")) return "image/jpeg"
  if (low.endsWith(".webp")) return "image/webp"
  if (low.endsWith(".gif")) return "image/gif"
  return "application/octet-stream"
}

const toBase64 = (buf: ArrayBuffer): string => {
  return Buffer.from(buf as ArrayBuffer).toString('base64')
}

type AttemptResult = { ok: boolean; status: number; gotImage: boolean; out?: Uint8Array; errMsg?: string }

async function attempt(label: string, parts: any[], bodyExtra: any): Promise<AttemptResult> {
  const body = { contents: [ { parts } ], ...bodyExtra }
  const res = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify(body) })
  let json: any = null
  try { json = await res.json() } catch { json = null }
  const partsOut = json?.candidates?.[0]?.content?.parts || []
  const imagePart = partsOut.find((p: any) => p?.inline_data?.data) || partsOut.find((p: any) => p?.inlineData?.data)
  const outB64 = imagePart?.inline_data?.data || imagePart?.inlineData?.data
  const finish = json?.candidates?.[0]?.finishReason || json?.candidates?.[0]?.finish_reason
  const block = json?.promptFeedback?.blockReason || json?.prompt_feedback?.block_reason
  const errMsg = json?.error?.message
  console.log(JSON.stringify({ level: 'info', msg: 'attempt', ts: new Date().toISOString(), data: { label, status: res.status, finishReason: finish || 'n/a', blockReason: block || 'n/a', gotImage: !!outB64, errMsg } }))
  if (!res.ok || !outB64) return { ok: res.ok, status: res.status, gotImage: false, errMsg }
  return { ok: true, status: res.status, gotImage: true, out: Buffer.from(outB64, 'base64') }
}

function enforceImageOnly(text: string): string {
  const t = (text || '').toString().trim()
  const ja = '出力は画像のみ。'
  if (t.includes(ja)) return t
  if (/image\s*only/i.test(t)) return t
  return t.length > 0 ? `${t} ${ja}` : ja
}

async function main() {
  const f1 = await Bun.file(img1Path).arrayBuffer()
  const f2 = await Bun.file(img2Path).arrayBuffer()
  const m1 = extToMime(img1Path)
  const m2 = extToMime(img2Path)
  const pText = enforceImageOnly(prompt)

  const partsImagesFirst = [
    { inline_data: { mime_type: m1, data: toBase64(f1) } },
    { inline_data: { mime_type: m2, data: toBase64(f2) } },
    { text: pText }
  ]
  const partsTextFirst = [
    { text: pText },
    { inline_data: { mime_type: m1, data: toBase64(f1) } },
    { inline_data: { mime_type: m2, data: toBase64(f2) } }
  ]

// Success pattern with one fallback: IMAGE only -> TEXT+IMAGE
let r = await attempt('A(text-first + IMAGE)', partsTextFirst, { generationConfig: { responseModalities: ['IMAGE'] } })
if (!r.ok || !r.gotImage) {
  r = await attempt('B(text-first + TEXT,IMAGE)', partsTextFirst, { generationConfig: { responseModalities: ['TEXT','IMAGE'] } })
}
  if (!r.ok || !r.gotImage || !r.out) {
    console.error('Failed to get image from all attempts.')
    process.exit(2)
  }
  await Bun.write(outPath, r.out)
  console.log(JSON.stringify({ level: 'info', msg: 'wrote', ts: new Date().toISOString(), data: { out: outPath, bytes: r.out.byteLength } }))
}

await main()
