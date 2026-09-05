"""Text -> vector embedding for Korean lost & found posts.

The embedding backend (model choice, library) is isolated here so it can be
swapped later (different model, a hosted embedding API, a vector DB's own
encoder, ...) without touching ai/matching.py or any UI code.

Nothing in this module is imported at app startup by app.py/pages/*, so a
missing/failed model does not affect the rest of the app. Callers that do use
it should catch EmbeddingUnavailableError and degrade gracefully (see
is_available()).
"""

from __future__ import annotations

from typing import Any

import numpy as np

# Korean-tuned sentence embedding model (STS/NLI multitask), 768-dim.
# Change this single constant to swap models later.
MODEL_NAME = "jhgan/ko-sroberta-multitask"

_model = None
_load_error: Exception | None = None


class EmbeddingUnavailableError(Exception):
    """Raised when the embedding backend can't be loaded or used.

    Covers: sentence-transformers not installed, model download failed (no
    network / HF Hub unreachable), or any other error while loading/encoding.
    """


def _get_model():
    global _model, _load_error

    if _model is not None:
        return _model
    if _load_error is not None:
        # Don't retry a network call on every request; the caller can
        # reset this by restarting the process once the underlying issue
        # (e.g. missing package, no network) is fixed.
        raise EmbeddingUnavailableError(str(_load_error)) from _load_error

    try:
        from sentence_transformers import SentenceTransformer
    except ImportError as e:
        _load_error = e
        raise EmbeddingUnavailableError(
            "sentence-transformers is not installed. Run: "
            "pip install -r requirements.txt"
        ) from e

    try:
        _model = SentenceTransformer(MODEL_NAME)
    except Exception as e:  # model download / load failure (e.g. no network)
        _load_error = e
        raise EmbeddingUnavailableError(
            f"Failed to load embedding model {MODEL_NAME!r}: {e}"
        ) from e

    return _model


def is_available() -> bool:
    """Best-effort check without raising. Triggers (and caches) the load."""
    try:
        _get_model()
        return True
    except EmbeddingUnavailableError:
        return False


def build_embedding_text(post: Any) -> str:
    """Combine a LostPost/FoundPost's searchable fields into one text blob.

    Accepts anything subscriptable by field name: sqlite3.Row or a dict,
    which keeps this testable without a real DB row.
    """
    fields = ("title", "description", "category", "location")
    parts = []
    for field in fields:
        try:
            value = post[field]
        except (KeyError, IndexError):
            value = None
        if value:
            parts.append(str(value))
    return " ".join(parts)


def get_embedding(text: str) -> np.ndarray:
    """Encode a single piece of text into a vector.

    Raises EmbeddingUnavailableError if the backend can't be used.
    """
    model = _get_model()
    try:
        vector = model.encode([text])[0]
    except Exception as e:
        raise EmbeddingUnavailableError(f"Failed to encode text: {e}") from e
    return np.asarray(vector, dtype=np.float32)


def get_embeddings(texts: list[str]) -> np.ndarray:
    """Encode a batch of texts. Returns an (n, dim) array, or (0,) if empty."""
    if not texts:
        return np.empty((0,), dtype=np.float32)
    model = _get_model()
    try:
        vectors = model.encode(texts)
    except Exception as e:
        raise EmbeddingUnavailableError(f"Failed to encode texts: {e}") from e
    return np.asarray(vectors, dtype=np.float32)
