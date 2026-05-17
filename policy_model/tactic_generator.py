from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Protocol

from configs.policy_model import TacticModelConfig, load_tactic_model_config
from policy_model.prompt_builder import build_tactic_prompt


class LLMClient(Protocol):
    def complete(self, prompt: str) -> str: ...


@dataclass
class HeuristicFallbackClient:
    def complete(self, prompt: str) -> str:
        _ = prompt
        return json.dumps({"tactics": ["simp", "rfl", "aesop", "induction n <;> simp"]})


@dataclass
class OpenAICompatibleClient:
    config: TacticModelConfig

    def complete(self, prompt: str) -> str:
        if not self.config.api_key:
            raise ValueError("TACTIC_MODEL_API_KEY or OPENAI_API_KEY must be set for OpenAI-compatible provider")

        payload = {
            "model": self.config.model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": self.config.temperature,
            "max_tokens": self.config.max_tokens,
        }
        req = urllib.request.Request(
            url=f"{self.config.api_base_url}/chat/completions",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.config.api_key}",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=self.config.timeout_seconds) as response:
                parsed = json.loads(response.read().decode("utf-8"))
        except urllib.error.URLError as exc:
            raise RuntimeError(f"Provider call failed: {exc}") from exc

        choices = parsed.get("choices", [])
        if not choices:
            raise RuntimeError("Provider returned no choices")
        return choices[0].get("message", {}).get("content", "")


class TacticGenerator:
    INVALID_PATTERNS = (
        "```",
        "sorry",
        "admit",
        "TODO",
        "<insert",
        "I cannot",
        "as an ai",
        "explain",
    )

    def __init__(self, client: LLMClient | None = None, config: TacticModelConfig | None = None):
        self.config = config or load_tactic_model_config()
        self.client = client or self._build_client(self.config)

    def _build_client(self, config: TacticModelConfig) -> LLMClient:
        if config.provider in {"openai", "openai_compatible"}:
            return OpenAICompatibleClient(config=config)
        return HeuristicFallbackClient()

    def _repair_json(self, raw: str) -> dict | None:
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            pass

        match = re.search(r"\{[\s\S]*\}", raw)
        if not match:
            return None

        candidate = match.group(0)
        for tentative in (candidate, candidate.replace("'", '"')):
            try:
                return json.loads(tentative)
            except json.JSONDecodeError:
                continue
        return None

    def _sanitize_tactics(self, tactics: list[str], k: int) -> list[str]:
        uniq: list[str] = []
        seen: set[str] = set()
        for tactic in tactics:
            normalized = " ".join(tactic.strip().split())
            if not normalized or len(normalized) > 256:
                continue
            lower = normalized.lower()
            if any(pattern in lower for pattern in (p.lower() for p in self.INVALID_PATTERNS)):
                continue
            if normalized not in seen:
                seen.add(normalized)
                uniq.append(normalized)
            if len(uniq) >= k:
                break
        return uniq

    def generate(self, state: dict, retrieved_traces: list[dict] | None = None, k: int = 5) -> list[str]:
        prompt = build_tactic_prompt(state, retrieved_traces)
        raw = self.client.complete(prompt)

        parsed = self._repair_json(raw)
        if not isinstance(parsed, dict):
            parsed = {"tactics": ["simp", "rfl"]}

        raw_tactics = parsed.get("tactics", [])
        tactics = [t for t in raw_tactics if isinstance(t, str)]

        sanitized = self._sanitize_tactics(tactics, k=k)
        return sanitized or ["simp", "rfl"][:k]
