// Tiny logging helper with level filter
export type Level = 'debug' | 'info' | 'warn' | 'error'

export const shouldLog = (want: Level, level?: string | null) => {
  const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }
  const cur = (level || 'info').toLowerCase() as Level
  return order[want] >= order[cur]
}

export const log = (level: Level, msg: string, data?: Record<string, unknown>) => {
  const entry: Record<string, unknown> = { level, msg, ts: new Date().toISOString() }
  if (data) entry.data = data
  console.log(JSON.stringify(entry))
}

export const logError = (msg: string, err: unknown, extra?: Record<string, unknown>) => {
  const data: Record<string, unknown> = { ...(extra || {}) }
  if (err instanceof Error) {
    data.error = { message: err.message, stack: err.stack }
  } else {
    data.error = { value: String(err) }
  }
  console.log(JSON.stringify({ level: 'error', msg, ts: new Date().toISOString(), data }))
}
