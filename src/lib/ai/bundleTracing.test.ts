import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import nextConfig from "../../../next.config";

// 함수 용량 (Functions Storage): which serverless functions carry the AI
// files. Checked against a Linux Turbopack build's .nft.json traces (see
// next.config.ts): a plain key is a route prefix and the only kind that adds
// files under node_modules; glob keys add files outside node_modules only.
const includes = nextConfig.outputFileTracingIncludes ?? {};

describe("AI files in the function bundles", () => {
  // Function Storage C-1: the photo route hands image embedding to the queue
  // (src/lib/ai/imageJobKick.ts). C-2: so does /api/posts/[id] for edits and
  // recompute requests (src/lib/ai/textJob.ts). Only /api/posts carries models.
  it("models only for /api/posts itself, never [id], the photo route, comments or commentId", () => {
    const modelKeys = Object.entries(includes)
      .filter(([, globs]) => globs.some((g) => g.includes("models/")))
      .map(([key]) => key)
      .sort();
    expect(modelKeys).toEqual(["/api/posts!(/**)"]);
    expect(Object.keys(includes).some((key) => key.includes("[id]"))).toBe(false);
    expect(Object.keys(includes).some((key) => key.includes("image"))).toBe(false);
  });

  it("the CPU onnxruntime for linux/x64 only (no arm64, no other platform)", () => {
    const ortBinaries = Object.values(includes)
      .flat()
      .filter((g) => g.includes("onnxruntime-node/bin"));
    expect(ortBinaries).toEqual(["./node_modules/onnxruntime-node/bin/napi-v6/linux/x64/**"]);
  });

  // Release B: transformers >= 4.3 requires onnxruntime-node at runtime via
  // createRequire(), which the tracer does not follow -- without these the
  // deployed AI routes failed with "Cannot find module 'onnxruntime-node'".
  it("the onnxruntime-node JS entry and onnxruntime-common ride along with the binaries", () => {
    const apiPosts = includes["/api/posts"] ?? [];
    expect(apiPosts).toEqual(
      expect.arrayContaining([
        "./node_modules/onnxruntime-node/package.json",
        "./node_modules/onnxruntime-node/dist/**",
        "./node_modules/onnxruntime-common/package.json",
        "./node_modules/onnxruntime-common/dist/cjs/**",
      ]),
    );
    const pkg = JSON.parse(readFileSync(path.join(process.cwd(), "node_modules/onnxruntime-node/package.json"), "utf8"));
    expect(pkg.main).toBe("dist/index.js");
    expect(Object.keys(pkg.dependencies ?? {})).toContain("onnxruntime-common");
  });

  it("excludes the text model only from the image mutation worker", () => {
    expect(nextConfig.outputFileTracingExcludes).toEqual({ "/api/posts/**/image": ["./models/jhgan/**/*"] });
  });

  // Function Storage C-2: Turbopack traces the embedding modules'
  // process.cwd()/models path into every function that imports them, and an
  // exclude did not remove it on Vercel. So /api/posts/[id] and the modules it
  // uses for edits must not import the embedding chain at all.
  it("the [id] route and its update module import nothing from the embedding chain", () => {
    const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");
    const banned = ["@/lib/posts/aiService", "@/lib/ai/postEmbedding", "@/lib/ai/embedding\"", "@/lib/ai/imageEmbedding", "@/lib/ai/queryEmbedding", "@/lib/ai/imageJob\"", "@/lib/ai/textJob", "./aiService"];
    for (const file of ["src/app/api/posts/[id]/route.ts", "src/lib/posts/updateService.ts", "src/lib/ai/imageJobQueue.ts", "src/lib/ai/imageJobKick.ts", "src/lib/ai/embeddingFields.ts"]) {
      const source = read(file);
      for (const name of banned) expect(source, `${file} imports ${name}`).not.toContain(name);
    }
  });

  it("the unused GPU providers are deleted before every build", () => {
    const pkg = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
    expect(pkg.scripts.prebuild).toContain("node scripts/pruneOnnxRuntime.mjs");
    const prune = readFileSync(path.join(process.cwd(), "scripts/pruneOnnxRuntime.mjs"), "utf8");
    expect(prune).toContain("libonnxruntime_providers_cuda.so");
    expect(prune).toContain("libonnxruntime_providers_tensorrt.so");
    // the CPU runtime itself is never removed
    expect(prune).not.toMatch(/"libonnxruntime\.so\.1"/);
  });
});
