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
  it("models only for the two routes that load one -- not comments, [commentId] or image", () => {
    const modelKeys = Object.entries(includes)
      .filter(([, globs]) => globs.some((g) => g.includes("models/")))
      .map(([key]) => key)
      .sort();
    expect(modelKeys).toEqual(["/api/posts!(/**)", "/api/posts/\\[id\\]!(/**)"]);
  });

  it("the CPU onnxruntime for linux/x64 only (no arm64, no other platform)", () => {
    const ort = Object.values(includes)
      .flat()
      .filter((g) => g.includes("onnxruntime-node"));
    expect(ort).toEqual(["./node_modules/onnxruntime-node/bin/napi-v6/linux/x64/**"]);
  });

  it("excludes nothing (Turbopack builds ignore outputFileTracingExcludes)", () => {
    expect(nextConfig.outputFileTracingExcludes).toBeUndefined();
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
