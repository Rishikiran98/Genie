from __future__ import annotations

from dataclasses import dataclass


@dataclass
class ScoringConfig:
    invalid_tactic_penalty: float = -12.0
    timeout_penalty: float = -18.0
    repeated_transition_penalty: float = -3.0
    retrieval_similarity_weight: float = 2.0
    depth_penalty: float = 0.5
    incomplete_goal_penalty: float = 1.0


def score_transition(
    success: bool,
    proof_complete: bool,
    depth: int,
    num_goals: int,
    config: ScoringConfig | None = None,
    invalid_tactic: bool = False,
    timed_out: bool = False,
    repeated_transition: bool = False,
    retrieval_similarity: float | None = None,
) -> float:
    cfg = config or ScoringConfig()

    if proof_complete:
        base = 100.0 - cfg.depth_penalty * depth
    elif not success:
        base = -10.0 - cfg.depth_penalty * depth
    else:
        base = -cfg.depth_penalty * depth - cfg.incomplete_goal_penalty * float(num_goals)

    if invalid_tactic:
        base += cfg.invalid_tactic_penalty
    if timed_out:
        base += cfg.timeout_penalty
    if repeated_transition:
        base += cfg.repeated_transition_penalty
    if retrieval_similarity is not None:
        base += cfg.retrieval_similarity_weight * retrieval_similarity

    return base
