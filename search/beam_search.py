from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from utils.run_logger import JsonlRunLogger

from lean_env.executor import LeanExecutor
from policy_model.tactic_generator import TacticGenerator
from search.scorer import ScoringConfig, score_transition
from search.state_node import StateNode


@dataclass
class SearchConfig:
    beam_width: int = 5
    max_depth: int = 20
    candidates_per_node: int = 5
    success_weight: float = 100.0
    depth_weight: float = 0.5
    timeout_weight: float = -18.0
    invalid_tactic_weight: float = -12.0
    repeated_action_weight: float = -3.0
    repeated_state_weight: float = -5.0
    retrieval_bonus_weight: float = 2.0


@dataclass
class SearchResult:
    status: str
    nodes_expanded: int
    branches_pruned: int
    timeouts: int
    invalid_count: int
    best_partial: list[str]
    proof: StateNode | None = None


class BeamSearchProver:
    def __init__(self, executor: LeanExecutor, generator: TacticGenerator, config: SearchConfig | None = None):
        self.executor = executor
        self.generator = generator
        self.config = config or SearchConfig()
        self._scoring = ScoringConfig(
            success_weight=self.config.success_weight,
            depth_weight=self.config.depth_weight,
            timeout_weight=self.config.timeout_weight,
            invalid_tactic_weight=self.config.invalid_tactic_weight,
            repeated_action_weight=self.config.repeated_action_weight,
            repeated_state_weight=self.config.repeated_state_weight,
            retrieval_bonus_weight=self.config.retrieval_bonus_weight,
        )

    @staticmethod
    def _extract_retrieval_similarity(retrieved: Any) -> float | None:
        if isinstance(retrieved, dict):
            value = retrieved.get("similarity")
            return float(value) if isinstance(value, (int, float)) else None
        if isinstance(retrieved, list) and retrieved:
            sims = [r.get("similarity") for r in retrieved if isinstance(r, dict) and isinstance(r.get("similarity"), (int, float))]
            if sims:
                return float(sum(sims) / len(sims))
        return None

    def prove(self, theorem: str, initial_goal: str, retrieve_fn=None, logger: JsonlRunLogger | None = None):
        frontier = [StateNode(goal=initial_goal, hypotheses=[], history=[], depth=0)]
        visited = set()
        transition_seen: set[tuple[str, str]] = set()
        nodes_expanded = 0
        branches_pruned = 0
        timeout_count = 0
        invalid_count = 0
        best_node = frontier[0]

        for depth in range(self.config.max_depth):
            candidates: list[StateNode] = []
            for node in frontier:
                nodes_expanded += 1
                state_key = node.normalized_state_hash()
                if state_key in visited:
                    branches_pruned += 1
                    continue
                visited.add(state_key)

                state = {
                    "goal": node.goal,
                    "hypotheses": node.hypotheses,
                    "previous_steps": node.history,
                }
                retrieved = retrieve_fn(state) if retrieve_fn else []
                retrieval_similarity = self._extract_retrieval_similarity(retrieved)
                tactics = self.generator.generate(state, retrieved, k=self.config.candidates_per_node)
                if logger:
                    logger.log(
                        "node_expansion",
                        {
                            "depth": depth,
                            "state_snapshot_hash": logger.state_snapshot_hash(node.goal, node.hypotheses, node.history),
                            "candidate_tactics": tactics,
                        },
                    )

                for tactic in tactics:
                    result = self.executor.run_tactic(theorem, node.history, tactic, depth + 1)
                    if logger:
                        logger.log(
                            "tactic_result",
                            {
                                "depth": depth + 1,
                                "state_snapshot_hash": logger.state_snapshot_hash(node.goal, node.hypotheses, node.history),
                                "tactic": tactic,
                                "executor_result": {
                                    "success": result.success,
                                    "proof_complete": result.proof_complete,
                                    "timed_out": bool(getattr(result, "timed_out", False)),
                                    "next_goal": result.next_state.goal if result.next_state else None,
                                    "next_hypotheses": result.next_state.hypotheses if result.next_state else None,
                                    "error": result.error,
                                },
                            },
                        )
                    timed_out = bool(getattr(result, "timed_out", False))
                    is_invalid = (result.next_state is None) or (not result.success and not timed_out)
                    repeated_action = (state_key, tactic.strip()) in transition_seen
                    transition_seen.add((state_key, tactic.strip()))

                    if result.next_state is None:
                        if timed_out:
                            timeout_count += 1
                        else:
                            invalid_count += 1
                        continue

                    if not result.success and timed_out:
                        timeout_count += 1

                    next_node = StateNode(
                        goal=result.next_state.goal,
                        hypotheses=result.next_state.hypotheses,
                        history=node.history + [tactic],
                        depth=depth + 1,
                        done=result.proof_complete,
                    )
                    next_node.score = score_transition(
                        success=result.success,
                        proof_complete=result.proof_complete,
                        depth=next_node.depth,
                        num_goals=0 if result.proof_complete else 1,
                        config=self._scoring,
                        invalid_tactic=is_invalid,
                        timed_out=timed_out,
                        repeated_action=repeated_action,
                        repeated_state=next_node.normalized_state_hash() in visited,
                        retrieval_similarity=retrieval_similarity,
                    )
                    candidates.append(next_node)
                    if next_node.score > best_node.score:
                        best_node = next_node
                    if result.proof_complete:
                        return SearchResult(
                            status="solved",
                            nodes_expanded=nodes_expanded,
                            branches_pruned=branches_pruned,
                            timeouts=timeout_count,
                            invalid_count=invalid_count,
                            best_partial=next_node.history,
                            proof=next_node,
                        )

            if not candidates:
                return SearchResult(
                    status="exhausted",
                    nodes_expanded=nodes_expanded,
                    branches_pruned=branches_pruned,
                    timeouts=timeout_count,
                    invalid_count=invalid_count,
                    best_partial=best_node.history,
                    proof=None,
                )
            candidates.sort(key=lambda n: n.score, reverse=True)
            if len(candidates) > self.config.beam_width:
                branches_pruned += len(candidates) - self.config.beam_width
            frontier = candidates[: self.config.beam_width]
            if logger:
                logger.log(
                    "branch_selection",
                    {
                        "depth": depth,
                        "selected_branch_decision": [n.history for n in frontier],
                    },
                )
            if frontier and frontier[0].score > best_node.score:
                best_node = frontier[0]

        return SearchResult(
            status="timeout",
            nodes_expanded=nodes_expanded,
            branches_pruned=branches_pruned,
            timeouts=timeout_count,
            invalid_count=invalid_count,
            best_partial=best_node.history,
            proof=None,
        )
