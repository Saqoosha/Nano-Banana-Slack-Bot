// Generate Slack app icon (PNG) using Gemini 2.5 image preview
// Usage: bun run scripts/make-icon.ts [outputPath]
import { generateImage } from "../src/gemini";

const outPath = process.argv[2] || "./slack-app-icon.png";
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("GEMINI_API_KEY is not set. Use .dev.vars or wrangler secret.");
  process.exit(1);
}

// Prompt: 512x512, flat, readable, banana + chat bubble, friendly
const prompt = [
  "Design a 512x512 Slack app icon as a high-quality PNG.",
  "Theme: minimal flat style banana with a small chat bubble (conversation).",
  "Background: soft pastel circle, high contrast with banana.",
  "Colors: accessible, not neon, no text or watermark.",
  "Framing: centered composition with safe padding.",
  "Output image only (no text)."
].join(" ");

const bytes = await generateImage(prompt, apiKey);
await Bun.write(outPath, bytes);
console.log(`Wrote icon: ${outPath}`);

