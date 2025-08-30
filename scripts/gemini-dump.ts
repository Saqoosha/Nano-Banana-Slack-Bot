// Print raw response structure from Gemini for debugging (Bun)
// Usage: bun run scripts/gemini-dump.ts "<prompt>" <inputPath>
import { readFileSync } from 'node:fs'

const [prompt, inPath] = process.argv.slice(2)
if (!prompt || !inPath) {
  console.log('Usage: bun run scripts/gemini-dump.ts "<prompt>" <inputPath>')
  process.exit(1)
}

const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image-preview:generateContent'
const apiKey = process.env.GEMINI_API_KEY
if (!apiKey) { console.log('GEMINI_API_KEY not set'); process.exit(1) }

const guessMime = (p: string) => p.toLowerCase().endsWith('.png') ? 'image/png' : p.toLowerCase().endsWith('.jpg') || p.toLowerCase().endsWith('.jpeg') ? 'image/jpeg' : 'application/octet-stream'
const bytes = readFileSync(inPath)
const b64 = btoa(String.fromCharCode(...bytes))

const body = {
  contents: [
    { parts: [ { text: prompt }, { inline_data: { mime_type: guessMime(inPath), data: b64 } } ] }
  ],
  config: { response_modalities: ['IMAGE','TEXT'] }
}

const res = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify(body) })
const json = await res.json()
console.log(JSON.stringify(json, null, 2))
