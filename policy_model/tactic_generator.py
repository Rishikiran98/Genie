from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Protocol

from configs.policy_model import TacticModelConfig, load_tactic_model_config
from policy_model.prompt_builder import TACTIC_RESPONSE_SCHEMA, build_repair_prompt, build_tactic_prompt


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
    INVALID_PATTERNS = ("```", "sorry", "admit", "todo", "<insert", "i cannot", "as an ai", "explain")
    INVALID_TOKEN_PATTERN = re.compile(r"[\x00-\x08\x0B\x0C\x0E-\x1F]")

    def __init__(self, client: LLMClient | None = None, config: TacticModelConfig | None = None):
        self.config = config or load_tactic_model_config()
        self.client = client or self._build_client(self.config)

    def _build_client(self, config: TacticModelConfig) -> LLMClient:
        if config.provider in {"openai", "openai_compatible"}:
            return OpenAICompatibleClient(config=config)
        return HeuristicFallbackClient()

    def _repair_json(self, raw: str) -> dict[str, Any] | None:
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

    def _validate_schema(self, parsed: Any) -> bool:
        schema = TACTIC_RESPONSE_SCHEMA
        if not isinstance(parsed, dict):
            return False
        if set(parsed.keys()) != set(schema["required"]):
            return False
        tactics = parsed.get("tactics")
        if not isinstance(tactics, list):
            return False
        if not (schema["properties"]["tactics"]["minItems"] <= len(tactics) <= schema["properties"]["tactics"]["maxItems"]):
            return False
        for tactic in tactics:
            if not isinstance(tactic, str):
                return False
            stripped = tactic.strip()
            if not stripped:
                return False
            if len(stripped) > schema["properties"]["tactics"]["items"]["maxLength"]:
                return False
        return True

    def _sanitize_tactics(self, tactics: list[str], k: int) -> list[str]:
        uniq: list[str] = []
        seen: set[str] = set()
        for tactic in tactics:
            normalized = " ".join(tactic.strip().split())
            if not normalized or len(normalized) > 256:
                continue
            if self.INVALID_TOKEN_PATTERN.search(normalized):
                continue
            lower = normalized.lower()
            if any(pattern in lower for pattern in self.INVALID_PATTERNS):
                continue
            if normalized not in seen:
                seen.add(normalized)
                uniq.append(normalized)
            if len(uniq) >= k:
                break
        return uniq

    def _safe_fallback_tactics(self, k: int) -> list[str]:
        return ["simp", "rfl", "aesop", "constructor", "assumption"][:k]

    def generate(self, state: dict, retrieved_traces: list[dict] | None = None, k: int | None = None) -> list[str]:
        target_k = max(1, k if k is not None else self.config.top_k)
        prompt = build_tactic_prompt(state, retrieved_traces)

        raw = self.client.complete(prompt)
        parsed = self._repair_json(raw)

        if not self._validate_schema(parsed):
            repair_prompt = build_repair_prompt(raw, state)
            repaired_raw = self.client.complete(repair_prompt)
            parsed = self._repair_json(repaired_raw)

        if not self._validate_schema(parsed):
            return self._safe_fallback_tactics(target_k)

        tactics = parsed["tactics"]
        sanitized = self._sanitize_tactics(tactics, k=target_k)
        return sanitized or self._safe_fallback_tactics(target_k)
