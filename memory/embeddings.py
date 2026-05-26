from __future__ import annotations


def embed_text(text: str) -> list[float]:
    # Placeholder deterministic embedding for MVP wiring.
    return [float((sum(map(ord, text)) % 1000) / 1000.0)]
