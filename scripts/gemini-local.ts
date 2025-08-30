// Run a one-off Gemini image transform locally (Bun)
// Usage: bun run scripts/gemini-local.ts "<prompt>" <inputPath> [outputPath]

import { transformImage } from "../src/gemini";

const [prompt, inPath, outPathCli] = process.argv.slice(2);
if (!prompt || !inPath) {
  console.error("Usage: bun run scripts/gemini-local.ts \"<prompt>\" <inputPath> [outputPath]");
  process.exit(1);
}

const guessMime = (p: string) => {
  const ext = p.toLowerCase().split(".").pop() || "";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "png") return "image/png";
  return "application/octet-stream";
};

const main = async () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY is not set. Use .dev.vars or environment.");
    process.exit(1);
  }

  const file = Bun.file(inPath);
  if (!(await file.exists())) {
    console.error(`Input not found: ${inPath}`);
    process.exit(1);
  }

  const bytes = await file.arrayBuffer();
  const mime = guessMime(inPath);
  const outBytes = await transformImage(bytes, mime, prompt, apiKey);

  const outPath = outPathCli || inPath.replace(/\.(\w+)$/, "-gemini.png");
  await Bun.write(outPath, outBytes);
  console.log(`Wrote: ${outPath}`);
};

main();

