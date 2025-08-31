// Language detection + translation via Gemini 2.5 Flash‑Lite
// Uses Structured Output to return a predictable JSON object.
import { log, shouldLog } from './log'

const TEXT_MODEL_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent'

export type LangDetectResult = {
  languageCode: string
  languageName?: string
  isEnglish: boolean
  translation: string
  confidence?: number
}

export async function detectLanguageAndTranslate(input: string, apiKey: string, logLevel?: string): Promise<LangDetectResult> {
  const instructions = [
    'You are a language identifier and translator.',
    'Analyze the delimited text and return structured JSON.',
    'Translate to natural, concise English. If already English, return the original as translation.',
    'Return fields: languageCode (BCP-47 like en, ja), languageName, isEnglish, translation, confidence (0..1).'
  ].join(' ')

  const schema = {
    type: 'object',
    properties: {
      languageCode: { type: 'string', description: 'BCP-47 language code like en, ja, zh-CN' },
      languageName: { type: 'string' },
      isEnglish: { type: 'boolean' },
      translation: { type: 'string', description: 'English translation (or original if already English).' },
      confidence: { type: 'number' }
    },
    required: ['languageCode', 'isEnglish', 'translation']
  }

  const body = {
    contents: [ { parts: [ { text: `${instructions}\n---\n${input}` } ] } ],
    generationConfig: {
      // Structured Output per Gemini API
      response_mime_type: 'application/json',
      response_schema: schema as any
    }
  }

  if (shouldLog('info', logLevel)) log('info', 'gemini:lang:req', { len: input.length })
  const res = await fetch(TEXT_MODEL_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body)
  })
  if (!res.ok) throw new Error(`lang detect http ${res.status}`)
  const json = await res.json()
  const parts = json?.candidates?.[0]?.content?.parts || []
  const text = parts.map((p: any) => p?.text).filter((x: any) => typeof x === 'string').join('\n').trim()
  if (shouldLog('info', logLevel)) log('info', 'gemini:lang:res', { status: res.status, ok: !!text })
  if (!text) throw new Error(`language detection failed (status ${res.status})`)
  let parsed: LangDetectResult
  try { parsed = JSON.parse(text) as LangDetectResult } catch { throw new Error(`invalid JSON from model (status ${res.status})`) }
  return parsed
}
