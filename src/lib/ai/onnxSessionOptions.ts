// ONNX Runtime session options shared by the text (embedding.ts) and image
// (imageEmbedding.ts) models, passed through @huggingface/transformers'
// public `session_options` option to InferenceSession.create().
//
// Why one thread: by default ONNX Runtime sizes its intra-op thread pool
// from the machine's cores, and those pool threads busy-wait (spin) between
// and after runs. A Vercel function has about one vCPU, so the extra
// threads only compete with each other -- and keep spinning while the
// request is waiting on the database. Measured locally (onnxruntime-node
// 1.24.3, process pinned to one core), one intra-op thread cut CPU per
// natural-language search from ~675ms to ~41ms and per image embedding
// from ~1.7s to ~0.14s, left idle CPU near zero, and produced identical
// text embeddings, image embeddings within 5e-7, and identical search
// rankings. Only options the Node.js binding documents as supported are
// used (spinning itself is controlled via `extra`, which the binding
// documents as WebAssembly-only).
export const ONNX_SESSION_OPTIONS = { intraOpNumThreads: 1, interOpNumThreads: 1 } as const;
