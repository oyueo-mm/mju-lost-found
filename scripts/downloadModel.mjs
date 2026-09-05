// Build-time model fetcher for src/lib/ai/embedding.ts's TransformersEmbeddingProvider
// and src/lib/ai/imageEmbedding.ts's TransformersImageEmbeddingProvider.
//
// Why this exists (Phase 7-B, extended Phase 15-2): both models' ONNX
// files are too large to commit to this repo (see .gitignore) -- fetched
// from their origin, Hugging Face Hub, at build time instead, then read
// locally at runtime (env.allowRemoteModels = false, local_files_only:
// true in embedding.ts/imageEmbedding.ts -- unchanged by this script).
// Runtime never talks to the network for this; only this script does,
// and only during `npm run build` / `npm run dev` (wired via npm's
// prebuild/predev lifecycle hooks in package.json).
//
// Each model is pinned to an immutable revision (a full commit SHA, not
// the `main` branch) so a future upstream change can never silently
// change what gets downloaded -- bumping a MODEL_REVISION is an explicit,
// reviewable code change. Every file's exact size and SHA256 are checked
// after download (and before skipping an already-present file) so a
// truncated/corrupted download fails the build loudly instead of shipping
// a broken model silently.

import { createHash } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import { pipeline as streamPipeline } from "node:stream/promises";

// Both repos are public/non-gated (confirmed via
// `curl https://huggingface.co/api/models/<repoId>` -- "gated": false),
// so no HF token or other credential is needed to fetch either.
const MODELS = [
  {
    repoId: "jhgan/ko-sroberta-multitask",
    // Pinned via `curl https://huggingface.co/api/models/jhgan/ko-sroberta-multitask/refs`
    // -- the `main` branch's target commit at the time this was pinned (2026-09-05).
    revision: "8fca7c9c98c26599be0e14b9916b11a756a26f19",
    dir: path.join(process.cwd(), "models", "jhgan", "ko-sroberta-multitask"),
    // Sizes/hashes verified 2026-09-05 by downloading each file and running
    // `sha256sum` locally; the ONNX file's hash additionally matches the
    // `lfs.oid` (a sha256) reported by Hugging Face's own tree API for this
    // revision, confirming the pinned bytes are exactly what the Hub serves.
    files: [
      { path: "config.json", size: 744, sha256: "50fb1a0ef3d83f79e28a157218dfce1f8e53bcd71a203168a06fff9d040d344b" },
      {
        path: "tokenizer.json",
        size: 495027,
        sha256: "70f194d3bd8fc273ee0bca77b49404c6230ebaca2cfe0af04d6b82964e054660",
      },
      {
        path: "tokenizer_config.json",
        size: 585,
        sha256: "f534522d501e985fd55c18a97cf90674fbbdbf736d4c6b0ab14cd2f86cc96d7f",
      },
      {
        path: "onnx/model_qint8_avx512_vnni.onnx",
        size: 111326851,
        sha256: "ddd6107a06385baf8a76a1ccbfd8718c684a1a751708db116061069a1224ffd6",
      },
    ],
  },
  {
    // Phase 15-2: image-similarity search's vision encoder -- see
    // docs/IMAGE_EMBEDDING_POC.md for why this model (Apache-2.0, real PoC
    // comparison against CLIP) and src/lib/ai/imageEmbedding.ts for how
    // it's loaded (SiglipVisionModel, dtype "q8"). Only the vision-tower
    // ONNX file is fetched -- this repo also ships a text tower and a
    // combined text+vision model.onnx, neither of which this app ever
    // loads (image search never embeds text, and never needs the full
    // dual-tower graph), so those are deliberately left out rather than
    // downloaded unused.
    repoId: "Xenova/siglip-base-patch16-224",
    // Pinned via `curl https://huggingface.co/api/models/Xenova/siglip-base-patch16-224/refs`.
    revision: "4649052661e53c7000355844105f8a1792088239",
    dir: path.join(process.cwd(), "models", "Xenova", "siglip-base-patch16-224"),
    // Sizes/hashes verified 2026-09-06 the same way as above; the ONNX
    // file's hash additionally matches the `lfs.oid` reported by Hugging
    // Face's tree API for this revision.
    files: [
      {
        path: "config.json",
        size: 457,
        sha256: "e6de71291f181b0b81adc93098787bb4597a79dc18f59737feda8f41671fb6a2",
      },
      {
        path: "preprocessor_config.json",
        size: 368,
        sha256: "21ee046a8a52a65e5f9c177bf840bfb39ea66c9c54cf2760630efd58e0a3ec80",
      },
      {
        path: "onnx/vision_model_quantized.onnx",
        size: 99499129,
        sha256: "ef14a954f3d57e1806666432bd9785004c1dc27100aa260eee0cb0f10a5de058",
      },
    ],
  },
];

