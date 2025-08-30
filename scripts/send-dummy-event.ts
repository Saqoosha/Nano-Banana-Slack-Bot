// Send a signed dummy Slack event to the deployed Worker
// Usage: bun run scripts/send-dummy-event.ts <eventsUrl> [type]

const [eventsUrl, typeArg] = process.argv.slice(2)
if (!eventsUrl) {
  console.error('Usage: bun run scripts/send-dummy-event.ts <eventsUrl> [url_verification|event]')
  process.exit(1)
}
const type = typeArg || 'event'

const secret = process.env.SLACK_SIGNING_SECRET
if (!secret) { console.error('SLACK_SIGNING_SECRET is not set'); process.exit(1) }

const urlVerification = { type: 'url_verification', token: 'dummy', challenge: 'dummy-challenge' }
const botUserId = 'U123BOT' // matches mention in text below
const eventCallback = {
  token: 'dummy',
  team_id: 'T123',
  api_app_id: 'A123',
  type: 'event_callback',
  authorizations: [{ user_id: botUserId }],
  event: {
    type: 'message',
    channel: 'C123',
    channel_type: 'channel',
    text: `hello <@${botUserId}>`,
    files: []
  }
}

const eventAppMention = {
  token: 'dummy',
  team_id: 'T123',
  api_app_id: 'A123',
  type: 'event_callback',
  authorizations: [{ user_id: botUserId }],
  event: {
    type: 'app_mention',
    channel: 'C123',
    channel_type: 'channel',
    text: `hey <@${botUserId}> do it`,
    files: []
  }
}

const bodyObj = type === 'url_verification' ? urlVerification : (type === 'app_mention' ? eventAppMention : eventCallback)
const body = JSON.stringify(bodyObj)
const ts = Math.floor(Date.now() / 1000).toString()

// Sign payload: v0:ts:body
const enc = new TextEncoder()
const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`v0:${ts}:${body}`))
const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
const signature = `v0=${hex}`

const resp = await fetch(eventsUrl, { method: 'POST', headers: { 'content-type': 'application/json', 'x-slack-request-timestamp': ts, 'x-slack-signature': signature }, body })
console.log('status', resp.status)
console.log('text', await resp.text())
