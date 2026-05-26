from evaluation.metrics import proof_success_rate


def test_proof_success_rate_empty() -> None:
    assert proof_success_rate([]) == 0.0


def test_proof_success_rate_mixed() -> None:
    assert proof_success_rate([True, False, True]) == 2 / 3
