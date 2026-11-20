// The four fields whose change should trigger re-embedding a post. They are
// what buildEmbeddingText() (./embedding.ts) reads and what the DB trigger of
// migration 20261124000000_text_embedding_jobs watches. Kept in its own
// module with no imports (Function Storage C-2): importing ./postEmbedding
// would pull the embedding chain, and with it the models, into a route bundle.
export const EMBEDDING_INPUT_FIELDS = ["title", "description", "category", "location"] as const;