function fetchToFile(url, destPath, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "mju-lost-found-vercel-build/1.0" } }, (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location &&
          redirectsLeft > 0
        ) {
          res.resume();
          // huggingface.co's own redirect (to its resolve-cache endpoint,
          // and from there to the actual CDN/S3 URL for LFS files) sends a
          // relative Location header, not absolute -- resolve it against
          // the URL we just requested rather than passing it to https.get()
          // as-is (which throws "Invalid URL" for a bare path).
          const nextUrl = new URL(res.headers.location, url).toString();
          resolve(fetchToFile(nextUrl, destPath, redirectsLeft - 1));
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
          return;
        }
        streamPipeline(res, createWriteStream(destPath)).then(resolve, reject);
      })
      .on("error", reject);
  });
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  const { createReadStream } = await import("node:fs");
  await streamPipeline(createReadStream(filePath), hash);
  return hash.digest("hex");
}

async function isValid(filePath, expected) {
  if (!existsSync(filePath)) return false;
  const stats = await stat(filePath);
  if (stats.size !== expected.size) return false;
  const actualHash = await sha256File(filePath);
  return actualHash === expected.sha256;
}

async function ensureFile(model, file) {
  const destPath = path.join(model.dir, file.path);
  await mkdir(path.dirname(destPath), { recursive: true });

  if (await isValid(destPath, file)) {
    console.log(`[download-model] OK (cached): ${model.repoId}/${file.path}`);
    return;
  }

  console.log(`[download-model] fetching ${model.repoId}/${file.path} from Hugging Face Hub...`);
  const url = `https://huggingface.co/${model.repoId}/resolve/${model.revision}/${file.path}`;
  const tmpPath = `${destPath}.download`;
  await rm(tmpPath, { force: true });

  try {
    await fetchToFile(url, tmpPath);
  } catch (error) {
    await rm(tmpPath, { force: true });
    throw new Error(`Failed to download ${model.repoId}/${file.path} from ${url}: ${error.message}`);
  }

  if (!(await isValid(tmpPath, file))) {
    const stats = existsSync(tmpPath) ? await stat(tmpPath) : null;
    const actualHash = stats ? await sha256File(tmpPath) : "(missing)";
    await rm(tmpPath, { force: true });
    throw new Error(
      `Integrity check failed for ${model.repoId}/${file.path}: expected size=${file.size} sha256=${file.sha256}, ` +
        `got size=${stats?.size ?? "?"} sha256=${actualHash}. Refusing to use a corrupted/incomplete model file.`,
    );
  }

  await rename(tmpPath, destPath);
  console.log(`[download-model] verified and saved: ${model.repoId}/${file.path}`);
}

async function main() {
  for (const model of MODELS) {
    console.log(`[download-model] ensuring ${model.repoId}@${model.revision} is present under models/...`);
    for (const file of model.files) {
      await ensureFile(model, file);
    }
  }
  console.log("[download-model] all model files present and verified.");
}

main().catch((error) => {
  console.error(`[download-model] BUILD FAILED: ${error.message}`);
  process.exit(1);
});
