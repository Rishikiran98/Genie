from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from policy_model.tactic_generator import TacticGenerator
from search.scorer import score_transition
from search.state_node import StateNode


class ExecutorProtocol(Protocol):
    def run_tactic(self, theorem: str, previous_steps: list[str], tactic: str, depth: int): ...


@dataclass
class SearchConfig:
    beam_width: int = 5
    max_depth: int = 20
    candidates_per_node: int = 5


@dataclass
class SearchResult:
    status: str
    node: StateNode | None

    @property
    def history(self) -> list[str]:
        return self.node.history if self.node else []


class BeamSearchProver:
    def __init__(self, executor: ExecutorProtocol, generator: TacticGenerator, config: SearchConfig | None = None):
        self.executor = executor
        self.generator = generator
        self.config = config or SearchConfig()

    def prove(self, theorem: str, initial_goal: str, retrieve_fn=None) -> SearchResult:
        frontier = [StateNode(goal=initial_goal, hypotheses=[], history=[], depth=0)]
        visited = set()

        for depth in range(self.config.max_depth):
            candidates: list[StateNode] = []
            for node in frontier:
                state_key = (node.goal, tuple(node.hypotheses))
                if state_key in visited:
                    continue
                visited.add(state_key)

                state = {
                    "goal": node.goal,
                    "hypotheses": node.hypotheses,
                    "previous_steps": node.history,
                }
                retrieved = retrieve_fn(state) if retrieve_fn else []
                tactics = self.generator.generate(state, retrieved, k=self.config.candidates_per_node)

                for tactic in tactics:
                    result = self.executor.run_tactic(theorem, node.history, tactic, depth + 1)
                    if result.next_state is None:
                        continue
                    next_goal = getattr(result.next_state, "primary_goal", None) or getattr(result.next_state, "goal", "")
                    next_node = StateNode(
                        goal=next_goal,
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
                    )
                    candidates.append(next_node)
                    if result.proof_complete:
                        return SearchResult(status="solved", node=next_node)

            if not candidates:
                return SearchResult(status="exhausted", node=None)
            candidates.sort(key=lambda n: n.score, reverse=True)
            frontier = candidates[: self.config.beam_width]

        best = frontier[0] if frontier else None
        return SearchResult(status="exhausted", node=best)
