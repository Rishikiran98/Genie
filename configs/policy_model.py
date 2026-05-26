from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any


DEFAULTS_FILE = Path(__file__).with_name("tactic_model.defaults.json")


@dataclass(frozen=True)
class TacticModelConfig:
    provider: str = "heuristic"
    model: str = "gpt-4o-mini"
    api_key: str | None = None
    api_base_url: str = "https://api.openai.com/v1"
    temperature: float = 0.0
    top_k: int = 5
    max_tokens: int = 256
    timeout_seconds: int = 30


def _load_file_defaults() -> dict[str, Any]:
    if not DEFAULTS_FILE.exists():
        return {}
    with DEFAULTS_FILE.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        return {}
    return data


def load_tactic_model_config() -> TacticModelConfig:
    defaults = _load_file_defaults()
    provider = os.getenv("TACTIC_MODEL_PROVIDER", str(defaults.get("provider", "heuristic"))).strip().lower()
    model = os.getenv("TACTIC_MODEL_NAME", str(defaults.get("model", "gpt-4o-mini"))).strip()
    temperature = float(os.getenv("TACTIC_MODEL_TEMPERATURE", str(defaults.get("temperature", 0.0))))
    top_k = int(os.getenv("TACTIC_MODEL_TOP_K", str(defaults.get("top_k", 5))))

    return TacticModelConfig(
        provider=provider,
        model=model,
        api_key=os.getenv("TACTIC_MODEL_API_KEY") or os.getenv("OPENAI_API_KEY"),
        api_base_url=os.getenv("TACTIC_MODEL_API_BASE_URL", "https://api.openai.com/v1").rstrip("/"),
        temperature=temperature,
        top_k=max(1, top_k),
        max_tokens=int(os.getenv("TACTIC_MODEL_MAX_TOKENS", "256")),
        timeout_seconds=int(os.getenv("TACTIC_MODEL_TIMEOUT_SECONDS", "30")),
    )
