from search.scorer import score_transition


def test_score_transition_proof_complete_beats_depth_penalty() -> None:
    assert score_transition(success=True, proof_complete=True, depth=2, num_goals=0) == 99.0


def test_score_transition_failed_tactic_is_negative() -> None:
    assert score_transition(success=False, proof_complete=False, depth=3, num_goals=1) == -13.0
