from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
import random
from typing import Iterable, Sequence


DATASET_SCHEMA_VERSION = "1.0"


@dataclass(frozen=True)
class SplitSpec:
    train: float = 0.9
    val: float = 0.05
    test: float = 0.05

    def validate(self) -> None:
        total = self.train + self.val + self.test
        if self.train <= 0 or self.val < 0 or self.test < 0:
            raise ValueError("Split values must be non-negative and train must be > 0")
        if abs(total - 1.0) > 1e-9:
            raise ValueError(f"Split values must sum to 1.0, got {total}")


def build_sft_record(
    state: dict,
    tactic: str,
    reward: float,
    *,
    trace_id: str,
    step_index: int,
    split: str,
    negatives: Sequence[str] | None = None,
    metadata: dict | None = None,
) -> dict:
    return {
        "schema_version": DATASET_SCHEMA_VERSION,
        "trace_id": trace_id,
        "step_index": step_index,
        "split": split,
        "state": state,
        "action": tactic,
        "reward": reward,
        "negatives": list(negatives or []),
        "metadata": metadata or {},
    }


def deterministic_split(trace_id: str, spec: SplitSpec, seed: int = 0) -> str:
    spec.validate()
    digest = sha256(f"{seed}:{trace_id}".encode("utf-8")).hexdigest()
    bucket = int(digest[:16], 16) / float(0xFFFFFFFFFFFFFFFF)
    if bucket < spec.train:
        return "train"
    if bucket < spec.train + spec.val:
        return "val"
    return "test"


def deterministic_shuffle(items: Iterable[dict], seed: int) -> list[dict]:
    ordered = list(items)
    rng = random.Random(seed)
    rng.shuffle(ordered)
    return ordered
