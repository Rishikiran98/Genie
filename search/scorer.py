from __future__ import annotations

from dataclasses import dataclass


@dataclass
class ScoringConfig:
    success_weight: float = 100.0
    depth_weight: float = 0.5
    timeout_weight: float = -18.0
    invalid_tactic_weight: float = -12.0
    repeated_action_weight: float = -3.0
    repeated_state_weight: float = -5.0
    retrieval_bonus_weight: float = 2.0
    incomplete_goal_penalty: float = 1.0


def score_transition(
    success: bool,
    proof_complete: bool,
    depth: int,
    num_goals: int,
    config: ScoringConfig | None = None,
    invalid_tactic: bool = False,
    timed_out: bool = False,
    repeated_action: bool = False,
    repeated_state: bool = False,
    repeated_transition: bool = False,
    retrieval_similarity: float | None = None,
) -> float:
    cfg = config or ScoringConfig()

    if proof_complete:
        base = cfg.success_weight - cfg.depth_weight * depth
    elif not success:
        base = -10.0 - cfg.depth_weight * depth
    else:
        base = -cfg.depth_weight * depth - cfg.incomplete_goal_penalty * float(num_goals)

    if invalid_tactic:
        base += cfg.invalid_tactic_weight
    if timed_out:
        base += cfg.timeout_weight
    # `repeated_transition` is kept for backwards compatibility and maps
    # to the repeated action penalty semantics.
    if repeated_action or repeated_transition:
        base += cfg.repeated_action_weight
    if repeated_state:
        base += cfg.repeated_state_weight
    if retrieval_similarity is not None:
        base += cfg.retrieval_bonus_weight * retrieval_similarity

    return base
