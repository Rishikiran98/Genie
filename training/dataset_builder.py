from __future__ import annotations


def build_sft_record(state: dict, tactic: str, reward: float) -> dict:
    return {"state": state, "action": tactic, "reward": reward}
