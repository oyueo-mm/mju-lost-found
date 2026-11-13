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
