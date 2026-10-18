// Build-time clean-up for the AI functions' bundle (run after
// downloadModel.mjs by npm's prebuild hook).
//
// On linux/x64, onnxruntime-node's postinstall downloads the CUDA and
// TensorRT execution providers (~300MB) next to the CPU runtime. Vercel
// functions have no GPU and src/lib/ai/{embedding,imageEmbedding}.ts never
// ask for one (transformers.js runs on the CPU provider by default), but
// next.config.ts has to include bin/napi-v6/linux/x64/** for the CPU
// runtime (libonnxruntime.so.1 is dlopen()ed, so tracing never finds it)
// and Turbopack's include globs cannot leave single files out -- so the
// unused GPU providers would ride along in every AI function. Removing them
// here keeps them out. Nothing else is touched; a missing file is fine
// (e.g. Windows/macOS installs never download them).
import { rm } from "node:fs/promises";
import path from "node:path";

const dir = path.join(process.cwd(), "node_modules", "onnxruntime-node", "bin", "napi-v6", "linux", "x64");
const UNUSED = ["libonnxruntime_providers_cuda.so", "libonnxruntime_providers_tensorrt.so"];

for (const name of UNUSED) {
  await rm(path.join(dir, name), { force: true });
}
console.log(`[prune-onnxruntime] removed unused GPU providers from ${path.relative(process.cwd(), dir)} (if present)`);
