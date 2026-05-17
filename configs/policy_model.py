from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class TacticModelConfig:
    provider: str = "heuristic"
    model: str = "gpt-4o-mini"
    api_key: str | None = None
    api_base_url: str = "https://api.openai.com/v1"
    temperature: float = 0.0
    max_tokens: int = 256
    timeout_seconds: int = 30



def load_tactic_model_config() -> TacticModelConfig:
    return TacticModelConfig(
        provider=os.getenv("TACTIC_MODEL_PROVIDER", "heuristic").strip().lower(),
        model=os.getenv("TACTIC_MODEL_NAME", "gpt-4o-mini").strip(),
        api_key=os.getenv("TACTIC_MODEL_API_KEY") or os.getenv("OPENAI_API_KEY"),
        api_base_url=os.getenv("TACTIC_MODEL_API_BASE_URL", "https://api.openai.com/v1").rstrip("/"),
        temperature=float(os.getenv("TACTIC_MODEL_TEMPERATURE", "0.0")),
        max_tokens=int(os.getenv("TACTIC_MODEL_MAX_TOKENS", "256")),
        timeout_seconds=int(os.getenv("TACTIC_MODEL_TIMEOUT_SECONDS", "30")),
    )
